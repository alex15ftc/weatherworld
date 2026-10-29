-- The lab's two storm modes on a scenario (2026-10-29):
--   own     the engine's state only starts the storms; the lab's dynamics run them (rotation,
--           occlusion and genesis must change over time)
--   engine  the scenario's polls drive them as the game's StormHost does (Sim/EngineFollow): the
--           focus storm must stay on the engine's track and have a tornado when the engine does
--   luau tools/stormlab/test_engine_follow.luau -a Supercell 60
local Json = require("../../roblox/src/stormlab/shared/Sim/Json")
local World = require("../../roblox/src/stormlab/shared/Sim/World")
local EngineFollow = require("../../roblox/src/stormlab/shared/Sim/EngineFollow")
local Storm = require("../../roblox/src/stormlab/shared/Sim/Storm")
local args = { ... }
local name = args[1] or "Supercell"
local minutes = tonumber(args[2]) or 60
local scen = name == "SquallLine" and require("../../roblox/src/stormlab/data/SquallLine") or require("../../roblox/src/stormlab/data/Supercell")
local data = Json.decode(scen)
assert(data.polls and #data.polls > 0, "scenario has no polls: re-export it")
local SPIN = 600
local fails = 0
local function check(ok: boolean, msg: string)
	print((if ok then "  ok   " else "  FAIL ") .. msg)
	if not ok then
		fails += 1
	end
end

local function focusOf(w)
	for _, s in w.storms do
		if s.engineId == data.meta.focusStorm then
			return s
		end
	end
	return nil
end

-- own dynamics
do
	print("own dynamics:")
	local w = World.new(data)
	w:spinUp(SPIN)
	local f = focusOf(w)
	check(f ~= nil and f.eng == nil, "scenario storms are not engine-driven")
	local v0, W0 = f.vmid, f.W
	for _ = 1, 20 * 60 do
		w:step(1)
	end
	check(math.abs(f.vmid - v0) > 0.05 or math.abs(f.W - W0) > 0.05, string.format("focus rotation/updraft evolve (vmid %.1f -> %.1f, W %.0f -> %.0f)", v0, f.vmid, W0, f.W))
end

-- engine-driven
do
	print("engine-driven:")
	local w = World.new(data, { followEngine = true })
	local fol = EngineFollow.new()
	EngineFollow.beforeSpinUp(w, SPIN, false)
	w:spinUp(SPIN)
	EngineFollow.afterSpinUp(fol, w, data, 0, false)
	EngineFollow.startTornadoes(w, data.storms)
	local f = focusOf(w)
	check(f ~= nil and f.eng ~= nil, "scenario storms are engine-driven")
	local nextPoll, worst, worstTor, torAgree, torPolls, lastTor = 1, 0, 0, 0, 0, -1e9
	for m = 1, minutes do
		for _ = 1, 60 do
			while nextPoll <= #data.polls and w.time >= data.polls[nextPoll].min * 60 do
				local p = data.polls[nextPoll]
				EngineFollow.apply(fol, w, p.storms, p.simHourUtc, false)
				nextPoll += 1
			end
			w:step(1)
		end
		if m % 5 == 0 then
			local e
			for _, p in data.polls do
				if p.min == m then
					for _, es in p.storms do
						if es.id == data.meta.focusStorm then
							e = es
						end
					end
				end
			end
			if e and f and not f.dead then
				-- (the engine's position is its mesocyclone, and its tornado is near it: the lab's
				-- low-level circulation must sit on the tornado, or on the mesocyclone without one)
				local lx, ly = Storm.lowMesoAt(f)
				local tp = if e.tornado then e.tornado.pos else e.pos
				local d = math.sqrt((lx - tp[1]) ^ 2 + (ly - tp[2]) ^ 2)
				local dTor = math.sqrt((tp[1] - e.pos[1]) ^ 2 + (tp[2] - e.pos[2]) ^ 2)
				-- (while the engine has a tornado the storm is shifted so its low-level circulation sits
				-- over it: Storm.followEngine; measured apart, as the engine puts its tornado 4-9 km out)
				-- (and for 10 min after, while that shift glides back)
				worst = math.max(worst, d)
				worstTor = math.max(worstTor, dTor)
				local labTor = f.tornado ~= nil
				torPolls += 1
				if labTor == (e.tornado ~= nil) then
					torAgree += 1
				end
				print(string.format("    t+%3d  circulation %.2f km off  W %.0f vmid %.1f vlow %.1f occl %.2f  engine tor %s  lab tor %s",
					m, d / 1000, f.W, f.vmid, f.vlow, f.occl, if e.tornado then e.tornado.mph .. " mph" else "-", tostring(labTor)))
			end
		end
	end
	-- (the storm shifts up to a few km so its low-level circulation sits over the engine's tornado)
	-- (a new tornado or a lifted one moves the target, and the engine starts a tornado where the wall
	-- cloud was a step - up to ~3 km - back; the storm glides over ~4 sim min)
	check(worst < 3500, string.format("the lab's circulation stays on the engine's mesocyclone / tornado (worst %.1f km)", worst / 1000))
	check(worstTor < 6000, string.format("the engine's tornado stays near its mesocyclone (worst %.1f km)", worstTor / 1000))
	-- (a sample can fall between a poll and its tornado starting, and a lab tornado winds down
	-- after the engine's lifts: allow two updates of lag)
	check(torPolls == 0 or torAgree >= torPolls - 2, string.format("tornado on/off agrees with the engine (%d of %d updates)", torAgree, torPolls))
end
print(if fails == 0 then "all passed" else fails .. " failed")
