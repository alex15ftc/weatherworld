--!nonstrict
-- The flat overhead deck: the rain-free base near the camera as solid flat discs (an approved
-- exception to billboards-only, 2026-10-29; solid discs since 2026-10-30, see tile() below - the
-- notes on GUI tiles that follow describe the first version). Seen from under a storm a billboard stands
-- up as a wall, so the base read as oval lumps; flat tiles make one continuous ceiling.
--   where    each storm's rain-free base (StormCards publishes ctx.stormDeck: centre, radius,
--            height, clear slot, colour), tiles within LabConfig.DECK.range of the camera
--   tiles    Parts 2048 studs a side (a Part's largest size) on a grid that rides with the storm,
--            each a SurfaceGui on its underside split into CELLS x CELLS cells. A cell shows its
--            own piece of the seamless ceiling texture (so the tiles join with no seam) over a
--            soft fill of the same colour, with its own opacity: fades step every ~140 m.
--            (UIGradient does nothing on these SurfaceGui images, and one opacity a tile drew
--            every fade as straight 570 m steps across the sky, 2026-10-29)
--   colour   the colour StormCards shaded the base's down-facing cards with (light, night, rain
--            fog), darker toward the middle where the cloud is thickest, hazed by true distance
--   opacity  fades out over the base's outer half (the billboard rim takes over) and from 30%
--            of the range out, and in the clear slot (Util.slotAt: the RFD's dry band)
-- Billboard deck cards are left out where the tiles are mostly opaque (CardPlan.flatDeckRange)
-- and sit above the tiles' plane where they reach (CardPlan.flatDeckReach); the lumps hanging
-- under the base and the slot's frayed lip stay billboards. Hidden with the "clouds" layer, and
-- when the camera is above the base. Debug attribute on ctx.root: BaseDeckTiles.
local Workspace = game:GetService("Workspace")

local Parts = script.Parent:WaitForChild("CloudParts")
local Util = require(Parts:WaitForChild("Util"))
local CardPlan = require(Parts:WaitForChild("CardPlan"))

local BaseDeck = {}


local function smooth(a: number, b: number, x: number): number
	local t = math.clamp((x - a) / (b - a), 0, 1)
	return t * t * (3 - 2 * t)
end

function BaseDeck.new(ctx: any): any
	local C = ctx.Config
	local D = C.DECK
	if not D or not D.enabled then
		return { update = function() end }
	end
	Util.init(ctx.Sim)
	local range = math.min(D.range, C.LIMITS.partRange - 500)
	-- (billboard deck cards are left out only where the tiles are still mostly opaque, ~0.55 of
	-- the range: CardPlan leaves out cards within flatDeckRange - 1200 m)
	CardPlan.flatDeckRange = 0.9 * range + 1200
	CardPlan.flatDeckReach = range
	CardPlan.flatDeckSteep = D.steep or 1.7
	local folder = Instance.new("Folder")
	folder.Name = "BaseDeck"
	folder.Parent = ctx.root
	local far = CFrame.new(0, -1e5, 0)
	local pool, used = {}, 0
	-- (2026-10-30: solid discs instead of see-through GUI tiles. An opaque part writes depth, so
	-- the billboards under the base - the lowering, scud, funnel top - draw over it per pixel and
	-- the storm's cards above it are hidden by it, as a real base hides the cloud above. Round
	-- discs overlapping on a hex grid give a scalloped cloud edge, not straight tile edges; each
	-- sits a little higher or lower and a shade lighter or darker, so the underside is lumpy and
	-- mottled rather than one plane)
	local DISC_STUDS = 2000
	local Dm = C.metres(DISC_STUDS)
	local S = 0.8 * Dm -- (grid spacing, m)
	CardPlan.flatDeckDisc = Dm
	local ROWH = S * math.sqrt(3) / 2
	local function hash(i: number, j: number, k: number): number
		local h = math.sin(i * 127.1 + j * 311.7 + k * 74.7) * 43758.5453
		return h - math.floor(h)
	end
	local function tile(i: number): any
		local p = pool[i]
		if p then
			return p
		end
		local part = Instance.new("Part")
		part.Anchored, part.CanCollide, part.CanQuery, part.CanTouch = true, false, false, false
		part.CastShadow = false
		part.Shape = Enum.PartType.Cylinder
		-- (Neon: drawn in its own colour, unlit, so it matches the unlit billboard cards it joins;
		-- lit plastic came out neutral grey, 2026-10-30)
		part.Material = D.material or Enum.Material.SmoothPlastic
		part.TopSurface, part.BottomSurface = Enum.SurfaceType.Smooth, Enum.SurfaceType.Smooth
		part.Size = Vector3.new(C.studs(D.thick or 60), DISC_STUDS, DISC_STUDS)
		part.CFrame = far
		-- (the soft edge: the outermost discs are see-through parts showing a soft round cloud on
		-- their underside - unlit, as the cards - so the deck ends in a soft edge, not a hard
		-- scalloped plate, 2026-10-30. The bottom face of the stood-up cylinder is its -x: Left)
		local gui = Instance.new("SurfaceGui")
		gui.Face = Enum.NormalId.Left
		gui.LightInfluence = 0
		gui.MaxDistance = 0
		gui.SizingMode = Enum.SurfaceGuiSizingMode.FixedSize
		gui.CanvasSize = Vector2.new(256, 256)
		gui.Enabled = false
		local img = Instance.new("ImageLabel")
		img.BackgroundTransparency = 1
		img.Size = UDim2.fromScale(1, 1)
		img.Image = C.TEXTURES.deckEdge or ""
		img.Parent = gui
		gui.Parent = part
		part.Parent = folder
		p = { part = part, gui = gui, img = img, on = false, edge = false }
		pool[i] = p
		return p
	end
	local parts, cfs = {}, {}
	local self = {}
	local styleAt = -math.huge
	local UPRIGHT = CFrame.Angles(0, 0, math.pi / 2) -- (a cylinder's axis is its x: stand it up)
	function self:update(_dt: number)
		local decks = ctx.stormDeck
		local cx, cy, cz = ctx:simCamera()
		local show = ctx.state.show.clouds ~= false and decks ~= nil
		local now = ctx:simTime()
		local restyle = os.clock() - styleAt > 0.25
		if restyle then
			styleAt = os.clock()
		end
		local n = 0
		table.clear(parts)
		table.clear(cfs)
		if show then
			for _, d in decks do
				if cz < d.z then
					-- the grid rides with the storm (extrapolated between updates)
					local dt = math.clamp(now - (d.at or now), 0, 5)
					local ox, oy = d.ox + d.u * dt, d.oy + d.v * dt
					local dx, dy = d.x + d.u * dt, d.y + d.v * dt
					local reach = math.min(range, math.sqrt((cx - dx) ^ 2 + (cy - dy) ^ 2) + d.r)
					local j0, j1 = math.floor((cy - reach - oy) / ROWH), math.ceil((cy + reach - oy) / ROWH)
					for j = j0, j1 do
						local shift = if j % 2 == 0 then 0 else 0.5 * S
						local i0, i1 = math.floor((cx - reach - ox - shift) / S), math.ceil((cx + reach - ox - shift) / S)
						for i = i0, i1 do
							local h1, h2, h3 = hash(i, j, 1), hash(i, j, 2), hash(i, j, 3)
							-- (each disc a little off the grid)
							local px = ox + shift + (i + 0.3 * (h1 - 0.5)) * S
							local py = oy + (j + 0.3 * (h2 - 0.5)) * ROWH
							local dc = math.sqrt((px - dx) ^ 2 + (py - dy) ^ 2)
							local dcam = math.sqrt((px - cx) ^ 2 + (py - cy) ^ 2)
							-- (the base out to ~0.85 of its radius - the billboard rim softens its edge
							-- beyond - within range, and not in the clear slot)
							-- (2026-10-30: and only in the steep patch over the camera - up to ~30 deg above the
							-- horizon, D.steep x the base's height out - where billboards stand up as walls.
							-- Out to the whole range the discs' hard edges and flat colour showed as solid
							-- plates from outside the base; lower in the sky the billboard deck reads fine)
							-- (the whole range again: limited to the steep patch overhead, the billboard deck
							-- cards came back 1-5 km out and hung under the base as a wall hiding the
							-- tornado, 2026-10-30. The outer ring of soft edge discs hides the hard edge)
							local rCam = range
							local inside = dc < 0.75 * d.r and dcam < rCam
							-- (how far inside the patch's edge the disc is: within one grid step it is an
							-- edge disc, drawn soft)
							local mEdge = math.min(0.75 * d.r - dc, rCam - dcam)
							-- (none over a wall cloud: its lowering, the funnel's top and their cards
							-- reach up to the base, and a solid disc there hides everything above its
							-- plane - each card cut along a straight level line, the discs' few heights
							-- drawing bands across the funnel and the wall cloud, 2026-10-30. The
							-- lowering covers that patch from below)
							if inside and ctx.wallStreamBase then
								for _, b in ctx.wallStreamBase do
									if b.x and b.r then
										local hole = math.sqrt((px - b.x) ^ 2 + (py - b.y) ^ 2) - (1.15 * b.r + 0.5 * Dm)
										if hole < 0 then
											inside = false
											break
										end
										mEdge = math.min(mEdge, hole)
									end
								end
							end
							if inside and Util.slotAt(d.slot, px - ox, py - oy) < 0.4 then
								n += 1
								local p = tile(n)
								p.on = true
								-- (lumpy: up to ~30 m lower than the base plane, never above it)
								local edge = mEdge < S and (C.TEXTURES.deckEdge or "") ~= ""
								local z = d.z - (D.lump or 30) * h3 + 0.5 * (D.thick or 60)
								if edge then
									-- (edge discs lowest, so their soft underside draws in front of the solid
									-- discs' rims beside them)
									z = d.z - (D.lump or 30) - 5 + 0.5 * (D.thick or 60)
								end
								if p.edge ~= edge then
									p.edge = edge
									p.part.Transparency = if edge then 1 else 0
									p.gui.Enabled = edge
									p.img.ImageColor3 = p.part.Color
								end
								table.insert(parts, p.part)
								table.insert(cfs, CFrame.new(C.toWorld(px, py, z)) * UPRIGHT)
								local key = i * 65536 + j
								if restyle or p.deck ~= d or p.key ~= key then
									p.deck, p.key = d, key
									-- (darker toward the middle where the cloud is thickest; mottled;
									-- hazed by true distance)
									local col = d.col
									local k = (0.8 + 0.2 * math.clamp(dc / d.r, 0, 1)) * (0.92 + 0.16 * h1) * (D.gain or 1)
									col = Color3.new(math.min(col.R * k, 1), math.min(col.G * k, 1), math.min(col.B * k, 1))
									local dz = d.z - cz
									col = Util.quant(Util.mix(col, Util.light.haze, Util.hazeF(math.sqrt(dcam * dcam + dz * dz))))
									if p.col ~= col then
										p.col = col
										p.part.Color = col
										p.img.ImageColor3 = col
									end
								end
							end
						end
					end
				end
			end
		end
		-- park the discs not in use
		for k = n + 1, used do
			local p = pool[k]
			if p and p.on then
				p.on = false
				p.deck = nil
				table.insert(parts, p.part)
				table.insert(cfs, far)
			end
		end
		used = n
		if #parts > 0 then
			Workspace:BulkMoveTo(parts, cfs, Enum.BulkMoveMode.FireCFrameChanged)
		end
		if restyle then
			ctx.root:SetAttribute("BaseDeckTiles", n)
		end
	end
	function self:destroy()
		CardPlan.flatDeckRange = 0
		CardPlan.flatDeckReach = 0
		CardPlan.flatDeckDisc = 0
		folder:Destroy()
	end
	return self
end

return BaseDeck
