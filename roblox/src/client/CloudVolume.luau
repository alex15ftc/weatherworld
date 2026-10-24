--!strict
-- The nearest storms' clouds drawn as volumes (Config.VOLUME_CLOUDS): rays from the camera are
-- marched through a cloud density and lit by the sun, the way Roblox's own cloud layer is drawn,
-- and each storm's picture is shown on a camera-facing image in place of its puffs.
--
--   Density  the storm's shapes, from the same fields StormView draws: the tower (a column
--            narrowing upward and leaning downwind; one per tower along a line), the overshooting
--            top, the flat base, the anvil and its root, the wall cloud lowering under the base.
--            Noise (rising and drifting with time) breaks their edges into lobes and wisps; the
--            anvil's is smooth and stretched by the wind aloft.
--   Light    toward the sun through the shapes (with stand-ins for light scattered many times
--            inside the cloud), forward scattering when looking toward the sun (bright edges
--            when backlit), and sky light that is brighter higher in the cloud and dimmer where
--            much cloud lies above; a soft tone curve.
--   Picture  rays through a grid laid over the storm's outline on the screen at its distance,
--            marched between where they enter and leave its box (stopping at the ground), each
--            start jittered, then blurred 3x3. The maths is shared/Weather/CloudVolumeMath.
--   Threads  bands of rows are rendered in parallel by worker Actors (client/CloudWorker); with
--            none ready, on this thread, budgetMs a frame. A finished picture goes into the
--            storm's second image, which then replaces the first (with the outline it was
--            rendered for): each cloud updates every second or so.
--
-- Each picture is shown on a BillboardGui (it always faces the screen) at the storm's distance,
-- behind its tornado, so nearer things (the ground, the tornado) draw in front.

local AssetService = game:GetService("AssetService")
local Lighting = game:GetService("Lighting")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage.Shared.World.Config)
local CloudVolumeMath = require(ReplicatedStorage.Shared.Weather.CloudVolumeMath)

type Job = CloudVolumeMath.Job

local CloudVolume = {}

local VOL = Config.VOLUME_CLOUDS
local N = VOL.pixels
local smooth = CloudVolumeMath.smooth

type Slot = { part: Part, gui: BillboardGui, image: any }
type Volume = {
	slots: { Slot },
	front: number,
	job: Job?,
	packed: buffer,
	pending: number,
	sentAt: number,
	serialRow: number,
	shown: boolean,
	used: boolean,
}

local folder: Folder? = nil
local volumes: { [string]: Volume } = {}
local workers: { Actor } = {}
local ready: { [Actor]: boolean } = {}
local readyCount = 0
local nextWorker = 1
local jobId = 0
local failed = false
local started = false

local function newSlot(parent: Instance): Slot?
	local ok, image = pcall(function()
		return AssetService:CreateEditableImage({ Size = Vector2.new(N, N) })
	end)
	if not ok or not image then
		warn(`[CloudVolume] no EditableImage ({image}): storm clouds stay as puffs. Turn on Allow Mesh / Image APIs (Game Settings > Security).`)
		return nil
	end
	local part = Instance.new("Part")
	part.Anchored, part.CanCollide, part.CanQuery, part.CanTouch, part.CastShadow = true, false, false, false, false
	part.Transparency = 1
	part.Size = Vector3.one
	part.Name = "cloudVolume"
	local gui = Instance.new("BillboardGui")
	gui.Adornee = part
	gui.AlwaysOnTop = false
	gui.LightInfluence = 0
	gui.MaxDistance = math.huge
	gui.ResetOnSpawn = false
	gui.Enabled = false
	local label = Instance.new("ImageLabel")
	label.Size = UDim2.fromScale(1, 1)
	label.BackgroundTransparency = 1
	label.ImageContent = Content.fromObject(image)
	label.Parent = gui
	gui.Parent = part
	part.Parent = parent
	return { part = part, gui = gui, image = image }
end

local function dropVolume(key: string)
	local v = volumes[key]
	if not v then
		return
	end
	for _, slot in v.slots do
		slot.part:Destroy()
		slot.image:Destroy()
	end
	volumes[key] = nil
end

