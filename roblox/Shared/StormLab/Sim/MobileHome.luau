--!nonstrict
-- A single-wide mobile home (EF DI 3) broken piece by piece by the simulated wind, and the unit
-- itself pushed, slid, tipped, rolled or lofted by the same wind through a force balance.
-- docs/tornado-physics/MOBILE-HOME.md has the derivations and sources.
--
-- The pieces are the bones of the skinned mesh (tools/blender/mobile_home.py ->
-- Structures/MobileHomePieces). For each piece:
--   capacity  a failure speed drawn once from the DI 3 degree it belongs to (normal round the
--             expected speed, sigma = (upper - lower) / 4), never below the pieces covering it (the
--             load path: shingles, sheathing, trusses, ceiling, walls, floor, chassis); quoted as a
--             3-s gust at 10 m in open country, so at the piece's height it is scaled by the
--             ASCE 7 exposure-C gust profile (V ~ z^(1/9.5), z >= 4.6 m).
--   load      q = 1/2 rho V^2 of the wind sampled at the piece, times its net pressure coefficient:
--             the outside Cp from its face and the wind angle (walls: windward +0.8, side -0.7,
--             leeward -0.5; roof slopes -0.65, -0.9 with the wind along the ridge) less the inside
--             one (+-0.18 sealed, +0.55 once a window or door has gone: the breach), against the
--             coefficient the DOD's speeds imply (the first piece of that kind to fail is the worst
--             loaded one). Roof pieces add the updraft (U^2 = u^2 + v^2 + 3 w |w|).
--   failure   Damage.accumulate (duration counts), and only once every piece in its req list is
--             gone (a wall cannot go while its siding, windows and the ceiling it carries stand).
--   debris    its own Sim/Debris class from its geometry: mass from the piece's material (areal,
--             per metre or per volume), drag area from its largest face and solidity.
-- The unit (whatever is still attached) feels drag F = q Cf A (Cf 1.3 broadside: 0.8 + 0.5) and
-- uplift L = q CL A_plan, and stays put while friction mu (W - L) and its ground anchors hold.
-- Past them it slides (DOD 3: off its block piers), tips about its leeward support, rolls from
-- corner to corner (DOD 5) or leaves the ground (DOD 7: vaults) - all by integrating the forces,
-- so a lighter unit (roof gone) or a bigger face (unit on its side) behaves accordingly.
-- Pure (runs under the luau CLI): the server owns the state; Town draws it.
--   MobileHome.new(opts)               opts: x, y (sim m), heading (rad, local +x from east toward
--                                      north), ground (m), seed, anchors (0..1), variant overrides
--   MobileHome.step(home, dt, wind)    wind(x, y, z) -> u, v, w (sim m/s, z above the ground)
--                                      -> { failed pieces }, { unit events }
--   MobileHome.pose(home)              the unit's pose in its own frame (along, y, z, roll)
--   MobileHome.unitProps(home)         mass, areas, load height, anchor capacities
--   MobileHome.slideSpeed / tipSpeed   the broadside wind (3-s, at roof height) that moves it
local function dep(name: string): any
	if script then
		return require((script :: any).Parent:FindFirstChild(name))
	end
	return (require :: any)("./" .. name)
end
local function data(): any
	if script then
		return require((script :: any).Parent.Parent:WaitForChild("Structures"):WaitForChild("MobileHomePieces"))
	end
	return (require :: any)("../Structures/MobileHomePieces")
end
local Damage = dep("Damage")
local Noise = dep("Noise")
local Pieces = data()

local MobileHome = {}

local RHO = 1.15
local G = 9.81
local MPH = 0.44704
local FT = Pieces.unit -- metres per data unit
local sqrt, abs, cos, sin, max, min = math.sqrt, math.abs, math.cos, math.sin, math.max, math.min

-- Coefficients (ASCE 7-16 ch. 27-28 for low-rise buildings; the home is 4.3 m tall, 4.3 x 17 m).
local CP_WINDWARD, CP_SIDE, CP_LEEWARD = 0.8, -0.7, -0.5
local CP_ROOF_SLOPE, CP_ROOF_EDGE = -0.65, -0.9
local CPI_SEALED, CPI_BREACHED = 0.18, 0.55
local CF_BROADSIDE = 1.3 -- windward + leeward walls
local CL_SKIRTED, CL_OPEN = 0.7, 0.9 -- roof suction net; open piers let the wind under the floor
local MU_PIERS, MU_GROUND = 0.55, 0.6 -- steel I-beam on wood shims / CMU; floor on soil
local PIER_HEIGHT = 2.2 * FT -- the chassis sits on the piers' tops
local ANCHOR_ULTIMATE = 21000 -- N: 4,725 lb (24 CFR 3280.306: 3,150 lb working, 50 % overload)
local ANCHORS_PER_SIDE = 6
local ROLL_DAMP = 0.3 -- s^-1 of the angular speed (the floor scraping, the walls crushing)
local IMPACT_KEEP = 0.45 -- share of the angular speed kept when the next corner lands
local Z_REF, Z_MIN, GUST_EXP = 10, 4.6, 1 / 9.5
local MAX_FRAGMENTS = 12 -- per piece (the rest of a torn covering stays as unseen litter)
-- one unit's face (m2) of the Sim/Debris classes a covering tears into (Debris.CLASSES areas)
local FRAGMENT_AREA = { shingle = 0.34, plywood = 2.97, sheetMetal = 2.0 }

