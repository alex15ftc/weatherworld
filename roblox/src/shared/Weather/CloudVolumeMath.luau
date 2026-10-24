--!strict
-- The maths of the storm clouds drawn as a volume (client/CloudVolume): the storm's shapes, the
-- cloud density and the light, and the rendering of a band of the picture. A module of its own
-- so the worker threads (client/CloudWorker, Parallel Luau actors) can each load it.
-- Look-developed in tools/cloudvolume/lookdev.mjs, which renders the same maths in Node: keep
-- the two in step.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage.Shared.World.Config)

local CloudVolumeMath = {}

local VOL = Config.VOLUME_CLOUDS
local KM = Config.STUDS_PER_MILE / Config.KM_PER_MILE
local SKY = Config.SKY_STUDS_PER_METRE
local HALF = Config.MAP_MILES / 2 * Config.STUDS_PER_MILE
local HALF_X = if Config.VIEW_ORIGIN_KM then Config.VIEW_ORIGIN_KM.x * KM else HALF -- (see Config.VIEW_ORIGIN_KM)
local HALF_Z = if Config.VIEW_ORIGIN_KM then Config.VIEW_ORIGIN_KM.y * KM else HALF

local function at(xKm: number, yKm: number, y: number): Vector3
	return Vector3.new(xKm * KM - HALF_X, y, yKm * KM - HALF_Z)
end
local function heading(deg: number): Vector3
	local r = math.rad(deg)
	return Vector3.new(math.sin(r), 0, -math.cos(r))
end
local function smooth(a: number, b: number, x: number): number
	local t = math.clamp((x - a) / (b - a), 0, 1)
	return t * t * (3 - 2 * t)
end
CloudVolumeMath.smooth = smooth

-- The storm's shapes, in studs ----------------------------------------------------------------

export type Spec = {
	ground: number,
	baseY: number,
	height: number,
	towers: { { foot: Vector3, scale: number } },
	R: number,
	downwind: Vector3,
	axis: Vector3,
	centre: Vector3,
	baseR: number,
	baseHalfLen: number,
	baseTh: number,
	anvilC: Vector3,
	anvilFwd: Vector3,
	anvilSide: Vector3,
	anvilHalf: Vector3,
	rootC: Vector3,
	rootR: number,
	domeC: Vector3?,
	domeR: number,
	wallTop: Vector3?,
	wallR: number,
	wallLower: number,
	wallStrength: number,
	min: Vector3,
	max: Vector3,
	tornado: Vector3?,
}

