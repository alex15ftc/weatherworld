--!nonstrict
-- Shelf clouds along a convective system's leading edge (cw.systemsSnap.systems[i].segments,
-- each { x, y, nx, ny, c, du, rij, bow, active, deficit }): a shelf segment faces the outward
-- normal (nx, ny) wherever convection rides the segment (active) over a strong cold pool
-- (deficit). Strength q = ramp(deficit, 1.5, 6 K) x ramp(active, 10, 60):
--   the nose sits just ahead of the gust front, lower for stronger pools; the laminar top rises
--   back into the storms' base; a stronger edge uses the 4-tier piece and adds a second tier set
--   back above it; behind it a dark turbulent base strip (the "whale's mouth").
-- Bowing segments come out bowed because the segments themselves are.
-- Pieces are absolute (Roblox axis order, origin at the lab origin) but in METRES, not studs: they
-- are never given to Roblox (CardPlan.fromPieces turns them back into sim-metre cards), so they
-- take no LabConfig scaling. Returns pieces, vx, vy (m/s).
local Util = require(script.Parent:WaitForChild("Util"))

local ShelfPlan = {}
local ramp, hash = Util.ramp, Util.hash

-- (metres in Roblox axis order: internal geometry only, see above)
local function v3(x: number, y: number, z: number): Vector3
	return Vector3.new(x, z, -y)
end

local function field(seg: any, i: number, key: string): number
	local v = seg[i]
	if v == nil then
		v = seg[key]
	end
	return tonumber(v) or 0
end

function ShelfPlan.plan(sys: any, storms: { any }, CloudKit: any, camX: number, camY: number, detail: number): ({ any }, number, number)
	local out = {}
	local segs = sys.segments or {}
	local seed = 7919
	for c in string.gmatch(tostring(sys.id), "%d+") do
		seed += tonumber(c) or 0
	end
	-- the system moves with its storms (else with its density current)
	local vx, vy, nS = 0, 0, 0
	for _, s in storms do
		if s.systemId ~= nil and s.systemId == sys.id and not s.dead then
			vx += s.u
			vy += s.v
			nS += 1
		end
	end
	local shelfNames = CloudKit.names("shelf")
	local L = Util.light
	local sx, sy = L.sunSim[1], L.sunSim[2]
	local hs = math.sqrt(sx * sx + sy * sy)
	if hs > 1e-3 then
		sx, sy = sx / hs, sy / hs
	end
	local cvx, cvy = 0, 0
	for i, seg in segs do
		local x, y = field(seg, 1, "x"), field(seg, 2, "y")
		local nx, ny = field(seg, 3, "nx"), field(seg, 4, "ny")
		local c = field(seg, 5, "c")
		local active, deficit = field(seg, 9, "active"), field(seg, 10, "deficit")
		cvx += nx * c
		cvy += ny * c
		local nm = math.sqrt(nx * nx + ny * ny)
		if nm < 0.1 then
			continue
		end
		nx, ny = nx / nm, ny / nm
		local q = ramp(deficit, 1.5, 6) * ramp(active, 10, 60)
		local dcx, dcy = x - camX, y - camY
		local dCam = math.sqrt(dcx * dcx + dcy * dcy)
		if q < 0.12 or dCam > 150000 or #shelfNames == 0 then
			continue
		end
		-- the cloud base the edge feeds: the nearest storm's
		local base, best = 1200, math.huge
		for _, s in storms do
			if not s.dead then
				local ex, ey = s.x - x, s.y - y
				local d2 = ex * ex + ey * ey
				if d2 < best and d2 < 40000 * 40000 then
					best, base = d2, s.base or 1200
				end
			end
		end
		local h1, h2, h3 = hash(seed, i, 1), hash(seed, i, 2), hash(seed, i, 3)
		local len = 6200 * (0.95 + 0.12 * h1)
		local depth = 1300 + 700 * q
		local zb = math.max(150, base * (0.72 - 0.35 * q))
		local zt = base + 300 + 500 * q
		local h = math.min(zt - zb, 2000)
		-- the front face takes the sun when the sun is ahead of the line; the cloud behind shades
		local litFront = 0.45 + 0.55 * math.max(0, sx * nx + sy * ny)
		local name = shelfNames[math.clamp(if q > 0.6 then 2 else 1, 1, #shelfNames)]
		if h3 < 0.25 then
			name = shelfNames[1 + math.floor(h3 * 4 * #shelfNames) % #shelfNames] -- (some variety)
		end
		local back = depth * 0.5 - 150
		local px, py = x - nx * back, y - ny * back
		local p = v3(px, py, zb)
		local look = Vector3.new(nx, 0, -ny)
		local cf = CFrame.lookAt(p, p + look) * CFrame.Angles(0, (h2 - 0.5) * 0.12, 0)
		table.insert(out, { kind = "shelf", name = name, cf = cf, size = Vector3.new(len, h, depth), colour = Util.cloudColour(0.7, litFront), split = "x" })
		if q > 0.7 then
			local b2 = back + depth * 0.5
			local p2 = v3(x - nx * b2, y - ny * b2, zb + 0.45 * h)
			table.insert(out, { kind = "shelf", name = shelfNames[#shelfNames], cf = CFrame.lookAt(p2, p2 + look),
				size = Vector3.new(len * 0.95, math.min(h * 0.7, 2000), depth * 0.8), colour = Util.cloudColour(0.72, litFront * 0.9), split = "x" })
		end
		-- the turbulent dark base behind the shelf
		if dCam < 70000 * (0.5 + 0.5 * detail) then
			local bb = depth + 1500
			local p3 = v3(x - nx * bb, y - ny * bb, base - 180)
			local bName = Util.pick(CloudKit, "base", seed, 50 + i)
			if bName then
				table.insert(out, { kind = "base", name = bName, cf = CFrame.lookAt(p3, p3 + look) * CFrame.Angles(0, h1 * 0.3, 0),
					size = Vector3.new(len * 1.05, 380, 3500), colour = Util.cloudColour(0.5, 0.15), split = "xz" })
			end
		end
	end
	if nS > 0 then
		vx, vy = vx / nS, vy / nS
	elseif #segs > 0 then
		vx, vy = cvx / #segs, cvy / #segs
	end
	return out, vx, vy
end

return ShelfPlan
