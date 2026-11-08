--!strict
-- The bundle of detailed storms' frames the engine serves at /api/game/v1/storm/frames
-- (js/game/StormWorkers.js frames()): the Roblox server asks for what is newer than it holds
-- (?have=<StormFrames.have(held)>), keeps the full frames for itself (FrameCodec.luau) and passes
-- the near or far client frame (ClientFrame.luau) to each player by distance. Every frame in it
-- is Zstd-compressed.
--
-- Layout (little-endian): u8 version (1 or 2), u16 count, then per storm: u8 id length, id, u32
-- seq, u8 flags (bit 0 ended, bit 1 has its nest), then u32 length + bytes for the full, near and
-- far frames (0: not asked for); then u16 count of every storm shown in detail now, each u8
-- length + id, and in version 2 also u8 flags (bit 0 warming up), f32 x, y (map km, y south, as
-- of the engine's storm tick), f32 east, north motion (m/s); version 2 ends with f64 the tick's
-- sim hour and u8 1 if the engine's clock is paused. Version 3 adds, after each shown storm's
-- motion, f32 its flashes a minute (sim time), the share reaching the ground and the share of
-- those that are positive (js/storms/Lightning.js; zeros for a cloud model worker's storm).
-- Version 4 adds, after those, u8 look flags (bit 0 a look record follows, bit 1 a left mover)
-- and with bit 0 the look record, LOOK_FIELDS f32 (js/game/StormWorkers.js lookOf): the storm's
-- position (map km, y south: its low-level mesocyclone), updraught m/s, mesocyclone strength,
-- low-level rotation, occlusion, age (min), updraught radius km, anvil length km and bearing deg,
-- intensity, tornado mph (0 none) - what a client builds its drawn storm from (client/FrameWorld).
-- Version 5: the look record also has the cloud base (m) and the wall cloud's lowering (m).
-- Version 4 also ends with f64 the storm tick's wall-clock time (Unix ms), after the paused byte.
local StormFrames = {}

local LOOK_FIELDS = { [4] = 12, [5] = 14 }
export type Look = { xKm: number, yKm: number, updraftMs: number, meso: number, lowRotation: number, occlusion: number, ageMin: number, radiusKm: number, anvilKm: number, anvilDeg: number, intensity: number, tornadoMph: number, baseM: number?, loweringM: number?, leftMover: boolean }

export type Entry = { seq: number, ended: boolean, nest: boolean, full: buffer?, near: buffer?, far: buffer? }
export type Where = { xKm: number, yKm: number, ue: number, ve: number, warming: boolean, flashesPerMin: number, groundShare: number, positiveShare: number, look: Look? }
export type Bundle = { frames: { [string]: Entry }, live: { string }, where: { [string]: Where }, tickHour: number?, paused: boolean, tickAtMs: number? }

local function sub(b: buffer, o: number, n: number): buffer
	local out = buffer.create(n)
	buffer.copy(out, 0, b, o, n)
	return out
end

function StormFrames.parse(b: buffer): Bundle
	local version = buffer.readu8(b, 0)
	assert(version >= 1 and version <= 5, "storm frames version")
	local o, frames, live, where = 1, {}, {}, {}
	local count = buffer.readu16(b, o); o += 2
	for _ = 1, count do
		local idLen = buffer.readu8(b, o); o += 1
		local id = buffer.readstring(b, o, idLen); o += idLen
		local seq = buffer.readu32(b, o); o += 4
		local flags = buffer.readu8(b, o); o += 1
		local parts = {}
		for k = 1, 3 do
			local n = buffer.readu32(b, o); o += 4
			parts[k] = if n > 0 then sub(b, o, n) else nil
			o += n
		end
		frames[id] = { seq = seq, ended = bit32.btest(flags, 1), nest = bit32.btest(flags, 2), full = parts[1], near = parts[2], far = parts[3] }
	end
	local nLive = buffer.readu16(b, o); o += 2
	for _ = 1, nLive do
		local idLen = buffer.readu8(b, o); o += 1
		local id = buffer.readstring(b, o, idLen); o += idLen
		table.insert(live, id)
		if version >= 2 then
			local flags = buffer.readu8(b, o)
			local w: Where = { warming = bit32.btest(flags, 1), xKm = buffer.readf32(b, o + 1), yKm = buffer.readf32(b, o + 5), ue = buffer.readf32(b, o + 9), ve = buffer.readf32(b, o + 13), flashesPerMin = 0, groundShare = 0, positiveShare = 0 }
			o += 17
			if version >= 3 then
				w.flashesPerMin, w.groundShare, w.positiveShare = buffer.readf32(b, o), buffer.readf32(b, o + 4), buffer.readf32(b, o + 8)
				o += 12
			end
			if version >= 4 then
				local lf = buffer.readu8(b, o); o += 1
				if bit32.btest(lf, 1) then
					local nf = LOOK_FIELDS[version] or LOOK_FIELDS[5]
					local v = table.create(nf, 0)
					for k = 1, nf do v[k] = buffer.readf32(b, o + 4 * (k - 1)) end
					o += 4 * nf
					w.look = { xKm = v[1], yKm = v[2], updraftMs = v[3], meso = v[4], lowRotation = v[5], occlusion = v[6], ageMin = v[7], radiusKm = v[8], anvilKm = v[9], anvilDeg = v[10], intensity = v[11], tornadoMph = v[12], baseM = v[13], loweringM = v[14], leftMover = bit32.btest(lf, 2) }
				end
			end
			where[id] = w
		end
	end
	local tickHour, paused = nil, false
	if version >= 2 then
		tickHour = buffer.readf64(b, o)
		paused = buffer.readu8(b, o + 8) == 1
	end
	local tickAtMs = nil
	if version >= 4 then
		tickAtMs = buffer.readf64(b, o + 9)
	end
	return { frames = frames, live = live, where = where, tickHour = tickHour, paused = paused, tickAtMs = tickAtMs }
end

-- The ?have= text for the frames held (id -> seq).
function StormFrames.have(held: { [string]: number }): string
	local items = {}
	for id, seq in held do table.insert(items, ("%s:%d"):format(id, seq)) end
	return table.concat(items, ",")
end

return StormFrames
