--!strict
-- Buildings, lot by lot. What the map plans (Sites: gas stations, schools, campuses, airfields,
-- malls and other superblocks, energy) is built first by Facilities. Then each town block is
-- cut into parcels of uneven size (recursive splits at random ratios), and each parcel gets a
-- building chosen from the land use where it lies (js/worldmap/landUse.js), with its own size,
-- setback, colours and height. Heights in a city follow a clustered noise times the distance
-- from its centre, so the skyline rises and falls instead of stepping evenly. Every footprint is
-- checked against the road network (RoadNet) and what is already placed, and shrunk or dropped
-- if it would reach a road, a sidewalk or another building.
--   downtown area: in the metro and the mid-size city, glass and stone towers of several forms,
--     plazas and parking near the middle, mid-rise offices and older brick blocks further out;
--     in towns and small cities, rows of one- to three-storey brick storefronts (main street);
--   shopping (neighbourhood centres, convenience corners), highway strips and travel centres:
--     strip malls, fast food, stores and offices with their parking;
--   industry: warehouses; in a town, the co-op's grain elevator among them;
--   parks: lawns, trees and a shelter;
--   everywhere else in a place, houses in rows facing the streets (ranch, two-storey,
--     split-level, bungalow with porch, cape with dormer), garages, drives, sheds, yard trees,
--     now and then a church; apartments in the city cores round downtown;
--   landmarks at each town's centre: church and water tower;
--   the country: farmsteads laid out a little differently each time.

local Builder = require(script.Parent.Builder)
local Trees = require(script.Parent.Trees)
local RoadNet = require(script.Parent.RoadNet)
local Facilities = require(script.Parent.Facilities)
local Sites = require(script.Parent.Parent.Sites)

local Buildings = {}

local M = Enum.Material
local hash = Builder.hash
local rgb = Color3.fromRGB

local SIDING = { rgb(236, 232, 222), rgb(214, 202, 178), rgb(182, 196, 206), rgb(160, 164, 166), rgb(226, 212, 150), rgb(170, 184, 156), rgb(196, 176, 160), rgb(140, 156, 170), rgb(222, 190, 160), rgb(120, 132, 118) }
local ROOFS = { rgb(70, 70, 76), rgb(96, 82, 70), rgb(60, 66, 80), rgb(110, 60, 50), rgb(84, 92, 84), rgb(120, 110, 96) }
local BRICK = { rgb(150, 74, 56), rgb(132, 86, 70), rgb(176, 120, 90), rgb(196, 170, 130), rgb(120, 64, 52), rgb(160, 100, 72), rgb(110, 76, 66) }
local GLASSES = { rgb(60, 96, 120), rgb(44, 70, 86), rgb(86, 120, 128), rgb(70, 84, 104), rgb(110, 128, 136), rgb(48, 60, 70), rgb(96, 110, 90) }
local STONE = { rgb(200, 196, 186), rgb(170, 166, 160), rgb(214, 206, 188), rgb(140, 138, 140), rgb(186, 176, 160), rgb(110, 108, 112) }
local BRANDS = { { rgb(200, 30, 36), rgb(250, 250, 250) }, { rgb(20, 70, 160), rgb(240, 200, 30) }, { rgb(20, 120, 70), rgb(250, 220, 40) }, { rgb(230, 110, 20), rgb(40, 40, 40) }, { rgb(110, 30, 120), rgb(240, 240, 240) } }
local GLASS = rgb(150, 190, 210)
local DARK_GLASS = rgb(40, 52, 60)
local DOOR = { rgb(80, 56, 40), rgb(140, 30, 30), rgb(40, 60, 90), rgb(30, 30, 30), rgb(70, 90, 70) }
local CONCRETE = rgb(176, 172, 164)
local ASPHALT = rgb(56, 56, 60)