-- Per category: dod (DI 3 degree whose speeds it takes), face (pressure: "wall", "roof", nil = 1),
-- mass model (areal kg/m2 on the largest face, perM kg per metre of the longest side, density
-- kg/m3 of the box, or kg), tears (a covering leaves as its units, each a Sim/Debris class:
-- shingle tabs, 4 x 8 ft sheets, siding and skirting panels), apart (porch, deck and steps: free-standing, not part of the unit), solidity (drag area share of the largest face), drag and lift (Cd,
-- Cl), breach (its loss opens the envelope), and the look of its debris.
-- Masses: asphalt shingles 3-tab ~10.5 kg/m2 (235 lb/square); 7/16" OSB 6.8 kg/m2 + fascia;
-- 5/16" gypsum 5.4 + insulation; aluminium or vinyl lap siding with backer ~2.5; 2x3 studs at
-- 16" with insulation and 1/4" panelling ~11; single-pane window in an aluminium frame ~22; 5/8"
-- particleboard deck on 2x6 joists with bottom board and covering ~22; two 10" steel I-beams
-- with cross-members and outriggers ~42 kg/m of unit; hollow CMU piers ~900 kg/m3 of the stack.
-- The home comes to ~7 t, as a 14 x 56 ft single-wide does (6.5-8 t).
local CAT = {
	Vent = { dod = 1, face = "roof", kg = 3, solidity = 1, cd = 1.05, cl = 0, look = "metal" },
	Shutter = { dod = 1, face = "wall", areal = 3.5, solidity = 1, cd = 1.2, cl = 0.6, look = "shutter" },
	Skirt = { dod = 1, face = "wall", areal = 1.8, solidity = 1, cd = 1.2, cl = 0.8, look = "skirt", tears = "sheetMetal" },
	Rail = { dod = 1, apart = true, perM = 6, solidity = 0.35, cd = 1.1, cl = 0.1, look = "deck" },
	Shingles = { dod = 2, face = "roof", areal = 10.5, solidity = 1, cd = 1.2, cl = 0.6, look = "shingle", tears = "shingle" },
	GableRoof = { dod = 2, face = "roof", areal = 18, solidity = 1, cd = 1.2, cl = 0.7, look = "shingle", tears = "plywood" },
	Window = { dod = 2, face = "wall", areal = 22, solidity = 1, cd = 1.2, cl = 0.3, breach = true, look = "trim" },
	Door = { dod = 2, face = "wall", areal = 20, solidity = 1, cd = 1.2, cl = 0.3, breach = true, look = "door" },
	Steps = { dod = 3, apart = true, density = 600, fill = 0.12, solidity = 0.5, cd = 1.1, cl = 0.1, look = "deck" },
	DeckFloor = { dod = 3, apart = true, areal = 18, solidity = 1, cd = 1.2, cl = 0.5, look = "deck" },
	GableFace = { dod = 4, face = "wall", areal = 2.5, solidity = 1, cd = 1.2, cl = 0.8, look = "siding" },
	Sheathing = { dod = 4, face = "roof", areal = 7.5, solidity = 1, cd = 1.2, cl = 0.7, look = "osb", tears = "plywood" },
	Truss = { dod = 4, perM = 7, solidity = 0.2, cd = 1.1, cl = 0.15, look = "wood" },
	Ceiling = { dod = 4, face = "roof", areal = 7, solidity = 1, cd = 1.2, cl = 0.6, look = "drywall" },
	Siding = { dod = 6, face = "wall", areal = 2.5, solidity = 1, cd = 1.2, cl = 0.8, look = "siding", tears = "sheetMetal" },
	Wall = { dod = 6, face = "wall", areal = 11, solidity = 1, cd = 1.2, cl = 0.5, look = "drywall" },
	InteriorWall = { dod = 6, areal = 9, solidity = 1, cd = 1.2, cl = 0.5, look = "drywall" },
	Floor = { dod = 8, areal = 22, solidity = 1, cd = 1.2, cl = 0.4, look = "floor" },
	Chassis = { dod = 9, perM = 42, solidity = 0.15, cd = 1.0, cl = 0, look = "steel" },
	Pier = { dod = 9, density = 900, fill = 1, solidity = 1, cd = 1.05, cl = 0, look = "concrete", ground = true },
}
MobileHome.CATEGORIES = CAT

