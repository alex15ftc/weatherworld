--!strict
-- A barebones view of one storm's client frame (ClientFrame.luau): grey boxes, a debug and test
-- drawing, not the game's look (that is still to be chosen). Used by the cloudlab's live mode
-- (client/LiveView.client.luau, on its tabletop) and the main game's live storms
-- (Client/Controllers/LiveStormsController.luau, full scale). Everything drawn is a model field:
--   cloud runs     each column's two lowest cloud runs, grey boxes
--   rain shafts    ground rain from the ground to the cloud base (2 km where there is none), more
--                  opaque as it is heavier, whiter where it is hail
--   nest (near frames): the lowest cloud below 3 km at 250 m spacing, dark (wall cloud,
--                  lowerings; in near-saturated air also rain-fog down to the ground, which is
--                  cloud too), and below it the condensation lowered by the pressure drop: air
--                  expanding into the low condenses at the same pressure, so about drop / (rho g),
--                  12 Pa a metre, further down (a funnel, where the drop is deep enough to show)
--   tornado (the frame's tornado block, ClientFrame.readTornado): vertical cylinders, nothing
--                  shaped here - the funnel from the cloud base down to its tip, each slice on the
--                  model's centre at that height (the lean) at the block's condensation radius;
--                  below the tip (a funnel not down) the wind core, radius R, faint; and at the
--                  ground a flat ring out to where the core's wind falls to EF0 (65 mph) by the
--                  Rankine profile v = mph R / r: r = R mph / 65, the damage width. Its widths
--                  are at the height scale (vScale), as the game draws a tornado's widths
--                  (Config.TORNADO_SHARE_OF_SKY 1: a funnel keeps its shape); where it stands and
--                  leans, across, at hScale like everything else's position
-- Placing: parts are drawn from the frame's anchor (the point at the engine storm's position).
-- The anchor moves on at the storm's motion between frames, and the jump to where a new frame
-- puts it eases out over EASE_S (setAnchor, place).
--   local v = FrameView.new(folder, { hScale = studs per metre across, vScale = studs per metre up,
--                                     noClouds = true to leave the cloud runs to another view })
--   v:setAnchor(x, z, ux, uz)   studs, and studs per real second (on each new frame)
--   v:draw(frame, near)         returns a line for a HUD
--   v:place(groundY)            each render step
local ClientFrame = require(script.Parent:WaitForChild("ClientFrame")) :: any

local FrameView = {}
FrameView.__index = FrameView

local PA_PER_M = 12 -- rho g near the ground
local FUNNEL_MIN_M = 20 -- a lowering shallower than this is not drawn
local EASE_S = 2 -- the time over which a new frame's position correction eases out
local SNAP_STUDS_PER_M = 5000 -- a correction bigger than 5 km is a jump, not eased

local function part(name: string, color: Color3): Part
	local p = Instance.new("Part")
	p.Name = name
	p.Anchored = true
	p.CanCollide = false
	p.CanQuery = false
	p.CanTouch = false
	p.CastShadow = false
	p.Material = Enum.Material.SmoothPlastic
	p.Color = color
	p.TopSurface = Enum.SurfaceType.Smooth
	p.BottomSurface = Enum.SurfaceType.Smooth
	return p
end

