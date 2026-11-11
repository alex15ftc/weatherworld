--!strict
-- A tornado drawn from its storm's client frame through the visual atmosphere (VisualAtmosphere.luau:
-- the one model of its cloud, dust and flow), as soft billboard puffs. Rewritten 2026-11-07
-- (docs/visuals/RENDER-ARCHITECTURE.md): the earlier build stacked rings of 8 puffs spinning at a
-- fixed radius, which read as a hollow helical scaffold. Now four layers, each sampled from the same
-- fields:
--   body        the condensation volume itself: slices up the axis from the tip into the wall cloud's
--               base, each one axis-centred puff as wide as the condensation radius there (where the
--               vortex's drop takes the condensation level down to that height) and as opaque as the
--               optical depth through the cloud on that chord (adiabatic liquid water above the
--               lowered condensation level: thin at the edge, dense in the core). Neighbouring slices
--               overlap, so the funnel is one continuous body with soft, irregular edges. Its
--               large-scale shape - curvature, bulges - is coherent noise carried up the axis by the
--               core's rise (big scales dominate; the amplitude grows with the vortex's turbulence,
--               from its swirl ratio)
--   structure   flow tracers inside the volume: each rides the vortex's wind (its swirl and rise at its
--               radius, integrated every step - not set from the clock), carrying a clump of cloud
--               whose density is coherent noise at the place it started (so neighbours share bands,
--               which the differential swirl wraps round the funnel), times the condensation there.
--               They are randomly placed, never on rings, so no regular helix forms
--   subvortices from the swirl ratio (VisualAtmosphere.subvortices), none in a laminar vortex: cores
--               orbiting on the radius of maximum wind, each its own condensation where its drop and the
--               parent's together reach the need, tilting forward with height as the air rises through
--               the turning orbit
--   dust        a separate layer, carried on the flow (spiralling in at the ground, rising, spreading
--               aloft) from where the ground wind lifts it, centred on a ground point that lags the
--               vortex's, so it is not stuck to the funnel; it can hide the funnel's foot
-- The same on every server and every client (2026-11-07, the user: storms must look the same across
-- servers): it is drawn only from the shared frame, the storm's seed and the shared clock
-- (Workspace:GetServerTimeNow). Nothing is integrated from when this client began: every tracer,
-- subvortex and dust puff lives in cycles of fixed length on the shared clock, its start in each
-- cycle a hash of (storm, slot, cycle), and where it is at an age is its path on the vortex's wind
-- from that start - so the motion still comes from the engine's wind speed.
-- Debug: workspace attribute TornadoDebug = true (or J on a client) draws the vortex's wind (rings at five heights and
-- radii, coloured by speed on the EF scale, arrows along the flow), the engine's funnel profile and
-- the numbers behind it (TornadoView.debugDraw).
-- Distance sets a budget by the funnel's size on screen (fewer structure tracers far off, faded not
-- switched). Light: PuffView.rainLight under the cloud above (as the base and the rain), brighter on
-- the side toward the open sky; lightning lights it as it lights the cloud (flash).
--   local t = TornadoView.new(folder, { max = 340, seed = storm id })
--   t:draw(frame, H, V) -> HUD text       (on each new frame)
--   t:place(ax, groundY, az, terrainAt?)  (each render step: the anchor from FrameView)
--   t:flash(flashAt)                      (each render step while lightning is live)
local ClientFrame = require(script.Parent:WaitForChild("ClientFrame")) :: any
local PuffView = require(script.Parent:WaitForChild("PuffView")) :: any
local VA = require(script.Parent:WaitForChild("VisualAtmosphere")) :: any
local SharedClock = require(script.Parent:WaitForChild("SharedClock")) :: any

local TornadoView = {}
TornadoView.__index = TornadoView

-- Every number the look depends on, tunable live (workspace attributes TV_<key> override).
TornadoView.CONFIG = {
	BODY_MAX = 44, STRUCT_MAX = 150, DUST_MAX = 84, -- (fine edge wisps: not yet - coherence first)
	SLICE_K = 0.55, -- body slices this many of their radius apart (at least MIN_SLICE_M)
	MIN_SLICE_M = 5,
	BODY_WIDE = 2.3, -- a slice's puff this many radii across (the soft texture's visible edge is inside it)
	BODY_TALL = 2.4, -- ...and this many slice spacings tall (so neighbours overlap)
	FLARE = 3, -- the top's widening into the base: at most this many core radii
	LARGE_AMP = 0.12, LARGE_AMP_TURB = 0.22, -- large-scale displacement (share of the radius): laminar, plus at full turbulence
	LARGE_LEN = 2.5, -- its wavelength up the funnel, in funnel radii... plus a share of the length
	BULGE = 0.15, -- width variation
	TIP_RAG = 0.12, -- the tip fades over this share of the funnel's length, moved by noise
	STRUCT_SIZE = 0.9, STRUCT_ALPHA = 0.55, -- structure clumps: size (radii), opacity against the body's
	STRUCT_LEN = 1.6, -- clump correlation length (funnel radii)
	SUB_SLICES = 9, SUB_WIDE = 2.4,
	DUST_ALPHA = 0.3, DUST_LIFE = 9, DUST_RISE_K = 0.12, DUST_OUT_K = 0.35, DUST_SIZE = 0.7, DUST_LAG_S = 2.5,
	DUST_TINT = Color3.new(0.62, 0.52, 0.4),
	STRUCT_LIFE = 10, -- a tracer's cycle on the shared clock (s)
	SUB_LIFE = 9, -- a subvortex's life (s): they form and decay round the core
	COLLAR_N = 7, -- the collar: dark shredded puffs just under the base, round the funnel's top
	COLLAR_R = 1.5, COLLAR_SIZE = 1.1, COLLAR_ALPHA = 0.4, COLLAR_DARK = 0.8, COLLAR_LIFE = 14,
	DEBRIS_TINT = 0.75, -- the lower funnel takes up to this share of the dust's colour (docs/visuals/TORNADO-LOOK-SPEC)
	SHAPE_CYCLE = 24, -- the large-scale shape's noise, crossfaded between two staggered cycles (s)
	DUST_STEP = 0.5, -- a dust puff's path is stepped this often from its start (s)
	LOD_PX = 260, -- the funnel this many pixels tall or more gets the full budget
	LIGHT_S = 0.25,
	PROFILE_S = 0, -- the condensation profile is rebuilt this often (s): every step (rebuilt every 0.4 s, the body's slices hopped to new heights at each rebuild - jitter, 2026-11-07)
}
local OFFSETS = { 0, 0.3, 0.6, 0.9 } -- (chord offsets, shares of the radius, the profile keeps the optical depth at)
local CF = TornadoView.CONFIG
local function p(key: string): number
	local v = workspace:GetAttribute("TV_" .. key)
	if type(v) == "number" then return v end
	return (CF :: any)[key]
