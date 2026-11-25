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
		-- all nine DODs: 1-6 as published in mph (WSEC 2006), 7-9 from the Canadian EF-scale guide's km/h
		-- table (ECCC 2013, same DOD list), converted. Sim/MobileHome loads the home piece by piece and
		-- moves the unit (DOD 3, 5, 7) by force balance; this table gives each piece's capacity.
		name = "single-wide mobile home (DI 3)",
		{ 1, "threshold of visible damage", 61, 51, 76, "sheetMetal", 3, "trim" },
		{ 2, "loss of shingles or partial uplift of the roof covering", 74, 61, 92, "shingle", 6, "roofCover", roof = true },
		{ 3, "unit slides off its block piers but stays upright", 87, 72, 103, nil, 0, "anchors" },
		{ 4, "complete uplift of the roof; most walls stand", 89, 73, 112, "sheetMetal", 8, "roofFrame", roof = true },
		{ 5, "unit rolls on its side or upside down, essentially intact", 98, 84, 114, "plywood", 10, "roll" },
		{ 6, "roof and walls destroyed, floor and undercarriage left", 105, 88, 122, "board", 16, "extWalls" },
		{ 7, "unit rolls or vaults; roof and walls separate from the floor", 109, 96, 127, "board", 12, "allWalls" },
		{ 8, "undercarriage separates from the unit, rolls and is badly bent", 118, 103, 137, "beam", 4, "frame" },
		{ 9, "complete destruction; debris blown away", 127, 109, 149, "beam", 4, "slab" },
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
	-- Shops, offices, schools and other buildings (2026-11-17): the EF scale's own tables (SPC efscale/N.html,
	-- TTU 2006 Appendix A), keyed by its abbreviations. Group: the look of the degree (Server StructureDamage);
	-- debris: its class and count. (ACT's last degree, total destruction, has no winds in the source.)
	ACT = {
		name = "Apartments, condos, townhouses (3 stories or less) (DI 5)",
		{ 1, "Threshold of visible damage", 76, 63, 95, "shingle", 4, "trim" },
		{ 2, "Loss of roof covering (<20%)", 99, 82, 121, "shingle", 10, "roofCover", roof = true },
		{ 3, "Uplift of roof decking; significant loss of roof covering (>20%)", 124, 107, 146, "plywood", 10, "roofDeck", roof = true },
		{ 4, "Uplift or collapse of roof structure leaving most walls standing", 138, 120, 158, "beam", 8, "roofFrame", roof = true },
		{ 5, "Most top story walls collapsed", 158, 138, 184, "board", 12, "extWalls" },
		{ 6, "Almost total destruction of top two stories", 180, 155, 205, "block", 12, "intWalls" },
	},
	M = {
		name = "Motel (DI 6)",
		{ 1, "Threshold of visible damage", 66, 54, 83, "shingle", 4, "trim" },
		{ 2, "Loss of roof covering (<20%)", 80, 67, 99, "shingle", 10, "roofCover", roof = true },
		{ 3, "Broken windows or patio doors", 89, 74, 107, "glass", 8, "windows", breach = true },
		{ 4, "Uplift of roof decking; significant loss of roof covering (>20%); loss of EIFS wall cladding", 95, 80, 116, "plywood", 10, "roofDeck", roof = true },
		{ 5, "Uplift or collapse of canopy over driveway", 99, 81, 118, "sheetMetal", 6, "canopy" },
		{ 6, "Uplift or collapse of roof structure leaving most walls standing", 123, 103, 143, "beam", 8, "roofFrame", roof = true },
		{ 7, "Collapse of top story exterior walls", 138, 121, 156, "board", 12, "extWalls" },
		{ 8, "Collapse of most top story walls", 143, 127, 162, "block", 10, "intWalls" },
		{ 9, "Collapse of top two floors of three or more stories", 170, 144, 185, "block", 12, "allWalls" },
		{ 10, "Total destruction of entire building", 190, 163, 217, "block", 10, "slab" },
	},
	MAM = {
		name = "Masonry apartment or motel (DI 7)",
		{ 1, "Threshold of visible damage", 65, 54, 81, "shingle", 4, "trim" },
		{ 2, "Loss of roof covering (<20%)", 80, 67, 101, "shingle", 10, "roofCover", roof = true },
		{ 3, "Uplift of lightweight metal roof decking", 95, 81, 116, "sheetMetal", 10, "roofDeck", roof = true },
		{ 4, "Uplift of pre-cast or cast-in-place concrete roof decking", 121, 103, 143, "block", 8, "roofFrame", roof = true },
		{ 5, "Collapse of top story walls", 133, 115, 150, "block", 12, "extWalls" },
		{ 6, "Collapse of top two floors of three or more stories", 156, 132, 180, "block", 12, "intWalls" },
		{ 7, "Total destruction of a large section of building", 180, 160, 205, "block", 12, "slab" },
	},
	SRB = {
		name = "Small retail building (fast food) (DI 8)",
		{ 1, "Threshold of visible damage", 65, 54, 81, "shingle", 4, "trim" },
		{ 2, "Loss of roof covering (<20%)", 78, 65, 98, "shingle", 8, "roofCover", roof = true },
		{ 3, "Broken glass in windows and doors", 86, 72, 103, "glass", 8, "windows", breach = true },
		{ 4, "Uplift of roof decking; significant loss of roof covering (>20%)", 98, 81, 119, "plywood", 8, "roofDeck", roof = true },
		{ 5, "Canopies or covered walkways destroyed", 98, 83, 114, "sheetMetal", 6, "canopy" },
		{ 6, "Uplift or collapse of entire roof structure", 119, 101, 140, "beam", 8, "roofFrame", roof = true },
		{ 7, "Collapse of exterior walls; closely spaced interior walls remain standing", 138, 120, 159, "block", 12, "extWalls" },
		{ 8, "Total destruction of entire building", 167, 143, 193, "block", 12, "slab" },
	},
	SPB = {
		name = "Small professional building (doctor office, branch bank) (DI 9)",
		{ 1, "Threshold of visible damage", 65, 54, 81, "shingle", 4, "trim" },
		{ 2, "Loss of roof covering (<20%)", 78, 65, 98, "shingle", 8, "roofCover", roof = true },
		{ 3, "Broken windows, including clear story windows or skylights", 89, 74, 107, "glass", 8, "windows", breach = true },
		{ 4, "Exterior doors fail", 100, 82, 118, "glass", 4, "doors", breach = true },
		{ 5, "Uplift of roof decking; significant loss of roof covering (>20%); loss of rooftop HVAC equipment", 100, 84, 117, "plywood", 8, "roofDeck", roof = true },
		{ 6, "Collapsed facade or parapet walls", 103, 85, 123, "block", 8, "facade" },
		{ 7, "Uplift or collapse of entire roof structure", 124, 105, 145, "beam", 8, "roofFrame", roof = true },
		{ 8, "Collapse of exterior walls; closely spaced interior walls remain standing", 144, 123, 165, "block", 12, "extWalls" },
		{ 9, "Total destruction of entire building", 157, 148, 200, "block", 12, "slab" },
	},
	SM = {
		name = "Strip mall (DI 10)",
		{ 1, "Threshold of visible damage", 65, 54, 81, "shingle", 4, "trim" },
		{ 2, "Uplift of roof covering at eaves and roof corners", 80, 66, 100, "shingle", 8, "roofCover", roof = true },
		{ 3, "Broken windows or glass doors", 88, 72, 105, "glass", 10, "windows", breach = true },
		{ 4, "Uplift of roof decking", 101, 84, 122, "plywood", 10, "roofDeck", roof = true },
		{ 5, "Collapsed facade or parapet walls", 103, 85, 125, "block", 8, "facade" },
		{ 6, "Covered walkways uplifted or collapsed", 103, 86, 125, "sheetMetal", 8, "canopy" },
		{ 7, "Uplift or collapse of entire roof structure", 122, 103, 143, "beam", 10, "roofFrame", roof = true },
		{ 8, "Collapse of exterior walls; closely spaced interior walls remain standing", 140, 117, 165, "block", 12, "extWalls" },
		{ 9, "Complete destruction of all or a large section of building", 171, 147, 198, "block", 12, "slab" },
	},
	LSM = {
		name = "Large shopping mall (DI 11)",
		{ 1, "Threshold of visible damage", 71, 59, 86, "shingle", 4, "trim" },
		{ 2, "Loss of roof covering (<20%)", 85, 69, 105, "shingle", 10, "roofCover", roof = true },
		{ 3, "Broken skylights, clearstory windows and atrium walls", 92, 75, 114, "glass", 10, "windows", breach = true },
		{ 4, "Uplift of some roof decking; significant loss of roofing material (>20%); loss of rooftop HVAC", 108, 92, 128, "sheetMetal", 10, "roofDeck", roof = true },
		{ 5, "Wall cladding stripped starting at corners and progressing to other areas", 111, 94, 131, "sheetMetal", 10, "facade" },
		{ 6, "Roof structure uplifted or collapsed", 128, 108, 150, "beam", 10, "roofFrame", roof = true },
		{ 7, "Exterior walls in top story collapsed", 144, 124, 166, "block", 12, "extWalls" },
		{ 8, "Interior walls of top story collapse", 160, 139, 185, "block", 12, "intWalls" },
		{ 9, "Complete destruction of all or a large section of the building", 204, 176, 247, "block", 12, "slab" },
	},
	LIRB = {
		name = "Large isolated (\"big box\") retail building (DI 12)",
		{ 1, "Threshold of visible damage", 68, 57, 83, "shingle", 4, "trim" },
		{ 2, "Loss of roof covering (<20%)", 81, 68, 103, "shingle", 10, "roofCover", roof = true },
		{ 3, "Uplift of some roof decking; significant loss of roofing material (>20%); loss of rooftop HVAC", 103, 87, 123, "sheetMetal", 10, "roofDeck", roof = true },
		{ 4, "Long roof spans collapsed downward", 122, 103, 144, "beam", 8, "roofFrame", roof = true },
		{ 5, "Uplift and removal of roof structure", 134, 114, 157, "beam", 8, "roofFrame", roof = true },
		{ 6, "Inward or outward collapse of exterior walls", 137, 118, 158, "block", 12, "extWalls" },
		{ 7, "Complete destruction of all or a large section of the building", 173, 147, 201, "block", 12, "slab" },
	},
	ASR = {
		name = "Automobile showroom (DI 13)",
		{ 1, "Threshold of visible damage", 65, 47, 80, "shingle", 4, "trim" },
		{ 2, "Loss of roof covering (<20%)", 80, 67, 101, "shingle", 8, "roofCover", roof = true },
		{ 3, "Broken glass in windows or doors", 87, 71, 106, "glass", 10, "windows", breach = true },
		{ 4, "Uplift of some roof decking; significant loss of roofing material (>20%); loss of rooftop HVAC", 101, 83, 120, "sheetMetal", 8, "roofDeck", roof = true },
		{ 5, "Cladding stripped off walls", 112, 94, 132, "sheetMetal", 8, "facade" },
		{ 6, "Uplift or collapse of roof structure", 118, 98, 140, "beam", 8, "roofFrame", roof = true },
		{ 7, "Exterior walls collapsed", 126, 106, 148, "block", 12, "extWalls" },
		{ 8, "Complete destruction of all or a large section of the building", 157, 138, 181, "block", 12, "slab" },
	},
	ASB = {
		name = "Automotive service building (DI 14)",
		{ 1, "Threshold of visible damage", 63, 46, 79, "shingle", 4, "trim" },
		{ 2, "Loss of roof covering (<20%)", 78, 65, 99, "shingle", 8, "roofCover", roof = true },
		{ 3, "Failure of large overhead doors", 91, 77, 110, "sheetMetal", 6, "doors", breach = true },
		{ 4, "Uplift of some roof decking; significant loss of roofing material (>20%); loss of rooftop HVAC", 98, 80, 119, "sheetMetal", 8, "roofDeck", roof = true },
		{ 5, "Collapse of non-bearing masonry or tilt-up walls", 114, 94, 134, "block", 10, "facade" },
		{ 6, "Uplift or collapse of roof structure", 121, 102, 143, "beam", 8, "roofFrame", roof = true },
		{ 7, "Collapse of load-bearing walls", 128, 106, 149, "block", 12, "extWalls" },
		{ 8, "Complete destruction of all or a large section of the building", 157, 138, 181, "block", 12, "slab" },
	},
	ES = {
		name = "Elementary school (single story) (DI 15)",
		{ 1, "Threshold of visible damage", 65, 47, 80, "shingle", 4, "trim" },
		{ 2, "Loss of roof covering (<20%)", 79, 66, 99, "shingle", 10, "roofCover", roof = true },
		{ 3, "Broken windows", 87, 71, 106, "glass", 10, "windows", breach = true },
		{ 4, "Exterior door failures", 99, 85, 118, "glass", 4, "doors", breach = true },
		{ 5, "Uplift of some roof decking; significant loss of roofing material (>20%); loss of rooftop HVAC", 101, 82, 121, "sheetMetal", 10, "roofDeck", roof = true },
		{ 6, "Damage to or loss of wall cladding", 108, 92, 127, "block", 8, "facade" },
		{ 7, "Uplift or collapse of roof structure", 125, 108, 148, "beam", 10, "roofFrame", roof = true },
		{ 8, "Collapse of non-bearing walls", 139, 117, 162, "block", 12, "extWalls" },
		{ 9, "Collapse of load-bearing walls", 153, 130, 180, "block", 12, "intWalls" },
		{ 10, "Total destruction of a large section of building or entire building", 176, 152, 203, "block", 12, "slab" },
	},
	JHSH = {
		name = "Junior or senior high school (DI 16)",
		{ 1, "Threshold of visible damage", 68, 55, 83, "shingle", 4, "trim" },
		{ 2, "Loss of roof covering (<20%)", 79, 66, 99, "shingle", 10, "roofCover", roof = true },
		{ 3, "Broken windows", 87, 71, 106, "glass", 10, "windows", breach = true },
		{ 4, "Exterior door failures", 101, 83, 121, "glass", 4, "doors", breach = true },
		{ 5, "Uplift of metal roof decking; significant loss of roofing material (>20%); loss of rooftop HVAC", 101, 85, 119, "sheetMetal", 10, "roofDeck", roof = true },
		{ 6, "Damage to or loss of wall cladding", 108, 92, 127, "block", 8, "facade" },
		{ 7, "Collapse of tall masonry walls at gym, cafeteria or auditorium", 114, 94, 136, "block", 10, "tallWall" },
		{ 8, "Uplift or collapse of light steel roof structure", 125, 108, 148, "beam", 10, "roofFrame", roof = true },
		{ 9, "Collapse of exterior walls in top floor", 139, 121, 153, "block", 12, "extWalls" },
		{ 10, "Most interior walls of top floor collapsed", 158, 133, 186, "block", 12, "intWalls" },
		{ 11, "Complete destruction of all or a large section of building", 192, 163, 224, "block", 12, "slab" },
	},
	LRB = {
		name = "Low-rise building (1-4 stories) (DI 17)",
		{ 1, "Threshold of visible damage", 68, 55, 83, "shingle", 4, "trim" },
		{ 2, "Loss of roof covering (<20%)", 80, 67, 103, "shingle", 10, "roofCover", roof = true },
		{ 3, "Uplift of metal roof decking at eaves and roof corners; significant loss of roofing material (>20%)", 101, 83, 120, "sheetMetal", 10, "roofDeck", roof = true },
		{ 4, "Broken glass in windows, entryways or atriums", 101, 83, 122, "glass", 10, "windows", breach = true },
		{ 5, "Uplift of lightweight roof structure", 133, 114, 157, "beam", 10, "roofFrame", roof = true },
		{ 6, "Significant damage to exterior walls and some interior walls", 143, 122, 167, "block", 12, "extWalls" },
		{ 7, "Complete destruction of all or a large section of building", 188, 161, 221, "block", 12, "slab" },
	},
	MRB = {
		name = "Mid-rise building (5-20 stories) (DI 18)",
		{ 1, "Threshold of visible damage", 70, 58, 86, "shingle", 4, "trim" },
		{ 2, "Loss of roof covering (<20%)", 83, 68, 103, "shingle", 8, "roofCover", roof = true },
		{ 3, "Damage to penthouse roof and walls; loss of rooftop HVAC equipment", 92, 75, 113, "sheetMetal", 6, "penthouse", roof = true },
		{ 4, "Damage to parapet walls or coping", 99, 83, 118, "block", 6, "facade" },
		{ 5, "Broken glass in curtain walls; glass in entryways; significant damage to building interior", 101, 83, 120, "glass", 12, "curtain", breach = true },
		{ 6, "Uplift of lightweight roof decking; significant loss of roofing material (>20%)", 119, 98, 140, "sheetMetal", 8, "roofDeck", roof = true },
		{ 7, "Broken curtain wall panel anchors", 129, 110, 150, "glass", 10, "panels" },
		{ 8, "Uplift or collapse of roof structure", 136, 118, 158, "beam", 8, "roofFrame", roof = true },
		{ 9, "Significant damage to curtain walls and some interior walls", 145, 120, 167, "glass", 12, "gutted" },
		{ 10, "Permanent structural deformation", 210, 181, 268, "beam", 8, "deform" },
	},
	HRB = {
		name = "High-rise building (more than 20 stories) (DI 19)",
		{ 1, "Threshold of visible damage", 70, 58, 86, "shingle", 4, "trim" },
		{ 2, "Loss of roof covering (<20%)", 86, 69, 107, "shingle", 8, "roofCover", roof = true },
		{ 3, "Damage to penthouse roof and walls; loss of rooftop HVAC equipment", 93, 75, 111, "sheetMetal", 6, "penthouse", roof = true },
		{ 4, "Broken glass in exterior walls at 1st and 2nd floors; broken glass in entryways", 101, 83, 120, "glass", 10, "doors", breach = true },
		{ 5, "Damage to parapet walls or coping", 104, 87, 122, "block", 6, "facade" },
		{ 6, "Broken curtain wall panel anchors", 129, 110, 157, "glass", 12, "panels" },
		{ 7, "Significant loss of roofing material (>20%)", 143, 115, 165, "sheetMetal", 8, "roofDeck", roof = true },
		{ 8, "Significant damage to curtain walls and interior walls", 145, 123, 172, "glass", 12, "gutted" },
		{ 9, "Uplift or collapse of roof structure", 159, 123, 183, "beam", 8, "roofFrame", roof = true },
		{ 10, "Significant structural deformation", 228, 190, 290, "beam", 8, "deform" },
	},
	IB = {
		name = "Institutional building (hospital, government or university) (DI 20)",
		{ 1, "Threshold of visible damage", 72, 59, 88, "shingle", 4, "trim" },
		{ 2, "Loss of roof covering (<20%)", 86, 72, 109, "shingle", 10, "roofCover", roof = true },
		{ 3, "Damage to penthouse roof and walls; loss of rooftop HVAC equipment", 92, 75, 111, "sheetMetal", 6, "penthouse", roof = true },
		{ 4, "Broken glass in windows or doors", 95, 78, 115, "glass", 10, "windows", breach = true },
		{ 5, "Uplift of lightweight roof deck and insulation; significant loss of roofing material (>20%)", 114, 95, 136, "sheetMetal", 10, "roofDeck", roof = true },
		{ 6, "Facade components torn from structure", 118, 97, 140, "block", 8, "facade" },
		{ 7, "Damage curtain walls or other wall cladding", 131, 110, 152, "glass", 10, "panels" },
		{ 8, "Uplift of pre-cast concrete roof slabs", 142, 119, 163, "block", 8, "roofFrame", roof = true },
		{ 9, "Uplift of metal deck with concrete fill slab", 146, 118, 170, "block", 8, "roofFrame", roof = true },
		{ 10, "Collapse of some top story exterior walls", 148, 127, 172, "block", 12, "extWalls" },
		{ 11, "Significant damage to building envelope", 210, 178, 268, "block", 12, "intWalls" },
	},
	MBS = {
		name = "Metal building system (DI 21)",
		{ 1, "Threshold of visible damage", 67, 54, 83, "sheetMetal", 4, "trim" },
		{ 2, "Inward or outward collapse of overhead doors", 89, 75, 108, "sheetMetal", 6, "doors", breach = true },
		{ 3, "Metal roof or wall panels pulled from the building", 95, 78, 120, "sheetMetal", 12, "roofDeck", roof = true },
		{ 4, "Column anchorage failed", 117, 96, 135, "beam", 4, "anchors" },
		{ 5, "Buckling of roof purlins", 118, 95, 138, "beam", 8, "roofFrame", roof = true },
		{ 6, "Failure of X-braces in the lateral load resisting system", 138, 118, 158, "sheetMetal", 10, "extWalls" },
		{ 7, "Progressive collapse of rigid frames", 143, 120, 168, "beam", 10, "allWalls" },
		{ 8, "Total destruction of building", 155, 132, 178, "sheetMetal", 10, "slab" },
	},
	SSC = {
		name = "Service station canopy (DI 22)",
		{ 1, "Threshold of visible damage", 63, 45, 79, "sheetMetal", 3, "trim" },
		{ 2, "Fascia material blown from canopy", 78, 64, 96, "sheetMetal", 6, "facade" },
		{ 3, "Metal roof panels stripped from canopy", 92, 74, 113, "sheetMetal", 8, "roofCover", roof = true },
		{ 4, "Columns bend or buckle under wind load", 109, 88, 135, nil, 0, "bend" },
		{ 5, "Canopy collapsed due to column foundation failure", 114, 90, 144, "sheetMetal", 6, "drop" },
		{ 6, "Complete destruction of canopy", 133, 110, 163, "beam", 6, "slab" },
	},
	WHB = {
		name = "Warehouse building (tilt-up walls or heavy timber) (DI 23)",
		{ 1, "Threshold of visible damage", 68, 55, 83, "shingle", 4, "trim" },
		{ 2, "Loss of roofing material (<20%)", 83, 69, 105, "shingle", 10, "roofCover", roof = true },
		{ 3, "Inward or outward collapse of overhead doors", 88, 75, 107, "sheetMetal", 8, "doors", breach = true },
		{ 4, "Uplift of roof deck; significant loss of roofing material (>20%); loss of rooftop HVAC equipment", 103, 88, 122, "sheetMetal", 10, "roofDeck", roof = true },
		{ 5, "Collapse of other non-bearing exterior walls", 114, 93, 126, "block", 10, "facade" },
		{ 6, "Collapse of pre-cast concrete tilt-up panels", 124, 102, 144, "block", 12, "extWalls" },
		{ 7, "Total destruction of a large section of building or entire building", 158, 131, 186, "block", 12, "slab" },
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

-- The load law every component follows: ratio = load / capacity (in dynamic pressure). Above 1
-- damage builds, in ~1.5 s just above capacity and at once far beyond it (ratio > 1.4); below 1
-- it heals slowly (a gust that nearly did it is forgotten in ~20 s). True once c.damage >= 1.
function Damage.accumulate(c: any, ratio: number, dt: number): boolean
	if ratio > 1 then
		c.damage += (ratio - 1) * dt / 0.3 + (if ratio > 1.4 then 1 else 0)
	else
		c.damage = math.max(0, c.damage - dt * 0.05)
	end
	return c.damage >= 1
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
			Damage.accumulate(c, (v / capacity) ^ 2, dt)
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
