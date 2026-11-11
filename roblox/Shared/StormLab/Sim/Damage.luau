--!nonstrict
-- Wind damage (guide section 5): every structure is a list of components, each with its own
-- resistance drawn once from the EF scale's degree-of-damage tables (expected wind, spread
-- between the lower and upper bounds), compared with the wind load on it:
--   q = 1/2 rho V^2 (dynamic pressure, V a 3-s mean at the component's height; roof parts add
--   the updraft), F ~ q Cp A.
-- Damage accumulates while the load exceeds the capacity (short gusts above it do partial
-- harm), so duration counts; a breached envelope (windows, garage door) raises the internal
-- pressure and weakens the roof (x0.87: sqrt(1.18 / 1.55), Cpi +0.18 -> +0.55). Components fail
-- in a sensible order because later ones depend on earlier ones. The structure's stage is its
-- highest failed degree of damage: intact -> exterior damage -> partial collapse -> destroyed.
-- Pure: the server owns the state; clients only see stage changes and the debris released.
local function dep(name: string): any
	if script then
		return require((script :: any).Parent:FindFirstChild(name))
	end
	return (require :: any)("./" .. name)
end
local Noise = dep("Noise")

local Damage = {}

local RHO = 1.15
local MPH = 0.44704

-- EF-scale damage indicators: { degree, description, expected, lower, upper (mph), debris class,
-- debris count, component group }. (WSEC 2006 / NWS EF-scale DI tables)
Damage.DI = {
	house = {
		name = "one- or two-family residence (DI 2)",
		{ 1, "visible damage: siding, gutters", 65, 53, 80, "shingle", 6, "trim" },
		{ 2, "loss of roof covering (<20%)", 79, 63, 97, "shingle", 18, "roofCover" },
		{ 3, "broken windows and doors", 96, 79, 114, "paper", 8, "windows", breach = true },
		{ 4, "roof deck uplift, garage door collapse", 97, 81, 116, "plywood", 10, "roofDeck", breach = true },
		{ 5, "house shifts off foundation", 121, 103, 141, "board", 10, "anchors" },
		{ 6, "large sections of roof structure removed", 122, 104, 142, "board", 16, "roofFrame", roof = true },
		{ 7, "exterior walls collapsed", 132, 113, 153, "board", 22, "extWalls" },
		{ 8, "most walls collapsed", 152, 127, 178, "plywood", 20, "intWalls" },
		{ 9, "all walls collapsed", 170, 142, 198, "board", 24, "allWalls" },
		{ 10, "slab swept clean", 200, 165, 220, "beam", 6, "slab" },
	},
	mobileHome = {
		name = "single-wide mobile home (DI 3)",
		{ 1, "loss of trim, skirting", 61, 51, 76, "sheetMetal", 3, "trim" },
		{ 2, "loss of roof covering", 74, 61, 92, "sheetMetal", 6, "roofCover", roof = true },
		{ 3, "unit slides off its blocks", 87, 72, 103, nil, 0, "anchors" },
		{ 4, "complete uplift of roof; most walls stand", 89, 73, 112, "sheetMetal", 8, "roofFrame", roof = true },
		{ 5, "unit rolls or vaults", 98, 84, 114, "plywood", 10, "roll" },
		{ 6, "walls and roof destroyed", 105, 88, 122, "board", 16, "extWalls" },
		{ 7, "frame separated from the floor", 115, 98, 132, "beam", 4, "allWalls" },
	},
	barn = {
		name = "farm outbuilding (DI 1)",
		{ 1, "loss of wall or roof panels", 62, 53, 78, "sheetMetal", 8, "roofCover", roof = true },
		{ 2, "collapse of doors", 74, 61, 91, "sheetMetal", 4, "windows", breach = true },
		{ 3, "major loss of roof panels", 83, 70, 98, "sheetMetal", 10, "roofFrame", roof = true },
		{ 4, "uplift or collapse of roof structure", 91, 77, 106, "beam", 6, "extWalls" },
		{ 5, "collapse of walls", 97, 82, 112, "board", 12, "allWalls" },
		{ 6, "total destruction", 106, 90, 124, "board", 10, "slab" },
	},
	tree = {
		name = "hardwood tree (DI 27)",
		{ 1, "small limbs broken", 60, 48, 72, "leaf", 20, "limbs" },
		{ 2, "large branches broken", 74, 61, 88, "branch", 4, "branches" },
		{ 3, "tree uprooted", 91, 76, 118, "branch", 3, "uproot" },
		{ 4, "trunk snapped", 110, 93, 134, "branch", 4, "trunk" },
		{ 5, "tree debarked, stubs of the largest branches left", 143, 123, 167, "branch", 6, "debark" },
	},
	pole = {
		name = "wood power pole (DI 25)",
		{ 1, "cross-arm or wires down", 80, 65, 95, "board", 1, "wires" },
		{ 2, "pole leaning", 95, 80, 110, nil, 0, "lean" },
		{ 3, "pole snapped", 118, 98, 137, "beam", 1, "snap" },
	},
}