-- A pool of parts per kind, reused frame to frame (unused ones hidden). rel: each part's position
-- from the anchor (studs; y from the ground).
-- turn: drawn upright as cylinders (a cylinder part's length is along its x; Size x is the height)
type Pool = { folder: Folder, parts: { Part }, used: number, shown: number, color: Color3, name: string, rel: { Vector3 }, turn: CFrame? }
local UPRIGHT = CFrame.Angles(0, 0, math.pi / 2)
local function pool(folder: Folder, name: string, color: Color3, cylinder: boolean?): Pool
	return { folder = folder, parts = {}, used = 0, shown = 0, color = color, name = name, rel = {}, turn = if cylinder then UPRIGHT else nil }
end
local function take(p: Pool, rel: Vector3): Part
	p.used += 1
	p.rel[p.used] = rel
	local x = p.parts[p.used]
	if not x then
		x = part(p.name, p.color)
		if p.turn then x.Shape = Enum.PartType.Cylinder end
		x.Parent = p.folder
		p.parts[p.used] = x
	end
	return x
end
local function finish(p: Pool)
	for k = p.used + 1, #p.parts do p.parts[k].Transparency = 1 end
	p.shown = p.used
	p.used = 0
end

function FrameView.new(folder: Folder, opts: { hScale: number, vScale: number, noClouds: boolean?, noRain: boolean?, noTornado: boolean? })
	local self = setmetatable({}, FrameView) :: any
	self.folder = folder
	self.noClouds = opts.noClouds == true
	self.noRain = opts.noRain == true -- (the rain shafts left out: to see a tornado inside the rain)
	self.noTornado = opts.noTornado == true -- (its cylinders left out, the HUD line kept: TornadoView draws it)
	self.hScale, self.vScale = opts.hScale, opts.vScale
	self.pools = {
		pool(folder, "Cloud", Color3.new(0.92, 0.92, 0.95)),
		pool(folder, "Rain", Color3.fromRGB(70, 110, 200)),
		pool(folder, "Wall", Color3.fromRGB(85, 88, 96)),
		pool(folder, "Funnel", Color3.fromRGB(70, 70, 76)),
		pool(folder, "TornadoFunnel", Color3.fromRGB(58, 58, 64), true),
		pool(folder, "TornadoCore", Color3.fromRGB(200, 60, 60), true),
		pool(folder, "TornadoRing", Color3.fromRGB(150, 110, 70), true),
	}
	-- the anchor: at (ox, oz) when set (at, os.clock), moving (ux, uz) a second, plus a correction
	-- (cx, cz) easing out
	self.ox, self.oz, self.ux, self.uz, self.at, self.cx, self.cz, self.shown = 0, 0, 0, 0, 0, 0, 0, false
	self.partsList, self.cframes = {}, {}
	return self
end

function FrameView:anchorAt(t: number): (number, number)
	local age = t - self.at
	local ease = math.exp(-age / EASE_S)
	return self.ox + self.ux * age + self.cx * ease, self.oz + self.uz * age + self.cz * ease
end

function FrameView:setAnchor(x: number, z: number, ux: number, uz: number)
	local now = os.clock()
	local cx, cz = 0, 0
	if self.shown then
		local sx, sz = self:anchorAt(now)
		cx, cz = sx - x, sz - z
		local snap = SNAP_STUDS_PER_M * self.hScale
		if cx * cx + cz * cz > snap * snap then cx, cz = 0, 0 end
	end
	self.ox, self.oz, self.ux, self.uz, self.at, self.cx, self.cz, self.shown = x, z, ux, uz, now, cx, cz, true
end

function FrameView:draw(f: any, near: boolean): string
	local H, V = self.hScale, self.vScale
	local clouds, rain, wall, funnel = self.pools[1], self.pools[2], self.pools[3], self.pools[4]
	local s = f.dx * H
	-- box metres -> studs from the anchor (y north is -z)
	local function at(xm: number, ym: number): (number, number)
		return (xm - f.anchorX) * H, -(ym - f.anchorY) * H
	end
	local cloudCols, rainMax, lowest = 0, 0, math.huge
	for j = 1, f.ny do
		for i = 1, f.nx do
			local x, z = at((i - 0.5) * f.dx, (j - 0.5) * f.dx)
			local base1 = ClientFrame.cloudM(ClientFrame.byte(f, "base1", i, j))
			local top1 = ClientFrame.cloudM(ClientFrame.byte(f, "top1", i, j))
			for r = 1, 2 do
				local zb = if r == 1 then base1 else ClientFrame.cloudM(ClientFrame.byte(f, "base2", i, j))
				local zt = if r == 1 then top1 else ClientFrame.cloudM(ClientFrame.byte(f, "top2", i, j))
				if zt > zb and self.noClouds then
					if r == 1 then cloudCols += 1 end
				elseif zt > zb then
					local cl = take(clouds, Vector3.new(x, 0.5 * (zb + zt) * V, z))
					cl.Transparency = 0.35
					cl.Size = Vector3.new(s, (zt - zb) * V, s)
					if r == 1 then cloudCols += 1 end
				end
			end
			local rate = ClientFrame.rateMmh(ClientFrame.byte(f, "rain", i, j))
			rainMax = math.max(rainMax, rate)
			if rate > 1 and not self.noRain then
				local top = if top1 > base1 then base1 else 2000
				local rn = take(rain, Vector3.new(x, 0.5 * top * V, z))
				rn.Transparency = 1 - math.clamp(0.15 + 0.6 * math.log10(rate) / 2.3, 0.15, 0.75)
				local hail = ClientFrame.rateMmh(ClientFrame.byte(f, "hail", i, j))
				rn.Color = Color3.fromRGB(70, 110, 200):Lerp(Color3.fromRGB(235, 240, 250), math.clamp(hail / rate, 0, 1))
				rn.Size = Vector3.new(s * 0.8, top * V, s * 0.8)
			end
		end
	end
	local deepest = 0
	if f.nest then
		local n = f.nest
		local ns = n.dx * H
		for j = 1, n.ny do
			for i = 1, n.nx do
				local zb = ClientFrame.nestBaseM(f, i, j)
				if zb > 0 then
					local x, z = at(n.X0 + (i - 0.5) * n.dx, n.Y0 + (j - 0.5) * n.dx)
					lowest = math.min(lowest, zb)
					local w = take(wall, Vector3.new(x, (zb + 100) * V, z))
					w.Transparency = 0.1
					w.Size = Vector3.new(ns, 200 * V, ns)
					local lower = ClientFrame.nestDropPa(f, i, j) / PA_PER_M
					deepest = math.max(deepest, lower)
					if lower >= FUNNEL_MIN_M then
						local bottom = math.max(0, zb - lower)
						local fu = take(funnel, Vector3.new(x, 0.5 * (zb + bottom) * V, z))
						fu.Transparency = 0.05
						fu.Size = Vector3.new(ns * 0.7, (zb - bottom) * V, ns * 0.7)
					end
				end
			end
		end
	end
	local torText = self:drawTornado(f, at)
	for _, p in self.pools do finish(p) end
	return ("%s  model %d min  cloud cols %d  rain %.0f mm/h%s%s%s"):format(if near then "near" else "far",
		f.time // 60, cloudCols, rainMax,
		if lowest < math.huge then (" | nest lowest cloud %.0f m"):format(lowest) else "",
		if deepest > 0 then (" | lowering %.0f m"):format(deepest) else "", torText)
end

local SLICES = 24 -- funnel slices from the tip to the cloud base
local EF0_MPH = 65
local RING_M = 15 -- the ground ring's height (m)
local CORE_TOP_M = 1000 -- how high the core is drawn with no cloud base over it

-- The tornado block: the funnel, the core below it and the ground ring (see the header). Returns a
-- HUD line ("" with none).
function FrameView:drawTornado(f: any, at: (number, number) -> (number, number)): string
	local t = f.tornado
	if not t or t.mph <= 0 then return "" end
	local V = self.vScale
	if self.noTornado then
		return ("\n  TORNADO %s %d mph  core R %d m  drop %.0f hPa  base %d m  funnel tip %d m"):format(if t.ef then "EF" .. t.ef else "", t.mph, t.R, t.drop / 100, t.base, t.tip)
	end
	local tf, core, ring = self.pools[5], self.pools[6], self.pools[7]
	local lv = t.levels
	-- the centre offset (m from the ground point) and condensation radius (m) at height z, between
	-- the block's levels (the ground point below the first; the top level's above the last)
	local function along(z: number): (number, number, number)
		if #lv == 0 then return 0, 0, 0 end
		if z <= lv[1].z then
			local a = z / lv[1].z
			return lv[1].dx * a, lv[1].dy * a, lv[1].funnel
		end
		for k = 2, #lv do
			if z <= lv[k].z then
				local a = (z - lv[k - 1].z) / (lv[k].z - lv[k - 1].z)
				return lv[k - 1].dx + a * (lv[k].dx - lv[k - 1].dx), lv[k - 1].dy + a * (lv[k].dy - lv[k - 1].dy), lv[k - 1].funnel + a * (lv[k].funnel - lv[k - 1].funnel)
			end
		end
		local L = lv[#lv]
		return L.dx, L.dy, L.funnel
	end
	local top = if t.base > 0 then t.base else CORE_TOP_M
	local tip = math.clamp(t.tip, 0, top)
	-- the funnel: cloud from the tip up to the base
	if t.base > 0 and tip < top then
		local h = (top - tip) / SLICES
		for q = 0, SLICES - 1 do
			local z = tip + (q + 0.5) * h
			local ex, ey, r = along(z)
			if r > 0 then
				local x, zz = at(t.x + ex, t.y + ey)
				local p = take(tf, Vector3.new(x, z * V, zz))
				p.Transparency = 0.08
				p.Size = Vector3.new(h * V * 1.02, 2 * r * V, 2 * r * V)
			end
		end
	end
	-- the core below the funnel (clear air: the spinning wind, not cloud); with no cloud over the
	-- vortex, the core up to CORE_TOP_M
	local coreTop = if t.base > 0 then tip else CORE_TOP_M
	if coreTop > 0 then
		local h = coreTop / 8
		for q = 0, 7 do
			local z = (q + 0.5) * h
			local ex, ey = along(z)
			local x, zz = at(t.x + ex, t.y + ey)
			local p = take(core, Vector3.new(x, z * V, zz))
			p.Transparency = 0.8
			p.Size = Vector3.new(h * V * 1.02, 2 * t.R * V, 2 * t.R * V)
		end
	end
	-- the ground ring out to EF0
	local rEF0 = t.R * t.mph / EF0_MPH
	local x, zz = at(t.x, t.y)
	local g = take(ring, Vector3.new(x, 0.5 * RING_M * V, zz))
	g.Transparency = 0.6
	g.Size = Vector3.new(RING_M * V, 2 * rEF0 * V, 2 * rEF0 * V)
	return ("\n  TORNADO %s %d mph  core R %d m  EF0 out to %.0f m  drop %.0f hPa  base %d m  funnel tip %d m%s | model gust %d m/s  spin %.2f /s  own drop %.0f hPa"):format(
		if t.ef then "EF" .. t.ef else "", t.mph, t.R, rEF0, t.drop / 100, t.base, t.tip, if t.found then "" else " (model has no vortex)",
		t.gust, t.zeta, t.modelDrop / 100)
end

-- Every render step: the shown parts placed from the anchor (one BulkMoveTo).
function FrameView:place(groundY: number)
	local ax, az = self:anchorAt(os.clock())
	local list, cfs = self.partsList, self.cframes
	table.clear(list)
	table.clear(cfs)
	for _, p in self.pools do
		for k = 1, p.shown do
			local r = p.rel[k]
			table.insert(list, p.parts[k])
			local cf = CFrame.new(ax + r.X, groundY + r.Y, az + r.Z)
			table.insert(cfs, if p.turn then cf * p.turn else cf)
		end
	end
	if #list > 0 then workspace:BulkMoveTo(list, cfs, Enum.BulkMoveMode.FireCFrameChanged) end
end

return FrameView
