--!nonstrict
-- Near-field VFX clouds (2026-10-29, the user's choice: "Hybrid: VFX up close").
--
-- Every cloud the lab draws is a billboard card (StormCards, TornadoCards, Scud, TornadoDust).
-- Roblox draws particles only to ~800 studs from the camera (measured 2026-10-22; ~220 m at the
-- standard scale), so particle clouds can't carry a storm. Up close they can do what a flat card
-- can't: an animated, boiling, many-layered soft volume. So this layer takes the cards that come
-- within particle reach and swaps each one for a particle smoke volume of the same place, size,
-- colour and opacity, cross-fading the card out; farther away nothing changes.
--
--   finds     every 2 s the billboards under ctx.root (an ImageLabel card on an Attachment);
--             every 0.2 s the ones whose far edge is within reach, nearest first, up to MAX slots
--   draws     one pooled box-volume ParticleEmitter per card: a looping 4x4 smoke flipbook
--             (tools/smoke/smoke_flipbook.py), facing the camera, slowly turning and drifting,
--             tinted the card's colour (the renderers' shading: sun, shadow, haze, rain fog), its
--             per-particle opacity set so the overlapping stack matches the card's
--   hands off weight k = 1 inside NEAR_FULL, 0 beyond NEAR_END (studs, card centre + half its
--             size); the card's own transparency is scaled by (1 - k) after the renderers wrote
--             it (post(), called last each frame by init.client), the particles by k
-- Nothing here decides what a cloud looks like: it re-draws what the renderers planned.
-- Toggle: key B. Debug attribute on ctx.root: NearVfx ("cards · particles · ms").
local Workspace = game:GetService("Workspace")
local UserInputService = game:GetService("UserInputService")

local NearVfx = {}

-- the cloud renderers' folders under ctx.root (rain shafts, lightning, debris and labels are not cloud)
local CLOUD_ROOTS = { "StormCards", "TornadoCards", "ScudAnchor", "DustAnchor" }

local exp, max, min, clamp = math.exp, math.max, math.min, math.clamp

