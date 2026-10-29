--!nonstrict
-- Storms the weather engine drives (2026-10-29: moved here from the game's server/StormHost so the
-- storm lab runs its storms exactly as the game does). An engine storm's position, motion, updraft,
-- size, rotation and occlusion ARE the engine's (Storm.setEngine / followEngine: carried on along
-- the engine's motion between updates, held still while the engine's clock is paused; new engine
-- storms join, gone ones die), and so is its tornado: on the ground, as strong, as wide and where
-- the engine says (Tornado.setEngine). The lab only draws from them (rain, outflow, wall cloud,
-- funnel shape). The lab's own initiation and genesis are off.
--
-- Users: the game's server/StormHost (engine mode: /api/game/v1/lab/window + /lab/storms polls)
-- and the lab server (a scenario's `polls`: the engine's /lab/storms answer every 5 sim minutes,
-- written by scripts/export-lab-scenario.mjs).
--
--   local f = EngineFollow.new()
--   w = World.new(data, { followEngine = true })
--   EngineFollow.beforeSpinUp(w, spin, paused); w:spinUp(spin)
--   EngineFollow.afterSpinUp(f, w, data, late, paused)   -- late: sim s the engine ran on meanwhile
--   (optional: EngineFollow.carryTornadoes(old, w, shiftX, shiftY))
--   EngineFollow.startTornadoes(w, data.storms)
--   every update: EngineFollow.apply(f, w, storms, stampUtc, paused, log)
local function dep(name: string): any
	if script then
		return require((script :: any).Parent:FindFirstChild(name))
	end
	return (require :: any)("./" .. name)
end
local Storm = dep("Storm")
local Tornado = dep("Tornado")

local EngineFollow = {}

function EngineFollow.new(): any
	return { utc0 = nil, lastStamp = nil, stalledPolls = 0, missing = {} }
end

-- Before the spin-up: the engine decides where storms form and when tornadoes touch down. The
-- spin-up runs the storms (and the clock) forward, so they start that far back along the engine's
-- motion and the spun-up world is at the window's time, where the engine's storms are.
function EngineFollow.beforeSpinUp(w: any, spin: number, paused: boolean?)
	w.initiation = false
	w.genesis = false
	for _, s in w.storms do
		if not paused and s.eng then
			s.eng.x -= s.eng.u * spin
			s.eng.y -= s.eng.v * spin
			s.x, s.y = s.eng.x, s.eng.y
		end
	end
	w.env.clockUtc -= spin / 3600
	w.holdStill = paused == true
end

