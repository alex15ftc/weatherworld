--!strict
-- A storm's big cloud shapes as shaded shells (shared/Weather/CloudShell): the updraught tower
-- with its overshooting top, the anvil spreading downwind (mammatus under it), and the base
-- with the wall cloud lowered out of it (docs/storm-visuals/PLAN.md, phase 9). Every shape and
-- number comes from the storm's fields as the feed sends them; nothing here knows a storm type.
--
--   tower    a column as wide as the updraught (radiusKm), from its base (baseM) to its top
--            (topM), leaning downwind with height; cauliflower lobes (billowing noise) grow up
--            the tower and with the updraught's speed (speedMs); a dome over the top as high as
--            overshootM
--   anvil    from the tower's top downwind along the anvil's bearing, lengthKm long and widthKm
--            wide, a flat top at the anvil's top (topM); thick near the tower and thinning and
--            fraying downwind; reaching back upwind past the tower (back-shear) by more the
--            stronger the updraught; mammatus pouches under it by `mammatus`
--   base     the rain-free base: a flat lens as wide as base.radiusKm at the updraught's base;
--            the wall cloud lowered out of it where the feed puts it (loweringM, radiusKm), flat
--            bottomed, by its strength
-- The shapes are rebuilt a few times a second (they churn slowly); the shading every frame.
--
--   StormMesh.draw(storm, ctx)    -- each storm in view, every frame (ctx: see StormView)
--   StormMesh.sweep(alive)        -- after the storms: drops the ones gone
local Lighting = game:GetService("Lighting")
local Workspace = game:GetService("Workspace")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage.Shared.World.Config)
local CloudShell = require(ReplicatedStorage.Shared.Weather.CloudShell)
local StormKit = require(script.Parent.StormKit)
local SkyLight = require(script.Parent.SkyLight)
local Precip = require(ReplicatedStorage.Shared.Weather.Precip)

local StormMesh = {}

local M = Config.STORM_MESH
local TAU = math.pi * 2

export type Context = {
	at: (number, number, number) -> Vector3,
	heading: (number) -> Vector3,
	km: number, -- studs a km, across
	sky: number, -- studs a metre, up
	camPos: Vector3,
	clock: number,
	dt: number?,
	parent: Instance,
}

type Body = { shell: CloudShell.Shell?, building: boolean }
type Entry = { bodies: { [string]: Body }, shapedAt: number, folder: Folder, id: string?, shapedFrom: Vector3, turn: number, shades: number, job: thread?, jobResult: { any }? }

-- A fixed pool of shell sets, handed from storm to storm (EditableMeshes share a memory budget,
-- and a destroyed one doesn't give its share back at once: building new ones for each storm
-- that came near ran the budget out).
local pool: { Entry } = {}
local entries: { [string]: Entry } = {}

-- Billowing noise (sums of |noise|): rounded bulges with creases between, like cauliflower.
local function billow(x: number, y: number, z: number, octaves: number): number
	local sum, amp, freq, norm = 0, 1, 1, 0
	for _ = 1, octaves do
		sum += amp * math.abs(math.noise(x * freq, y * freq, z * freq))
		norm += amp
		amp *= 0.5
		freq *= 2.1
	end
	return sum / norm -- 0..~0.5
end

