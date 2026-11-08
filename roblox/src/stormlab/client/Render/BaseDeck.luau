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
	-- (2026-10-30: solid discs instead of see-through GUI tiles. An opaque part writes depth, so
	-- the billboards under the base - the lowering, scud, funnel top - draw over it per pixel and
	-- the storm's cards above it are hidden by it, as a real base hides the cloud above. Round
	-- discs overlapping on a hex grid give a scalloped cloud edge, not straight tile edges; each
	-- sits a little higher or lower and a shade lighter or darker, so the underside is lumpy and
	-- mottled rather than one plane)
	local DISC_STUDS = 2000
	local Dm = C.metres(DISC_STUDS)
	-- (grid spacing, m. Soft discs sit on the grid exactly (JIT 0) and draw deck_soft (opaque to 0.20
	-- of the frame, clear by 0.48), so their overlapping layer adds up nearly even. Modelled (coverage
	-- of overlapping discs on the hex grid, mean 0.7): deck_edge (opaque to 0.30) at 0.8 left the
	-- point between three discs clear; at 0.67 with each disc 0.3 of a step off the grid, spots down
	-- to 0.08 - round shapes and paler gaps from below; at 0.70 on the grid, 0.60-0.80 - darker spots
	-- where three discs overlap. deck_soft at 0.60: 0.68-0.73, 2026-10-31)
	local S = (if D.solid then 0.8 else 0.60) * Dm
	local JIT = if D.solid then 0.3 else 0
	local SOFT_TEX = if D.solid then (C.TEXTURES.deckEdge or "") else (C.TEXTURES.deckSoft or C.TEXTURES.deckEdge or "")
	-- (how many soft discs deep the layer is on average: the texture's mean opacity over its frame -
	-- deck_edge ~0.5, deck_soft ~0.375 - over a grid cell)
	local MEAN_A = if D.solid or not C.TEXTURES.deckSoft then 0.5 else 0.375
	local LAYERS = MEAN_A * Dm * Dm / (S * S * math.sqrt(3) / 2)
	CardPlan.flatDeckDisc = Dm
	CardPlan.flatDeckSolid = D.solid == true
	local ROWH = S * math.sqrt(3) / 2
	local function hash(i: number, j: number, k: number): number
		local h = math.sin(i * 127.1 + j * 311.7 + k * 74.7) * 43758.5453
		return h - math.floor(h)
	end
	-- a disc part (pooled: free discs are parked far below)
	local function newTile(): any
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
		img.Image = SOFT_TEX
		img.Parent = gui
		gui.Parent = part
		part.Parent = folder
		return { part = part, gui = gui, img = img }
	end
	-- a down-facing base card standing in at a point (storm-local m): the light, sky light, albedo
	-- and opacity of the cards nearest it, weighted by distance beyond the nearest card's (so
	-- the nearest always count, however far - the cards start only where the discs stop); light
	-- fields by each card's opacity too. Shaded by StormCards' own card function, so a disc is what
	-- a base card in its place would be (nil: no cards to go by)
	local SIG = 1500
	local stand = { nx = 0, ny = 0, nz = -1, lit = 1, sky = 1, albedo = 1, z = 0 }
	local function standIn(d: any, lx: number, ly: number): (any, number)
		local smp = d.samples
		if not smp or #smp == 0 then
			return nil, 1
		end
		local m = math.huge
		for _, s in smp do
			local q = (s[1] - lx) ^ 2 + (s[2] - ly) ^ 2
			if q < m then
				m = q
			end
		end
		local k2 = 1 / (2 * SIG * SIG)
		local lit, sky, alb, kw, a, k = 0, 0, 0, 0, 0, 0
		for _, s in smp do
			local w = math.exp(-((s[1] - lx) ^ 2 + (s[2] - ly) ^ 2 - m) * k2)
			local wa = w * s[6]
			lit += s[3] * wa
			sky += s[4] * wa
			alb += s[5] * wa
			kw += wa
			a += s[6] * w
			k += w
		end
		if kw <= 0 then
			return nil, 1
		end
		stand.lit, stand.sky, stand.albedo, stand.z = lit / kw, sky / kw, alb / kw, d.z -- (at the disc's own height)
		return stand, math.clamp(a / math.max(k, 1e-6), 0, 1)
	end
	local parts, cfs = {}, {}
	-- discs by grid cell (storm id, i, j): a cell keeps its disc while it stays in the patch, and
	-- discs fade in and out (FADE s). (Dealt from a pool in order each frame, they popped and swapped
	-- colour whenever one ahead of them in the list came or went, 2026-10-31)
	local live, free = {}, {}
	local FADE = 0.8
	local self = {}
	local styleAt = -math.huge
	local UPRIGHT = CFrame.Angles(0, 0, math.pi / 2) -- (a cylinder's axis is its x: stand it up)
	local function setType(p: any, edge: boolean)
		p.edge = edge
		p.gui.Enabled = edge
		p.tr = nil
	end
	function self:update(dt: number)
		local decks = ctx.stormDeck
		local cx, cy, cz = ctx:simCamera()
		local show = ctx.state.show.clouds ~= false and decks ~= nil
		local now = ctx:simTime()
		local restyle = os.clock() - styleAt > 0.25
		if restyle then
			styleAt = os.clock()
		end
		local fadeStep = math.min(dt or 0, 0.25) / FADE
		table.clear(parts)
		table.clear(cfs)
		for _, p in live do
			p.seen = false
		end
		if show then
			for id, d in decks do
				if cz < d.z then
					-- the grid rides with the storm (extrapolated between updates)
					-- (StormCards republishes every 0.25 s real: 15 s of sim at 60x. Capped at 5 s the
					-- grid stood still 2/3 of the time and jumped ~110 m, 2026-10-31)
					local dt2 = math.clamp(now - (d.at or now), 0, 120)
					local ox, oy = d.ox + d.u * dt2, d.oy + d.v * dt2
					local dx, dy = d.x + d.u * dt2, d.y + d.v * dt2
					-- (the game: drawn about the storm's anchor at its scale, LabConfig.stormAnchor; the
					-- discs over the camera are those drawn over it - the camera's place brought into
					-- the storm's own metres, kh / k nearer the anchor. The lab: as it is)
					local aX, aY = C.stormAnchor(id, dx, dy)
					local ka = C.scaleAbout(aX, aY)
					local fk = if C.anchorFn then C.frame.kh / ka else 1
					local ccx, ccy = aX + (cx - aX) * fk, aY + (cy - aY) * fk
					local reach = math.min(range, math.sqrt((ccx - dx) ^ 2 + (ccy - dy) ^ 2) + d.r)
					-- this storm's live wall cloud (Render/WallStream), for the hole below
					local wsAll = ctx.wallStreamBase
					local wb = wsAll and wsAll[tostring(id)]
					if not wb and wsAll then
						local best = (1.5 * d.r) ^ 2
						for _, b in wsAll do
							local d2 = (b.x - dx) ^ 2 + (b.y - dy) ^ 2
							if b.r and d2 < best then
								best, wb = d2, b
							end
						end
					end
					if wb and not wb.r then
						wb = nil
					end
					local j0, j1 = math.floor((ccy - reach - oy) / ROWH), math.ceil((ccy + reach - oy) / ROWH)
					for j = j0, j1 do
						local shift = if j % 2 == 0 then 0 else 0.5 * S
						local i0, i1 = math.floor((ccx - reach - ox - shift) / S), math.ceil((ccx + reach - ox - shift) / S)
						for i = i0, i1 do
							local h1, h2, h3 = hash(i, j, 1), hash(i, j, 2), hash(i, j, 3)
							-- (solid discs a little off the grid; soft ones on it, JIT)
							local px = ox + shift + (i + JIT * (h1 - 0.5)) * S
							local py = oy + (j + JIT * (h2 - 0.5)) * ROWH
							local dc = math.sqrt((px - dx) ^ 2 + (py - dy) ^ 2)
							local dcam = math.sqrt((px - ccx) ^ 2 + (py - ccy) ^ 2)
							-- (the base out to ~0.75 of its radius - the billboard rim softens its edge
							-- beyond - within range, and not in the clear slot. 2026-10-30: limited to the
							-- steep patch overhead, the billboard deck cards came back 1-5 km out and hung
							-- under the base as a wall hiding the tornado; the outer ring of soft edge discs
							-- hides the hard edge)
							local rCam = range
							local inside = dc < 0.75 * d.r and dcam < rCam
							-- (how far inside the patch's edge the disc is: within two grid steps it is an
							-- edge disc, drawn soft)
							local mEdge = math.min(0.75 * d.r - dc, rCam - dcam)
							-- (none over a wall cloud: its lowering, the funnel's top and their cards
							-- reach up to the base, and a solid disc there hides everything above its
							-- plane - each card cut along a straight level line, 2026-10-30. The
							-- lowering covers that patch from below)
							-- (the hole the storm's card plan left - StormCards' g.hole, riding with the
							-- storm as its cards do - so the cards fill exactly where the discs are not)
							-- (and only where the live wall cloud is under it too: the cards re-plan every few
							-- seconds, the wall cloud moves at once - onto the funnel at touchdown, back off it
							-- when the tornado lifts - and the part of the planned hole it had left showed sky,
							-- a pale crescent under the base, 2026-11-02. Cut where both leave room, the deck
							-- covers wherever the cards or the lowering don't)
							local hb = d.hole
							if inside and hb then
								local hole = math.sqrt((px - (ox + hb.dx)) ^ 2 + (py - (oy + hb.dy)) ^ 2) - (1.15 * hb.r + 0.5 * Dm)
								if wb then
									hole = math.max(hole, math.sqrt((px - wb.x) ^ 2 + (py - wb.y) ^ 2) - (1.15 * wb.r + 0.5 * Dm))
								end
								if hole < 0 then
									inside = false
								end
								mEdge = math.min(mEdge, hole)
							end
							local sv = if inside then Util.slotAt(d.slot, px - ox, py - oy) else 1
							if inside and sv < 0.4 then
								-- (beside the clear slot too: a solid disc there ended the base in a hard
								-- many-sided outline against the slot's paler sky, 2026-10-31)
								-- (two discs deep: one ring let the outer solid discs' rims show between its soft discs as
								-- a hard scalloped outline, 2026-10-31)
								-- (DECK.solid false: every disc soft - the solid ones met the see-through cards
								-- round them as hard dark ovals however their colour matched, 2026-10-31)
								local edge = (not D.solid or mEdge < 2 * S or sv > 0.12) and SOFT_TEX ~= ""
								local key = tostring(id) .. ":" .. i .. ":" .. j
								local p = live[key]
								if not p then
									p = table.remove(free) or newTile()
									live[key] = p
									p.fade, p.col, p.alpha = 0, nil, nil
									setType(p, edge)
								end
								p.seen = true
								p.wantEdge = edge
								-- (lumpy: up to ~30 m lower than the base plane, never above it; edge discs
								-- lowest, so their soft underside draws in front of the solid discs' rims)
								local z = if p.edge
									then d.z - (D.lump or 30) - 5 + 0.5 * (D.thick or 60)
									else d.z - (D.lump or 30) * h3 + 0.5 * (D.thick or 60)
								p.cf = CFrame.new(C.toWorldAbout(px, py, z, aX, aY, ka)) * UPRIGHT
								local shade = ctx.stormShade
								if (restyle or not p.col) and shade and shade.card then
									-- shaded as a base card in its place (ctx.stormShade.card: light, haze,
									-- rain fog) and as see-through as the cards near it. Solid discs (lit
									-- Neon parts) keep their brightness factor and stay opaque
									-- (and the disc layer as opaque as the card layer near it: A, the cards' opacity,
									-- is what the overlapping discs add up to, ~LAYERS deep, so each disc is
									-- 1 - (1 - A)^(1 / LAYERS). Each at A drew its outline where discs overlapped;
									-- each opaque, a black plate against the see-through cards, 2026-10-31)
									local card, A = standIn(d, px - ox, py - oy)
									local alpha = 1 - (1 - math.min(A, 0.98)) ^ (1 / LAYERS)
									local col
									if card then
										local camPos = Vector3.new(cx, cy, cz)
										col = shade.card(card, px, py, camPos, shade.light(), 0, d.fog or 0, d.base or d.z, d.dist or 1e4)
									else
										col = d.col
									end
									if not p.edge then
										local k = (D.gain or 1) * (0.92 + 0.16 * h1)
										col = Color3.new(math.min(col.R * k, 1), math.min(col.G * k, 1), math.min(col.B * k, 1))
										alpha = 1
									end
									p.alpha = if p.alpha then p.alpha + 0.35 * (alpha - p.alpha) else alpha
									-- (eased: the cards near it come and go, and the colour followed them in steps)
									if p.col then
										col = p.col:Lerp(col, 0.35)
									end
									if not p.col or (col.R - p.col.R) ^ 2 + (col.G - p.col.G) ^ 2 + (col.B - p.col.B) ^ 2 > 1e-6 then
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
		-- fade in what is wanted and out what is not (a disc changing kind fades out, switches, fades
		-- back in); park the ones gone
		local n = 0
		for key, p in live do
			local want = p.seen
			if p.seen and p.wantEdge ~= p.edge then
				want = false
				if p.fade <= 0 then
					setType(p, p.wantEdge)
					want = true
				end
			end
			p.fade = math.clamp(p.fade + (if want then fadeStep else -fadeStep), 0, 1)
			if p.fade <= 0 and not p.seen then
				live[key] = nil
				table.insert(free, p)
				p.gui.Enabled = false
				table.insert(parts, p.part)
				table.insert(cfs, far)
			else
				n += 1
				local tr = 1 - p.fade * (if p.edge then (p.alpha or 1) else 1)
				if math.abs((p.tr or -1) - tr) > 0.004 then
					p.tr = tr
					if p.edge then
						p.part.Transparency = 1
						p.img.ImageTransparency = tr
					else
						p.part.Transparency = tr
					end
				end
				table.insert(parts, p.part)
				table.insert(cfs, p.cf or far)
			end
		end
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
		CardPlan.flatDeckSolid = false
		folder:Destroy()
	end
	return self
end

return BaseDeck