export type Structure = {
	id: string,
	di: string,
	x: number, y: number,
	height: number,
	roofZ: number,
	components: { any },
	breached: boolean,
	stage: number, -- highest failed degree
	stageText: string,
	peakWind: number,
	history: { any },
}

-- A structure with its components' failure speeds drawn once (normal around the expected speed,
-- sigma = (upper - lower) / 4), with an optional quality multiplier (anchoring straps 1.2, poor
-- construction 0.85).
function Damage.newStructure(id: string, di: string, x: number, y: number, height: number, seed: number, quality: number?): Structure
	local rng = Noise.rng(seed)
	local spec = Damage.DI[di]
	local q = quality or 1
	local comps = {}
	local last = 0
	for _, row in ipairs(spec) do
		local expected, lower, upper = row[3] * MPH, row[4] * MPH, row[5] * MPH
		local sigma = (upper - lower) / 4
		local speed = math.clamp(expected + rng:normal() * sigma, lower, upper) * q
		-- failure order: never weaker than the degree below it
		speed = math.max(speed, last + 0.5)
		last = speed
		table.insert(comps, {
			degree = row[1], text = row[2], failSpeed = speed, debris = row[6], debrisCount = row[7],
			group = row[8], breach = row.breach, roof = row.roof, damage = 0, failed = false,
		})
	end
	return {
		id = id, di = di, x = x, y = y, height = height, roofZ = height,
		components = comps, breached = false, stage = 0, stageText = "intact", peakWind = 0, history = {},
	}
end

-- Load the structure with a wind sample over dt seconds. wind: horizontal speed at mid-height
-- (3-s mean), roofWind: speed at the roof including the updraft. Returns the components that
-- failed this step (each: { degree, debris, count, text }).
function Damage.apply(s: Structure, dt: number, wind: number, roofWind: number): { any }
	local failed = {}
	s.peakWind = math.max(s.peakWind, wind)
	for _, c in s.components do
		if not c.failed then
			local capacity = c.failSpeed
			if c.roof and s.breached then
				capacity *= 0.87
			end
			local v = if c.roof then roofWind else wind
			-- load ratio in dynamic pressure: q / q_fail = (v / v_fail)^2
			local ratio = (v / capacity) ^ 2
			if ratio > 1 then
				-- accumulates in ~1.5 s at just above capacity, instantly far beyond it
				c.damage += (ratio - 1) * dt / 0.3 + (if ratio > 1.4 then 1 else 0)
			else
				c.damage = math.max(0, c.damage - dt * 0.05)
			end
			if c.damage >= 1 then
				c.failed = true
				if c.breach then
					s.breached = true
				end
				if c.degree > s.stage then
					s.stage = c.degree
					s.stageText = c.text
				end
				table.insert(failed, { degree = c.degree, debris = c.debris, count = c.debrisCount, text = c.text, group = c.group })
				table.insert(s.history, { degree = c.degree, wind = v })
			end
		end
	end
	return failed
end

-- dynamic pressure (Pa) and the force on a surface: F ~ q Cp A
function Damage.dynamicPressure(v: number): number
	return 0.5 * RHO * v * v
end

-- the EF rating a structure's damage implies (the degree's expected wind)
function Damage.ratingOf(s: Structure): (number, number)
	if s.stage == 0 then
		return -1, 0
	end
	local spec = Damage.DI[s.di]
	local mph = spec[s.stage][3]
	local ef = if mph < 86 then 0 elseif mph < 111 then 1 elseif mph < 136 then 2 elseif mph < 166 then 3 elseif mph < 201 then 4 else 5
	return ef, mph
end

return Damage
