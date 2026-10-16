--!strict
--!native
-- Ray-marched storm volumes: rain and hail shafts, rain wrapping the rotation, mammatus, scud,
-- the bands round a turning tower. Each is a 3D density (an ellipsoid, or a ring, eaten into by
-- noise: billowed for cloud, streaked downward for rain) drawn into a small EditableImage from
-- where the camera is: rays from the camera through each pixel of a camera-facing sprite march
-- through the density, each step lit by the sun through the cloud between it and the sun (the
-- light falling off as it passes through cloud, Beer-Lambert). So edges are soft, the sunward
-- side bright and the far side dark, and it changes as you move round it.
--
-- Pure Luau ray marching is slow, so images are small (RES square) and refreshed a few rows at a
-- time within BUDGET seconds a frame, the stalest and largest on screen first; noise drifting
-- with time keeps them moving between refreshes. Where EditableImage cannot be made (it depends
-- on the experience's settings), available() is false and StormController draws spheres.

local AssetService = game:GetService("AssetService")
local Lighting = game:GetService("Lighting")

local Volumes = {}

local RES = 32
local STEPS = 16
local BUDGET = 0.004 -- seconds of ray marching a frame
local NOISE = 32 -- noise lattice size (wraps)

export type Kind = "cloud" | "rain" | "band"

export type Volume = {
	image: EditableImage,
	content: Content,
	pixels: buffer,
	-- What it draws, set by the caller each frame it is used:
	frame: CFrame, -- the shape's centre and orientation
	half: Vector3, -- half its size
	colour: Color3,
	opacity: number, -- how opaque straight through its middle (0..1)
	kind: Kind,
	quad: CFrame, -- the sprite it is drawn on (front face toward the camera)
	quadSize: number,
	used: number, -- clock when last used
	-- Drawing state:
	row: number, -- next row to draw; RES when the image is up to date
	drawnAt: number, -- clock when the last full image was written
	pass: { frame: CFrame, half: Vector3, eye: Vector3, quad: CFrame, quadSize: number, colour: Color3, opacity: number, kind: Kind, time: number }?,
}

-- Noise: a wrapping lattice of random values, sampled smoothly between them.
local lattice = buffer.create(NOISE * NOISE * NOISE * 4)
do
	local rng = Random.new(1789)
	for i = 0, NOISE * NOISE * NOISE - 1 do
		buffer.writef32(lattice, i * 4, rng:NextNumber())
	end
end

local function at(x: number, y: number, z: number): number
	return buffer.readf32(lattice, (((z % NOISE) * NOISE + (y % NOISE)) * NOISE + (x % NOISE)) * 4)
end

local function noise(x: number, y: number, z: number): number
	local ix, iy, iz = math.floor(x), math.floor(y), math.floor(z)
	local fx, fy, fz = x - ix, y - iy, z - iz
	fx, fy, fz = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy), fz * fz * (3 - 2 * fz)
	local c000, c100 = at(ix, iy, iz), at(ix + 1, iy, iz)
	local c010, c110 = at(ix, iy + 1, iz), at(ix + 1, iy + 1, iz)
	local c001, c101 = at(ix, iy, iz + 1), at(ix + 1, iy, iz + 1)
	local c011, c111 = at(ix, iy + 1, iz + 1), at(ix + 1, iy + 1, iz + 1)
	local x00, x10 = c000 + (c100 - c000) * fx, c010 + (c110 - c010) * fx
	local x01, x11 = c001 + (c101 - c001) * fx, c011 + (c111 - c011) * fx
	local y0, y1 = x00 + (x10 - x00) * fy, x01 + (x11 - x01) * fy
	return y0 + (y1 - y0) * fz
end

