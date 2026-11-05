--!nonstrict
-- Lightning (guide section 15): flashes are drawn per storm from its flash rate (Storm.step:
-- Deierling & Petersen 2008, from the updraft volume above the freezing level), so active
-- convective regions cluster flashes and weak storms rarely flash; intervals are Poisson.
-- Most flashes stay in the cloud (intracloud / anvil crawlers); cloud-to-ground strikes come down
-- around the precipitation core (more often from low, moist bases; fewer from very strong,
-- high-based updrafts); positive strikes come out of the anvil and the trailing stratiform rain.
-- A flash is an event (time, kind, start, end, seed): every client grows the same branching
-- channel from the seed (Lightning.channel) and hears the thunder distance / 343 m/s later.
local function dep(name: string): any
	if script then
		return require((script :: any).Parent:FindFirstChild(name))
	end
	return (require :: any)("./" .. name)
end
local Noise = dep("Noise")

local Lightning = {}
Lightning.SOUND_SPEED = 343

local function ramp(x: number, a: number, b: number): number
	return math.clamp((x - a) / (b - a), 0, 1)
end

export type Flash = { [string]: any }

local function poisson(rng: any, mean: number): number
	if mean <= 0 then
		return 0
	end
	local L, k, p = math.exp(-mean), 0, 1
	repeat
		k += 1
		p *= rng:next()
	until p <= L or k > 50
	return k - 1
end

function Lightning.step(world: any, dt: number): { Flash }
	local rng = world.lightningRng
	if not rng then
		rng = Noise.rng(world.seed + 7)
		world.lightningRng = rng
	end
	local out = {}
	for _, s in world.storms do
		local rate = s.lightning or 0
		if s.dead then
			rate = (s.lastLightning or 0) * math.exp(-(s.deadFor or 0) / 900) * 0.3
		else
			s.lastLightning = rate
		end
		local n = poisson(rng, rate / 60 * dt)
		for _ = 1, n do
			local hx, hy = 1, 0
			local m = math.sqrt(s.u * s.u + s.v * s.v)
			if m > 0.5 then
				hx, hy = s.u / m, s.v / m
			end
			local cgShare = math.clamp(0.32 - 0.14 * ramp(s.lcl or 1000, 1000, 2500) - 0.1 * ramp(s.W, 30, 60), 0.05, 0.4)
			if s.dead then
				cgShare = 0.15
			end
			local roll = rng:next()
			local f: Flash = { t = world.time + rng:next() * dt, seed = math.floor(rng:next() * 1e9), stormId = s.id }
			if roll < cgShare then
				local positive = rng:next() < (if s.dead then 0.5 else 0.08)
				local gx, gy
				if positive then
					-- from the anvil, well downstream
					local d = rng:range(0.15, 0.6) * math.max(10000, s.anvilLen or 20000)
					gx = s.x + (s.anvilU or hx) * d + rng:normal() * 4000
					gy = s.y + (s.anvilV or hy) * d + rng:normal() * 4000
				else
					-- around the precipitation core: forward flank, the hook, the updraft's edge
					local a = rng:next()
					local cx, cy
					if a < 0.6 then
						cx, cy = s.ffdX or (s.x + hx * s.Ru), s.ffdY or (s.y + hy * s.Ru)
					elseif a < 0.85 then
						cx, cy = s.rfdX or s.x, s.rfdY or s.y
					else
						cx, cy = s.x, s.y
					end
					gx = cx + rng:normal() * 0.7 * s.Ru
					gy = cy + rng:normal() * 0.7 * s.Ru
				end
				f.kind = if positive then "+cg" else "cg"
				f.x1, f.y1, f.z1 = gx, gy, 0
				f.x0 = gx + rng:normal() * 1500
				f.y0 = gy + rng:normal() * 1500
				f.z0 = if positive then rng:range(8000, 11000) else rng:range(4500, 7500)
				f.current = if positive then rng:range(40, 200) else math.exp(rng:normal() * 0.5) * 25
			else
				-- intracloud: within the storm's charge regions, sometimes out along the anvil
				local along = if rng:next() < 0.3 then rng:range(0, 0.5) * math.max(8000, s.anvilLen or 10000) else 0
				local cx = s.x + (s.anvilU or hx) * along + rng:normal() * 1.2 * s.Ru
				local cy = s.y + (s.anvilV or hy) * along + rng:normal() * 1.2 * s.Ru
				local z = if along > 0 then rng:range(8000, (s.el or 11000)) else rng:range(5500, math.max(7000, (s.el or 10000) - 1000))
				local len = rng:range(3000, 12000) + along * 0.3
				local a = rng:next() * 2 * math.pi
				f.kind = "ic"
				f.x0, f.y0, f.z0 = cx, cy, z
				f.x1, f.y1, f.z1 = cx + len * math.cos(a), cy + len * math.sin(a), z + rng:range(-1500, 1500)
				f.current = 0
			end
			table.insert(out, f)
		end
	end
	return out
end

-- The lightning channel as segments { {x0,y0,z0,x1,y1,z1,width} }, grown from the flash seed:
-- a tortuous main channel (midpoint displacement ~ 0.12 of length, repeatedly halved) with
-- branches that leave it and fade. Deterministic: every client draws the same bolt.
function Lightning.channel(f: Flash, detail: number?): { { number } }
	local rng = Noise.rng(f.seed)
	local segs = {}
	local depth = detail or 6
	local function grow(ax: number, ay: number, az: number, bx: number, by: number, bz: number, width: number, level: number, branchy: number)
		local dx, dy, dz = bx - ax, by - ay, bz - az
		local len = math.sqrt(dx * dx + dy * dy + dz * dz)
		if level <= 0 or len < 60 then
			table.insert(segs, { ax, ay, az, bx, by, bz, width })
			return
		end
		local d = len * 0.16
		local mx = (ax + bx) / 2 + rng:normal() * d
		local my = (ay + by) / 2 + rng:normal() * d
		local mz = (az + bz) / 2 + rng:normal() * d * 0.5
		grow(ax, ay, az, mx, my, mz, width, level - 1, branchy)
		grow(mx, my, mz, bx, by, bz, width, level - 1, branchy)
		if rng:next() < branchy and width > 0.25 then
			-- a branch heading on in roughly the same direction, shorter and thinner
			local bl = len * rng:range(0.4, 0.9)
			local ux, uy, uz = dx / len, dy / len, dz / len
			local ex = mx + (ux + rng:normal() * 0.7) * bl
			local ey = my + (uy + rng:normal() * 0.7) * bl
			local ez = mz + (uz + rng:normal() * 0.4) * bl
			if f.kind ~= "ic" then
				ez = math.max(ez, 30)
			end
			grow(mx, my, mz, ex, ey, ez, width * 0.45, level - 2, branchy * 0.6)
		end
	end
	grow(f.x0, f.y0, f.z0, f.x1, f.y1, f.z1, 1, depth, if f.kind == "ic" then 0.45 else 0.3)
	return segs
end

return Lightning
