--!strict
-- What the map plans on the land (Sites, from js/worldmap/landUse.js, facilities.js and
-- airfields.js), built where the plan puts it instead of rolled block by block:
--   gas stations (two pumps up to twelve, truck stops with diesel lanes and truck parking) and
--   schools (elementary, middle, junior-senior and high, with their parking and playground or
--   track), each on its lot facing its road, nudged back or aside and shrunk a little if a street
--   is in the way;
--   campuses: buildings round a quad, parking lots, a stadium, playing fields;
--   the superblock areas: a regional mall in its parking, a community centre's big boxes, a
--   travel centre (motel, restaurant, truck parking), industrial parks, larger parks;
--   airfields: runways, taxiways and aprons on the levelled field, the terminal, concourses,
--   tower, hangars and other buildings, parking, the fence, the radar on its tower and the NWS
--   office;
--   energy: wind turbines in their strings with substations, farm windmills over stock tanks,
--   oil pumpjacks, gas wellheads and tank batteries.
-- Each is built by the chunk holding its centre (long runways and fences piece by piece).
-- Buildings.build calls this first, with its own helpers (kit), so the town fabric keeps clear.

local Builder = require(script.Parent.Builder)
local Trees = require(script.Parent.Trees)
local Sites = require(script.Parent.Parent.Sites)

local Facilities = {}

local M = Enum.Material
local rgb = Color3.fromRGB

local CONCRETE = rgb(176, 172, 164)
local ASPHALT = rgb(56, 56, 60)
local RUNWAY = rgb(150, 150, 146)
local WHITE = rgb(236, 236, 230)
local YELLOW = rgb(230, 190, 40)
local GLASS = rgb(150, 190, 210)
local DARK_GLASS = rgb(40, 52, 60)
local TURF = rgb(96, 140, 70)
local TRACK = rgb(150, 70, 56)
local BED = 4 -- slab thickness under paved tops (as road slabs)
local PIECE = 480 -- runways, taxiways and fences are laid in pieces no longer than this

export type Kit = {
	at: (Builder.Props, CFrame, number, number, number, number, number, number, Color3, Enum.Material?, boolean?) -> Builder.Prop,
	seat: (any, number, number, number, number, number) -> CFrame,
	fits: (any, CFrame, number, number) -> number?,
	stream: (number, number, number) -> () -> number,
	pick: <T>(list: { T }, r: number) -> T,
	parking: (Builder.Props, CFrame, number, number, ((number, number) -> number)?) -> (),
	park: (Builder.Props, CFrame, number, number, (number, number) -> number, () -> number) -> (),
	warehouse: (Builder.Props, CFrame, number, number, () -> number) -> (),
	stripMall: (Builder.Props, CFrame, number, () -> number) -> (),
	fastFood: (Builder.Props, CFrame, () -> number) -> (),
	midrise: (Builder.Props, CFrame, number, number, number, () -> number) -> (),
	grainElevator: (Builder.Props, CFrame, () -> number) -> (),
	BRICK: { Color3 },
	STONE: { Color3 },
	BRANDS: { { Color3 } },
}

-- The yaw that turns a frame's front (-z) toward (fx, fz).
local function yawToward(fx: number, fz: number): number
	return math.atan2(-fx, -fz)
end

-- A spot for a footprint at (x, z) facing yaw: as planned if it fits, else nudged back (away
-- from the road) or aside; returns the frame and the scale used.
local function settle(ctx: any, kit: Kit, x: number, z: number, yaw: number, sx: number, sz: number): (CFrame?, number?)
	local base = CFrame.new(x, 0, z) * CFrame.Angles(0, yaw, 0)
	for _, back in { 0, 10, 22, 36 } do
		for _, side in { 0, 14, -14, 30, -30 } do
			local p = base * Vector3.new(side, 0, back)
			local frame = kit.seat(ctx, p.X, p.Z, yaw, sx, sz)
			local scale = kit.fits(ctx, frame, sx, sz)
			if scale then
				return frame, scale
			end
		end
	end
	return nil, nil
end

-- A flat slab with its top at y over a rectangle (centre, yaw, size).
local function pad(props: Builder.Props, cx: number, cz: number, yaw: number, sx: number, sz: number, top: number, colour: Color3, material: Enum.Material)
	Builder.block(props, CFrame.new(cx, top - BED / 2, cz) * CFrame.Angles(0, yaw, 0), sx, BED, sz, colour, material)
end

-- Gas stations ------------------------------------------------------------------------------

local ISLANDS = { small = 1, medium = 2, large = 3, xl = 4, ["truck stop"] = 4 }

