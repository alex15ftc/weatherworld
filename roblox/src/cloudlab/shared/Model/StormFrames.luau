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
-- sim hour and u8 1 if the engine's clock is paused.
local StormFrames = {}

export type Entry = { seq: number, ended: boolean, nest: boolean, full: buffer?, near: buffer?, far: buffer? }
export type Where = { xKm: number, yKm: number, ue: number, ve: number, warming: boolean }
export type Bundle = { frames: { [string]: Entry }, live: { string }, where: { [string]: Where }, tickHour: number?, paused: boolean }

local function sub(b: buffer, o: number, n: number): buffer
	local out = buffer.create(n)
	buffer.copy(out, 0, b, o, n)
	return out
end

function StormFrames.parse(b: buffer): Bundle
	local version = buffer.readu8(b, 0)
	assert(version == 1 or version == 2, "storm frames version")
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
			where[id] = { warming = bit32.btest(flags, 1), xKm = buffer.readf32(b, o + 1), yKm = buffer.readf32(b, o + 5), ue = buffer.readf32(b, o + 9), ve = buffer.readf32(b, o + 13) }
			o += 17
		end
	end
	local tickHour, paused = nil, false
	if version >= 2 then
		tickHour = buffer.readf64(b, o)
		paused = buffer.readu8(b, o + 8) == 1
	end
	return { frames = frames, live = live, where = where, tickHour = tickHour, paused = paused }
end

-- The ?have= text for the frames held (id -> seq).
function StormFrames.have(held: { [string]: number }): string
	local items = {}
	for id, seq in held do table.insert(items, ("%s:%d"):format(id, seq)) end
	return table.concat(items, ",")
end

return StormFrames