-- Debris looks (Sim/Debris class colour and material), one per material of the atlas.
local LOOK = {
	metal = { { 158, 163, 170 }, "Metal" },
	shutter = { { 28, 28, 30 }, "SmoothPlastic" },
	skirt = { { 232, 232, 236 }, "SmoothPlastic" },
	deck = { { 110, 96, 84 }, "WoodPlanks" },
	shingle = { { 88, 84, 78 }, "Slate" },
	trim = { { 236, 236, 236 }, "SmoothPlastic" },
	door = { { 204, 204, 210 }, "Metal" },
	siding = { { 190, 176, 158 }, "SmoothPlastic" },
	osb = { { 208, 164, 108 }, "Wood" },
	wood = { { 204, 128, 70 }, "Wood" },
	drywall = { { 220, 216, 206 }, "SmoothPlastic" },
	floor = { { 210, 120, 56 }, "Wood" },
	steel = { { 42, 44, 48 }, "Metal" },
	concrete = { { 178, 181, 189 }, "Concrete" },
}
MobileHome.LOOK = LOOK

-- The optional groups (the generator's attributes): which variant hides which pieces.
local GROUP_PREFIX = { Skirt = "Skirt_", Porch = "Porch_", Deck = "Deck_", Shutters = "Shutter_", Gable = "Gable_" }

-- The DI 3 row of a degree: expected, lower, upper (m/s) and its text.
local function dodRow(d: number): (number, number, number, string)
	local row = Damage.DI.mobileHome[d]
	return row[3] * MPH, row[4] * MPH, row[5] * MPH, row[2]
end

-- Box geometry in metres: centre (Roblox axes: x along the length, y up, z across, front +z),
-- the three axes (unit vectors, the columns of the rotation) and full sizes.
local function axesOf(rot: { number }): ({ number }, { number }, { number })
	return { rot[1], rot[4], rot[7] }, { rot[2], rot[5], rot[8] }, { rot[3], rot[6], rot[9] }
end

-- Projected area of a box along a unit direction d: |d.a1| s2 s3 + |d.a2| s1 s3 + |d.a3| s1 s2.
local function projected(p: any, dx: number, dy: number, dz: number): number
	local s = p.size
	local a1, a2, a3 = p.axes[1], p.axes[2], p.axes[3]
	return abs(dx * a1[1] + dy * a1[2] + dz * a1[3]) * s[2] * s[3]
		+ abs(dx * a2[1] + dy * a2[2] + dz * a2[3]) * s[1] * s[3]
		+ abs(dx * a3[1] + dy * a3[2] + dz * a3[3]) * s[1] * s[2]
end

-- The mass, drag area and a Sim/Debris class for a piece, from its box and category.
local function physicalOf(name: string, p: any): any
	local c = CAT[p.cat]
	local s = { p.size[1], p.size[2], p.size[3] }
	table.sort(s, function(a, b)
		return a > b
	end)
	local face = s[1] * s[2]
	local mass
	if c.kg then
		mass = c.kg
	elseif c.areal then
		mass = c.areal * face
	elseif c.perM then
		mass = c.perM * s[1]
	else
		mass = c.density * (c.fill or 1) * s[1] * s[2] * s[3]
	end
	local area = face * c.solidity
	local look = LOOK[c.look]
	return {
		mass = mass,
		area = area,
		class = {
			name = "mh:" .. name,
			group = if mass > 300 then "heavy" else "structural",
			mass = mass,
			area = area,
			cd = c.cd,
			cl = c.cl,
			length = s[1],
			-- plates autorotate (Tachikawa): faster the thinner they are
			tumble = if c.cl >= 0.5 then 0.9 elseif c.cl > 0 then 0.4 else 0.2,
			restitution = if c.look == "metal" or c.look == "steel" then 0.35 else 0.25,
			friction = if c.look == "concrete" then 0.7 else 0.55,
			size = { s[1], s[3], s[2] }, -- (Debris: length, thickness, width)
			color = look[1],
			material = look[2],
		},
	}
end

-- The pieces in metres, built once (geometry and physics are the same for every home).
local BASE: { [string]: any } = {}
local ORDER: { string } = {}
for name, p in Pieces.pieces do
	local a1, a2, a3 = axesOf(p.rot)
	local piece = {
		name = name,
		cat = p.cat,
		group = p.group,
		pos = { p.pos[1] * FT, p.pos[2] * FT, p.pos[3] * FT },
		axes = { a1, a2, a3 },
		size = { p.size[1] * FT, p.size[2] * FT, p.size[3] * FT },
		req = p.req,
	}
	local phys = physicalOf(name, piece)
	piece.mass, piece.area, piece.debris = phys.mass, phys.area, phys.class
	-- a covering tears into its units: its face over one unit's (the Sim/Debris classes' areas)
	local tears = CAT[p.cat].tears
	if tears then
		piece.fragments = math.clamp(math.floor(phys.area / FRAGMENT_AREA[tears] + 0.5), 1, MAX_FRAGMENTS)
	end
	-- outward normal of a wall or roof piece: its thinnest axis, pointing away from the centre line
	local c = CAT[p.cat]
	if c.face then
		local k, smallest = 1, math.huge
		for i = 1, 3 do
			if piece.size[i] < smallest then
				k, smallest = i, piece.size[i]
			end
		end
		local n = piece.axes[k]
		local side = n[1] * piece.pos[1] + n[3] * piece.pos[3]
		local up = n[2]
		if c.face == "roof" then
			-- roof normals point up
			if up < 0 then
				n = { -n[1], -n[2], -n[3] }
			end
		elseif side < 0 then
			n = { -n[1], -n[2], -n[3] }
		end
		piece.normal = n
	end
	BASE[name] = piece
	table.insert(ORDER, name)