local function gasStation(kit: Kit, props: Builder.Props, frame: CFrame, islands: number, truck: boolean, rnd: () -> number)
	local at = kit.at
	local brand = kit.pick(kit.BRANDS, rnd())
	local span = islands * 18 + 16
	local width = math.max(70, span + 20)
	at(props, frame, 0, -0.7, 0, width, 1, 62, CONCRETE, M.Concrete)
	for k = 1, islands do
		local px = (k - (islands + 1) / 2) * 18
		for _, pz in { -16, -6 } do
			at(props, frame, px, 0, pz, 1.4, 16, 1.4, rgb(220, 220, 220), M.Metal)
		end
		for _, pz in { -13.5, -8.5 } do
			at(props, frame, px, 0, pz, 2.2, 5, 3, rgb(230, 230, 230))
			at(props, frame, px, 5, pz, 2.4, 0.8, 3.2, brand[1], M.SmoothPlastic, false)
		end
		at(props, frame, px, 0, -11, 3, 0.6, 10, CONCRETE, M.Concrete, false)
	end
	at(props, frame, 0, 16, -11, span, 1.2, 26, rgb(240, 240, 240), M.SmoothPlastic, false)
	at(props, frame, 0, 17.2, -11, span + 0.4, 2, 26.4, brand[1], M.SmoothPlastic, false)
	local shopW = 30 + 6 * islands + 10 * rnd()
	at(props, frame, (rnd() - 0.5) * 10, -2, 18, shopW, 15, 22, kit.pick({ rgb(222, 216, 204), rgb(200, 186, 170), rgb(180, 180, 184) }, rnd()), if rnd() < 0.5 then M.Brick else M.SmoothPlastic)
	at(props, frame, 0, 0.5, 6.85, shopW - 6, 8, 0.3, GLASS, M.Glass, false)
	at(props, frame, -shopW / 4, 0, 6.75, 5, 8, 0.3, DARK_GLASS, M.Glass, false)
	at(props, frame, 0, 13, 6.8, shopW, 2.4, 0.4, brand[1], M.SmoothPlastic, false)
	local signX = width / 2 - 6
	at(props, frame, signX, 0, -25, 1.2, 24, 1.2, rgb(120, 124, 128), M.Metal)
	at(props, frame, signX, 24, -25, 9, 6, 1.2, brand[1], M.SmoothPlastic, false)
	at(props, frame, signX, 19, -25, 8, 4.5, 1, brand[2], M.SmoothPlastic, false)
	if truck then
		-- Diesel lanes under a high canopy to one side, truck parking behind.
		local dx = width / 2 + 40
		at(props, frame, dx, -0.7, 0, 70, 1, 62, CONCRETE, M.Concrete)
		for k = 0, 3 do
			at(props, frame, dx - 24 + 16 * k, 0, -8, 2.4, 5, 10, rgb(230, 230, 230))
		end
		at(props, frame, dx, 22, -8, 70, 1.6, 34, brand[1], M.SmoothPlastic, false)
		for _, c in { { -32, -22 }, { 32, -22 }, { -32, 6 }, { 32, 6 } } do
			at(props, frame, dx + c[1], 0, c[2], 1.6, 22, 1.6, rgb(220, 220, 220), M.Metal)
		end
		kit.parking(props, frame * CFrame.new(width / 4, 0, 72), width + 60, 70)
	end
end

local function buildGas(ctx: any, kit: Kit, lot: Sites.Lot)
	local islands = ISLANDS[lot.kind] or 2
	local truck = lot.kind == "truck stop"
	local sx = math.max(70, islands * 18 + 36) + (if truck then 80 else 0)
	local sz = if truck then 140 else 62
	local yaw = yawToward(lot.fx, lot.fz)
	-- A truck stop's footprint runs to one side and back; its frame centre is the car pumps'.
	local frame = settle(ctx, kit, lot.x, lot.z, yaw, sx, sz)
	if frame then
		gasStation(kit, ctx.props, frame, islands, truck, kit.stream(lot.id, 7, 611))
	end
end

-- Schools -------------------------------------------------------------------------------------

-- School buildings by level: main block width, wings, storeys.
local SCHOOL = {
	elementary = { w = 80, wings = 1, floors = 1 },
	middle = { w = 110, wings = 1, floors = 2 },
	juniorSenior = { w = 120, wings = 2, floors = 2 },
	high = { w = 160, wings = 2, floors = 2 },
}

local function schoolBuilding(kit: Kit, props: Builder.Props, frame: CFrame, level: string, rnd: () -> number)
	local at = kit.at
	local s = SCHOOL[level] or SCHOOL.elementary
	local brick = kit.pick(kit.BRICK, rnd())
	local w = s.w + 20 * rnd()
	local h = 4 + 12 * s.floors
	at(props, frame, 0, -3, 0, w, h + 3, 34, brick, M.Brick)
	for f = 0, s.floors - 1 do
		at(props, frame, 0, f * 12 + 4, 0, w + 0.3, 5, 34.3, GLASS, M.Glass, false)
	end
	for k = 1, s.wings do
		local wx = (if k == 1 then -1 else 1) * (w / 2 - 14)
		at(props, frame, wx, -3, 40, 28, h + 3, 50, brick, M.Brick)
		for f = 0, s.floors - 1 do
			at(props, frame, wx, f * 12 + 4, 40, 28.3, 5, 50.3, GLASS, M.Glass, false)
		end
	end
	if level == "high" or level == "juniorSenior" then
		-- A gym: a taller block behind the middle.
		at(props, frame, 0, -3, 46, 50, h + 13, 44, brick, M.Brick)
	end
	at(props, frame, 10, 0, -17.3, 10, 9, 0.4, DARK_GLASS, M.Glass, false)
	at(props, frame, 10, 11, -21, 18, 0.8, 8, CONCRETE, M.Concrete, false)
	at(props, frame, w / 2 - 6, 0, -28, 0.6, 30, 0.6, rgb(200, 200, 200), M.Metal)
	at(props, frame, w / 2 - 3.5, 25, -28, 5, 3, 0.2, rgb(40, 60, 140), M.Fabric, false)
end