-- A finished picture: into the back image, then shown where it was rendered for.
local function finish(v: Volume, j: Job)
	local back = v.slots[3 - v.front]
	back.image:WritePixelsBuffer(Vector2.zero, Vector2.new(N, N), v.packed)
	back.part.CFrame = CFrame.new(j.centre)
	back.gui.Size = UDim2.fromScale(j.halfW * 2, j.halfH * 2)
	back.gui.Enabled = true
	v.slots[v.front].gui.Enabled = false
	v.front = 3 - v.front
	v.shown = true
	v.job = nil
end

local function onWorker(kind: string, id: number?, key: string?, r0: number?, r1: number?, bytes: string?)
	if kind ~= "band" then
		return
	end
	local v = volumes[key :: string]
	local j = v and v.job
	if not v or not j or j.id ~= id then
		return -- a picture since replaced
	end
	buffer.writestring(v.packed, (r0 :: number) * N * 4, bytes :: string)
	v.pending -= 1
	if v.pending == 0 then
		finish(v, j)
	end
end

local function setup(parent: Instance): boolean
	if failed then
		return false
	end
	if started then
		return true
	end
	started = true
	local f = Instance.new("Folder")
	f.Name = "CloudVolume"
	f.Parent = parent
	folder = f
	-- The worker Actors: each a clone of the CloudWorker template, enabled.
	local template = script.Parent:FindFirstChild("CloudWorker")
	local player = Players.LocalPlayer
	local scripts = player and player:FindFirstChildOfClass("PlayerScripts")
	if template and scripts and VOL.workers > 0 then
		for i = 1, VOL.workers do
			local actor = Instance.new("Actor")
			actor.Name = `CloudWorker{i}`
			local done = Instance.new("BindableEvent")
			done.Name = "Done"
			done.Parent = actor
			done.Event:Connect(function(kind: string, ...)
				if kind == "ready" then
					ready[actor] = true
					readyCount += 1
				else
					onWorker(kind, ...)
				end
			end)
			local worker = template:Clone() :: LocalScript
			worker.Parent = actor
			worker.Enabled = true
			actor.Parent = scripts
			table.insert(workers, actor)
		end
	end
	return true
end

-- Lays a grid over the storm's outline on the screen at its distance: the picture to render.
local function newJob(s: any, camera: Camera, clock: number): Job?
	local sp = CloudVolumeMath.specOf(s)
	local cf = camera.CFrame
	local cam, look, right, up = cf.Position, cf.LookVector, cf.RightVector, cf.UpVector
	local mid = (sp.min + sp.max) / 2
	local depth = (mid - cam):Dot(look)
	if depth < 200 then
		return nil
	end
	-- Behind the tornado, so it draws in front.
	if sp.tornado then
		depth = math.max(depth, (sp.tornado - cam):Dot(look) + 400)
	end
	-- The box's corners on the plane at that depth; clipped to the view (with a margin, so a
	-- turning camera does not see the edge before the next picture).
	local tanY = math.tan(math.rad(camera.FieldOfView / 2))
	local aspect = camera.ViewportSize.X / math.max(1, camera.ViewportSize.Y)
	local limY, limX = depth * tanY * 1.2, depth * tanY * aspect * 1.2
	local x0, x1, y0, y1 = math.huge, -math.huge, math.huge, -math.huge
	local behind = false
	for i = 0, 7 do
		local c = Vector3.new(if i % 2 == 0 then sp.min.X else sp.max.X, if i % 4 < 2 then sp.min.Y else sp.max.Y, if i < 4 then sp.min.Z else sp.max.Z)
		local v = c - cam
		local z = v:Dot(look)
		if z < 50 then
			behind = true
			break
		end
		local px, py = v:Dot(right) / z * depth, v:Dot(up) / z * depth
		x0, x1, y0, y1 = math.min(x0, px), math.max(x1, px), math.min(y0, py), math.max(y1, py)
	end
	if behind then
		x0, x1, y0, y1 = -limX, limX, -limY, limY
	end
	x0, x1, y0, y1 = math.max(x0, -limX), math.min(x1, limX), math.max(y0, -limY), math.min(y1, limY)
	if x1 - x0 < 1 or y1 - y0 < 1 then
		return nil
	end
	-- Hung nearer than the storm (scaled to match: the rays are the same), out of Roblox's haze.
	local hang = math.min(1, VOL.displayDepth / depth)
	depth *= hang
	x0, x1, y0, y1 = x0 * hang, x1 * hang, y0 * hang, y1 * hang
	local sunDir = Lighting:GetSunDirection()
	-- The storm is lit by the open sky round it, not the shade at the camera: day light from the
	-- sun's height only. The picture still goes through the scene's exposure (SkyLight turns it
	-- down under a storm, the eye adapting to the dark): undo that.
	local exposure = math.clamp(2 ^ -Lighting.ExposureCompensation, 0.5, 3)
	jobId += 1
	return {
		id = jobId,
		key = s.id,
		spec = sp,
		n = N,
		cam = cam,
		centre = cam + look * depth + right * ((x0 + x1) / 2) + up * ((y0 + y1) / 2),
		right = right,
		up = up,
		halfW = (x1 - x0) / 2,
		halfH = (y1 - y0) / 2,
		clock = clock,
		sunDir = sunDir,
		sunI = VOL.sunLight * smooth(-0.04, 0.2, sunDir.Y) * exposure,
		ambI = VOL.skyLight * 0.6 * (0.08 + 0.92 * smooth(-0.15, 0.3, sunDir.Y)) * exposure,
	}