end
table.sort(ORDER)
MobileHome.PIECES = BASE
MobileHome.ORDER = ORDER

-- Every piece's Sim/Debris class (Debris registers them as "mh:<piece>").
function MobileHome.debrisClasses(): { [string]: any }
	local out = {}
	for _, p in BASE do
		out[p.debris.name] = p.debris
	end
	return out
end

-- The unit's cross-section (metres, local y-z): chassis bottom to ridge, wall to wall.
local SECTION_Z = 7.0 * FT
local SECTION_Y0, SECTION_Y1 = PIER_HEIGHT, 14.3 * FT
local PIER_Z = 3.5 * FT -- the two pier lines
local PIER_SEAT = 0.9 * FT -- across: half a pier top and the beam's flange; past it the beam drops
local PIER_SPACING = 8 * FT -- along: the next pier is 8 ft on

-- Outside pressure coefficient of a face whose outward normal makes cos c with the upwind
-- direction (1: faces the wind). Walls fit windward / side / leeward exactly; roof slopes take
-- the edge value when the wind runs along the ridge.
local function cpWall(c: number): number
	-- -0.7 + 0.65 c + 0.85 c^2: c = 1 -> 0.8, 0 -> -0.7, -1 -> -0.5
	return CP_SIDE + 0.5 * (CP_WINDWARD - CP_LEEWARD) * c + (0.5 * (CP_WINDWARD + CP_LEEWARD) - CP_SIDE) * c * c
end
local function cpRoof(c: number): number
	return CP_ROOF_EDGE + (CP_ROOF_SLOPE - CP_ROOF_EDGE) * min(1, abs(c))
end
-- net coefficient across a face: outside less inside. Sealed, the inside pressure may be either
-- sign (+-0.18: take the worse); breached, it is +0.55 (windward walls feel less, the rest more).
local function netCp(cp: number, breached: boolean): number
	if breached then
		return abs(cp - CPI_BREACHED)
	end
	return abs(cp) + CPI_SEALED
end
MobileHome.netCp = netCp
-- the net coefficient the DOD speeds imply: the worst-loaded piece of its kind, sealed
local REF_WALL = CP_WINDWARD + CPI_SEALED
local REF_ROOF = abs(CP_ROOF_EDGE) + CPI_SEALED
MobileHome.cpWall, MobileHome.cpRoof = cpWall, cpRoof

-- The gust profile factor: a 10-m open-country gust V10 is V10 * f(z) at height z.
local function profile(z: number): number
	return (max(z, Z_MIN) / Z_REF) ^ GUST_EXP
end
MobileHome.profile = profile

export type Home = any

