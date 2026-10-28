--!nonstrict
--!native
-- Radar derived from the storm simulation (guide section 16): a Doppler radar at a site samples
-- the same precipitation volume and wind field that make the visible storm.
--   reflectivity   the binned hydrometeor volume (Precip), plus clear-air echo from insects /
--                  dust in the boundary layer (strongest on gust fronts: the fine line), plus
--                  the tornado's lofted debris (TDS) where the tornado actually lofts it
--   radial vel.    the full wind (environment + cold pool + storms + vortices + tornado) projected
--                  on the beam, minus the targets' fall speed on tilted beams; averaged across
--                  the beam width (a small tornado is smeared at range), with noise from the
--                  wind's variability inside the pulse volume, and optional aliasing
--   corr. coeff.   from what fills the pulse volume: rain ~0.99, hail mixtures lower, the
--                  melting layer ~0.93-0.96, biological scatter ~0.3-0.7, debris ~0.3-0.6
-- Beam height: 4/3-earth refraction. Sensitivity falls with range (-15 dBZ at 50 km, +20 log r).
local function dep(name: string): any
	if script then
		return require((script :: any).Parent:FindFirstChild(name))
	end
	return (require :: any)("./" .. name)
end
local Noise = dep("Noise")

local Radar = {}

local sqrt, sin, cos, rad, log10 = math.sqrt, math.sin, math.cos, math.rad, math.log10
local KE_A = 4 / 3 * 6371000

export type Site = {
	x: number, y: number, -- lab metres
	height: number,
	beamwidth: number, -- degrees
	nyquist: number, -- m/s (0: no aliasing)
	maxRange: number,
	seed: number,
}

function Radar.site(x: number, y: number, opts: { [string]: any }?): Site
	local o = opts or {}
	return { x = x, y = y, height = o.height or 20, beamwidth = o.beamwidth or 0.95, nyquist = o.nyquist or 0, maxRange = o.maxRange or 150000, seed = o.seed or 11 }
end