-- Density (0..1) at a point in the shape's unit space (the ellipsoid is the unit sphere).
local function density(kind: Kind, x: number, y: number, z: number, t: number): number
	if kind == "band" then
		-- A ring round the vertical axis, thin top to bottom.
		local radial = math.sqrt(x * x + z * z)
		local d = 1 - ((radial - 0.78) / 0.22) ^ 2 - y * y
		if d <= 0 then
			return 0
		end
		local n = noise(x * 6 + t, y * 3, z * 6)
		return math.max(0, d * (0.4 + 0.8 * n) - 0.15)
	end
	local r2 = x * x + y * y + z * z
	if r2 >= 1 then
		return 0
	end
	local shape = 1 - r2
	if kind == "rain" then
		-- Streaks falling: noise stretched up and down, drifting down with time.
		local n = 0.65 * noise(x * 5, y * 0.8 + t * 1.5, z * 5) + 0.35 * noise(x * 11, y * 1.6 + t * 3, z * 11)
		return math.max(0, shape * (0.35 + 0.9 * n) - 0.2)
	end
	-- Cloud: billows eating in from the edge, slowly boiling.
	local n = 0.55 * noise(x * 3.1 + t * 0.4, y * 3.1, z * 3.1) + 0.3 * noise(x * 6.3, y * 6.3 - t * 0.3, z * 6.3)
		+ 0.15 * noise(x * 12.7, y * 12.7, z * 12.7 + t * 0.5)
	return math.max(0, shape - (1 - n) * 0.8)
end

local failedOnce = false
local made: { [EditableImage]: true } = {}

-- Whether volumes can be drawn here (EditableImage made once to find out).
local availableCache: boolean? = nil
function Volumes.available(): boolean
	if availableCache == nil then
		local ok, image = pcall(function()
			return AssetService:CreateEditableImage({ Size = Vector2.new(RES, RES) })
		end)
		availableCache = ok and image ~= nil
		if ok and image then
			image:Destroy()
		elseif not failedOnce then
			failedOnce = true
			warn(`[Volumes] EditableImage is not available here, so storms use sphere parts: {image}`)
		end
	end
	return availableCache == true
end

function Volumes.new(): Volume?
	local ok, image = pcall(function()
		return AssetService:CreateEditableImage({ Size = Vector2.new(RES, RES) })
	end)
	if not ok or not image then
		return nil
	end
	made[image] = true
	return {
		image = image,
		content = Content.fromObject(image),
		pixels = buffer.create(RES * RES * 4),
		frame = CFrame.identity,
		half = Vector3.one,
		colour = Color3.new(1, 1, 1),
		opacity = 0,
		kind = "cloud",
		quad = CFrame.identity,
		quadSize = 1,
		used = 0,
		row = RES,
		drawnAt = -math.huge,
	}
end

function Volumes.free(volume: Volume)
	if made[volume.image] then
		made[volume.image] = nil
		volume.image:Destroy()
	end
end