function NearVfx.new(ctx: any): any
	local C = ctx.Config
	local V = C.NEAR_VFX or {}
	local MAX = V.maxSlots or 64
	local NEAR_END = V.nearEnd or 720 -- studs: the particles' reach is ~800
	local NEAR_FULL = V.nearFull or 520
	local SMOKE = V.texture or C.TEXTURES.smokeLoop
	local self = { enabled = V.enabled ~= false, slots = {}, cards = {}, byBB = {} }

	local folder = Instance.new("Folder")
	folder.Name = "NearVfx"
	folder.Parent = ctx.root

	local function newSlot(): any
		local p = Instance.new("Part")
		p.Anchored, p.CanCollide, p.CanQuery, p.CanTouch, p.CastShadow = true, false, false, false, false
		p.Transparency = 1
		p.Size = Vector3.one
		p.Parent = folder
		local e = Instance.new("ParticleEmitter")
		e.Texture = SMOKE
		e.FlipbookLayout = Enum.ParticleFlipbookLayout.Grid4x4
		e.FlipbookMode = Enum.ParticleFlipbookMode.Loop
		e.FlipbookFramerate = NumberRange.new(6, 10)
		e.FlipbookStartRandom = true
		e.Shape = Enum.ParticleEmitterShape.Box
		e.ShapeStyle = Enum.ParticleEmitterShapeStyle.Volume
		e.Orientation = Enum.ParticleOrientation.FacingCamera
		e.LightInfluence = 0 -- (the card's colour already carries the light)
		e.LightEmission = 0
		e.Rotation = NumberRange.new(-180, 180)
		e.RotSpeed = NumberRange.new(-8, 8)
		e.SpreadAngle = Vector2.new(180, 180)
		e.Drag = 0.5
		e.LockedToPart = true -- (the puffs move with their card: a turning funnel carries them)
		e.Rate = 0
		e.Enabled = false
		e.Parent = p
		return { part = p, e = e, card = nil, k = 0 }
	end

	-- the cards: billboards with an image on an attachment (labels and UI have no Adornee
	-- attachment or no ImageLabel). Refreshed every 2 s.
	local lastFind = -math.huge
	local function find()
		local list = {}
		local all = {}
		for _, name in CLOUD_ROOTS do
			local r = ctx.root:FindFirstChild(name)
			if r then
				for _, d in r:GetDescendants() do
					table.insert(all, d)
				end
			end
		end
		for _, d in all do
			if d:IsA("BillboardGui") and d.Adornee and d.Adornee:IsA("Attachment") then
				local imgs = {}
				for _, ch in d:GetChildren() do
					if ch:IsA("ImageLabel") then
						table.insert(imgs, ch)
					end
				end
				if #imgs > 0 then
					local c = self.byBB[d] or { bb = d, att = d.Adornee, imgs = imgs, base = {}, wrote = {}, k = 0 }
					c.imgs = imgs
					table.insert(list, c)
				end
			end
		end
		local by = {}
		for _, c in list do
			by[c.bb] = c
		end
		self.cards, self.byBB = list, by
	end

	-- which cards get particles: nearest first, within reach
	local lastPick = -math.huge
	local function pick(camP: Vector3)
		local cand = {}
		for _, c in self.cards do
			local bb = c.bb
			if bb.Parent and bb.Enabled then
				local s = bb.Size
				local w, h = s.X.Scale, s.Y.Scale
				local d = (c.att.WorldPosition - camP).Magnitude + 0.5 * max(w, h)
				if d < NEAR_END and w > 1 then
					c.d = d
					table.insert(cand, c)
				end
			end
		end
		table.sort(cand, function(a, b)
			return a.d < b.d
		end)
		local want = {}
		for i = 1, min(#cand, MAX) do
			want[cand[i]] = true
		end
		-- free slots whose card left (they fade; the card fades back in)
		for _, sl in self.slots do
			if sl.card and not want[sl.card] then
				sl.leaving = true
			elseif sl.card then
				want[sl.card] = nil
				sl.leaving = false
			end
		end
		for c in want do
			local slot = nil
			for _, sl in self.slots do
				if not sl.card then
					slot = sl
					break
				end
			end
			if not slot and #self.slots < MAX then
				slot = newSlot()
				table.insert(self.slots, slot)
			end
			if slot then
				slot.card, slot.leaving, slot.k, slot.shownAt = c, false, 0, -math.huge
				slot.e:Clear()
				slot.e.Enabled = true
			end
		end
	end

	-- a card's own transparency with the hand-off applied (the renderers write only on change,
	-- so a value that differs from what we last wrote is theirs: that is the new base)
	local function fadeCard(c: any, k: number)
		for i, img in c.imgs do
			local cur = img.ImageTransparency
			if c.wrote[i] == nil or math.abs(cur - c.wrote[i]) > 1e-4 then
				c.base[i] = cur
			end
			local tr = 1 - (1 - c.base[i]) * (1 - k)
			if math.abs(tr - cur) > 1e-4 then
				img.ImageTransparency = tr
			end
			c.wrote[i] = tr
		end
	end
	local function restoreCard(c: any)
		for i, img in c.imgs do
			if c.base[i] and c.wrote[i] and math.abs(img.ImageTransparency - c.wrote[i]) < 1e-4 then
				img.ImageTransparency = c.base[i]
			end
			c.wrote[i] = nil
		end
	end

	-- the emitter for a card: its size, colour and opacity (at 5 Hz, or when it first shows)
	local function shape(sl: any, c: any, now: number)
		local s = c.bb.Size
		local w, h = s.X.Scale, s.Y.Scale
		local img = c.imgs[1]
		local a = (1 - (c.base[1] or img.ImageTransparency)) * sl.k
		local e = sl.e
		-- puffs ~half the card's smaller side, the box the rest of it (so the stack's outline is
		-- the card's), a third as deep as wide
		local ps = clamp(0.55 * min(w, h), 2, 500)
		local bw, bh = max(w - ps, 0.1), max(h - ps, 0.1)
		sl.part.Size = Vector3.new(bw, bh, max(0.35 * bw, 0.1))
		local n = clamp(math.floor(5 * (w * h) / (ps * ps) + 0.5), 4, 22)
		local life = 4
		-- per-puff opacity so the stack gives the card's: m puffs overlap a point on average
		-- (n puffs of ps^2 over the w x h card), each at full strength ~3/4 of its life. (At an
		-- assumed 2.5 the stack came out ~2x too opaque: a tornado's dust turned into a brown wall)
		local m = max(1, n * ps * ps / max(w * h, 1)) * 0.75
		local p = 1 - (1 - clamp(a, 0, 0.98)) ^ (1 / m)
		local tr = 1 - p
		if sl.ps == nil or math.abs(ps - sl.ps) > 0.05 * sl.ps then
			sl.ps = ps
			e.Size = NumberSequence.new({ NumberSequenceKeypoint.new(0, 0.85 * ps), NumberSequenceKeypoint.new(1, 1.1 * ps) })
			e.Speed = NumberRange.new(0, 0.04 * ps)
		end
		if sl.tr == nil or math.abs(tr - sl.tr) > 0.01 then
			sl.tr = tr
			e.Transparency = NumberSequence.new({
				NumberSequenceKeypoint.new(0, 1), NumberSequenceKeypoint.new(0.25, tr),
				NumberSequenceKeypoint.new(0.75, tr), NumberSequenceKeypoint.new(1, 1),
			})
		end
		local col = img.ImageColor3
		if sl.col == nil or (Vector3.new(col.R, col.G, col.B) - sl.col).Magnitude > 0.01 then
			sl.col = Vector3.new(col.R, col.G, col.B)
			e.Color = ColorSequence.new(col)
		end
		e.Lifetime = NumberRange.new(0.8 * life, 1.2 * life)
		e.Rate = n / life
		if sl.n == nil then
			e:Emit(n) -- (full at once: no thin first seconds)
		end
		sl.n = n
		sl.shownAt = now
	end

	UserInputService.InputBegan:Connect(function(input, processed)
		if processed or UserInputService:GetFocusedTextBox() then
			return
		end
		if input.KeyCode == Enum.KeyCode.B then
			self.enabled = not self.enabled
		end
	end)

	function self:update(_dt: number) end

	-- after every renderer (init.client calls it last each frame)
	function self:post(dt: number)
		local t0 = os.clock()
		local cam = Workspace.CurrentCamera
		local camP = cam.CFrame.Position
		local now = os.clock()
		if self.enabled then
			if now - lastFind > 2 then
				lastFind = now
				find()
			end
			if now - lastPick > 0.2 then
				lastPick = now
				pick(camP)
			end
		else
			for _, sl in self.slots do
				if sl.card then
					sl.leaving = true
				end
			end
		end
		local parts, cfs = {}, {}
		local nParticles = 0
		local a = 1 - exp(-dt / 0.35)
		for _, sl in self.slots do
			local c = sl.card
			if c then
				local target = 0
				if not sl.leaving and c.bb.Parent and c.bb.Enabled then
					local s = c.bb.Size
					local d = (c.att.WorldPosition - camP).Magnitude + 0.5 * max(s.X.Scale, s.Y.Scale)
					target = clamp((NEAR_END - d) / (NEAR_END - NEAR_FULL), 0, 1)
					target = target * target * (3 - 2 * target)
				end
				sl.k += (target - sl.k) * a
				if sl.leaving and sl.k < 0.02 then
					restoreCard(c)
					sl.card, sl.n, sl.ps, sl.tr, sl.col = nil, nil, nil, nil, nil
					sl.e.Enabled = false
					sl.e:Clear()
				else
					fadeCard(c, sl.k)
					table.insert(parts, sl.part)
					table.insert(cfs, CFrame.lookAt(c.att.WorldPosition, camP))
					if now - sl.shownAt > 0.2 then
						shape(sl, c, now)
					end
					nParticles += sl.n or 0
				end
			end
		end
		if #parts > 0 then
			Workspace:BulkMoveTo(parts, cfs, Enum.BulkMoveMode.FireCFrameChanged)
		end
		local used = 0
		for _, sl in self.slots do
			if sl.card then
				used += 1
			end
		end
		ctx.root:SetAttribute("NearVfx", string.format("%s · %d cards · ~%d particles · %.2f ms",
			if self.enabled then "on" else "off", used, nParticles, (os.clock() - t0) * 1000))
	end

	ctx.nearVfx = self
	return self
end

return NearVfx
