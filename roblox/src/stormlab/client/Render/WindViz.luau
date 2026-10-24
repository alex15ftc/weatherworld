--!nonstrict
-- Wind vectors (guide section 9, stage 1): arrows on a grid round the focus at a chosen height,
-- showing the simulated wind (ClientWorld.windAt: the same field the debris, dust, radar and
-- damage use). Colour by speed (EF-scale bands), length by speed, tilted by the vertical wind.
-- Toggle J (or the panel's "wind" layer); K cycles the layout:
--   grid      a tornado-scale grid (spacing 0.6 rc) at a chosen height ([ and ]: 2 m .. 3 km)
--   storm     a storm-scale grid (1 km), same heights
--   classic   the old lab's arrows: rings 10 m up at 0.25-6 core radii round the focused tornado,
--             plus a vertical slice through the core square to the camera showing only the flow
--             in the slice (inflow along the ground turning up into the funnel, the downdraught
--             on the axis of a two-celled vortex); an arrow is as long as the air goes in 0.6 s
local UserInputService = game:GetService("UserInputService")
local Workspace = game:GetService("Workspace")

local WindViz = {}

local N = 17
local HEIGHTS = { 2, 10, 30, 100, 300, 1000, 3000 }
local MODES = { "grid", "storm", "classic" }
-- the classic layout (the old TornadoLab's WindLab)
local RING_RADII = { 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6 } -- x the core radius
local RING_ANGLES = 24
local SLICE_R = { -3, -2.5, -2, -1.6, -1.3, -1, -0.8, -0.6, -0.4, -0.2, 0, 0.2, 0.4, 0.6, 0.8, 1, 1.3, 1.6, 2, 2.5, 3 }
local SLICE_Z = { 3, 10, 20, 35, 60, 100, 160, 250, 360 } -- m
local ARROW_TIME = 0.6 -- s
local POOL = math.max(N * N, #RING_RADII * RING_ANGLES + #SLICE_R * #SLICE_Z)

local function speedColour(s: number): Color3
	-- EF bands in m/s: <29 grey-blue, EF0 green, EF1 yellow, EF2 orange, EF3 red, EF4 magenta, EF5 white
	if s < 15 then
		return Color3.fromRGB(110, 140, 200)
	elseif s < 29 then
		return Color3.fromRGB(80, 190, 230)
	elseif s < 38.5 then
		return Color3.fromRGB(70, 200, 70)
	elseif s < 49.6 then
		return Color3.fromRGB(240, 220, 50)
	elseif s < 60.4 then
		return Color3.fromRGB(250, 150, 30)
	elseif s < 73.8 then
		return Color3.fromRGB(230, 40, 30)
	elseif s < 89.4 then
		return Color3.fromRGB(220, 40, 220)
	end
	return Color3.fromRGB(255, 255, 255)
end

function WindViz.new(ctx: any): any
	local C = ctx.Config
	local folder = Instance.new("Folder")
	folder.Name = "WindArrows"
	folder.Parent = ctx.root
	local self = { arrows = {}, heightIndex = 2, mode = 1 }
	for _ = 1, POOL do
		local shaft = Instance.new("Part")
		shaft.Anchored, shaft.CanCollide, shaft.CanQuery, shaft.CanTouch, shaft.CastShadow = true, false, false, false, false
		shaft.Material = Enum.Material.Neon
		shaft.Size = Vector3.new(0.6, 0.6, 5)
		shaft.Transparency = 1
		shaft.Parent = folder
		local head = Instance.new("WedgePart")
		head.Anchored, head.CanCollide, head.CanQuery, head.CanTouch, head.CastShadow = true, false, false, false, false
		head.Material = Enum.Material.Neon
		head.Size = Vector3.new(0.6, 2, 2)
		head.Transparency = 1
		head.Parent = folder
		table.insert(self.arrows, { shaft = shaft, head = head })
	end
	UserInputService.InputBegan:Connect(function(input, processed)
		if processed or UserInputService:GetFocusedTextBox() then
			return
		end
		if input.KeyCode == Enum.KeyCode.J then
			ctx.state.show.wind = not ctx.state.show.wind
		elseif input.KeyCode == Enum.KeyCode.RightBracket then
			self.heightIndex = math.min(#HEIGHTS, self.heightIndex + 1)
		elseif input.KeyCode == Enum.KeyCode.LeftBracket then
			self.heightIndex = math.max(1, self.heightIndex - 1)
		elseif input.KeyCode == Enum.KeyCode.K then
			self.mode = self.mode % #MODES + 1
			ctx.state.windMode = MODES[self.mode]
			print("[StormLab] wind arrows: " .. MODES[self.mode])
		end
		ctx.state.windHeight = HEIGHTS[self.heightIndex]
	end)
	local parts, cfs = {}, {}
	local frame = 0
	function self:update(_dt: number)
		frame += 1
		local show = ctx.state.show.wind
		if not show then
			if self.visible then
				for _, a in self.arrows do
					a.shaft.Transparency, a.head.Transparency = 1, 1
				end
				self.visible = false
			end
			return
		end
		if frame % 3 ~= 0 then
			return -- 20 Hz is plenty
		end
		self.visible = true
		local cw = ctx.cw
		local fx, fy, kind = ctx:focus()
		table.clear(parts)
		table.clear(cfs)
		-- one arrow from sim point (x, y, z) along the sim vector (u, v, w), len studs long
		local k = 0
		local function place(x: number, y: number, z: number, u: number, v: number, w: number, len: number, thick: number)
			k += 1
			local a = self.arrows[k]
			local s = math.sqrt(u * u + v * v + w * w)
			if s <= 0.2 then
				a.shaft.Transparency, a.head.Transparency = 1, 1
				return
			end
			local pos = C.toWorld(x, y, z)
			local cf = CFrame.lookAt(pos, pos + C.toWorld(u, v, w))
			a.shaft.Size = Vector3.new(thick, thick, len)
			a.head.Size = Vector3.new(thick, thick * 4, thick * 4)
			table.insert(parts, a.shaft)
			table.insert(cfs, cf * CFrame.new(0, 0, -len / 2))
			table.insert(parts, a.head)
			table.insert(cfs, cf * CFrame.new(0, 0, -len - thick * 2) * CFrame.Angles(math.pi / 2, 0, 0))
			local col = speedColour(s)
			a.shaft.Color, a.head.Color = col, col
			a.shaft.Transparency, a.head.Transparency = 0.15, 0.15
		end
		-- the tornado at the focus (or the nearest one), for the tornado-scale layouts
		local focusT, best = nil, math.huge
		for _, t in cw.tornadoes do
			if not t.ended then
				local d = (t.x - fx) ^ 2 + (t.y - fy) ^ 2
				if d < best then
					focusT, best = t, d
				end
			end
		end
		local mode = MODES[self.mode]
		if mode == "classic" and focusT and best < 5000 ^ 2 then
			-- rings 10 m up round the core: the swirl and the inflow
			local rc = math.max(8, focusT.rc)
			local thick = math.clamp(rc * 0.025, 0.6, 4)
			for _, kr in RING_RADII do
				for j = 1, RING_ANGLES do
					local th = (j - 1) / RING_ANGLES * 2 * math.pi
					local x, y = focusT.x + math.cos(th) * kr * rc, focusT.y + math.sin(th) * kr * rc
					local u, v, w = cw:windAt(x, y, 10)
					place(x, y, 10, u, v, w, math.max(math.sqrt(u * u + v * v + w * w) * ARROW_TIME, 0.5), thick)
				end
			end
			-- the slice through the core, square to the camera: only the flow in the slice
			local look = workspace.CurrentCamera.CFrame.LookVector
			local lx, ly = look.X, -look.Z -- (sim frame: x east, y north)
			local rx, ry = ly, -lx
			local rl = math.sqrt(rx * rx + ry * ry)
			if rl < 1e-3 then
				rx, ry, rl = 1, 0, 1
			end
			rx, ry = rx / rl, ry / rl
			for _, z in SLICE_Z do
				for _, kr in SLICE_R do
					local x, y = focusT.x + rx * kr * rc, focusT.y + ry * kr * rc
					local u, v, w = cw:windAt(x, y, z)
					local along = u * rx + v * ry
					local pu, pv = along * rx, along * ry
					place(x, y, z, pu, pv, w, math.max(math.sqrt(along * along + w * w) * ARROW_TIME, 0.5), thick * 0.8)
				end
			end
		else
			local spacing = 1000
			if mode == "grid" and focusT and kind == "tornado" then
				spacing = math.max(8, 0.6 * focusT.rc)
			end
			local scale = spacing / 40
			local z = HEIGHTS[self.heightIndex]
			local half = (N - 1) / 2
			local thick = math.max(0.3, spacing * 0.04)
			for i = 0, N - 1 do
				for j = 0, N - 1 do
					local x, y = fx + (i - half) * spacing, fy + (j - half) * spacing
					local u, v, w = cw:windAt(x, y, z)
					local s = math.sqrt(u * u + v * v + w * w)
					place(x, y, z, u, v, w, math.clamp(s * scale, spacing * 0.15, spacing * 1.6), thick)
				end
			end
		end
		-- arrows this layout doesn't use: hidden (once, when the layout shrinks)
		for q = k + 1, (self.used or POOL) do
			local a = self.arrows[q]
			a.shaft.Transparency, a.head.Transparency = 1, 1
		end
		self.used = k
		if #parts > 0 then
			Workspace:BulkMoveTo(parts, cfs, Enum.BulkMoveMode.FireCFrameChanged)
		end
	end
	function self:destroy()
		folder:Destroy()
	end
	return self
end

return WindViz
