--!strict
-- Seeing and feeling the wind field in the lab.
--
--   J  arrows: a ring of arrows 10 m up (length = how far the air goes in 0.6 s, colour = EF
--      rating of the local wind) and a vertical slice through the core, square to the camera,
--      showing the inflow along the ground turning up into the funnel (and the downdraught on
--      the axis of a two-celled vortex)
--   G  test objects scattered round the tornado: cars, a pickup, a mobile home, bins, plywood,
--      boards, shingles, fence panels and stand-in people. WindPhysics slides, lifts and throws
--      them (each with its own threshold); G again clears them.
--
-- Everything is drawn with anchored parts moved by CFrame: the physics is WindPhysics' own (the
-- way the server would run it), not Roblox's.
local Workspace = game:GetService("Workspace")

local Tornado = game:GetService("ReplicatedStorage"):WaitForChild("Shared"):WaitForChild("Tornado")
local Config = require(Tornado:WaitForChild("Config"))
local Vortex = require(Tornado:WaitForChild("Vortex"))
local WindField = require(Tornado:WaitForChild("WindField"))
local WindPhysics = require(Tornado:WaitForChild("WindPhysics"))

local WindLab = {}
WindLab.__index = WindLab

-- EF colours (NWS-ish): below EF0 grey, EF0 green ... EF5 magenta
local EF_COLOURS = {
	Color3.fromRGB(150, 150, 150),
	Color3.fromRGB(80, 200, 80),
	Color3.fromRGB(240, 220, 60),
	Color3.fromRGB(250, 150, 40),
	Color3.fromRGB(230, 50, 40),
	Color3.fromRGB(200, 40, 160),
	Color3.fromRGB(150, 60, 230),
}