end

-- Sends a picture's bands to the ready workers (two bands each, for balance).
local function dispatch(v: Volume, j: Job)
	local live = {}
	for _, actor in workers do
		if ready[actor] then
			table.insert(live, actor)
		end
	end
	local bands = #live * 2
	local rows = math.ceil(N / bands)
	v.pending = 0
	for r0 = 0, N - 1, rows do
		local actor = live[(nextWorker - 1) % #live + 1]
		nextWorker += 1
		actor:SendMessage("Render", j, r0, math.min(N, r0 + rows))
		v.pending += 1
	end
end

-- Each frame: the storms to draw as volumes (the nearest first), where to put them, the camera,
-- the clock. Returns the ids of the storms being shown as volumes (StormView skips their puffs).
function CloudVolume.update(storms: { any }, parent: Instance, camera: Camera, clock: number): { [string]: boolean }
	local shown: { [string]: boolean } = {}
	if not VOL.enabled or not setup(parent) then
		return shown
	end
	for _, v in volumes do
		v.used = false
	end
	local budget = os.clock() + VOL.budgetMs / 1000
	for _, s in storms do
		local v = volumes[s.id]
		if not v then
			local a, b = newSlot(folder :: Folder), newSlot(folder :: Folder)
			if not a or not b then
				failed = true
				return shown
			end
			v = { slots = { a, b }, front = 1, job = nil, packed = buffer.create(N * N * 4), pending = 0, sentAt = 0, serialRow = 0, shown = false, used = true }
			volumes[s.id] = v
		end
		local vol = v :: Volume
		vol.used = true
		-- A new picture once the last is done (or lost: a worker that never answered).
		if vol.job and readyCount > 0 and vol.pending > 0 and clock - vol.sentAt > 5 then
			vol.job = nil
		end
		if not vol.job then
			local j = newJob(s, camera, clock)
			vol.job = j
			if j then
				buffer.fill(vol.packed, 0, 0)
				vol.serialRow = 0
				vol.sentAt = clock
				if readyCount > 0 then
					dispatch(vol, j)
				else
					vol.pending = -1 -- rendered here
				end
			end
		end
		-- Without workers: bands of rows here, within the frame's budget.
		local j = vol.job
		if j and vol.pending == -1 then
			while vol.serialRow < N and os.clock() < budget do
				local r1 = math.min(N, vol.serialRow + 4)
				buffer.writestring(vol.packed, vol.serialRow * N * 4, CloudVolumeMath.renderBand(j, vol.serialRow, r1))
				vol.serialRow = r1
			end
			if vol.serialRow >= N then
				finish(vol, j)
			end
		end
		if vol.shown then
			shown[s.id] = true
		end
	end
	-- Storms no longer drawn as volumes.
	for key, v in volumes do
		if not v.used then
			dropVolume(key)
		end
	end
	return shown
end

return CloudVolume
