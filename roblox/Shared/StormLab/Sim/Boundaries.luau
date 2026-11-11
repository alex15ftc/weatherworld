--!nonstrict
-- Surface boundaries as persistent objects (guide section 13): fronts, drylines and outflow
-- boundaries found from the fields (never placed by hand), kept with their identity from one
-- analysis to the next so their motion and age are known. Storms feel boundaries through the
-- fields themselves (convergence, temperature contrast, cold pools); these objects describe them
-- (for the lab map and the storm-interaction readout).
--   type: "outflow" (the cold pool's edge), "dryline" (moisture contrast, little temperature
--   contrast), "cold" / "warm" / "stationary" (temperature contrast; by the cross-boundary wind)
local Boundaries = {}

local sqrt = math.sqrt

export type Boundary = { [string]: any }

local nextId = 0

local function strongest(world: any): ({ { number } }, { { number } })
	local env, cp = world.env, world.coldPool
	local g = env.surfT
	local tPts, qPts = {}, {}
	for j = 2, g.ny - 1 do
		if j % 6 == 0 and world.pause then
			world:pause()
		end
		for i = 2, g.nx - 1 do
			local x, y = g:centre(i, j)
			-- temperature including the cold pool
			local function T(px: number, py: number): number
				local t = env.surfT:sample(px, py)
				local d = cp:deficitAt(px, py)
				return t - d
			end
			local h = g.dx
			local gx = (T(x + h, y) - T(x - h, y)) / (2 * h)
			local gy = (T(x, y + h) - T(x, y - h)) / (2 * h)
			local gt = sqrt(gx * gx + gy * gy) * 1e5 -- K per 100 km
			local qx, qy = env.surfTd:gradient(x, y)
			local gq = sqrt(qx * qx + qy * qy) * 1e5
			-- ridge test: stronger than the points one cell along the gradient either way
			if gt > 3 then
				local nx, ny = gx / (gt / 1e5), gy / (gt / 1e5)
				local function gAt(px: number, py: number): number
					local ax = (T(px + h, py) - T(px - h, py)) / (2 * h)
					local ay = (T(px, py + h) - T(px, py - h)) / (2 * h)
					return sqrt(ax * ax + ay * ay) * 1e5
				end
				if gt >= gAt(x + nx * h, y + ny * h) and gt >= gAt(x - nx * h, y - ny * h) then
					table.insert(tPts, { x, y, gt, gx, gy })
				end
			end
			if gq > 4 and gq > 1.6 * gt then
				local nx, ny = qx / (gq / 1e5), qy / (gq / 1e5)
				local function qAt(px: number, py: number): number
					local ax, ay = env.surfTd:gradient(px, py)
					return sqrt(ax * ax + ay * ay) * 1e5
				end
				if gq >= qAt(x + nx * h, y + ny * h) and gq >= qAt(x - nx * h, y - ny * h) then
					table.insert(qPts, { x, y, gq, qx, qy })
				end
			end
		end
	end
	return tPts, qPts
end

-- chain ridge points into polylines (greedy nearest neighbour within reach)
local function chain(points: { { number } }, reach: number): { { { number } } }
	local used = {}
	local lines = {}
	for start = 1, #points do
		if not used[start] then
			used[start] = true
			local line = { points[start] }
			for _, dir in { 1, -1 } do
				local cur = points[start]
				while true do
					local best, bd = nil, reach * reach
					for k = 1, #points do
						if not used[k] then
							local p = points[k]
							local d = (p[1] - cur[1]) ^ 2 + (p[2] - cur[2]) ^ 2
							if d < bd then
								best, bd = k, d
							end
						end
					end
					if not best then
						break
					end
					used[best] = true
					cur = points[best]
					if dir == 1 then
						table.insert(line, cur)
					else
						table.insert(line, 1, cur)
					end
				end
			end
			if #line >= 5 then
				table.insert(lines, line)
			end
		end
	end
	return lines
end

function Boundaries.analyse(world: any, previous: { Boundary }, dt: number): { Boundary }
	local env, cp = world.env, world.coldPool
	local tPts, qPts = strongest(world)
	local reach = env.surfT.dx * 1.6
	local found = {}
	for kind, lines in { t = chain(tPts, reach), q = chain(qPts, reach) } do
		for _, line in lines do
			local pts = {}
			local sumD, sumG, sumCross = 0, 0, 0
			for _, p in line do
				table.insert(pts, { p[1], p[2] })
				sumD += cp:deficitAt(p[1], p[2])
				sumG += p[3]
				-- wind across the boundary toward the warm/moist side (positive = cold side advancing)
				local gm = sqrt(p[4] * p[4] + p[5] * p[5])
				local nx, ny = p[4] / gm, p[5] / gm -- toward warm/moist
				local u, v = env:windAt(p[1] - nx * 8000, p[2] - ny * 8000, 10)
				sumCross += u * nx + v * ny
			end
			local n = #line
			local t: string
			if kind == "q" then
				t = "dryline"
			elseif sumD / n > 0.8 then
				t = "outflow"
			elseif sumCross / n > 2 then
				t = "cold"
			elseif sumCross / n < -2 then
				t = "warm"
			else
				t = "stationary"
			end
			table.insert(found, { type = t, points = pts, contrast = sumG / n, cross = sumCross / n })
		end
	end
	-- identity: match by mean distance to the previous boundaries of the same type
	for _, b in found do
		local best, bd = nil, 20000
		for _, old in previous do
			if old.type == b.type then
				local s, c = 0, 0
				for _, p in b.points do
					local m = math.huge
					for _, q in old.points do
						m = math.min(m, (p[1] - q[1]) ^ 2 + (p[2] - q[2]) ^ 2)
					end
					s += sqrt(m)
					c += 1
				end
				local mean = s / math.max(1, c)
				if mean < bd then
					best, bd = old, mean
				end
			end
		end
		if best then
			b.id = best.id
			b.age = (best.age or 0) + dt
			b.motion = bd / math.max(1, dt)
		else
			nextId += 1
			b.id = string.format("B%02d", nextId)
			b.age = 0
			b.motion = 0
		end
	end
	return found
end

return Boundaries
