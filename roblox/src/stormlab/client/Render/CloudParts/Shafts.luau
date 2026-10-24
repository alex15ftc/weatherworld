--!nonstrict
-- Distant rain shafts and precipitation curtains, drawn from the precipitation FIELD (cw.vol, the
-- replicated 1 km surface rain / hail columns), not from the cloud: the clear inflow region and the
-- RFD slot stay clear wherever the field has no rain.
--   binning   every rainy column (> 0.5 mm/h) goes into a 4 km cell (2 km within 14 km of the
--             camera); a cell with rain becomes one shaft at the rain-weighted centroid of its
--             columns, as wide as the rainy share of the cell
--   opacity   from the cell's mean rain rate (log), less with distance haze
--   colour    rain grey, whiter with hail (cm), brighter when the sun is behind the shaft
--             (forward scattering), hazed by true distance
--   height    ground to the nearest storm's cloud base
--   motion    each shaft moves with its nearest storm from the time the field arrived
-- Camera-facing (yaw only) Parts with a Texture (LabConfig.TEXTURES.rainShaft), pooled, far
-- ones drawn scaled toward the camera like the cloud pieces.
local Workspace = game:GetService("Workspace")

local Util = require(script.Parent:WaitForChild("Util"))

local Shafts = {}
Shafts.__index = Shafts

local MAX_SHAFTS = 200
local NEAR_FINE = 14000
local PARK = CFrame.new(0, -200000, 0)

function Shafts.new(ctx: any)
	local self = setmetatable({
		ctx = ctx,
		folder = Instance.new("Folder"),
		parts = {}, -- pooled { part, tex, lastSize, lastCol, lastT }
		list = {}, -- planned shafts
		t0 = 0,
		binnedAt = -math.huge,
		binCam = Vector3.zero,
		dirty = true,
		count = 0,
	}, Shafts)
	self.folder.Name = "RainShafts"
	self.folder.Parent = ctx.root
	return self
end

local function newShaft(self: any): any
	local part = Instance.new("Part")
	part.Name = "Shaft"
	part.Anchored, part.CanCollide, part.CanQuery, part.CanTouch = true, false, false, false
	part.CastShadow = false
	part.Transparency = 1
	part.Size = Vector3.new(100, 100, 0.2)
	part.CFrame = PARK
	local tex = Instance.new("Texture")
	tex.Texture = self.ctx.Config.TEXTURES.rainShaft
	tex.Face = Enum.NormalId.Front
	tex.StudsPerTileU, tex.StudsPerTileV = 100, 100
	tex.Parent = part
	part.Parent = self.folder
	return { part = part, tex = tex, lastSize = Vector3.zero, lastCol = nil, lastT = -1 }
end

