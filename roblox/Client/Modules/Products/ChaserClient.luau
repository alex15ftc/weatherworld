--!strict
-- The chaser network on this client: where every player in this server is and where each has
-- been over about the last world day, as ChaserNetService sends it (Shared/Net/ChaserNet). The
-- map's markers use the positions for players whose characters are not streamed in; the
-- Chasers layer draws the trails.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local ChaserNet = require(ReplicatedStorage.Shared.Net.ChaserNet)

local ChaserClient = {}

-- A position is let go once it is older than this (the player's root has been gone a while).
local STALE_SECONDS = 15
local TRAIL_KEEP_SECONDS = 3 * 3600 -- as the server keeps them
local UNITS = ChaserNet.UNITS_PER_MILE
local POINT_BYTES = ChaserNet.TRAIL_POINT_BYTES
local TICK_BYTES = ChaserNet.TICK_PLAYER_BYTES
local FLAG_TRAIL, FLAG_BREAK = ChaserNet.FLAG_TRAIL, ChaserNet.FLAG_BREAK

-- A trail point: x, y map miles, t server seconds, newStretch: the trail breaks before it.
export type Point = { x: number, y: number, t: number, newStretch: boolean }
type Chaser = { x: number?, y: number?, heading: number, at: number, trail: { Point } }

local chasers: { [number]: Chaser } = {} -- by UserId
local version = 0
local listeners: { () -> () } = {}

local function chaserOf(userId: number): Chaser
	local c = chasers[userId]
	if not c then
		c = { x = nil, y = nil, heading = 0, at = 0, trail = {} }
		chasers[userId] = c
	end
	return c
end

local function changed()
	version += 1
	for _, listener in listeners do
		task.spawn(listener)
	end
end

local function prune(c: Chaser, now: number)
	while #c.trail > 0 and now - c.trail[1].t > TRAIL_KEEP_SECONDS do
		table.remove(c.trail, 1)
	end
end

local function onFull(b: buffer)
	local now = buffer.readf64(b, 0)
	local count = buffer.readu16(b, 8)
	local o = 10
	for _ = 1, count do
		local userId = buffer.readf64(b, o)
		local n = buffer.readu16(b, o + 8)
		o += 10
		local trail: { Point } = table.create(n)
		for k = 1, n do
			local flags = buffer.readu8(b, o + 8)
			trail[k] = {
				x = buffer.readu16(b, o) / UNITS,
				y = buffer.readu16(b, o + 2) / UNITS,
				t = buffer.readu32(b, o + 4),
				newStretch = bit32.band(flags, FLAG_BREAK) ~= 0,
			}
			o += POINT_BYTES
		end
		local c = chaserOf(userId)
		c.trail = trail
		prune(c, now)
	end
	changed()
end

local function onTick(b: buffer)
	local now = buffer.readf64(b, 0)
	local count = buffer.readu16(b, 8)
	local clock = os.clock()
	local added = false
	local o = 10
	for _ = 1, count do
		local c = chaserOf(buffer.readf64(b, o))
		local x, y = buffer.readu16(b, o + 8) / UNITS, buffer.readu16(b, o + 10) / UNITS
		local flags = buffer.readu8(b, o + 14)
		c.x, c.y, c.heading, c.at = x, y, buffer.readu16(b, o + 12), clock
		if bit32.band(flags, FLAG_TRAIL) ~= 0 then
			table.insert(c.trail, { x = x, y = y, t = math.floor(now), newStretch = bit32.band(flags, FLAG_BREAK) ~= 0 })
			prune(c, now)
			added = true
		end
		o += TICK_BYTES
	end
	if added then
		changed()
	end
end

-- (the listener first, then Ready: the full trails are not sent before anyone listens)
ChaserNet.Update:Client():On(function(kind: string, b: buffer)
	if typeof(b) ~= "buffer" then
		return
	end
	local ok, problem = pcall(if kind == "full" then onFull else onTick, b)
	if not ok then
		warn(`[ChaserNet] could not read a {kind} update: {problem}`)
	end
end)
ChaserNet.Ready:Client():Fire()

Players.PlayerRemoving:Connect(function(p: Player)
	if chasers[p.UserId] then
		chasers[p.UserId] = nil
		changed()
	end
end)

-- A player's map point (miles) and heading (degrees clockwise from north) as the server last
-- sent it, if it is recent.
function ChaserClient.position(p: Player): (number?, number?, number?)
	local c = chasers[p.UserId]
	if not c or not c.x or os.clock() - c.at > STALE_SECONDS then
		return nil, nil, nil
	end
	return c.x, c.y, c.heading
end

-- A player's trail, oldest first (empty if none yet). Not to be changed.
function ChaserClient.trail(p: Player): { Point }
	local c = chasers[p.UserId]
	return if c then c.trail else {}
end

-- The server clock (seconds) the trail times are on.
function ChaserClient.now(): number
	return workspace:GetServerTimeNow()
end

function ChaserClient.keepSeconds(): number
	return TRAIL_KEEP_SECONDS
end

-- Changes whenever a trail does (a point added, a player gone, the full trails come in).
function ChaserClient.version(): number
	return version
end

-- Called whenever a trail changes.
function ChaserClient.onChanged(listener: () -> ())
	table.insert(listeners, listener)
end

return ChaserClient
