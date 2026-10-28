-- The lab radar's view of one storm through its life, offline: every `every` sim minutes, the
-- 0.5 deg reflectivity and storm-relative velocity of a 60 km square round the most strongly
-- rotating storm, from a site 30 km SW of it - with the same Radar.gate the game's radar uses.
-- Prints the frames as hex rows; tools/stormlab/radar_frames.py turns them into PNG sheets.
--   luau --codegen tools/stormlab/render_radar.luau -a <minutes> <every> > frames.txt
local Json = require("../../roblox/src/stormlab/shared/Sim/Json")
local World = require("../../roblox/src/stormlab/shared/Sim/World")
local Storm = require("../../roblox/src/stormlab/shared/Sim/Storm")
local Radar = require("../../roblox/src/stormlab/shared/Sim/Radar")
local args = { ... }
local minutes = tonumber(args[1] or "") or 120
local every = tonumber(args[2] or "") or 10
local data = Json.decode(require("../../roblox/src/stormlab/data/Supercell"))
local world = World.new(data)
world:spinUp(600)
world:step(5)

local N, HALF = 160, 30000 -- pixels, half-width (m)
local function pickStorm(prev: any?): any
	if prev and not prev.dead then
		for _, s in world.storms do
			if s == prev then
				return s
			end
		end
	end
	-- the rotating storm with the most low-level precipitation round it (not one near the
	-- domain's edge, whose rain leaves the field)
	local p = world.precip
	local best, bestN = nil, -1
	for _, s in world.storms do
		if not s.dead and (s.rot or 0) > 0.3 then
			local n = 0
			for i = 1, #p.px do
				if p.alive[i] and p.pz[i] < 1500 and (p.px[i] - s.x) ^ 2 + (p.py[i] - s.y) ^ 2 < 1e8 then
					n += 1
				end
			end
			if n > bestN then
				best, bestN = s, n
			end
		end
	end
	return best
end

local followed = nil
local function frame(tmin: number)
	local s = pickStorm(followed)
	followed = s
	if not s then
		return
	end
	local site = Radar.site(s.x - 21213, s.y - 21213, { seed = 11 })
	local ctx = {
		vol = world.precip,
		tornadoes = world.tornadoes,
		coldPool = world.coldPool,
		freezing = (s.freezing and s.freezing > 500) and s.freezing or 4000,
		wind = function(x: number, y: number, z: number)
			return world:windAt(x, y, z)
		end,
	}
	local su, sv = s.u or 0, s.v or 0
	local refRows, velRows = {}, {}
	for j = N - 1, 0, -1 do
		local rr, vr = {}, {}
		for i = 0, N - 1 do
			local x = s.x - HALF + (i + 0.5) * (2 * HALF / N)
			local y = s.y - HALF + (j + 0.5) * (2 * HALF / N)
			local dx, dy = x - site.x, y - site.y
			local ground = math.sqrt(dx * dx + dy * dy)
			local az = math.deg(math.atan2(dx, dy)) % 360
			local dbz, v = Radar.gate(site, ctx, az, ground, 0.5, math.floor(tmin))
			local r, g, b = 0.04, 0.05, 0.07
			local r2, g2, b2 = 0.04, 0.05, 0.07
			if dbz then
				r, g, b = Radar.refColour(dbz)
				-- storm-relative: minus the storm's motion along the beam
				local ex, ey = dx / ground, dy / ground
				local srv = v - (su * ex + sv * ey)
				r2, g2, b2 = Radar.velColour(srv, 35)
			end
			table.insert(rr, string.format("%02x%02x%02x", math.floor(r * 255), math.floor(g * 255), math.floor(b * 255)))
			table.insert(vr, string.format("%02x%02x%02x", math.floor(r2 * 255), math.floor(g2 * 255), math.floor(b2 * 255)))
		end
		table.insert(refRows, table.concat(rr))
		table.insert(velRows, table.concat(vr))
	end
	local tor = "none"
	for _, t in world.tornadoes do
		if not t.ended and t.parentId == s.id then
			tor = string.format("%s EF%d vc %.0f", tostring(t.id), t.ef or 0, t.vc or 0)
		end
	end
	local hx, hy = Storm.heading(s)
	print(string.format("FRAME parcels=%d t=%d storm=%s age=%.0fmin W=%.0f rot=%.2f vlow=%.0f occl=%.2f cycle=%d motion=%.0fdeg tornado=%s",
		world.precip.n, tmin, tostring(s.id), s.age / 60, s.W, s.rot or 0, s.vlow or 0, s.occl or 0, s.cycle or 0,
		(90 - math.deg(math.atan2(hy, hx))) % 360, tor))
	print("REF " .. N)
	for _, row in refRows do
		print(row)
	end
	print("SRV " .. N)
	for _, row in velRows do
		print(row)
	end
end

local t = 0
frame(0)
while t < minutes do
	for _ = 1, every * 12 do
		world:step(5)
	end
	t += every
	frame(t)
end
