--!strict
-- A barebones view of one storm's client frame (ClientFrame.luau): grey boxes, a debug and test
-- drawing, not the game's look (that is still to be chosen). Used by the cloudlab's live mode
-- (client/LiveView.client.luau, on its tabletop) and the main game's live storms
-- (src/client/LiveStorms.luau, full scale). Everything drawn is a model field:
--   cloud runs     each column's two lowest cloud runs, grey boxes
--   rain shafts    ground rain from the ground to the cloud base (2 km where there is none), more
--                  opaque as it is heavier, whiter where it is hail
--   nest (near frames): the lowest cloud below 3 km at 250 m spacing, dark (wall cloud,
--                  lowerings; in near-saturated air also rain-fog down to the ground, which is
--                  cloud too), and below it the condensation lowered by the pressure drop: air
--                  expanding into the low condenses at the same pressure, so about drop / (rho g),
--                  12 Pa a metre, further down (a funnel, where the drop is deep enough to show)
-- Placing: parts are drawn from the frame's anchor (the point at the engine storm's position).
-- The anchor moves on at the storm's motion between frames, and the jump to where a new frame
-- puts it eases out over EASE_S (setAnchor, place).
--   local v = FrameView.new(folder, { hScale = studs per metre across, vScale = studs per metre up })
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
type Pool = { folder: Folder, parts: { Part }, used: number, shown: number, color: Color3, name: string, rel: { Vector3 } }
local function pool(folder: Folder, name: string, color: Color3): Pool
	return { folder = folder, parts = {}, used = 0, shown = 0, color = color, name = name, rel = {} }
end
local function take(p: Pool, rel: Vector3): Part
	p.used += 1
	p.rel[p.used] = rel
	local x = p.parts[p.used]
	if not x then
		x = part(p.name, p.color)
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

function FrameView.new(folder: Folder, opts: { hScale: number, vScale: number })
	local self = setmetatable({}, FrameView) :: any
	self.folder = folder
	self.hScale, self.vScale = opts.hScale, opts.vScale
	self.pools = {
		pool(folder, "Cloud", Color3.new(0.92, 0.92, 0.95)),
		pool(folder, "Rain", Color3.fromRGB(70, 110, 200)),
		pool(folder, "Wall", Color3.fromRGB(85, 88, 96)),
		pool(folder, "Funnel", Color3.fromRGB(70, 70, 76)),
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
				if zt > zb then
					local cl = take(clouds, Vector3.new(x, 0.5 * (zb + zt) * V, z))
					cl.Transparency = 0.35
					cl.Size = Vector3.new(s, (zt - zb) * V, s)
					if r == 1 then cloudCols += 1 end
				end
			end
			local rate = ClientFrame.rateMmh(ClientFrame.byte(f, "rain", i, j))
			rainMax = math.max(rainMax, rate)
			if rate > 1 then
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
	for _, p in self.pools do finish(p) end
	return ("%s  model %d min  cloud cols %d  rain %.0f mm/h%s%s"):format(if near then "near" else "far",
		f.time // 60, cloudCols, rainMax,
		if lowest < math.huge then (" | nest lowest cloud %.0f m"):format(lowest) else "",
		if deepest > 0 then (" | lowering %.0f m"):format(deepest) else "")
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
			table.insert(cfs, CFrame.new(ax + r.X, groundY + r.Y, az + r.Z))
		end
	end
	if #list > 0 then workspace:BulkMoveTo(list, cfs, Enum.BulkMoveMode.FireCFrameChanged) end
end

return FrameView
