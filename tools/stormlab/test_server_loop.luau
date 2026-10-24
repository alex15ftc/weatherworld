-- The server's frame loop offline: stepFast every frame, stepSlow in a coroutine with a budget.
local Json = require("../../roblox/src/stormlab/shared/Sim/Json")
local World = require("../../roblox/src/stormlab/shared/Sim/World")
local data = Json.decode(require("../../roblox/src/stormlab/data/Supercell"))
local world = World.new(data)
world:spinUp(600)
local budget, deadline = 0.006, 0
local function yieldFn() if os.clock() > deadline then coroutine.yield() end end
local thread, pending = nil, 0
local worst, total, frames, slowCalls = 0, 0, 0, 0
local timeScale = tonumber(({ ... })[1]) or 10
for f = 1, 60 * 60 do -- 60 s of frames at 60 fps
	local dt = 1 / 60
	local t0 = os.clock()
	local simDt = dt * timeScale
	world:stepFast(simDt)
	pending += simDt
	deadline = os.clock() + budget
	world.yieldFn = yieldFn
	if not thread and pending > 0 then
		local d = pending
		pending = 0
		thread = coroutine.create(function() world:stepSlow(d) end)
		slowCalls += 1
	end
	if thread then
		local ok, err = coroutine.resume(thread)
		if not ok then error(err) end
		if coroutine.status(thread) == "dead" then thread = nil end
	end
	world.yieldFn = nil
	local ms = (os.clock() - t0) * 1000
	worst = math.max(worst, ms); total += ms; frames += 1
end
print(string.format("time scale %dx: %.0f sim s in 60 s of frames; mean %.2f ms/frame, worst %.1f ms; %d slow steps (mean %.1f sim s each); tornadoes %d; storms %d; parcels %d",
	timeScale, world.time, total / frames, worst, slowCalls, world.time / slowCalls, #world.tornadoes, #world.storms, world.precip.n))