-- A home with its own variant (foundation, porch, shutters, cross gable) and drawn capacities.
-- opts.anchors: share of the anchors' rated strength that holds (0: none; old, loose or in wet
-- soil ~0.3-0.6; new to code 1). opts.quality scales every piece's capacity (0.85 poor, 1.2 strong).
function MobileHome.new(opts: any): Home
	local seed = opts.seed or 1
	local rng = Noise.rng(seed)
	-- the variant, drawn like the generator's (one roll each, in the same order)
	local function pick(value: string?, a: string, b: string, chanceA: number): string
		local roll = rng:next()
		if value == a or value == b then
			return value :: string
		end
		return if roll < chanceA then a else b
	end
	local variant = {
		foundation = pick(opts.foundation, "Skirting", "Piers", 0.55),
		porch = pick(opts.porch, "Steps", "Deck", 0.6),
		shutters = pick(opts.shutters, "On", "Off", 0.6),
		gable = pick(opts.gable, "On", "Off", 0.5),
	}
	local hidden = {}
	if variant.foundation == "Piers" then
		table.insert(hidden, GROUP_PREFIX.Skirt)
	end
	table.insert(hidden, if variant.porch == "Steps" then GROUP_PREFIX.Deck else GROUP_PREFIX.Porch)
	if variant.shutters == "Off" then
		table.insert(hidden, GROUP_PREFIX.Shutters)
	end
	if variant.gable == "Off" then
		table.insert(hidden, GROUP_PREFIX.Gable)
	end
	local function isHidden(name: string): boolean
		for _, prefix in hidden do
			if string.sub(name, 1, #prefix) == prefix then
				return true
			end
		end
		return false
	end
	local quality = opts.quality or 1
	local pieces = {}
	for _, name in ORDER do
		if not isHidden(name) then
			local b = BASE[name]
			local exp, lo, hi = dodRow(CAT[b.cat].dod)
			local speed = math.clamp(exp + rng:normal() * (hi - lo) / 4, lo, hi) * quality
			pieces[name] = { base = b, cat = CAT[b.cat], failSpeed = speed, damage = 0, gone = false }
		end
	end
	-- the load path: never weaker than what covers it (a piece is reached only after them)
	local done = {}
	local function settle(name: string): number
		local p = pieces[name]
		if done[name] then
			return p.failSpeed
		end
		done[name] = true
		for _, r in p.base.req do
			if pieces[r] then
				p.failSpeed = max(p.failSpeed, settle(r) + 0.25)
			end
		end
		return p.failSpeed
	end
	for _, name in ORDER do
		if pieces[name] then
			settle(name)
		end
	end
	local heading = opts.heading or 0
	local home = {
		x = opts.x or 0,
		y = opts.y or 0,
		ground = opts.ground or 0,
		heading = heading,
		ch = cos(heading),
		sh = sin(heading),
		variant = variant,
		pieces = pieces,
		breached = false,
		anchors = math.clamp(opts.anchors or 0.5, 0, 1),
		anchorsHeld = (opts.anchors or 0.5) > 0,
		onPiers = true,
		-- the unit's pose: along-length offset, and the cross-section's rotation and translation
		-- (local y-z: rolled by angle, then moved by (ty, tz))
		along = 0,
		angle = 0,
		ty = 0,
		tz = 0,
		vAlong = 0,
		vy = 0,
		vz = 0,
		omega = 0,
		pivot = nil, -- { y, z } while tipping about a corner
		rollDir = 0,
		airborne = false,
		stage = 0,
		stageText = "intact",
		peakWind = 0,
		events = {},
		seen = {},
	}
	return home
end

-- local (x along, y up, z across) -> sim (x, y, z above the ground), with the unit's pose
local function toSim(h: Home, lx: number, ly: number, lz: number): (number, number, number)
	local ca, sa = cos(h.angle), sin(h.angle)
	local z = lz * ca + ly * sa + h.tz
	local y = ly * ca - lz * sa + h.ty
	local x = lx + h.along
	-- local +x is (cos heading, sin heading) in sim axes, local +z is (sin heading, -cos heading)
	return h.x + x * h.ch + z * h.sh, h.y + x * h.sh - z * h.ch, y
end
MobileHome.toSim = toSim

-- the same for what does not move with the unit (porch, deck, steps, piers before it leaves them)
local function toSimFixed(h: Home, lx: number, ly: number, lz: number): (number, number, number)
	return h.x + lx * h.ch + lz * h.sh, h.y + lx * h.sh - lz * h.ch, ly
end
MobileHome.toSimFixed = toSimFixed

-- whether a piece moves with the unit (everything but the piers, porch, deck and steps)
function MobileHome.isUnit(name: string): boolean
	local c = CAT[BASE[name].cat]
	return not (c.apart or c.ground)
end

-- a sim horizontal vector in local axes (along, across)
local function toLocalH(h: Home, u: number, v: number): (number, number)
	return u * h.ch + v * h.sh, u * h.sh - v * h.ch
end

-- a local (y, z) point after the unit's roll and translation
local function sectionPoint(h: Home, y: number, z: number): (number, number)
	local ca, sa = cos(h.angle), sin(h.angle)
	return y * ca - z * sa + h.ty, z * ca + y * sa + h.tz
end

-- What is still attached: mass, the broadside and end silhouettes, the plan area under uplift,
-- the height of the side load's centre and of the centre of mass (local frame, unrolled).
function MobileHome.unitProps(h: Home): any
	local mass, mz = 0, 0
	local aSide, aEnd, ySide = 0, 0, 0
	local roofPlan, ceilingPlan = 0, 0
	local skirted = false
	for _, p in h.pieces do
		if not p.gone and p.base.cat == "Skirt" then
			skirted = true
		end
	end
	for name, p in h.pieces do
		if not p.gone and not p.cat.ground and not p.cat.apart then
			local b = p.base
			local cat = b.cat
			mass += b.mass
			mz += b.mass * b.pos[2]
			-- the envelope: each outer layer once (front and back project the same, so halve the
			-- pairs); an inner wall counts once its siding is gone; the floor's rim and the beams
			-- below it face the wind only when no skirting covers them
			local outer = cat == "Siding" or cat == "Sheathing" or cat == "GableRoof" or cat == "GableFace" or cat == "Skirt"
			if cat == "Wall" then
				local partner = string.gsub(string.gsub(name, "^Wall_", "Siding_"), "^EndWall_", "EndSiding_")
				local sp = h.pieces[partner]
				outer = sp == nil or sp.gone
			end
			if outer then
				local s = projected(b, 0, 0, 1) * 0.5
				aSide += s
				aEnd += projected(b, 1, 0, 0) * 0.5
				ySide += s * b.pos[2]
			elseif (cat == "Floor" or cat == "Chassis") and not skirted then
				-- (the floor's rim shows only below the siding: a third of it)
				local s = projected(b, 0, 0, 1) * (if cat == "Floor" then 1 / 3 else 1)
				aSide += s
				aEnd += projected(b, 1, 0, 0) * (if cat == "Floor" then 0.25 else 1) -- (4 floor segments in a row)
				ySide += s * b.pos[2]
			end
			if cat == "Sheathing" or cat == "GableRoof" then
				roofPlan += projected(b, 0, 1, 0)
			elseif cat == "Ceiling" then
				ceilingPlan += projected(b, 0, 1, 0)
			end
		end
	end
	return {
		mass = mass,
		weight = mass * G,
		comY = if mass > 0 then mz / mass else 0,
		areaSide = aSide,
		areaEnd = aEnd,
		loadY = if aSide > 0 then ySide / aSide else 0,
		areaPlan = max(roofPlan, ceilingPlan),
		skirted = skirted,
		cl = if h.onPiers and not skirted then CL_OPEN else CL_SKIRTED, -- (on the ground no wind gets under the floor)
		mu = if h.onPiers then MU_PIERS else MU_GROUND,
		-- ties at 45 degrees: each holds 0.71 of its strength across and as much upward
		anchorH = if h.anchorsHeld then 2 * ANCHORS_PER_SIDE * ANCHOR_ULTIMATE * h.anchors * 0.7071 else 0,
		anchorV = if h.anchorsHeld then ANCHORS_PER_SIDE * ANCHOR_ULTIMATE * h.anchors * 0.7071 else 0,
	}
end

-- The broadside wind (m/s at the unit, steady) that slides it: q (Cf A_side + mu CL A_plan) =
-- mu W + anchors.
function MobileHome.slideSpeed(h: Home): number
	local u = MobileHome.unitProps(h)
	local q = (u.mu * u.weight + u.anchorH) / (CF_BROADSIDE * u.areaSide + u.mu * u.cl * u.areaPlan)
	return sqrt(2 * q / RHO)
end

-- ... and that tips it about its leeward support (the pier line, or the floor's edge off the
-- piers): q (Cf A_side arm + CL A_plan b) = W b + anchors 2b.
function MobileHome.tipSpeed(h: Home): number
	local u = MobileHome.unitProps(h)
	local b = if h.onPiers then PIER_Z else SECTION_Z
	local pivotY = if h.onPiers then PIER_HEIGHT else 0
	local arm = u.loadY - pivotY
	local q = (u.weight * b + u.anchorV * 2 * b) / (CF_BROADSIDE * u.areaSide * arm + u.cl * u.areaPlan * b)
	return sqrt(2 * q / RHO)
end

-- the unit's pose for drawing: along offset, cross-section translation and roll (local frame)
function MobileHome.pose(h: Home): (number, number, number, number)
	return h.along, h.ty, h.tz, h.angle
end

-- the corners of the cross-section now (y, z)
local function corners(h: Home): { { number } }
	local out = {}
	for _, c in { { SECTION_Y0, -SECTION_Z }, { SECTION_Y0, SECTION_Z }, { SECTION_Y1, SECTION_Z }, { SECTION_Y1, -SECTION_Z } } do
		local y, z = sectionPoint(h, c[1], c[2])
		table.insert(out, { y, z })
	end
	return out
end

local function event(h: Home, degree: number, wind: number)
	if h.seen[degree] then
		return
	end
	h.seen[degree] = true
	local _, _, _, text = dodRow(degree)
	if degree > h.stage then
		h.stage, h.stageText = degree, text
	end
	table.insert(h.events, { degree = degree, text = text, wind = wind })
end

-- rotate the cross-section by d about the point (py, pz)
local function rotateAbout(h: Home, d: number, py: number, pz: number)
	local cd, sd = cos(d), sin(d)
	local ry, rz = h.ty - py, h.tz - pz
	h.ty = py + ry * cd - rz * sd
	h.tz = pz + rz * cd + ry * sd
	h.angle += d
end

-- The unit through dt: forces from the wind at its centre (wind relative to its own motion).
local function stepUnit(h: Home, dt: number, wind: (number, number, number) -> (number, number, number))
	local u = MobileHome.unitProps(h)
	if u.mass <= 0 then
		return
	end
	-- the wind on the unit at its centre of mass, relative to its own velocity, in local axes;
	-- the side force acts at the centre of the side area (ly, lz)
	local cy, cz = sectionPoint(h, u.comY, 0)
	local ly = sectionPoint(h, u.loadY, 0)
	local sx, sy = toSim(h, 0, u.comY, 0)
	local wu, wv, ww = wind(sx, sy, max(1, cy))
	local wa, wc = toLocalH(h, wu, wv)
	local wind10 = sqrt(wa * wa + wc * wc)
	local ra, rc, rw = wa - h.vAlong, wc - h.vz, ww - h.vy
	local qa, qc = 0.5 * RHO * ra * abs(ra), 0.5 * RHO * rc * abs(rc)
	local q = 0.5 * RHO * (ra * ra + rc * rc)
	local ca, sa = abs(cos(h.angle)), abs(sin(h.angle))
	-- rolled, the unit shows its floor or roof to the wind and its walls to the sky
	local side = u.areaSide * ca + u.areaPlan * sa
	local plan = u.areaPlan * ca + u.areaSide * sa
	local fAcross = qc * CF_BROADSIDE * side
	local fAlong = qa * CF_BROADSIDE * u.areaEnd
	local lift = q * u.cl * plan * ca + 0.5 * RHO * rw * abs(rw) * plan
	local W = u.weight
	h.peakWind = max(h.peakWind, wind10)

	if h.airborne then
		-- free flight: drag on the relative wind, gravity; spin decays
		h.vz += fAcross / u.mass * dt
		h.vAlong += fAlong / u.mass * dt
		h.vy += (lift - W) / u.mass * dt
		h.tz += h.vz * dt
		h.along += h.vAlong * dt
		h.ty += h.vy * dt
		rotateAbout(h, h.omega * dt, cy, cz)
		h.omega *= math.exp(-ROLL_DAMP * dt)
		local lowest = math.huge
		for _, c in corners(h) do
			lowest = min(lowest, c[1])
		end
		if lowest <= 0 then
			h.ty -= lowest
			h.airborne = false
			h.vy, h.vz, h.vAlong = 0, h.vz * 0.3, h.vAlong * 0.3
			h.omega = 0
		end
		return
	end

	-- lofted: the uplift beats the weight and the ties
	if lift > W + u.anchorV * 2 then
		h.airborne = true
		h.anchorsHeld = false
		h.onPiers = false
		h.pivot = nil
		h.omega = 0
		event(h, 7, wind10)
		return
	end

	if h.pivot then
		-- tipping about a corner: I w' = leeward moment of the side force and of (W - L)
		local py, pz = h.pivot[1], h.pivot[2]
		local s = h.rollDir
		local I = u.mass * ((2 * SECTION_Z) ^ 2 + (SECTION_Y1 - SECTION_Y0) ^ 2) / 3
		local m = s * fAcross * (ly - py) + (W - lift) * s * (cz - pz)
		h.omega += (m / I - ROLL_DAMP * h.omega) * dt
		rotateAbout(h, s * h.omega * dt, py, pz)
		if h.onPiers and s * h.angle <= 0 then
			-- back down on its piers
			rotateAbout(h, -h.angle, py, pz)
			h.pivot, h.omega = nil, 0
			return
		end
		if h.onPiers and abs(h.angle) > 0.12 then
			-- tipped off the pier line: it comes down on its leeward edge (below)
			h.onPiers = false
			h.anchorsHeld = false
		end
		-- contact: another corner reaches the ground
		local best, bestY = nil, 0.02
		for _, c in corners(h) do
			if (abs(c[1] - py) > 0.05 or abs(c[2] - pz) > 0.05) and c[1] < bestY then
				best, bestY = c, c[1]
			end
		end
		if best then
			h.ty -= bestY
			if s * (best[2] - pz) > 0 then
				-- the leeward corner landed: from now it turns about that one, slowed by the blow
				h.pivot = { 0, best[2] }
				h.omega *= IMPACT_KEEP
			else
				-- it fell back onto the face it came from
				h.pivot, h.omega = nil, 0
			end
		end
		if abs(h.angle) >= math.rad(80) then
			event(h, 5, wind10)
		end
		return
	end

	-- standing (on the piers or on a face): settled on the ground when off the piers
	if not h.onPiers then
		local lowest = math.huge
		for _, c in corners(h) do
			lowest = min(lowest, c[1])
		end
		if lowest > 0.01 then
			h.ty -= lowest
		end
	end
	-- does it tip about its leeward support (the pier line, or its leeward ground corner)?
	local N = max(0, W - lift)
	local friction = u.mu * N
	local s = if fAcross >= 0 then 1 else -1
	local py, pz
	if h.onPiers then
		py, pz = sectionPoint(h, PIER_HEIGHT, s * PIER_Z)
	else
		local lowY = math.huge
		for _, c in corners(h) do
			lowY = min(lowY, c[1])
		end
		for _, c in corners(h) do
			if c[1] < lowY + 0.05 and (pz == nil or s * c[2] > s * pz) then
				py, pz = c[1], c[2]
			end
		end
	end
	local tipM = abs(fAcross) * (ly - py) - N * s * (pz - cz)
	local anchorM = u.anchorV * abs(pz - cz) * 2
	if tipM > 0 and tipM > anchorM then
		h.pivot = { py, pz }
		h.rollDir = s
		h.omega = 0
		h.anchorsHeld = false -- the windward ties pull out
		h.vz, h.vAlong = 0, 0
		return
	end
	-- does it slide (friction and the ties)?
	local fH = sqrt(fAcross * fAcross + fAlong * fAlong)
	local speed = sqrt(h.vz * h.vz + h.vAlong * h.vAlong)
	if speed > 0.01 or fH > friction + u.anchorH then
		if h.anchorsHeld then
			h.anchorsHeld = false -- the ties pull out or snap
		end
		-- kinetic friction against the motion (or against the push, starting)
		local dirA, dirC
		if speed > 0.01 then
			dirA, dirC = h.vAlong / speed, h.vz / speed
		else
			dirA, dirC = fAlong / fH, fAcross / fH
		end
		local nva = h.vAlong + (fAlong - friction * dirA) / u.mass * dt
		local nvz = h.vz + (fAcross - friction * dirC) / u.mass * dt
		if nva * h.vAlong + nvz * h.vz < 0 and fH <= friction then
			nva, nvz = 0, 0 -- friction stops it, never reverses it
		end
		h.vAlong, h.vz = nva, nvz
		h.along += h.vAlong * dt
		h.tz += h.vz * dt
		if h.onPiers and (abs(h.tz) > PIER_SEAT or abs(h.along) > PIER_SPACING) then
			-- the beams ride off the pier tops: it drops to the ground, upright
			h.onPiers = false
			h.ty -= PIER_HEIGHT
			h.vy = 0
			event(h, 3, wind10)
		elseif abs(h.tz) + abs(h.along) > 0.5 then
			event(h, 3, wind10)
		end
	end
end

-- Load every attached piece and move the unit, dt seconds. Returns the pieces that failed (each:
-- { name, piece, x, y, z (sim, above the ground), u, v, w, class, count: release count pieces
-- of that Sim/Debris class - the piece itself, or the units a covering tears into}) and the unit
-- events of this step.
function MobileHome.step(h: Home, dt: number, wind: (number, number, number) -> (number, number, number)): ({ any }, { any })
	h.events = {}
	local failed = {}
	local moved = not h.onPiers or abs(h.along) + abs(h.tz) > 0.3
	for _, name in ORDER do
		local p = h.pieces[name]
		if p and not p.gone then
			local b = p.base
			-- reachable: everything that covers it is gone (piers: also once the unit has left them)
			local open = true
			for _, r in b.req do
				local o = h.pieces[r]
				if o and not o.gone and not (p.cat.ground and moved) then
					open = false
					break
				end
			end
			if open then
				local sx, sy, sz
				if p.cat.apart then
					sx, sy, sz = toSimFixed(h, b.pos[1], b.pos[2], b.pos[3])
				else
					sx, sy, sz = toSim(h, b.pos[1], b.pos[2], b.pos[3])
				end
				local u, v, w = wind(sx, sy, max(0.5, sz))
				local hs2 = u * u + v * v
				local factor = 1
				if b.normal then
					local hs = sqrt(hs2)
					local c = 0
					if hs > 0.1 then
						-- the normal in sim axes (rolled with the unit), against the upwind direction
						local n = b.normal
						local ca, sa = cos(h.angle), sin(h.angle)
						local nz = n[3] * ca + n[2] * sa
						local nh = sqrt(n[1] * n[1] + nz * nz)
						if nh > 0.05 then
							local na, ncz = toLocalH(h, -u / hs, -v / hs)
							c = (n[1] * na + nz * ncz) / nh
						end
					end
					if p.cat.face == "roof" then
						factor = netCp(cpRoof(c), h.breached) / REF_ROOF
						hs2 += 3 * w * abs(w)
					else
						factor = netCp(cpWall(c), h.breached) / REF_WALL
					end
				end
				local capacity = p.failSpeed * profile(sz)
				if Damage.accumulate(p, factor * max(0, hs2) / (capacity * capacity), dt) then
					p.gone = true
					if p.cat.breach then
						h.breached = true
					end
					event(h, p.cat.dod, sqrt(hs2))
					-- the piece leaves with the unit's motion (the wind takes it from there)
					local ua, uc = if p.cat.apart or p.cat.ground then 0 else h.vAlong, if p.cat.apart or p.cat.ground then 0 else h.vz
					local du = ua * h.ch + uc * h.sh
					local dv = ua * h.sh - uc * h.ch
					local rec = { name = name, piece = b, x = sx, y = sy, z = sz, u = du, v = dv, w = if p.cat.apart or p.cat.ground then 0 else h.vy }
					if p.cat.tears then
						rec.class, rec.count = p.cat.tears, b.fragments
					else
						rec.class, rec.count = b.debris.name, 1
					end
					table.insert(failed, rec)
				end
			end
		end
	end
	stepUnit(h, dt, wind)
	return failed, h.events
end

-- Whether anything is left to happen (every piece but the piers gone, nothing moving).
function MobileHome.finished(h: Home): boolean
	for _, p in h.pieces do
		if not p.gone and not p.cat.ground then
			return false
		end
	end
	return true
end

return MobileHome