-- Rounded lobes: smooth plateaus with soft creases between (billowing noise's sharp creases
-- alias into shards on a mesh; the fine cauliflower texture is the detail particles' job).
-- 0 .. ~0.75, mean ~0.37.
local function rounded(x: number, y: number, z: number): number
	local function plateau(n: number): number
		local t = math.clamp((n + 0.25) / 0.6, 0, 1)
		return t * t * (3 - 2 * t)
	end
	return 0.5 * plateau(math.noise(x, y, z)) + 0.25 * plateau(math.noise(x * 2.1 + 5, y * 2.1, z * 2.1))
end

local function smooth01(x: number): number
	x = math.clamp(x, 0, 1)
	return x * x * (3 - 2 * x)
end

local function body(entry: Entry, key: string, rows: number, cols: number, fringe: boolean?): CloudShell.Shell?
	if Config.STORM_KIT.enabled then
		return nil -- (the kit draws the bodies: no shells, which would use up the mesh budget)
	end
	local b = entry.bodies[key]
	if not b then
		b = { shell = nil, building = true }
		entry.bodies[key] = b
		task.spawn(function()
			-- kept even if its storm has gone meanwhile: the set goes back to the pool whole
			b.shell = CloudShell.build(entry.folder, rows, cols, key, fringe)
			b.building = false
		end)
	end
	return b.shell
end

-- Shapes ------------------------------------------------------------------------------------

-- A line storm (QLCS, line segment, MCS: the feed's `line`): its tower and base stretched along
-- the line's axis, to the line's half length (as much as its share of linear organisation says).
-- Returns a function taking a horizontal offset from the storm's middle, as for a round storm of
-- radius R, to where it lies on the line, and the line's half length (studs; R for a round storm).
local function lineStretch(s: any, ctx: Context, R: number): ((Vector3) -> Vector3, number)
	local line = s.line
	local share = if line then math.clamp((line.share - M.line.fromShare) / (1 - M.line.fromShare), 0, 1) else 0
	local half = if line then math.max(R, line.halfLengthKm * ctx.km * share) else R
	if half <= R * 1.01 then
		return function(v: Vector3): Vector3
			return v
		end, R
	end
	local axis = ctx.heading(line.axisBearingDeg)
	local across = Vector3.new(-axis.Z, 0, axis.X)
	local k = half / R
	local bow = math.clamp(line.bow or 0, 0, 1) * M.line.bowShare
	return function(v: Vector3): Vector3
		local a, c = v:Dot(axis), v:Dot(across)
		local along = a * k
		-- a bowing line: its middle pushed ahead (across), its ends back
		local f = along / half
		return axis * along + across * (c + bow * half * (1 - f * f))
	end, half
end

-- The storm's life (the feed's `life`, js/storms/StormAppearance.js stormLife): towering 1 in the
-- young cumulus stage; decay 0..1 as the updraught collapses; fade 0..1 over an orphan anvil's
-- life (the storm dead, only its anvil left).
local function lifeOf(s: any): (number, number, number)
	local L = s.life
	if not L then
		return 0, 0, 0
	end
	return math.clamp(L.towering or 0, 0, 1), math.clamp(L.decay or 0, 0, 1), math.clamp(L.fade or 0, 0, 1)
end

-- Shapes are made a few rows at a time over several frames (a coroutine, yielding once a frame's
-- budget, M.shapeBudgetMs, is spent): made in one go, the tower took ~23 ms, a hitch.
local sliceStart = 0
local inJob = false -- (only a reshape job yields: elsewhere pace() does nothing)
local function pace()
	if inJob and os.clock() - sliceStart > M.shapeBudgetMs / 1000 then
		coroutine.yield()
		sliceStart = os.clock()
	end
end

-- Where the anvil is: its root over the tower's (leaning) top, along its bearing; its half-width
-- and half-thickness at x studs downwind of the root.
type AnvilFrame = {
	root: Vector3,
	downwind: Vector3,
	across: Vector3,
	length: number,
	back: number,
	topY: number,
	halfWidth: (x: number) -> number,
	halfThick: (x: number) -> number,
}
local function anvilFrame(s: any, ctx: Context): AnvilFrame
	local up, A = s.updraft, s.anvil
	local ground = s.groundStuds or 0
	local topY = ground + A.topM * ctx.sky
	local R = math.max(up.radiusKm * ctx.km, 50)
	local Hup = math.max((math.min(up.topM, A.topM) - up.baseM) * ctx.sky, 100) -- the tower's height
	local downwind = ctx.heading(A.bearingDeg)
	local root = ctx.at(up.xKm, up.yKm, topY) + downwind * (M.tower.lean * Hup)
	-- a young tower has no anvil yet (it spreads as the tower matures); an orphan anvil thins out
	local towering, _, fade = lifeOf(s)
	local grown = 0.12 + 0.88 * smooth01((1 - towering) / 0.8)
	local thinned = 1 - M.life.anvilThin * fade
	local L = math.max(A.lengthKm * ctx.km * M.anvil.lengthShare * grown, 2 * R * grown)
	local W = math.max(A.widthKm * ctx.km, 2 * R)
	local thick = M.anvil.thicknessM * ctx.sky
	local back = R * (M.anvil.back + M.anvil.backPerSpeed * up.speedMs)
	local function ends(x: number): number
		local u = math.clamp((x + back) / (L + back), 0, 1)
		return math.sin(math.pi * u) ^ M.anvil.endRound
	end
	return {
		root = root,
		downwind = downwind,
		across = Vector3.new(-downwind.Z, 0, downwind.X),
		length = L,
		back = back,
		topY = topY,
		halfWidth = function(x: number): number
			local f = math.max(x, 0) / L
			return math.max(R * 0.9, 0.5 * W * (M.anvil.rootWidth + (1 - M.anvil.rootWidth) * math.sqrt(f))) * ends(x) * (0.3 + 0.7 * grown)
		end,
		halfThick = function(x: number): number
			local f = math.max(x, 0) / L
			return 0.5 * thick * (1 - M.anvil.thinning * f) * ends(x) ^ 0.5 * grown * thinned
		end,
	}
end

-- How much of a low sun reaches p through the hazy boundary layer under it: the sun's path
-- through the haze below the layer's top, longer the lower the sun and the lower the point.
local function throughHaze(s: any, ctx: Context, p: Vector3, sun: Vector3): number
	local H = M.light.haze_
	local ground = s.groundStuds or 0
	local depth = (H.layerM * ctx.sky) - (p.Y - ground)
	if depth <= 0 then
		return 1
	end
	local pathKm = depth / ctx.sky / 1000 / math.max(sun.Y, 0.05)
	return math.exp(-H.perKm * pathKm)
end

-- How much of the sun reaches p past the tower standing over it (a few steps up the sun's ray,
-- against the tower's column).
local function underTower(s: any, ctx: Context, p: Vector3, sun: Vector3): number
	if sun.Y <= 0.02 then
		return 1
	end
	local up = s.updraft
	local ground = s.groundStuds or 0
	local baseY = ground + up.baseM * ctx.sky
	local topY = ground + math.min(up.topM, s.anvil.topM) * ctx.sky
	local R = math.max(up.radiusKm * ctx.km, 50)
	local foot = ctx.at(up.xKm, up.yKm, baseY)
	local downwind = ctx.heading(s.anvil.bearingDeg)
	local H = math.max(topY - baseY, 100)
	local shade = 0
	for i = 1, 6 do
		local y = math.max(p.Y, baseY) + (topY - math.max(p.Y, baseY)) * (i - 0.5) / 6
		if y > p.Y then
			local q = p + sun * ((y - p.Y) / sun.Y)
			local w = math.clamp((y - baseY) / H, 0, 1)
			local axis = foot + downwind * (w * w * M.tower.lean * H)
			local d = Vector3.new(q.X - axis.X, 0, q.Z - axis.Z).Magnitude
			shade = math.max(shade, 1 - smooth01((d - 0.7 * R) / (0.5 * R)))
		end
	end
	return 1 - M.light.towerShadow * shade
end

-- How much of the sun reaches p past the anvil above it (the anvil's shadow on the tower, base
-- and wall cloud).
local function underAnvil(af: AnvilFrame, p: Vector3, sun: Vector3): number
	if sun.Y <= 0.02 then
		return 1
	end
	local x0 = (p - af.root):Dot(af.downwind)
	local bottom = af.topY - 2 * af.halfThick(x0)
	if p.Y >= bottom then
		return 1
	end
	local q = p + sun * ((bottom - p.Y) / sun.Y)
	local rel = q - af.root
	local x = rel:Dot(af.downwind)
	if x < -af.back or x > af.length then
		return 1
	end
	local side = math.abs(rel:Dot(af.across))
	local w = af.halfWidth(x)
	-- soft at the edge; a thinner (lighter) shadow toward the anvil's thin downwind end
	local inside = 1 - smooth01((side - 0.8 * w) / (0.4 * w))
	local thin = 1 - 0.6 * smooth01(x / af.length)
	return 1 - M.light.anvilShadow * inside * thin
end

-- The tower: rows up from the base to the top pole, columns round.
local function towerShape(s: any, ctx: Context, rows: number, cols: number, t: number, sun: Vector3): ({ Vector3 }, { number }, { number }, { number })
	local up = s.updraft
	local ground = s.groundStuds or 0
	local baseY = ground + up.baseM * ctx.sky
	-- the column rises into the anvil; only the overshooting top stands above it
	local topY = ground + math.min(up.topM, s.anvil.topM) * ctx.sky
	local H = math.max(topY - baseY, 100)
	local R = math.max(up.radiusKm * ctx.km, 50)
	local foot = ctx.at(up.xKm, up.yKm, baseY)
	local downwind = ctx.heading(s.anvil.bearingDeg)
	local seed = (string.byte(s.id, -1) or 0) * 0.37 + (string.byte(s.id, -2) or 0) * 0.11
	-- cauliflower: more and bigger lobes the stronger the updraught
	local vigour = math.clamp(up.speedMs / M.tower.fastMs, 0.15, 1.2)
	-- the life: a young tower's lobes hard and bulging; a collapsing one slims and smooths out
	local towering, decay = lifeOf(s)
	vigour = vigour * (1 + M.life.toweringLobes * towering) * (1 - 0.8 * decay)
	R *= 1 - M.life.decaySlim * decay
	local stretch = lineStretch(s, ctx, R)
	local dome = math.max(up.overshootM or 0, 0) * ctx.sky
	local af = anvilFrame(s, ctx)
	local points, opacity, albedo, sunlit = table.create(rows * cols), table.create(rows * cols), table.create(rows * cols), table.create(rows * cols)
	for i = 1, rows do
		pace()
		local th = math.pi * (i - 1) / (rows - 1) -- 0 at the bottom pole, pi at the top
		local sn, cs = math.sin(th), math.cos(th)
		-- a rounded column: straight sides, a flat-ish bottom, a domed top
		local w = (1 - (if cs >= 0 then 1 else -1) * math.abs(cs) ^ M.tower.squareness) / 2 -- 0 bottom .. 1 top
		local rr = math.abs(sn) ^ M.tower.squareness
		local y = baseY + H * w
		-- narrowing a little up the column, with the top under the anvil
		local profile = R * (1 - M.tower.taper * w)
		local lean = downwind * (w * w * M.tower.lean * H)
		for j = 1, cols do
			local a = TAU * (j - 1) / cols
			local dir = Vector3.new(math.cos(a), 0, math.sin(a))
			local ux, uz = dir.X * rr, dir.Z * rr
			-- lobes as round bubbles on screen: noise round in studs (the world is drawn taller than
			-- wide: 1 stud a metre up, ~0.62 across; round in km they showed as tall drapes)
			local lk = M.tower.lobeKm * ctx.km
			-- (on a line, the noise where the point lies on the line, so the lobes stay round)
			local plain = stretch(Vector3.new(ux * profile, 0, uz * profile))
			local yk = y - baseY
			local lobes = rounded(plain.X / lk + seed, yk / lk - t * M.tower.churn, plain.Z / lk)
			local swell = vigour * (M.tower.lobes * (0.3 + w * w)) * (lobes - 0.37) * 2
			-- swelling out from the surface (round: out from the axis)
			local out = plain - stretch(Vector3.new(ux * profile, 0, uz * profile) * 0.97)
			out = if out.Magnitude > 1e-3 then out.Unit else Vector3.zero
			local off = plain + out * (profile * rr * swell)
			local p = foot + lean + off + Vector3.new(0, y - baseY, 0)
			-- the dome over the top: lobes push up as well as out
			if w > 0.8 then
				local topness = (w - 0.8) / 0.2
				p += Vector3.new(0, topness * topness * (dome + vigour * M.tower.lobes * 0.12 * R * (lobes - 0.37) * 2), 0)
			end
			local k = (i - 1) * cols + j
			points[k] = p
			opacity[k] = 1
			-- the creases between lobes see less light
			albedo[k] = 1 - M.tower.crease * (1 - smooth01(lobes / 0.5))
			sunlit[k] = underAnvil(af, p, sun) * throughHaze(s, ctx, p, sun)
		end
	end
	return points, opacity, albedo, sunlit
end

-- The anvil: rows from its upwind end to its downwind end, columns round its cross-section.
local function anvilShape(s: any, ctx: Context, rows: number, cols: number, t: number, _sun: Vector3): ({ Vector3 }, { number }, { number }, { number })
	local af = anvilFrame(s, ctx)
	local A = s.anvil
	local seed = (string.byte(s.id, -1) or 0) * 0.29
	local mamma = math.clamp(A.mammatus or 0, 0, 1)
	local L, back = af.length, af.back
	local Wref = af.halfWidth(L * 0.6) * 2
	local points, opacity, albedo, sunlit = table.create(rows * cols), table.create(rows * cols), table.create(rows * cols), table.create(rows * cols)
	for i = 1, rows do
		pace()
		local u = (i - 1) / (rows - 1) -- 0 upwind end .. 1 downwind end
		local x = -back + (L + back) * u
		local f = math.max(x, 0) / L -- share of the way downwind
		local halfW, halfT = af.halfWidth(x), af.halfThick(x)
		for j = 1, cols do
			local a = TAU * (j - 1) / cols
			local ca, sa = math.cos(a), math.sin(a)
			-- a flat-topped, flat-bottomed section (a superellipse)
			local ex = M.anvil.squareness
			local cx = (if ca >= 0 then 1 else -1) * math.abs(ca) ^ ex
			local cy = (if sa >= 0 then 1 else -1) * math.abs(sa) ^ ex
			local side = cx * halfW
			-- the top stays flat at the tropopause; the body hangs below it
			local y = af.topY - halfT + cy * halfT
			-- fibres streaming downwind, and a ragged edge
			local fibre = math.noise(x / (Wref * 0.8) + seed, side / (Wref * 0.05), t * 0.02)
			-- mammatus: pouches on the underside, in the older (downwind) part
			if sa < -0.3 and mamma > 0 then
				local pouch = math.noise(x / (Wref * 0.09) + 3.1, side / (Wref * 0.09), seed)
				local where = smooth01((f - 0.08) / 0.2) * (1 - smooth01((f - 0.7) / 0.3))
				y -= mamma * where * M.anvil.mammaDepthM * ctx.sky * math.max(pouch + 0.15, 0) ^ 2 * 4 * (-sa)
			end
			local p = af.root + af.downwind * x + af.across * side * (1 + 0.06 * fibre) + Vector3.new(0, y - af.topY, 0)
			-- cauliflower knuckles over the young (upwind) part, where the updraught spreads out;
			-- out from the section's middle, mostly on the top and sides
			local young = (1 - smooth01(f / M.anvil.knuckleReach)) * (1 - 0.6 * math.max(-sa, 0))
			local bumpOf = 0.37
			if young > 0.01 then
				local lk = M.tower.lobeKm * ctx.km -- (round in studs, as the tower's)
				-- (relative to the anvil's root: the pattern moves with the storm, not slides through it)
				local q = p - af.root
				local bump = rounded(q.X / lk + seed, q.Y / lk, q.Z / lk)
				bumpOf = bump
				local mid = af.root + af.downwind * x + Vector3.new(0, -halfT, 0)
				local outward = p - mid
				outward = if outward.Magnitude > 1e-3 then outward.Unit else Vector3.yAxis
				p += outward * (M.anvil.knuckles * halfT * young * (bump - 0.37) * 4)
			end
			local k = (i - 1) * cols + j
			points[k] = p
			opacity[k] = 1
			-- streaks along the wind on the underside and edges
			albedo[k] = (1 - M.anvil.streaks * (0.5 + 0.5 * fibre) * (1 - math.max(sa, 0)))
				* (1 - M.tower.crease * 0.6 * young * (1 - smooth01(bumpOf / 0.5)))
			sunlit[k] = 1
		end
	end
	return points, opacity, albedo, sunlit
end

-- The base: a flat lens (rows from the bottom pole up to the top pole, columns round), with the
-- wall cloud hanging out of its underside.
local function baseShape(s: any, ctx: Context, rows: number, cols: number, t: number, sun: Vector3): ({ Vector3 }, { number }, { number }, { number })
	local up, wall = s.updraft, s.wallCloud
	local ground = s.groundStuds or 0
	local baseY = ground + up.baseM * ctx.sky
	local Rb = math.max(s.base.radiusKm * ctx.km, 100)
	local centre = ctx.at(up.xKm, up.yKm, baseY)
	local thick = M.base.thicknessM * ctx.sky
	local wc = ctx.at(wall.xKm, wall.yKm, baseY)
	local wr = math.max(wall.radiusKm * ctx.km, 30)
	local lower = math.max(wall.loweringM or 0, 0) * ctx.sky * smooth01(wall.strength / 0.3)
	local spin = t * (0.05 + 0.4 * (wall.rotation or 0))
	local af = anvilFrame(s, ctx)
	local baseStretch, half = lineStretch(s, ctx, Rb)
	-- lumps no smaller than a few columns apart (stretched along a line, the columns spread out;
	-- finer noise lands on them as shards)
	local lumpStuds = math.max(Rb * 0.18, 3 * (2 * (half + Rb)) / cols)
	local points, opacity, albedo, sunlit = table.create(rows * cols), table.create(rows * cols), table.create(rows * cols), table.create(rows * cols)
	for i = 1, rows do
		pace()
		local th = math.pi * (i - 1) / (rows - 1)
		local sn, cs = math.sin(th), math.cos(th)
		local rr = math.abs(sn) ^ M.base.squareness
		local yy = -(if cs >= 0 then 1 else -1) * math.abs(cs) ^ M.base.squareness -- -1 bottom .. 1 top
		for j = 1, cols do
			local a = TAU * (j - 1) / cols
			local dir = Vector3.new(math.cos(a), 0, math.sin(a))
			-- a ragged rim (bays and tongues at two scales)
			local rag = 1 + M.base.rag * (math.noise(dir.X * 2.2, dir.Z * 2.2, t * 0.01) + 0.5 * math.noise(dir.X * 6.5 + 7, dir.Z * 6.5, t * 0.02))
			local p = centre + baseStretch(dir * (rr * Rb * rag)) + Vector3.new(0, yy * thick * 0.5 + thick * 0.5, 0)
			-- lumps hanging under it (scud-like), more toward the rim
			if yy < 0 then
				local q = p - centre -- (relative to the storm: moves with it)
				local lump = rounded(q.X / lumpStuds, q.Z / lumpStuds, t * 0.01)
				p -= Vector3.new(0, M.base.lumps * thick * (-yy) * lump * (0.4 + 0.6 * rr), 0)
			end
			local dark = 1
			if yy < 0 and lower > 0 then
				-- the wall cloud: a flat-bottomed lowering, ragged at its edge, turning slowly
				local d = Vector3.new(p.X - wc.X, 0, p.Z - wc.Z)
				local dd = d.Magnitude
				local ang = math.atan2(d.Z, d.X) + spin
				local edgeRag = 1 + 0.25 * math.noise(math.cos(ang) * 2, math.sin(ang) * 2, t * 0.03)
				local shape = 1 - smooth01((dd / (wr * edgeRag) - M.base.wallFlat) / (1 - M.base.wallFlat + 0.3))
				p -= Vector3.new(0, lower * shape * (-yy) ^ 0.5, 0)
				dark = 1 - M.base.wallDark * shape
			end
			-- laminar tiers round the updraught (striations), wound by its rotation, stronger the more
			-- striated the feed says it is; seen as bands of lighter and darker cloud on the base
			local striation = math.clamp(up.striation or 0, 0, 1)
			if striation > 0.02 then
				local rk = rr * Rb / ctx.km
				local wind = (up.rotation or 0) * M.base.bandTwist * (math.atan2(dir.Z, dir.X) / TAU)
				local band = 0.5 + 0.5 * math.sin(TAU * (rk / M.base.bandKm + wind))
				dark *= 1 - M.base.bandDark * striation * band
				-- the tiers step the edge up a little, like a stack of plates
				p += Vector3.new(0, M.base.tierM * ctx.sky * striation * band * rr, 0)
			end
			local k = (i - 1) * cols + j
			points[k] = p
			opacity[k] = 1
			albedo[k] = dark * M.base.albedo
			sunlit[k] = underAnvil(af, p, sun) * underTower(s, ctx, p, sun) * throughHaze(s, ctx, p, sun)
		end
	end
	return points, opacity, albedo, sunlit
end

-- Light ---------------------------------------------------------------------------------------

local function sceneLight(): CloudShell.Light
	local sun = Lighting:GetSunDirection()
	local elev = math.clamp(sun.Y, -0.2, 1)
	-- the sun reddens and weakens toward the horizon, and goes below it at night
	local low = 1 - smooth01(elev / M.light.warmBelow)
	local strength = M.light.sun * smooth01((elev + 0.05) / 0.12)
	local sunColour = Color3.new(1, 0.95 - 0.35 * low, 0.88 - 0.6 * low)
	local dayLevel = 0.15 + 0.85 * smooth01((elev + 0.1) / 0.3)
	local skyLevel = M.light.sky * dayLevel
	local sky = M.light.skyColour
	return {
		sun = sun,
		sunColour = Color3.new(sunColour.R * strength, sunColour.G * strength, sunColour.B * strength),
		skyColour = Color3.new(sky.R * skyLevel, sky.G * skyLevel, sky.B * skyLevel),
		-- light from below (the ground, and the bright horizon round the storm): its own level, by
		-- daylight only (scaled by the sky's level as well, undersides came out near black)
		groundColour = Color3.new(M.light.ground.R * dayLevel, M.light.ground.G * dayLevel, M.light.ground.B * dayLevel),
		-- the air between: blue-grey by day, warmer as the sun lowers (sunlit haze), dark at night
		haze = M.light.haze:Lerp(M.light.lowSunHaze, low * 0.35):Lerp(Color3.new(0.08, 0.09, 0.12), 1 - smooth01((elev + 0.1) / 0.3)),
		-- how far one sees: SkyLight's, from the weather (humidity, dust, rain) at the camera
		visibility = (SkyLight.visibilityKm() or M.light.visibilityKm) * 621,
		wrap = M.light.wrap,
		silver = M.light.silver,
		soft = M.light.soft,
		exposure = M.light.exposure,
	}
end

-- Drawing -----------------------------------------------------------------------------------

-- The scale in steps of 5%: from the camera any scale looks the same (the copy lies along the view
-- rays), and a changed scale moves every vertex, so it changes only now and then.
-- (the scale is continuous: shells scale their part, puffs their size at 1% steps)
local function quantise(k: number): number
	return k
end

-- The shelf cloud: a wedge along the gust front (the feed's shelf and gustFront). Rows run along
-- the shelf (a straight run along a line's axis, or an arc round a cell's outflow), columns round
-- its section: the nose low and in front, the top a smooth slope back up into the base, stepped in
-- tiers, and a dark, turbulent underside behind the leading edge (the whale's mouth).
local function shelfShape(s: any, ctx: Context, rows: number, cols: number, t: number, sun: Vector3): ({ Vector3 }, { number }, { number }, { number })
	local sh, gf, up = s.shelf, s.gustFront, s.updraft
	local ground = s.groundStuds or 0
	local baseY = ground + up.baseM * ctx.sky
	local strength = math.clamp((sh.strength or 0) / M.shelf.fullStrength, 0, 1)
	local centre = ctx.at(up.xKm, up.yKm, ground)
	local R = math.max(up.radiusKm * ctx.km, 50)
	local lead = ((gf.radiusKm or 0) * 0.6 + (gf.leadKm or 0) + 2 * (sh.detached or 0)) * ctx.km
	local facing = ctx.heading(sh.facingDeg)
	local straight = (sh.halfArcDeg or 0) <= 0 or (s.line and s.line.share > M.line.fromShare)
	local axis = Vector3.new(-facing.Z, 0, facing.X)
	local halfLen = if straight then math.max((s.line and s.line.halfLengthKm or 8) * ctx.km, 8 * ctx.km) else 0
	local arcRad = math.rad(math.max(sh.halfArcDeg or 30, 10))
	-- the section: depth back from the nose, the nose's height, the top where it meets the base
	local depth = M.shelf.depthKm * ctx.km * (0.6 + 0.4 * strength)
	local noseY = ground + math.max(sh.heightM or 600, 200) * ctx.sky * M.shelf.noseShare
	local topY = baseY + M.shelf.riseM * ctx.sky * strength
	local tiers = math.max(1, sh.tiers or 1)
	local seed = (string.byte(s.id, -1) or 0) * 0.31
	-- lumps no smaller than a few rows apart (a line's shelf runs 100+ km on a few dozen rows;
	-- finer noise lands on the rows as spikes)
	local runStuds = if straight then 2 * halfLen else (R + lead) * 2 * arcRad
	local lumpStuds = math.max(M.shelf.lumpKm * ctx.km, 3 * runStuds / math.max(rows - 1, 1))
	local _, _, fade = lifeOf(s)
	local af = anvilFrame(s, ctx)
	local points, opacity, albedo, sunlit = table.create(rows * cols), table.create(rows * cols), table.create(rows * cols), table.create(rows * cols)
	for i = 1, rows do
		pace()
		local u = (i - 1) / (rows - 1) * 2 - 1 -- -1 .. 1 along the shelf
		-- where along: the nose's line on the ground, and the way "forward" there
		local at, fwd
		if straight then
			at = centre + facing * lead + axis * (u * halfLen)
			fwd = facing
		else
			local a = math.atan2(facing.Z, facing.X) + u * arcRad
			fwd = Vector3.new(math.cos(a), 0, math.sin(a))
			at = centre + fwd * (R + lead)
		end
		-- tapering at the ends
		local ends = math.sin(math.pi * (u + 1) / 2) ^ 0.4
		for j = 1, cols do
			local a = TAU * (j - 1) / cols
			local ca, sa = math.cos(a), math.sin(a)
			-- an ellipse in (forward, up), from the nose (forward) back under the base
			local x = (ca * 0.5 + 0.5) -- 0 at the back, 1 at the nose
			local back = depth * (1 - x)
			-- height: the top slopes from the nose up to the base; the underside sits a little under it
			local top = noseY + (topY - noseY) * (1 - x) ^ 0.7
			local thick = (top - noseY) * 0.35 + 60 * ctx.sky
			local y = if sa >= 0 then top - thick * (1 - sa) * 0.15 else top - thick * (0.15 + 0.85 * -sa)
			-- tiers: steps in the top surface
			-- (soft steps: a hard step falls between columns as a facet)
			if sa > 0 and tiers > 1 then
				local f = x * tiers
				local fl = math.floor(f)
				local step = (fl + smooth01((f - fl - 0.6) / 0.4)) / tiers
				y += (step - x) * (topY - noseY) * M.shelf.tierStep * sa
			end
			-- the underside: lumpy, turbulent (whale's mouth)
			local dark = 1
			if sa < 0 then
				local q = at - centre
				local lump = rounded((q.X - back * fwd.X) / lumpStuds + seed, (q.Z - back * fwd.Z) / lumpStuds, t * 0.01)
				y -= M.shelf.lumpM * ctx.sky * lump * (-sa)
				dark = M.shelf.underAlbedo
			end
			-- (pinched to the nose height at the ends)
			local yEnd = noseY + (y - noseY) * ends
			local p = Vector3.new(at.X - fwd.X * back * ends, yEnd, at.Z - fwd.Z * back * ends)
			local k = (i - 1) * cols + j
			points[k] = p
			opacity[k] = 1
			albedo[k] = dark * M.shelf.albedo * (1 - 0.8 * fade)
			-- (under the anvil and in the tower's shadow, as the base is; its nose often in the sun)
			sunlit[k] = underAnvil(af, p, sun) * underTower(s, ctx, p, sun) * throughHaze(s, ctx, p, sun)
		end
	end
	return points, opacity, albedo, sunlit
end

local BODY_ORDER = { "tower", "anvil", "base", "shelf", "puffs" }

local SHAPES = {
	tower = towerShape,
	anvil = anvilShape,
	base = baseShape,
	shelf = shelfShape,
}

-- Whether a storm has this body at all (a shelf only where the feed has one).
local function hasBody(s: any, key: string): boolean
	if key == "shelf" then
		return (s.shelf and s.shelf.strength or 0) > M.shelf.minStrength
	end
	return true
end

-- Particles --------------------------------------------------------------------------------
-- The tornado's way (soft, volumetric) at storm scale. Two styles use them:
--   "puffs"   the whole storm as puffs on a coarse version of each body's surface
--   "hybrid"  the shells carry the structure (tower lobes, flat anvil, thin base) and particles
--             everything soft: detail over the tower, the anvil's frayed sides, the base's lumpy
--             underside and wall cloud, scud drifting round the wall cloud and rising into it,
--             and rain shafts where the feed's rain is
-- Puffs are coloured by the same light as the shells, and drawn at the storm's one scale k (the
-- shells' too), so they keep their order in depth with them: everything within the particles'
-- reach (~800 studs) of the camera.

type Anchor = {
	world: Vector3,
	size: number,
	colour: Color3,
	texture: string,
	transparency: number,
	vel: Vector3?, -- studs a second (scud drifting)
	follow: ((clock: number) -> Vector3)?, -- where it is at this clock (scud on its path)
	followShift: Vector3?,
	fadeAt: ((clock: number) -> number)?, -- its transparency at this clock
}
type Puff = { part: BasePart, emitter: ParticleEmitter, a: Anchor?, texture: string, transparency: number, size: number, near: number }
type PuffSet = { id: string?, folder: Folder, puffs: { Puff }, used: number, shapedAt: number, k: number, normals: { Vector3 }, shapedFrom: Vector3 }
local puffPool: { PuffSet } = {}
local puffSets: { [string]: PuffSet } = {}
local TornadoConfig = require(ReplicatedStorage.Shared.Tornado.Config)

local function hash01(a: number, b: number): number
	local x = math.sin(a * 127.1 + b * 311.7) * 43758.5453
	return x - math.floor(x)
end

local function fadeSequence(t: number): NumberSequence
	return NumberSequence.new({
		NumberSequenceKeypoint.new(0, 1),
		NumberSequenceKeypoint.new(0.25, t),
		NumberSequenceKeypoint.new(0.75, t),
		NumberSequenceKeypoint.new(1, 1),
	})
end

local function newPuff(folder: Folder): Puff
	local part = Instance.new("Part")
	part.Anchored, part.CanCollide, part.CanQuery, part.CanTouch = true, false, false, false
	part.Transparency = 1
	part.Size = Vector3.one
	local e = Instance.new("ParticleEmitter")
	e.LockedToPart = true
	e.Speed = NumberRange.new(0)
	e.Rotation = NumberRange.new(-180, 180)
	e.RotSpeed = NumberRange.new(-2, 2)
	e.LightInfluence = 0 -- self-lit, like the shells: the colour is the whole look
	e.LightEmission = 0
	local P = M.puffs
	e.Lifetime = NumberRange.new(P.life * 0.8, P.life * 1.2)
	e.Rate = P.perPuff / P.life
	e.Parent = part
	part.Parent = folder
	return { part = part, emitter = e, a = nil, texture = "", transparency = -1, size = -1, near = 1 }
end

local function puffSet(s: any, ctx: Context): PuffSet?
	local set = puffSets[s.id]
	if set then
		return set
	end
	for _, e in puffPool do
		if e.id == nil then
			set = e
			break
		end
	end
	if not set then
		if #puffPool >= M.storms then
			return nil
		end
		local folder = Instance.new("Folder")
		folder.Name = "StormPuffs" .. (#puffPool + 1)
		set = { id = nil, folder = folder, puffs = {}, used = 0, shapedAt = -math.huge, k = -1, normals = {}, shapedFrom = Vector3.zero }
		table.insert(puffPool, set :: PuffSet)
	end
	local e = set :: PuffSet
	e.id = s.id
	e.shapedAt = -math.huge
	e.folder.Parent = ctx.parent
	puffSets[s.id] = e
	return e
end

-- Puffs over a body's surface grid: rows fromRow..toRow, only where keep(i, j) says; each as wide
-- as the gap to its neighbours x sizeX (at most maxKm), its middle `inset` of its size inside.
local function surfacePuffs(out: { Anchor }, set: PuffSet, s: any, ctx: Context, light: CloudShell.Light, key: string, spec: any)
	local _, lifeDecay, lifeFade = lifeOf(s)
	if (lifeFade > 0 and key ~= "anvil") or not hasBody(s, key) then
		return -- (an orphan anvil: the tower and base are gone; no shelf without one)
	end
	local rows, cols = spec[1], spec[2]
	local points, opacity, albedo, sunlit = SHAPES[key](s, ctx, rows, cols, ctx.clock, light.sun)
	local normals = set.normals
	CloudShell.gridNormals(points, rows, cols, normals)
	for i = spec.fromRow or 1, spec.toRow or rows do
		pace()
		for j = 1, cols do
			if spec.keep == nil or spec.keep(i, j, rows, cols) then
				local k = (i - 1) * cols + j
				local nextP = points[(i - 1) * cols + j % cols + 1]
				local upP = points[math.min(i, rows - 1) * cols + j]
				local gap = math.max((nextP - points[k]).Magnitude, (upP - points[k]).Magnitude * 0.7, 1)
				local size = gap * spec.sizeX
				if spec.maxKm then
					size = math.min(size, spec.maxKm * ctx.km)
				end
				local o = opacity[k]
				if o > 0.05 then
					table.insert(out, {
						world = points[k] - normals[k] * size * (spec.inset or 0.3),
						size = size,
						colour = CloudShell.shade(points[k], normals[k], ctx.camPos, light, albedo[k] * (spec.albedo or 1), sunlit[k]),
						texture = spec.texture,
						transparency = 1 - (1 - spec.transparency) * o * (1 - M.life.decayFray * lifeDecay) * (1 - lifeFade),
					})
				end
			end
		end
	end
end

-- Scud: torn fragments under the base round the wall cloud, turning with it and rising into it
-- (more, and faster, the stronger the wall cloud and inflow).
local function scudPuffs(out: { Anchor }, s: any, ctx: Context, light: CloudShell.Light)
	local S = M.scud
	local wall, up = s.wallCloud, s.updraft
	local strength = math.clamp(math.max(wall.strength or 0, (s.inflowBands.strength or 0) * 0.6), 0, 1)
	local n = math.floor(S.count * strength + 0.5)
	if n == 0 then
		return
	end
	local ground = s.groundStuds or 0
	local baseY = ground + up.baseM * ctx.sky
	local wc = ctx.at(wall.xKm, wall.yKm, baseY)
	local wr = math.max(wall.radiusKm * ctx.km, 100)
	local lower = math.max(wall.loweringM or 0, 0) * ctx.sky
	local spin = (0.02 + 0.08 * (wall.rotation or 0)) -- radians a second, round the wall cloud
	local seed = string.byte(s.id, -1) or 0
	for i = 1, n do
		local r = wr * (S.from + (S.to - S.from) * hash01(i, seed))
		local h0, h3, h5 = hash01(i, seed + 7), hash01(i, seed + 3), hash01(i, seed + 5)
		-- each fragment's life: it drifts in and up over S.cycle seconds, then starts again
		local function at(clock: number): Vector3
			local phase = (clock / S.cycle + h0) % 1
			local a = TAU * h3 + spin * clock
			local inward = 1 - 0.5 * phase
			local height = baseY - lower - (S.depthM * ctx.sky) * (1 - phase) * (0.4 + 0.6 * h5)
			return Vector3.new(wc.X + math.cos(a) * r * inward, height, wc.Z + math.sin(a) * r * inward)
		end
		local phase = (ctx.clock / S.cycle + h0) % 1
		local a = TAU * h3 + spin * ctx.clock
		local p = at(ctx.clock)
		local size = S.sizeKm * ctx.km * (0.6 + 0.8 * hash01(i, seed + 9))
		local nrm = (ctx.camPos - p).Unit
		table.insert(out, {
			world = p,
			size = size,
			colour = CloudShell.shade(p, Vector3.new(nrm.X, -0.3, nrm.Z).Unit, ctx.camPos, light, S.albedo, 0.3),
			texture = S.texture,
			-- fading in as it forms low down, and out as it merges into the wall cloud
			transparency = 1 - (1 - S.transparency) * math.sin(math.pi * phase),
			follow = at,
			fadeAt = function(clock: number): number
				return 1 - (1 - S.transparency) * math.sin(math.pi * ((clock / S.cycle + h0) % 1))
			end,
		})
	end
end

-- Rain shafts: soft grey columns from the base to the ground across the feed's rain ellipse,
-- denser where it is heavier (rain.intensity); hail whiter (hail.sizeInches).
local function rainPuffs(out: { Anchor }, s: any, ctx: Context, light: CloudShell.Light)
	local R = M.rain
	local rain, up = s.rain, s.updraft
	if rain.intensity < 0.03 then
		return
	end
	local ground = s.groundStuds or 0
	local baseY = ground + up.baseM * ctx.sky
	local along = ctx.heading(rain.bearingDeg)
	local across = Vector3.new(-along.Z, 0, along.X)
	local centre = ctx.at(rain.xKm, rain.yKm, ground)
	local seed = string.byte(s.id, -1) or 0
	local hailShare = math.clamp((s.hail.sizeInches or 0) / 2, 0, 1) * math.clamp(s.hail.radiusKm / 3, 0, 1)
	local width = R.widthKm * ctx.km
	local levels = math.max(2, math.ceil((baseY - ground) / (width * 0.7)))
	for i = 1, R.columns do
		local u, v = hash01(i, seed) * 2 - 1, hash01(i, seed + 1) * 2 - 1
		if u * u + v * v <= 1 then
			local foot = centre + along * (u * rain.alongKm * ctx.km * 0.5) + across * (v * rain.acrossKm * ctx.km * 0.5)
			local core = 1 - (u * u + v * v) -- heavier in the middle
			local dense = rain.intensity * (0.4 + 0.6 * core)
			for l = 1, levels do
				local y = ground + (baseY - ground) * ((l - 0.5) / levels)
				local p = Vector3.new(foot.X, y, foot.Z)
				local nrm = (ctx.camPos - p)
				nrm = Vector3.new(nrm.X, 0, nrm.Z).Unit
				table.insert(out, {
					world = p,
					size = width * (0.9 + 0.3 * hash01(i, l)),
					colour = CloudShell.shade(p, nrm, ctx.camPos, light, R.albedo + (1 - R.albedo) * hailShare * R.hailWhite, R.lit),
					texture = R.texture,
					-- thinning toward the top, where it comes out of the base
					transparency = 1 - math.clamp(R.opacity * dense * (1 - 0.35 * (l - 1) / levels), 0, 0.9),
				})
			end
		end
	end
end

local drawRain: (any, Context, number, Vector3, CloudShell.Light, boolean) -> ()

-- Rain shafts as streaked Beams (cheap, and they read as falling rain, not smoke): one a column
-- across the feed's rain ellipse, from the base to the ground, the streak texture scrolling down;
-- opacity from the rain's intensity (heavier in the core), whiter with hail. Drawn at the storm's
-- scale, as the clouds are.
type Shaft = { part: BasePart, beam: Beam, top: Attachment, foot: Attachment, world: Vector3, height: number, width: number }
local shaftSets: { [string]: { shafts: { Shaft }, folder: Folder } } = {}
local ART = Config.CLOUD_ART

local function newShaft(folder: Folder): Shaft
	local part = Instance.new("Part")
	part.Anchored, part.CanCollide, part.CanQuery, part.CanTouch = true, false, false, false
	part.Transparency = 1
	part.Size = Vector3.one
	local top, foot = Instance.new("Attachment"), Instance.new("Attachment")
	top.Parent, foot.Parent = part, part
	local b = Instance.new("Beam")
	b.Attachment0, b.Attachment1 = top, foot
	b.FaceCamera = true
	b.Segments = 1
	b.LightInfluence = 0
	b.LightEmission = 0
	b.Texture = if ART.rainShaft and ART.rainShaft ~= "" then ART.rainShaft else ART.rain
	b.TextureMode = Enum.TextureMode.Wrap
	b.TextureSpeed = M.rain.scroll
	b.Parent = part
	part.Parent = folder
	return { part = part, beam = b, top = top, foot = foot, world = Vector3.zero, height = 1, width = 1 }
end

local rainParts: { BasePart } = {}
local rainFrames: { CFrame } = {}
drawRain = function(s: any, ctx: Context, k: number, moved: Vector3, light: CloudShell.Light, restyle: boolean)
	local R = M.rain
	local set = shaftSets[s.id]
	if not set then
		local folder = Instance.new("Folder")
		folder.Name = "Rain_" .. s.id
		folder.Parent = ctx.parent
		set = { shafts = {}, folder = folder }
		shaftSets[s.id] = set
		restyle = true
	end
	local rain, up = s.rain, s.updraft
	local ground = s.groundStuds or 0
	local baseY = ground + up.baseM * ctx.sky
	if restyle then
		local along = ctx.heading(rain.bearingDeg)
		local across = Vector3.new(-along.Z, 0, along.X)
		local centre = ctx.at(rain.xKm, rain.yKm, ground)
		local seed = string.byte(s.id, -1) or 0
		-- Columns: from the radar grid (the cells with rain, strongest first) when the feed has it,
		-- else spread over the rain ellipse.
		local cols: { { x: number, y: number, dense: number, hail: number } } = {}
		local g = s.precip
		if g and g.dbz then
			for j = 1, g.rows do
				for i = 1, g.cols do
					local dbz = g.dbz[(j - 1) * g.cols + i]
					if dbz >= R.minDbz then
						local x, y = Precip.cell(g, i, j)
						local hailIn = if g.hailIn then g.hailIn[(j - 1) * g.cols + i] else 0
						table.insert(cols, { x = x, y = y, dbz = dbz, dense = math.clamp((dbz - R.minDbz) / (R.fullDbz - R.minDbz), 0, 1), hail = math.clamp(hailIn / 1.5, 0, 1) } :: any)
					end
				end
			end
			table.sort(cols, function(p, q)
				return (p :: any).dbz > (q :: any).dbz
			end)
			while #cols > R.maxCells do
				table.remove(cols)
			end
		elseif rain.intensity >= 0.03 then
			local hailShare = math.clamp((s.hail.sizeInches or 0) / 2, 0, 1) * math.clamp(s.hail.radiusKm / 3, 0, 1)
			for i = 1, R.columns do
				local u, v = hash01(i, seed) * 2 - 1, hash01(i, seed + 1) * 2 - 1
				if u * u + v * v <= 1 then
					local foot = Vector3.new(rain.xKm, 0, rain.yKm)
						+ Vector3.new(along.X, 0, along.Z) * (u * rain.alongKm * 0.5) + Vector3.new(across.X, 0, across.Z) * (v * rain.acrossKm * 0.5)
					table.insert(cols, { x = foot.X, y = foot.Z, dense = rain.intensity * (0.4 + 0.6 * (1 - (u * u + v * v))), hail = hailShare })
				end
			end
		end
		local n = 0
		for i, cell in cols do
			n += 1
			local sh = set.shafts[n] or newShaft(set.folder)
			set.shafts[n] = sh
			local foot = ctx.at(cell.x, cell.y, ground)
			sh.world = foot - moved
			sh.height = baseY - ground
			sh.width = (if g then g.cellKm * R.cellWidth else R.widthKm * (0.8 + 0.5 * hash01(i, seed + 2))) * ctx.km
			local mid = Vector3.new(foot.X, (ground + baseY) / 2, foot.Z)
			local nrm = Vector3.new(ctx.camPos.X - mid.X, 0, ctx.camPos.Z - mid.Z)
			nrm = if nrm.Magnitude > 1 then nrm.Unit else Vector3.xAxis
			local c = CloudShell.shade(mid, nrm, ctx.camPos, light, R.albedo + (1 - R.albedo) * cell.hail * R.hailWhite, R.lit)
			local a = math.clamp(R.floor + R.opacity * cell.dense, 0, 0.95)
			-- (Workspace attribute DebugShafts: solid red, to see where they are)
			if Workspace:GetAttribute("DebugShafts") then
				c, a = Color3.new(1, 0, 0), 1
			end
			sh.beam.Color = ColorSequence.new(c)
			sh.beam.Transparency = NumberSequence.new({
				NumberSequenceKeypoint.new(0, 1 - a * 0.55),
				NumberSequenceKeypoint.new(0.25, 1 - a),
				NumberSequenceKeypoint.new(1, 1 - a),
			})
			sh.beam.Enabled = true
		end
		for i = n + 1, #set.shafts do
			set.shafts[i].beam.Enabled = false
		end
		StormMesh.stats.shafts = n
		StormMesh.stats.rainIntensity = rain.intensity
	end
	table.clear(rainParts)
	table.clear(rainFrames)
	for _, sh in set.shafts do
		if sh.beam.Enabled then
			local foot = ctx.camPos + (sh.world + moved - ctx.camPos) * k
			table.insert(rainParts, sh.part)
			table.insert(rainFrames, CFrame.new(foot))
			local h = sh.height * k
			if math.abs(sh.top.Position.Y - h) > 0.01 * h then
				sh.top.Position = Vector3.new(0, h, 0)
				sh.beam.Width0, sh.beam.Width1 = sh.width * k * 0.85, sh.width * k
				-- streaks of the same size on screen whatever the scale
				sh.beam.TextureLength = R.streakStuds * k
			end
		end
	end
	Workspace:BulkMoveTo(rainParts, rainFrames, Enum.BulkMoveMode.FireCFrameChanged)
end

local function anchorsFor(set: PuffSet, s: any, ctx: Context, light: CloudShell.Light): { Anchor }
	local out = {}
	if M.style == "puffs" then
		for key, spec in M.puffs.bodies do
			surfacePuffs(out, set, s, ctx, light, key, spec)
		end
	else
		if not Config.STORM_KIT.enabled then
			for key, spec in M.detail do
				surfacePuffs(out, set, s, ctx, light, key, spec)
			end
		else
			-- the kit's pieces: puffs on their open surface, a little inside it
			-- (only the side facing the camera and the silhouette: the puffs are drawn nearer than
			-- the pieces, so one on the far side would show through)
			for _, q in StormKit.puffPoints(s, ctx) do
				if (ctx.camPos - q.world).Unit:Dot(q.normal) < -0.25 then
					continue
				end
				table.insert(out, {
					world = q.world - q.normal * q.size * Config.STORM_KIT.detailInset,
					size = q.size,
					colour = CloudShell.shade(q.world, q.normal, ctx.camPos, light, q.albedo * Config.STORM_KIT.detailAlbedo, 1),
					texture = "lumpyFlat",
					transparency = 1 - (1 - Config.STORM_KIT.detailTransparency) * (1 - q.transparency),
				})
			end
		end
		scudPuffs(out, s, ctx, light)
	end
	return out
end

-- Hands the anchors to the puffs (reusing them; changing an emitter only where it differs).
local function applyAnchors(set: PuffSet, anchors: { Anchor })
	for n, a in anchors do
		local puff = set.puffs[n]
		if not puff then
			puff = newPuff(set.folder)
			set.puffs[n] = puff
		end
		local e = puff.emitter
		if puff.texture ~= a.texture then
			puff.texture = a.texture
			e.Texture = TornadoConfig.textures[a.texture] or a.texture
			if TornadoConfig.SHEETS[a.texture] then
				e.FlipbookLayout = Enum.ParticleFlipbookLayout.Grid4x4
				e.FlipbookMode = Enum.ParticleFlipbookMode.Random
				e.FlipbookFramerate = NumberRange.new(0)
			else
				e.FlipbookLayout = Enum.ParticleFlipbookLayout.None
			end
		end
		if math.abs(puff.transparency - a.transparency) > 0.02 then
			puff.transparency = a.transparency
			e.Transparency = fadeSequence(1 - (1 - a.transparency) * puff.near)
		end
		e.Color = ColorSequence.new(a.colour)
		puff.a = a
		puff.size = -1 -- resized at the next draw
		e.Enabled = true
	end
	for i = #anchors + 1, set.used do
		local puff = set.puffs[i]
		puff.emitter.Enabled = false
		puff.emitter:Clear()
		puff.a = nil
	end
	set.used = #anchors
end

-- The farthest any puff is from the camera (for the storm's scale).
local function puffsFar(set: PuffSet, camPos: Vector3): number
	local far = 1
	for i = 1, set.used do
		local a = set.puffs[i].a
		if a then
			far = math.max(far, (a.world - camPos).Magnitude + a.size * 0.5)
		end
	end
	return far
end

local movedParts: { BasePart } = {}
local movedFrames: { CFrame } = {}
local function drawSet(set: PuffSet, camPos: Vector3, k: number, dt: number, moved: Vector3?, clock: number?)
	local shift = moved or Vector3.zero
	table.clear(movedParts)
	table.clear(movedFrames)
	for i = 1, set.used do
		local puff = set.puffs[i]
		local a = puff.a
		if a then
			if a.follow and clock then
				-- (made where the storm was at the last reshape: kept relative to that, as the anchors are)
				a.world = a.follow(clock) - (a.followShift or Vector3.zero)
				if a.fadeAt then
					local t = a.fadeAt(clock)
					if math.abs(t - puff.transparency) > 0.02 then
						puff.transparency = t
						a.transparency = t
						puff.emitter.Transparency = fadeSequence(1 - (1 - t) * puff.near)
					end
				end
			elseif a.vel then
				a.world += a.vel * dt
			end
			table.insert(movedParts, puff.part)
			table.insert(movedFrames, CFrame.new(camPos + (a.world + shift - camPos) * k))
			local sz = a.size * k
			if puff.size < 0 or math.abs(sz - puff.size) > 0.01 * puff.size then
				puff.size = sz
				puff.emitter.Size = NumberSequence.new(sz)
			end
			-- fading out as the camera comes into it (a puff round the camera is a screen of grey);
			-- in four steps, so the emitter is only touched when it changes
			local d = (a.world - camPos).Magnitude
			local near = math.floor(math.clamp((d - 0.5 * a.size) / (0.7 * a.size), 0, 1) * 4 + 0.5) / 4
			if near ~= puff.near then
				puff.near = near
				puff.emitter.Transparency = fadeSequence(1 - (1 - a.transparency) * near)
			end
		end
	end
	Workspace:BulkMoveTo(movedParts, movedFrames, Enum.BulkMoveMode.FireCFrameChanged)
end

local function puffLight(): CloudShell.Light
	local light = sceneLight()
	light.exposure = M.puffs.exposure -- (particles: no Neon glow on top of the colour)
	return light
end

local function drawPuffs(s: any, ctx: Context)
	local set = puffSet(s, ctx)
	if not set then
		return
	end
	local here = ctx.at(s.updraft.xKm, s.updraft.yKm, 0)
	if ctx.clock - set.shapedAt >= M.puffs.reshapeSeconds then
		set.shapedAt = ctx.clock
		set.shapedFrom = here
		applyAnchors(set, anchorsFor(set, s, ctx, puffLight()))
	end
	drawSet(set, ctx.camPos, math.min(1, M.puffs.reach / puffsFar(set, ctx.camPos)), ctx.dt or 0, here - set.shapedFrom, ctx.clock)
end

-- Timings (ms, smoothed) for the lab panel: per frame, and the worst reshape lately.
StormMesh.stats = { frameMs = 0, reshapeMs = 0, shadeMs = 0, puffs = 0, vertices = 0, shafts = 0, rainIntensity = 0, shaftAlpha = 0 }
local function drawInner(s: any, ctx: Context) end -- (defined below)

function StormMesh.draw(s: any, ctx: Context)
	if not M.enabled then
		return
	end
	local t0 = os.clock()
	drawInner(s, ctx)
	local st = StormMesh.stats
	st.frameMs += ((os.clock() - t0) * 1000 - st.frameMs) * 0.1
end

drawInner = function(s: any, ctx: Context)
	if M.style == "puffs" then
		drawPuffs(s, ctx)
		return
	end
	local entry = entries[s.id]
	if not entry then
		for _, e in pool do
			if e.id == nil then
				entry = e
				break
			end
		end
		if not entry then
			if #pool >= M.storms then
				return
			end
			local folder = Instance.new("Folder")
			folder.Name = "StormMesh" .. (#pool + 1)
			entry = { bodies = {}, shapedAt = -math.huge, folder = folder, id = nil, shapedFrom = Vector3.zero, turn = 0, shades = 0 }
			table.insert(pool, entry :: Entry)
		end
		local e = entry :: Entry
		e.id = s.id
		e.shapedAt = -math.huge -- reshaped for its new storm at once
		e.folder.Parent = ctx.parent
		entries[s.id] = e
	end
	-- Reshaping is staggered: one body a frame (tower, anvil, base, then the particles), every
	-- reshapeSeconds; a storm new to the set does all at once. Between reshapes everything moves
	-- with the storm (made at shapedFrom, drawn moved by the difference), so it glides.
	local here = ctx.at(s.updraft.xKm, s.updraft.yKm, 0)
	local fresh = entry.shapedAt == -math.huge
	local due = ctx.clock - entry.shapedAt >= M.reshapeSeconds
	if due and entry.turn == 0 then
		entry.turn = 1
	end
	local turnKey = BODY_ORDER[entry.turn] -- the body being reshaped (nil: none)
	local jobDone = false -- this frame the turn's body has its new shape
	local reshape = fresh or entry.turn > 0
	if fresh then
		entry.shapedAt = ctx.clock
		entry.shapedFrom = here
		entry.turn = 0
	end
	local moved = here - entry.shapedFrom
	-- one scale for the whole storm, so its parts keep their order in depth
	local light = sceneLight()
	local far = 1
	local shells = {}
	local reshaped = false
	local tShape = os.clock()
	local _, _, lifeFade = lifeOf(s)
	for key, size in M.resolution do
		local shell = body(entry, key, size[1], size[2])
		local fringe = if M.fringe.enabled then body(entry, key .. "Fringe", size[1], size[2], true) else nil
		-- an orphan anvil: no tower or base; the anvil's solid core goes first, its puffs fade last
		-- (with the cloud kit on, the bodies are its pieces: only the scud and rain are drawn here)
		local shown = (lifeFade <= 0 or (key == "anvil" and lifeFade < M.life.anvilShellUntil)) and hasBody(s, key) and not Config.STORM_KIT.enabled
		if turnKey == key and not shown then
			jobDone = true -- (nothing to reshape: the turn moves on)
		end
		if shell then
			shell:setVisible(shown)
			if fringe then
				fringe:setVisible(shown)
			end
		end
		if shell and shown then
			local result: { any }? = nil
			if fresh or shell.k < 0 or (fringe and fringe.k < 0) then
				-- all at once (a storm new to the set, or a shell just built)
				result = { SHAPES[key](s, ctx, size[1], size[2], ctx.clock, light.sun) }
			elseif turnKey == key then
				-- a slice of the work this frame
				if not entry.job then
					local clock, sun = ctx.clock, light.sun
					entry.job = coroutine.create(function()
						return { SHAPES[key](s, ctx, size[1], size[2], clock, sun) }
					end)
				end
				sliceStart = os.clock()
				inJob = true
				local ok, value = coroutine.resume(entry.job :: thread)
				inJob = false
				if not ok then
					warn("[StormMesh] reshaping " .. key .. ": " .. tostring(value))
					entry.job = nil
					jobDone = true
				elseif coroutine.status(entry.job :: thread) == "dead" then
					entry.job = nil
					result = value
					jobDone = true
				end
			end
			if result then
				reshaped = true
				local points, opacity, albedo, sunlit = result[1], result[2], result[3], result[4]
				-- made where the storm is now; kept relative to where the set is drawn from
				if moved.Magnitude > 0 then
					for k2 = 1, #points do
						points[k2] -= moved
					end
				end
				shell:setShape(points, nil, albedo, sunlit)
				-- the fringe: a little outside the solid shell, its opacity the shape's (thin, fraying
				-- parts show only as fringe)
				if fringe then
					local out = M.fringe.out * shell.radius
					local puffed = table.create(#points)
					for k2, p in points do
						puffed[k2] = p + shell.normals[k2] * out
					end
					fringe:setShape(puffed, opacity, albedo, sunlit)
				end
			end
			table.insert(shells, shell)
			if fringe then
				table.insert(shells, fringe)
			end
			far = math.max(far, (shell.centre - ctx.camPos).Magnitude + shell.radius)
		end
	end
	local reach = 0
	local verts = 0
	for _, shell in shells do
		reach = math.max(reach, shell.radius)
		verts += shell.rows * shell.cols
	end
	local k = math.min(1, (CloudShell.BOUNDS - 2) / math.max(reach, 1))
	-- hybrid: the particles at the same scale, so shells and puffs keep their order in depth; the
	-- scale then also brings the farthest shell within the particles' reach
	if M.style == "hybrid" then
		local set = puffSet(s, ctx)
		if set then
			if fresh or turnKey == "puffs" or set.used == 0 then
				local anchors = anchorsFor(set, s, ctx, puffLight())
				for _, a in anchors do
					a.world -= moved
					a.followShift = moved
				end
				applyAnchors(set, anchors)
			end
			k = math.min(k, M.puffs.reach / math.max(far, puffsFar(set, ctx.camPos)))
			if Config.STORM_KIT.enabled then
				k = math.min(k, Config.STORM_KIT.scale) -- (in depth with the kit's pieces)
			end
			k = quantise(k)
			drawSet(set, ctx.camPos, k, ctx.dt or 0, moved, ctx.clock)
		end
	end
	local st = StormMesh.stats
	if reshaped then
		st.reshapeMs = math.max(st.reshapeMs * 0.9, (os.clock() - tShape) * 1000)
	end
	k = quantise(k)
	-- the next body once this one is done (the particles are quick: done in one go)
	if turnKey == "puffs" then
		jobDone = true
	end
	if entry.turn > 0 and jobDone then
		entry.turn += 1
		if entry.turn > #BODY_ORDER then
			entry.turn = 0
			entry.shapedAt = ctx.clock
		end
	end
	-- colours: only the shells whose light or view changed, at most M.shadesPerFrame a frame
	local tShade = os.clock()
	local budget = M.shadesPerFrame
	for _, shell in shells do
		local need = budget > 0 and shell:needsShade(ctx.camPos, light.sun, moved)
		if need then
			budget -= 1
		end
		shell:draw(ctx.camPos, k, light, moved, need)
	end
	if M.style == "hybrid" then
		drawRain(s, ctx, k, moved, light, fresh or turnKey == "puffs")
	end
	st.shadeMs += ((os.clock() - tShade) * 1000 - st.shadeMs) * 0.1
	st.vertices = verts
	local set = puffSets[s.id]
	st.puffs = if set then set.used else 0
end

function StormMesh.sweep(alive: { [string]: boolean })
	for id, rs in shaftSets do
		if not alive[id] or M.style ~= "hybrid" then
			rs.folder:Destroy()
			shaftSets[id] = nil
		end
	end
	for id, set in puffSets do
		if not alive[id] or M.style == "shells" then
			set.id = nil
			set.folder.Parent = nil
			puffSets[id] = nil
		end
	end
	if M.style == "puffs" then
		alive = {} -- the shells all go back to the pool
	end
	for id, entry in entries do
		if not alive[id] then
			-- back to the pool, hidden
			entry.id = nil
			entry.folder.Parent = nil
			entries[id] = nil
		end
	end
end

return StormMesh
