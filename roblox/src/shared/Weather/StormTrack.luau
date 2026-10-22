--!strict
-- The storm frames the weather server sends (server/GameFeed.js on the Node side), and the
-- storms as they are at any moment between them.
--
-- Each frame is the storms at one engine tick, with atMs: the moment (on the weather server's
-- clock) it is shown. The game's clock runs behind the engine, so the frame after "now" is
-- normally already here, and a storm is moved between two known places, never guessed ahead:
--   - the storm's centre follows a cubic (Hermite) curve through both places with the storm's
--     velocity at each, so its track bends smoothly from tick to tick;
--   - its parts (updraught, wall cloud, rain, tornado ...) keep their place relative to the
--     centre, which is blended between the frames, and every other number is blended too;
--   - a storm in only the later frame fades in, one in only the earlier fades out;
--   - a tornado in only the later frame is touching down during the interval (touch rises 0 to
--     1: the funnel lowers from the cloud), one in only the earlier is lifting (touch falls).
-- After the last frame the storms are held where they are (the feed is late or down).
--
-- Frame and storm fields are as js/storms/StormAppearance.js writes them: km east (xKm) and
-- south (yKm) of the map's north-west corner, heights in metres, bearings in degrees.

local StormTrack = {}
StormTrack.__index = StormTrack

export type Frame = { seq: number, atMs: number, simHourUtc: number, storms: { any } }
export type Track = typeof(setmetatable({} :: { frames: { Frame }, epoch: number? }, StormTrack))

local KEEP = 16

function StormTrack.new(): Track
	return setmetatable({ frames = {}, epoch = nil }, StormTrack)
end