-- Draws rows of one volume's image (its current pass) until the clock passes `stop`; true when
-- the image is finished.
local function drawRows(v: Volume, stop: number): boolean
	local pass = v.pass
	if not pass then
		return true
	end
	local frame, half, eye, quad = pass.frame, pass.half, pass.eye, pass.quad
	local hx, hy, hz = half.X, half.Y, half.Z
	local eyeLocal = frame:PointToObjectSpace(eye)
	local ex, ey, ez = eyeLocal.X / hx, eyeLocal.Y / hy, eyeLocal.Z / hz
	-- A Front-face SurfaceGui's right is the part's -RightVector, seen from the front.
	local right, up = -quad.RightVector, quad.UpVector
	local origin = quad.Position
	local q = pass.quadSize / 2
	local sun = frame:VectorToObjectSpace(Lighting:GetSunDirection())
	local sx, sy, sz = sun.X / hx, sun.Y / hy, sun.Z / hz
	local sunLen = math.sqrt(sx * sx + sy * sy + sz * sz)
	sx, sy, sz = sx / sunLen, sy / sunLen, sz / sunLen
	local mean = (hx + hy + hz) / 3
	-- Extinction such that a ray through the middle (about 1.5 mean radii of density) has
	-- the opacity asked for.
	local sigma = -math.log(1 - math.min(pass.opacity, 0.985)) / (mean * 0.75)
	local cr, cg, cb = pass.colour.R, pass.colour.G, pass.colour.B
	local kind: Kind, t = pass.kind, pass.time
	local pixels = v.pixels
	while v.row < RES do
		local j = v.row
		local vv = (1 - (j + 0.5) / RES * 2) * q
		for i = 0, RES - 1 do
			local uu = ((i + 0.5) / RES * 2 - 1) * q
			local p = origin + right * uu + up * vv
			local dirWorld = (p - eye).Unit
			local dl = frame:VectorToObjectSpace(dirWorld)
			-- In unit space: where the ray enters and leaves the unit sphere (a ring's box too).
			local dx, dy, dz = dl.X / hx, dl.Y / hy, dl.Z / hz
			local a = dx * dx + dy * dy + dz * dz
			local b = 2 * (ex * dx + ey * dy + ez * dz)
			local c = ex * ex + ey * ey + ez * ez - (if kind == "band" then 1.1 else 1)
			local disc = b * b - 4 * a * c
			local o = (j * RES + i) * 4
			if disc <= 0 then
				buffer.writeu32(pixels, o, 0)
				continue
			end
			local root = math.sqrt(disc)
			local t0 = math.max(0, (-b - root) / (2 * a))
			local t1 = (-b + root) / (2 * a)
			if t1 <= t0 then
				buffer.writeu32(pixels, o, 0)
				continue
			end
			local step = (t1 - t0) / STEPS -- world studs (dirWorld is a unit vector)
			local T, lr, lg, lb = 1, 0, 0, 0
			for k = 0, STEPS - 1 do
				local s = t0 + (k + 0.5) * step
				local x, y, z = ex + dx * s, ey + dy * s, ez + dz * s
				local d = density(kind, x, y, z, t)
				if d > 0.002 then
					-- Light reaching here: the cloud between this point and the sun.
					local toSun = density(kind, x + sx * 0.25, y + sy * 0.25, z + sz * 0.25, t)
						+ density(kind, x + sx * 0.6, y + sy * 0.6, z + sz * 0.6, t)
					-- Sunlit cloud brightens toward white; shadowed keeps its own darker colour.
					local sunlit = math.exp(-toSun * sigma * mean * 0.45)
					local shade = (0.55 + 0.45 * sunlit) * (0.85 + 0.15 * y) -- a little darker underneath
					local glow = 0.32 * sunlit * sunlit
					local alpha = 1 - math.exp(-d * sigma * step)
					local w = T * alpha
					lr += (cr * shade + glow) * w
					lg += (cg * shade + glow) * w
					lb += (cb * shade + glow * 1.04) * w
					T *= 1 - alpha
					if T < 0.02 then
						break
					end
				end
			end
			local A = 1 - T
			if A < 0.004 then
				buffer.writeu32(pixels, o, 0)
			else
				buffer.writeu8(pixels, o, math.clamp(math.floor(lr / A * 255), 0, 255))
				buffer.writeu8(pixels, o + 1, math.clamp(math.floor(lg / A * 255), 0, 255))
				buffer.writeu8(pixels, o + 2, math.clamp(math.floor(lb / A * 255), 0, 255))
				buffer.writeu8(pixels, o + 3, math.clamp(math.floor(A * 255), 0, 255))
			end
		end
		v.row += 1
		if os.clock() > stop then
			break
		end
	end
	if v.row >= RES then
		v.image:WritePixelsBuffer(Vector2.zero, Vector2.new(RES, RES), pixels)
		v.pass = nil
		return true
	end
	return false
end

-- Spends up to BUDGET this frame drawing: finishes volumes part-drawn, then starts the ones
-- most out of date, weighted by how big they look from the camera.
function Volumes.draw(volumes: { Volume }, eye: Vector3, clock: number)
	local stop = os.clock() + BUDGET
	-- Part-drawn ones first.
	for _, v in volumes do
		if v.pass and v.used >= clock - 0.5 then
			if not drawRows(v, stop) and os.clock() > stop then
				return
			end
		end
	end
	while os.clock() < stop do
		local best: Volume? = nil
		local bestScore = 0
		for _, v in volumes do
			if v.pass or v.used < clock - 0.5 or v.opacity <= 0.01 then
				continue
			end
			local distance = math.max(1, (v.quad.Position - eye).Magnitude)
			local apparent = v.quadSize / distance -- how big on screen
			local score = (clock - v.drawnAt) * (0.2 + apparent)
			if score > bestScore then
				best, bestScore = v, score
			end
		end
		if not best or bestScore < 0.05 then
			return
		end
		best.pass = {
			frame = best.frame, half = best.half, eye = eye, quad = best.quad, quadSize = best.quadSize,
			colour = best.colour, opacity = best.opacity, kind = best.kind, time = clock * 0.15,
		}
		best.row = 0
		best.drawnAt = clock
		drawRows(best, stop)
	end
end

return Volumes
