--!strict
-- The cloud base overhead (the lab's base deck, an approved exception to billboards-only since
-- 2026-10-30, Render/BaseDeck): seen from under a storm a billboard faces the camera, so the puffs
-- right overhead take no room on the screen and the sky showed open above the camera to ~30 degrees
-- under the core (2026-11-07). Here the base round the camera is soft flat discs, each a see-through
-- Part showing a soft round cloud (the deck_soft texture) on its underside, at the frame's own base:
--   where     a hex grid fixed to the frame (riding with the storm), within RANGE studs of the
--             camera, at every point under the frame's lower cloud (base1 < top1); each disc at the
--             base of its column
--   light     PuffView.light for the base there - the cloud above it (to the top, and the upper
--             layer's depth) toward the sun and the sky, and its rain - so a disc is what the base
--             puff in its place is; lightning and the haze (and the rain in the way) as the puffs
--   opacity   the share of cloudy columns round it (so the base thins out at the cloud's edge, and
--             at the frame's edge as the puffs, PuffView.edgeFade), overlapping discs adding up to
--             it (each 1 - (1 - A)^(1 / LAYERS)); fading out over the range's last EDGE_FADE share,
--             so discs come and go at the range's edge without a pop
-- Hidden when the camera is above the base. Usage (as the other views):
--   DeckView.new(folder)  d:draw(frame, H, V)  d:place(ax, groundY, az)  d:recolour(camPos)  d:flash(flashAt)
local Lighting = game:GetService("Lighting")
local ClientFrame = require(script.Parent:WaitForChild("ClientFrame")) :: any
local PuffView = require(script.Parent:WaitForChild("PuffView")) :: any

local DeckView = {}
DeckView.__index = DeckView

local TEXTURE = "rbxassetid://138862961385378" -- deck_soft: a round soft disc, opaque to 0.20 of the frame, clear by 0.48
local DISC_STUDS = 2000 -- (a Part's largest side is 2048 studs)
local STEP = 0.6 * DISC_STUDS -- the hex grid's spacing (the lab's: soft discs at 0.6 add up nearly even)
local LAYERS = 0.375 * DISC_STUDS * DISC_STUDS / (STEP * STEP * math.sqrt(3) / 2) -- discs deep on average (texture mean opacity 0.375)
local RANGE = 6500 -- studs round the camera (Parts are not drawn past ~7000)
local EDGE_FADE = 0.3
local THICK = 20 -- studs
local COVER_R = 2 -- columns round a disc's centre for its cover (a 5 x 5 patch)
local SEEN_FROM, SEEN_FULL = math.rad(8), math.rad(20) -- a disc's elevation from the camera over which it fades in: the deck
                                    -- is for overhead, where the puffs take no room; nearer edge-on a flat disc squeezes to a
                                    -- thin band and the deck's edge showed as a hard line across the base (2026-11-07), where the
                                    -- puffs show the base anyway
local A_MAX = 0.98
local FLASH_MIN = 0.01
local UPRIGHT = CFrame.Angles(0, 0, math.pi / 2) -- (a cylinder's axis is its x: stand it up; its underside is then Left)

function DeckView.new(folder: Folder)
	local self = setmetatable({}, DeckView) :: any
	self.folder = folder
	self.pool = {}
	self.discs = {}
	self.ax, self.groundY, self.az = 0, 0, 0
	return self
end

local function disc(self: any, k: number): any
	local d = self.pool[k]
	if d then return d end
	local part = Instance.new("Part")
	part.Name = "Deck"
	part.Anchored, part.CanCollide, part.CanQuery, part.CanTouch = true, false, false, false
	part.CastShadow = false
	part.Shape = Enum.PartType.Cylinder
	part.Transparency = 1
	part.Size = Vector3.new(THICK, DISC_STUDS, DISC_STUDS)
	local gui = Instance.new("SurfaceGui")
	gui.Face = Enum.NormalId.Left
	gui.LightInfluence = 0
	gui.MaxDistance = 0
	gui.SizingMode = Enum.SurfaceGuiSizingMode.FixedSize
	gui.CanvasSize = Vector2.new(256, 256)
	local img = Instance.new("ImageLabel")
	img.Name = "I"
	img.BackgroundTransparency = 1
	img.Size = UDim2.fromScale(1, 1)
	img.Image = TEXTURE
	img.Parent = gui
	gui.Parent = part
	part.Parent = self.folder
	d = { part = part, gui = gui, img = img }
	self.pool[k] = d
	return d
end

-- The frame's lower cloud at column (i, j): base, top (m; nil where none), the upper layer's depth
-- and the rain (mm/h).
local function column(f: any, i: number, j: number): (number?, number, number, number)
	if i < 1 or j < 1 or i > f.nx or j > f.ny then return nil, 0, 0, 0 end
	local b1 = ClientFrame.cloudM(ClientFrame.byte(f, "base1", i, j))
	local t1 = ClientFrame.cloudM(ClientFrame.byte(f, "top1", i, j))
	if t1 <= b1 then return nil, 0, 0, 0 end
	local b2 = ClientFrame.cloudM(ClientFrame.byte(f, "base2", i, j))
	local t2 = ClientFrame.cloudM(ClientFrame.byte(f, "top2", i, j))
	return b1, t1, math.max(0, t2 - b2), ClientFrame.rateMmh(ClientFrame.byte(f, "rain", i, j))
end

-- A new frame (H studs a metre across, V up, as the puffs): the discs for the camera now.
function DeckView:draw(f: any, H: number, V: number)
	self.frame, self.H, self.V = f, H, V
	-- (heights: the cloud body's map when the caller sets heights, PuffView.heightMap; else V throughout)
	self.Y = if self.heights then self.heights.Y else function(z: number): number return z * V end
	self.Z = if self.heights then self.heights.Z else function(y: number): number return y / V end
	self.camAt = nil
	local cam = workspace.CurrentCamera
	self:recolour(if cam then cam.CFrame.Position else nil)
end

-- Which discs the camera wants, and their light (redone once it has moved PuffView.RECOLOUR_M
-- across, the sky's light has changed, or a frame came).
function DeckView:recolour(camPos: Vector3?)
	local f = self.frame
	if not f or not self.H or not camPos then return end
	local moved, dimmed = PuffView.stale(self, camPos)
	if not moved and not dimmed then return end
	self.camAt = camPos
	local H = self.H
	-- the camera in frame metres (x east, y north from the frame's origin)
	local cx = (camPos.X - self.ax) / H + f.anchorX
	local cy = -(camPos.Z - self.az) / H + f.anchorY
	local camM = self.Z(camPos.Y - self.groundY)
	local rangeM, stepM = RANGE / H, STEP / H
	local rowM = stepM * math.sqrt(3) / 2
	local sun = Lighting:GetSunDirection()
	local sunY = math.max(sun.Y, 0.05)
	local k = 0
	local j0, j1 = math.floor((cy - rangeM) / rowM), math.ceil((cy + rangeM) / rowM)
	for jr = j0, j1 do
		local shift = if jr % 2 == 0 then 0 else 0.5 * stepM
		local i0, i1 = math.floor((cx - rangeM - shift) / stepM), math.ceil((cx + rangeM - shift) / stepM)
		for ir = i0, i1 do
			local px, py = shift + ir * stepM, jr * rowM
			local dM = math.sqrt((px - cx) ^ 2 + (py - cy) ^ 2)
			if dM < rangeM then
				local gi, gj = math.floor(px / f.dx) + 1, math.floor(py / f.dx) + 1
				local b1, t1, up2, rain = column(f, gi, gj)
				if b1 and camM < b1 then
					-- cover: the share of cloudy columns round it
					local n, m = 0, 0
					for di = -COVER_R, COVER_R do
						for dj = -COVER_R, COVER_R do
							m += 1
							if column(f, gi + di, gj + dj) then n += 1 end
						end
					end
					local A = math.min(A_MAX, n / m * PuffView.edgeFade(f, px / f.dx + 0.5, py / f.dx + 0.5))
					local fade = math.clamp((1 - dM / rangeM) / EDGE_FADE, 0, 1)
					local elev = math.atan2(self.Y(b1) - self.Y(camM), dM * H) -- (on the screen: in studs, the sky scale stretching up)
					local e = math.clamp((elev - SEEN_FROM) / (SEEN_FULL - SEEN_FROM), 0, 1)
					fade *= e * e * (3 - 2 * e)
					local alpha = (1 - (1 - A) ^ (1 / LAYERS)) * fade
					if alpha > 0.01 then
						k += 1
						local d = disc(self, k)
						local above = (t1 - b1) + up2
						d.off = Vector3.new((px - f.anchorX) * H, self.Y(b1), -(py - f.anchorY) * H)
						d.hM, d.hx = b1, 0.5 * DISC_STUDS / H
						-- (the sun's way out: up through the cloud over it, along the sun's slant)
						d.path, d.above, d.wet = above / sunY, above, 1 / (1 + rain / PuffView.RAIN_DARK_MMH)
						local at = Vector3.new(self.ax, self.groundY, self.az) + d.off
						d.dist = ((at - camPos) * Vector3.new(1, 0, 1)).Magnitude / H
						d.tau, d.rainCol = PuffView.rainOn(camPos, at, b1)
						d.alpha = alpha
						d.flash = nil
						d.gui.Enabled = true
						d.img.ImageTransparency = 1 - alpha
						DeckView.shade(d)
					end
				end
			end
		end
	end
	for x = k + 1, #self.pool do
		local d = self.pool[x]
		if d.gui.Enabled then
			d.gui.Enabled = false
			d.part.CFrame = CFrame.new(0, -1e5, 0)
		end
	end
	self.shown = k
	self.placedAt = nil
end

function DeckView.shade(d: any)
	d.img.ImageColor3 = PuffView.haze(PuffView.flashed(PuffView.light(d.path, d.above, d.wet), d.flash or 0), d.dist, d.tau, d.rainCol)
end

-- Every render step: the discs riding with the storm (moved only when the anchor has).
function DeckView:place(ax: number, groundY: number, az: number)
	self.ax, self.groundY, self.az = ax, groundY, az
	local k = self.shown or 0
	if k == 0 then return end
	local at = Vector3.new(ax, groundY, az)
	if self.placedAt and (self.placedAt - at).Magnitude < 0.05 then return end
	self.placedAt = at
	local parts, cfs = table.create(k), table.create(k)
	for x = 1, k do
		local d = self.pool[x]
		parts[x] = d.part
		cfs[x] = CFrame.new(at + d.off) * UPRIGHT
	end
	workspace:BulkMoveTo(parts, cfs, Enum.BulkMoveMode.FireCFrameChanged)
end

-- Lightning on the base, as PuffView:flash.
function DeckView:flash(flashAt: (number, number, number, number, number) -> number)
	for x = 1, self.shown or 0 do
		local d = self.pool[x]
		local fl = flashAt(self.ax + d.off.X, self.az + d.off.Z, d.hM, d.hx, 0)
		if fl > FLASH_MIN or d.flash then
			d.flash = if fl > FLASH_MIN then fl else nil
			DeckView.shade(d)
		end
	end
end

function DeckView:destroy()
	for _, d in self.pool do d.part:Destroy() end
	self.pool = {}
end

return DeckView