-- Adds frames from the feed. `reset` (or a new epoch: a new world, or a jump) drops what is held.
function StormTrack.add(self: Track, frames: { Frame }, reset: boolean?, epoch: number?)
	if reset or (epoch ~= nil and epoch ~= self.epoch) then
		table.clear(self.frames)
		self.epoch = epoch
	end
	for _, frame in frames do
		local last = self.frames[#self.frames]
		if not last or frame.seq > last.seq then
			table.insert(self.frames, frame)
		end
	end
	while #self.frames > KEEP do
		table.remove(self.frames, 1)
	end
end

-- Blends every number in a and b (tables recursively); strings and booleans come from the
-- nearer frame. Keys ending xKm / yKm are positions: blended as offsets from each storm's centre.
local function blend(a: any, b: any, u: number, aOrigin: { x: number, y: number }, bOrigin: { x: number, y: number }, origin: { x: number, y: number }): any
	-- On one side only: a copy (never the frame's own table), moved with the centre.
	if a == nil then
		return if type(b) == "table" then blend(b, b, 0, bOrigin, bOrigin, origin) else b
	elseif b == nil then
		return if type(a) == "table" then blend(a, a, 0, aOrigin, aOrigin, origin) else a
	end
	local kind = type(a)
	if kind == "number" and type(b) == "number" then
		return a + (b - a) * u
	elseif kind ~= "table" or type(b) ~= "table" then
		return if u < 0.5 then a else b
	end
	local out = {}
	for key, value in a do
		local other = b[key]
		if key == "xKm" and type(value) == "number" and type(other) == "number" then
			out[key] = origin.x + (value - aOrigin.x) + ((other - bOrigin.x) - (value - aOrigin.x)) * u
		elseif key == "yKm" and type(value) == "number" and type(other) == "number" then
			out[key] = origin.y + (value - aOrigin.y) + ((other - bOrigin.y) - (value - aOrigin.y)) * u
		else
			out[key] = blend(value, other, u, aOrigin, bOrigin, origin)
		end
	end
	for key, value in b do
		if out[key] == nil and a[key] == nil then
			out[key] = blend(nil, value, u, aOrigin, bOrigin, origin)
		end
	end
	return out
end

-- Where a storm's centre is u of the way between frames dtMs apart (Hermite, velocities in km/h).
local function hermite(a: any, b: any, u: number, dtMs: number): (number, number)
	local hours = dtMs / 3600000
	local u2, u3 = u * u, u * u * u
	local h00, h10, h01, h11 = 2 * u3 - 3 * u2 + 1, u3 - 2 * u2 + u, -2 * u3 + 3 * u2, u3 - u2
	-- y runs south, so a northward velocity lowers it.
	local x = h00 * a.xKm + h10 * hours * a.eastKph + h01 * b.xKm + h11 * hours * b.eastKph
	local y = h00 * a.yKm - h10 * hours * a.northKph + h01 * b.yKm - h11 * hours * b.northKph
	return x, y
end

-- A storm moved by its own velocity over ms (for one that is fading in or out).
local function carried(storm: any, ms: number): any
	local hours = ms / 3600000
	local dx, dy = storm.eastKph * hours, -storm.northKph * hours
	local origin = { x = storm.xKm, y = storm.yKm }
	return blend(storm, storm, 0, origin, origin, { x = storm.xKm + dx, y = storm.yKm + dy })
end

-- The storms at nowMs (weather server clock): a list of storm tables, each with `alpha` (0-1,
-- how far it has faded in) and, with a tornado, tornado.touch (0-1, how far it is down).
-- Also returns the simulated hour (UTC) and whether the feed has run out (held at its last frame).
function StormTrack.sample(self: Track, nowMs: number): ({ any }, number?, boolean)
	local frames = self.frames
	local n = #frames
	if n == 0 then
		return {}, nil, true
	end
	local a, b = frames[1], frames[1]
	if nowMs >= frames[n].atMs then
		a, b = frames[n], frames[n]
	elseif nowMs > frames[1].atMs then
		for i = 1, n - 1 do
			if nowMs < frames[i + 1].atMs then
				a, b = frames[i], frames[i + 1]
				break
			end
		end
	end
	local dtMs = b.atMs - a.atMs
	local u = if dtMs > 0 then math.clamp((nowMs - a.atMs) / dtMs, 0, 1) else 0
	local hour = a.simHourUtc + (b.simHourUtc - a.simHourUtc) * u
	local stale = nowMs >= frames[n].atMs

	local inB: { [string]: any } = {}
	for _, storm in b.storms do
		inB[storm.id] = storm
	end
	local out = {}
	local seen: { [string]: boolean } = {}
	for _, sa in a.storms do
		local sb = inB[sa.id]
		seen[sa.id] = true
		local storm
		if sb and a ~= b then
			local x, y = hermite(sa, sb, u, dtMs)
			storm = blend(sa, sb, u, { x = sa.xKm, y = sa.yKm }, { x = sb.xKm, y = sb.yKm }, { x = x, y = y })
			storm.xKm, storm.yKm = x, y
			storm.alpha = 1
			local ta, tb = sa.tornado, sb.tornado
			if ta and tb and ta.id ~= tb.id then
				-- One tornado ended and the next began within the step: show the new one coming down.
				storm.tornado = blend(tb, tb, 0, { x = sb.xKm, y = sb.yKm }, { x = sb.xKm, y = sb.yKm }, { x = x, y = y })
				storm.tornado.touch = u
			elseif storm.tornado then
				storm.tornado.touch = if ta and tb then 1 elseif tb then u else 1 - u
				if not tb then
					storm.tornado.decay = math.max(storm.tornado.decay, u)
				end
			end
		elseif sb then
			-- a == b: held at the last frame.
			storm = blend(sa, sa, 0, { x = sa.xKm, y = sa.yKm }, { x = sa.xKm, y = sa.yKm }, { x = sa.xKm, y = sa.yKm })
			storm.alpha = 1
			if storm.tornado then
				storm.tornado.touch = 1
			end
		else
			-- Gone by the next frame (it died or merged): it fades out where its motion takes it.
			storm = carried(sa, nowMs - a.atMs)
			storm.alpha = if a == b then 1 else 1 - u
			if storm.tornado then
				storm.tornado.touch = storm.alpha
			end
		end
		table.insert(out, storm)
	end
	if a ~= b then
		for _, sb in b.storms do
			if not seen[sb.id] then
				local storm = carried(sb, nowMs - b.atMs)
				storm.alpha = u
				if storm.tornado then
					storm.tornado.touch = u
				end
				table.insert(out, storm)
			end
		end
	end
	return out, hour, stale
end

local SKY_FIELDS = { "low", "mid", "high", "tF", "tdF", "windKt", "soil" }

-- One frame's sky (js/world/SkyAppearance.js) at a place, between its grid points.
local function skyPoint(sky: any, xKm: number, yKm: number): { [string]: number }
	local fx = math.clamp(xKm / sky.cellKm - 0.5, 0, sky.cols - 1)
	local fy = math.clamp(yKm / sky.cellKm - 0.5, 0, sky.rows - 1)
	local i0, j0 = math.floor(fx), math.floor(fy)
	local i1, j1 = math.min(i0 + 1, sky.cols - 1), math.min(j0 + 1, sky.rows - 1)
	local u, v = fx - i0, fy - j0
	local out = {}
	for _, f in SKY_FIELDS do
		local g = sky[f]
		local function at(i: number, j: number): number
			return g[j * sky.cols + i + 1] or 0
		end
		out[f] = (at(i0, j0) * (1 - u) + at(i1, j0) * u) * (1 - v) + (at(i0, j1) * (1 - u) + at(i1, j1) * u) * v
	end
	return out
end

-- The sky at nowMs over a place (km east and south of the map's NW corner), blended between the
-- frames either side: cloud shares 0-1 (low, mid, high), temperature and dewpoint (F), wind (kt),
-- soil moisture 0-1; and `sun`, the map's latitude and day. Nil when no frame carries a sky.
function StormTrack.skyAt(self: Track, nowMs: number, xKm: number, yKm: number): any
	local a, b = nil, nil
	for _, frame in self.frames do
		local sky = (frame :: any).sky
		if sky then
			if frame.atMs <= nowMs then
				a = frame
			else
				b = frame
				break
			end
		end
	end
	a = a or b
	b = b or a
	if not a then
		return nil
	end
	local pa = skyPoint((a :: any).sky, xKm, yKm)
	local pb = if b == a then pa else skyPoint((b :: any).sky, xKm, yKm)
	local dt = b.atMs - a.atMs
	local u = if dt > 0 then math.clamp((nowMs - a.atMs) / dt, 0, 1) else 0
	local out: any = { sun = (a :: any).sky.sun }
	for _, f in SKY_FIELDS do
		out[f] = pa[f] + (pb[f] - pa[f]) * u
	end
	out.low, out.mid, out.high, out.soil = out.low / 100, out.mid / 100, out.high / 100, out.soil / 100
	return out
end

return StormTrack
