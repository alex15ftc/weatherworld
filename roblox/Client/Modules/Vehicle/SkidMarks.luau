--!strict
-- Tire marks from the tire model's own slip state.
--
-- A tire leaves rubber when it is past its peak slip: the combined slip
-- s = |(kappa / kappa_peak, alpha / alpha_peak)| from Tire.luau goes above ~1,
-- which covers wheelspin, locked brakes and sliding sideways alike. Darkness
-- follows how far past peak the tire is and how fast the patch is sliding.
--
-- Marks are flat segments laid on the contact surface (oriented to its normal),
-- drawn from a fixed pool that recycles the oldest segment, so a long burnout
-- costs nothing extra. They are local to the client that simulates the car.

local Workspace = game:GetService("Workspace")

local SkidMarks = {}
SkidMarks.__index = SkidMarks

-- Told about every segment laid (the replay recorder keeps them): CFrame, size, transparency.
SkidMarks.onLaid = nil :: ((cframe: CFrame, size: Vector3, transparency: number) -> ())?

local POOL_SIZE = 900
local SEGMENT_STUDS = 0.7 -- lay a segment every this many studs of travel
local LIFT = 0.03 -- studs above the surface (no z-fighting)
local SLIP_START = 1.05 -- combined slip where marking begins
local SLIP_FULL = 2.5 -- combined slip for the darkest mark
local MIN_SLIDE = 1.0 -- m/s of patch sliding needed to leave rubber

export type Track = {
	last: Vector3?,
	lastIntensity: number,
}

export type SkidMarks = typeof(setmetatable({} :: {
	folder: Folder,
	pool: { BasePart },
	nextIndex: number,
	tracks: { [string]: Track },
	widthStuds: number,
}, SkidMarks))

function SkidMarks.new(widthMeters: number, metersPerStud: number): SkidMarks
	local folder = Workspace:FindFirstChild("SkidMarks") :: Folder?
	if not folder then
		local f = Instance.new("Folder")
		f.Name = "SkidMarks"
		f.Parent = Workspace
		folder = f
	end
	return setmetatable({
		folder = folder :: Folder,
		pool = {},
		nextIndex = 1,
		tracks = {},
		widthStuds = widthMeters / metersPerStud,
	}, SkidMarks)
end

function SkidMarks._segment(self: SkidMarks): BasePart
	local i = self.nextIndex
	self.nextIndex = i % POOL_SIZE + 1
	local p = self.pool[i]
	if not p then
		local part = Instance.new("Part")
		part.Name = "Skid"
		part.Anchored = true
		part.CanCollide = false
		part.CanQuery = false
		part.CanTouch = false
		part.CastShadow = false
		part.Material = Enum.Material.SmoothPlastic
		part.Color = Color3.fromRGB(18, 18, 18)
		part.TopSurface = Enum.SurfaceType.Smooth
		part.BottomSurface = Enum.SurfaceType.Smooth
		part.Parent = self.folder
		self.pool[i] = part
		p = part
	end
	return p
end

-- slip: combined slip (1 = at peak); slide: patch sliding speed, m/s
function SkidMarks.update(self: SkidMarks, name: string, contact: Vector3?, normal: Vector3, slip: number, slide: number)
	local track = self.tracks[name]
	if not track then
		track = { last = nil, lastIntensity = 0 }
		self.tracks[name] = track
	end

	local intensity = 0
	if contact and slide > MIN_SLIDE then
		intensity = math.clamp((slip - SLIP_START) / (SLIP_FULL - SLIP_START), 0, 1)
		intensity *= math.clamp(slide / 4, 0.35, 1)
	end
	if intensity <= 0.02 or not contact then
		track.last = nil
		return
	end

	local point = contact + normal * LIFT
	local last = track.last
	if not last then
		track.last = point
		track.lastIntensity = intensity
		return
	end
	local delta = point - last
	local length = delta.Magnitude
	if length < SEGMENT_STUDS then
		return
	end
	if length > SEGMENT_STUDS * 6 then
		-- teleported / airborne gap: start a new mark
		track.last = point
		return
	end

	local seg = self:_segment()
	local mid = (point + last) * 0.5
	local look = delta / length
	-- make the segment's up the surface normal, its length along the travel
	local right = look:Cross(normal)
	if right.Magnitude < 1e-3 then
		track.last = point
		return
	end
	right = right.Unit
	local up = right:Cross(look)
	seg.Size = Vector3.new(self.widthStuds, 0.02, length + 0.05)
	seg.CFrame = CFrame.fromMatrix(mid, right, up, -look)
	seg.Transparency = 1 - 0.85 * (intensity + track.lastIntensity) * 0.5
	local onLaid = SkidMarks.onLaid
	if onLaid then
		onLaid(seg.CFrame, seg.Size, seg.Transparency)
	end
	track.last = point
	track.lastIntensity = intensity
end

function SkidMarks.destroy(self: SkidMarks)
	-- marks stay on the ground; only stop tracking
	table.clear(self.tracks)
end

return SkidMarks
