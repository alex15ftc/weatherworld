--!strict
-- One detailed storm's frame: what the worker beside the engine (tools/cloudlab/worker) sends
-- and the Roblox server and clients read (docs/cloudlab/PLAN.md, phase B). Compact: each value
-- is quantised to one byte, and only what the visuals and the storm-scale winds need goes in.
--
-- Header (little-endian):
--   u8  version (FrameCodec.VERSION)        u8  flags (bit 0: has nest, bit 1: storm ended)
--   u32 sequence                            f32 model time (s)
--   f64 engine sim hour (UTC) of the last record the run had
--   u16 nx, ny                              f32 dx (m)
--   f32 anchorX, anchorY: the point in the box (m from its south-west corner) that is drawn at the
--       engine storm's position (the box's follow target: the model storm sits there)
--   f32 frame motion u, v (m/s): the engine storm's motion, for moving the frame between frames
--   then the nest's own header and columns if bit 0 (nx, ny u16, dx f32, X0, Y0 f32: its corner
--   in the box, m)
-- Box columns, row by row from the south-west, FIELDS bytes each (BOX_FIELDS: name, scale):
--   base1, top1     lowest cloud run (cloud water + snow; falling rain and hail are not cloud), 100 m units
--   base2, top2     the next run up (the anvil over a gap), 100 m units
--   rain            ground rain + hail, log: byte = 40 log10(1 + mm/h)   (255 = 2400 mm/h)
--   hail            the hail part, same scale
--   dth             ground air's temperature change (K): signed, 0.1 K
--   u, v            ground wind, ground-relative (m/s): signed, 0.5 m/s
--   w5              5 km updraft (m/s): signed, 0.5 m/s
--   zeta1           1 km vertical vorticity: signed, 0.001 /s
--   snow            the anvil's thickness: column snow above 6 km, 0.05 kg/m2 units
-- Nest columns (NEST_FIELDS): cloud base below 3 km (25 m units; 0 none), ground wind u, v
-- (0.5 m/s signed), ground vorticity (signed, 0.002 /s), pressure drop (10 Pa units).
local FrameCodec = {}

-- (the tornado block's reader is ClientFrame's; loaded when first needed. In Roblox the sibling
-- module, on the command line the file beside this one)
local clientFrame: any = nil
local function ClientFrame(): any
	if not clientFrame then
		clientFrame = if script then require((script :: any).Parent:FindFirstChild("ClientFrame")) else (require :: any)("./ClientFrame")
	end
	return clientFrame
end

FrameCodec.VERSION = 1
FrameCodec.BOX_FIELDS = 12
FrameCodec.NEST_FIELDS = 5
local HEADER = 1 + 1 + 4 + 4 + 8 + 2 + 2 + 4 + 4 + 4 + 4 + 4 -- 42
local NEST_HEADER = 2 + 2 + 4 + 4 + 4 -- 16
FrameCodec.HEADER = HEADER
local CLOUD = 1e-4

local function u8(x: number): number
	return math.clamp(math.floor(x + 0.5), 0, 255)
end
local function i8(x: number): number
	return math.clamp(math.floor(x + 0.5), -127, 127)
end
local function logRate(mmh: number): number
	return u8(40 * math.log10(1 + math.max(0, mmh)))
end
local function unLogRate(b: number): number
	return 10 ^ (b / 40) - 1
end

-- The nest's part of a frame (its header and columns), on its own: a nest on its own process
-- (NestRemote) sends it back with each step.
function FrameCodec.encodeNest(nest: any): buffer
	local b = buffer.create(NEST_HEADER + nest.nx * nest.ny * FrameCodec.NEST_FIELDS)
	-- the nest's corner in the outermost box
	local X0, Y0, up = nest.X0, nest.Y0, nest.parent
	while up and up.parent do
		X0 += up.X0
		Y0 += up.Y0
		up = up.parent
	end
	buffer.writeu16(b, 0, nest.nx)
	buffer.writeu16(b, 2, nest.ny)
	buffer.writef32(b, 4, nest.dx)
	buffer.writef32(b, 8, X0)
	buffer.writef32(b, 12, Y0)
	local o = NEST_HEADER
	local nqc, nzf, NSX, NSXY = nest.qc, nest.zf, nest.SX, nest.SXY
	local mean, cnt = 0, 0
	for j = 1, nest.ny do
		for i = 1, nest.nx do
			mean += nest.p[nest:idx(i, j, 1)]
			cnt += 1
		end
	end
	mean /= cnt
	for j = 1, nest.ny do
		for i = 1, nest.nx do
			local col = nest:idx(i, j, 0)
			local zb = 0
			for k = 1, nest.nz do
				if nzf[k] > 3000 then
					break
				end
				if nqc[col + k * NSXY] > CLOUD then
					zb = nzf[k]
					break
				end
			end
			local n1 = col + NSXY
			local ug = 0.5 * (nest.u[n1] + nest.u[n1 + 1]) + nest.umove
			local vg = 0.5 * (nest.v[n1] + nest.v[n1 + NSX]) + nest.vmove
			buffer.writeu8(b, o, if zb > 0 then math.max(1, u8(zb / 25)) else 0)
			buffer.writei8(b, o + 1, i8(ug * 2))
			buffer.writei8(b, o + 2, i8(vg * 2))
			buffer.writei8(b, o + 3, i8(nest:zeta(i, j, 1) / 0.002))
			buffer.writeu8(b, o + 4, u8(math.max(0, mean - nest.p[n1]) / 10))
			o += FrameCodec.NEST_FIELDS
		end
	end
	return b