local function efColour(speed: number): Color3
	local ef = Vortex.efFor(speed)
	if ef < 0 then
		return EF_COLOURS[1]
	end
	return EF_COLOURS[math.clamp(math.floor(ef) + 2, 2, #EF_COLOURS)]
end

-- What each test object looks like: size (studs = m), colour, how many, attached?
local KINDS = {
	{ class = "car", size = Vector3.new(4.6, 1.5, 1.8), colour = Color3.fromRGB(170, 40, 40), count = 4, attached = false },
	{ class = "pickup", size = Vector3.new(5.5, 1.9, 2.0), colour = Color3.fromRGB(40, 70, 140), count = 2, attached = false },
	{ class = "mobileHome", size = Vector3.new(20, 4, 4.3), colour = Color3.fromRGB(225, 222, 210), count = 1, attached = false },
	{ class = "trashCan", size = Vector3.new(0.7, 1.1, 0.7), colour = Color3.fromRGB(40, 90, 50), count = 6, attached = false },
	{ class = "plywood", size = Vector3.new(2.44, 0.1, 1.22), colour = Color3.fromRGB(200, 165, 110), count = 8, attached = true },
	{ class = "board", size = Vector3.new(2.4, 0.09, 0.04), colour = Color3.fromRGB(215, 185, 135), count = 12, attached = false },
	{ class = "shingle", size = Vector3.new(0.9, 0.02, 0.3), colour = Color3.fromRGB(70, 60, 55), count = 16, attached = true },
	{ class = "fence", size = Vector3.new(2.44, 1.83, 0.05), colour = Color3.fromRGB(180, 150, 105), count = 6, attached = true },
	{ class = "player", size = Vector3.new(0.5, 1.8, 0.3), colour = Color3.fromRGB(240, 200, 60), count = 6, attached = false },
}

type Item = {
	part: BasePart,
	body: WindPhysics.Body,
	pos: Vector3, -- centre, metres
	vel: Vector3,
	rot: CFrame, -- orientation only
	spinAxis: Vector3,
	half: number, -- half height (resting on the ground)
	gust: number, -- 3-s mean wind speed felt
	state: string, -- "resting" | "sliding" | "flying"
}

export type WindLab = typeof(setmetatable(
	{} :: {
		folder: Folder,
		arrows: { BasePart },
		fieldOn: boolean,
		items: { Item },
		objectsOn: boolean,
		random: Random,
		stats: { flying: number, sliding: number, resting: number, maxSpeed: number },
	},
	WindLab
))

function WindLab.new(parent: Instance?): WindLab
	local folder = Instance.new("Folder")
	folder.Name = "WindLab"
	folder.Parent = parent or Workspace
	return setmetatable({
		folder = folder,
		arrows = {},
		fieldOn = false,
		items = {},
		objectsOn = false,
		random = Random.new(1234),
		stats = { flying = 0, sliding = 0, resting = 0, maxSpeed = 0 },
	}, WindLab)
end

local function newPart(folder: Instance, name: string, size: Vector3, colour: Color3): BasePart
	local p = Instance.new("Part")
	p.Name = name
	p.Anchored, p.CanCollide, p.CanQuery, p.CanTouch = true, false, false, false
	p.CastShadow = false
	p.Material = Enum.Material.SmoothPlastic
	p.Size = size
	p.Color = colour
	p.Parent = folder
	return p
end

---------------------------------------------------------------- arrows

local RING_RADII = { 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6 } -- x the core radius
local RING_ANGLES = 24
local SLICE_R = { -3, -2.5, -2, -1.6, -1.3, -1, -0.8, -0.6, -0.4, -0.2, 0, 0.2, 0.4, 0.6, 0.8, 1, 1.3, 1.6, 2, 2.5, 3 }
local SLICE_Z = { 3, 10, 20, 35, 60, 100, 160, 250, 360 } -- m
local ARROW_TIME = 0.6 -- s: an arrow is as long as the air goes in this time

function WindLab.toggleField(self: WindLab)
	self.fieldOn = not self.fieldOn
	if not self.fieldOn then
		for _, a in self.arrows do
			a:Destroy()
		end
		table.clear(self.arrows)
	else
		local n = #RING_RADII * RING_ANGLES + #SLICE_R * #SLICE_Z
		for i = 1, n do
			local a = newPart(self.folder, "Arrow", Vector3.new(0.6, 0.6, 1), Color3.new(1, 1, 1))
			a.Material = Enum.Material.Neon
			table.insert(self.arrows, a)
		end
	end
	print("[TornadoLab] wind arrows: " .. tostring(self.fieldOn))
end

local function placeArrow(a: BasePart, at: Vector3, wind: Vector3, thick: number)
	local speed = wind.Magnitude
	if speed < 0.5 then
		a.Transparency = 1
		return
	end
	a.Transparency = 0.15
	local len = math.max(speed * ARROW_TIME, 0.5)
	a.Size = Vector3.new(thick, thick, len)
	a.CFrame = CFrame.lookAt(at, at + wind) * CFrame.new(0, 0, -len / 2)
	a.Color = efColour(speed)
end

local function updateArrows(self: WindLab, p: WindField.Params, state: any, time: number, camera: Camera)
	local spm = Config.STUDS_PER_METRE
	local rc = p.rc
	local thick = math.clamp(rc * 0.025, 0.6, 4)
	local i = 0
	local ground = state.position
	for _, k in RING_RADII do
		for j = 1, RING_ANGLES do
			i += 1
			local th = (j - 1) / RING_ANGLES * 2 * math.pi
			local at = ground + Vector3.new(math.cos(th) * k * rc, 10 * spm, math.sin(th) * k * rc)
			placeArrow(self.arrows[i], at, Vortex.sample(p, state, at, time), thick)
		end
	end
	-- the slice: square to the camera, through the ground point
	local look = camera.CFrame.LookVector
	local right = Vector3.new(-look.Z, 0, look.X)
	right = if right.Magnitude > 1e-3 then right.Unit else Vector3.xAxis
	for _, z in SLICE_Z do
		for _, k in SLICE_R do
			i += 1
			local at = ground + right * k * rc + Vector3.new(0, z * spm, 0)
			local wind = Vortex.sample(p, state, at, time)
			-- show the slice's own flow: inflow/outflow and up/down (the spin goes through it)
			local inPlane = right * wind:Dot(right) + Vector3.new(0, wind.Y, 0)
			placeArrow(self.arrows[i], at, inPlane, thick * 0.8)
		end
	end
end

---------------------------------------------------------------- test objects

function WindLab.toggleObjects(self: WindLab, state: any)
	self.objectsOn = not self.objectsOn
	for _, it in self.items do
		it.part:Destroy()
	end
	table.clear(self.items)
	if self.objectsOn then
		local p = Vortex.params(state)
		local rnd = self.random
		for _, kind in KINDS do
			for _ = 1, kind.count do
				-- scattered from 1.3 to 5 core radii out, all round (so some are on the strong side)
				local th = rnd:NextNumber(0, 2 * math.pi)
				local r = p.rc * (1.3 + 3.7 * rnd:NextNumber() ^ 1.5)
				local half = kind.size.Y / 2
				local pos = state.position + Vector3.new(math.cos(th) * r, half, math.sin(th) * r)
				local rot = CFrame.Angles(0, rnd:NextNumber(0, 2 * math.pi), 0)
				local part = newPart(self.folder, kind.class, kind.size, kind.colour)
				part.CFrame = CFrame.new(pos) * rot
				table.insert(self.items, {
					part = part,
					body = WindPhysics.newBody(kind.class, kind.attached, function()
						return rnd:NextNumber()
					end),
					pos = pos,
					vel = Vector3.zero,
					rot = rot,
					spinAxis = Vector3.new(rnd:NextNumber(-1, 1), rnd:NextNumber(-1, 1), rnd:NextNumber(-1, 1)).Unit,
					half = half,
					gust = 0,
					state = "resting",
				})
			end
		end
	end
	print("[TornadoLab] test objects: " .. tostring(self.objectsOn))
end

local function updateItems(self: WindLab, p: WindField.Params, state: any, time: number, dt: number)
	local spm = Config.STUDS_PER_METRE
	local st = self.stats
	st.flying, st.sliding, st.resting, st.maxSpeed = 0, 0, 0, 0
	local cfs, parts = {}, {}
	for _, it in self.items do
		local b = it.body
		local wind = Vortex.sample(p, state, it.pos, time) / spm -- m/s
		it.gust = WindPhysics.gust3s(it.gust, wind.Magnitude, dt)
		local speedNow = WindPhysics.effectiveSpeed(wind.X, wind.Y, wind.Z)
		local felt = if b.loose then speedNow else math.max(it.gust, 0) -- attached parts: 3-s mean
		if it.state ~= "flying" and math.random() < WindPhysics.pickupChance(b, felt, dt) then
			it.state = "flying"
			b.flying = true
			b.loose = true
		end
		if it.state == "resting" and b.class.slide and it.gust > b.class.slide then
			it.state = "sliding"
		end
		local v = it.vel / spm
		if it.state == "flying" or it.state == "sliding" then
			local vx, vy, vz = WindPhysics.step(b, v.X, v.Y, v.Z, wind.X, wind.Y, wind.Z, dt)
			v = Vector3.new(vx, vy, vz)
			if it.state == "sliding" then
				-- held to the ground: friction (mu 0.6) against the drag, no lift
				v = Vector3.new(v.X, 0, v.Z)
				local h = v.Magnitude
				if h > 0 then
					v *= math.max(h - 0.6 * WindPhysics.G * dt, 0) / h
				end
				if it.gust < (b.class.slide or 0) * 0.8 and h < 0.5 then
					it.state = "resting"
					v = Vector3.zero
				end
			end
			it.pos += v * spm * dt
			-- tumbling while in the air
			if it.state == "flying" then
				local rel = (wind - v).Magnitude
				it.rot = CFrame.fromAxisAngle(it.spinAxis, WindPhysics.tumbleRate(b, rel) * dt) * it.rot
			end
			-- the ground (the lab's ground is y = 0)
			local floor = state.position.Y + it.half
			if it.pos.Y <= floor then
				it.pos = Vector3.new(it.pos.X, floor, it.pos.Z)
				if it.state == "flying" then
					local vx2, vy2, vz2, rest = WindPhysics.land(b, v.X, v.Y, v.Z, dt)
					v = Vector3.new(vx2, vy2, vz2)
					if rest then
						it.state = "resting"
						b.flying = false
					end
				end
			end
			it.vel = v * spm
		end
		st.maxSpeed = math.max(st.maxSpeed, v.Magnitude)
		if it.state == "flying" then
			st.flying += 1
		elseif it.state == "sliding" then
			st.sliding += 1
		else
			st.resting += 1
		end
		table.insert(parts, it.part)
		table.insert(cfs, CFrame.new(it.pos) * it.rot)
	end
	if #parts > 0 then
		Workspace:BulkMoveTo(parts, cfs, Enum.BulkMoveMode.FireCFrameChanged)
	end
end

function WindLab.update(self: WindLab, state: any, dt: number, time: number)
	if not self.fieldOn and not self.objectsOn then
		return
	end
	local p = Vortex.cachedParams(state)
	if self.fieldOn then
		updateArrows(self, p, state, time, Workspace.CurrentCamera)
	end
	if self.objectsOn and dt > 0 then
		updateItems(self, p, state, time, math.min(dt, 1 / 15))
	end
end

-- One line for the panel: the field's parameters and the wind where the camera is.
function WindLab.describe(self: WindLab, state: any, time: number): string
	local p = Vortex.cachedParams(state)
	local spm = Config.STUDS_PER_METRE
	local cam = Workspace.CurrentCamera.CFrame.Position
	local w = Vortex.sample(p, state, cam, time) / spm
	local line = string.format(
		"wind: core %.0f m, spin %.0f m/s, swirl %.2f%s%s · at camera %.0f m/s (up %+.0f)",
		p.rc / spm, p.vc / spm, Vortex.swirl(state),
		if p.twoCell > 0.05 then string.format(", two-celled %.1f", p.twoCell) else "",
		if p.subCount > 0 then string.format(", %d sub-vortices", math.ceil(p.subCount)) else "",
		w.Magnitude, w.Y
	)
	if self.objectsOn then
		local st = self.stats
		line ..= string.format("\nobjects: %d flying, %d sliding, %d resting · fastest %.0f m/s", st.flying, st.sliding, st.resting, st.maxSpeed)
	end
	return line
end

return WindLab
