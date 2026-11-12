--!strict
-- The chaser network of this server: every LIVE_SECONDS each player's character root is sampled
-- (on foot, in a car or flying, the root part carries the character) and its map point sent to
-- every ready client; every TRAIL_TICKS samples the point is also kept in the player's trail,
-- which holds about the last world day (TRAIL_KEEP_SECONDS of real time at the 8x clock). A
-- client that says it is ready (ChaserNet.Ready) gets every trail in full once; after that only
-- the new points (Shared/Net/ChaserNet has the message layout). Streaming keeps far characters
-- off a client, so the map's Chasers layer needs these positions from here.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local ServerStorage = game:GetService("ServerStorage")

local Shared = ReplicatedStorage.Shared
local Trove = require(Shared.Trove)
local ChaserNet = require(Shared.Net.ChaserNet)
local WorldMap = require(ServerStorage.World.WorldMap)

local ChaserNetService = {}

local LIVE_SECONDS = 3
local TRAIL_TICKS = 8 -- a trail point every 24 s
local TRAIL_KEEP_SECONDS = 3 * 3600 -- one world day (8x clock)
local TRAIL_MAX = math.ceil(TRAIL_KEEP_SECONDS / (LIVE_SECONDS * TRAIL_TICKS)) + 2
-- Faster than the quickest flight (3000 studs a second, 5 miles) is a teleport: the trail breaks.
local JUMP_MILES_PER_SECOND = 6
-- A client may ask for the full trails again (a reconnecting listener) at most this often.
local READY_COOLDOWN_SECONDS = 5

local UNITS = ChaserNet.UNITS_PER_MILE
local POINT_BYTES = ChaserNet.TRAIL_POINT_BYTES
local TICK_BYTES = ChaserNet.TICK_PLAYER_BYTES
local FLAG_TRAIL, FLAG_BREAK = ChaserNet.FLAG_TRAIL, ChaserNet.FLAG_BREAK

type Point = { x: number, y: number, t: number, flags: number } -- x, y in map units (u16)
type Chaser = {
	trail: { Point },
	lastX: number?, -- the last sample (map miles) and when it was taken
	lastY: number?,
	lastAt: number,
	breakNext: boolean, -- the next trail point starts a new stretch
}

local chasers: { [Player]: Chaser } = {}
local ready: { [Player]: number } = {} -- player -> when its full trails were last sent
local trove = Trove.new()
local updateServer = ChaserNet.Update:Server() :: any -- (one event, two message shapes)

local function unitsOf(miles: number): number
	return math.clamp(math.round(miles * UNITS), 0, 65535)
end

local function chaserOf(p: Player): Chaser
	local c = chasers[p]
	if not c then
		c = { trail = {}, lastX = nil, lastY = nil, lastAt = 0, breakNext = false }
		chasers[p] = c
	end
	return c
end

-- Every player's trail, packed (ChaserNet "full").
local function fullBuffer(now: number): buffer
	local list: { { userId: number, trail: { Point } } } = {}
	local bytes = 10
	for p, c in chasers do
		if p.Parent then
			table.insert(list, { userId = p.UserId, trail = c.trail })
			bytes += 10 + #c.trail * POINT_BYTES
		end
	end
	local b = buffer.create(bytes)
	buffer.writef64(b, 0, now)
	buffer.writeu16(b, 8, #list)
	local o = 10
	for _, entry in list do
		buffer.writef64(b, o, entry.userId)
		buffer.writeu16(b, o + 8, #entry.trail)
		o += 10
		for _, point in entry.trail do
			buffer.writeu16(b, o, point.x)
			buffer.writeu16(b, o + 2, point.y)
			buffer.writeu32(b, o + 4, point.t)
			buffer.writeu8(b, o + 8, point.flags)
			o += POINT_BYTES
		end
	end
	return b
end

local tickCount = 0

local function sample()
	tickCount += 1
	local addTrail = tickCount % TRAIL_TICKS == 0
	local now = workspace:GetServerTimeNow()
	local wholeNow = math.floor(now)
	local records: { { userId: number, x: number, y: number, heading: number, flags: number } } = {}
	for _, p in Players:GetPlayers() do
		local c = chaserOf(p)
		local character = p.Character
		local root = if character then character:FindFirstChild("HumanoidRootPart") :: BasePart? else nil
		if not root then
			-- (no sample: a gap of a while breaks the trail at the next point)
			if now - c.lastAt > LIVE_SECONDS * TRAIL_TICKS * 2 then
				c.breakNext = true
			end
			continue
		end
		local mx, my = WorldMap.milesAt(root.Position.X, root.Position.Z)
		if c.lastX and c.lastY then
			local dt = math.max(now - c.lastAt, 0.001)
			local miles = math.sqrt((mx - c.lastX) ^ 2 + (my - c.lastY) ^ 2)
			if miles / dt > JUMP_MILES_PER_SECOND or dt > LIVE_SECONDS * TRAIL_TICKS * 2 then
				c.breakNext = true
			end
		end
		c.lastX, c.lastY, c.lastAt = mx, my, now
		local look = root.CFrame.LookVector
		local heading = math.round(math.deg(math.atan2(look.X, -look.Z))) % 360
		local flags = 0
		local x, y = unitsOf(mx), unitsOf(my)
		if addTrail then
			flags = FLAG_TRAIL
			if c.breakNext or #c.trail == 0 then
				flags += FLAG_BREAK
				c.breakNext = false
			end
			table.insert(c.trail, { x = x, y = y, t = wholeNow, flags = flags })
			-- Only about the last world day is kept.
			while #c.trail > TRAIL_MAX or (#c.trail > 0 and wholeNow - c.trail[1].t > TRAIL_KEEP_SECONDS) do
				table.remove(c.trail, 1)
			end
		end
		table.insert(records, { userId = p.UserId, x = x, y = y, heading = heading, flags = flags })
	end
	if #records == 0 then
		return
	end
	local b = buffer.create(10 + #records * TICK_BYTES)
	buffer.writef64(b, 0, now)
	buffer.writeu16(b, 8, #records)
	local o = 10
	for _, r in records do
		buffer.writef64(b, o, r.userId)
		buffer.writeu16(b, o + 8, r.x)
		buffer.writeu16(b, o + 10, r.y)
		buffer.writeu16(b, o + 12, r.heading)
		buffer.writeu8(b, o + 14, r.flags)
		o += TICK_BYTES
	end
	for p in ready do
		if p.Parent then
			updateServer:Fire(p, "tick", b)
		end
	end
end

function ChaserNetService.Init()
	-- (in Init, so a client's Ready is never sent before the server listens)
	ChaserNet.Ready:Server():On(function(p: Player)
		local now = os.clock()
		local last = ready[p]
		if last and now - last < READY_COOLDOWN_SECONDS then
			return
		end
		ready[p] = now
		updateServer:Fire(p, "full", fullBuffer(workspace:GetServerTimeNow()))
	end)
end

function ChaserNetService.Start()
	trove:Connect(Players.PlayerRemoving, function(p: Player)
		chasers[p] = nil
		ready[p] = nil
	end)
	trove:Add(task.spawn(function()
		while true do
			task.wait(LIVE_SECONDS)
			local ok, err = pcall(sample)
			if not ok then
				warn("[ChaserNet] sample failed: " .. tostring(err))
			end
		end
	end))
end

return ChaserNetService
