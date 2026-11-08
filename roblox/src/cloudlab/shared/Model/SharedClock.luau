--!strict
-- The shared clock the storm visuals animate on (2026-11-07): every server and client reads the same
-- time, so the same storm is drawn the same everywhere. Workspace:GetServerTimeNow() is that time,
-- but it steps a little when Roblox re-syncs it, and every spin and drift phase read from it jumped
-- with it (the cards jittered). Here it is the local clock plus an offset eased toward the server's
-- over a few seconds, never running backwards; an offset off by more than a second is taken at once.
-- SharedClock.now() seconds (the server's epoch); SharedClock.day() the same folded into a day, for
-- phases (keeps the numbers small; the fold comes once a day, at 00:00 UTC).
local SharedClock = {}

local EASE_S = 4
local offset: number? = nil
local lastC, lastT = -1, -math.huge

function SharedClock.now(): number
	local c = os.clock()
	if c == lastC then return lastT end
	local want = workspace:GetServerTimeNow() - c
	local cur = offset
	if cur == nil or math.abs(want - cur) > 1 then
		cur = want
	else
		local dt = math.max(0, c - lastC)
		cur += (want - cur) * (1 - math.exp(-dt / EASE_S))
	end
	offset = cur
	local t = c + (cur :: number)
	if t < lastT then t = lastT end
	lastC, lastT = c, t
	return t
end

function SharedClock.day(): number
	return SharedClock.now() % 86400
end

return SharedClock