end
local TEX_MEAN = 0.375
local FOOT_AT = 0.3

local function seedOf(s: string?): number
	local seed = 0
	for i = 1, #(s or "") do seed = (seed * 31 + string.byte(s :: string, i)) % 1000003 end
	return seed
end

-- Five numbers 0..1 for (seed, slot, cycle): the same on every machine (Random is PCG, seeded by
-- an integer), cached per slot until its cycle changes.
local function slotDraw(cache: { [number]: any }, seed: number, slot: number, cycle: number): any
	local c = cache[slot]
	if c and c.cycle == cycle then return c end
	local rng = Random.new((seed * 7919 + slot * 104729 + cycle * 1299709) % 2147483647)
	c = { cycle = cycle, a = rng:NextNumber(), b = rng:NextNumber(), c = rng:NextNumber(), d = rng:NextNumber(), e = rng:NextNumber() }
	cache[slot] = c
	return c
end
-- The shared clock, folded into a day (SharedClock: the server's time, smoothed - read straight,
-- its re-sync steps jittered every phase)
local function sharedNow(): number
	return SharedClock.day()
end
TornadoView.sharedNow = sharedNow

-- storm id -> the game's card tornado as built (Modules/FrameWorld: vc, rc, base, wallBase,
-- stormBase): the debug overlay shows it beside the engine's numbers
TornadoView.cards = {} :: { [string]: any }

