--!native
--!optimize 2
-- The 250 m nest on its own process, beside the 1 km box (docs/cloudlab/PLAN.md, C2): the two step
-- at the same time on two cores. Pure Luau (buffers and tables); the transport is the caller's
-- (tools/cloudlab/worker/nestlink.luau over localhost HTTP).
--
-- In one process the coupling is serial: the nest's steps need the box's state after the box's
-- step (its side boundary), and the box's next step takes the nest's feedback. Here the nest runs
-- one box step behind:
--   - after box step n the box sends the region of its fields around the nest (the nest's
--     boundary and its recentring need nothing else) and the steering (air, cold pool, lifts,
--     motion, the box's shifts);
--   - the nest process keeps a mirror of the box holding that region, steps the nest across box
--     step n while the box does step n+1, and returns the feedback: the nest's averages over the
--     box cells it covers, at the end of step n;
--   - after step n+1 the box moves those cells toward the averages (all the way at GAIN 1), where
--     the one-process nest would have replaced them after step n: the box over the nest is the
--     nest of 6 s before.
-- (Adding the difference nest - box of 6 s before instead re-adds old differences as the two drift
-- apart: the wind correction grew from 2 to 118 m/s over 4 min and the box went NaN, 2026-11-05.)
-- The nest itself, its boundary, shifts and recentring are Nest's own code, run on the mirror.
local function dep(name: string): any
	if script then
		return require((script :: any).Parent:FindFirstChild(name))
	end
	return (require :: any)("./" .. name)
end
local CloudModel = dep("CloudModel")
local Nest = dep("Nest")
local FrameCodec = dep("FrameCodec")

local NestRemote = {}

local PROG = { "u", "v", "w", "p", "th", "qv", "qc", "qr", "qh", "qsn" }
local FEED = { "u", "v", "w", "th", "qv", "qc", "qr", "qh", "qsn" }
NestRemote.NX, NestRemote.RATIO, NestRemote.STEPS = 48, 4, 2
-- the region around the nest's footprint (box cells): its ghosts and boundary stencil reach 2, a
-- recentring 1 more, and the region is placed from the nest position one exchange old
NestRemote.MARGIN = 5
-- and around the storm centre, where Nest.place looks for the circulation (8 cells, plus the
-- 3x3 smoothing and the vorticity stencil); the centre is snapped to 4 cells so the region
-- rarely moves
NestRemote.STORM_R = 13
-- how far the box moves toward the nest's averages each step (1: takes them, as one process does)
NestRemote.GAIN = 1

export type Rect = { i1: number, i2: number, j1: number, j2: number }

-- The region the nest process needs: box cells i1..i2, j1..j2 (ghosts allowed), all levels.
function NestRemote.region(m: any, i0: number, j0: number, stormI: number?, stormJ: number?): Rect
	local w = NestRemote.NX // NestRemote.RATIO
	local mg = NestRemote.MARGIN
	local i1, i2, j1, j2 = i0 - mg, i0 + w - 1 + mg, j0 - mg, j0 + w - 1 + mg
	if stormI and stormJ then
		local R = NestRemote.STORM_R
		local ci, cj = 4 * (stormI // 4) + 2, 4 * (stormJ // 4) + 2
		i1, i2 = math.min(i1, ci - R), math.max(i2, ci + R)
		j1, j2 = math.min(j1, cj - R), math.max(j2, cj + R)
	end
	return { i1 = math.max(-1, i1), i2 = math.min(m.nx + 2, i2), j1 = math.max(-1, j1), j2 = math.min(m.ny + 2, j2) }
end

function NestRemote.sameRect(a: Rect?, b: Rect?): boolean
	return a ~= nil and b ~= nil and a.i1 == b.i1 and a.i2 == b.i2 and a.j1 == b.j1 and a.j2 == b.j2
end

-- the model's prognostic fields over a region, exactly (f64), all levels -1..nz+3
function NestRemote.packRegion(m: any, r: Rect): buffer
	local nz, SX, SXY = m.nz, m.SX, m.SXY
	local ni, nj = r.i2 - r.i1 + 1, r.j2 - r.j1 + 1
	local b = buffer.create(8 + #PROG * ni * nj * (nz + 5) * 8)
	buffer.writei16(b, 0, r.i1)
	buffer.writei16(b, 2, r.i2)
	buffer.writei16(b, 4, r.j1)
	buffer.writei16(b, 6, r.j2)
	local o = 8
	for _, name in PROG do
		local f = m[name]
		for k = -1, nz + 3 do
			for j = r.j1, r.j2 do
				local base = 2 + (j + 1) * SX + (k + 1) * SXY
				for i = r.i1, r.i2 do
					buffer.writef64(b, o, f[base + i])
					o += 8
				end
			end
		end
	end
	return b
end

-- writes a packed region into the model's fields (or into `into`, a table of fields by name)
function NestRemote.unpackRegion(m: any, b: buffer, into: any?): Rect
	local nz, SX, SXY = m.nz, m.SX, m.SXY
	local r = { i1 = buffer.readi16(b, 0), i2 = buffer.readi16(b, 2), j1 = buffer.readi16(b, 4), j2 = buffer.readi16(b, 6) }
	local dst = into or m
	local o = 8
	for _, name in PROG do
		local f = dst[name]
		for k = -1, nz + 3 do
			for j = r.j1, r.j2 do
				local base = 2 + (j + 1) * SX + (k + 1) * SXY
				for i = r.i1, r.i2 do
					f[base + i] = buffer.readf64(b, o)
					o += 8
				end
			end
		end
	end
	return r
end

local function copyRegion(m: any, r: Rect, dst: any)
	local nz, SX, SXY = m.nz, m.SX, m.SXY
	for _, name in PROG do
		local f, g = m[name], dst[name]
		for k = -1, nz + 3 do
			for j = r.j1, r.j2 do
				local base = 2 + (j + 1) * SX + (k + 1) * SXY
				for i = r.i1, r.i2 do
					g[base + i] = f[base + i]
				end
			end
		end
	end
end

-- (JSON has no infinity: a lift that never ends carries t1 = 1e300)
local function plainDrive(d: any): any
	if not d then
		return nil
	end
	local c = table.clone(d)
	if c.t1 == math.huge then
		c.t1 = 1e300
	end
	return c
end

local function levels(t: { number }, nz: number): { number }
	return table.move(t, 1, nz, 1, table.create(nz, 0))
end

---------------------------------------------------------------------------------------------------
-- The box's side

-- the message that starts the nest at box cell (i0, j0): the box's base state and its region now
function NestRemote.createMessage(m: any, i0: number, j0: number): (any, buffer, Rect)
	local r = NestRemote.region(m, i0, j0, m.stormI, m.stormJ)
	local nz = m.nz
	local meta = {
		i0 = i0, j0 = j0, time = m.time, psfc = m.psfc, umove = m.umove, vmove = m.vmove, ox = m.ox, oy = m.oy,
		th0 = levels(m.th0, nz), qv0 = levels(m.qv0, nz), u0 = levels(m.u0, nz), v0 = levels(m.v0, nz),
	}
	return meta, NestRemote.packRegion(m, r), r
end

-- the steering the nest takes from the box after its step (one-process Nest.advance: child.env,
-- cpRate, drive, drive2 = the parent's), with the box's motion, shifts and storm centre
function NestRemote.stepMeta(m: any, di: number, dj: number): any
	return {
		di = di, dj = dj, time = m.time, umove = m.umove, vmove = m.vmove, ox = m.ox, oy = m.oy,
		stormI = m.stormI, stormJ = m.stormJ, cpRate = m.cpRate, env = m.env,
		drive = plainDrive(m.drive), drive2 = plainDrive(m.drive2),
	}
end

-- moves the box's cells over the nest toward the nest's averages (a reply), placed by the box's
-- shift (di, dj) since they were taken and with u, v put in the box's current frame
function NestRemote.applyCorrection(m: any, reply: any, delta: buffer, di: number, dj: number)
	local nz, SX, SXY = m.nz, m.SX, m.SXY
	local I1, I2, J1, J2 = reply.I1, reply.I2, reply.J1, reply.J2
	local o = 0
	local jumps = {}
	m.feedJump = jumps -- (the largest correction to each field: a check)
	for _, name in FEED do
		local f = m[name]
		local jmax = 0
		local k0 = if CloudModel.KINDS[name] == 3 then 2 else 1
		-- (a frame motion change since: setMotion takes it off every u and v)
		local frame = if name == "u" then m.umove - reply.umove elseif name == "v" then m.vmove - reply.vmove else 0
		for k = k0, nz do
			for J = J1, J2 do
				local jj = J - dj
				for I = I1, I2 do
					local ii = I - di
					local target = buffer.readf64(delta, o) - frame
					o += 8
					if ii >= 1 and ii <= m.nx and jj >= 1 and jj <= m.ny then
						local n = (ii + 2) + (jj + 1) * SX + (k + 1) * SXY
						local d = NestRemote.GAIN * (target - f[n])
						if math.abs(d) > jmax then
							jmax = math.abs(d)
						end
						f[n] += d
					end
				end
			end
		end
		jumps[name] = jmax
	end
	m:fill()
end

---------------------------------------------------------------------------------------------------
-- The nest's side: `mirror` is a model built like the box (EngineRun.new with the same record
-- and options), holding the box's region; it is never stepped.

function NestRemote.helper(mirror: any): any
	return { mirror = mirror, nest = nil, rect = nil }
end

function NestRemote.create(h: any, meta: any, region: buffer)
	local m = h.mirror
	local nz = m.nz
	for k = 1, nz do
		m.th0[k], m.qv0[k], m.u0[k], m.v0[k] = meta.th0[k], meta.qv0[k], meta.u0[k], meta.v0[k]
	end
	m.psfc = meta.psfc
	CloudModel.hydrostatic(m)
	m.umove, m.vmove = meta.umove, meta.vmove
	m.ox, m.oy, m.time = meta.ox, meta.oy, meta.time
	h.rect = NestRemote.unpackRegion(m, region)
	h.nest = Nest.new(m, { nx = NestRemote.NX, ny = NestRemote.NX, ratio = NestRemote.RATIO, steps = NestRemote.STEPS, i0 = meta.i0, j0 = meta.j0 })
end

-- Nest steps across one box step. old: the box's region at the start of the step if the box shifted
-- or the region moved (else the mirror has it already); new: the region after the step.
-- Returns the reply (nest position, the box cells fed back, the frame motion, diagnostics), the
-- nest's averages over those cells (nil without feedback) and the nest's frame section.
function NestRemote.step(h: any, meta: any, old: buffer?, new: buffer): (any, buffer, buffer)
	local m, nest = h.mirror, h.nest
	-- the box's motion change between steps (EngineRun.update; it reaches the nest through
	-- setMotion's recursion, as in one process)
	if meta.umove ~= m.umove or meta.vmove ~= m.vmove then
		CloudModel.setMotion(m, meta.umove, meta.vmove)
	end
	if old then
		h.rect = NestRemote.unpackRegion(m, old)
	end
	m.ox, m.oy, m.stormI, m.stormJ = meta.ox, meta.oy, meta.stormI, meta.stormJ
	if meta.di ~= 0 or meta.dj ~= 0 then
		Nest.shiftBy(nest, meta.di, meta.dj, nest.ratio)
	end
	-- the box at the start of its step (the boundary's old state), then after it
	copyRegion(m, h.rect, nest.pOld)
	h.rect = NestRemote.unpackRegion(m, new)
	m.time = meta.time
	local env = meta.env
	m.env, m.cpRate, m.drive, m.drive2 = env, meta.cpRate, meta.drive, meta.drive2
	nest.env, nest.cpRate, nest.drive, nest.drive2 = env, meta.cpRate, meta.drive, meta.drive2
	for s = 1, nest.steps do
		nest.bcA = s / nest.steps
		Nest.advance(nest)
	end
	-- feedback onto the mirror (its recentring sees it, as in one process), and the averages
	local r = nest.ratio
	local mg = Nest.FEED_MARGIN
	local I1, I2 = nest.i0 + mg, nest.i0 + nest.nx // r - mg - 1
	local J1, J2 = nest.j0 + mg, nest.j0 + nest.ny // r - mg - 1
	local nz, SX, SXY = m.nz, m.SX, m.SXY
	local averages: buffer? = nil
	if nest.feedback then
		Nest.feed(m, nest)
		local count = 0
		for _, name in FEED do
			local k0 = if CloudModel.KINDS[name] == 3 then 2 else 1
			count += (nz - k0 + 1) * (I2 - I1 + 1) * (J2 - J1 + 1)
		end
		local b = buffer.create(count * 8)
		local o = 0
		for _, name in FEED do
			local f = m[name]
			local k0 = if CloudModel.KINDS[name] == 3 then 2 else 1
			for k = k0, nz do
				for J = J1, J2 do
					for I = I1, I2 do
						buffer.writef64(b, o, f[(I + 2) + (J + 1) * SX + (k + 1) * SXY])
						o += 8
					end
				end
			end
		end
		averages = b
	end
	if math.floor(nest.time / 60) ~= math.floor((nest.time - m.dt) / 60) then
		Nest.recentre(m, nest)
	end
	local reply = { i0 = nest.i0, j0 = nest.j0, I1 = I1, I2 = I2, J1 = J1, J2 = J2, umove = m.umove, vmove = m.vmove, time = nest.time, diag = Nest.diag(nest) }
	return reply, averages :: any, FrameCodec.encodeNest(nest)
end

return NestRemote
