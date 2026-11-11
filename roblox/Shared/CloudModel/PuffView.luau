--!strict
-- Visuals prototype 1 (docs/research/PLAN.md stage 2; docs/visuals-research/VOLUMETRIC-RESEARCH.md
-- technique A): a storm's cloud body from its client frame (ClientFrame.luau) as soft billboard
-- puffs lit by script, in place of FrameView's grey cloud boxes. Everything comes from the frame:
--   blocks      the box's columns merged b x b (b the smallest of BLOCKS that keeps the puffs within
--               the budget, opts.max): a block's cloud runs are its columns' lowest base and highest
--               top for each of the two runs, its cover the share of its columns with that run
--   puffs       each run stacked from base to top, one puff every `spacing` metres up (a puff is at
--               most ASPECT times as tall as it is wide on screen, so where the sky scale stretches
--               heights there are more of them), each PUFF_GROW times its spacing so they blend
--   light       how much cloud lies between the puff and the sun (the run heights of the blocks a
--               ray toward the sun crosses, in metres, cover-weighted) dims its sunlight by the
--               two-stream law (SUN_DIFFUSE_PER_M); how much cloud is above it in its own block dims its skylight
--               over SKY_PATH_M; heavy rain under a base darkens it (rain falling through it). The
--               sun is Lighting:GetSunDirection().
--   opacity     cloud is opaque where it is: a block whose columns are cloudy over a share c of it
--               hides what is behind over that share, so its puffs (which overlap, LAYERS deep: the
--               texture's mean opacity times each puff's area over its share of the block) are each
--               1 - (1 - c)^(1 / LAYERS); the blocks a sight line crosses add up, so a deep core seen
--               from under it or edge-on is opaque and a thin, broken edge stays see-through
--               (2026-11-07: at a fixed 0.2 + 0.5 c the low sun's glow showed through a core)
-- No positions are painted: each puff is a block's cloud at a height; the look is the texture, the
-- light and the overlap.
--   local p = PuffView.new(folder, { max = 600, seed = storm id })
--   p:draw(frame, hScale, vScale) -> HUD text     (on each new frame)
--   p:place(ax, groundY, az)                        (each render step: the anchor from FrameView)
--   p:recolour(camPos)                              (each render step: the haze for the camera, once it has moved)
--   p:flash(flashAt)                                (each render step while lightning is live, and once after)
local Lighting = game:GetService("Lighting")
local ClientFrame = require(script.Parent:WaitForChild("ClientFrame")) :: any

local PuffView = {}
PuffView.__index = PuffView

-- the puff texture: workspace attribute CloudLabPuffTexture names one (LabConfig's names), default soft
-- (2026-11-06, seed 2 S0003 in Studio: soft blends into one body; smooth's lobes read as scallops; haze is
-- speckled dots with no body; deck is smooth too but harder-edged)
local TEXTURES = {
	smooth = "rbxassetid://94176229700995", -- smooth dense puff, broad lobes (LabConfig smoothPuffFlat)
	soft = "rbxassetid://116883477687095", -- soft featureless puff (LabConfig softFlat)
	haze = "rbxassetid://72760570308893", -- slow falloff, no disc or rim (LabConfig hazePuffFlat)
	deck = "rbxassetid://138862961385378", -- round soft disc, opaque to 0.20, clear by 0.48 (LabConfig deckSoft)
}
local TEXTURE_NAME = (workspace:GetAttribute("CloudLabPuffTexture") :: string?) or "soft"
if not TEXTURES[TEXTURE_NAME] then TEXTURE_NAME = "soft" end
local TEXTURE = TEXTURES[TEXTURE_NAME]
-- Seeded detail (by storm, block, run and puff: the same every frame and on every client), kept
-- within the frame: a puff moves at most JITTER_ACROSS of its block's width across (so never off its
-- block, where the frame says the cloud is) and JITTER_UP of its spacing up, and its size varies by
-- up to SIZE_VARY; all of it in proportion to how deep and convective its run is (DEEP_M of cloud:
-- a tower gets all of it, a thin anvil or shelf little - anvils are smooth, towers lumpy)
local JITTER_ACROSS, JITTER_UP, SIZE_VARY, DEEP_M = 0.5, 0.5, 0.25, 6000
local ROOT_LO_M, ROOT_HI_M = 2500, 5000 -- a run's base below the first is rooted in the air near the ground; above the second it is spread-out cloud aloft
local COVER_SIZE = 0.5 -- a puff's size: (1 - this + this x its block's cover) of full, so thin blocks are small puffs
local BLOCKS = { 1, 2, 3, 4, 6, 8, 12, 16 }
local ASPECT = 1.5 -- a puff's height at most this times its width (studs)
local PUFF_GROW = 1.8 -- a puff's size against its spacing (they overlap, so neighbours blend; 2.6 until 2026-11-07 smeared the tower, top and anvil into one mass)
local SUN_BLOCK = 4 -- columns a side of the even grid sunlight is traced through
local MIN_SPACING_M = 200
-- Sunlight through cloud: the two-stream diffuse transmission of a multiply scattering cloud,
-- 1 / (1 + 0.75 (1 - g) beta path), asymmetry g 0.85, extinction beta 30 /km (cumulus): half the sun
-- is gone in the outer ~300 m, so a tower's sunlit face stands out from its shaded side. (Until
-- 2026-11-07 exp(-path / 2500 m), under which the lit and shaded sides came out the same grey.)
local SUN_DIFFUSE_PER_M = 0.75 * (1 - 0.85) * 0.030
local SKY_PATH_M = 4000 -- skylight falls to 1/e under this much cloud above
local RAIN_DARK_MMH = 50 -- rain this heavy under a base makes it half as bright
local SUN = Color3.new(1, 0.98, 0.94)
local SKY = Color3.new(0.42, 0.47, 0.56)
local SHADE = Color3.new(0.16, 0.17, 0.2) -- light from below and around: the floor of the shading
local SUN_SHARE, SKY_SHARE = 0.7, 0.3 -- of the light above the floor (they add to 1, so nothing clips)
local TEX_MEAN = 0.375 -- the puff texture's mean opacity over its frame (deck_soft's measured; the soft puff has no script to measure)
local A_MAX = 0.98 -- (a block at full cover: its puffs together this opaque, so a single layer never reads as a hard sheet)