-- re-bin the field into shafts (on new precipitation, or when the camera has moved far)
function Shafts:rebin()
	local ctx = self.ctx
	local cw = ctx.cw
	local vol = cw.vol
	self.list = {}
	self.dirty = false
	self.binnedAt = os.clock()
	local cx0, cy0 = ctx:simCamera()
	self.binCam = Vector3.new(cx0, cy0, 0)
	if not vol or not vol.rain or not vol.nxv then
		return
	end
	local nx, x0 = vol.nxv, vol.x0
	local VOX = -2 * x0 / nx
	-- fine 2 km bins
	local FINE = 2000
	local bins = {}
	for col, rr in vol.rain do
		if rr > 0.5 then
			local cx, cy = col % nx, col // nx
			local x, y = x0 + (cx + 0.5) * VOX, x0 + (cy + 0.5) * VOX
			local bx, by = math.floor(x / FINE), math.floor(y / FINE)
			local key = bx * 100000 + by
			local b = bins[key]
			if not b then
				b = { bx = bx, by = by, n = 0, rain = 0, hail = 0, sx = 0, sy = 0 }
				bins[key] = b
			end
			local hl = vol.hail[col] or 0
			b.n += 1
			b.rain += rr
			b.hail += hl
			b.sx += x * rr
			b.sy += y * rr
		end
	end
	-- merge 2 x 2 fine bins into 4 km cells away from the camera
	local cells = {}
	local coarse = {}
	for _, b in bins do
		local ccx, ccy = (b.bx // 2) * 2 * FINE + FINE, (b.by // 2) * 2 * FINE + FINE
		local d = math.sqrt((ccx - cx0) ^ 2 + (ccy - cy0) ^ 2)
		if d < NEAR_FINE then
			b.cell = FINE
			table.insert(cells, b)
		else
			local key = (b.bx // 2) * 100000 + (b.by // 2)
			local c = coarse[key]
			if not c then
				c = { n = 0, rain = 0, hail = 0, sx = 0, sy = 0, cell = 2 * FINE }
				coarse[key] = c
				table.insert(cells, c)
			end
			c.n += b.n
			c.rain += b.rain
			c.hail += b.hail
			c.sx += b.sx
			c.sy += b.sy
		end
	end
	local storms = cw.storms
	local out = {}
	for _, c in cells do
		local cols = (c.cell / VOX) ^ 2
		local frac = math.clamp(c.n / cols, 0, 1)
		local rain = c.rain / c.n
		if c.n >= 1 and rain > 0.8 then
			local x, y = c.sx / c.rain, c.sy / c.rain
			local d = math.sqrt((x - cx0) ^ 2 + (y - cy0) ^ 2)
			if d < 150000 then
				-- the nearest storm: its motion and cloud base
				local best, bs = math.huge, nil
				for _, s in storms do
					local ex, ey = s.x - x, s.y - y
					local d2 = ex * ex + ey * ey
					if d2 < best then
						best, bs = d2, s
					end
				end
				local base = if bs and best < 40000 * 40000 then bs.base or 1200 else 1300
				local a = math.clamp(0.1 + 0.6 * math.log(1 + rain / 3) / math.log(1 + 100 / 3), 0, 0.75) * (0.45 + 0.55 * math.sqrt(frac))
				table.insert(out, {
					x = x, y = y,
					vx = if bs and best < 40000 * 40000 then bs.u else 0,
					vy = if bs and best < 40000 * 40000 then bs.v else 0,
					w = c.cell * (0.7 + 0.5 * math.sqrt(frac)) * 1.15,
					h = base + 150,
					a = a,
					hail = math.clamp((c.hail / c.n) / 2.5, 0, 1),
					prio = a / math.max(d, 3000),
				})
			end
		end
	end
	if #out > MAX_SHAFTS then
		table.sort(out, function(p, q)
			return p.prio > q.prio
		end)
		for i = #out, MAX_SHAFTS + 1, -1 do
			out[i] = nil
		end
	end
	self.list = out
end

function Shafts:hide()
	for _, p in self.parts do
		if p.part.CFrame ~= PARK then
			p.part.CFrame = PARK
		end
	end
	self.count = 0
end

-- draw every shaft this frame; returns the number drawn
function Shafts:draw(cam: Vector3, simT: number, D: number): number
	local ctx = self.ctx
	local cx, cy = ctx:simCamera()
	if self.dirty or (Vector3.new(cx, cy, 0) - self.binCam).Magnitude > 4000 or os.clock() - self.binnedAt > 20 then
		self:rebin()
	end
	local L = Util.light
	local sunV = Vector3.new(L.sunSim[1], L.sunSim[3], -L.sunSim[2])
	local dt = math.clamp(simT - self.t0, -5, 120)
	local parts, frames = {}, {}
	local n = 0
	for _, sh in self.list do
		local x, y = sh.x + sh.vx * dt, sh.y + sh.vy * dt
		local P = Vector3.new(x, sh.h * 0.5, -y)
		local flat = Vector3.new(P.X - cam.X, 0, P.Z - cam.Z)
		local dh = flat.Magnitude
		if dh < 0.6 * sh.w + 800 then
			continue -- (the camera is in or at this rain: the near-rain renderer draws it)
		end
		local d = (P - cam).Magnitude
		local k = Util.farK(d, D, math.max(sh.w, sh.h))
		n += 1
		local p = self.parts[n]
		if not p then
			p = newShaft(self)
			self.parts[n] = p
		end
		local size = Util.capSize(Vector3.new(sh.w * k, sh.h * k, 0.2))
		if math.abs(size.X - p.lastSize.X) > 0.004 * size.X or math.abs(size.Y - p.lastSize.Y) > 0.004 * size.Y then
			p.part.Size = size
			p.tex.StudsPerTileU = size.X
			p.tex.StudsPerTileV = size.Y
			p.lastSize = size
		end
		-- colour: rain grey, white with hail, lit from behind by the sun (forward scatter)
		local view = (P - cam).Unit
		local fwd = math.max(0, view:Dot(sunV)) ^ 3 * L.sunUp
		local g = 0.5 + 0.25 * fwd + 0.3 * sh.hail
		local col = Color3.new(math.min(1, g * 0.97), math.min(1, g), math.min(1, g * 1.04))
		col = Color3.new(col.R * (0.35 + 0.65 * L.day), col.G * (0.35 + 0.65 * L.day), col.B * (0.35 + 0.65 * L.day))
		local f = Util.hazeF(d)
		col = Util.quant(Util.mix(col, L.haze, f))
		local tr = math.floor((1 - sh.a * (1 - 0.85 * f)) * 50 + 0.5) / 50
		if p.lastCol ~= col then
			p.tex.Color3 = col
			p.lastCol = col
		end
		if p.lastT ~= tr then
			p.tex.Transparency = tr
			p.lastT = tr
		end
		local drawn = cam + (P - cam) * k
		local face = Vector3.new(cam.X, drawn.Y, cam.Z)
		table.insert(parts, p.part)
		table.insert(frames, CFrame.lookAt(drawn, face))
	end
	-- park the unused ones
	for j = n + 1, #self.parts do
		local p = self.parts[j]
		if p.part.CFrame ~= PARK then
			table.insert(parts, p.part)
			table.insert(frames, PARK)
		end
	end
	if #parts > 0 then
		Workspace:BulkMoveTo(parts, frames, Enum.BulkMoveMode.FireCFrameChanged)
	end
	self.count = n
	return n
end

function Shafts:destroy()
	self.folder:Destroy()
end

return Shafts