-- A running track round a turf field (or a plain field), centred on frame.
local function field(kit: Kit, props: Builder.Props, frame: CFrame, w: number, d: number, track: boolean)
	local at = kit.at
	if track then
		at(props, frame, 0, -0.55, 0, w, 0.8, d, TRACK, M.Ground, false)
		at(props, frame, 0, -0.5, 0, w - 14, 0.8, d - 14, TURF, M.Grass, false)
	else
		at(props, frame, 0, -0.5, 0, w, 0.8, d, TURF, M.Grass, false)
	end
	for _, side in { -1, 1 } do
		at(props, frame, side * (w / 2 - (if track then 8 else 1)), -0.08, 0, 0.6, 0.1, d - (if track then 16 else 2), WHITE, M.SmoothPlastic, false)
	end
	at(props, frame, 0, -0.08, 0, w - (if track then 16 else 2), 0.1, 0.6, WHITE, M.SmoothPlastic, false)
end

local function buildSchool(ctx: any, kit: Kit, lot: Sites.Lot)
	local props = ctx.props
	local rnd = kit.stream(lot.id, 3, 612)
	local s = SCHOOL[lot.kind] or SCHOOL.elementary
	local yaw = yawToward(lot.fx, lot.fz)
	local sx, sz = s.w + 30, 100
	-- The building towards the front of its lot.
	local base = CFrame.new(lot.x, 0, lot.z) * CFrame.Angles(0, yaw, 0)
	local front = base * Vector3.new(0, 0, -math.max(0, lot.d / 2 - sz / 2 - 6))
	local frame = settle(ctx, kit, front.X, front.Z, yaw, sx, sz)
	if not frame then
		return
	end
	schoolBuilding(kit, props, frame, lot.kind, rnd)
	-- Parking beside it; behind it a track (middle and high schools) or a playground.
	local side = if rnd() < 0.5 then -1 else 1
	local pf = frame * CFrame.new(side * (sx / 2 + 34), 0, -6)
	if kit.fits(ctx, pf, 60, 50) then
		kit.parking(props, pf, 60, 50, ctx.ground)
	end
	local track = lot.kind ~= "elementary"
	local fw, fd = if track then 120 else 70, if track then 80 else 50
	local ff = frame * CFrame.new(0, 0, sz / 2 + fd / 2 + 14)
	local fy = kit.seat(ctx, ff.X, ff.Z, yaw, fw, fd)
	if kit.fits(ctx, fy, fw, fd) then
		if track then
			field(kit, props, fy, fw, fd, true)
		else
			field(kit, props, fy, fw, fd, false)
			for k = 0, 2 do
				kit.at(props, fy, -20 + 20 * k, 0, 0, 6, 8 + 4 * rnd(), 6, kit.pick({ rgb(220, 60, 50), rgb(40, 110, 200), rgb(240, 190, 30) }, rnd()), M.SmoothPlastic)
			end
		end
	end
end

-- Campuses ------------------------------------------------------------------------------------

local function buildCampus(ctx: any, kit: Kit, campus: any)
	local props = ctx.props
	local rnd = kit.stream(campus.id, 5, 613)
	local tall = if campus.tier == "university" then 70 elseif campus.tier == "stateUniversity" then 55 else 36
	for i, b in campus.buildings do
		local cx, cz, yaw, sx, sz = Sites.rect(b)
		local frame = kit.seat(ctx, cx, cz, yaw, sx, sz)
		local scale = kit.fits(ctx, frame, sx, sz)
		if scale then
			local floors = math.max(2, math.floor((tall * (0.5 + 0.5 * rnd())) / 12))
			if rnd() < 0.6 then
				kit.midrise(props, frame, sx * scale, sz * scale, floors, kit.stream(campus.id, i, 614))
			else
				local brick = kit.pick(kit.BRICK, rnd())
				kit.at(props, frame, 0, -3, 0, sx * scale, floors * 12 + 7, sz * scale, brick, M.Brick)
				local top = frame * CFrame.new(0, floors * 12 + 4, 0)
				Builder.gable(props, top.X, top.Y, top.Z, sx * scale, sz * scale, 10, rgb(70, 74, 80), yaw)
				kit.at(props, frame, 0, 6, -sz * scale / 2 - 0.2, sx * scale - 6, 5, 0.3, GLASS, M.Glass, false)
			end
		end
	end
	-- The quad: crossing walks and trees round its edge.
	local qx, qz, qyaw, qw, qd = Sites.rect(campus.quad)
	local qf = CFrame.new(qx, ctx.ground(qx, qz), qz) * CFrame.Angles(0, qyaw, 0)
	kit.at(props, qf, 0, -0.5, 0, qw, 0.8, 6, CONCRETE, M.Concrete, false)
	kit.at(props, qf, 0, -0.5, 0, 6, 0.8, qd, CONCRETE, M.Concrete, false)
	for k = 0, 11 do
		local t = k / 12
		local p = qf * Vector3.new((math.cos(t * 2 * math.pi)) * qw * 0.45, 0, (math.sin(t * 2 * math.pi)) * qd * 0.45)
		Trees.add(props, "hardwood", p.X, ctx.ground(p.X, p.Z), p.Z, rnd())
	end
	for _, lotPoly in campus.parking do
		local cx, cz, yaw, sx, sz = Sites.rect(lotPoly)
		local frame = CFrame.new(cx, 0, cz) * CFrame.Angles(0, yaw, 0)
		if kit.fits(ctx, frame, sx, sz) then
			kit.parking(props, frame, sx, sz, ctx.ground)
		end
	end
	if campus.stadium then
		local cx, cz, yaw, sx, sz = Sites.rect(campus.stadium)
		local frame = kit.seat(ctx, cx, cz, yaw, sx, sz)
		if kit.fits(ctx, frame, sx, sz) then
			-- The field in the middle, stands rising away from it along both long sides.
			local long = sx >= sz
			local fw, fd = if long then sx * 0.6 else sx * 0.45, if long then sz * 0.45 else sz * 0.6
			field(kit, props, frame, fw, fd, true)
			for _, side in { -1, 1 } do
				local offset = if long then Vector3.new(0, 0, side * (fd / 2 + (sz - fd) / 4)) else Vector3.new(side * (fw / 2 + (sx - fw) / 4), 0, 0)
				local p = frame * offset
				local depth = if long then (sz - fd) / 2 else (sx - fw) / 2
				local length = if long then fw else fd
				local stand = CFrame.lookAt(Vector3.new(p.X, frame.Y + 15, p.Z), Vector3.new(frame.X, frame.Y + 15, frame.Z))
				Builder.add(props, "Wedge", stand, Vector3.new(length, 30, depth), rgb(170, 168, 162), M.Concrete)
			end
		end
	end
	for _, f in campus.fields do
		local cx, cz, yaw, sx, sz = Sites.rect(f)
		local frame = kit.seat(ctx, cx, cz, yaw, sx, sz)
		if kit.fits(ctx, frame, sx, sz) then
			field(kit, props, frame, sx, sz, false)
		end
	end