type Block = { base: { number }, top: { number }, cover: { number }, rain: number }

-- The sky's light now as a share of noon's (Lighting attribute SkyLight, set by the game's sky,
-- Render/Sky: falling through dusk to the night's skyglow); 1 where nothing sets it (the cloud lab).
function PuffView.skyLevel(): number
	local v = Lighting:GetAttribute("SkyLight")
	return if type(v) == "number" then math.clamp(v, 0, 1) else 1
end

-- A puff's colour from what lies between it and the light: path (m of cloud toward the sun), above
-- (m of cloud over it, for skylight) and wet (1, or less under heavy rain). Shared with TornadoView
-- and RainView, so a funnel and the rain are lit by the same rule as the base they hang from. The
-- floor (light from below and around) and the skylight are the sky's, so they go with its level; the
-- sunlight is the sun's own (none once it is down: the path toward it is then endless).
function PuffView.light(path: number, above: number, wet: number): Color3
	local sunlit, sky = 1 / (1 + SUN_DIFFUSE_PER_M * path), math.exp(-above / SKY_PATH_M)
	-- (the path toward the sun is the frame's, from where the sun was when it was drawn; once the sun
	-- is down now there is no sunlight whatever the path)
	if Lighting:GetSunDirection().Y <= 0 then sunlit = 0 end
	local lvl = PuffView.skyLevel()
	local function ch(shade: number, sun: number, skyc: number): number
		return (shade * lvl + (1 - shade) * (SUN_SHARE * sun * sunlit + SKY_SHARE * skyc / SKY.B * sky * lvl)) * wet
	end
	return Color3.new(ch(SHADE.R, SUN.R, SKY.R), ch(SHADE.G, SUN.G, SKY.G), ch(SHADE.B, SUN.B, SKY.B))
end
PuffView.TEXTURE = TEXTURE
PuffView.RAIN_DARK_MMH = RAIN_DARK_MMH

-- The air between the camera and anything a storm draws (cloud, rain, funnel - one rule, so they
-- fade together): toward the sky's colour with distance (m across), over the clear air's
-- visibility scale HAZE_KM. Billboards ignore Roblox's Atmosphere, so it is done here.
-- Rain in the way adds its own: rainTau(from, to, toM) is the rain's optical depth on the sight line
-- from the camera to a place (studs; toM its height, m) - set by the game (EngineStormsController),
-- nil where nothing rains - so standing in a core's rain hides the storm round it as it hides the
-- ground, and a curtain between hides what is behind it.
local HAZE_KM = 60
-- (returns the optical depth and the light of that rain: its mean along the sight line, each bit
-- weighted by how much of what the camera sees it is, dtau x e^-tau so far - PuffView.rainLight's)
PuffView.rainTau = nil :: ((Vector3, Vector3, number) -> (number, Color3?))?
local RECOLOUR_M = 300 -- the camera moves this far (m across) before the colours are redone
PuffView.RECOLOUR_M = RECOLOUR_M
-- The frame is a box round the storm; a long anvil or forward flank can run past it. Whatever is
-- drawn fades out over the box's last EDGE_M (by its distance in from the nearest side, at column
-- coordinates gi, gj: 1-based, centres at integers), so the box's edge is never a hard line.
local EDGE_M = 6000
function PuffView.edgeFade(f: any, gi: number, gj: number): number
	local d = math.min(gi - 0.5, f.nx + 0.5 - gi, gj - 0.5, f.ny + 0.5 - gj) * f.dx
	return math.clamp(d / EDGE_M, 0, 1)
end

-- rainCol: the light the rain in the way is lit by (optional; the sky's haze colour without it). Rain
-- under a storm is lit by the dim light under the cloud, so looking through a core darkens what is
-- behind toward that, not toward the clear sky's bright haze (which made curtains seen through rain
-- come out sky-pale, 2026-11-07).
function PuffView.haze(col: Color3, distM: number, tau: number?, rainCol: Color3?): Color3
	local sky = Lighting:FindFirstChildOfClass("Atmosphere")
	local c = if sky then sky.Color else Lighting.FogColor
	col = col:Lerp(c, 1 - math.exp(-distM / (HAZE_KM * 1000)))
	return col:Lerp(rainCol or c, 1 - math.exp(-(tau or 0)))
end

-- The rain's optical depth from the camera to a place (0 without the game's rain), and its light.
function PuffView.rainOn(camPos: Vector3?, at: Vector3, atM: number): (number, Color3?)
	local f = PuffView.rainTau
	if not f or not camPos then return 0, nil end
	return f(camPos, at, atM)
end

