--!strict
-- The scour track (client only): where a tornado has touched the ground it leaves a dark mark
-- (stripped vegetation, churned soil), as in the reference clip_iOvAj0as2Z. Soft round marks are
-- laid along the contact as it moves, one each `spacing` x the contact's width, and fade slowly.
--
--   local scour = ScourView.new(workspace)
--   scour:setLive(state); RenderStepped: scour:update(dt)
local Workspace = game:GetService("Workspace")

local Config = require(script.Parent.Config)
local State = require(script.Parent.State)

local ScourView = {}
ScourView.__index = ScourView

type Mark = { part: BasePart, decal: Decal, age: number, strength: number }

export type ScourView = typeof(setmetatable(
	{} :: {
		folder: Folder,
		marks: { Mark },
		state: State.State?,
		last: Vector3?,
		params: RaycastParams,
	},
	ScourView
))

function ScourView.new(parent: Instance?): ScourView
	local folder = Instance.new("Folder")
	folder.Name = "ScourTrack"
	folder.Parent = parent or Workspace
	local params = RaycastParams.new()
	params.FilterType = Enum.RaycastFilterType.Exclude
	params.FilterDescendantsInstances = { folder }
	return setmetatable({ folder = folder, marks = {}, state = nil, last = nil, params = params }, ScourView)
end

function ScourView.setLive(self: ScourView, state: State.State)
	self.state = state
end
ScourView.setState = ScourView.setLive

function ScourView.clear(self: ScourView)
	for _, m in self.marks do
		m.part:Destroy()
	end
	table.clear(self.marks)
	self.last = nil
end

local function placeMark(self: ScourView, pos: Vector3, width: number)
	local S = Config.scour
	local hit = Workspace:Raycast(pos + Vector3.new(0, 200, 0), Vector3.new(0, -400, 0), self.params)
	if not hit then
		return
	end
	local part = Instance.new("Part")
	part.Name = "Scour"
	part.Anchored, part.CanCollide, part.CanQuery, part.CanTouch, part.CastShadow = true, false, false, false, false
	part.Transparency = 1
	local d = width * S.width
	part.Size = Vector3.new(d, 0.2, d)
	-- turned at random so the soft round marks don't line up into a pattern
	part.CFrame = CFrame.new(hit.Position + Vector3.new(0, 0.12, 0)) * CFrame.Angles(0, math.random() * 2 * math.pi, 0)
	local decal = Instance.new("Decal")
	decal.Face = Enum.NormalId.Top
	decal.Texture = Config.textures[S.texture] or S.texture
	decal.Color3 = S.color
	decal.Transparency = 1
	decal.Parent = part
	part.Parent = self.folder
	table.insert(self.marks, { part = part, decal = decal, age = 0, strength = 0 })
	while #self.marks > S.maxMarks do
		local old = table.remove(self.marks, 1) :: Mark
		old.part:Destroy()
	end
end

function ScourView.update(self: ScourView, dt: number)
	local S = Config.scour
	local state = self.state
	if not S.enabled or not Config.debris.enabled then
		if #self.marks > 0 then
			self:clear()
		end
		return
	end
	-- only while the funnel (or at least its debris whirl) is on the ground
	local touching = state ~= nil and (state.bottom or 0) < 0.5
	if state and touching then
		local width = State.radiusAt(state, 0) * 2
		local pos = state.position
		if not self.last or (pos - self.last).Magnitude > width * S.spacing then
			placeMark(self, pos, width)
			self.last = pos
		end
	end
	for i = #self.marks, 1, -1 do
		local m = self.marks[i]
		m.age += dt
		-- darkens while the contact is over it (grinding in), then slowly fades
		if state and touching and (m.part.Position - state.position).Magnitude < State.radiusAt(state, 0) * S.width * 0.5 then
			m.strength = math.min(m.strength + dt / math.max(S.grind, 0.1), 1)
		end
		local fade = math.clamp(1 - m.age / math.max(S.life, 1), 0, 1)
		m.decal.Transparency = 1 - S.opacity * m.strength * fade
		if fade <= 0 then
			m.part:Destroy()
			table.remove(self.marks, i)
		end
	end
end

function ScourView.destroy(self: ScourView)
	self:clear()
	self.folder:Destroy()
end

return ScourView