function CloudVolumeMath.specOf(s: any): Spec
	local ground = s.groundStuds or 0
	local up = s.updraft
	local baseY = ground + up.baseM * SKY
	local topY = ground + up.topM * SKY
	local R = up.radiusKm * KM
	local centre = at(up.xKm, up.yKm, baseY)
	local downwind = heading(s.anvil.bearingDeg)
	local axis = heading(s.line.axisBearingDeg)
	local towers = {}
	local count = if s.line.share > 0.3 then math.clamp(math.floor(2 * s.line.halfLengthKm / 12), 2, 8) else 1
	for k = 1, count do
		local along = if count > 1 then ((k - 0.5) / count - 0.5) * 2 * s.line.halfLengthKm * KM else 0
		table.insert(towers, { foot = centre + axis * along, scale = if count > 1 then 0.75 + 0.25 * math.sin(k * 2.3) else 1 })
	end
	-- The flat base is the bottom of the updraught, a little inside the tower's foot (the wider
	-- rain-free base, with no cloud over it, reads as a lit pancake).
	local baseR = 0.92 * R
	local anvilTop = ground + s.anvil.topM * SKY
	local length, width = s.anvil.lengthKm * KM, s.anvil.widthKm * KM
	local anvilC = Vector3.new(centre.X, anvilTop - 700 * SKY, centre.Z) + downwind * (length * 0.45)
	local spec: Spec = {
		ground = ground,
		baseY = baseY,
		height = topY - baseY,
		towers = towers,
		R = R,
		downwind = downwind,
		axis = axis,
		centre = centre,
		baseR = baseR,
		baseHalfLen = if count > 1 then s.line.halfLengthKm * KM else 0,
		baseTh = 120 * SKY + 0.04 * baseR,
		anvilC = anvilC,
		anvilFwd = downwind,
		anvilSide = Vector3.new(-downwind.Z, 0, downwind.X),
		anvilHalf = Vector3.new(width / 2, 700 * SKY, length / 2),
		rootC = Vector3.new(centre.X, anvilTop - 900 * SKY, centre.Z),
		rootR = R * 1.3,
		domeC = if up.overshootM > 50 then Vector3.new(centre.X, topY, centre.Z) + downwind * 0.25 * (topY - baseY) else nil,
		domeR = math.max(1, up.overshootM * SKY),
		wallTop = nil,
		wallR = 0,
		wallLower = 0,
		wallStrength = 0,
		min = Vector3.zero,
		max = Vector3.zero,
		tornado = if s.tornado then at(s.tornado.xKm, s.tornado.yKm, s.tornado.groundStuds or ground) else nil,
	}
	local wall = s.wallCloud
	if wall.strength > 0.03 then
		spec.wallTop = at(wall.xKm, wall.yKm, baseY)
		spec.wallR = wall.radiusKm * KM
		spec.wallLower = math.max(30, wall.loweringM * SKY)
		spec.wallStrength = math.clamp(wall.strength * 2.2, 0, 1)
	end
	-- The box round it all.
	local lo, hi = Vector3.one * math.huge, -Vector3.one * math.huge
	local function grow(p: Vector3, r: Vector3)
		lo, hi = lo:Min(p - r), hi:Max(p + r)
	end
	for _, t in towers do
		grow(t.foot + Vector3.new(0, spec.height / 2, 0) + downwind * 0.12 * spec.height, Vector3.new(R * 1.45 + 0.15 * spec.height, spec.height / 2 + 400, R * 1.45 + 0.15 * spec.height))
	end
	grow(centre, Vector3.new(baseR + spec.baseHalfLen, spec.baseTh * 2, baseR + spec.baseHalfLen))
	-- (noise pushes the cloud past its shapes' edges: margins of a quarter more)
	local ext = math.max(width, length) / 2 * 1.25 + 400
	grow(anvilC, Vector3.new(ext, spec.anvilHalf.Y * 1.8, ext))
	grow(spec.rootC, Vector3.new(spec.rootR * 1.3, 900 * SKY * 1.5, spec.rootR * 1.3))
	if spec.wallTop then
		grow(spec.wallTop - Vector3.new(0, spec.wallLower / 2, 0), Vector3.new(spec.wallR * 1.2, spec.wallLower, spec.wallR * 1.2))
	end
	spec.min = Vector3.new(lo.X, math.max(lo.Y, ground), lo.Z)
	spec.max = hi
	return spec
end

-- How far inside the storm's shapes p is (1 at a core, 0 at the edge, below 0 outside), and which
-- part: 1 tower, 2 base, 3 anvil, 4 wall cloud.
local function field(sp: Spec, x: number, y: number, z: number): (number, number)
	local best, kind = -1, 0
	local h = sp.height
	-- Towers.
	local f = (y - sp.baseY) / h
	if f > -0.05 and f < 1.08 then
		local lean = f * f * 0.25 * h
		for _, t in sp.towers do
			local cx, cz = t.foot.X + sp.downwind.X * lean, t.foot.Z + sp.downwind.Z * lean
			local r = sp.R * t.scale * (0.95 - 0.35 * f * f)
			local d = math.sqrt((x - cx) ^ 2 + (z - cz) ^ 2) / r
			local v = (1 - d) * smooth(1.08, 0.9, f)
			if v > best then
				best, kind = v, 1
			end
		end
	end
	-- The base (along a line, a long slab).
	local dx, dz = x - sp.centre.X, z - sp.centre.Z
	local along = dx * sp.axis.X + dz * sp.axis.Z
	local excess = math.max(0, math.abs(along) - sp.baseHalfLen)
	local ax, az = dx - sp.axis.X * along, dz - sp.axis.Z * along
	local horiz = math.sqrt(ax * ax + az * az + excess * excess) / sp.baseR
	-- A flat underside, rising into the tower: thicker toward the middle.
	local th = sp.baseTh * (1 + 4 * math.max(0, 1 - horiz))
	local vert = if y < sp.baseY then (sp.baseY - y) / 60 else (y - sp.baseY) / th
	local v = math.min(1 - horiz, 1 - vert)
	if v > best then
		best, kind = v, 2
	end
	-- The anvil and its root.
	local ox, oy, oz = x - sp.anvilC.X, y - sp.anvilC.Y, z - sp.anvilC.Z
	local u = (ox * sp.anvilSide.X + oz * sp.anvilSide.Z) / sp.anvilHalf.X
	local w = (ox * sp.anvilFwd.X + oz * sp.anvilFwd.Z) / sp.anvilHalf.Z
	v = 1 - math.sqrt(u * u + (oy / sp.anvilHalf.Y) ^ 2 + w * w)
	if v > best then
		best, kind = v, 3
	end
	local rx, ry, rz = x - sp.rootC.X, y - sp.rootC.Y, z - sp.rootC.Z
	v = 1 - math.sqrt((rx * rx + rz * rz) / (sp.rootR * sp.rootR) + (ry / (900 * SKY)) ^ 2)
	if v > best then
		best, kind = v, 3
	end
	local dome = sp.domeC
	if dome then
		v = 1 - math.sqrt(((x - dome.X) ^ 2 + (z - dome.Z) ^ 2) / (sp.R * 0.45) ^ 2 + ((y - dome.Y) / sp.domeR) ^ 2)
		if v > best then
			best, kind = v, 1
		end
	end
	-- The wall cloud: a lowering under the base, narrowing and thinning toward its bottom.
	local wt = sp.wallTop
	if wt and y < sp.baseY and y > sp.baseY - sp.wallLower then
		local frac = (sp.baseY - y) / sp.wallLower
		local r = sp.wallR * (1 - 0.45 * frac)
		v = (1 - math.sqrt((x - wt.X) ^ 2 + (z - wt.Z) ^ 2) / r) * sp.wallStrength * (1 - 0.5 * frac)
		if v > best then
			best, kind = v, 4
		end
	end
	return best, kind
end

-- Cloud density 0-1 at a point: the shapes' field broken up by noise that rises and drifts. The
-- anvil's noise is smooth and long across (fibrous, spread by the wind aloft); the tower's lumpy.
local function density(sp: Spec, x: number, y: number, z: number, t: number): number
	local fv, kind = field(sp, x, y, z)
	if fv < -0.45 then
		return 0
	end
	if kind == 3 then
		local a1, a2 = 1 / 2600, 1 / 900
		local n = 0.65 * math.noise(x * a1 + t * 0.004, y / 500, z * a1) + 0.35 * math.noise(x * a2, y / 160 + t * 0.01, z * a2 + 3.1)
		return smooth(0, 0.35, fv + 0.25 * n)
	end
	local s1, s2, s3 = 1 / 900, 1 / 330, 1 / 120
	local n = 0.55 * math.noise(x * s1 + t * 0.010, y * s1 - t * 0.025, z * s1)
		+ 0.30 * math.noise(x * s2 - t * 0.02, y * s2 - t * 0.05, z * s2 + 7.1)
		+ 0.15 * math.noise(x * s3, y * s3 - t * 0.09, z * s3 - 3.3)
	local amp = if kind == 2 then 0.5 elseif kind == 4 then 0.7 else 1
	return smooth(0, 0.3, fv + VOL.noise * amp * n)
end

-- Steps toward the sun, in lightSteps: growing, far enough to cross the tower.
local LIGHT = { 0.4, 1.2, 2.8, 6 }

-- A picture to render: where the camera is, the grid laid over the storm (centre, right, up,
-- half sizes), its size in pixels, the light. A plain table, so it can be sent to the workers.
export type Job = {
	id: number,
	key: string,
	spec: Spec,
	n: number,
	cam: Vector3,
	centre: Vector3,
	right: Vector3,
	up: Vector3,
	halfW: number,
	halfH: number,
	clock: number,
	sunDir: Vector3,
	sunI: number,
	ambI: number,
}

-- Where a ray (origin o, direction d along one axis) is between lo and hi, narrowing t0..t1.
local function slab(o: number, d: number, lo: number, hi: number, t0: number, t1: number): (number, number)
	if math.abs(d) < 1e-6 then
		if o < lo or o > hi then
			return math.huge, t1
		end
		return t0, t1
	end
	local a, b = (lo - o) / d, (hi - o) / d
	if a > b then
		a, b = b, a
	end
	return math.max(t0, a), math.min(t1, b)
end

-- Rows r0 to r1 - 1 of the picture, as RGBA bytes (straight alpha), returned as a string. The
-- rows each side are rendered too, for the 3x3 blur that hides the jittered steps.
function CloudVolumeMath.renderBand(j: Job, r0: number, r1: number): string
	local n = j.n
	local sp, cam = j.spec, j.cam
	local steps, sigma, lstep = VOL.steps, VOL.sigma, VOL.lightStep
	local sd, t = j.sunDir, j.clock
	local mn, mx = sp.min, sp.max
	local lo, hi = math.max(0, r0 - 1), math.min(n - 1, r1)
	local rows = hi - lo + 1
	local buf = buffer.create(rows * n * 16)
	for row = lo, hi do
		local v = 1 - (row + 0.5) / n * 2
		for col = 0, n - 1 do
			local u = (col + 0.5) / n * 2 - 1
			local p = j.centre + j.right * (u * j.halfW) + j.up * (v * j.halfH)
			local dir = (p - cam).Unit
			-- Where the ray is inside the box.
			local t0, t1 = 0, math.huge
			t0, t1 = slab(cam.X, dir.X, mn.X, mx.X, t0, t1)
			t0, t1 = slab(cam.Y, dir.Y, mn.Y, mx.Y, t0, t1)
			t0, t1 = slab(cam.Z, dir.Z, mn.Z, mx.Z, t0, t1)
			if dir.Y < 0 then
				t1 = math.min(t1, (sp.ground - cam.Y) / dir.Y)
			end
			local o = ((row - lo) * n + col) * 16
			if t0 >= t1 then
				continue -- (the buffer starts zeroed)
			end
			local step = (t1 - t0) / steps
			local jitter = (52.9829189 * ((0.06711056 * col + 0.00583715 * row) % 1)) % 1
			local tt = t0 + step * jitter
			local trans, r, g, b = 1, 0, 0, 0
			local hazeT = -1 -- distance to where the cloud starts, for its haze
			local phase = 0.75 + 1.4 * math.max(0, dir:Dot(sd)) ^ 6
			for _ = 1, steps do
				local q = cam + dir * tt
				local dens = density(sp, q.X, q.Y, q.Z, t)
				if dens > 0.01 then
					if hazeT < 0 then
						hazeT = tt
					end
					-- Light reaching here from the sun, through the shapes.
					local tau = 0
					if j.sunI > 0 then
						local prev = 0
						for _, m in LIGHT do
							local lq = q + sd * (lstep * m)
							tau += smooth(0, 0.3, (field(sp, lq.X, lq.Y, lq.Z))) * lstep * (m - prev) * sigma * 0.6
							prev = m
						end
					end
					local hf = math.clamp((q.Y - sp.baseY) / sp.height, 0, 1)
					-- Sun light: single scattering plus two weaker, wider octaves standing in for
					-- light scattered many times inside the cloud (shadow sides stay grey, not black).
					-- Sky light: less low in the cloud and where much cloud lies toward the sun.
					local sun = math.exp(-tau) * phase + 0.35 * math.exp(-0.25 * tau) + 0.15 * math.exp(-0.06 * tau)
					local light = j.sunI * sun + j.ambI * (0.45 + 0.55 * hf) * (0.55 + 0.45 * math.exp(-0.3 * tau))
					local a = 1 - math.exp(-sigma * dens * step)
					-- A soft tone curve: bright cloud keeps its shading instead of clipping to white.
					local c = trans * a * (1 - math.exp(-1.6 * light))
					r += c * 0.94
					g += c * 0.95
					b += c * 0.98
					trans *= 1 - a
					if trans < 0.02 then
						break
					end
				end
				tt += step
			end
			-- Distance haze toward a light sky colour (the picture hangs near, out of Roblox's).
			local alpha = 1 - trans
			if hazeT > 0 then
				local h = 1 - math.exp(-hazeT / VOL.hazeStuds)
				local hc = VOL.hazeColour
				r, g, b = r * (1 - h) + hc.R * h * alpha, g * (1 - h) + hc.G * h * alpha, b * (1 - h) + hc.B * h * alpha
			end
			buffer.writef32(buf, o, r)
			buffer.writef32(buf, o + 4, g)
			buffer.writef32(buf, o + 8, b)
			buffer.writef32(buf, o + 12, alpha)
		end
	end
	-- Blurred 3x3 (premultiplied) and packed.
	local out = buffer.create((r1 - r0) * n * 4)
	local W = { 1, 2, 1 }
	local ig = 1 / VOL.displayGamma
	for y = r0, r1 - 1 do
		for x = 0, n - 1 do
			local r, g, b, a, wsum = 0, 0, 0, 0, 0
			for dy = -1, 1 do
				local yy = y + dy
				if yy >= lo and yy <= hi then
					for dx = -1, 1 do
						local xx = x + dx
						if xx >= 0 and xx < n then
							local w = W[dx + 2] * W[dy + 2]
							local o = ((yy - lo) * n + xx) * 16
							r += buffer.readf32(buf, o) * w
							g += buffer.readf32(buf, o + 4) * w
							b += buffer.readf32(buf, o + 8) * w
							a += buffer.readf32(buf, o + 12) * w
							wsum += w
						end
					end
				end
			end
			r, g, b, a = r / wsum, g / wsum, b / wsum, a / wsum
			local o = ((y - r0) * n + x) * 4
			if a >= 0.004 then
				-- (displayGamma: the image comes out darker in the world than its values; undone here)
				buffer.writeu8(out, o, math.clamp(math.floor((r / a) ^ ig * 255), 0, 255))
				buffer.writeu8(out, o + 1, math.clamp(math.floor((g / a) ^ ig * 255), 0, 255))
				buffer.writeu8(out, o + 2, math.clamp(math.floor((b / a) ^ ig * 255), 0, 255))
				buffer.writeu8(out, o + 3, math.clamp(math.floor(a * 255), 0, 255))
			end
		end
	end
	return buffer.tostring(out)
end

return CloudVolumeMath