-- height (m above the site's ground) of the beam centre at slant range r, elevation e (deg)
function Radar.beamHeight(r: number, elevDeg: number): number
	local s = sin(rad(elevDeg))
	return sqrt(r * r + KE_A * KE_A + 2 * r * KE_A * s) - KE_A
end

-- The tornado debris signature: lofted debris (a column up to debrisTop around the vortex)
local function debrisAt(tornadoes: { any }?, x: number, y: number, z: number): number
	if not tornadoes then
		return 0
	end
	local best = 0
	for _, t in tornadoes do
		local loft = t.debrisLoft or 0
		if loft > 0.02 and not t.ended then
			local dx, dy = x - t.x, y - t.y
			-- (the lofted debris spreads well beyond the vortex: the radar debris signature of a strong
			-- tornado is ~1-2 km across and grows with how high debris goes - Bodine et al. 2013;
			-- docs/stormlab/RESEARCH-WALLCLOUD-HV.md)
			local R = math.clamp(2.5 * t.rc + 0.25 * (t.debrisTop or 0), 150, 1500)
			local r2 = (dx * dx + dy * dy) / (R * R)
			local top = t.debrisTop or 500
			if r2 < 4 and z < top * 1.3 then
				local f = math.exp(-r2) * math.clamp(1 - z / (top * 1.3), 0, 1)
				best = math.max(best, loft * f)
			end
		end
	end
	return best
end

-- Sample one pulse volume. ctx: { vol (Precip volume with :sample), wind(x, y, z), tornadoes,
-- coldPool (for the fine line), freezing (m) }. Returns dbz (or nil: below sensitivity),
-- radial velocity (m/s, + away), cc, spectrum width.
function Radar.gate(site: Site, ctx: any, azDeg: number, range: number, elevDeg: number, scan: number?): (number?, number, number, number)
	local h = Radar.beamHeight(range, elevDeg) + site.height
	local ground = range * cos(rad(elevDeg))
	local az = rad(azDeg)
	-- azimuth measured clockwise from north: unit vector (sin az, cos az) in (east, north)
	local ex, ey = sin(az), cos(az)
	local cx, cy = site.x + ex * ground, site.y + ey * ground
	-- three samples across the beam (half-power width)
	local half = range * rad(site.beamwidth) * 0.5
	local px, py = -ey, ex
	local zsum, hsum, vsum, v2sum, wsum = 0, 0, 0, 0, 0
	local cm = ctx.coldPool
	local bio = 0
	-- clear-air scatterers (insects, dust) are patchy: a ~7 km field drifting slowly scan to scan
	local patch = 0
	if h < 1800 and cm then
		patch = Noise.fbm3(cx / 7000, cy / 7000, (scan or 0) / 12, site.seed + 77, 2)
	end
	local debris = 0
	for k = -1, 1 do
		local wgt = if k == 0 then 0.5 else 0.25
		local x, y = cx + px * half * k, cy + py * half * k
		local dbz, share = ctx.vol:sample(x, y, h)
		local zl = if dbz > -50 then 10 ^ (dbz / 10) else 0
		-- clear-air echo in the boundary layer: insects, dust, refractive gradients;
		-- concentrated where gust fronts and boundaries converge them (the fine line)
		if h < 1800 and cm then
			local edge = cm.EDGE:sample(x, y)
			-- faint, patchy insect echo in the boundary layer (none in the gaps), fading with range;
			-- fine lines stand out at 10-14 dBZ where gust fronts gather the scatterers
			local p = math.clamp((patch + 0.15) / 0.6, 0, 1)
			local b = 10 ^ ((-10 + 10 * p + 20 * edge) / 10) * (p * p + edge) * math.clamp(1 - h / 1500, 0, 1)
				* math.clamp(1.3 - range / 60000, 0, 1)
			bio += b * wgt
			zl += b
		end
		local d = debrisAt(ctx.tornadoes, x, y, h)
		if d > 0 then
			local zd = 10 ^ ((42 + 18 * d) / 10) * d
			debris += zd * wgt
			zl += zd
		end
		local u, v, w = ctx.wind(x, y, h)
		-- radial component (toward +range), with the targets' fall speed on tilted beams
		local fall = if dbz > 10 then 2 + 0.12 * (dbz - 10) else 0.3
		local se, ce = sin(rad(elevDeg)), cos(rad(elevDeg))
		local vr = (u * ex + v * ey) * ce + (w - fall) * se
		-- Z-weighted average across the beam
		local zw = math.max(zl, 1e-3) * wgt
		vsum += vr * zw
		v2sum += vr * vr * zw
		zsum += zl * wgt
		hsum += share * zl * wgt
		wsum += zw
	end
	if zsum <= 0 then
		return nil, 0, 0, 0
	end
	local dbz = 10 * log10(zsum)
	local minDbz = -15 + 20 * log10(math.max(1000, range) / 50000)
	if dbz < minDbz then
		return nil, 0, 0, 0
	end
	local vr = vsum / wsum
	local sw = sqrt(math.max(0, v2sum / wsum - vr * vr))
	-- noise from the turbulence inside the pulse volume, deterministic per gate and scan
	local seed = site.seed + (scan or 0) * 7
	local n = Noise.hash(math.floor(azDeg * 2), math.floor(range / 250), math.floor(elevDeg * 10), seed) * 2 - 1
	vr += n * (0.8 + 0.25 * sw)
	if site.nyquist > 0 then
		local vn = site.nyquist
		vr = (vr + vn) % (2 * vn) - vn
	end
	-- correlation coefficient by what scatters, weighted by its share of the reflectivity
	local hailShare = hsum / zsum
	local fl = ctx.freezing or 4000
	local melt = math.clamp(1 - math.abs(h - (fl - 250)) / 450, 0, 1)
	local ccMet = 0.992 - 0.1 * hailShare - 0.05 * melt * math.clamp(hailShare * 3 + 0.4, 0, 1)
	if dbz > 55 then
		ccMet -= (dbz - 55) * 0.004 -- resonance from big drops / wet hail
	end
	local met = math.max(0, zsum - bio - debris)
	local ccBio = 0.35 + 0.3 * Noise.hash(math.floor(azDeg), math.floor(range / 500), 3, seed)
	local ccDeb = 0.3 + 0.25 * Noise.hash(math.floor(azDeg * 3), math.floor(range / 200), 5, seed)
	local cc = (met * ccMet + bio * ccBio + debris * ccDeb) / zsum
	cc += (Noise.hash(math.floor(azDeg * 2), math.floor(range / 250), 9, seed) - 0.5) * 0.015
	return dbz, vr, math.clamp(cc, 0.2, 1.0), sw
end

-- Colour tables (NWS-like): returns r, g, b 0..1 or nil for no data
local REF = {
	{ -10, 0.17, 0.17, 0.19 }, { 0, 0.27, 0.27, 0.29 }, { 5, 0.02, 0.92, 0.92 }, { 10, 0.0, 0.62, 0.96 }, { 15, 0.0, 0.0, 0.96 },
	{ 20, 0.0, 1.0, 0.0 }, { 25, 0.0, 0.78, 0.0 }, { 30, 0.0, 0.56, 0.0 }, { 35, 1.0, 1.0, 0.0 },
	{ 40, 0.91, 0.75, 0.0 }, { 45, 1.0, 0.56, 0.0 }, { 50, 1.0, 0.0, 0.0 }, { 55, 0.84, 0.0, 0.0 },
	{ 60, 0.75, 0.0, 0.0 }, { 65, 1.0, 0.0, 1.0 }, { 70, 0.6, 0.33, 0.79 }, { 75, 1.0, 1.0, 1.0 },
}
function Radar.refColour(dbz: number): (number, number, number)
	local last = REF[1]
	for _, e in REF do
		if dbz < e[1] then
			return last[2], last[3], last[4]
		end
		last = e
	end
	return last[2], last[3], last[4]
end

function Radar.velColour(v: number, scale: number?): (number, number, number)
	local s = math.clamp(v / (scale or 35), -1, 1)
	if s < 0 then
		-- toward the radar: greens (bright near zero... dark at extremes inverted like NWS)
		local a = -s
		if a < 0.08 then
			return 0.45, 0.48, 0.45
		end
		return 0.05, 0.25 + 0.75 * a, 0.08 + 0.2 * (1 - a)
	end
	if s < 0.08 then
		return 0.48, 0.45, 0.45
	end
	return 0.25 + 0.75 * s, 0.05 + 0.15 * (1 - s), 0.08
end

local CC = {
	{ 0.2, 0.05, 0.05, 0.3 }, { 0.45, 0.2, 0.2, 0.6 }, { 0.65, 0.3, 0.55, 0.9 }, { 0.75, 0.2, 0.75, 0.9 },
	{ 0.8, 0.1, 0.85, 0.5 }, { 0.85, 0.55, 0.9, 0.1 }, { 0.9, 0.95, 0.9, 0.0 }, { 0.93, 1.0, 0.6, 0.0 },
	{ 0.95, 1.0, 0.25, 0.0 }, { 0.97, 0.85, 0.0, 0.1 }, { 0.985, 0.7, 0.0, 0.35 }, { 1.0, 0.9, 0.7, 0.9 },
}
function Radar.ccColour(cc: number): (number, number, number)
	local last = CC[1]
	for _, e in CC do
		if cc < e[1] then
			return last[2], last[3], last[4]
		end
		last = e
	end
	return last[2], last[3], last[4]
end

return Radar