end

-- Superblock areas ----------------------------------------------------------------------------

-- The side of an area's rectangle facing the nearest mile line (its arterial): a frame at the
-- centre whose front (-z) faces it, and the size across and deep.
local function areaFrame(area: Sites.Area): (CFrame, number, number)
	local cx, cz, yaw, sx, sz = Sites.rect(area.poly)
	local best, bestD = 0, math.huge
	for k = 0, 3 do
		local a = yaw + k * math.pi / 2
		local fx, fz = -math.sin(a), -math.cos(a)
		local reach = if k % 2 == 0 then sz / 2 else sx / 2
		local ex, ez = cx + fx * reach, cz + fz * reach
		local d = math.min(math.abs(ex - math.round(ex / 1000) * 1000), math.abs(ez - math.round(ez / 1000) * 1000))
		if d < bestD then
			best, bestD = k, d
		end
	end
	local a = yaw + best * math.pi / 2
	local across, deep = if best % 2 == 0 then sx else sz, if best % 2 == 0 then sz else sx
	return CFrame.new(cx, 0, cz) * CFrame.Angles(0, a, 0), across, deep
end

local function buildArea(ctx: any, kit: Kit, area: Sites.Area)
	local props = ctx.props
	local rnd = kit.stream(area.id, 11, 615)
	local base, across, deep = areaFrame(area)
	local function placeAt(x: number, z: number, sx: number, sz: number): (CFrame?, number?)
		local p = base * Vector3.new(x, 0, z)
		local frame = kit.seat(ctx, p.X, p.Z, select(2, base:ToEulerAnglesYXZ()), sx, sz)
		return frame, kit.fits(ctx, frame, sx, sz)
	end
	local ground = ctx.ground
	if area.kind == "mall" then
		-- The mall in the middle with an anchor store at each end, parking all round.
		local lot = CFrame.new(base.X, ground(base.X, base.Z), base.Z) * base.Rotation
		kit.parking(props, lot, across - 10, deep - 10)
		local w, d = across * 0.55, deep * 0.4
		local frame, scale = placeAt(0, deep * 0.08, w, d)
		if frame and scale then
			local wall = kit.pick({ rgb(214, 200, 176), rgb(196, 190, 180), rgb(200, 184, 160) }, rnd())
			kit.at(props, frame, 0, -3, 0, w * scale, 31, d * scale, wall, M.Concrete)
			for _, side in { -1, 1 } do
				kit.at(props, frame, side * (w * scale / 2 - 25), -3, 0, 50, 41, d * scale + 8, kit.pick({ rgb(160, 150, 150), rgb(120, 110, 104), rgb(190, 180, 170) }, rnd()), M.Concrete)
				kit.at(props, frame, side * (w * scale / 2 - 25), 26, -d * scale / 2 - 4.3, 30, 4, 0.4, kit.pick(kit.BRANDS, rnd())[1], M.SmoothPlastic, false)
			end
			kit.at(props, frame, 0, 0, -d * scale / 2 - 0.2, 24, 14, 0.4, DARK_GLASS, M.Glass, false)
			kit.at(props, frame, 0, 28, 0, 30, 8, 30, GLASS, M.Glass, false)
		end
	elseif area.kind == "shopping" or area.kind == "travel" then
		-- Big boxes (or a travel centre's motel and restaurant) across the back, parking in front.
		local count = if area.kind == "travel" then 2 else math.clamp(math.floor(across / 90), 2, 4)
		local bd = math.min(80, deep * 0.45)
		kit.parking(props, CFrame.new(base.X, ground(base.X, base.Z), base.Z) * base.Rotation * CFrame.new(0, 0, -deep / 2 + (deep - bd) / 2), across - 10, deep - bd - 14)
		for k = 1, count do
			local w = across / count - 10
			local x = -across / 2 + across * (k - 0.5) / count
			local frame, scale = placeAt(x, deep / 2 - bd / 2 - 4, w, bd)
			if frame and scale then
				if area.kind == "travel" and k == 1 then
					kit.midrise(props, frame, w * scale, math.min(bd, 40) * scale, 2, kit.stream(area.id, k, 616))
				elseif area.kind == "travel" then
					kit.fastFood(props, frame, kit.stream(area.id, k, 616))
				else
					kit.warehouse(props, frame, w * scale, bd * scale, kit.stream(area.id, k, 616))
					kit.at(props, frame, 0, 24, -bd * scale * 0.15 - 0.6, math.min(40, w * 0.5), 5, 0.4, kit.pick(kit.BRANDS, rnd())[1], M.SmoothPlastic, false)
				end
			end
		end
	elseif area.kind == "industrial" then
		-- Warehouses in rows on a grid of about 150 by 120 studs.
		local nx, nz = math.max(1, math.floor(across / 150)), math.max(1, math.floor(deep / 120))
		for i = 1, nx do
			for j = 1, nz do
				local w, d = across / nx - 20, deep / nz - 20
				local frame, scale = placeAt(-across / 2 + across * (i - 0.5) / nx, -deep / 2 + deep * (j - 0.5) / nz, w, d)
				if frame and scale then
					kit.warehouse(props, frame, w * scale, d * scale, kit.stream(area.id * 64 + i, j, 617))
				end
			end
		end
	elseif area.kind == "park" then
		-- A ball field, a shelter and paths, trees scattered by the area's size.
		local frame = CFrame.new(base.X, ground(base.X, base.Z), base.Z) * base.Rotation
		kit.park(props, frame, across, deep, ground, rnd)
		local ff, fs = placeAt(across * 0.2, 0, math.min(110, across * 0.4), math.min(90, deep * 0.6))
		if ff and fs then
			field(kit, props, ff, math.min(110, across * 0.4) * fs, math.min(90, deep * 0.6) * fs, false)
		end
		for _ = 1, math.floor(across * deep / 2500) do
			local p = frame * Vector3.new((rnd() - 0.5) * (across - 20), 0, (rnd() - 0.5) * (deep - 20))
			if ctx.net:clear(p.X, p.Z, 4) and not ctx.busy(p.X, p.Z) then
				Trees.add(props, if rnd() < 0.7 then "hardwood" else "yard", p.X, ground(p.X, p.Z), p.Z, rnd())
			end
		end
	end
end

-- Airfields -----------------------------------------------------------------------------------

local BUILDING_HEIGHT = { terminal = 44, concourse = 30, hangar = 46, ["base operations"] = 30, dormitory = 34, office = 30, igloo = 16, ["visitor center"] = 22, ["fuel farm"] = 0 }

-- A slab along a line in pieces no longer than PIECE, each laid by the chunk holding its middle.
local function pieces(ax: number, az: number, bx: number, bz: number, each: (number, number, number, number) -> ())
	local length = math.sqrt((bx - ax) ^ 2 + (bz - az) ^ 2)
	local n = math.max(1, math.ceil(length / PIECE))
	for k = 0, n - 1 do
		local t0, t1 = k / n, (k + 1) / n
		each(ax + (bx - ax) * t0, az + (bz - az) * t0, ax + (bx - ax) * t1, az + (bz - az) * t1)
	end
end

local function buildAirfield(ctx: any, kit: Kit, f: any)
	local props = ctx.props
	local top = ctx.pavedTop(f.levelM)
	local rnd = kit.stream(f.id, 13, 618)
	local function owns(x: number, z: number): boolean
		return ctx.inside(x, z)
	end
	-- Runways: concrete with a dashed centre line and threshold bars.
	for _, r in f.runways do
		local ux, uz = r.b.X - r.a.X, r.b.Y - r.a.Y
		local length = math.sqrt(ux * ux + uz * uz)
		ux, uz = ux / length, uz / length
		pieces(r.a.X, r.a.Y, r.b.X, r.b.Y, function(ax, az, bx, bz)
			if owns((ax + bx) / 2, (az + bz) / 2) then
				Builder.slab(props, Vector3.new(ax, top + 0.01, az), Vector3.new(bx, top + 0.01, bz), 2 * r.half, BED, RUNWAY, M.Concrete)
				local l = math.sqrt((bx - ax) ^ 2 + (bz - az) ^ 2)
				for s = 20, l - 20, 60 do
					local x, z = ax + ux * s, az + uz * s
					Builder.slab(props, Vector3.new(x, top + 0.06, z), Vector3.new(x + ux * 30, top + 0.06, z + uz * 30), 1.5, 0.1, WHITE, M.SmoothPlastic)
				end
			end
		end)
		for _, e in { { r.a, 1 }, { r.b, -1 } } do
			local p, dir = e[1] :: Vector2, e[2] :: number
			if owns(p.X, p.Y) then
				for k = -3, 3 do
					local x, z = p.X + ux * dir * 12 + uz * k * r.half / 4, p.Y + uz * dir * 12 - ux * k * r.half / 4
					Builder.slab(props, Vector3.new(x, top + 0.06, z), Vector3.new(x + ux * dir * 30, top + 0.06, z + uz * dir * 30), 3, 0.1, WHITE, M.SmoothPlastic)
				end
			end
		end
	end
	for _, line in f.taxiways do
		for i = 2, #line do
			pieces(line[i - 1].X, line[i - 1].Y, line[i].X, line[i].Y, function(ax, az, bx, bz)
				if owns((ax + bx) / 2, (az + bz) / 2) then
					Builder.slab(props, Vector3.new(ax, top, az), Vector3.new(bx, top, bz), 36, BED, ASPHALT, M.Asphalt)
					Builder.slab(props, Vector3.new(ax, top + 0.05, az), Vector3.new(bx, top + 0.05, bz), 1, 0.1, YELLOW, M.SmoothPlastic)
				end
			end)
			if owns(line[i].X, line[i].Y) then
				Builder.add(props, "Cylinder", CFrame.new(line[i].X, top - BED / 2, line[i].Y) * CFrame.Angles(0, 0, math.pi / 2), Vector3.new(BED, 36, 36), ASPHALT, M.Asphalt)
			end
		end
	end
	for _, a in f.aprons do
		local cx, cz, yaw, sx, sz = Sites.rect(a)
		if owns(cx, cz) then
			pad(props, cx, cz, yaw, sx, sz, top - 0.01, CONCRETE, M.Concrete)
		end
	end
	for _, q in f.parking do
		local cx, cz, yaw, sx, sz = Sites.rect(q)
		if owns(cx, cz) then
			kit.parking(props, CFrame.new(cx, top, cz) * CFrame.Angles(0, yaw, 0), sx, sz)
		end
	end
	for _, b in f.buildings do
		local cx, cz, yaw, sx, sz = Sites.rect(b.poly)
		if owns(cx, cz) then
			local frame = CFrame.new(cx, top, cz) * CFrame.Angles(0, yaw, 0)
			local h = BUILDING_HEIGHT[b.kind] or 26
			if b.kind == "tower" then
				-- A control tower: a shaft and a glass cab.
				local high = 110 + 30 * rnd()
				Builder.column(props, cx, top - 2, cz, high, math.max(14, math.min(sx, sz)), rgb(214, 210, 200), M.Concrete)
				kit.at(props, frame, 0, high, 0, 30, 14, 30, GLASS, M.Glass)
				kit.at(props, frame, 0, high + 14, 0, 34, 2, 34, rgb(60, 60, 64), M.Metal)
			elseif b.kind == "fuel farm" then
				for k = 0, 3 do
					local p = frame * Vector3.new(-sx / 2 + sx * (k + 0.5) / 4, 0, 0)
					Builder.column(props, p.X, top - 1, p.Z, 26, math.min(sx / 4.5, sz * 0.8), rgb(230, 230, 226), M.Metal)
				end
			elseif b.kind == "igloo" then
				-- An earth-covered magazine: half a cylinder lying along its length.
				Builder.add(props, "Cylinder", frame * CFrame.new(0, -2, 0) * CFrame.Angles(0, math.pi / 2, 0), Vector3.new(sz, math.min(sx, 30), math.min(sx, 30)), rgb(110, 130, 80), M.Grass)
				kit.at(props, frame, 0, 0, -sz / 2 - 0.2, sx * 0.5, 9, 0.4, rgb(120, 124, 120), M.Metal, false)
			elseif b.kind == "hangar" then
				kit.at(props, frame, 0, -3, 0, sx, h * 0.6 + 3, sz, rgb(200, 204, 208), M.CorrodedMetal)
				local roof = frame * CFrame.new(0, h * 0.6, 0)
				Builder.gable(props, roof.X, roof.Y, roof.Z, sx, sz, h * 0.4, rgb(186, 190, 196), yaw, 1)
				kit.at(props, frame, 0, 0, -sz / 2 - 0.2, sx * 0.8, h * 0.55, 0.4, rgb(120, 126, 132), M.Metal, false)
			else
				local glassy = b.kind == "terminal" or b.kind == "concourse" or b.kind == "visitor center"
				kit.at(props, frame, 0, -3, 0, sx, h + 3, sz, if glassy then rgb(200, 200, 196) else kit.pick(kit.STONE, rnd()), M.Concrete)
				kit.at(props, frame, 0, h * 0.25, 0, sx + 0.3, h * 0.45, sz + 0.3, if glassy then GLASS else DARK_GLASS, M.Glass, false)
				kit.at(props, frame, 0, h, 0, sx + 1, 2, sz + 1, rgb(90, 92, 96), M.Metal, false)
			end
		end
	end
	-- The fence: chain link on posts, piece by piece round it.
	local fence = f.fence
	for i = 1, #fence do
		local a, b = fence[i], fence[i % #fence + 1]
		pieces(a.X, a.Y, b.X, b.Y, function(ax, az, bx, bz)
			if owns((ax + bx) / 2, (az + bz) / 2) then
				local y = top - 0.5
				local link = Builder.slab(props, Vector3.new(ax, y + 9, az), Vector3.new(bx, y + 9, bz), 0.2, 8, rgb(150, 154, 158), M.DiamondPlate)
				if link then
					link.transparency = 0.55
					link.collide = true
				end
				local l = math.sqrt((bx - ax) ^ 2 + (bz - az) ^ 2)
				for s = 0, l, 60 do
					local t = s / math.max(l, 1)
					Builder.column(props, ax + (bx - ax) * t, y - 1, az + (bz - az) * t, 10, 0.6, rgb(130, 134, 138), M.Metal)
				end
			end
		end)
	end
	-- The radar: a white dome on a lattice tower in its fenced compound.
	if f.radar and owns(f.radar.x, f.radar.z) then
		local x, z = f.radar.x, f.radar.z
		local y = ctx.ground(x, z)
		for _, c in { { 1, 1 }, { 1, -1 }, { -1, 1 }, { -1, -1 } } do
			Builder.rod(props, Vector3.new(x + c[1] * 9, y - 1, z + c[2] * 9), Vector3.new(x + c[1] * 5, y + 64, z + c[2] * 5), 1.4, rgb(210, 210, 206), M.Metal)
		end
		kit.at(props, CFrame.new(x, y, z), 0, 64, 0, 16, 2, 16, rgb(200, 200, 196), M.Metal)
		Builder.add(props, "Ball", CFrame.new(x, y + 84, z), Vector3.new(40, 40, 40), rgb(246, 246, 244), M.SmoothPlastic)
		kit.at(props, CFrame.new(x + 20, y, z), 0, -1, 0, 12, 10, 10, rgb(220, 220, 214), M.Concrete)
	end
	-- The weather office.
	if f.nws then
		local cx, cz, yaw, sx, sz = Sites.rect(f.nws.building)
		if owns(cx, cz) then
			local frame = kit.seat(ctx, cx, cz, yaw, sx, sz)
			kit.at(props, frame, 0, -3, 0, sx, 21, sz, rgb(200, 196, 186), M.Concrete)
			kit.at(props, frame, 0, 5, 0, sx + 0.3, 7, sz + 0.3, GLASS, M.Glass, false)
			kit.at(props, frame, sx / 2 - 6, 18, 0, 1, 18, 1, rgb(200, 200, 200), M.Metal)
		end
		local px, pz, pyaw, psx, psz = Sites.rect(f.nws.parking)
		if owns(px, pz) then
			kit.parking(props, CFrame.new(px, 0, pz) * CFrame.Angles(0, pyaw, 0), psx, psz, ctx.ground)
		end
	end
end

-- Energy --------------------------------------------------------------------------------------

-- A wind turbine: a tapering tower, the nacelle and three blades, the rotor facing south (the
-- prevailing wind).
local function turbine(props: Builder.Props, x: number, y: number, z: number, r: number)
	local white = rgb(240, 240, 238)
	local hub = 180
	Builder.column(props, x, y - 2, z, hub * 0.5 + 2, 11, white, M.SmoothPlastic)
	Builder.column(props, x, y + hub * 0.5, z, hub * 0.5, 8, white, M.SmoothPlastic)
	Builder.block(props, CFrame.new(x, y + hub + 4, z + 2), 9, 9, 24, white, M.SmoothPlastic)
	local centre = Vector3.new(x, y + hub + 4, z + 15)
	Builder.add(props, "Ball", CFrame.new(centre), Vector3.new(8, 8, 8), white, M.SmoothPlastic)
	for k = 0, 2 do
		local angle = r * 2 * math.pi / 3 + k * 2 * math.pi / 3
		Builder.block(props, CFrame.new(centre) * CFrame.Angles(0, 0, angle) * CFrame.new(0, 52, 0), 5, 100, 1.2, white, M.SmoothPlastic, false)
	end
end

-- A farm windmill (a water pump) on its lattice tower, over a round stock tank.
local function windmill(props: Builder.Props, x: number, y: number, z: number)
	local steel = rgb(150, 150, 146)
	for _, c in { { 1, 1 }, { 1, -1 }, { -1, 1 }, { -1, -1 } } do
		Builder.rod(props, Vector3.new(x + c[1] * 4, y - 1, z + c[2] * 4), Vector3.new(x + c[1] * 0.8, y + 30, z + c[2] * 0.8), 0.5, steel, M.Metal)
	end
	Builder.add(props, "Cylinder", CFrame.new(x, y + 32, z + 1.5) * CFrame.Angles(0, math.pi / 2, 0), Vector3.new(0.6, 11, 11), rgb(170, 170, 166), M.Metal)
	Builder.block(props, CFrame.new(x, y + 32, z - 4), 0.3, 3, 7, rgb(180, 60, 40), M.Metal)
	Builder.column(props, x + 10, y - 1, z, 3.5, 14, rgb(130, 134, 136), M.Metal)
	Builder.column(props, x + 10, y + 2.3, z, 0.3, 13, rgb(70, 100, 110), M.Glass)
end

-- An oil pumpjack (beam, horse head, counterweight) or a gas wellhead, on a small pad.
local function well(props: Builder.Props, x: number, y: number, z: number, gas: boolean, r: number)
	Builder.box(props, x, y - 0.7, z, 30, 1, 22, rgb(170, 160, 140), M.Pebble)
	if gas then
		Builder.column(props, x, y - 1, z, 7, 1.6, rgb(200, 200, 196), M.Metal)
		Builder.rod(props, Vector3.new(x - 3, y + 4, z), Vector3.new(x + 3, y + 4, z), 1, rgb(200, 200, 196), M.Metal)
		Builder.box(props, x + 8, y, z + 4, 5, 6, 3, rgb(200, 200, 196), M.Metal)
		return
	end
	local yaw = r * 2 * math.pi
	local base = CFrame.new(x, y, z) * CFrame.Angles(0, yaw, 0)
	local dark = rgb(60, 62, 66)
	Builder.block(props, base * CFrame.new(0, 1, 0), 3, 2, 22, dark, M.Metal)
	for _, side in { -1, 1 } do
		local foot = base * Vector3.new(side * 2.5, 0, 2)
		Builder.rod(props, foot, (base * CFrame.new(0, 13, 0)).Position, 0.8, dark, M.Metal)
	end
	local tilt = (r - 0.5) * 0.35
	local beam = base * CFrame.new(0, 13.5, 0) * CFrame.Angles(tilt, 0, 0)
	Builder.block(props, beam, 1.6, 1.6, 22, dark, M.Metal)
	Builder.add(props, "Wedge", beam * CFrame.new(0, -1.5, -11.5), Vector3.new(2, 5, 3), dark, M.Metal)
	Builder.block(props, base * CFrame.new(0, 4, 8), 3, 4, 4, rgb(180, 60, 40), M.Metal)
	Builder.rod(props, (beam * CFrame.new(0, -1, -12)).Position, (base * CFrame.new(0, 0, -12)).Position, 0.3, rgb(30, 30, 30), M.Metal)
end

-- A tank battery: three tanks on a gravel pad inside a low berm.
local function tanks(props: Builder.Props, x: number, y: number, z: number)
	Builder.box(props, x, y - 0.7, z, 46, 1, 24, rgb(170, 160, 140), M.Pebble)
	for k = -1, 1 do
		Builder.column(props, x + k * 14, y - 1, z, 21, 11, rgb(206, 200, 184), M.Metal)
	end
	Builder.box(props, x, y - 1, z - 13, 48, 3, 2, rgb(150, 130, 100), M.Ground)
	Builder.box(props, x, y - 1, z + 13, 48, 3, 2, rgb(150, 130, 100), M.Ground)
end

local function substation(kit: Kit, ctx: any, p: Sites.Poly)
	local cx, cz, yaw, sx, sz = Sites.rect(p)
	if not ctx.inside(cx, cz) then
		return
	end
	local frame = kit.seat(ctx, cx, cz, yaw, sx, sz)
	kit.at(ctx.props, frame, 0, -0.7, 0, sx, 1, sz, rgb(170, 166, 160), M.Pebble)
	for i = -1, 1 do
		kit.at(ctx.props, frame, i * sx / 4, 0, 0, 8, 10, 8, rgb(130, 140, 130), M.Metal)
		kit.at(ctx.props, frame, i * sx / 4, 0, sz / 4, 1, 24, 1, rgb(160, 160, 160), M.Metal)
	end
	for _, side in { -1, 1 } do
		kit.at(ctx.props, frame, 0, 0, side * sz / 2, sx, 8, 0.2, rgb(150, 154, 158), M.DiamondPlate)
	end
end

-- Everything planned in the chunk.
function Facilities.build(ctx: any, kit: Kit)
	local set: Sites.Set = ctx.sites
	local props = ctx.props
	for _, f in set.airfields do
		buildAirfield(ctx, kit, f)
	end
	for _, c in set.campuses do
		local cx, cz = Sites.rect(c.area)
		if ctx.inside(cx, cz) then
			buildCampus(ctx, kit, c)
		end
	end
	for _, area in set.areas do
		local b = area.box
		local cx, cz = (b[1] + b[3]) / 2, (b[2] + b[4]) / 2
		if area.block and ctx.inside(cx, cz) then
			buildArea(ctx, kit, area)
		end
	end
	for _, lot in set.schools do
		if ctx.inside(lot.x, lot.z) then
			buildSchool(ctx, kit, lot)
		end
	end
	for _, lot in set.gas do
		if ctx.inside(lot.x, lot.z) then
			buildGas(ctx, kit, lot)
		end
	end
	local function free(x: number, z: number, margin: number): boolean
		return ctx.inside(x, z) and not ctx.busy(x, z) and ctx.net:clear(x, z, margin)
	end
	for _, t in set.turbines do
		if free(t.X, t.Y, 12) then
			turbine(props, t.X, ctx.ground(t.X, t.Y), t.Y, Builder.hash(t.X, t.Y, 41))
			table.insert(ctx.occupied, { cf = CFrame.new(t.X, 0, t.Y), hx = 10, hz = 20 })
		end
	end
	for _, p in set.substations do
		substation(kit, ctx, p)
	end
	for _, w in set.windmills do
		if free(w.X, w.Y, 8) then
			windmill(props, w.X, ctx.ground(w.X, w.Y), w.Y)
			table.insert(ctx.occupied, { cf = CFrame.new(w.X + 5, 0, w.Y), hx = 14, hz = 10 })
		end
	end
	for _, w in set.wells do
		if free(w.x, w.z, 14) then
			well(props, w.x, ctx.ground(w.x, w.z), w.z, w.gas, Builder.hash(w.x, w.z, 43))
			table.insert(ctx.occupied, { cf = CFrame.new(w.x, 0, w.z), hx = 16, hz = 16 })
		end
	end
	for _, t in set.tanks do
		if free(t.X, t.Y, 22) then
			tanks(props, t.X, ctx.ground(t.X, t.Y), t.Y)
			table.insert(ctx.occupied, { cf = CFrame.new(t.X, 0, t.Y), hx = 26, hz = 16 })
		end
	end
end

return Facilities