end

-- run: an EngineRun (its model, its nest or the nest process's last frame section
-- run.nestFrame, and its record); seq: the frame's number
function FrameCodec.encode(run: any, seq: number): buffer
	local m = run.model
	local nestPart: buffer? = if run.nest then FrameCodec.encodeNest(run.nest) else run.nestFrame
	local nx, ny = m.nx, m.ny
	local nb = nx * ny * FrameCodec.BOX_FIELDS
	local nn = if nestPart then buffer.len(nestPart) else 0
	local b = buffer.create(HEADER + nb + nn)
	buffer.writeu8(b, 0, FrameCodec.VERSION)
	buffer.writeu8(b, 1, (if nestPart then 1 else 0) + (if run.ended then 2 else 0))
	buffer.writeu32(b, 2, seq)
	buffer.writef32(b, 6, m.time)
	buffer.writef64(b, 10, run.simHour or 0)
	buffer.writeu16(b, 18, nx)
	buffer.writeu16(b, 20, ny)
	buffer.writef32(b, 22, m.dx)
	-- the box's follow target: where the model storm sits (CloudModel.followStorm)
	buffer.writef32(b, 26, (math.floor(0.5 * nx) - 0.5) * m.dx)
	buffer.writef32(b, 30, (math.floor(0.45 * ny) - 0.5) * m.dx)
	buffer.writef32(b, 34, m.umove)
	buffer.writef32(b, 38, m.vmove)
	local nz = m.nz
	local qc, qsn, th, w, u, v = m.qc, m.qsn, m.th, m.w, m.u, m.v
	local zf, th0, rho0, dzc, zc = m.zf, m.th0, m.rho0, m.dzc, m.zc
	local SX, SXY = m.SX, m.SXY
	local k1, k5 = m:levelAt(1000), m:levelAt(5000)
	local o = HEADER
	for j = 1, ny do
		for i = 1, nx do
			local col = m:idx(i, j, 0)
			local runs = { 0, 0, 0, 0 }
			local nr, inside = 0, false
			local snowCol = 0
			for k = 1, nz do
				local n = col + k * SXY
				-- (cloud: droplets and the anvil's ice; falling rain and hail are not cloud - js/cloudmodel/FrameCodec.js)
				local c = qc[n] + qsn[n]
				if c > CLOUD then
					if not inside then
						nr += 1
						if nr <= 2 then
							runs[2 * nr - 1] = zf[k]
						end
						inside = true
					end
					if nr <= 2 then
						runs[2 * nr] = zf[k + 1]
					end
				else
					inside = false
				end
				if zc[k] > 6000 then
					snowCol += rho0[k] * math.max(0, qsn[n]) * dzc[k]
				end
			end
			local n1 = col + SXY
			local ug = 0.5 * (u[n1] + u[n1 + 1]) + m.umove
			local vg = 0.5 * (v[n1] + v[n1 + SX]) + m.vmove
			local cs = (j + 1) * SX + i + 2
			buffer.writeu8(b, o, u8(runs[1] / 100))
			buffer.writeu8(b, o + 1, u8(runs[2] / 100))
			buffer.writeu8(b, o + 2, u8(runs[3] / 100))
			buffer.writeu8(b, o + 3, u8(runs[4] / 100))
			buffer.writeu8(b, o + 4, logRate(m.rainSfc[cs]))
			buffer.writeu8(b, o + 5, logRate(m.hailSfc[cs]))
			buffer.writei8(b, o + 6, i8((th[n1] - th0[1]) * 10))
			buffer.writei8(b, o + 7, i8(ug * 2))
			buffer.writei8(b, o + 8, i8(vg * 2))
			buffer.writei8(b, o + 9, i8(0.5 * (w[col + k5 * SXY] + w[col + (k5 + 1) * SXY]) * 2))
			buffer.writei8(b, o + 10, i8(m:zeta(i, j, k1) * 1000))
			buffer.writeu8(b, o + 11, u8(snowCol / 0.05))
			o += FrameCodec.BOX_FIELDS
		end
	end
	if nestPart then
		buffer.copy(b, o, nestPart)
	end
	return b
end

export type Frame = {
	seq: number, time: number, simHour: number, ended: boolean,
	nx: number, ny: number, dx: number, anchorX: number, anchorY: number, um: number, vm: number,
	nest: { nx: number, ny: number, dx: number, X0: number, Y0: number, offset: number }?,
	-- (flags bit 2: the tornado, after the nest; ClientFrame.Tornado; js/cloudmodel/FrameCodec.js
	-- writes it)
	tornado: any,
	buf: buffer,
}

function FrameCodec.decodeHeader(b: buffer): Frame
	assert(buffer.readu8(b, 0) == FrameCodec.VERSION, "frame version")
	local flags = buffer.readu8(b, 1)
	local f: Frame = {
		seq = buffer.readu32(b, 2), time = buffer.readf32(b, 6), simHour = buffer.readf64(b, 10),
		ended = bit32.band(flags, 2) ~= 0,
		nx = buffer.readu16(b, 18), ny = buffer.readu16(b, 20), dx = buffer.readf32(b, 22),
		anchorX = buffer.readf32(b, 26), anchorY = buffer.readf32(b, 30),
		um = buffer.readf32(b, 34), vm = buffer.readf32(b, 38), nest = nil, tornado = nil, buf = b,
	}
	local o = HEADER + f.nx * f.ny * FrameCodec.BOX_FIELDS
	if bit32.band(flags, 1) ~= 0 then
		local nnx, nny = buffer.readu16(b, o), buffer.readu16(b, o + 2)
		f.nest = { nx = nnx, ny = nny, dx = buffer.readf32(b, o + 4), X0 = buffer.readf32(b, o + 8), Y0 = buffer.readf32(b, o + 12), offset = o + NEST_HEADER }
		o += NEST_HEADER + nnx * nny * FrameCodec.NEST_FIELDS
	end
	if bit32.band(flags, 4) ~= 0 then
		f.tornado = ClientFrame().readTornado(b, o)
	end
	return f
end

-- Box column (i, j): base1, top1, base2, top2 (m), rain, hail (mm/h), dth (K), u, v (m/s),
-- w5 (m/s), zeta1 (1/s), snow (kg/m2)
function FrameCodec.box(f: Frame, i: number, j: number): (number, number, number, number, number, number, number, number, number, number, number, number)
	local b = f.buf
	local o = HEADER + ((j - 1) * f.nx + (i - 1)) * FrameCodec.BOX_FIELDS
	return buffer.readu8(b, o) * 100, buffer.readu8(b, o + 1) * 100, buffer.readu8(b, o + 2) * 100, buffer.readu8(b, o + 3) * 100,
		unLogRate(buffer.readu8(b, o + 4)), unLogRate(buffer.readu8(b, o + 5)),
		buffer.readi8(b, o + 6) / 10, buffer.readi8(b, o + 7) / 2, buffer.readi8(b, o + 8) / 2,
		buffer.readi8(b, o + 9) / 2, buffer.readi8(b, o + 10) / 1000, buffer.readu8(b, o + 11) * 0.05
end

-- Nest column (i, j): cloud base (m; 0 none), u, v (m/s), ground zeta (1/s), pressure drop (Pa)
function FrameCodec.nestColumn(f: Frame, i: number, j: number): (number, number, number, number, number)
	local n = f.nest :: any
	local b = f.buf
	local o = n.offset + ((j - 1) * n.nx + (i - 1)) * FrameCodec.NEST_FIELDS
	return buffer.readu8(b, o) * 25, buffer.readi8(b, o + 1) / 2, buffer.readi8(b, o + 2) / 2, buffer.readi8(b, o + 3) * 0.002, buffer.readu8(b, o + 4) * 10
end

return FrameCodec