local function pick<T>(list: { T }, r: number): T
	return list[1 + math.floor(r * #list) % #list]
end

export type Settlement = { kind: string, x: number, z: number, core: number, extent: number, population: number, name: string }

export type Ctx = {
	x0: number, z0: number, x1: number, z1: number,
	props: Builder.Props,
	net: RoadNet.Net,
	inside: (x: number, z: number) -> boolean,
	ground: (x: number, z: number) -> number,
	coverKey: (x: number, z: number) -> string,
	busy: (x: number, z: number) -> boolean,
	water: (x: number, z: number) -> boolean,
	settlements: { Settlement },
	occupied: { { cf: CFrame, hx: number, hz: number } }, -- footprints placed (trees keep out)
	sites: Sites.Set,
	pavedTop: (levelM: number) -> number, -- top of paving laid at a level (m)
}

-- A part in a building's own frame (x across, y up from its base, z back; the front is -z).
local function at(props: Builder.Props, frame: CFrame, x: number, y: number, z: number, sx: number, sy: number, sz: number, color: Color3, material: Enum.Material?, collide: boolean?): Builder.Prop
	return Builder.block(props, frame * CFrame.new(x, y + sy / 2, z), sx, sy, sz, color, material, collide)
end

local function yawOf(frame: CFrame): number
	local _, y = frame:ToEulerAnglesYXZ()
	return y
end

-- A random stream for one lot: next() gives successive numbers 0 to 1.
local function stream(a: number, b: number, salt: number): () -> number
	local i = 0
	return function(): number
		i += 1
		return hash(a * 31 + i, b * 17 - i, salt)
	end
end

-- Houses ---------------------------------------------------------------------------------

-- A flat strip on the ground between two points in a frame (drives, walks, paths), following
-- the ground at each end.
local function path(props: Builder.Props, ground: ((number, number) -> number)?, frame: CFrame, x0: number, z0: number, x1: number, z1: number, width: number, colour: Color3, material: Enum.Material)
	local p0, p1 = frame * Vector3.new(x0, 0, z0), frame * Vector3.new(x1, 0, z1)
	local y0 = if ground then ground(p0.X, p0.Z) else frame.Y
	local y1 = if ground then ground(p1.X, p1.Z) else frame.Y
	Builder.slab(props, Vector3.new(p0.X, y0 + 0.3, p0.Z), Vector3.new(p1.X, y1 + 0.3, p1.Z), width, 1.6, colour, material)
end

-- A house facing -z in its frame, setback studs back from the street edge of its lot.
local function house(props: Builder.Props, frame: CFrame, rnd: () -> number, setback: number, ground: ((number, number) -> number)?)
	local depthAvailable = setback
	local style = rnd()
	local siding = pick(SIDING, rnd())
	local roof = pick(ROOFS, rnd())
	local trim = if rnd() < 0.7 then rgb(240, 240, 236) else pick(SIDING, rnd())
	local w, d = 26 + 14 * rnd(), 20 + 8 * rnd()
	local wall = 11
	local rise = 6 + 4 * rnd()
	if style < 0.3 then -- ranch: long and low
		w += 10
		rise = 5 + 2 * rnd()
	elseif style < 0.5 then -- two storeys
		wall = 21
	elseif style < 0.62 then -- cape: steep roof with a dormer
		rise = 12
	end
	at(props, frame, 0, -3, 0, w, wall + 3, d, siding)
	local top = frame * CFrame.new(0, wall, 0)
	Builder.gable(props, top.X, top.Y, top.Z, w, d, rise, roof, yawOf(frame))
	if style >= 0.5 and style < 0.62 then
		at(props, frame, 0, wall + 2, -d / 2 + 2, 7, 6, 5, siding)
		at(props, frame, 0, wall + 3.5, -d / 2 - 0.55, 4, 3.5, 0.3, GLASS, M.Glass, false)
	end
	if style >= 0.62 and style < 0.78 then -- split-level: a raised wing
		local wx = w / 2 + 9
		at(props, frame, wx, -3, 2, 18, wall + 8, d - 4, siding)
		local wt = frame * CFrame.new(wx, wall + 5, 2)
		Builder.gable(props, wt.X, wt.Y, wt.Z, 18, d - 4, rise - 1, roof, yawOf(frame))
		at(props, frame, wx, 8, -d / 2 + 1.85, 5, 4, 0.3, GLASS, M.Glass, false)
	end
	-- Door (and a porch on bungalows), windows.
	local doorX = (rnd() - 0.5) * w * 0.5
	at(props, frame, doorX, 0, -d / 2 - 0.15, 4, 8, 0.4, pick(DOOR, rnd()), M.Wood, false)
	if style >= 0.78 then
		at(props, frame, 0, -0.5, -d / 2 - 4, w * 0.8, 1, 8, rgb(150, 140, 130), M.WoodPlanks)
		for _, px in { -w * 0.38, w * 0.38 } do
			at(props, frame, px, 0, -d / 2 - 7.5, 0.8, 9, 0.8, trim)
		end
		at(props, frame, 0, 9, -d / 2 - 4, w * 0.84, 0.8, 8.6, roof, M.Slate, false)
	end
	local windows: { number } = if w > 34 then { -0.36, -0.12, 0.2, 0.38 } else { -0.32, 0.3 }
	for _, f in windows do
		local wx = f * w
		if math.abs(wx - doorX) > 4.5 then
			at(props, frame, wx, 4, -d / 2 - 0.1, 5, 4.5, 0.3, GLASS, M.Glass, false)
			at(props, frame, wx, 3.6, -d / 2 - 0.2, 5.8, 0.4, 0.4, trim, M.SmoothPlastic, false)
			if wall > 15 then
				at(props, frame, wx, 14, -d / 2 - 0.1, 5, 4.5, 0.3, GLASS, M.Glass, false)
			end
		end
	end
	if rnd() < 0.35 then
		at(props, frame, w * (rnd() - 0.5) * 0.6, wall + 1, d * 0.2, 2.5, rise + 3, 2.5, pick(BRICK, rnd()), M.Brick)
	end
	-- Garage: attached at one side, or none; a drive to the street.
	local g = rnd()
	if g < 0.75 then
		local side = if rnd() < 0.5 then -1 else 1
		local gx = side * (w / 2 + 7.5)
		at(props, frame, gx, -3, 1, 15, 13, d - 2, siding)
		at(props, frame, gx, 10, 1, 16, 0.8, d - 1, roof, M.Slate, false)
		at(props, frame, gx, 0, -d / 2 + 0.85, 11, 8, 0.3, trim, M.SmoothPlastic, false)
		-- Drive from the garage to the street, a walk from the door to the drive.
		path(props, ground, frame, gx, -d / 2, gx, -d / 2 - depthAvailable - 3, 11, CONCRETE, M.Concrete)
		path(props, ground, frame, doorX, -d / 2 - 1, doorX, -d / 2 - 5, 4, CONCRETE, M.Concrete)
		path(props, ground, frame, doorX, -d / 2 - 5, gx - side * 5.5, -d / 2 - 5, 4, CONCRETE, M.Concrete)
		-- Mailbox at the curb by the drive.
		local mb = frame * CFrame.new(gx + side * 8, 0, -d / 2 - depthAvailable - 1)
		local my = if ground then ground(mb.X, mb.Z) else frame.Y
		Builder.block(props, CFrame.new(mb.X, my + 2, mb.Z) * frame.Rotation, 0.4, 4, 0.4, rgb(90, 80, 70), M.Wood)
		Builder.block(props, CFrame.new(mb.X, my + 4.3, mb.Z) * frame.Rotation, 1, 1, 1.8, pick({ rgb(30, 30, 30), rgb(200, 200, 200), rgb(40, 60, 120) }, rnd()), M.Metal)
	else
		-- No garage: a drive at the side, a walk from the door to the street.
		local dx = (if rnd() < 0.5 then -1 else 1) * (w / 2 + 6)
		path(props, ground, frame, dx, d / 2, dx, -d / 2 - depthAvailable - 3, 9, if rnd() < 0.5 then CONCRETE else rgb(160, 150, 130), M.Concrete)
		path(props, ground, frame, doorX, -d / 2 - 1, doorX, -d / 2 - depthAvailable - 3, 4, CONCRETE, M.Concrete)
	end
	if rnd() < 0.3 then -- patio out back
		path(props, ground, frame, -w * 0.2, d / 2 + 1, -w * 0.2, d / 2 + 11, 14, rgb(186, 180, 170), M.Concrete)
	end
	if rnd() < 0.25 then -- shed out back
		at(props, frame, (rnd() - 0.5) * w, -1, d / 2 + 14, 8, 8, 8, pick(SIDING, rnd()), M.WoodPlanks)
	end
end

-- Commercial -----------------------------------------------------------------------------

local function storefront(props: Builder.Props, frame: CFrame, w: number, d: number, rnd: () -> number)
	local brick = pick(BRICK, rnd())
	local floors = 1 + math.floor(rnd() * 2.6)
	local h = 4 + floors * 10
	at(props, frame, 0, -3, 0, w, h + 3, d, brick, M.Brick)
	at(props, frame, 0, 0.5, -d / 2 - 0.15, w - 3, 9, 0.3, GLASS, M.Glass, false)
	at(props, frame, (rnd() - 0.5) * (w - 8), 0, -d / 2 - 0.25, 4, 8, 0.3, DARK_GLASS, M.Glass, false)
	if rnd() < 0.7 then
		local awning = pick({ rgb(160, 40, 40), rgb(30, 80, 60), rgb(40, 60, 120), rgb(200, 160, 60), rgb(90, 90, 90), rgb(200, 200, 196) }, rnd())
		Builder.block(props, frame * CFrame.new(0, 10.5, -d / 2 - 2.2) * CFrame.Angles(math.rad(-18), 0, 0), w - 2, 0.4, 4.8, awning, M.Fabric, false)
	else
		at(props, frame, 0, 10, -d / 2 - 0.4, w - 4, 2.4, 0.5, pick(BRANDS, rnd())[1], M.SmoothPlastic, false)
	end
	for f = 1, floors - 1 do
		local count = math.max(2, math.floor(w / 9))
		for i = 1, count do
			at(props, frame, -w / 2 + w * (i - 0.5) / count, f * 10 + 3.5, -d / 2 - 0.1, 3.5, 5.5, 0.3, GLASS, M.Glass, false)
		end
	end
	at(props, frame, 0, h, 0, w + 0.6, 1.4 + rnd(), d + 0.6, pick(STONE, rnd()), M.Concrete, false)
end

local function stripMall(props: Builder.Props, frame: CFrame, w: number, rnd: () -> number)
	at(props, frame, 0, -0.7, -10, w, 1, 40, ASPHALT, M.Asphalt)
	for i = 0, math.floor(w / 10) - 1 do
		at(props, frame, -w / 2 + 5 + i * 10, -0.15, -18, 0.4, 0.06, 14, rgb(236, 236, 230), M.SmoothPlastic, false)
	end
	local body = pick({ rgb(214, 200, 176), rgb(196, 190, 180), rgb(176, 160, 140), rgb(160, 150, 150) }, rnd())
	at(props, frame, 0, -2, 24, w, 15 + 4 * rnd(), 30, body)
	at(props, frame, 0, 0.5, 8.85, w - 4, 8, 0.3, GLASS, M.Glass, false)
	at(props, frame, 0, 11, 6, w, 0.8, 6, pick({ rgb(90, 70, 56), rgb(60, 70, 80), rgb(120, 40, 40) }, rnd()), M.WoodPlanks, false)
	local shops = math.max(2, math.floor(w / 22))
	for i = 0, shops - 1 do
		at(props, frame, -w / 2 + w * (i + 0.5) / shops, 12, 8.8, w / shops - 6, 2.6, 0.4, pick(BRANDS, rnd())[1], M.SmoothPlastic, false)
	end
end

local function fastFood(props: Builder.Props, frame: CFrame, rnd: () -> number)
	local brand = pick(BRANDS, rnd())
	at(props, frame, 0, -0.7, 0, 64, 1, 56, ASPHALT, M.Asphalt)
	local w = 26 + 8 * rnd()
	at(props, frame, 0, -2, 8, w, 14, 24, pick({ rgb(214, 196, 166), rgb(190, 60, 40), rgb(230, 230, 220) }, rnd()), M.Brick)
	if rnd() < 0.5 then
		local roofTop = frame * CFrame.new(0, 12, 8)
		Builder.gable(props, roofTop.X, roofTop.Y, roofTop.Z, w, 24, 6, brand[1], yawOf(frame))
	else
		at(props, frame, 0, 12, 8, w + 1, 3, 25, brand[1], M.SmoothPlastic, false)
	end
	at(props, frame, 0, 0.5, -4.15, w - 6, 7, 0.3, GLASS, M.Glass, false)
	at(props, frame, -26, 0, -22, 1, 20, 1, rgb(120, 124, 128), M.Metal)
	at(props, frame, -26, 20, -22, 8, 8, 1.2, brand[1], M.SmoothPlastic, false)
end

local function warehouse(props: Builder.Props, frame: CFrame, w: number, d: number, rnd: () -> number)
	at(props, frame, 0, -0.7, 0, w, 1, d, ASPHALT, M.Asphalt)
	local bw, bd = w - 12, d * 0.65
	at(props, frame, 0, -2, d / 2 - bd / 2 - 4, bw, 20 + 12 * rnd(), bd, pick({ rgb(196, 198, 200), rgb(176, 182, 186), rgb(206, 196, 176), rgb(150, 160, 150) }, rnd()), M.CorrodedMetal)
	local doors = math.max(2, math.floor(bw / 22))
	for i = 1, doors do
		at(props, frame, -bw / 2 + bw * (i - 0.5) / doors, 0, d / 2 - bd - 4.15, 11, 13, 0.3, rgb(90, 96, 104), M.Metal, false)
	end
	at(props, frame, bw / 2 - 8, 0.5, d / 2 - bd - 4.15, 10, 7, 0.3, GLASS, M.Glass, false)
end

-- Mid-rise: brick or stone, ribbon windows or rows of tall windows, a cornice.
local function midrise(props: Builder.Props, frame: CFrame, w: number, d: number, floors: number, rnd: () -> number)
	local brick = rnd() < 0.55
	local wall = if brick then pick(BRICK, rnd()) else pick(STONE, rnd())
	local floor = 11 + 2 * rnd()
	local height = floors * floor + 4
	at(props, frame, 0, -3, 0, w, height + 3, d, wall, if brick then M.Brick else M.Concrete)
	if rnd() < 0.5 then
		for f = 0, floors - 1 do
			at(props, frame, 0, 4 + f * floor + 2, 0, w + 0.25, floor * 0.5, d + 0.25, if f == 0 then DARK_GLASS else GLASS, M.Glass, false)
		end
	else
		-- Rows of tall windows on the two long faces.
		local count = math.max(3, math.floor(w / 9))
		for f = 0, floors - 1 do
			for i = 1, count do
				local x = -w / 2 + w * (i - 0.5) / count
				for _, face in { -1, 1 } do
					at(props, frame, x, 4 + f * floor + 2.5, face * (d / 2 + 0.1), 4, floor * 0.55, 0.3, if f == 0 then DARK_GLASS else GLASS, M.Glass, false)
				end
			end
		end
	end
	at(props, frame, 0, height, 0, w + 1, 1.6 + rnd() * 1.5, d + 1, pick(STONE, rnd()), M.Concrete, false)
	at(props, frame, (rnd() - 0.5) * w * 0.5, 0, -d / 2 - 0.3, 6, 9, 0.3, DARK_GLASS, M.Glass, false)
	at(props, frame, 0, 10, -d / 2 - 3, 12, 0.6, 6, rgb(60, 60, 64), M.Metal, false)
	if rnd() < 0.5 then
		at(props, frame, (rnd() - 0.5) * w * 0.4, height + 1, (rnd() - 0.5) * d * 0.4, 10 + 8 * rnd(), 6, 8 + 6 * rnd(), pick(STONE, rnd()), M.Concrete, false)
	end
end

-- Tower: glass curtain wall with floor bands, a stone frame with tall glass, a stepped tower, or
-- a slab; a lobby with doors and a canopy; a roof with plant, a crown or a mast.
local function tower(props: Builder.Props, frame: CFrame, w: number, d: number, height: number, rnd: () -> number)
	local style = rnd()
	local glass = pick(GLASSES, rnd())
	local trim = pick(STONE, rnd())
	local floor = 12
	local function ribbon(y0: number, tw: number, td: number, h: number, bands: boolean)
		local p = at(props, frame, 0, y0, 0, tw - 1, h, td - 1, glass, M.Glass)
		p.reflectance = 0.2 + 0.15 * rnd()
		if bands then
			local every = if h > 240 then 2 else 1
			for f = 1, math.floor(h / floor) - 1, every do
				at(props, frame, 0, y0 + f * floor - 0.8, 0, tw, 1.4, td, trim, M.Concrete, false)
			end
		end
		at(props, frame, 0, y0 + h, 0, tw + 0.6, 2, td + 0.6, trim, M.Concrete, false)
	end
	local roofW, roofD, roofY = w, d, height
	if style < 0.3 then
		ribbon(12, w, d, height - 12, true)
	elseif style < 0.55 then
		at(props, frame, 0, 12, 0, w, height - 12, d, trim, M.Concrete)
		for _, face in { { 0, -1 }, { 0, 1 }, { 1, 0 }, { -1, 0 } } do
			local fx, fz = face[1], face[2]
			local across = if fx == 0 then w else d
			local bays = math.max(3, math.floor(across / 14))
			for i = 1, bays do
				local o = -across / 2 + across * (i - 0.5) / bays
				local px, pz = if fx == 0 then o else fx * (w / 2 + 0.1), if fx == 0 then fz * (d / 2 + 0.1) else o
				local p = at(props, frame, px, 14, pz, if fx == 0 then across / bays - 3 else 0.4, height - 16, if fx == 0 then 0.4 else across / bays - 3, glass, M.Glass, false)
				p.reflectance = 0.2
			end
		end
		at(props, frame, 0, height, 0, w + 1, 3, d + 1, trim, M.Concrete, false)
	elseif style < 0.8 then
		-- Stepped: two or three tiers, each narrower.
		local tiers = if rnd() < 0.5 then 2 else 3
		local y, tw, td = 12, w, d
		for t = 1, tiers do
			local h = math.max(24, math.floor((height - y) * (if t == tiers then 1 else 0.45 + 0.2 * rnd()) / floor) * floor)
			ribbon(y, tw, td, h, rnd() < 0.7)
			y += h + 2
			roofW, roofD, roofY = tw, td, y - 2
			tw, td = tw * (0.62 + 0.15 * rnd()), td * (0.62 + 0.15 * rnd())
		end
	else
		-- Slab: thin and tall, with a fin of stone up one end.
		ribbon(12, w, d * 0.55, height - 12, true)
		at(props, frame, w / 2 - 3, 0, 0, 6, height + 8, d * 0.55 + 2, trim, M.Concrete)
		roofD = d * 0.55
	end
	-- Lobby.
	at(props, frame, 0, -3, 0, w - 4, 15, math.max(8, roofD - 4), DARK_GLASS, M.Glass)
	for _, dx in { -3, 3 } do
		at(props, frame, dx, 0, -roofD / 2 + 1.7, 5, 9, 0.4, rgb(30, 36, 40), M.Glass, false)
	end
	at(props, frame, 0, 11, -roofD / 2 - 2, 16 + 6 * rnd(), 0.8, 8, trim, M.Concrete, false)
	-- Roof.
	local crown = rnd()
	if crown < 0.4 then
		at(props, frame, roofW * (rnd() - 0.5) * 0.3, roofY + 2, roofD * (rnd() - 0.5) * 0.3, roofW * 0.35, 8, roofD * 0.35, trim, M.Concrete, false)
	elseif crown < 0.65 and roofW > 30 then
		local top = frame * CFrame.new(0, roofY + 2, 0)
		Builder.gable(props, top.X, top.Y, top.Z, roofW - 2, roofD - 2, math.min(roofW, roofD) * 0.4, glass, yawOf(frame), 0)
	end
	if height > 170 and rnd() < 0.6 then
		Builder.rod(props, (frame * CFrame.new(0, roofY + 6, 0)).Position, (frame * CFrame.new(0, roofY + 30 + 30 * rnd(), 0)).Position, 1, rgb(200, 200, 200), M.Metal, false)
	end
end

-- Landmarks ------------------------------------------------------------------------------

local function church(props: Builder.Props, frame: CFrame, rnd: () -> number)
	local white = rnd() < 0.5
	local wall = if white then rgb(238, 236, 228) else pick(BRICK, rnd())
	local length = 40 + 12 * rnd()
	at(props, frame, 0, -3, 6, 26, 21, length, wall, if white then M.SmoothPlastic else M.Brick)
	local top = frame * CFrame.new(0, 18, 6)
	Builder.gable(props, top.X, top.Y, top.Z, length, 26, 13, pick(ROOFS, rnd()), yawOf(frame) + math.pi / 2, 1)
	local front = 6 - length / 2
	at(props, frame, 0, -3, front - 4, 11, 38, 11, wall)
	at(props, frame, 0, 35, front - 4, 8, 8, 8, wall)
	at(props, frame, 0, 43, front - 4, 5, 9, 5, rgb(70, 70, 76), M.Slate)
	at(props, frame, 0, 52, front - 4, 2.4, 10, 2.4, rgb(70, 70, 76), M.Slate)
	at(props, frame, 0, 62, front - 4, 0.6, 6, 0.6, rgb(200, 190, 140), M.Metal, false)
	at(props, frame, 0, 0, front - 9.65, 6, 11, 0.4, pick(DOOR, rnd()), M.Wood, false)
	for i = 1, 3 do
		local z = front + length * i / 4
		for _, side in { -1, 1 } do
			at(props, frame, side * 13.1, 4, z, 0.3, 10, 3.5, rgb(170, 140, 200), M.Glass, false)
		end
	end
end

local function waterTower(props: Builder.Props, x: number, y: number, z: number, rnd: () -> number)
	local colour = pick({ rgb(200, 220, 230), rgb(236, 236, 236), rgb(150, 190, 120), rgb(220, 200, 120) }, rnd())
	local top = y + 56 + 16 * rnd()
	for _, c in { { 1, 1 }, { 1, -1 }, { -1, 1 }, { -1, -1 } } do
		Builder.rod(props, Vector3.new(x + c[1] * 10, y - 1, z + c[2] * 10), Vector3.new(x + c[1] * 5, top, z + c[2] * 5), 1.4, colour, M.Metal)
	end
	Builder.rod(props, Vector3.new(x, y - 1, z), Vector3.new(x, top, z), 3, colour, M.Metal)
	Builder.add(props, "Ball", CFrame.new(x, top + 10, z), Vector3.new(26, 26, 26), colour, M.Metal)
end

local function grainElevator(props: Builder.Props, frame: CFrame, rnd: () -> number)
	local count = 3 + math.floor(rnd() * 4)
	local height = 70 + 40 * rnd()
	local concrete = rgb(214, 210, 200)
	for i = 0, count - 1 do
		local p = (frame * CFrame.new(-count * 8 + 8 + i * 16, 0, 0)).Position
		Builder.column(props, p.X, p.Y - 2, p.Z, height + 2, 16, concrete, M.Concrete)
	end
	at(props, frame, -count * 8 + 2, height - 2, 0, 14, 22, 18, concrete, M.Concrete)
	at(props, frame, 0, height, 0, count * 16, 3, 10, concrete, M.Concrete, false)
	for i = 0, math.floor(rnd() * 3) do
		local p = (frame * CFrame.new(count * 8 + 14 + i * 22, 0, 4)).Position
		Builder.column(props, p.X, p.Y - 2, p.Z, 32, 20, rgb(186, 190, 194), M.Metal)
		Builder.ellipsoid(props, CFrame.new(p.X, p.Y + 30, p.Z), Vector3.new(20, 7, 20), rgb(186, 190, 194), M.Metal)
	end
end

local function park(props: Builder.Props, frame: CFrame, w: number, d: number, ground: (number, number) -> number, rnd: () -> number)
	at(props, frame, 0, -0.7, 0, 4, 1, d, CONCRETE, M.Concrete, false)
	at(props, frame, 0, -0.7, 0, w, 1, 4, CONCRETE, M.Concrete, false)
	for _ = 1, 3 + math.floor(rnd() * 5) do
		local p = (frame * CFrame.new((rnd() - 0.5) * (w - 16), 0, (rnd() - 0.5) * (d - 16))).Position
		if math.abs((frame:PointToObjectSpace(p)).X) > 5 and math.abs((frame:PointToObjectSpace(p)).Z) > 5 then
			Trees.add(props, if rnd() < 0.8 then "yard" else "hardwood", p.X, ground(p.X, p.Z), p.Z, rnd())
		end
	end
	if rnd() < 0.6 then
		for _, c in { { 1, 1 }, { 1, -1 }, { -1, 1 }, { -1, -1 } } do
			at(props, frame, c[1] * 6, 0, c[2] * 6, 0.8, 9, 0.8, rgb(240, 240, 236))
		end
		local top = frame * CFrame.new(0, 9, 0)
		Builder.gable(props, top.X, top.Y, top.Z, 14, 14, 4, pick(ROOFS, rnd()), yawOf(frame), 1)
	end
end

local function parking(props: Builder.Props, frame: CFrame, w: number, d: number, ground: ((number, number) -> number)?)
	if ground then
		frame = CFrame.new(frame.X, ground(frame.X, frame.Z), frame.Z) * frame.Rotation
	end
	at(props, frame, 0, -0.6, 0, w, 0.8, d, ASPHALT, M.Asphalt, false)
	for row = -1, 1, 2 do
		for i = 0, math.floor((w - 8) / 10) - 1 do
			at(props, frame, -w / 2 + 6 + i * 10, -0.2, row * d / 4, 0.4, 0.06, 16, rgb(236, 236, 230), M.SmoothPlastic, false)
		end
	end
end

local function farmstead(props: Builder.Props, ctx: Ctx, x: number, z: number, rnd: () -> number)
	local y = ctx.ground(x, z)
	local yaw = math.floor(rnd() * 4) * math.pi / 2
	local frame = CFrame.new(x, y, z) * CFrame.Angles(0, yaw, 0)
	house(props, frame, rnd, 30, ctx.ground)
	-- Barn: red, white or grey, set off at a random spot.
	local bx, bz = x + 50 + 20 * rnd(), z + (rnd() - 0.4) * 50
	local barn = CFrame.new(bx, ctx.ground(bx, bz), bz) * CFrame.Angles(0, math.floor(rnd() * 2) * math.pi / 2, 0)
	local barnColour = pick({ rgb(150, 44, 36), rgb(150, 44, 36), rgb(220, 220, 214), rgb(120, 120, 124) }, rnd())
	local bw, bd = 26 + 10 * rnd(), 40 + 16 * rnd()
	at(props, barn, 0, -3, 0, bw, 25, bd, barnColour, M.WoodPlanks)
	local top = barn * CFrame.new(0, 22, 0)
	Builder.gable(props, top.X, top.Y, top.Z, bd, bw, 14 + 4 * rnd(), rgb(80, 80, 86), yawOf(barn) + math.pi / 2, 1)
	at(props, barn, 0, 0, -bd / 2 - 0.2, 14, 16, 0.4, rgb(236, 232, 222), M.WoodPlanks, false)
	-- A machine shed, grain bins, maybe a silo.
	if rnd() < 0.6 then
		local sx, sz = x - 10 + 40 * rnd(), z + 50 + 15 * rnd()
		local shed = CFrame.new(sx, ctx.ground(sx, sz), sz) * CFrame.Angles(0, yaw, 0)
		at(props, shed, 0, -2, 0, 50, 20, 30, rgb(190, 194, 198), M.CorrodedMetal)
		at(props, shed, 0, 0, -15.2, 16, 14, 0.3, rgb(100, 106, 112), M.Metal, false)
	end
	local bins = math.floor(rnd() * 4)
	local binX, binZ = x + 70 + 30 * rnd(), z - 30 + 20 * rnd()
	for i = 0, bins - 1 do
		local cx, cz = binX + i * 21, binZ
		local by = ctx.ground(cx, cz)
		local size = 16 + 6 * rnd()
		Builder.column(props, cx, by - 2, cz, 20 + 6 * rnd(), size, rgb(186, 190, 194), M.Metal)
		Builder.ellipsoid(props, CFrame.new(cx, by + 21, cz), Vector3.new(size, 7, size), rgb(186, 190, 194), M.Metal)
	end
	if rnd() < 0.45 then
		local sx, sz = bx + bw / 2 + 8, bz + 10
		local sy = ctx.ground(sx, sz)
		Builder.column(props, sx, sy - 2, sz, 44 + 14 * rnd(), 13, pick({ rgb(200, 196, 186), rgb(60, 80, 120) }, rnd()), M.Concrete)
		Builder.add(props, "Ball", CFrame.new(sx, sy + 48, sz), Vector3.new(13, 13, 13), rgb(150, 156, 162), M.Metal)
	end
	-- Windbreaks of uneven length on the north and west.
	Trees.row(props, ctx.ground, x - 35 - 10 * rnd(), z - 40 - 10 * rnd(), 0, 1, 5 + math.floor(rnd() * 6), 12 + 4 * rnd(), math.floor(rnd() * 1e6))
	Trees.row(props, ctx.ground, x - 25, z - 45 - 10 * rnd(), 1, 0, 6 + math.floor(rnd() * 6), 12 + 4 * rnd(), math.floor(rnd() * 1e6))
end

-- Lots ------------------------------------------------------------------------------------

local function nearest(ctx: Ctx, x: number, z: number): (Settlement?, number)
	local best, distance = nil, math.huge
	for _, s in ctx.settlements do
		local d = math.sqrt((s.x - x) ^ 2 + (s.z - z) ^ 2)
		if d < distance then
			best, distance = s, d
		end
	end
	return best, distance
end

type Rect = { x0: number, z0: number, x1: number, z1: number }

-- Cuts a rectangle into parcels: split the longer side at a random ratio until parcels are
-- small enough (or by chance stop early).
local function parcels(rect: Rect, rnd: () -> number, minSize: number, maxDepth: number): { Rect }
	local out = {}
	local function cut(r: Rect, depth: number)
		local w, d = r.x1 - r.x0, r.z1 - r.z0
		if depth >= maxDepth or math.max(w, d) < 2 * minSize or (depth > 0 and rnd() < 0.2) then
			table.insert(out, r)
			return
		end
		local f = 0.32 + 0.36 * rnd()
		if w >= d then
			local x = r.x0 + w * f
			cut({ x0 = r.x0, z0 = r.z0, x1 = x, z1 = r.z1 }, depth + 1)
			cut({ x0 = x, z0 = r.z0, x1 = r.x1, z1 = r.z1 }, depth + 1)
		else
			local z = r.z0 + d * f
			cut({ x0 = r.x0, z0 = r.z0, x1 = r.x1, z1 = z }, depth + 1)
			cut({ x0 = r.x0, z0 = z, x1 = r.x1, z1 = r.z1 }, depth + 1)
		end
	end
	cut(rect, 0)
	return out
end

-- A frame for a parcel facing the nearer edge of its block (the front is -z).
local function facing(r: Rect, block: Rect, x: number, z: number): number
	local dn, ds = r.z0 - block.z0, block.z1 - r.z1
	local dw, de = r.x0 - block.x0, block.x1 - r.x1
	local m = math.min(dn, ds, dw, de)
	if m == dn then
		return 0
	elseif m == ds then
		return math.pi
	elseif m == dw then
		return -math.pi / 2
	end
	return math.pi / 2
end

-- Places a building of footprint sx x sz at frame if it stands clear of the roads, shrinking
-- it a little if needed; returns the scale used, or nil.
local function dry(ctx: Ctx, frame: CFrame, sx: number, sz: number): boolean
	for _, fx in { -0.5, 0, 0.5 } do
		for _, fz in { -0.5, 0, 0.5 } do
			local p = frame * Vector3.new(fx * sx, 0, fz * sz)
			if ctx.water(p.X, p.Z) then
				return false
			end
		end
	end
	return true
end

-- Whether a footprint keeps clear of everything placed so far: none of its corners, edge
-- midpoints or centre inside another's, nor theirs inside it.
local PROBES = { { -0.5, -0.5 }, { 0.5, -0.5 }, { -0.5, 0.5 }, { 0.5, 0.5 }, { 0, 0 }, { 0, -0.5 }, { 0, 0.5 }, { -0.5, 0 }, { 0.5, 0 } }
local function unoccupied(ctx: Ctx, frame: CFrame, sx: number, sz: number): boolean
	for _, o in ctx.occupied do
		local reach = math.max(o.hx, o.hz) * 1.5 + math.max(sx, sz) * 0.75
		if (o.cf.X - frame.X) ^ 2 + (o.cf.Z - frame.Z) ^ 2 < reach * reach then
			for _, f in PROBES do
				local p = frame * Vector3.new(f[1] * sx, 0, f[2] * sz)
				local a = o.cf:PointToObjectSpace(Vector3.new(p.X, o.cf.Y, p.Z))
				if math.abs(a.X) < o.hx and math.abs(a.Z) < o.hz then
					return false
				end
				local q = o.cf * Vector3.new(f[1] * 2 * o.hx, 0, f[2] * 2 * o.hz)
				local b = frame:PointToObjectSpace(Vector3.new(q.X, frame.Y, q.Z))
				if math.abs(b.X) < sx / 2 and math.abs(b.Z) < sz / 2 then
					return false
				end
			end
		end
	end
	return true
end

local function fits(ctx: Ctx, frame: CFrame, sx: number, sz: number): number?
	for _, scale in { 1, 0.85, 0.7 } do
		if ctx.net:clearBox(frame, sx * scale, sz * scale, 2) and dry(ctx, frame, sx * scale, sz * scale) and unoccupied(ctx, frame, sx * scale, sz * scale) then
			table.insert(ctx.occupied, { cf = frame, hx = sx * scale / 2, hz = sz * scale / 2 })
			return scale
		end
	end
	return nil
end

-- A frame at (x, z) turned by yaw, standing on the lowest ground under a footprint of sx by sz
-- (so on a slope the uphill side sinks into the ground rather than the downhill side floating).
local function seat(ctx: Ctx, x: number, z: number, yaw: number, sx: number, sz: number): CFrame
	local base = CFrame.new(x, 0, z) * CFrame.Angles(0, yaw, 0)
	local y = math.huge
	for _, fx in { -0.5, 0, 0.5 } do
		for _, fz in { -0.5, 0, 0.5 } do
			local p = base * Vector3.new(fx * sx, 0, fz * sz)
			y = math.min(y, ctx.ground(p.X, p.Z))
		end
	end
	return CFrame.new(x, y, z) * CFrame.Angles(0, yaw, 0)
end

-- One parcel in a city or town block.
local function parcel(ctx: Ctx, r: Rect, block: Rect, s: Settlement, distance: number, rnd: () -> number, zone: string)
	local props = ctx.props
	local w, d = r.x1 - r.x0, r.z1 - r.z0
	local cx, cz = (r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2
	if ctx.busy(cx, cz) then
		return
	end
	local yaw = facing(r, block, cx, cz)
	local across, deep = if math.abs(math.sin(yaw)) > 0.5 then d else w, if math.abs(math.sin(yaw)) > 0.5 then w else d
	local frame = seat(ctx, cx, cz, yaw, across * 0.8, deep * 0.8)
	local roll = rnd()
	if zone == "downtown" then
		if roll < 0.08 then
			if fits(ctx, frame, across, deep) then
				park(props, frame, across - 6, deep - 6, ctx.ground, rnd)
			end
			return
		elseif roll < 0.15 then
			if fits(ctx, frame, across, deep) then
				parking(props, frame, across - 4, deep - 4, ctx.ground)
			end
			return
		end
		-- Height: falls off from the centre, lifted or lowered in clusters, with the odd spike.
		local radius = if s.kind == "metro" then 650 else 420
		local peak = if s.kind == "metro" then 420 else 220
		local cluster = 0.5 + 0.5 * math.noise(cx / 260, cz / 260, 3.7)
		local height = 60 + peak * (1 - distance / radius) ^ 0.7 * (0.35 + 0.9 * cluster) * (0.6 + 0.6 * rnd())
		if rnd() < 0.08 then
			height *= 1.5
		end
		height = 12 * math.floor(height / 12)
		local fw, fd = math.min(across - 6, 40 + 50 * rnd()), math.min(deep - 6, 40 + 50 * rnd())
		local scale = fits(ctx, frame, fw, fd)
		if scale then
			tower(props, frame, fw * scale, fd * scale, height, rnd)
		end
	elseif zone == "core" then
		local fw, fd = across - 4 - 8 * rnd(), deep - 4 - 10 * rnd()
		if roll < 0.12 then
			if fits(ctx, frame, across, deep) then
				parking(props, frame, across - 4, deep - 4, ctx.ground)
			end
			return
		end
		-- On a deep parcel the building stands at the back with its parking lot in front.
		local lot = if deep > 100 and rnd() < 0.6 then math.min(60, deep * 0.4) else 0
		local bf = frame * CFrame.new(0, 0, lot / 2)
		local scale = fits(ctx, bf, fw, fd - lot)
		if scale then
			if roll < 0.75 then
				midrise(props, bf, fw * scale, (fd - lot) * scale, 3 + math.floor(7 * rnd() * rnd() + 2 * (1 - distance / s.core)), rnd)
			else
				storefront(props, bf, fw * scale, (fd - lot) * scale, rnd)
			end
			if lot > 0 then
				parking(props, frame * CFrame.new(0, 0, -deep / 2 + lot / 2 + 2), fw, lot - 4, ctx.ground)
			end
		end
	elseif zone == "commercial" then
		-- Shopping, highway strips and travel centres: strip malls, fast food, single stores and
		-- small offices with their parking.
		local scale
		if roll < 0.3 then
			scale = fits(ctx, frame, across - 4, 74)
			if scale then
				stripMall(props, frame, math.min(across - 6, 110) * scale, rnd)
			end
		elseif roll < 0.5 then
			if fits(ctx, frame, 64, 56) then
				fastFood(props, frame, rnd)
			end
		elseif roll < 0.85 then
			-- A store or offices at the back of the lot, parking in front.
			local lot = math.min(70, (deep - 8) * 0.45)
			local bf = frame * CFrame.new(0, 0, lot / 2)
			scale = fits(ctx, bf, across - 8, deep - 8 - lot)
			if scale then
				if roll < 0.7 then
					storefront(props, bf, (across - 8) * scale, (deep - 8 - lot) * scale, rnd)
				else
					midrise(props, bf, (across - 8) * scale, (deep - 8 - lot) * scale, 2 + math.floor(2 * rnd()), rnd)
				end
				parking(props, frame * CFrame.new(0, 0, -deep / 2 + lot / 2 + 3), across - 10, lot - 4, ctx.ground)
			end
		elseif fits(ctx, frame, across - 4, deep - 4) then
			parking(props, frame, across - 4, deep - 4, ctx.ground)
		end
	elseif zone == "industrial" then
		-- Warehouses; in a town the co-op's grain elevator among them.
		if s.kind == "town" and roll < 0.35 then
			if fits(ctx, frame, 130, 30) then
				grainElevator(props, frame, rnd)
			end
		elseif roll < 0.9 then
			local scale = fits(ctx, frame, across - 4, deep - 4)
			if scale then
				warehouse(props, frame, (across - 4) * scale, (deep - 4) * scale, rnd)
			end
		elseif fits(ctx, frame, across - 4, deep - 4) then
			parking(props, frame, across - 4, deep - 4, ctx.ground)
		end
	elseif zone == "park" then
		if fits(ctx, frame, across - 4, deep - 4) then
			park(props, frame, across - 6, deep - 6, ctx.ground, rnd)
		end
	elseif zone == "apartments" then
		-- Apartments at the back of their lot, parking in front; now and then houses.
		if roll < 0.3 then
			local hw, hd = 40, 30
			local set = 10 + 10 * rnd()
			local hf = frame * CFrame.new((rnd() - 0.5) * (across - hw) * 0.5, 0, -deep / 2 + set + hd / 2)
			if fits(ctx, hf, hw + 18, hd) then
				house(props, hf, rnd, set, ctx.ground)
			end
		else
			local lot = math.min(60, (deep - 8) * 0.4)
			local bf = frame * CFrame.new(0, 0, lot / 2)
			local scale = fits(ctx, bf, across - 8, deep - 8 - lot)
			if scale then
				midrise(props, bf, (across - 8) * scale, (deep - 8 - lot) * scale, 2 + math.floor(4 * rnd()), rnd)
				parking(props, frame * CFrame.new(0, 0, -deep / 2 + lot / 2 + 3), across - 10, lot - 4, ctx.ground)
			end
		end
	elseif zone == "main" then
		local fw, fd = across - 1, math.min(deep - 4, 40 + 20 * rnd())
		local sf = frame * CFrame.new(0, 0, -(deep - fd) / 2 + 2)
		if roll < 0.08 then
			return -- a vacant lot
		end
		local scale = fits(ctx, sf, fw, fd)
		if scale then
			storefront(props, sf, fw * scale, fd * scale, rnd)
		end
	end
end

-- The use of the land at a point of a place: its land-use area (js/worldmap/landUse.js), else
-- houses, or apartments in a city's core round downtown. Downtown is towers near the middle of
-- the metro and the mid-size city and older mid-rise blocks further out, main street elsewhere.
local TOWERS = { metro = 650, city = 420 }
local function zoneAt(ctx: Ctx, s: Settlement, x: number, z: number): string
	local distance = math.sqrt((s.x - x) ^ 2 + (s.z - z) ^ 2)
	local big = s.kind == "metro" or s.kind == "city"
	local area = Sites.areaAt(ctx.sites, x, z)
	if area then
		if area.kind == "downtown" then
			return if not big then "main" elseif distance < TOWERS[s.kind] then "downtown" else "core"
		elseif area.kind == "industrial" then
			return "industrial"
		elseif area.kind == "park" then
			return "park"
		end
		return "commercial" -- mall, shopping, corridor, travel
	end
	return if big and distance < s.core * 0.55 then "apartments" else "houses"
end

-- Whether a point is planned for something other than houses (a land-use area or a superblock).
local function otherUse(ctx: Ctx, x: number, z: number): boolean
	return Sites.areaAt(ctx.sites, x, z) ~= nil or Sites.superblock(ctx.sites, x, z, 12)
end

-- Houses in a row along one side of a block: lots of random widths, each house set back a
-- random amount, facing the street. The lot layout comes from its own stream (the same whichever
-- chunk builds it); each house from a stream of its own lot.
local function houseRow(ctx: Ctx, block: Rect, side: string, seedX: number, seedZ: number)
	local props = ctx.props
	local alongX = side == "north" or side == "south"
	local from, to = if alongX then block.x0 else block.z0, if alongX then block.x1 else block.z1
	local yaw = if side == "north" then 0 elseif side == "south" then math.pi elseif side == "west" then -math.pi / 2 else math.pi / 2
	local sideIndex = if side == "north" then 1 elseif side == "south" then 2 elseif side == "west" then 3 else 4
	local layout = stream(seedX, seedZ * 4 + sideIndex, 404)
	local p, i = from, 0
	while p < to - 30 do
		i += 1
		local lot = math.min(to - p, 38 + 22 * layout())
		local empty = layout() < 0.08
		local set = 12 + 14 * layout()
		local mid = p + lot / 2
		p += lot
		local edge = if side == "north" then block.z0 elseif side == "south" then block.z1 elseif side == "west" then block.x0 else block.x1
		local inward = if side == "north" or side == "west" then 1 else -1
		local depthMid = edge + inward * (set + 12)
		local x, z = if alongX then mid else depthMid, if alongX then depthMid else mid
		if not empty and ctx.inside(x, z) and not ctx.busy(x, z) and not otherUse(ctx, x, z) then
			local rnd = stream(seedX * 64 + i, seedZ * 4 + sideIndex, 405)
			local frame = seat(ctx, x, z, yaw, math.min(lot - 4, 50), 28)
			if ctx.net:clearBox(frame, math.min(lot - 4, 56), 26, 2) and dry(ctx, frame, math.min(lot - 4, 56), 30) and unoccupied(ctx, frame, math.min(lot - 4, 56), 30) then
				table.insert(ctx.occupied, { cf = frame, hx = math.min(lot - 4, 56) / 2, hz = 16 })
				house(props, frame, rnd, set, ctx.ground)
				-- A back fence along the rear of the lot, now and then.
				local back = (if alongX then (block.z1 - block.z0) else (block.x1 - block.x0)) / 2 - (set + 12)
				if rnd() < 0.45 and back > 20 then
					local wood = rnd() < 0.7
					local fence = if wood then pick({ rgb(150, 120, 90), rgb(230, 228, 220) }, rnd()) else rgb(110, 110, 112)
					local a, b = frame * Vector3.new(-lot / 2 + 1, 0, back - 1), frame * Vector3.new(lot / 2 - 1, 0, back - 1)
					local ya, yb = ctx.ground(a.X, a.Z), ctx.ground(b.X, b.Z)
					Builder.slab(props, Vector3.new(a.X, ya + 6, a.Z), Vector3.new(b.X, yb + 6, b.Z), 0.5, 7, fence, if wood then M.WoodPlanks else M.DiamondPlate)
				end
				for _ = 1, math.floor(rnd() * 3) do
					local tf = frame * CFrame.new((rnd() - 0.5) * (lot - 8), 0, if rnd() < 0.6 then 24 + 14 * rnd() else -set + 4)
					if ctx.net:clear(tf.X, tf.Z, 4) then
						Trees.add(props, "yard", tf.X, ctx.ground(tf.X, tf.Z), tf.Z, rnd())
					end
				end
			end
		end
	end
end

-- Parcel sizes by use: smallest parcel and most splits.
local SPLITS = { downtown = { 46, 2 }, core = { 40, 3 }, apartments = { 50, 2 }, commercial = { 50, 2 }, industrial = { 70, 2 }, park = { 1e9, 0 } }

-- The helpers Facilities builds with.
local KIT: Facilities.Kit = {
	at = at, seat = seat, fits = fits, stream = stream, pick = pick, parking = parking, park = park,
	warehouse = warehouse, stripMall = stripMall, fastFood = fastFood, midrise = midrise,
	grainElevator = grainElevator, BRICK = BRICK, STONE = STONE, BRANDS = BRANDS,
}

function Buildings.build(ctx: Ctx)
	local props = ctx.props

	-- What the map plans goes down first; the town fabric fills in round it.
	Facilities.build(ctx, KIT)

	-- Town blocks (200-stud grid where the land is town) and suburban blocks (250-stud grid):
	-- each block takes the use of the land at its middle; houses fill the residential ones, with
	-- whatever other use reaches into the block built parcel by parcel.
	local grids: { { step: number, want: string, inset: number, salt: number } } = {
		{ step = RoadNet.URBAN_GRID, want = "urban", inset = 27, salt = 101 },
		{ step = RoadNet.SUBURB_GRID, want = "suburban", inset = 20, salt = 202 },
	}
	for _, grid in grids do
		local GRID, want, inset, salt = grid.step, grid.want, grid.inset, grid.salt
		local suburb = want == "suburban"
		for bx = math.floor(ctx.x0 / GRID) - 1, math.floor((ctx.x1 - 0.001) / GRID) do
			for bz = math.floor(ctx.z0 / GRID) - 1, math.floor((ctx.z1 - 0.001) / GRID) do
				local cx, cz = bx * GRID + GRID / 2, bz * GRID + GRID / 2
				if ctx.coverKey(cx, cz) ~= want or Sites.superblock(ctx.sites, cx, cz) then
					continue
				end
				local s = nearest(ctx, cx, cz)
				if not s then
					continue
				end
				local rnd = stream(bx, bz, salt)
				local block: Rect = { x0 = bx * GRID + inset, z0 = bz * GRID + inset, x1 = (bx + 1) * GRID - inset, z1 = (bz + 1) * GRID - inset }
				local zone = zoneAt(ctx, s, cx, cz)
				local seedX = if suburb then bx + 100000 else bx
				-- Town landmarks on set blocks round the centre: a church and the water tower.
				if not suburb and s.kind ~= "metro" and s.kind ~= "city" and (zone == "houses" or zone == "main") then
					local cbx, cbz = math.floor(s.x / GRID), math.floor(s.z / GRID)
					local ox, oz = bx - cbx, bz - cbz
					local landmark = if ox == -2 and oz == 0 then "church" elseif ox == 1 and oz == -2 then "waterTower" else nil
					if landmark then
						local x, z = cx + (rnd() - 0.5) * 30, cz + (rnd() - 0.5) * 30
						if ctx.inside(x, z) and not ctx.busy(x, z) then
							local frame = CFrame.new(x, ctx.ground(x, z), z) * CFrame.Angles(0, math.floor(rnd() * 4) * math.pi / 2, 0)
							if landmark == "church" and fits(ctx, frame, 40, 70) then
								church(props, frame, rnd)
							elseif landmark == "waterTower" and ctx.net:clear(x, z, 16) then
								waterTower(props, x, ctx.ground(x, z), z, rnd)
								table.insert(ctx.occupied, { cf = CFrame.new(x, 0, z), hx = 14, hz = 14 })
							end
						end
						continue
					end
				end
				if zone == "houses" then
					if suburb and rnd() > 0.975 then
						-- Now and then a church in place of houses.
						local x, z = cx + (rnd() - 0.5) * 40, cz + (rnd() - 0.5) * 40
						if ctx.inside(x, z) and not ctx.busy(x, z) then
							local frame = CFrame.new(x, ctx.ground(x, z), z) * CFrame.Angles(0, math.floor(rnd() * 4) * math.pi / 2, 0)
							if fits(ctx, frame, 40, 70) then
								church(props, frame, rnd)
							end
						end
					else
						for _, side in { "north", "south" } do
							houseRow(ctx, block, side, seedX, bz)
						end
					end
					-- Other uses reaching into the block.
					for _, r in parcels(block, rnd, 45, 3) do
						local mx, mz = (r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2
						local use = zoneAt(ctx, s, mx, mz)
						if ctx.inside(mx, mz) and use ~= "houses" and use ~= "apartments" then
							parcel(ctx, r, block, s, math.sqrt((s.x - mx) ^ 2 + (s.z - mz) ^ 2), rnd, use)
						end
					end
				elseif zone == "main" then
					-- Storefronts along the north and south frontages, cut into narrow lots.
					for sideIndex, side in { "north", "south" } do
						local layout = stream(seedX, bz * 2 + sideIndex, 406)
						local p, i = block.x0, 0
						while p < block.x1 - 14 do
							i += 1
							local lot = math.min(block.x1 - p, 18 + 20 * layout())
							local half = (block.z1 - block.z0) / 2
							local r: Rect = if side == "north" then { x0 = p, z0 = block.z0, x1 = p + lot, z1 = block.z0 + half } else { x0 = p, z0 = block.z1 - half, x1 = p + lot, z1 = block.z1 }
							p += lot
							local mx, mz = (r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2
							if ctx.inside(mx, mz) and zoneAt(ctx, s, mx, mz) == "main" then
								parcel(ctx, r, block, s, 0, stream(seedX * 64 + i, bz * 2 + sideIndex, 407), "main")
							end
						end
					end
				else
					local split = SPLITS[zone] or SPLITS.commercial
					for _, r in parcels(block, rnd, split[1], split[2]) do
						local mx, mz = (r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2
						local use = zoneAt(ctx, s, mx, mz)
						if ctx.inside(mx, mz) and use ~= "houses" and use ~= "main" then
							parcel(ctx, r, block, s, math.sqrt((s.x - mx) ^ 2 + (s.z - mz) ^ 2), rnd, use)
						end
					end
				end
			end
		end
	end

	-- Farmsteads: about one in five quarter sections of farm and ranch land.
	for qx = math.floor(ctx.x0 / 500) - 1, math.floor(ctx.x1 / 500) do
		for qz = math.floor(ctx.z0 / 500) - 1, math.floor(ctx.z1 / 500) do
			if hash(qx, qz, 21) < 0.2 then
				local rnd = stream(qx, qz, 303)
				local fx = qx * 500 + 50 + 120 * rnd()
				local fz = qz * 500 + 60 + 120 * rnd()
				local key = ctx.coverKey(fx, fz)
				if ctx.inside(fx, fz) and (key == "cropland" or key == "irrigated" or key == "grassland" or key == "tallgrass" or key == "redRange") and not ctx.busy(fx, fz) and ctx.net:clear(fx, fz, 90) and unoccupied(ctx, CFrame.new(fx + 50, 0, fz), 220, 140) then
					farmstead(props, ctx, fx, fz, rnd)
					table.insert(ctx.occupied, { cf = CFrame.new(fx + 50, 0, fz), hx = 110, hz = 70 })
				end
			end
		end
	end
end

return Buildings
