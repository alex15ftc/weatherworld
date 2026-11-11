--!strict
-- Rain and hail shafts from a storm's client frame (ClientFrame: the rain and hail planes, mm/h at
-- the ground - the engine's falling particles, js/storms/StormStructure.js), as columns of soft lit
-- billboard puffs - the cloud's own way of drawing (PuffView). How shafts look from kilometres away
-- is from docs/visuals-research/RAIN-AND-HAIL-AT-DISTANCE.md. Nothing is placed or tinted by hand:
--   field       the frame's rain and hail rates, smoothed (three [1 2 1] passes each way, ~1.7
--               columns) so the columns never show as a picket fence
--   curtains    on a jittered lattice of spacing s (the smallest that keeps the puffs within
--               opts.max), each WIDTH s wide - many overlap at any point, as a real shaft is a volume
--   slant       rain falls slanting: from each height it has drifted with the storm-relative wind
--               over its fall (the frame's drift block, ClientFrame.driftAt), so its way up from a
--               curtain's ground point runs back along that drift, and each puff stands where the shaft
--               is at its height. Rain and hail each at their own fall speed (hail falls 3x faster: a
--               steeper column inside the rain's slanting veil)
--   top         where that way up first runs into cloud (the tower, the anvil or the stratiform deck),
--               TOP_IN_M up into it; a curtain whose way up meets no cloud is not drawn. Frames without
--               the drift block (the cloud model's): the lowest base within SOURCE_COLS, straight up
--   opacity     the rain's optical depth: extinction 0.16 R^0.74 per km (R mm/h; lidar fit), per
--               unit of path; each curtain stands for path s, shared by the curtains overlapping
--               it across (the puffs' soft profile), so the total through the shaft is rate x path -
--               thick in the middle, thinning to nothing at the edge. Hail: sparse large stones, a
--               fifth of rain's extinction for the same rate. One curtain is at most ALPHA_ONE opaque,
--               so a core goes opaque only where several overlap and each keeps its soft edges
--   kinds       rain and hail each their own curtains, from their own rates: rain a wide soft veil,
--               hail a narrower column inside it
--   light       PuffView.rainLight: what comes through the cloud above (its depth over the shaft,
--               dimmed by its own rain) and the open sky seen sideways under the base, on the side the
--               camera looks at (PuffView.openSide: how far to the cloud's edge that way, and the rain
--               in between) - a shaft's flank facing clear air is grey, its middle and anything under
--               a wide base dark. Brighter where the sun is behind it and reaches it (large drops
--               scatter forward); hail most, the only time it looks white. Then the haze and the rain in
--               front (PuffView.haze, the cloud's rule)
-- Puffs: a column of soft round puffs, each ASPECT x as tall as wide at most (taller where a curtain
-- would need more than PER_CURTAIN), overlapping by half, the lowest standing FOOT_AT of its height
-- up so the shaft reaches the ground (its lower edge goes into it), the top inside the cloud. A
-- billboard faces the camera whichever way it looks, so a column of round puffs never turns or
-- stretches as the camera turns. (Until 2026-11-07 near curtains were world-fixed Part tiles, each a
-- slice of one tall texture; Roblox sorts see-through objects whole, so each tile drew entirely in
-- front of or behind the cloud's puffs and its straight edges showed across the storm.)
--   local r = RainView.new(folder, { max = 600, seed = id })   (max: puffs)
--   r:draw(frame, H, V, camPos?) -> HUD text     (on each new frame)
--   r:place(ax, groundY, az, terrainAt?)        (each render step: the anchor from FrameView)
--   r:recolour(camPos)                          (each render step: redone once the camera has moved)
--   r:rainAt(xm, ym) -> mm/h, hail share         (box metres: the rate at a point, for the rain round the camera)
local Lighting = game:GetService("Lighting")
local ClientFrame = require(script.Parent:WaitForChild("ClientFrame")) :: any
local PuffView = require(script.Parent:WaitForChild("PuffView")) :: any

local RainView = {}
RainView.__index = RainView

RainView.TEXTURE = PuffView.TEXTURE
local MIN_MMH = 0.5 -- the smoothed rate below which nothing is drawn
local WIDTH = 2.5 -- a curtain is this many lattice spacings wide
local JITTER = 0.6 -- seeded offset (spacings) and width spread
local TOP_IN_M = 250 -- a curtain reaches this far up into the cloud it falls from
local SOURCE_COLS = 3 -- the rain's cloud: the lowest base and the deepest cloud this many columns round it
local HAIL_EXT = 0.2 -- hail's extinction per mm/h as a share of rain's (sparse large stones)
local HAIL_MIN_MMH = 0.5 -- the smoothed hail rate below which no hail curtain is drawn
local HAIL_WIDTH = 1.4 -- a hail curtain's width in lattice spacings (hail falls fast and straight, so its
                       -- shaft is a narrower column inside the rain's veil)
local HAIL_SHINE = 0.7 -- how far sunlit hail goes toward white (stones reflect the sun to the side as
                       -- well as forward; in the cloud's shadow it is as grey as the rain)
local SCATTER = 0.6 -- rain's forward-scatter gain (sun behind the shaft and reaching it); hail has its own (HAIL_SHINE)
local ALPHA_ONE = 0.3 -- one curtain's most opacity (see the header)
local ASPECT = 2 -- a puff's height at most this times its width...
local PER_CURTAIN = 7 -- ...unless a curtain would then need more puffs than this
local FOOT_AT = 0.3 -- the lowest puff's centre, as a share of its height above the ground
local TEX_MEAN = 0.375 -- the puff texture's mean opacity over its frame (PuffView's)
local FOOT_MOVE = 4 -- studs the ground under a curtain changes before its puffs are refitted
local SIDE_AT = 1 / 3 -- the height (share of the way up to the base) a curtain is lit for from the side

local function extinction(mmh: number): number -- per metre
	return if mmh > 0 then 0.16 * mmh ^ 0.74 / 1000 else 0
end

function RainView.new(folder: Folder, opts: { max: number?, seed: string? })
	local self = setmetatable({}, RainView) :: any
	self.folder = folder
	self.max = opts.max or 600
	local seed = 0
	for c in (opts.seed or ""):gmatch(".") do seed = (seed * 31 + string.byte(c)) % 2147483647 end
	self.seed = seed
	local anchor = Instance.new("Part")
	anchor.Name = "RainAnchor"
	anchor.Anchored, anchor.CanCollide, anchor.CanQuery, anchor.CanTouch = true, false, false, false
	anchor.Transparency, anchor.Size = 1, Vector3.one
	anchor.Parent = folder
	self.anchor = anchor
	self.guis = {} :: { BillboardGui }
	self.curtains = {} :: { any }
	self.shown = 0
	self.frame = nil
	return self
end

local function puff(self: any, k: number): BillboardGui
	local g = self.guis[k]
	if not g then
		g = Instance.new("BillboardGui")
		g.Name = "Rain"
		g.Adornee = self.anchor
		g.LightInfluence = 0
		g.Brightness = 1
		g.ResetOnSpawn = false
		g.ClipsDescendants = false
		local img = Instance.new("ImageLabel")
		img.Name = "I"
		img.Size = UDim2.fromScale(1, 1)
		img.BackgroundTransparency = 1
		img.Image = RainView.TEXTURE
		img.Parent = g
		g.Parent = self.folder
		self.guis[k] = g
	end
	return g
end

-- A curtain topS studs tall and wS wide: its puffs' height, count, lowest and highest centres.
local function shape(topS: number, wS: number): (number, number, number, number)
	local hS = math.max(ASPECT * wS, 2 * topS / PER_CURTAIN)
	local c0, c1 = FOOT_AT * hS, topS - 0.35 * hS
	if c1 <= c0 then
		hS = topS / (FOOT_AT + 0.35)
		return hS, 1, FOOT_AT * hS, FOOT_AT * hS
	end
	return hS, 1 + math.ceil((c1 - c0) / (0.5 * hS)), c0, c1
end

-- The frame's rain and hail (mm/h, smoothed), and per column the cloud the rain there falls from:
-- the lowest base (m; 0 none) and the deepest cloud (m) within SOURCE_COLS.
local function fields(f: any)
	local nx, ny = f.nx, f.ny
	local rain, hail, base, depth = table.create(nx * ny, 0), table.create(nx * ny, 0), table.create(nx * ny, 0), table.create(nx * ny, 0)
	local runs = { table.create(nx * ny, math.huge), table.create(nx * ny, -1), table.create(nx * ny, math.huge), table.create(nx * ny, -1) }
	for i = 1, nx do
		for j = 1, ny do
			local c = (j - 1) * nx + i
			rain[c] = ClientFrame.rateMmh(ClientFrame.byte(f, "rain", i, j))
			hail[c] = ClientFrame.rateMmh(ClientFrame.byte(f, "hail", i, j))
			local d, lo = 0, 0
			for q, r in { { "base1", "top1" }, { "base2", "top2" } } do
				local zb = ClientFrame.cloudM(ClientFrame.byte(f, r[1], i, j))
				local zt = ClientFrame.cloudM(ClientFrame.byte(f, r[2], i, j))
				if zt > zb then
					runs[2 * q - 1][c], runs[2 * q][c] = zb, zt
					d += zt - zb
					if lo == 0 or zb < lo then lo = math.max(zb, 1) end
				end
			end
			base[c], depth[c] = lo, d
		end
	end
	local K = { 0.25, 0.5, 0.25 }
	local function blur(src: { number }): { number }
		local a = src
		for _ = 1, 3 do
			local b = table.create(nx * ny, 0)
			for j = 1, ny do
				for i = 1, nx do
					local s = 0
					for d = -1, 1 do s += K[d + 2] * a[(j - 1) * nx + math.clamp(i + d, 1, nx)] end
					b[(j - 1) * nx + i] = s
				end
			end
			local c2 = table.create(nx * ny, 0)
			for j = 1, ny do
				for i = 1, nx do
					local s = 0
					for d = -1, 1 do s += K[d + 2] * b[(math.clamp(j + d, 1, ny) - 1) * nx + i] end
					c2[(j - 1) * nx + i] = s
				end
			end
			a = c2
		end
		return a
	end
	local srcBase, srcDepth = table.create(nx * ny, 0), table.create(nx * ny, 0)
	for j = 1, ny do
		for i = 1, nx do
			local lo, m = 0, 0
			for b = math.max(1, j - SOURCE_COLS), math.min(ny, j + SOURCE_COLS) do
				for a = math.max(1, i - SOURCE_COLS), math.min(nx, i + SOURCE_COLS) do
					local c = (b - 1) * nx + a
					if base[c] > 0 and (lo == 0 or base[c] < lo) then lo = base[c] end
					m = math.max(m, depth[c])
				end
			end
			srcBase[(j - 1) * nx + i], srcDepth[(j - 1) * nx + i] = lo, m
		end
	end
	return blur(rain), blur(hail), { srcBase = srcBase, srcDepth = srcDepth, depth = depth, b1 = runs[1], t1 = runs[2], b2 = runs[3], t2 = runs[4] }
end

-- Where the rain reaching the ground at box metres (xm, ym), falling at v m/s, left its cloud: the
-- height (m) its way up first runs into cloud and that column's cloud depth (m); 0, 0 none. Its way up
-- is back along the drift (ClientFrame.driftAt: the storm-relative wind over its fall), the column it
-- is over at each height and its neighbours (the fall's own turbulence). Frames without the drift
-- block (the cloud model's): the lowest base within SOURCE_COLS, straight up, as before.
local function sourceOf(f: any, xm: number, ym: number, v: number, F: any): (number, number)
	local nx, ny, dx = f.nx, f.ny, f.dx
	if not f.drift then
		local c = (math.clamp(math.floor(ym / dx) + 1, 1, ny) - 1) * nx + math.clamp(math.floor(xm / dx) + 1, 1, nx)
		return F.srcBase[c], F.srcDepth[c]
	end
	for _, L in f.drift.levels do
		local h = L[1]
		local ox, oy = ClientFrame.driftAt(f, h, v)
		local ci, cj = math.floor((xm - ox) / dx) + 1, math.floor((ym - oy) / dx) + 1
		if ci < 1 or cj < 1 or ci > nx or cj > ny then break end -- (fell from outside the box)
		local c = (cj - 1) * nx + ci
		if (F.b1[c] <= h and h <= F.t1[c]) or (F.b2[c] <= h and h <= F.t2[c]) then return math.max(h, 1), F.depth[c] end
	end
	return 0, 0
end

-- bilinear in column units (1-based, centres at integers)
local function sample(t: { number }, nx: number, ny: number, gi: number, gj: number): number
	gi, gj = math.clamp(gi, 1, nx), math.clamp(gj, 1, ny)
	local i0, j0 = math.max(1, math.min(math.floor(gi), nx - 1)), math.max(1, math.min(math.floor(gj), ny - 1))
	local i1, j1 = math.min(i0 + 1, nx), math.min(j0 + 1, ny)
	local fx, fy = math.clamp(gi - i0, 0, 1), math.clamp(gj - j0, 0, 1)
	local a, b = t[(j0 - 1) * nx + i0], t[(j0 - 1) * nx + i1]
	local c, d = t[(j1 - 1) * nx + i0], t[(j1 - 1) * nx + i1]
	return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy
end

-- The rate (mm/h, rain + hail) and hail share at box metres (xm, ym) of the last frame.
function RainView:rainAt(xm: number, ym: number): (number, number)
	local f = self.frame
	if not f or not self.rain then return 0, 0 end
	local gi, gj = xm / f.dx + 0.5, ym / f.dx + 0.5
	if gi < 0.5 or gj < 0.5 or gi > f.nx + 0.5 or gj > f.ny + 0.5 then return 0, 0 end
	local r = sample(self.rain, f.nx, f.ny, gi, gj)
	local h = sample(self.hail, f.nx, f.ny, gi, gj)
	return r + h, if r + h > 0 then h / (r + h) else 0
end

-- Curtain C's puffs for the ground rel studs over the anchor's (its top staying at the cloud base:
-- the frame's heights are over the anchor's ground).
local function layout(self: any, C: any, rel: number)
	C.footY = rel
	local topS = math.max(0.2 * C.topS, C.topS - rel)
	local hS, n, c0, c1 = shape(topS, C.wS)
	n = math.min(n, C.n) -- (never more than were counted for the budget)
	local sp = if n > 1 then (c1 - c0) / (n - 1) else hS
	local a = 1 - (1 - C.A) ^ (1 / math.max(1, TEX_MEAN * hS / sp))
	C.a = a
	for q = 0, C.n - 1 do
		local g = self.guis[C.k0 + q]
		if q < n then
			local rnd = Random.new(C.seed + q * 7919)
			local jx, jz = (rnd:NextNumber() - 0.5) * 0.3 * C.wS, (rnd:NextNumber() - 0.5) * 0.3 * C.wS
			g.Size = UDim2.fromScale(C.wS, hS)
			-- (each puff where the shaft is at its height: the ground point less the drift over its fall)
			local yS = c0 + q * sp
			local ox, oy = ClientFrame.driftAt(self.frame, self.Z(yS), C.fall)
			g.StudsOffsetWorldSpace = Vector3.new(C.off.X + jx - ox * self.H, rel + yS, C.off.Z + jz + oy * self.H)
			local img = g:FindFirstChild("I") :: ImageLabel
			img.ImageTransparency = 1 - a * (C.near or 1)
			img.Rotation = ((C.k0 + q) % 2) * 180
			g.Enabled = true
		else
			g.Enabled = false
		end
	end
end

function RainView:draw(f: any, H: number, V: number, camPos: Vector3?): string
	local t0 = os.clock()
	self.frame = f
	local rain, hail, F = fields(f)
	local srcBase = F.srcBase
	self.rain, self.hail = rain, hail
	self.H, self.V = H, V
	-- (dataOnly: the rates only, for rainAt - no curtains: the game's card storms, the user's ask
	-- for no rain curtains, 2026-11-07)
	if self.dataOnly then
		for k = 1, (self.shown or 0) do
			local g = self.guis and self.guis[k]
			if g then g.Enabled = false end
		end
		self.curtains = {}
		return "rain: rates only"
	end
	-- heights to studs and back: the cloud body's map when the caller sets heights (PuffView.heightMap:
	-- the tower drawn at its own scale above the storm's base), else V throughout
	local Y = if self.heights then self.heights.Y else function(z: number): number return z * V end
	self.Z = if self.heights then self.heights.Z else function(y: number): number return y / V end
	local nx, ny = f.nx, f.ny
	-- the lattice: the smallest spacing (columns) whose curtains' puffs fit the budget
	local wet = 0
	for c = 1, nx * ny do if rain[c] + hail[c] >= MIN_MMH and (f.drift or srcBase[c] > 0) then wet += 1 end end
	local step = math.max(1, math.sqrt(wet * 4 / self.max))
	local pts = {}
	for _ = 1, 6 do
		pts = {}
		local rng = Random.new(self.seed)
		local gj = 1
		while gj <= ny do
			local gi = 1
			while gi <= nx do
				local pi = gi + JITTER * step * (rng:NextNumber() - 0.5)
				local pj = gj + JITTER * step * (rng:NextNumber() - 0.5)
				local wv = 1 + JITTER * (rng:NextNumber() - 0.5)
				local r, h = sample(rain, nx, ny, pi, pj), sample(hail, nx, ny, pi, pj)
				local c = (math.clamp(math.round(pj), 1, ny) - 1) * nx + math.clamp(math.round(pi), 1, nx)
				if r + h >= MIN_MMH then
					local xm, ym = (pi - 0.5) * f.dx, (pj - 0.5) * f.dx
					local rz, rd = sourceOf(f, xm, ym, ClientFrame.rainFallMs(r), F)
					local hz, hd = 0, 0
					if h >= HAIL_MIN_MMH then hz, hd = sourceOf(f, xm, ym, if f.drift then f.drift.hailFallMs else 1, F) end
					if rz > 0 or hz > 0 then table.insert(pts, { pi, pj, r, h, wv, c, rz, rd, hz, hd }) end
				end
				gi += step
			end
			gj += step
		end
		local n = 0
		for _, p in pts do
			if p[3] >= MIN_MMH and p[7] > 0 then
				local _, m = shape(Y(p[7] + TOP_IN_M), WIDTH * step * f.dx * p[5] * H)
				n += m
			end
			if p[4] >= HAIL_MIN_MMH and p[9] > 0 then
				local _, m = shape(Y(p[9] + TOP_IN_M), HAIL_WIDTH * step * f.dx * p[5] * H)
				n += m
			end
		end
		if n <= self.max then break end
		step *= math.sqrt(n / self.max) * 1.05
	end
	local s = step * f.dx -- spacing (m)
	local sun = Lighting:GetSunDirection()
	local k, peak, nHail = 0, 0, 0
	self.curtains = {}
	-- one curtain of a kind (rain or hail) at a lattice point, from that kind's own rate
	local function emit(p: { any }, isHail: boolean, amt: number)
		local pi, pj, wv = p[1], p[2], p[5]
		local zb, dep = if isHail then p[9] else p[7], if isHail then p[10] else p[8]
		if zb <= 0 then return end
		local top = zb + TOP_IN_M
		local width = if isHail then HAIL_WIDTH else WIDTH
		local w = width * s * wv
		local wS, topS = w * H, Y(top)
		local _, n = shape(topS, wS)
		if k + n > self.max then return end
		-- optical depth: this curtain's share of the path s through its shaft (its own kind's rate)
		local tau = (if isHail then HAIL_EXT * extinction(amt) else extinction(amt)) * s / (0.5 * width * wv)
		tau *= PuffView.edgeFade(f, pi, pj) -- (thinning out near the box's edge, as the cloud does)
		local xm, ym = (pi - 0.5) * f.dx, (pj - 0.5) * f.dx
		local C = {
			hail = isHail, xm = xm, ym = ym, top = top, dep = dep, rate = p[3] + p[4],
			fall = if isHail then (if f.drift then f.drift.hailFallMs else 1) else ClientFrame.rainFallMs(amt),
			wS = wS, topS = topS, n = n, k0 = k + 1, A = ALPHA_ONE * (1 - math.exp(-tau)),
			off = Vector3.new((xm - f.anchorX) * H, 0, -(ym - f.anchorY) * H),
			seed = self.seed + math.floor(pi * 131 + pj * 977) + (if isHail then 17 else 0),
			reach = if sun.Y <= 0 then 0 else math.exp(-dep / math.max(sun.Y, 0.05) / 1500),
		}
		for q = 1, n do puff(self, k + q) end
		k += n
		table.insert(self.curtains, C)
		layout(self, C, 0)
		if isHail then nHail += 1 end
	end
	for _, p in pts do
		local r, h = p[3], p[4]
		peak = math.max(peak, r + h)
		if r >= MIN_MMH then emit(p, false, r) end
		if h >= HAIL_MIN_MMH then emit(p, true, h) end
	end
	for x = k + 1, self.shown do self.guis[x].Enabled = false end
	self.shown = k
	self.camAt = nil
	self.lvlAt = nil
	self:recolour(camPos)
	return ("rain curtains %d (%d hail, every %.1f km), puffs %d of %d  peak %.0f mm/h  built in %.1f ms"):format(#self.curtains, nHail, s / 1000, k, self.max, peak, (os.clock() - t0) * 1000)
end

-- Each curtain's light for where the camera is (PuffView.stale: redone once it has moved, or the
-- sky's light has changed): PuffView.rainLight with its side toward the camera, forward scatter when
-- the sun is behind it, then the haze and the rain in front.
function RainView:recolour(camPos: Vector3?)
	local f = self.frame
	if not f or not self.H then return end
	local H = self.H
	local moved, dimmed = PuffView.stale(self, camPos)
	if not moved and not dimmed then return end
	if moved then self.camAt = camPos end
	camPos = self.camAt
	local sun = Lighting:GetSunDirection()
	local sunFlat = Vector3.new(sun.X, 0, sun.Z)
	local a = self.anchor.Position
	local cx, cy = if camPos then (camPos.X - a.X) / H + f.anchorX else f.anchorX, if camPos then -(camPos.Z - a.Z) / H + f.anchorY else f.anchorY
	for _, C in self.curtains do
		local edge, tauSide = PuffView.openSide(f, C.xm, C.ym, cx, cy)
		local col = PuffView.rainLight(C.dep, if C.hail then 0 else C.rate, (1 - SIDE_AT) * C.top, edge, tauSide)
		local dist, tau, front = 0, 0, nil
		if camPos then
			local at = a + C.off
			local toward = (at - camPos) * Vector3.new(1, 0, 1)
			dist = toward.Magnitude / H
			tau, front = PuffView.rainOn(camPos, at, 0) -- (the rain in front of the curtain, and its light)
			if toward.Magnitude > 0 and sunFlat.Magnitude > 0 and sun.Y > 0 then
				local behind = math.max(0, toward.Unit:Dot(sunFlat.Unit))
				if C.hail then
					-- hail: white where the sun reaches it, from the side as well as behind
					col = col:Lerp(Color3.new(1, 1, 1), math.clamp(HAIL_SHINE * C.reach * (0.35 + 0.65 * behind * behind), 0, HAIL_SHINE))
				else
					-- rain: only forward scatter, with the sun behind the shaft and reaching it
					col = col:Lerp(Color3.new(1, 1, 1), math.clamp(SCATTER * behind ^ 4 * C.reach, 0, 0.5))
				end
			end
		end
		col = PuffView.haze(col, dist, tau, front)
		-- (the camera inside a curtain's own width: that rain is round it, already in the haze through the
		-- rain on every sight line - rainTau - so the curtain fades out toward its middle rather than
		-- being drawn again as a sheet across the whole view)
		C.near = if camPos then math.clamp(dist / (0.5 * C.wS / H), 0, 1) else 1
		for q = 0, C.n - 1 do
			local img = self.guis[C.k0 + q]:FindFirstChild("I") :: ImageLabel
			img.ImageColor3 = col
			img.ImageTransparency = 1 - C.a * C.near
		end
	end
end

-- terrainAt(x, z) -> studs or nil (optional, EngineStormsController): each curtain then stands on the
-- ground under itself, its top staying at the cloud's base, so curtains kilometres off neither sink
-- into a hill nor float over a valley.
function RainView:place(ax: number, groundY: number, az: number, terrainAt: ((number, number) -> number?)?)
	local at = Vector3.new(ax, groundY, az)
	self.anchor.CFrame = CFrame.new(at)
	if not terrainAt then return end
	for _, C in self.curtains do
		local centre = at + C.off
		local rel = (terrainAt(centre.X, centre.Z) or groundY) - groundY
		if math.abs(rel - C.footY) > FOOT_MOVE then layout(self, C, rel) end
	end
end

function RainView:destroy()
	self.anchor:Destroy()
	for _, g in self.guis do g:Destroy() end
end

return RainView
