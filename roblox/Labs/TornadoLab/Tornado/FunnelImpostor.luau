--!strict
-- A live cross-section texture for the beam funnel (EditableImage), redrawn ~30 times a second.
--
-- The beam is a ribbon facing the camera, so each column u of the texture is a line down the
-- funnel's visible face at angle theta = asin(2u - 1) round from the side nearest the camera.
-- That makes the ribbon a round column ("impostor"):
--   shade     the face's normal (sin theta, cos theta) in the camera's frame against the real
--             sun direction, with wrap lighting (light passes into cloud) and a forward-scatter
--             rim when the sun is behind it (a backlit funnel goes dark with a bright edge)
--   rotation  streaks laid on the column at azimuth phi = theta + spin * time slide across the
--             face as the funnel turns, at the air's speed (Vortex.spinRate)
--   edge      the soft alpha ramp and the darker band just inside it (Ref1: ~4% ramp, ~11%)
-- One image is shared by every beam segment (one write per frame).
--
--   local imp = FunnelImpostor.new()   -- nil when EditableImages aren't available
--   imp:draw(viewDir, sunDir, spinAngle); beam.TextureContent = imp.content
local AssetService = game:GetService("AssetService")

local FunnelImpostor = {}
FunnelImpostor.__index = FunnelImpostor

export type Settings = {
	width: number, -- pixels across
	height: number, -- pixels along (streaks run along it; kept short, it doesn't vary along)
	edge: number, -- alpha ramp, share of the full width at each side
	dark: number, -- darkening just inside the edge
	wrap: number, -- wrap lighting: 0 hard (Lambert), 1 soft
	ambient: number, -- light on the side away from the sun
	sunShare: number, -- how much the sun's side is lit above the ambient
	rim: number, -- backlit edge glow
	streaks: number, -- streak contrast
	streakCount: number, -- streak frequencies (more = finer)
	seed: number,
}

export type FunnelImpostor = typeof(setmetatable(
	{} :: {
		image: EditableImage,
		content: Content,
		settings: Settings,
		buf: buffer,
		freqs: { number },
		phases: { number },
		amps: { number },
	},
	FunnelImpostor
))

function FunnelImpostor.new(settings: Settings): FunnelImpostor?
	local ok, image = pcall(function()
		return AssetService:CreateEditableImage({ Size = Vector2.new(settings.width, settings.height) })
	end)
	if not ok or not image then
		warn("[FunnelImpostor] EditableImage unavailable: " .. tostring(image))
		return nil
	end
	local rng = Random.new(settings.seed)
	local freqs, phases, amps = {}, {}, {}
	for k = 1, settings.streakCount do
		-- integer frequencies round the column, so the pattern closes on itself
		local f = rng:NextInteger(3, 40)
		freqs[k] = f
		phases[k] = rng:NextNumber(0, 2 * math.pi)
		amps[k] = 1 / math.sqrt(f)
	end
	local total = 0
	for _, a in amps do
		total += a
	end
	for k, a in amps do
		amps[k] = a / total
	end
	return setmetatable({
		image = image :: EditableImage,
		content = Content.fromObject(image :: EditableImage),
		settings = settings,
		buf = buffer.create(settings.width * settings.height * 4),
		freqs = freqs,
		phases = phases,
		amps = amps,
	}, FunnelImpostor)
end

local function smoothstep(a: number, b: number, x: number): number
	local t = math.clamp((x - a) / (b - a), 0, 1)
	return t * t * (3 - 2 * t)
end

-- viewDir: camera -> funnel (unit). sunDir: towards the sun (unit). spin: radians turned so far.
function FunnelImpostor.draw(self: FunnelImpostor, viewDir: Vector3, sunDir: Vector3, spin: number)
	local S = self.settings
	local W, H = S.width, S.height
	-- the camera's frame round the (roughly vertical) funnel: right, and towards the camera
	local toCam = Vector3.new(-viewDir.X, 0, -viewDir.Z)
	toCam = if toCam.Magnitude > 1e-4 then toCam.Unit else Vector3.zAxis
	local right = Vector3.yAxis:Cross(toCam) -- the ribbon's +u direction
	local lx, lz, ly = sunDir:Dot(right), sunDir:Dot(toCam), sunDir.Y
	local horiz = math.sqrt(lx * lx + lz * lz)
	local backlit = math.max(-lz, 0) -- sun behind the funnel
	local e = S.edge * 2
	local row = buffer.create(W * 4)
	for x = 0, W - 1 do
		local u = (x + 0.5) / W
		local sx = 2 * u - 1 -- -1 .. 1 across
		local d = math.abs(sx)
		local theta = math.asin(math.clamp(sx, -1, 1))
		local nx, nz = math.sin(theta), math.cos(theta)
		-- light: wrap-lit Lambert on the column, the sun's height lighting the top a little
		local ndl = (nx * lx + nz * lz)
		local lit = math.max((ndl + S.wrap * horiz) / (1 + S.wrap), 0) + 0.25 * math.max(ly, 0)
		local light = S.ambient + S.sunShare * lit
		-- backlit: the thin edges glow, the middle goes dark
		light += S.rim * backlit * (1 - nz) ^ 3
		light *= 1 - 0.35 * backlit * nz
		-- the darker band just inside the edge, and the edge's alpha ramp
		local band = math.exp(-((d - (1 - 1.6 * e)) / (1.3 * e)) ^ 2)
		light *= 1 - S.dark * band
		local alpha = 1 - smoothstep(1 - e, 1, d)
		-- streaks on the turning column
		local phi = theta + spin
		local streak = 0
		for k, f in self.freqs do
			streak += self.amps[k] * math.sin(f * phi + self.phases[k])
		end
		-- foreshortened towards the edges, where the surface turns away
		light *= 1 + S.streaks * streak * (0.4 + 0.6 * nz)
		local v = math.clamp(math.floor(light * 255 + 0.5), 0, 255)
		local a = math.clamp(math.floor(alpha * 255 + 0.5), 0, 255)
		buffer.writeu32(row, x * 4, bit32.bor(v, bit32.lshift(v, 8), bit32.lshift(v, 16), bit32.lshift(a, 24)))
	end
	for y = 0, H - 1 do
		buffer.copy(self.buf, y * W * 4, row, 0, W * 4)
	end
	self.image:WritePixelsBuffer(Vector2.zero, Vector2.new(W, H), self.buf)
end

function FunnelImpostor.destroy(self: FunnelImpostor)
	self.image:Destroy()
end

return FunnelImpostor