function TornadoView.new(folder: Folder, opts: { max: number?, seed: string? })
	local self = setmetatable({}, TornadoView) :: any
	self.folder = folder
	self.max = opts.max or 340
	self.seed = seedOf(opts.seed)
	self.id = opts.seed
	local anchor = Instance.new("Part")
	anchor.Name = "TornadoAnchor"
	anchor.Anchored, anchor.CanCollide, anchor.CanQuery, anchor.CanTouch = true, false, false, false
	anchor.Transparency, anchor.Size = 1, Vector3.one
	anchor.Parent = folder
	self.anchor = anchor
	self.guis = {} :: { BillboardGui }
	self.shown = 0
	self.want = nil -- the frame's vortex (VisualAtmosphere.vortexFrom), with gx, gy (studs from the anchor)
	self.v = nil -- the drawn one, eased toward it every step
	self.tracers = {} -- (slot -> its cycle's draw)
	self.dust = {}
	self.subs = {}
	self.flashL = 0
	return self
end

local function puff(self: any, k: number, texture: string): BillboardGui
	local g = self.guis[k]
	if not g then
		g = Instance.new("BillboardGui")
		g.Name = "TornadoPuff"
		g.Adornee = self.anchor
		g.LightInfluence = 0
		g.Brightness = 1
		g.ResetOnSpawn = false
		g.ClipsDescendants = false
		local img = Instance.new("ImageLabel")
		img.Name = "I"
		img.Size = UDim2.fromScale(1, 1)
		img.BackgroundTransparency = 1
		img.Parent = g
		g.Parent = self.folder
		self.guis[k] = g
	end
	local img = g:FindFirstChild("I") :: ImageLabel
	if img.Image ~= texture then img.Image = texture end
	return g
end

-- The cloud column over the tornado's ground point (cloud depth above it, its rain): its light.
local function columnOver(f: any, xm: number, ym: number): (number, number)
	local i = math.clamp(math.floor(xm / f.dx) + 1, 1, f.nx)
	local j = math.clamp(math.floor(ym / f.dx) + 1, 1, f.ny)
	local depth = 0
	for _, r in { { "base1", "top1" }, { "base2", "top2" } } do
		local zb = ClientFrame.cloudM(ClientFrame.byte(f, r[1], i, j))
		local zt = ClientFrame.cloudM(ClientFrame.byte(f, r[2], i, j))
		if zt > zb then depth += zt - zb end
	end
	return depth, ClientFrame.rateMmh(ClientFrame.byte(f, "rain", i, j))
end

-- A puff's opacity for a share A of light stopped by the cloud it stands for, spread over `layers`
-- overlapping puffs (each the texture's mean opacity over its frame).
local function share(A: number, layers: number): number
	A = math.clamp(A, 0, 0.995)
	return 1 - (1 - A) ^ (1 / math.max(1, layers))
end

function TornadoView.draw(self: any, f: any, H: number, V: number): string
	local v = VA.vortexFrom(f)
	if not v then
		self.want = nil
		return ""
	end
	local w = v :: any
	w.gx, w.gy = (v.x - f.anchorX) * H, -(v.y - f.anchorY) * H
	w.Hs, w.Vs, w.f = H, V, f
	w.depth, w.rain = columnOver(f, v.x, v.y)
	w.groundMs = math.sqrt(f.um * f.um + f.vm * f.vm)
	self.want = w
	self.litAt = nil
	local n, st = VA.subvortices(v)
	return ("TORNADO VIEW  swirl %.0f m/s  core %.0f m  funnel %d-%d m  updraught %.0f m/s  swirl ratio %.2f  turbulence %.2f  subvortices %s  dust out to %.0f m  puffs %d of %d"):format(
		v.V, v.R, v.tip, v.Bt, v.wTor, v.S, VA.turbulence(v), if st > 0.01 then ("%.1f at %.0f%%"):format(n, st * 100) else "none",
		VA.dustRadius(v, w.groundMs), self.shown, self.max)
end

-- The drawn vortex now (for the debug camera): its ground point and base, eased.
function TornadoView.eased(self: any, _now: number): any
	local v = self.v or self.want
	if not v then return nil end
	return { gx = v.gx, gy = v.gy, Bt = v.Bt, V = v.Vs, R = v.R }
end

function TornadoView.flash(self: any, flashAt: (number, number, number, number?, number?) -> number)
	local v = self.v
	if not v then return end
	local a = self.anchor.Position
	self.flashL = flashAt(a.X + v.gx, a.Z + v.gy, 0.5 * math.max(v.Bt, 200), 200, 200)
end

local function tint(c: Color3, k: number): Color3
	return Color3.new(math.min(1, c.R * k), math.min(1, c.G * k), math.min(1, c.B * k))
end

-- Every render step: the vortex eased, its tracers moved on its wind, the puffs placed.
-- Debug: the vortex's wind, as the look reads it (workspace attribute TornadoDebug = true).
--   rings      at five heights (10 m, a quarter, half and three quarters of the way to the base, the
--              base) and four radii (half the core, the core, 2 and 4 cores), each coloured by the
--              flow's speed there on the EF scale (grey below 65 mph, then EF0 .. EF5)
--   arrows     eight round each ring, along the flow (swirl, inflow, rise), as long as it is fast
--   funnel     white: the engine's funnel radius at the frame's levels, with its lean; cyan: the
--              condensation radius the body is drawn to (VisualAtmosphere.funnelRadius)
--   label      the numbers: wind, core, drop, base and tip, swirl ratio, rise, subvortices, dust
local EF_BANDS = {
	{ 65, Color3.new(0.6, 0.6, 0.6) }, { 86, Color3.new(0.45, 0.8, 1) }, { 111, Color3.new(0.3, 1, 0.35) },
	{ 136, Color3.new(1, 1, 0.25) }, { 166, Color3.new(1, 0.6, 0.15) }, { 201, Color3.new(1, 0.2, 0.2) },
	{ math.huge, Color3.new(1, 0.3, 1) },
}
local MPH = 2.23694
local function bandOf(mph: number): number
	for q, b in EF_BANDS do
		if mph < b[1] then return q end
	end
	return #EF_BANDS
end

function TornadoView.debugDraw(self: any, v: any, V: number, axisAt: (number) -> (number, number))
	local dbg = self.dbg
	if not dbg then
		-- (the lines are thin neon parts, pooled: WireframeHandleAdornment lines did not show in play)
		dbg = { parts = {}, used = 0, at = 0 }
		local holder = Instance.new("Folder")
		holder.Name = "TornadoDebug"
		holder.Parent = self.folder
		dbg.holder = holder
		local gui = Instance.new("BillboardGui")
		gui.Name = "TornadoDebugLabel"
		gui.Adornee = self.anchor
		gui.AlwaysOnTop = true
		gui.Size = UDim2.fromOffset(520, 200)
		gui.LightInfluence = 0
		local tl = Instance.new("TextLabel")
		tl.Size = UDim2.fromScale(1, 1)
		tl.BackgroundTransparency = 0.35
		tl.BackgroundColor3 = Color3.new(0, 0, 0)
		tl.TextColor3 = Color3.new(1, 1, 1)
		tl.Font = Enum.Font.Code
		tl.TextSize = 14
		tl.TextXAlignment = Enum.TextXAlignment.Left
		tl.TextYAlignment = Enum.TextYAlignment.Top
		tl.Parent = gui
		gui.Parent = self.folder
		dbg.gui, dbg.text = gui, tl
		self.dbg = dbg
	end
	local now = os.clock()
	if now - dbg.at < 0.25 then return end
	dbg.at = now
	local origin = self.anchor.Position
	local cam = workspace.CurrentCamera
	local camPos = if cam then cam.CFrame.Position else origin
	dbg.used = 0
	-- a line from a to b (anchor space, studs), as a thin part as thick as a few pixels where it is
	local function line(a: Vector3, b: Vector3, col: Color3)
		local wa, wb = origin + a, origin + b
		local len = (wb - wa).Magnitude
		if len < 0.05 then return end
		dbg.used += 1
		local part = dbg.parts[dbg.used]
		if not part then
			part = Instance.new("Part")
			part.Anchored, part.CanCollide, part.CanQuery, part.CanTouch, part.CastShadow = true, false, false, false, false
			part.Material = Enum.Material.Neon
			part.Parent = dbg.holder
			dbg.parts[dbg.used] = part
		end
		local mid = (wa + wb) / 2
		local w = math.max(0.6, 0.0025 * (mid - camPos).Magnitude)
		part.Size = Vector3.new(w, w, len)
		part.CFrame = CFrame.lookAt(mid, wb)
		part.Color = col
		part.Transparency = 0
	end
	local WHITE, CYAN = Color3.new(1, 1, 1), Color3.new(0.2, 0.95, 1)
	local gx, gy = v.gx, v.gy
	-- a point (m from the axis at height z, x east, y north) in the anchor's space (studs)
	local function at(z: number, x: number, y: number): Vector3
		local cx, cy = axisAt(z)
		return Vector3.new(gx + cx + x * V, z * V, gy + cy - y * V)
	end
	local heights = { 10, 0.25 * v.Bt, 0.5 * v.Bt, 0.75 * v.Bt, v.Bt }
	local radii = { 0.5 * v.R, v.R, 2 * v.R, 4 * v.R }
	local N = 32
	local fastest = 0
	for _, z in heights do
		for _, r in radii do
			local vt, vr, w = VA.flow(v, r, z)
			local sp = math.sqrt(vt * vt + vr * vr + w * w)
			fastest = math.max(fastest, sp)
			local a = EF_BANDS[bandOf(sp * MPH)][2]
			local ring = {}
			for q = 0, N do
				local th = q / N * 2 * math.pi
				table.insert(ring, at(z, r * math.cos(th), r * math.sin(th)))
			end
			for q = 1, N do line(ring[q], ring[q + 1], a) end
			-- arrows along the flow, as long as half a core at the peak wind
			local len = 0.5 * v.R * sp / math.max(v.V, 1)
			for q = 0, 7 do
				local th = q / 8 * 2 * math.pi
				local c, sn = math.cos(th), math.sin(th)
				local ux, uy, uz = (-sn * vt + c * vr) / math.max(sp, 1e-3), (c * vt + sn * vr) / math.max(sp, 1e-3), w / math.max(sp, 1e-3)
				local p0 = at(z, r * c, r * sn)
				local p1 = at(z + uz * len, r * c + ux * len, r * sn + uy * len)
				line(p0, p1, a)
				-- (a head: back from the tip, out to either side across the swirl)
				local back = p1 + (p0 - p1).Unit * math.min((p1 - p0).Magnitude * 0.3, 0.2 * v.R * V)
				local side = Vector3.new(c, 0, -sn) * math.min((p1 - p0).Magnitude * 0.15, 0.1 * v.R * V)
				line(p1, back + side, a)
				line(p1, back - side, a)
			end
		end
	end
	-- the engine's funnel at its levels, and the one the body is drawn to
	local function rings(col: Color3, list: { { number } })
		local prev = nil
		for _, zr in list do
			local z, r = zr[1], zr[2]
			if r > 0 then
				local pts = {}
				for q = 0, N do
					local th = q / N * 2 * math.pi
					table.insert(pts, at(z, r * math.cos(th), r * math.sin(th)))
				end
				for q = 1, N do line(pts[q], pts[q + 1], col) end
				if prev then
					for q = 0, 3 do line(prev[q * 8 + 1], pts[q * 8 + 1], col) end
				end
				prev = pts
			else
				prev = nil
			end
		end
	end
	local eng = {}
	for _, l in v.levels do table.insert(eng, { l.z, l.funnel }) end
	rings(WHITE, eng)
	local drawn = {}
	for q = 0, 16 do
		local z = v.tip + (v.Bt - v.tip) * q / 16
		table.insert(drawn, { z, VA.funnelRadius(v, z, p("FLARE")) })
	end
	rings(CYAN, drawn)
	dbg.gui.StudsOffsetWorldSpace = Vector3.new(gx, v.Bt * V * 1.25 + 4 * v.R * V * 0.2, gy)
	local n, st = VA.subvortices(v)
	local tx, ty = VA.leanAt(v.levels, v.Bt)
	dbg.text.Text = table.concat({
		("TORNADO DEBUG   engine %d mph  (vortex %.0f m/s = %.0f mph)"):format(v.mph, v.V, v.V * MPH),
		("core R %.0f m   drop %.0f hPa   fastest drawn flow %.0f mph"):format(v.R, v.P / 100, fastest * MPH),
		("cloud base %.0f m   funnel tip %.0f m   lean at base %.0f m"):format(v.Bt, v.tip, math.sqrt(tx * tx + ty * ty)),
		("updraught %.0f m/s   core rise %.0f m/s   swirl ratio %.2f"):format(v.wTor, VA.param("CORE_W_K") * v.wTor, v.S),
		("subvortices %s   dust to %.0f m   ground %.0f m/s"):format(if st > 0.01 then ("%.1f (%.0f%%)"):format(n, st * 100) else "none", VA.dustRadius(v, v.groundMs), v.groundMs or 0),
		"rings: 10 m, 1/4, 1/2, 3/4 base, base  x  0.5R, R, 2R, 4R",
		"grey <65  blue EF0  green EF1  yellow EF2  orange EF3  red EF4  pink EF5",
		"white: engine funnel   cyan: drawn funnel",
		(function(): string
			local c = self.id and TornadoView.cards[self.id]
			if not c then return "" end
			return ("CARDS  swirl %.0f m/s   core R %.0f m   base %.0f m   (wall %.0f, storm %.0f)"):format(c.vc, c.rc, c.base, c.wallBase or 0, c.stormBase or 0)
		end)(),
	}, "\n")
	for q = dbg.used + 1, #dbg.parts do dbg.parts[q].Transparency = 1 end
	dbg.gui.Enabled = true
end

-- On or off: workspace attribute TornadoDebug, or the J key on this client (whichever changed last).
-- (Not F7: Roblox keeps the F keys from F7 on for its own menus, so the game never sees them.)
local debugLocal: boolean? = nil
local debugAttr: any = workspace:GetAttribute("TornadoDebug")
do
	local UIS = game:GetService("UserInputService")
	UIS.InputBegan:Connect(function(input, processed)
		if not processed and input.KeyCode == Enum.KeyCode.J then
			debugLocal = not TornadoView.debugOn()
			print("[TornadoView] tornado debug " .. (if debugLocal then "on" else "off") .. " (J)")
		end
	end)
	workspace:GetAttributeChangedSignal("TornadoDebug"):Connect(function()
		debugAttr = workspace:GetAttribute("TornadoDebug")
		debugLocal = nil
	end)
end
function TornadoView.debugOn(): boolean
	if debugLocal ~= nil then return debugLocal end
	return debugAttr == true
end

local function debugHide(self: any)
	local dbg = self.dbg
	if not dbg then return end
	if dbg.used > 0 or dbg.gui.Enabled then
		for _, part in dbg.parts do part.Transparency = 1 end
		dbg.used = 0
		dbg.gui.Enabled = false
	end
end

function TornadoView.place(self: any, ax: number, groundY: number, az: number, terrainAt: ((number, number) -> number?)?)
	local now = os.clock()
	local dt = math.clamp(now - (self.lastAt or now), 0, 0.25)
	self.lastAt = now
	local want = self.want
	if not want then
		-- no tornado: what is drawn thins out over a few seconds (not a cut)
		if self.v then
			self.v.fadeOut = (self.v.fadeOut or 1) - dt / 3
			if self.v.fadeOut <= 0 then self.v = nil end
		end
		if not self.v then
			for x = 1, self.shown do self.guis[x].Enabled = false end
			self.shown = 0
			self.anchor.CFrame = CFrame.new(ax, groundY, az)
			debugHide(self)
			return
		end
	else
		local prev = self.v
		local nv = VA.ease(prev, want, dt) :: any
		for _, k in { "gx", "gy" } do
			nv[k] = if prev then prev[k] + (1 - math.exp(-dt / VA.param("TAU_SHAPE"))) * (want[k] - prev[k]) else want[k]
		end
		nv.Hs, nv.Vs, nv.f, nv.depth, nv.rain, nv.groundMs = want.Hs, want.Vs, want.f, want.depth, want.rain, want.groundMs
		nv.fadeOut = math.min(1, ((prev and prev.fadeOut) or 0) + dt / 3)
		self.v = nv
	end
	local v = self.v
	local H, V = v.Hs, v.Vs
	local floor = if terrainAt then terrainAt(ax + v.gx, az + v.gy) or groundY else groundY
	self.anchor.CFrame = CFrame.new(ax, floor, az)
	-- (debugOnly with the overlay off: nothing to draw, so skip the puffs - they were laid out and
	-- written every frame, then switched off; ~3000 instance writes a frame a tornado, 2026-11-07)
	if self.debugOnly and not TornadoView.debugOn() then
		for x = 1, self.shown do self.guis[x].Enabled = false end
		self.shown = 0
		debugHide(self)
		return
	end
	local cam = workspace.CurrentCamera
	if not cam then return end
	local camPos = cam.CFrame.Position
	local at = self.anchor.Position + Vector3.new(v.gx, 0, v.gy)

	-- the light, the open sky's side and the haze, every LIGHT_S
	if not self.litAt or now - self.litAt > p("LIGHT_S") then
		self.litAt = now
		local f = v.f
		local cx, cy = (camPos.X - ax) / H + f.anchorX, -(camPos.Z - az) / H + f.anchorY
		local edge, tauSide = PuffView.openSide(f, v.x, v.y, cx, cy)
		local col = PuffView.rainLight(v.depth, v.rain, 0.5 * math.max(v.Bt, 200), edge, tauSide)
		local dist = ((at - camPos) * Vector3.new(1, 0, 1)).Magnitude / H
		local tau, front = PuffView.rainOn(camPos, at, 0)
		self.baseCol, self.dist, self.tau, self.front = col, dist, tau, front
		-- the open sky's side: the nearest way out of the cloud over it, of 8
		local best, bestA = math.huge, 0
		for q = 0, 7 do
			local a = q * math.pi / 4
			local e = PuffView.openSide(f, v.x, v.y, v.x + math.cos(a) * 1e5, v.y + math.sin(a) * 1e5)
			if e and e < best then best, bestA = e, a end
		end
		self.lightA = bestA
		self.lightK = if best < math.huge then VA.param("SIDE_LIGHT") * math.clamp(4000 / math.max(best, 500), 0.2, 1) else 0.05
	end
	local function colour(base: Color3, k: number): Color3
		local c = tint(base, k * (v.fadeOut or 1) + (1 - (v.fadeOut or 1)))
		return PuffView.haze(PuffView.flashed(c, self.flashL or 0), self.dist, self.tau, self.front)
	end
	local camDir = (at - camPos) * Vector3.new(1, 0, 1)
	-- (the view's angle round the funnel: for lighting the side facing the camera)
	local viewA = math.atan2(camDir.Z, -camDir.X) -- (box angle of the camera seen from the funnel, east = 0, north = pi/2)

	-- the budget for the funnel's size on screen
	local camDist = math.max(1, (at - camPos).Magnitude)
	local px = math.max(v.Bt, 100) * V / camDist * cam.ViewportSize.Y / (2 * math.tan(math.rad(cam.FieldOfView) / 2))
	local lod = math.clamp(px / p("LOD_PX"), 0.15, 1)

	local k = 0
	local alive = v.fadeOut or 1
	local function put(x: number, y: number, z: number, wS: number, hS: number, col: Color3, alpha: number, rot: number, tex: string, ground: boolean)
		if k >= self.max or alpha < 0.004 then return end
		k += 1
		local g = puff(self, k, tex)
		local ox, oz = v.gx + x, v.gy + y
		local up = if ground and terrainAt then (terrainAt(ax + ox, az + oz) or floor) - floor else 0
		local y0 = z
		if ground then y0 = math.max(y0, FOOT_AT * hS) end
		g.Size = UDim2.fromScale(wS, hS)
		g.StudsOffsetWorldSpace = Vector3.new(ox, up + y0, oz)
		g.Enabled = true
		local img = g:FindFirstChild("I") :: ImageLabel
		img.ImageColor3 = col
		img.ImageTransparency = 1 - math.clamp(alpha * alive, 0, 1)
		img.Rotation = rot
	end
	-- a box point (metres, x east, y north, at V) to studs from the ground point: lean at H, the rest at V
	local function axisAt(z: number): (number, number)
		local ex, ey = VA.leanAt(v.levels, z)
		return ex * H, -ey * H
	end

	local turb = VA.turbulence(v)
	local L = math.max(0, v.Bt - v.tip)
	local seed = self.seed
	local wRise = VA.param("CORE_W_K") * v.wTor
	-- large-scale shape: a displacement (both ways across) and a bulge, coherent noise carried up by the rise
	local lamL = p("LARGE_LEN") * math.max(v.R, 10) + 0.3 * L
	local ampL = p("LARGE_AMP") + p("LARGE_AMP_TURB") * turb
	-- (two staggered cycles of SHAPE_CYCLE on the shared clock, each its own noise carried up by the
	-- rise for its age, crossfaded as sin / cos so the amplitude holds: the rise speed can change
	-- without the shape jumping, as an integrated phase would on a shared clock)
	local T = sharedNow()
	local cyc = p("SHAPE_CYCLE")
	local function large(z: number, rc: number): (number, number, number)
		local dx, dy, bulge = 0, 0, 0
		for half = 0, 1 do
			local tt = T + half * 0.5 * cyc
			local c = math.floor(tt / cyc)
			local age = tt - c * cyc
			local wgt = math.sin(math.pi * age / cyc)
			local sd = seed + (c % 997) * 31 + half * 7
			local q = (z - wRise * age) / lamL
			dx += wgt * VA.fbm(q, 0.031 * age, 1.7, sd, 2, 0.4)
			dy += wgt * VA.fbm(q, 0.031 * age, 9.3, sd + 77, 2, 0.4)
			bulge += wgt * VA.fbm(q * 1.7, 4.1, age / 20, sd + 191, 2, 0.5)
		end
		return dx * ampL * rc, dy * ampL * rc, 1 + p("BULGE") * (0.5 + 0.5 * turb) * bulge
	end

	-- The profile up the funnel: slices (height, spacing, condensation radius, the optical depth
	-- through the cloud at four offsets from the axis), rebuilt every PROFILE_S - the condensation
	-- changes over seconds - while the shape's motion and the tracers move every step and read it.
	if L > 1 and (not self.prof or now - self.profAt > p("PROFILE_S")) then
		self.profAt = now
		local slices = {}
		local z = v.tip
		while z < v.Bt and #slices < p("BODY_MAX") do
			local rc0 = VA.funnelRadius(v, z + 0.5, p("FLARE"))
			local step = math.max(p("MIN_SLICE_M"), p("SLICE_K") * math.max(rc0, 0.35 * v.R))
			local zc = math.min(z + 0.5 * step, v.Bt)
			local rc = math.max(VA.funnelRadius(v, zc, p("FLARE")), 0.25 * v.R)
			local tau = {}
			for q, bf in OFFSETS do tau[q] = VA.chordTau(v, zc, bf * rc, rc, 6) end
			table.insert(slices, { z = zc, step = step, rc = rc, tau = tau })
			z += step
		end
		self.prof = slices
	elseif L <= 1 then
		self.prof = nil
	end
	local prof = self.prof
	-- the slice table at height z: radius, optical depth at offset share bf, and this step's shape
	local function lookup(z: number, bf: number): (number, number, number, number)
		local n = #prof
		local q = 1
		while q < n and prof[q + 1].z < z do q += 1 end
		local a0, a1 = prof[q], prof[math.min(n, q + 1)]
		local w = if a1.z > a0.z then math.clamp((z - a0.z) / (a1.z - a0.z), 0, 1) else 0
		local function tauOf(sl: any): number
			local x = math.clamp(bf, 0, OFFSETS[#OFFSETS]) / OFFSETS[#OFFSETS] * (#OFFSETS - 1) + 1
			local k0 = math.floor(x)
			local k1 = math.min(#OFFSETS, k0 + 1)
			return sl.tau[k0] + (x - k0) * (sl.tau[k1] - sl.tau[k0])
		end
		return a0.rc + w * (a1.rc - a0.rc), tauOf(a0) + w * (tauOf(a1) - tauOf(a0)), a0.dx + w * (a1.dx - a0.dx), a0.dy + w * (a1.dy - a0.dy)
	end

	-- the dust the ground wind lifts tints the lower funnel grey-brown (a tint, never orange: the
	-- spec's saturation cap - DUST_TINT is (0.62, 0.52, 0.40) against the cloud's own colour)
	local rdB = VA.dustRadius(v, v.groundMs)
	local dustK = math.clamp(rdB / math.max(v.R, 1) - 1, 0, 1)
	local dustTop = math.max(1, VA.param("DUST_DEPTH_K") * rdB * 2.5)
	local function bodyTone(z: number): Color3
		local c = self.baseCol
		local wD = p("DEBRIS_TINT") * dustK * math.max(0, 1 - z / dustTop) ^ 0.7
		if wD <= 0.001 then return c end
		local dc = p("DUST_TINT") :: any
		local dcol = Color3.new(c.R * dc.R / 0.7, c.G * dc.G / 0.7, c.B * dc.B / 0.7)
		return c:Lerp(dcol, wD)
	end

	-- 1. the body
	if prof then
		for _, sl in prof do
			local zc, rc = sl.z, sl.rc
			-- the ragged tip: the condensation thins over the funnel's lowest TIP_RAG, by noise
			local rag = math.clamp((zc - v.tip) / math.max(1, p("TIP_RAG") * L) + 0.35 * VA.noise(T / 3, zc / math.max(5, v.R), 3.3, seed), 0, 1)
			local A = (1 - math.exp(-sl.tau[1])) * rag * rag * (3 - 2 * rag)
			local dx, dy, bulge = large(zc, rc)
			sl.dx, sl.dy = dx, dy -- (this step's shape, for the tracers)
			local cx, cy = axisAt(zc)
			local wS = p("BODY_WIDE") * rc * bulge * V
			local hS = math.min(p("BODY_TALL") * sl.step * V, wS * 1.6)
			local layers = TEX_MEAN * hS / math.max(1, sl.step * V) * 1.2
			put(cx + dx * V, cy - dy * V, zc * V, wS, hS, colour(bodyTone(zc), 1), share(A, layers), (zc * 7 + seed) % 360, PuffView.TEXTURE, false)
		end
		-- the collar: a few darker shredded puffs just under the base round the funnel's top, turning
		-- with it at the swirl's rate there (each lives COLLAR_LIFE on the shared clock, formed at a
		-- hashed angle) - it hides the joint, so the funnel flares into the lowering with no rim
		local top = prof[#prof]
		local rT = math.max(top.rc, v.R)
		local zC = math.max(v.tip, v.Bt - 0.08 * math.max(L, 1))
		local vtC = VA.flow(v, p("COLLAR_R") * rT, zC)
		local omC = vtC / math.max(1, p("COLLAR_R") * rT)
		local lifeC = p("COLLAR_LIFE")
		local Atop = 1 - math.exp(-top.tau[1])
		for q = 1, math.floor(p("COLLAR_N")) do
			local tt = T + ((q * 0.618034) % 1) * lifeC
			local cyC = math.floor(tt / lifeC)
			local ageC = tt - cyC * lifeC
			local d = slotDraw(self.subs, seed + 23, 100 + q, cyC)
			local th = d.a * 2 * math.pi + omC * ageC
			local rr = rT * (1.2 + 0.8 * d.b)
			local zq = zC - 0.06 * L * d.c
			local cx, cy = axisAt(zq)
			local size = p("COLLAR_SIZE") * rT * (0.8 + 0.4 * d.d) * V
			local A = p("COLLAR_ALPHA") * Atop * math.sin(math.pi * ageC / lifeC)
			put(cx + math.cos(th) * rr * V, cy - math.sin(th) * rr * V, zq * V, size * 1.3, size, colour(self.baseCol, p("COLLAR_DARK") + 0.2 * self.lightK * math.cos(th - self.lightA)), share(A, TEX_MEAN * 2), math.floor(d.e * 360), PuffView.TEXTURE, false)
		end
	end

	-- 2. the structure: tracers on the flow. Slot i lives in cycles of STRUCT_LIFE on the shared
	-- clock (staggered by slot); each cycle starts it at a hashed height, radius share and angle, and
	-- at age a it has risen a * w (the core's rise at its radius) and turned a * vt / r (the vortex's
	-- swirl there) - the path the flow takes it on, the same wherever it is drawn
	local nS = math.floor(p("STRUCT_MAX") * lod + 0.5)
	if prof then
		local life = p("STRUCT_LIFE")
		local lamS = p("STRUCT_LEN") * math.max(v.R, 10)
		for i = 1, nS do
			local off = ((i * 0.618034) % 1) * life
			local tt = T + off
			local cy = math.floor(tt / life)
			local age = tt - cy * life
			local d = slotDraw(self.tracers, seed, i, cy)
			if not d.clump then
				local cl = VA.fbm(2 * math.cos(d.c * 2 * math.pi), 2 * math.sin(d.c * 2 * math.pi), d.a * L / lamS, seed + 401, 3, 0.45)
				d.clump = math.clamp((cl + 0.15) / 0.6, 0, 1)
			end
			if d.clump > 0 then
				local rf = 0.15 + 0.6 * math.sqrt(d.b)
				local z0 = v.tip + d.a * L
				local rc0 = lookup(z0, rf)
				local _, _, w0 = VA.flow(v, rf * rc0, z0)
				local u = d.a + age * math.max(w0, 1) / math.max(L, 1)
				if u < 1 then
					local z = v.tip + u * L
					local rc, tau, dx, dy = lookup(z, rf)
					local r = rf * rc
					local vt = VA.flow(v, r, z)
					local th = d.c * 2 * math.pi + vt / math.max(r, 1) * age
					local window = math.sin(math.pi * age / life) * math.clamp((1 - u) / 0.08, 0, 1)
					local A = (1 - math.exp(-tau)) * d.clump * window * p("STRUCT_ALPHA")
					local cx, cy2 = axisAt(z)
					local ox, oy = (dx + math.cos(th) * r) * V, (dy + math.sin(th) * r) * V
					-- lit on the open sky's side, dimmer away from it
					local side = math.cos(th - self.lightA)
					local facing = math.cos(th - viewA)
					local kL = 1 + self.lightK * side - 0.08 * (1 - facing)
					local size = p("STRUCT_SIZE") * rc * V
					put(cx + ox, cy2 - oy, z * V, size, size * 1.15, colour(self.baseCol, kL), share(A, TEX_MEAN * 2), math.floor(d.d * 360), PuffView.TEXTURE, false)
				end
			end
		end
	end

	-- 3. subvortices, from the swirl ratio
	local n, st = VA.subvortices(v)
	if st > 0.01 then
		local Rs, Ps, omO = VA.subvortex(v, n, st)
		local pP = VA.parentP(v)
		local subLife = p("SUB_LIFE")
		local atR = VA.rankineDrop(v.R, v.R, pP)
		-- (slot q: two staggered lives, each a subvortex formed at a hashed angle round the core that
		-- orbits at the parent's rate and decays - the orbit is its age's turn, not an integrated angle)
		for slot = 0, 2 * math.ceil(n) - 1 do
			local q = slot // 2
			local tt = T + ((slot % 2) * 0.5 + (q * 0.37) % 1) * subLife
			local cyS = math.floor(tt / subLife)
			local ageS = tt - cyS * subLife
			local dS = slotDraw(self.subs, seed + 5, slot, cyS)
			local pres = math.clamp(n - q, 0, 1) * st * math.sin(math.pi * ageS / subLife)
			if pres > 0.01 then
				local orbit = (q / math.max(1, n) + 0.5 * (slot % 2) / math.max(1, n) + 0.3 * (dS.a - 0.5)) * 2 * math.pi + omO * ageS
				local zTip = math.max(0, v.Bt - (atR + Ps) / v.rhoG)
				local zTop = v.Bt
				local m = p("SUB_SLICES")
				for s = 0, m - 1 do
					local z = zTip + (s + 0.5) / m * (zTop - zTip)
					-- the orbit's angle here: the air took z / w to rise this far while the orbit turned
					local a = orbit + omO * z / math.max(2, wRise)
					local need = v.rhoG * math.max(0, v.Bt - z) - atR
					local rs
					if need <= 0 then rs = Rs * 1.4
					elseif need >= Ps then rs = 0
					elseif need >= Ps / 2 then rs = Rs * math.sqrt(2 * (1 - need / Ps))
					else rs = math.min(Rs * 1.4, Rs * math.sqrt(Ps / (2 * need))) end
					if rs > 0.5 then
						local above = (atR + VA.rankineDrop(0.5 * rs, Rs, Ps)) / v.rhoG - (v.Bt - z)
						local A = 1 - math.exp(-VA.beta(above, v.rho) * 2 * rs)
						local cx, cy = axisAt(z)
						local ox, oy = math.cos(a) * v.R * V, math.sin(a) * v.R * V
						local wS = p("SUB_WIDE") * rs * V
						local hS = math.min(wS * 1.6, 2.2 * (zTop - zTip) / m * V)
						put(cx + ox, cy - oy, z * V, wS, hS, colour(self.baseCol, 1 + self.lightK * math.cos(a - self.lightA)), share(A * pres, TEX_MEAN * 2), (slot * 53 + s * 17) % 360, PuffView.TEXTURE, false)
					end
				end
			end
		end
	end

	-- 4. the dust: its own layer on the flow, round a lagging ground point
	local rd = VA.dustRadius(v, v.groundMs)
	local lag = 1 - math.exp(-dt / p("DUST_LAG_S"))
	self.dgx = if self.dgx then self.dgx + lag * (v.gx - self.dgx) else v.gx
	self.dgy = if self.dgy then self.dgy + lag * (v.gy - self.dgy) else v.gy
	-- (each puff slot lives DUST_LIFE on the shared clock, from a hashed start on the ground; its
	-- place at an age is its path on the vortex's flow from there, stepped every DUST_STEP)
	local nD = math.floor(p("DUST_MAX") * math.max(lod, 0.4) + 0.5)
	if rd > v.R then
		local life, depth = p("DUST_LIFE"), VA.param("DUST_DEPTH_K") * rd
		local stepS = p("DUST_STEP")
		local c = self.baseCol
		local dc = p("DUST_TINT") :: any
		local dcol = Color3.new(c.R * dc.R / 0.7, c.G * dc.G / 0.7, c.B * dc.B / 0.7)
		for i = 1, nD do
			local tt = T + ((i * 0.754877) % 1) * life
			local cyD = math.floor(tt / life)
			local age = tt - cyD * life
			local d = slotDraw(self.dust, seed + 11, i, cyD)
			local r, th, z = rd * (0.4 + 0.8 * d.a), d.b * 2 * math.pi, d.c * 0.05 * rd
			local done = 0
			while done < age do
				local h = math.min(stepS, age - done)
				local vt, vr, w = VA.flow(v, math.max(r, 1), z)
				-- lofted by the turbulence round the vortex, and spreading out aloft (APPROX: DUST_RISE_K, DUST_OUT_K)
				w += p("DUST_RISE_K") * vt
				vr += p("DUST_OUT_K") * vt * (1 - math.exp(-z / VA.param("INFLOW_M")))
				th += vt / math.max(r, 1) * h
				r = math.max(0.3 * v.R, r + vr * h)
				z += w * h
				done += h
			end
			if z <= 2.5 * depth and r <= 2.5 * rd then
				-- how hard the ground wind lifts where it is, how high it is now, its age
				local lift = math.clamp((v.V * v.R / math.max(r, v.R) + v.groundMs - VA.param("DUST_MS")) / VA.param("DUST_MS"), 0, 1)
				local ageW = math.sin(math.pi * math.clamp(age / life, 0, 1))
				local A = p("DUST_ALPHA") * lift * math.exp(-z / depth) * ageW * math.clamp(rd / v.R - 1, 0, 1)
				local size = p("DUST_SIZE") * rd * (0.5 + 0.5 * math.min(1, z / rd + r / rd)) * V
				local ox, oy = math.cos(th) * r * V, math.sin(th) * r * V
				local kL = 1 + 0.6 * self.lightK * math.cos(th - self.lightA)
				-- (offsets from the vortex's ground point, so from the lagging one: its offset plus the puff's)
				put(self.dgx - v.gx + ox, self.dgy - v.gy - oy, z * V, size, size * 0.8, colour(dcol, kL), A, math.floor(d.d * 360), PuffView.TEXTURE, true)
			end
		end
	end

	-- (debugOnly: the overlay alone, the game's card tornado drawing the funnel - EngineStormsController)
	if self.debugOnly then
		for x = 1, k do self.guis[x].Enabled = false end
		k = 0
	end
	for x = k + 1, self.shown do self.guis[x].Enabled = false end
	self.shown = k
	if TornadoView.debugOn() then
		local ok, err = pcall(TornadoView.debugDraw, self, v, V, axisAt)
		if not ok and not self.dbgErr then
			self.dbgErr = true
			warn("[TornadoView] debug draw failed: " .. tostring(err))
		elseif ok and not self.dbgSaid then
			self.dbgSaid = true
			print(("[TornadoView] debug on: core %.0f m, base %.0f m, %d puffs"):format(v.R, v.Bt, k))
		end
	else
		debugHide(self)
	end
end

function TornadoView.destroy(self: any)
	if self.dbg then
		self.dbg.holder:Destroy()
		self.dbg.gui:Destroy()
	end
	self.anchor:Destroy()
	for _, g in self.guis do g:Destroy() end
end

return TornadoView
