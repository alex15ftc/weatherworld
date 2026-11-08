--!strict
-- A client frame: the cut-down frame a player's client gets for one detailed storm (made by the
-- engine from the full frame, js/cloudmodel/FrameCodec.js clientFrame; docs/cloudlab/PLAN.md B2).
-- Only what the visuals draw, each field a whole plane. The frame arrives Zstd-compressed; unpack
-- it first (EncodingService:DecompressBuffer(b, Enum.CompressionAlgorithm.Zstd)).
--
-- Header (42 bytes, little-endian, as FrameCodec.luau's): u8 version (129), u8 flags (bit 0 nest,
-- bit 1 storm ended, bit 2 far), u32 seq, f32 model time (s), f64 engine sim hour, u16 nx, ny
-- (this grid's), f32 dx (m; a far frame has half the columns each way at twice the spacing),
-- f32 anchorX, anchorY (m from the box's south-west corner: the point drawn at the engine storm's
-- position), f32 frame motion u, v (m/s).
-- Box planes (nx * ny bytes, row by row from the south-west): base1, top1, base2, top2 (100 m),
-- rain, hail (byte = 40 log10(1 + mm/h)), snow (anvil, 0.05 kg/m2). A far column is a 2 x 2
-- block: the lowest base, the highest of the rest.
-- Near frames with a nest: its header (u16 nx, ny, f32 dx, X0, Y0: its corner in the box, m) and
-- two planes, cloud base below 3 km (25 m; 0 none) and pressure drop (10 Pa).
-- With flags bit 3, near and far: the tornado (js/cloudmodel/FrameCodec.js TORNADO documents the
-- bytes; ClientFrame.readTornado reads them): where it is and how it leans, from the model; its
-- core, pressure drop and funnel, from the engine's wind and width by vortex physics.
-- With flags bit 4, near and far: the drift block (js/cloudmodel/FrameCodec.js DRIFT): how falling
-- rain and hail drift on their way down - ClientFrame.driftAt.
-- With flags bit 5, near and far: the updraught block (js/cloudmodel/FrameCodec.js UPDRAUGHT): the
-- rising air the views need - wTor (m/s over the tornado at the wall cloud's base, or over the
-- low-level mesocyclone), wBase (the core's centre-line speed at the cloud base), x1, y1 and x5, y5
-- (box m: the core's centre at 1 and 5 km), coreM (its radius, m).
local ClientFrame = {}

ClientFrame.VERSION = 129
local HEADER = 42
local NEST_HEADER = 16
ClientFrame.PLANES = { "base1", "top1", "base2", "top2", "rain", "hail", "snow" }
local PLANE_INDEX = {}
for k, name in ClientFrame.PLANES do PLANE_INDEX[name] = k - 1 end

export type Nest = { nx: number, ny: number, dx: number, X0: number, Y0: number, offset: number }
-- found: the model has a vortex (else x, y are its finest nest's middle); cloud: a cloud over it;
-- ef (nil none), mph, yards: the engine's; x, y: box m at the ground; R core radius (m), drop core
-- pressure drop (Pa), base cloud base over it (m), tip funnel tip (m above the ground); gust (m/s),
-- zeta (0-1 km mean, 1/s), dzeta (since the minute before), modelDrop (Pa): the model's own;
-- levels: z (m), dx, dy (m from the ground point), funnel radius (m; 0 clear air), found (the
-- model's vortex reaches that high)
export type Level = { z: number, dx: number, dy: number, funnel: number, found: boolean }
export type Tornado = {
	found: boolean, cloud: boolean, ef: number?, mph: number, yards: number, x: number, y: number,
	R: number, drop: number, base: number, tip: number, gust: number, zeta: number, dzeta: number,
	modelDrop: number, levels: { Level }, length: number,
}
-- levels: height (m) and the storm-relative wind summed from the ground to it (m2/s, x east, y north)
export type Drift = { hailFallMs: number, levels: { { number } } }
export type Updraught = { wTor: number, wBase: number, x1: number, y1: number, x5: number, y5: number, coreM: number }
export type Frame = {
	buf: buffer, seq: number, time: number, simHour: number, ended: boolean, far: boolean,
	nx: number, ny: number, dx: number, anchorX: number, anchorY: number, um: number, vm: number,
	nest: Nest?, tornado: Tornado?, drift: Drift?, updraught: Updraught?,
}

local TORNADO, TOR_LEVEL = 28, 8
-- The tornado block at byte o (full and client frames alike).
function ClientFrame.readTornado(b: buffer, o: number): Tornado
	local flags, n = buffer.readu8(b, o), buffer.readu8(b, o + 27)
	local levels = {}
	for q = 0, n - 1 do
		local p = o + TORNADO + TOR_LEVEL * q
		local r = buffer.readu16(b, p + 6)
		table.insert(levels, { z = buffer.readu16(b, p), dx = buffer.readi16(b, p + 2), dy = buffer.readi16(b, p + 4), funnel = bit32.band(r, 32767), found = bit32.btest(r, 32768) })
	end
	local ef = buffer.readu8(b, o + 1)
	return {
		found = bit32.btest(flags, 1), cloud = bit32.btest(flags, 2), ef = if ef == 255 then nil else ef,
		mph = buffer.readu16(b, o + 2), yards = buffer.readu16(b, o + 4), x = buffer.readf32(b, o + 6), y = buffer.readf32(b, o + 10),
		R = buffer.readu16(b, o + 14), drop = buffer.readu16(b, o + 16), base = buffer.readu16(b, o + 18), tip = buffer.readu16(b, o + 20),
		gust = buffer.readu8(b, o + 22), zeta = buffer.readu8(b, o + 23) * 0.005, dzeta = buffer.readi8(b, o + 24) * 0.005,
		modelDrop = buffer.readu16(b, o + 25), levels = levels, length = TORNADO + TOR_LEVEL * n,
	}
end

function ClientFrame.decode(b: buffer): Frame
	assert(buffer.readu8(b, 0) == ClientFrame.VERSION, "not a client frame")
	local flags = buffer.readu8(b, 1)
	local nx, ny = buffer.readu16(b, 18), buffer.readu16(b, 20)
	local f: Frame = {
		buf = b, seq = buffer.readu32(b, 2), time = buffer.readf32(b, 6), simHour = buffer.readf64(b, 10),
		ended = bit32.btest(flags, 2), far = bit32.btest(flags, 4),
		nx = nx, ny = ny, dx = buffer.readf32(b, 22),
		anchorX = buffer.readf32(b, 26), anchorY = buffer.readf32(b, 30), um = buffer.readf32(b, 34), vm = buffer.readf32(b, 38),
		nest = nil, tornado = nil, drift = nil, updraught = nil,
	}
	local o = HEADER + #ClientFrame.PLANES * nx * ny
	if bit32.btest(flags, 1) then
		local n: Nest = { nx = buffer.readu16(b, o), ny = buffer.readu16(b, o + 2), dx = buffer.readf32(b, o + 4), X0 = buffer.readf32(b, o + 8), Y0 = buffer.readf32(b, o + 12), offset = o + NEST_HEADER }
		f.nest = n
		o = n.offset + 2 * n.nx * n.ny
	end
	if bit32.btest(flags, 8) then
		local t = ClientFrame.readTornado(b, o)
		f.tornado = t
		o += t.length
	end
	if bit32.btest(flags, 16) then
		local n, levels = buffer.readu8(b, o), {}
		for q = 0, n - 1 do
			local p = o + 5 + 10 * q
			table.insert(levels, { buffer.readu16(b, p), buffer.readf32(b, p + 2), buffer.readf32(b, p + 6) })
		end
		f.drift = { hailFallMs = buffer.readf32(b, o + 1), levels = levels }
		o += 5 + 10 * n
	end
	if bit32.btest(flags, 32) then
		local function r(q: number): number return buffer.readf32(b, o + 1 + 4 * q) end
		f.updraught = { wTor = r(0), wBase = r(1), x1 = r(2), y1 = r(3), x5 = r(4), y5 = r(5), coreM = r(6) }
	end
	return f
end

-- How far (box m, x east, y north) something falling at fallMs has drifted between height zM and
-- the ground: the storm-relative wind summed over the fall, over its fall speed (0, 0 without the
-- drift block: the cloud model's frames). A shaft's point at zM is its ground point less this.
function ClientFrame.driftAt(f: Frame, zM: number, fallMs: number): (number, number)
	local d = f.drift
	if not d or #d.levels == 0 or fallMs <= 0 then return 0, 0 end
	local L = d.levels
	local step = if #L > 1 then L[2][1] - L[1][1] else 1
	local q = math.clamp(zM / step + 1, 1, #L)
	local a, b = L[math.floor(q)], L[math.min(#L, math.floor(q) + 1)]
	local t = q - math.floor(q)
	return (a[2] + t * (b[2] - a[2])) / fallMs, (a[3] + t * (b[3] - a[3])) / fallMs
end

-- The fall speed of rain at rate mmh (m/s): the median drop (Marshall-Palmer D0 = 0.9 R^0.21 mm),
-- Atlas et al.'s law - as the engine's drift trace (js/storms/StormStructure.js).
function ClientFrame.rainFallMs(mmh: number): number
	return 9.65 - 10.3 * math.exp(-0.6 * 0.9 * math.max(0.1, mmh) ^ 0.21)
end

-- The byte of a box plane at column (i, j), 1-based from the south-west.
function ClientFrame.byte(f: Frame, plane: string, i: number, j: number): number
	return buffer.readu8(f.buf, HEADER + PLANE_INDEX[plane] * f.nx * f.ny + (j - 1) * f.nx + (i - 1))
end

-- In physical units: cloud heights (m above the ground; 0 none), rain and hail (mm/h), snow (kg/m2).
function ClientFrame.cloudM(byte: number): number return byte * 100 end
function ClientFrame.rateMmh(byte: number): number return 10 ^ (byte / 40) - 1 end
function ClientFrame.snowKg(byte: number): number return byte * 0.05 end

-- The nest's cloud base (m; 0 none; 25 for a cloud from the ground up) and pressure drop (Pa) at its
-- column (i, j).
function ClientFrame.nestBaseM(f: Frame, i: number, j: number): number
	local n = f.nest :: Nest
	return buffer.readu8(f.buf, n.offset + (j - 1) * n.nx + (i - 1)) * 25
end
function ClientFrame.nestDropPa(f: Frame, i: number, j: number): number
	local n = f.nest :: Nest
	return buffer.readu8(f.buf, n.offset + n.nx * n.ny + (j - 1) * n.nx + (i - 1)) * 10
end

return ClientFrame
