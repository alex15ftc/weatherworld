--!strict
-- The wall cloud and the lowered base round a storm's low-level mesocyclone, from the near frame's
-- 250 m nest (2026-11-07; docs/visuals/RENDER-ARCHITECTURE.md). The game drew nothing from the nest
-- before, so the base over a tornado was the 1 km box's and the funnel met no lowering.
--   field     the nest's cloud base lowered by its pressure drop (VisualAtmosphere.loweringAt: the
--             outflow air the updraught takes in lowers its condensation level, the mesocyclone's and
--             the tornado's drop lower it more) - the same surface the funnel is the bottom of
--   where     a lowering: the lowered base below the storm's own base round it (the nest's upper
--             quartile of bases: the base of the inflow air) by more than MIN_DROP_M; it hangs from
--             that base down to the lowered surface
--   motion    tracers turning round the mesocyclone at its Rankine wind's angular speed (Vm / Rm in
--             its core, slower outside), each drawing the field where it is now: the cloud elements
--             go round, forming and thinning where the field says, and the wall cloud itself stays
--             where the pressure field puts it. The same on every server and client (2026-11-07):
--             each tracer slot lives LIFE s at a time on the shared clock (GetServerTimeNow), formed
--             at a hashed place for (storm, slot, cycle) and turned since by its age at the angular
--             speed - no state from when this client began
--   scale     near the tornado across at the true (height) scale, as the funnel is, so the funnel's
--             top and the wall cloud meet at the same size; easing to the map's scale by the
--             lowering's edge, so it meets the storm's body (which is at the map's scale)
--   light     PuffView.rainLight under the cloud above it, as the funnel and the rain
-- Far frames have no nest: nothing is drawn (the body's base shows the lowering at 1 km there).
--   local w = WallCloudView.new(folder, { max = 160, seed = storm id })
--   w:draw(frame, H, V) / w:place(ax, groundY, az) / w:flash(flashAt)
local ClientFrame = require(script.Parent:WaitForChild("ClientFrame")) :: any
local PuffView = require(script.Parent:WaitForChild("PuffView")) :: any
local VA = require(script.Parent:WaitForChild("VisualAtmosphere")) :: any
local SharedClock = require(script.Parent:WaitForChild("SharedClock")) :: any

local WallCloudView = {}
WallCloudView.__index = WallCloudView

WallCloudView.CONFIG = {
	TRACERS = 110,
	REACH_K = 2.2, -- tracers out to this many mesocyclone radii (at most the nest's half width)
	MIN_DROP_M = 60, -- a lowering this deep or more is drawn
	TRUE_K = 3, -- across at the true scale out to this many tornado core radii (the funnel's flare)
	GROW = 1.9, -- a puff this many times its tracer's spacing across
	ASPECT = 1.4, -- at most this tall against its width
	MAX_STACK = 3,
	ALPHA = 0.85,
	LIGHT_S = 0.5,
	LIFE = 40, -- a cloud element's life on the shared clock (s)
}
local CW = WallCloudView.CONFIG
local function p(key: string): number
	local v = workspace:GetAttribute("WC_" .. key)
	if type(v) == "number" then return v end
	return (CW :: any)[key]
end
local TEX_MEAN = 0.375

function WallCloudView.new(folder: Folder, opts: { max: number?, seed: string? })
	local self = setmetatable({}, WallCloudView) :: any
	self.folder = folder
	self.max = opts.max or 160
	local seed = 0
	for i = 1, #(opts.seed or "") do seed = (seed * 31 + string.byte(opts.seed :: string, i)) % 1000003 end
	self.seed = seed
	local anchor = Instance.new("Part")
	anchor.Name = "WallCloudAnchor"
	anchor.Anchored, anchor.CanCollide, anchor.CanQuery, anchor.CanTouch = true, false, false, false
	anchor.Transparency, anchor.Size = 1, Vector3.one
	anchor.Parent = folder
	self.anchor = anchor
	self.guis = {} :: { BillboardGui }
	self.shown = 0
	self.tracers = {}
	self.flashL = 0
	return self
end

local function puff(self: any, k: number): BillboardGui
	local g = self.guis[k]
	if not g then
		g = Instance.new("BillboardGui")
		g.Name = "WallPuff"
		g.Adornee = self.anchor
		g.LightInfluence = 0
		g.Brightness = 1
		g.ResetOnSpawn = false
		g.ClipsDescendants = false
		local img = Instance.new("ImageLabel")
		img.Name = "I"
		img.Size = UDim2.fromScale(1, 1)
		img.BackgroundTransparency = 1
		img.Image = PuffView.TEXTURE
		img.Parent = g
		g.Parent = self.folder
		self.guis[k] = g
	end
	return g
end

function WallCloudView.draw(self: any, f: any, H: number, V: number): string
	if not f.nest then
		self.state = nil
		return ""
	end
	local v = VA.vortexFrom(f)
	local rhoG = if v then v.rhoG else VA.param("RHO_G_DEFAULT")
	local Vm, Rm, mx, my
	if v and v.mesoV > 0.5 then
		Vm, Rm, mx, my = v.mesoV, v.mesoR, v.x, v.y
	else
		Vm, Rm, mx, my = VA.mesoFromNest(f, rhoG)
	end
	-- the storm's own base round it: the upper quartile of the nest's bases
	local n = f.nest
	local bases = {}
	for i = 1, n.nx, 2 do
		for j = 1, n.ny, 2 do
			local zb = ClientFrame.nestBaseM(f, i, j)
			if zb > 0 then table.insert(bases, zb) end
		end
	end
	if #bases == 0 then
		self.state = nil
		return ""
	end
	table.sort(bases)
	local ref = bases[math.max(1, math.floor(#bases * 0.75))]
	local half = 0.5 * math.min(n.nx, n.ny) * n.dx
	local reach = math.min(half - n.dx, math.max(2 * n.dx, p("REACH_K") * Rm))
	-- (box m from the mesocyclone's centre to the nest's middle: the tracers must stay in the nest)
	local cxN, cyN = n.X0 + half, n.Y0 + half
	reach = math.min(reach, half - math.max(math.abs(mx - cxN), math.abs(my - cyN)) - n.dx)
	local i = math.clamp(math.floor(mx / f.dx) + 1, 1, f.nx)
	local j = math.clamp(math.floor(my / f.dx) + 1, 1, f.ny)
	local depth = 0
	for _, r in { { "base1", "top1" }, { "base2", "top2" } } do
		local zb, zt = ClientFrame.cloudM(ClientFrame.byte(f, r[1], i, j)), ClientFrame.cloudM(ClientFrame.byte(f, r[2], i, j))
		if zt > zb then depth += zt - zb end
	end
	self.state = {
		f = f, H = H, V = V, rhoG = rhoG, Vm = Vm, Rm = Rm, mx = mx, my = my, ref = ref, reach = math.max(0, reach),
		trueR = if v then p("TRUE_K") * v.R else 0, depth = depth, rain = ClientFrame.rateMmh(ClientFrame.byte(f, "rain", i, j)),
		gx = (mx - f.anchorX) * H, gy = -(my - f.anchorY) * H,
	}
	self.litAt = nil
	return ("WALL CLOUD  meso %.1f m/s r %.0f m  base %.0f m  reach %.0f m"):format(Vm, Rm, ref, self.state.reach)
end

function WallCloudView.flash(self: any, flashAt: (number, number, number, number?, number?) -> number)
	local s = self.state
	if not s then return end
	local a = self.anchor.Position
	self.flashL = flashAt(a.X + s.gx, a.Z + s.gy, s.ref, 500, 300)
end

-- radius (m) to studs across: the true scale V out to trueR, then the map's H
local function radial(s: any, r: number): (number, number)
	if r <= s.trueR then return r * s.V, s.V end
	-- (eased from V to H over one more trueR, so the scale has no kink)
	local w = math.clamp((r - s.trueR) / math.max(1, s.trueR), 0, 1)
	w = w * w * (3 - 2 * w)
	local k = s.V + (s.H - s.V) * w
	local out = s.trueR * s.V
	-- (integrate the scale from trueR to r: in two steps, good enough for a smooth map)
	local mid = 0.5 * (s.trueR + r)
	local wm = math.clamp((mid - s.trueR) / math.max(1, s.trueR), 0, 1)
	wm = wm * wm * (3 - 2 * wm)
	out += (r - s.trueR) * (s.V + (s.H - s.V) * wm)
	return out, k
end

function WallCloudView.place(self: any, ax: number, groundY: number, az: number)
	self.anchor.CFrame = CFrame.new(ax, groundY, az)
	local s = self.state
	local now = os.clock()
	local k = 0
	local cam = workspace.CurrentCamera
	if s and s.reach > 0 and cam then
		local camPos = cam.CFrame.Position
		local at = self.anchor.Position + Vector3.new(s.gx, 0, s.gy)
		if not self.litAt or now - self.litAt > p("LIGHT_S") then
			self.litAt = now
			local f = s.f
			local cx, cy = (camPos.X - ax) / s.H + f.anchorX, -(camPos.Z - az) / s.H + f.anchorY
			local edge, tauSide = PuffView.openSide(f, s.mx, s.my, cx, cy)
			local col = PuffView.rainLight(s.depth, s.rain, 0.25 * s.ref, edge, tauSide)
			local tau, front = PuffView.rainOn(camPos, at, s.ref)
			self.col = PuffView.haze(PuffView.flashed(col, self.flashL or 0), ((at - camPos) * Vector3.new(1, 0, 1)).Magnitude / s.H, tau, front)
		end
		local tr = self.tracers
		local N = p("TRACERS")
		local life = p("LIFE")
		local T = SharedClock.day()
		local spacing = s.reach * math.sqrt(math.pi / N) -- (m between tracers)
		for i = 1, N do
			local tt = T + ((i * 0.618034) % 1) * life
			local cyc = math.floor(tt / life)
			local age = tt - cyc * life
			local t = tr[i]
			if not t or t.cycle ~= cyc then
				local rng = Random.new((self.seed * 7919 + i * 104729 + cyc * 1299709) % 2147483647)
				-- (even by area over the reach: r ~ sqrt(u))
				t = { cycle = cyc, u = rng:NextNumber(), th0 = rng:NextNumber() * 2 * math.pi, flip = rng:NextInteger(0, 1) }
				tr[i] = t
			end
			local r = s.reach * math.sqrt(t.u)
			local om = if r <= s.Rm then s.Vm / math.max(1, s.Rm) else s.Vm * s.Rm / (r * r)
			t.th = t.th0 + om * age
			local lifeW = math.sin(math.pi * age / life)
			local x, y = s.mx + math.cos(t.th) * r, s.my + math.sin(t.th) * r
			local lowered: number? = VA.loweringAt(s.f, x, y, s.rhoG)
			if lowered then
				local low = lowered :: number
				local drop = s.ref - low
				local deep = math.clamp((drop - p("MIN_DROP_M")) / math.max(1, p("MIN_DROP_M")), 0, 1)
				-- (thinning toward the reach, so the outer tracers never draw a rim)
				local edgeW = math.clamp((1 - math.sqrt(t.u)) / 0.25, 0, 1)
				local A = p("ALPHA") * deep * edgeW * math.min(1, 1.6 * lifeW)
				if A > 0.01 then
					local rs, kAcross = radial(s, r)
					local ox, oz = math.cos(t.th) * rs, -math.sin(t.th) * rs
					local wS = p("GROW") * spacing * kAcross
					local tall = drop * s.V
					local nst = math.clamp(math.ceil(tall / (p("ASPECT") * wS)), 1, p("MAX_STACK"))
					local hS = math.min(tall / nst * 1.6, p("ASPECT") * wS * 1.3)
					for q = 0, nst - 1 do
						if k >= self.max then break end
						k += 1
						local g = puff(self, k)
						local zc = low + (q + 0.5) / nst * drop
						g.Size = UDim2.fromScale(wS, hS)
						g.StudsOffsetWorldSpace = Vector3.new(s.gx + ox, zc * s.V, s.gy + oz)
						g.Enabled = true
						local img = g:FindFirstChild("I") :: ImageLabel
						img.ImageColor3 = self.col
						img.ImageTransparency = 1 - (1 - (1 - A) ^ (1 / math.max(1, TEX_MEAN * 2 * nst)))
						img.Rotation = t.flip * 180
					end
				end
			end
		end
	end
	for x = k + 1, self.shown do self.guis[x].Enabled = false end
	self.shown = k
end

function WallCloudView.destroy(self: any)
	self.anchor:Destroy()
	for _, g in self.guis do g:Destroy() end
end

return WallCloudView