-- The light of falling rain (or hail, or snow under the anvil) at a place: rain scatters nearly
-- all the light it meets and in every direction, so it shines with the mean of the light round it.
-- From above: what comes through the cloud it falls from (PuffView.light with the cloud depth over
-- it, dimmed by the rain above it as the base is). From the side: the open sky past the cloud's
-- edge, seen through the gap under the base - a point (base - z) under a base at distance D from
-- its edge sees that sky over elevations up to atan((base - z) / D) across half the horizon, a
-- share atan(...) / 4 of all directions (pi / 8 right at the edge), dimmed by the rain between
-- (tauSide). So a shaft's side facing clear air is grey and its middle and anything under a wide
-- base are dark, as they are in life. The open sky's light is the haze's (the horizon's colour).
-- depth (m of cloud above), rain (mm/h), aboveM (m from z up to the base), edgeM (m to the edge; nil
-- none in reach), tauSide (the rain's optical depth on that way out).
-- From a point under a storm's frame (box metres xm, ym) toward a place (tx, ty: the camera, in
-- box metres) and on past it: how far (m) to the first column with no cloud over it, the cloud's
-- edge on that side (the box's own edge counts; nil none within OPEN_REACH_M), and the rain's
-- optical depth on the way there (the frame's ground rain, 0.16 R^0.74 per km as RainView's).
local OPEN_REACH_M = 40000
local GROUND_ALBEDO = 0.15 -- grass and crops: what the ground under a storm gives back of the light on it
function PuffView.openSide(f: any, xm: number, ym: number, tx: number, ty: number): (number?, number)
	local ddx, ddy = tx - xm, ty - ym
	local len = math.sqrt(ddx * ddx + ddy * ddy)
	if len < 1 then return nil, 0 end
	ddx, ddy = ddx / len, ddy / len
	local tau = 0
	for d = f.dx, OPEN_REACH_M, f.dx do
		local i, j = math.floor((xm + ddx * d) / f.dx) + 1, math.floor((ym + ddy * d) / f.dx) + 1
		if i < 1 or j < 1 or i > f.nx or j > f.ny then return d, tau end
		local cloudy = ClientFrame.byte(f, "top1", i, j) > ClientFrame.byte(f, "base1", i, j) or ClientFrame.byte(f, "top2", i, j) > ClientFrame.byte(f, "base2", i, j)
		if not cloudy then return d, tau end
		-- (hail: a fifth of rain's extinction for the same rate, RainView's HAIL_EXT)
		local r, h = ClientFrame.rateMmh(ClientFrame.byte(f, "rain", i, j)), ClientFrame.rateMmh(ClientFrame.byte(f, "hail", i, j))
		tau += 0.16 * (r ^ 0.74 + 0.2 * h ^ 0.74) * f.dx / 1000
	end
	return nil, tau
end

function PuffView.rainLight(depth: number, rain: number, aboveM: number, edgeM: number?, tauSide: number): Color3
	local sun = Lighting:GetSunDirection()
	local path = if sun.Y <= 0 then math.huge else depth / math.max(sun.Y, 0.05)
	local base = PuffView.light(path, depth, 1 / (1 + rain / RAIN_DARK_MMH))
	-- the light from every direction, by its share of them: the upper half the cloud base (less the
	-- open sky seen past its edge), the lower half the ground under it, lit by that base and
	-- reflecting GROUND_ALBEDO of it. (Until a fix the same day the ground half was left out, and the
	-- rain came out as bright as the base: a pale veil over the storm.)
	local open = if edgeM then math.clamp(math.atan2(math.max(0, aboveM), math.max(1, edgeM)) / 4 * math.exp(-tauSide), 0, 0.5) else 0
	local sky = Lighting:FindFirstChildOfClass("Atmosphere")
	local c = if sky then sky.Color else Lighting.FogColor
	local kb = (0.5 - open) + 0.5 * GROUND_ALBEDO
	return Color3.new(kb * base.R + open * c.R, kb * base.G + open * c.G, kb * base.B + open * c.B)
end

function PuffView.new(folder: Folder, opts: { max: number?, seed: string?, tower: number? })
	local self = setmetatable({}, PuffView) :: any
	self.folder = folder
	self.max = opts.max or 600
	-- the seed of the detail: the storm's id as a number (the same on every client)
	local seed = 0
	for i = 1, #(opts.seed or "") do seed = (seed * 31 + string.byte(opts.seed :: string, i)) % 1000003 end
	self.seed = seed
	self.tower = opts.tower -- (PuffView.vertical)
	self.shape = {} -- (each puff's 3-D shape: PuffView:view)
	local anchor = Instance.new("Part")
	anchor.Name = "PuffAnchor"
	anchor.Anchored, anchor.CanCollide, anchor.CanQuery, anchor.CanTouch = true, false, false, false
	anchor.Transparency, anchor.Size = 1, Vector3.one
	anchor.Parent = folder
	self.anchor = anchor
	self.guis = {} :: { BillboardGui }
	self.shown = 0
	return self
end

local function puff(self: any, k: number): BillboardGui
	local g = self.guis[k]
	if not g then
		g = Instance.new("BillboardGui")
		g.Name = "Puff"
		g.Adornee = self.anchor
		g.LightInfluence = 0
		g.Brightness = 1
		g.ResetOnSpawn = false
		g.ClipsDescendants = false
		local img = Instance.new("ImageLabel")
		img.Name = "I"
		img.Size = UDim2.fromScale(1, 1)
		img.BackgroundTransparency = 1
		img.Image = TEXTURE
		img.Parent = g
		g.Parent = self.folder
		self.guis[k] = g
	end
	return g
end

-- The blocks of size b: { [bi][bj] = Block } and the count of each axis.
local function blocks(f: any, b: number): ({ { Block } }, number, number)
	local nbx, nby = math.ceil(f.nx / b), math.ceil(f.ny / b)
	local out = {}
	for bi = 1, nbx do
		local col = {}
		for bj = 1, nby do
			local base, top, n, rain = { math.huge, math.huge }, { 0, 0 }, { 0, 0 }, 0
			local cells = 0
			for i = (bi - 1) * b + 1, math.min(f.nx, bi * b) do
				for j = (bj - 1) * b + 1, math.min(f.ny, bj * b) do
					cells += 1
					for r = 1, 2 do
						local zb = ClientFrame.cloudM(ClientFrame.byte(f, if r == 1 then "base1" else "base2", i, j))
						local zt = ClientFrame.cloudM(ClientFrame.byte(f, if r == 1 then "top1" else "top2", i, j))
						if zt > zb then
							base[r] = math.min(base[r], zb)
							top[r] = math.max(top[r], zt)
							n[r] += 1
						end
					end
					rain = math.max(rain, ClientFrame.rateMmh(ClientFrame.byte(f, "rain", i, j)))
				end
			end
			col[bj] = { base = base, top = top, cover = { n[1] / cells, n[2] / cells }, rain = rain }
		end
		out[bi] = col
	end
	return out, nbx, nby
end

-- Cloud (m, cover-weighted) at height z in block (bi, bj).
local function cloudAt(g: { { Block } }, bi: number, bj: number, z: number): number
	local c = g[bi] and g[bi][bj]
	if not c then return 0 end
	local s = 0
	for r = 1, 2 do
		if c.cover[r] > 0 and z >= c.base[r] and z <= c.top[r] then s += c.cover[r] end
	end
	return math.min(1, s)
end

-- A block of columns: i0, j0 (1-based first column) and s columns a side; its two cloud runs (lowest
-- base, highest top, cover), its rain, and how much structure it hides - the spread of its runs'
-- tops and bases (m) and its partial cover (an edge) - for whether it is split.
local function leaf(f: any, i0: number, j0: number, s: number): any
	local base, top, n = { math.huge, math.huge }, { 0, 0 }, { 0, 0 }
	local tLo, bHi = { math.huge, math.huge }, { 0, 0 }
	local rain, cells = 0, 0
	for i = i0, math.min(f.nx, i0 + s - 1) do
		for j = j0, math.min(f.ny, j0 + s - 1) do
			cells += 1
			for r = 1, 2 do
				local zb = ClientFrame.cloudM(ClientFrame.byte(f, if r == 1 then "base1" else "base2", i, j))
				local zt = ClientFrame.cloudM(ClientFrame.byte(f, if r == 1 then "top1" else "top2", i, j))
				if zt > zb then
					base[r], top[r] = math.min(base[r], zb), math.max(top[r], zt)
					tLo[r], bHi[r] = math.min(tLo[r], zt), math.max(bHi[r], zb)
					n[r] += 1
				end
			end
			rain = math.max(rain, ClientFrame.rateMmh(ClientFrame.byte(f, "rain", i, j)))
		end
	end
	local cover = { n[1] / math.max(1, cells), n[2] / math.max(1, cells) }
	local spread = 0
	for r = 1, 2 do
		if n[r] > 0 then
			spread += (top[r] - tLo[r]) + (bHi[r] - base[r]) -- (m of height the block's runs hide)
			spread += 4 * cover[r] * (1 - cover[r]) * (top[r] - base[r]) -- (a broken edge hides its outline)
		end
	end
	return { i0 = i0, j0 = j0, s = s, base = base, top = top, cover = cover, rain = rain, spread = spread }
end

-- The vertical scale (2026-11-07). The game draws heights near the camera at the true scale
-- (Config.skyScaleAt) so a cloud base, wall cloud and tornado sit true over the houses, while across
-- the map is squashed to 600 studs a mile (0.37 studs/m): a storm 14 km tall and 60 km wide came out
-- twice as tall as wide (a cube or column; a real one is four times wider). With opts.tower set
-- (studs/m up per stud/m across), heights up to the storm's cloud base stay at V and the cloud above
-- it is drawn at min(V, tower x H), so the tower and anvil keep the storm's own proportions. The base:
-- the lower quartile of the lowest bases of the runs rooted in the air near the ground (ROOT_HI_M;
-- the anvil and decks aloft left out), the frame's own. Without opts.tower, V throughout.
-- Returns the base (m) and the scale above it; self.Vbase is V.
function PuffView.vertical(self: any, f: any, H: number, V: number): (number, number)
	self.Vbase = V
	if not self.tower then return math.huge, V end
	local bases = {}
	for i = 1, f.nx do
		for j = 1, f.ny do
			local zb = ClientFrame.cloudM(ClientFrame.byte(f, "base1", i, j))
			if ClientFrame.cloudM(ClientFrame.byte(f, "top1", i, j)) > zb and zb < ROOT_HI_M then table.insert(bases, zb) end
		end
	end
	if #bases == 0 then return 0, math.min(V, self.tower * H) end
	table.sort(bases)
	return bases[math.max(1, math.floor(#bases / 4))], math.min(V, self.tower * H)
end

-- Heights (m above the ground) to studs and back: V up to ref, Vup above.
function PuffView.heightMap(ref: number, V: number, Vup: number): ((number) -> number, (number) -> number)
	local yr = if ref < math.huge then ref * V else math.huge
	local function Y(z: number): number
		return if z <= ref then z * V else yr + (z - ref) * Vup
	end
	local function Z(y: number): number
		return if y <= yr then y / V else ref + (y - yr) / Vup
	end
	return Y, Z
end

-- The vertical spacing a leaf s columns wide takes, and the puffs it then needs.
local function spacingFor(s: number, f: any, H: number, V: number): number
	return math.max(MIN_SPACING_M, s * f.dx * H * ASPECT / V / PUFF_GROW)
end
local function puffsIn(c: any, sp: number): number
	local n = 0
	for r = 1, 2 do
		if c.cover[r] > 0 then n += math.max(1, math.ceil((c.top[r] - c.base[r]) / sp)) end
	end
	return n
end

local SPLIT = { 1, 2, 4, 8, 16 } -- leaf sizes (columns a side): halving each time
PuffView.SPLIT = SPLIT
PuffView.ASPECT = ASPECT
PuffView.A_MAX = A_MAX
-- The storm's pieces from a frame, for any view that draws them (these billboards, MeshView's
-- meshes): each is one leaf's cloud run at one height, at most `self.max` of them (self.seed seeds
-- the detail). An item: off (studs from the anchor), wS / hS (its size, studs across and up), cellW /
-- cellH (its leaf's width and its share of the run's height, studs: what it stands for), share (how
-- much of what is behind its leaf's cloud hides), lit (its light: path, above, wet, hM, hx, hz), flip
-- (0 or 1, the billboard's turn) and yaw (0..1, seeded). Also the count of leaves by size.
function PuffView.layout(self: any, f: any, H: number, V: number): ({ any }, { [number]: number })
	-- (heights: V studs a metre up to the storm's cloud base, Vup above it - see PuffView.vertical)
	local ref, Vup = PuffView.vertical(self, f, H, V)
	self.Y, self.Z = PuffView.heightMap(ref, V, Vup) -- (the rain and the base deck take the same: EngineStorms)
	local Y = self.Y
	V = Vup -- (the pieces' spacing and size are the tower's; Y places them)
	-- the leaves: start at the smallest of BLOCKS whose even grid still fits the budget (the largest if
	-- none does), then split the leaf hiding the most structure (its spread of heights, times its
	-- width) into four while the budget lasts
	local top0 = SPLIT[#SPLIT]
	for x = #SPLIT, 1, -1 do
		local s = SPLIT[x]
		local n = 0
		for i0 = 1, f.nx, s do
			for j0 = 1, f.ny, s do n += puffsIn(leaf(f, i0, j0, s), spacingFor(s, f, H, V)) end
		end
		if n > self.max then break end
		top0 = s
	end
	local leaves, count = {}, 0
	for i0 = 1, f.nx, top0 do
		for j0 = 1, f.ny, top0 do
			local c = leaf(f, i0, j0, top0)
			if c.cover[1] > 0 or c.cover[2] > 0 then
				table.insert(leaves, c)
				count += puffsIn(c, spacingFor(top0, f, H, V))
			end
		end
	end
	while true do
		local best, bestK = 0, nil
		for kk, c in leaves do
			if c.s > 1 and c.spread * c.s > best then best, bestK = c.spread * c.s, kk end
		end
		if not bestK then break end
		local c = leaves[bestK]
		local hs = c.s // 2
		local kids, add = {}, 0
		for di = 0, 1 do
			for dj = 0, 1 do
				local i0, j0 = c.i0 + di * hs, c.j0 + dj * hs
				if i0 <= f.nx and j0 <= f.ny then
					local k2 = leaf(f, i0, j0, hs)
					if k2.cover[1] > 0 or k2.cover[2] > 0 then
						table.insert(kids, k2)
						add += puffsIn(k2, spacingFor(hs, f, H, V))
					end
				end
			end
		end
		local now = puffsIn(c, spacingFor(c.s, f, H, V))
		if count - now + add > self.max then
			c.spread = 0 -- (no room to split this one; try the next)
		else
			count += add - now
			leaves[bestK] = leaves[#leaves]
			leaves[#leaves] = nil
			for _, k2 in kids do table.insert(leaves, k2) end
		end
	end
	-- sunlight through an even grid (SUN_BLOCK columns a block), so the shading doesn't depend on the split
	local sb = math.max(1, math.min(SUN_BLOCK, top0))
	local g, nbx, nby = blocks(f, sb)
	local Lg = sb * f.dx
	local sun = Lighting:GetSunDirection()
	local hz = math.sqrt(sun.X * sun.X + sun.Z * sun.Z)
	local ex, ey = if hz > 1e-3 then sun.X / hz else 0, if hz > 1e-3 then -sun.Z / hz else 0 -- east, north
	local rise = if hz > 1e-3 then Lg * sun.Y / hz else math.huge -- metres up a step
	local stepLen = if hz > 1e-3 then Lg / hz else Lg
	local below = sun.Y <= 0
	local items = {}
	local sizes = {}
	for _, c in leaves do
		local s = c.s
		sizes[s] = (sizes[s] or 0) + 1
		local L = s * f.dx -- the leaf's width (m)
		local spacing = spacingFor(s, f, H, V)
		local ci, cj = c.i0 - 1 + s / 2, c.j0 - 1 + s / 2 -- its centre (columns from the box's corner)
		for r = 1, 2 do
			if c.cover[r] > 0 then
				local zb, zt = c.base[r], c.top[r]
				local n = math.max(1, math.ceil((zt - zb) / spacing))
				local h = (zt - zb) / n
				-- (how convective the run is: deep, and rising from the air near the ground - its base at
				-- that air's condensation level. A base high aloft is cloud that has spread out from a
				-- tower, the anvil: stratiform and smooth however thick. Until 2026-11-07 depth alone,
				-- so the 5 km thick anvil came out as lumpy as the tower.)
				local rooted = 1 - math.clamp((zb - ROOT_LO_M) / (ROOT_HI_M - ROOT_LO_M), 0, 1)
				local deep = math.clamp((zt - zb) / DEEP_M, 0, 1) * rooted * rooted * (3 - 2 * rooted)
				for q = 0, n - 1 do
					local z = zb + (q + 0.5) * h
					local rnd = Random.new(self.seed + c.i0 * 7919 + c.j0 * 104729 + s * 31 + r * 1299709 + q * 15485863)
					local jx, jy, jz = (rnd:NextNumber() - 0.5) * JITTER_ACROSS * deep, (rnd:NextNumber() - 0.5) * JITTER_ACROSS * deep, (rnd:NextNumber() - 0.5) * JITTER_UP * deep
					local px, py = ci + jx * s, cj + jy * s -- (columns from the box's corner)
					-- sunlight: cloud along the ray toward the sun, through the even grid
					local path = 0
					if below then
						path = math.huge
					elseif rise < math.huge then
						local x, y, zz = px / sb + 0.5, py / sb + 0.5, z
						for _ = 1, 64 do
							x += ex; y += ey; zz += rise
							if zz > 16000 or x < 0.5 or y < 0.5 or x > nbx + 0.5 or y > nby + 0.5 then break end
							path += stepLen * cloudAt(g, math.floor(x + 0.5), math.floor(y + 0.5), zz)
						end
						path += 0.5 * h * c.cover[r] * stepLen / Lg
					else
						path = (zt - z) * c.cover[r]
					end
					-- skylight: cloud above it in its own leaf
					local above = (zt - z) * c.cover[r]
					if r == 1 and c.cover[2] > 0 then above += (c.top[2] - c.base[2]) * c.cover[2] end
					-- rain falling through the base
					local wet = if q == 0 and r == 1 then 1 / (1 + c.rain / RAIN_DARK_MMH) else 1
					local grow = PUFF_GROW * (1 - COVER_SIZE + COVER_SIZE * c.cover[r]) * (1 + SIZE_VARY * deep * (2 * rnd:NextNumber() - 1))
					local wS, hS = L * H * grow, h * V * grow
					local off = Vector3.new((px * f.dx - f.anchorX) * H, Y(z + jz * h), -(py * f.dx - f.anchorY) * H)
					table.insert(items, {
						off = off, wS = wS, hS = math.min(hS, wS * ASPECT), cellW = L * H, cellH = h * V,
						share = math.min(A_MAX, c.cover[r] * PuffView.edgeFade(f, px + 0.5, py + 0.5)),
						lit = { path = path, above = above, wet = wet, off = off, hM = z + jz * h, hx = L / 2, hz = h / 2, dist = 0 },
						-- (the billboard's flip, 0 or 180 degrees so its oval stays level, by leaf and height, so a
						-- grid of puffs isn't one blob repeated; a mesh's turn about the vertical: the look only,
						-- where and how big stays the frame's)
						flip = (c.i0 * 73 + c.j0 * 151 + q * 37 + r * 11) % 2,
						runBase = zb, -- (m: its run's base, and how rooted the run is near the ground, 0..1)
						rooted = rooted,
						yaw = rnd:NextNumber(),
					})
				end
			end
		end
	end
	return items, sizes
end

-- A storm's body in a few large pieces (2026-11-07, the user: under ~20 meshes a storm, oriented to
-- look convincing; the wall cloud and tornado are the main feature). The frame's cloud volume - each
-- block's two runs, sampled every CLUSTER_DZ up, weighted by cover - is grouped into n lumps by
-- weighted k-means in drawn space (studs, with the tower's vertical scale), and each lump is one piece:
-- at its centre, turned about the vertical along its spread's long axis, sized by its spread across
-- (both axes) and up. So a tower comes out tall, an anvil long and flat along its own drift, a base
-- wide and low - nothing placed by kind. Items as PuffView.layout's, plus size (studs, x along its
-- long axis, y up, z across) and yaw (0..1 turn). Lit as the puffs: the cloud on the way to the sun
-- through the same even grid, the cloud above its centre, the rain under its base.
local CLUSTER_DZ = 800 -- m between samples up a run
local CLUSTER_ITERS = 10
local CLUSTER_FILL = 2 * math.sqrt(3) * 1.15 -- a lump's size: its spread's full width (an even spread's) and some overlap
function PuffView.clusters(self: any, f: any, H: number, V: number, n: number): { any }
	local ref, Vup = PuffView.vertical(self, f, H, V)
	self.Y, self.Z = PuffView.heightMap(ref, V, Vup)
	local Y = self.Y
	local B = math.max(1, math.ceil(math.max(f.nx, f.ny) / 20))
	local g, nbx, nby = blocks(f, B)
	local L = B * f.dx
	-- the samples
	local px, py, pz, pw, pm, pr, pb = {}, {}, {}, {}, {}, {}, {}
	for bi = 1, nbx do
		for bj = 1, nby do
			local c = g[bi][bj]
			for r = 1, 2 do
				if c.cover[r] > 0 then
					local zb, zt = c.base[r], c.top[r]
					local k = math.max(1, math.ceil((zt - zb) / CLUSTER_DZ))
					local h = (zt - zb) / k
					for q = 0, k - 1 do
						local z = zb + (q + 0.5) * h
						local xm, ym = (bi - 0.5) * L, (bj - 0.5) * L
						table.insert(px, (xm - f.anchorX) * H)
						table.insert(py, Y(z))
						table.insert(pz, -(ym - f.anchorY) * H)
						table.insert(pw, c.cover[r] * h)
						table.insert(pm, z)
						table.insert(pr, if q == 0 and r == 1 then c.rain else 0)
						table.insert(pb, zb)
					end
				end
			end
		end
	end
	local N = #px
	if N == 0 then return {} end
	n = math.min(n, N)
	-- k-means++ seeding (seeded), then weighted Lloyd steps
	local rnd = Random.new(self.seed)
	local cx, cy, cz = {}, {}, {}
	do
		local tot = 0
		for i = 1, N do tot += pw[i] end
		local pick, acc = rnd:NextNumber() * tot, 0
		local first = N
		for i = 1, N do
			acc += pw[i]
			if acc >= pick then first = i; break end
		end
		cx[1], cy[1], cz[1] = px[first], py[first], pz[first]
		local d2 = table.create(N, math.huge)
		for k = 2, n do
			local sum = 0
			for i = 1, N do
				local dx, dy, dz = px[i] - cx[k - 1], py[i] - cy[k - 1], pz[i] - cz[k - 1]
				local d = dx * dx + dy * dy + dz * dz
				if d < d2[i] then d2[i] = d end
				sum += d2[i] * pw[i]
			end
			local at, run, chosen = rnd:NextNumber() * sum, 0, N
			for i = 1, N do
				run += d2[i] * pw[i]
				if run >= at then chosen = i; break end
			end
			cx[k], cy[k], cz[k] = px[chosen], py[chosen], pz[chosen]
		end
	end
	local own = table.create(N, 1)
	for _ = 1, CLUSTER_ITERS do
		for i = 1, N do
			local best, bk = math.huge, 1
			for k = 1, n do
				local dx, dy, dz = px[i] - cx[k], py[i] - cy[k], pz[i] - cz[k]
				local d = dx * dx + dy * dy + dz * dz
				if d < best then best, bk = d, k end
			end
			own[i] = bk
		end
		local sx, sy, sz, sw = table.create(n, 0), table.create(n, 0), table.create(n, 0), table.create(n, 0)
		for i = 1, N do
			local k, w = own[i], pw[i]
			sx[k] += px[i] * w; sy[k] += py[i] * w; sz[k] += pz[i] * w; sw[k] += w
		end
		for k = 1, n do
			if sw[k] > 0 then cx[k], cy[k], cz[k] = sx[k] / sw[k], sy[k] / sw[k], sz[k] / sw[k] end
		end
	end
	-- each lump's spread, light and base
	local W, xx, xz, zz, yy, hm, rain, base, cov, cnt = {}, {}, {}, {}, {}, {}, {}, {}, {}, {}
	for k = 1, n do W[k], xx[k], xz[k], zz[k], yy[k], hm[k], rain[k], base[k], cov[k], cnt[k] = 0, 0, 0, 0, 0, 0, 0, math.huge, 0, 0 end
	for i = 1, N do
		local k, w = own[i], pw[i]
		local dx, dy, dz = px[i] - cx[k], py[i] - cy[k], pz[i] - cz[k]
		W[k] += w
		xx[k] += w * dx * dx; xz[k] += w * dx * dz; zz[k] += w * dz * dz; yy[k] += w * dy * dy
		hm[k] += w * pm[i]
		rain[k] = math.max(rain[k], pr[i])
		base[k] = math.min(base[k], pb[i])
		cnt[k] += 1
	end
	local sun = Lighting:GetSunDirection()
	local hz = math.sqrt(sun.X * sun.X + sun.Z * sun.Z)
	local ex, ey = if hz > 1e-3 then sun.X / hz else 0, if hz > 1e-3 then -sun.Z / hz else 0
	local rise = if hz > 1e-3 then L * sun.Y / hz else math.huge
	local stepLen = if hz > 1e-3 then L / hz else L
	local items = {}
	for k = 1, n do
		if W[k] > 0 then
			local a, b, c = xx[k] / W[k], xz[k] / W[k], zz[k] / W[k]
			-- the horizontal spread's axes (2 x 2 eigen): the long one's heading and both spreads
			local tr, det = a + c, a * c - b * b
			local disc = math.sqrt(math.max(0, tr * tr / 4 - det))
			local l1, l2 = tr / 2 + disc, math.max(0, tr / 2 - disc)
			local ang = 0.5 * math.atan2(2 * b, a - c)
			-- (one sample's own block at least: a lump of one block is that block)
			local minW = L * H
			local sizeX = math.max(minW, CLUSTER_FILL * math.sqrt(l1))
			local sizeZ = math.max(minW, CLUSTER_FILL * math.sqrt(l2))
			local sizeY = math.max(CLUSTER_DZ * V * 0.5, CLUSTER_FILL * math.sqrt(yy[k] / W[k]))
			local off = Vector3.new(cx[k], cy[k], cz[k])
			local zM = hm[k] / W[k]
			-- light: the cloud toward the sun from its centre, the cloud above it in its centre's block
			local xm, ym = cx[k] / H + f.anchorX, -cz[k] / H + f.anchorY
			local bi, bj = math.clamp(math.floor(xm / L) + 1, 1, nbx), math.clamp(math.floor(ym / L) + 1, 1, nby)
			local path = 0
			if sun.Y <= 0 then
				path = math.huge
			elseif rise < math.huge then
				local x, y, zz2 = xm / L + 0.5, ym / L + 0.5, zM
				for _ = 1, 64 do
					x += ex; y += ey; zz2 += rise
					if zz2 > 16000 or x < 0.5 or y < 0.5 or x > nbx + 0.5 or y > nby + 0.5 then break end
					path += stepLen * cloudAt(g, math.floor(x + 0.5), math.floor(y + 0.5), zz2)
				end
			end
			local cb = g[bi][bj]
			local above = 0
			for r = 1, 2 do
				if cb.cover[r] > 0 then above += math.max(0, cb.top[r] - math.max(zM, cb.base[r])) * cb.cover[r] end
			end
			local rooted = 1 - math.clamp((base[k] - ROOT_LO_M) / (ROOT_HI_M - ROOT_LO_M), 0, 1)
			table.insert(items, {
				off = off, size = Vector3.new(sizeX, sizeY, sizeZ), yaw = -ang / (2 * math.pi),
				wS = math.max(sizeX, sizeZ), hS = sizeY, cellW = math.max(sizeX, sizeZ), cellH = sizeY,
				share = A_MAX, runBase = base[k], rooted = rooted,
				lit = { path = path, above = above, wet = 1 / (1 + rain[k] / RAIN_DARK_MMH), off = off, hM = zM,
					hx = 0.5 * math.max(sizeX, sizeZ) / H, hz = 0.5 * sizeY / V, dist = 0 },
			})
		end
	end
	return items
end

function PuffView:draw(f: any, H: number, V: number): string
	local t0 = os.clock()
	local items, sizes = PuffView.layout(self, f, H, V)
	self.lit = {}
	self.H = H
	local k = 0
	for _, it in items do
		k += 1
		local p = puff(self, k)
		p.Size = UDim2.fromScale(it.wS, it.hS)
		p.StudsOffsetWorldSpace = it.off
		p.Enabled = true
		local img = p:FindFirstChild("I") :: ImageLabel
		self.lit[k] = it.lit
		local layers = math.max(1, TEX_MEAN * (it.wS / it.cellW) * (it.hS / it.cellH))
		local T0 = (1 - it.share) ^ (1 / layers)
		img.ImageTransparency = T0
		img.Rotation = it.flip * 180
		-- (its 3-D shape for PuffView:view: width and height in studs, and its transparency seen side-on)
		self.shape[k] = { w = it.wS, h = it.hS, T0 = T0, off = it.off, H = -1, T = T0 }
	end
	for x = k + 1, self.shown do self.guis[x].Enabled = false; self.shape[x] = nil end
	self.shown = k
	self.camAt = nil
	self.lvlAt = nil
	self.viewAt = nil
	local cam = workspace.CurrentCamera
	self:recolour(if cam then cam.CFrame.Position else nil)
	local mix = {}
	for _, s in SPLIT do if sizes[s] then table.insert(mix, ("%dx%d"):format(sizes[s], s)) end end
	return ("puffs %d of %d (%s, leaves %s)  built in %.1f ms"):format(k, self.max, TEXTURE_NAME, table.concat(mix, " "), (os.clock() - t0) * 1000)
end

-- Lightning's light in the cloud: a flash lights the cloud round it from inside (the shared flash
-- field, flashAt(x, z, hM) -> 0..2 at a place in studs across and metres up; 1 is a nearby flash's
-- full light, falling off over a few km as the cloud scatters it). It adds to the puff's own light
-- in the flash's bluish white, before the haze, so a far flash is dimmed by the air like the cloud.
local FLASH = Color3.new(0.85, 0.88, 1)
local FLASH_MIN = 0.01
local FLASH_GAIN = 2 -- (the flash field's light on the cloud, doubled 2026-11-07 after a night play-test)
PuffView.FLASH = FLASH

-- A light (Color3) with lightning's added, each channel at most 1.
function PuffView.flashed(col: Color3, fl: number): Color3
	if fl <= 0 then return col end
	fl *= FLASH_GAIN
	return Color3.new(math.min(1, col.R + FLASH.R * fl), math.min(1, col.G + FLASH.G * fl), math.min(1, col.B + FLASH.B * fl))
end

local function shade(self: any, k: number, L: any)
	local img = self.guis[k]:FindFirstChild("I") :: ImageLabel
	img.ImageColor3 = PuffView.haze(PuffView.flashed(PuffView.light(L.path, L.above, L.wet), L.flash or 0), L.dist, L.tau, L.rainCol)
end

-- Whether colours want redoing: the camera has moved RECOLOUR_M across, or the sky's light has
-- changed by LEVEL_STEP (dusk, or the first sky update after a frame came) - (moved, level now).
local LEVEL_STEP = 0.01
function PuffView.stale(self: any, camPos: Vector3?): (boolean, boolean)
	local lvl = PuffView.skyLevel()
	local moved = not (camPos and self.camAt and ((camPos - self.camAt) * Vector3.new(1, 0, 1)).Magnitude < RECOLOUR_M * self.H)
	local up = Lighting:GetSunDirection().Y > 0
	local dimmed = self.lvlAt == nil or math.abs(lvl - self.lvlAt) >= LEVEL_STEP or up ~= self.upAt
	if dimmed then self.lvlAt, self.upAt = lvl, up end
	return moved, dimmed
end

-- Each puff's light for the sky now, hazed for where the camera is (redone once it has moved
-- RECOLOUR_M across, or the sky's light has changed).
function PuffView:recolour(camPos: Vector3?)
	if not self.lit or not self.H then return end
	local moved, dimmed = PuffView.stale(self, camPos)
	if not moved and not dimmed then return end
	if moved then self.camAt = camPos end
	for k, L in self.lit do
		if moved then
			L.dist = if camPos then ((self.anchor.Position + L.off - camPos) * Vector3.new(1, 0, 1)).Magnitude / self.H else 0
			L.tau, L.rainCol = PuffView.rainOn(camPos, self.anchor.Position + L.off, L.hM)
		end
		shade(self, k, L)
	end
end

-- The flashes' light on each puff now (each render step while one is live; once more after, to put
-- back the puffs they lit). Only puffs a flash reaches, or reached last step, are recoloured.
function PuffView:flash(flashAt: (number, number, number, number, number) -> number): (number, number)
	if not self.lit then return 0, 0 end
	local most, n = 0, 0
	local a = self.anchor.Position
	for k, L in self.lit do
		local fl = flashAt(a.X + L.off.X, a.Z + L.off.Z, L.hM, L.hx, L.hz) -- (at its block's nearest point to each flash)
		if fl > FLASH_MIN or L.flash then
			L.flash = if fl > FLASH_MIN then fl else nil
			shade(self, k, L)
		end
		if fl > FLASH_MIN then n += 1 end
		if fl > most then most = fl end
	end
	return most, n -- (the brightest flash light on a puff now, and how many it reaches)
end

function PuffView:place(ax: number, groundY: number, az: number)
	self.anchor.CFrame = CFrame.new(ax, groundY, az)
end

-- Each puff as the 3-D cloud it stands for (2026-11-07, docs/visuals/RENDER-PLAN-2026-11.md): a
-- puff is an ellipsoid w studs across and h up, but a billboard always stands upright at one size,
-- so a flat base or anvil puff was a thin band even straight overhead and the sky showed between
-- them. Here, from the sight line to it (its elevation, |dy| of the unit vector), its height on
-- screen is the ellipsoid's outline seen that way, sqrt((w dy)^2 + h^2 (1 - dy^2)) - a band from the
-- side, a disc from below - and its opacity follows the chord through it, the cloud's own path
-- (Beer-Lambert: transparency T0^(chord / side-on chord)), so a thin layer is fainter from below than
-- edge-on. Both depend only on where the camera is, never on where it looks, so turning the camera
-- changes nothing; they change smoothly as it moves. Redone once the camera has moved VIEW_STEP studs,
-- each puff written only when it changes by VIEW_EPS.
local VIEW_STEP, VIEW_EPS = 2, 0.01
function PuffView:view(camPos: Vector3?)
	if not camPos or not self.shape then return end
	local a = self.anchor.Position
	local rel = camPos - a -- (the camera from the storm: the storm moves too)
	if self.viewAt and (rel - self.viewAt).Magnitude < VIEW_STEP then return end
	self.viewAt = rel
	for k = 1, self.shown do
		local s = self.shape[k]
		if s then
			local d = a + s.off - camPos
			local len = d.Magnitude
			local dy = if len > 1e-3 then math.abs(d.Y) / len else 0
			local dh2 = 1 - dy * dy
			local Hs = math.sqrt((s.w * dy) ^ 2 + s.h * s.h * dh2)
			-- (the chord through the centre against the side-on one: 1 / sqrt(dy^2 / c^2 + dh^2 / a^2) over a)
			local ra, rc = 0.5 * s.w, 0.5 * s.h
			local ratio = 1 / (ra * math.sqrt(dy * dy / (rc * rc) + dh2 / (ra * ra)))
			local T = s.T0 ^ ratio
			local g = self.guis[k]
			if math.abs(Hs - s.H) > VIEW_EPS * s.H then
				s.H = Hs
				g.Size = UDim2.fromScale(s.w, Hs)
			end
			if math.abs(T - s.T) > VIEW_EPS then
				s.T = T;
				(g:FindFirstChild("I") :: ImageLabel).ImageTransparency = T
			end
		end
	end
end

function PuffView:destroy()
	self.anchor:Destroy()
	for _, g in self.guis do g:Destroy() end
end

return PuffView