-- After the spin-up (which ends by setting the world's clock back to 0): each engine storm's track
-- is re-anchored where the storm is now, or it would be placed a spin-up's motion back. f.utc0 =
-- the window's UTC hour at world time 0, for matching the engine's later updates. late: sim s the
-- engine ran on while the window was fetched and spun up (the storms and clock catch up).
function EngineFollow.afterSpinUp(f: any, w: any, data: any, late: number?, paused: boolean?)
	for _, s in w.storms do
		if s.eng then
			s.eng.x, s.eng.y = s.x - (s.engOX or 0) - (s.engSX or 0), s.y - (s.engOY or 0) - (s.engSY or 0)
			s.eng.at = w.time
		end
	end
	f.utc0 = data.meta and data.meta.simHourUtc or nil
	f.lastStamp, f.stalledPolls, f.missing = nil, 0, {}
	if f.utc0 and late and late > 0 and not paused then
		for _, s in w.storms do
			if s.eng then
				s.eng.x += s.eng.u * late
				s.eng.y += s.eng.v * late
			end
			s.x += s.u * late
			s.y += s.v * late
		end
		w.env.clockUtc += late / 3600
		f.utc0 += late / 3600
	end
end

-- The engine's tornadoes on the ground at the window's time start at once (not at the first
-- update, a poll later: a short one could be over by then).
function EngineFollow.startTornadoes(w: any, list: { any })
	local byId = {}
	for _, e in list do
		byId[e.id] = e
	end
	for _, s in w.storms do
		local e = byId[s.engineId]
		if e and e.tornado and not s.tornado and s.eng then
			local t = w:forceTornado(s)
			if t then
				-- (where the engine's tornado is now: its window position, carried as the storm was)
				local tp = e.tornado.pos
				local age = w.time - s.eng.at
				local dx, dy = s.eng.x + s.eng.u * age - e.pos[1], s.eng.y + s.eng.v * age - e.pos[2]
				Tornado.setEngine(t, e.tornado, tp[1] + dx, tp[2] + dy, s.eng.u, s.eng.v, w.time, e.pos[1] + dx, e.pos[2] + dy)
			end
		end
	end
end

-- The live tornadoes of a world being replaced, moved into the new one under the same engine
-- storms (a window refresh or move otherwise dropped every tornado on the map and started a new,
-- weak one up to a poll later). shift: m to add (the window's centre moved). Returns how many.
function EngineFollow.carryTornadoes(old: any, w: any, shiftX: number, shiftY: number): number
	local byEngine = {}
	for _, s in w.storms do
		if s.engineId then
			byEngine[s.engineId] = s
		end
	end
	local oldStorm = {}
	for _, s in old.storms do
		oldStorm[s.id] = s
	end
	local n = 0
	for _, t in old.tornadoes do
		local os_ = t.parentKind == "cell" and oldStorm[t.parentId]
		local ns = os_ and os_.engineId and byEngine[os_.engineId]
		if not t.ended and ns and not ns.tornado then
			t.x += shiftX
			t.y += shiftY
			if t.eng then
				-- (its engine track re-anchored where it is now, on the new window's clock)
				t.eng.x, t.eng.y = t.x - t.eng.ox, t.y - t.eng.oy
				t.eng.at = w.time
			end
			t.parentId = ns.id
			ns.tornado = t.id
			table.insert(w.tornadoes, t)
			n += 1
		end
	end
	return n
end

-- Where an engine storm is NOW on the lab's clock: the engine's position is stamped with its storm
-- clock (simHourUtc), which steps 5 sim minutes a tick and is not in phase with the updates, so it
-- is carried on along the engine's motion to the lab's clock (utc0 + world time). Without this the
-- lab chased a position 0-5 sim minutes old (up to ~4.5 km behind).
local function engineLead(f: any, w: any, stampUtc: number?): number
	if not stampUtc or not f.utc0 then
		return 0
	end
	return math.clamp((f.utc0 + w.time / 3600 - stampUtc) * 3600, -900, 900)
end

-- One engine update (the /lab/storms list, lab frame). paused: the engine says its clock is
-- paused (older engines: the same storm stamp 3 updates running): the storms and tornadoes hold
-- still (w.holdStill: Storm.followEngine, Tornado.step, World.parentOf) and still rotate and
-- animate. Storms missing from 2 updates in a row die.
function EngineFollow.apply(f: any, w: any, list: { any }, stampUtc: number?, paused: boolean?, log: ((string, ...any) -> ())?)
	if stampUtc and stampUtc == f.lastStamp then
		f.stalledPolls += 1
	else
		f.stalledPolls = 0
	end
	f.lastStamp = stampUtc
	local stalled = paused == true or f.stalledPolls >= 3
	w.holdStill = stalled
	local lead = if stalled then 0 else engineLead(f, w, stampUtc)
	local byEngine = {}
	for _, s in w.storms do
		if s.engineId then
			byEngine[s.engineId] = s
		end
	end
	local seen = {}
	for _, e in list do
		seen[e.id] = true
		local s = byEngine[e.id]
		-- where the engine's storm is now on the lab's clock
		local ex, ey = e.pos[1] + e.motion[1] * lead, e.pos[2] + e.motion[2] * lead
		if not s and (e.intensity or 0) > 0.15 then
			s = Storm.fromEngine(e, true)
			Storm.setEngine(s, e, ex, ey, w.time)
			s.engOX, s.engOY = 0, 0
			s.x, s.y = ex, ey
			Storm.environment(s, w)
			table.insert(w.storms, s)
			if log then
				log("engine storm %s joins at (%.1f, %.1f) km", e.id, ex / 1000, ey / 1000)
			end
		elseif s and not s.dead then
			-- (2026-10-28: replaces nudging the lab's own physics toward the engine's, which lost - a
			-- capped local sounding held an engine 0.9 supercell at 0.2-0.3 - and dragged storms
			-- back while the engine was paused)
			Storm.setEngine(s, e, ex, ey, w.time)
		end
		if s and not s.dead then
			if e.tornado and not s.tornado then
				w:forceTornado(s)
			end
			local t = nil
			if s.tornado then
				for _, tt in w.tornadoes do
					if tt.id == s.tornado then
						t = tt
					end
				end
			end
			if t then
				local tp = e.tornado and e.tornado.pos or e.pos
				-- (with its mesocyclone now: an occluding tornado revolves round it - e.tornado.orbit)
				Tornado.setEngine(t, e.tornado, tp[1] + e.motion[1] * lead, tp[2] + e.motion[2] * lead, e.motion[1], e.motion[2], w.time, ex, ey)
			end
		end
	end
	for id, s in byEngine do
		if not seen[id] then
			f.missing[id] = (f.missing[id] or 0) + 1
			if f.missing[id] >= 2 and not s.dead then
				s.dead = true
				s.deadFor = 0
			end
		else
			f.missing[id] = nil
		end
	end
end

return EngineFollow
