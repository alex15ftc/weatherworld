--!nonstrict
--!native
-- The storm's low cloud (lowering, wall cloud, funnel) drawn as samples of the cloud field
-- (Sim/CloudField; docs/stormlab/PHYSICAL-VOLUME-PLAN.md, phase 3, 2026-11-03). Backspace switches
-- it on; WallStream and TornadoCards then stand down.
--
-- Nothing here shapes a part. The field says where the air is cloud; the cards sample it:
--   wall    the condensation surface under the base: air past its condensation level zc(x, y) is
--           cloud up to the base, so the lowering is the surface z*(x, y) = zc and the cloud
--           between it and the base. Each card is a parcel on that surface carried by the wind
--           (World.windAt at z*), so the lowering turns with the circulation; parcels are born
--           where the surface is pulled down and no parcel covers it, and fade where it isn't
--           (the lowering rising, the circulation weakening). Where the funnel is narrower than
--           the parcels' spacing, the funnel below draws it.
--   funnel  slices along the tornado's axis, each as wide as the field's own condensed radius
--           there (found by bisection), and two tags per slice on its surface that orbit at the
--           vortex's own wind - the rotation seen. From the funnel's tip up to where it is as wide
--           as the wall's spacing (it has flared into the lowering), so the two meet as one.
-- Each card is the on-screen ellipse of the 3-D patch it stands for: the patch's half-extents
-- (along the surface, its depth; along the axis and across a slice) projected on the camera's
-- right and up, their covariance's axes the card's width, height and turn. So a patch seen from
-- below is round, from the side a band, at any camera turn - nothing is turned to the screen.
-- Its opacity is Beer-Lambert through the patch along the sight line: 1 - exp(-tau), tau the
-- field's extinction along the chord (the wall slab: sigma of its mean water x the chord through
-- its box; a slice: the field marched across it). Stacked cards then give the cloud's own
-- transmittance. Light: the sun marched through the field toward the sun (and, once out of the
-- low cloud, the storm's body above, SceneLight.sun, if the ray leaves through the base), sky
-- light from the open side (SceneLight.skyDir) marched the same way.
local Workspace = game:GetService("Workspace")
local UIS = game:GetService("UserInputService")

local VolumeCards = {}

local MAXV = 2 -- volumes (nearest circulations)
local RANGE = 30000 -- m
local NW = 600 -- wall parcels a volume
-- (the wall's spacing by distance: about THETA of the view a parcel, in steps of 2 from H0 - each
-- step a lattice of its own; a parcel off its step by more than 0.75 of one fades and the right
-- one is born. THETA follows the budget)
local H0, HMAX = 25, 800
local NLEV = 6
local NL = 110 -- funnel slices a volume (3 cards each)
local SPAWN_T = 0.5 -- s, the wall's spawn pass
local LIGHT_T = 1.0 -- s, a parcel's light
local FUNNEL_T = 0.25 -- s, the funnel's slice list
local FADE_T = 0.8
local SEAT_T = 0.2 -- s between a wall parcel's re-seats on the surface
-- (frame-time split, printed with the stats every 5 s)
local prof = { frames = 0, total = 0, spawn = 0, seat = 0, light = 0, marches = 0 } -- s, a parcel's birth and death
local KAPPA = 1.5 * 1.15 / (1000 * 10e-6) -- sigma per (kg/kg) of cloud water (CloudField.sigmaOf, liquid)
local FIT = 1.7 -- card diameter over 2 sigma of its patch: the puff's soft rim covers the gap to the next
local WFIT = 2.8 -- the wall's haze cards: wider, sharing their cell's optical depth
local exp, sqrt, cos, sin, max, min, clamp, abs, floor = math.exp, math.sqrt, math.cos, math.sin, math.max, math.min, math.clamp, math.abs, math.floor
local TAU = 2 * math.pi

local function smooth(a: number, b: number, x: number): number
	local t = clamp((x - a) / (b - a), 0, 1)
	return t * t * (3 - 2 * t)
end
local function rnd(i: number, salt: number): number
	local v = sin(i * 12.9898 + salt * 78.233) * 43758.5453
	return v - floor(v)
end

function VolumeCards.new(ctx: any): any
	local C = ctx.Config
	local Sim = ctx.Sim
	local CloudField = Sim.CloudField
	local Vortex = Sim.Vortex
	local SceneLight = ctx.Tornado.SceneLight
	local self = {}
	local folder = Instance.new("Folder")
	folder.Name = "VolumeCards"
	folder.Parent = ctx.root
	local anchor = Instance.new("Part")
	anchor.Name = "VolumeAnchor"
	anchor.Anchored, anchor.CanCollide, anchor.CanQuery, anchor.CanTouch = true, false, false, false
	anchor.Transparency = 1
	anchor.Size = Vector3.one
	anchor.Parent = folder
	UIS.InputBegan:Connect(function(input, processed)
		if not processed and input.KeyCode == Enum.KeyCode.Backspace then
			ctx.state.physVolume = not ctx.state.physVolume
			print("[volume] physical low cloud " .. (if ctx.state.physVolume then "on" else "off"))
		end
	end)

	local TEX = {
		haze = if (C.TEXTURES.hazePuffFlat or "") ~= "" then C.TEXTURES.hazePuffFlat else C.TEXTURES.smoothPuffFlat,
		soft = C.TEXTURES.smoothPuffFlat,
		s2 = if (C.TEXTURES.smoothPuffSharp2 or "") ~= "" then C.TEXTURES.smoothPuffSharp2 else C.TEXTURES.smoothPuffFlat,
		s4 = if (C.TEXTURES.smoothPuffSharp4 or "") ~= "" then C.TEXTURES.smoothPuffSharp4 else C.TEXTURES.smoothPuffFlat,
	}
	local camS, pxK = Vector3.zero, 0
	local nCards = 0
	local pool = {}
	local function newCard(): any
		nCards += 1
		local att = Instance.new("Attachment")
		att.Parent = anchor
		local bb = Instance.new("BillboardGui")
		bb.Adornee = att
		bb.LightInfluence = 0
		bb.Size = UDim2.fromScale(10, 10)
		bb.Enabled = false
		bb.ResetOnSpawn = false
		-- (the turned ellipse may reach past the square box's edge: unclipped, the soft rim stays)
		bb.ClipsDescendants = false
		local img = Instance.new("ImageLabel")
		img.BackgroundTransparency = 1
		img.AnchorPoint = Vector2.new(0.5, 0.5)
		img.Position = UDim2.fromScale(0.5, 0.5)
		img.Size = UDim2.fromScale(1, 1)
		img.Image = TEX.soft
		img.ImageTransparency = 1
		img.Parent = bb
		bb.Parent = anchor
		return { att = att, bb = bb, img = img, on = false, tex = TEX.soft }
	end
	local function acquire(): any
		local c = table.remove(pool)
		return c or newCard()
	end
	local function setOn(c: any, v: boolean)
		if c.on ~= v then
			c.on = v
			c.bb.Enabled = v
		end
	end
	local function release(c: any)
		setOn(c, false)
		table.insert(pool, c)
	end
	-- (writes only for changes that show: half a pixel, 1/500 in colour or opacity)
	local function setPos(c: any, wp: Vector3)
		if c.wp == nil or (wp - c.wp).Magnitude > pxK * (wp - camS).Magnitude then
			c.wp = wp
			c.att.WorldPosition = wp
		end
	end
	local function setTr(c: any, tr: number)
		if c.trW == nil or abs(tr - c.trW) > 0.002 or (tr >= 1 and c.trW ~= tr) then
			c.trW = tr
			c.img.ImageTransparency = tr
		end
	end
	local function setCol(c: any, col: Color3)
		local l = c.col
		if not l or abs(col.R - l.R) > 0.002 or abs(col.G - l.G) > 0.002 or abs(col.B - l.B) > 0.002 then
			c.col = col
			c.img.ImageColor3 = col
		end
	end
	local function setTex(c: any, tex: string)
		if c.tex ~= tex then
			c.tex = tex
			c.img.Image = tex
		end
	end
	-- the card as the screen ellipse of half-extents a1..a3 (studs, world vectors): a square box of
	-- the major axis, the image the ellipse inside it, turned
	local cf = CFrame.identity
	local function shape(c: any, a1: Vector3, a2: Vector3, a3: Vector3, fit: number?)
		local FIT = fit or FIT
		local R, U = cf.RightVector, cf.UpVector
		local r1, u1 = a1:Dot(R), a1:Dot(U)
		local r2, u2 = a2:Dot(R), a2:Dot(U)
		local r3, u3 = a3:Dot(R), a3:Dot(U)
		local crr = r1 * r1 + r2 * r2 + r3 * r3
		local cuu = u1 * u1 + u2 * u2 + u3 * u3
		local cru = r1 * u1 + r2 * u2 + r3 * u3
		local tr, df = 0.5 * (crr + cuu), sqrt(max(0, 0.25 * (crr - cuu) ^ 2 + cru * cru))
		local l1, l2 = sqrt(max(tr + df, 1e-6)), sqrt(max(tr - df, 1e-6))
		local ang = 0.5 * math.atan2(2 * cru, crr - cuu) -- (the major axis from screen right, counter-clockwise)
		local wS, hS = 2 * FIT * l1, 2 * FIT * max(l2, 0.08 * l1)
		local S = wS
		local thr = pxK * ((c.wp or camS) - camS).Magnitude
		if c.S == nil or abs(S - c.S) > thr or abs(hS - c.hS) > thr then
			c.S, c.hS = S, hS
			c.bb.Size = UDim2.fromScale(S, S)
			c.img.Size = UDim2.fromScale(1, hS / S)
		end
		local rot = -math.deg(ang)
		local rthr = math.deg(thr / max(0.5 * S, 1e-3))
		if c.rotW == nil or abs(rot - c.rotW) > rthr then
			c.rotW = rot
			c.img.Rotation = rot
		end
	end

	local vols = {} -- by storm id
	local function stormTornado(s: any): any?
		local ad = ctx.tornadoAdapter
		if not ad then
			return nil
		end
		local best, bv = nil, 0
		for _, e in ad.entries do
			if e.params and (e.fade or 1) > 0.05 and e.snap and e.snap.parentId ~= nil and tostring(e.snap.parentId) == tostring(s.id) then
				if (e.vc or 0) > bv then
					best, bv = e, e.vc or 0
				end
			end
		end
		return best
	end

	-- the condensation surface under the base at (x, y): z* (the fixed point of zc(x, y, z*) =
	-- z*; the tornado's deficit varies with height) and the cloud's lowering there (base - z*)
	local function surfaceAt(s: any, tor: any?, x: number, y: number, z0: number?): number
		local z = z0 or (s.base - 1)
		for _ = 1, 3 do
			local zc = CloudField.condLevel(s, tor, x, y, max(z, 0))
			if abs(zc - z) < 2 then
				z = zc
				break
			end
			z = zc
		end
		return clamp(z, 0, s.base)
	end

	-- light at a point of the low cloud: the sun's transmittance (marched through the field toward
	-- the sun; past the base, the storm's body above it if the ray leaves through cloud there) and
	-- the sky's (toward the open side)
	local function lightAt(s: any, tor: any?, x: number, y: number, z: number, L: any, step: number): (number, number)
		local sd = L.sunDir
		-- (sim axes from Roblox's: x east, y north = -Z, z up)
		local sx, sy, sz = sd.X, -sd.Z, sd.Y
		local ts = 0
		if sz > 0.02 then
			local tau = 0
			local px, py, pz = x, y, z
			for _ = 1, 24 do
				px += sx * step
				py += sy * step
				pz += sz * step
				if pz > s.base + 40 then
					break
				end
				local q, ice = CloudField.storm(s, tor, px, py, pz)
				tau += CloudField.sigmaOf(q, ice) * step
				if tau > 8 then
					break
				end
			end
			ts = exp(-tau)
			if ts > 0.01 and pz > s.base then
				-- (out through the base: under the storm's body, its light; else the open sky's sun)
				local qb = CloudField.storm(s, tor, px, py, s.base + 40)
				if qb > 0 then
					ts *= L.sunBody
				end
			end
		end
		local dx, dy = L.skyX or 0, L.skyY or 0
		local tau = 0
		local px, py, pz = x, y, z
		for _ = 1, 10 do
			px += dx * step * 2
			py += dy * step * 2
			pz += 0.3 * step * 2
			local q, ice = CloudField.storm(s, tor, px, py, pz)
			tau += CloudField.sigmaOf(q, ice) * step * 2
			if tau > 6 then
				break
			end
		end
		return ts, exp(-tau)
	end
	local function colourOf(L: any, ts: number, tsk: number, albedo: number): Color3
		local Lt = L.tmp
		Lt.sun = ts * L.sunAmt
		Lt.sky = L.sky * (0.35 + 0.65 * tsk)
		return SceneLight.shade(Lt, albedo, 0.85)
	end

	local function newVol(id: any): any
		return { id = id, wall = {}, layers = {}, spawnAt = -1e9, funAt = -1e9, h = 150, theta = 0.13, cells = {}, area = 0, lightCache = {}, cacheAt = 0 }
	end
	local function dropVol(v: any)
		for _, p in v.wall do
			release(p.c)
		end
		table.clear(v.wall)
		for _, l in v.layers do
			for _, c in l.cards do
				release(c)
			end
		end
		table.clear(v.layers)
	end

	-- the wall's spacing wanted at a point (m) and its step
	local camX, camY, camZ = 0, 0, 0
	local function wantH(v: any, x: number, y: number, z: number): number
		local d = sqrt((x - camX) ^ 2 + (y - camY) ^ 2 + (z - camZ) ^ 2)
		return clamp(v.theta * d, H0, HMAX)
	end
	local function levelOf(h: number): number
		return clamp(math.log(h / H0, 2), 0, NLEV)
	end

	-- the wall: spawn where the surface is pulled down and no parcel covers it (each step's own
	-- lattice, where that step is wanted); extra parcels in one cell and parcels off the lowering
	-- or off their step retire
	local function spawnPass(v: any, s: any, tor: any?, cx: number, cy: number, HB: number, zF: number)
		local cells = {}
		local n = 0
		for _, p in v.wall do
			if not p.dying then
				local k = p.lv * 1e12 + floor(p.x / p.h) * 100003 + floor(p.y / p.h)
				if cells[k] then
					p.dying = true
				else
					cells[k] = true
					n += 1
				end
			end
		end
		local count = 0
		local gamma = s.gammaL or 2e-6
		local zMid = 0.7 * s.base
		for lv = 0, NLEV do
			local h = H0 * 2 ^ lv
			-- (where this step is wanted: theta d within [h / sqrt2, h sqrt2] - a ring round the camera)
			local dMin = if lv == 0 then 0 else h / (math.sqrt(2) * v.theta)
			local dMax = if lv == NLEV then 1e9 else h * math.sqrt(2) / v.theta
			if dMin < 2 * HB + sqrt((cx - camX) ^ 2 + (cy - camY) ^ 2) then
				local bx0, bx1 = max(cx - HB, camX - dMax), min(cx + HB, camX + dMax)
				local by0, by1 = max(cy - HB, camY - dMax), min(cy + HB, camY + dMax)
				if bx0 < bx1 and by0 < by1 then
					local i0, i1 = floor(bx0 / h), floor(bx1 / h)
					local j0, j1 = floor(by0 / h), floor(by1 / h)
					for j = j0, j1 do
						for i = i0, i1 do
							-- (each cell's sample point jittered by the cell, the same every pass)
							local x = (i + 0.2 + 0.6 * rnd(i * 7 + j + lv * 31, 1)) * h
							local y = (j + 0.2 + 0.6 * rnd(i + j * 13 + lv * 17, 2)) * h
							if (x - cx) ^ 2 + (y - cy) ^ 2 < HB * HB then
								local hw = wantH(v, x, y, zMid)
								if abs(levelOf(hw) - lv) <= 0.5 then
									local z = surfaceAt(s, tor, x, y)
									local D = s.base - z
									-- (a layer too thin to see from below: its column's optical depth,
									-- tau = kappa gamma D^2 / 2, under 0.05)
									-- (and a step under the base too small against the spacing to show: the
									-- base deck draws it - StormCards)
									if D > max(30, 0.25 * h) and KAPPA * gamma * D * D * 0.5 > 0.05 and z > zF - 0.5 * h then
										count += 1
										local k = lv * 1e12 + i * 100003 + j
										if not cells[k] and n < NW then
											cells[k] = true
											n += 1
											local c = acquire()
											table.insert(v.wall, { x = x, y = y, z = z, h = h, lv = lv, c = c, a = 0, seed = rnd(i, j), lightAt = -1e9, ts = 0.2, tsk = 0.5, gx = 0, gy = 0 })
										end
									end
								end
							end
						end
					end
				end
			end
		end
		-- the budget: theta up when there are more than it, down when well under
		v.area = count
		if count > 0.9 * NW then
			v.theta *= 1.15
		elseif count < 0.6 * NW then
			v.theta = max(0.012, v.theta / 1.1)
		end
		v.theta = clamp(v.theta, 0.012, 0.4)
	end

	-- the funnel's condensed radius at height z (0 if not condensed on the axis), by bisection
	local function edgeAt(s: any, tor: any, z: number, rMax: number): (number, number, number)
		local p = tor.params
		local ax, ay = Vortex.axisAt(p, z)
		local x0, y0 = tor.x + ax, tor.y + ay
		if CloudField.storm(s, tor, x0, y0, z) <= 0 then
			return 0, x0, y0
		end
		local lo, hi = 0, rMax
		if CloudField.storm(s, tor, x0 + hi, y0, z) > 0 then
			return hi, x0, y0
		end
		for _ = 1, 12 do
			local mid = 0.5 * (lo + hi)
			if CloudField.storm(s, tor, x0 + mid, y0, z) > 0 then
				lo = mid
			else
				hi = mid
			end
		end
		return 0.5 * (lo + hi), x0, y0
	end

	-- the slices: from the funnel's tip to zF, each ~0.7 of its radius tall
	local function funnelPass(v: any, s: any, tor: any): number
		local p = tor.params
		local H = max(100, p.cloudBase or s.base)
		local h = v.h
		local rMax = max(3000, 6 * (tor.rc or 100))
		-- zF: where the funnel is as wide as the wall's spacing (above it the wall draws it)
		local zF = H
		local zs = {}
		local z = 0
		local tip = nil
		local guard = 0
		while z < H and guard < 400 do
			guard += 1
			local r = edgeAt(s, tor, z, rMax)
			if r > 0 and not tip then
				tip = z
			end
			if r >= h then
				zF = z
				break
			end
			if r > 0 then
				table.insert(zs, { z = z, r = r })
			end
			z += clamp(0.7 * max(r, 1), max(4, H / NL), 200)
		end
		local layers = v.layers
		local nKeep = min(#zs, NL)
		for i = 1, nKeep do
			local l = layers[i]
			if not l then
				l = { cards = { acquire(), acquire(), acquire() }, th = { rnd(i, 5) * TAU, rnd(i, 6) * TAU }, a = 0 }
				layers[i] = l
			end
			local zi = zs[i]
			local dzN = if zs[i + 1] then zs[i + 1].z - zi.z else 0.7 * zi.r
			l.z, l.r, l.dz, l.live = zi.z, zi.r, max(dzN, 2), true
		end
		for i = nKeep + 1, #layers do
			layers[i].live = false
		end
		return zF
	end

	-- the sight line's optical depth across the funnel at height z, offset b from its axis (sim
	-- metres; dirx, diry the horizontal view direction, unit)
	local function chordTau(s: any, tor: any, x0: number, y0: number, z: number, r: number, b: number, dirx: number, diry: number): number
		-- (across the view: the perpendicular)
		local nx, ny = -diry, dirx
		local half = sqrt(max(r * r - b * b, 0))
		if half <= 0 then
			return 0
		end
		local tau = 0
		local N = 8
		local ds = 2 * half / N
		for k = 0, N - 1 do
			local t = -half + (k + 0.5) * ds
			local x, y = x0 + nx * b + dirx * t, y0 + ny * b + diry * t
			local q, ice = CloudField.storm(s, tor, x, y, z)
			tau += CloudField.sigmaOf(q, ice) * ds
		end
		return tau
	end

	local Lc = {} -- per volume light
	function self:update(dt: number)
		local t0 = os.clock()
		local cw = ctx.cw
		local on = ctx.state.physVolume and cw and cw.storms and ctx.state.show.clouds ~= false
		local cam = Workspace.CurrentCamera
		cf = cam.CFrame
		local camPos = cf.Position
		camS = camPos
		pxK = 0.5 * 2 * math.tan(math.rad(cam.FieldOfView) / 2) / max(cam.ViewportSize.Y, 1)
		local want = {}
		if on then
			local mx, my = C.fromWorld(camPos)
			local list = {}
			for _, s in cw.storms do
				if not s.dead and s.cLowX then
					local tor = stormTornado(s)
					if math.abs(s.vlow or 0) > 3 or tor then
						local d = sqrt((s.cLowX - mx) ^ 2 + (s.cLowY - my) ^ 2)
						if d < RANGE then
							table.insert(list, { s = s, tor = tor, d = d })
						end
					end
				end
			end
			table.sort(list, function(a, b)
				return a.d < b.d
			end)
			for i = 1, min(MAXV, #list) do
				want[list[i].s.id] = list[i]
			end
		end
		for id, v in vols do
			if not want[id] then
				dropVol(v)
				vols[id] = nil
			end
		end
		local nDrawn = 0
		local now = os.clock()
		for id, it in want do
			local s, tor = it.s, it.tor
			local v = vols[id]
			if not v then
				v = newVol(id)
				vols[id] = v
			end
			camX, camY, camZ = C.fromWorld(camPos)
			local cx, cy = s.cLowX, s.cLowY
			if tor then
				local H = max(100, tor.params.cloudBase or s.base)
				local ax, ay = Vortex.axisAt(tor.params, H)
				cx, cy = tor.x + ax, tor.y + ay
			end
			local R = 0.3 * (s.Ru or 3000)
			local HB = clamp(3 * R, 1500, 5000)
			local ks = C.scaleAbout(cx, cy)
			-- light here (twice a second): the sky and sun above the low cloud, the body's shade
			local L = Lc[id]
			if not L or now - L.at > 0.5 then
				local Ls = SceneLight.sample(ctx, cx, cy, s.base + 50)
				local sdx, sdy = SceneLight.skyDir(ctx, cx, cy, s.base * 0.5)
				-- (the sun with no cloud in the way: SceneLight.sample's own sun is the storm's
				-- shapes' transmittance - the body over the base)
				local elev = Ls.sunDir.Y
				L = {
					at = now, sky = Ls.sky, sunDir = Ls.sunDir, night = Ls.night,
					sunAmt = if elev > 0 then smooth(0, 0.15, elev) else 0,
					sunBody = clamp(Ls.sun / max(smooth(0, 0.15, elev), 0.05), 0, 1),
					skyX = sdx, skyY = sdy,
					tmp = { sun = 0, sky = 0, sunDir = Ls.sunDir, flash = 0, night = Ls.night },
				}
				Lc[id] = L
			end
			-- the funnel's slice list (4 x a second) and where the wall takes over
			local zF = 0
			if tor then
				if now - v.funAt > FUNNEL_T then
					v.funAt = now
					v.h = H0 * 2 ^ floor(levelOf(wantH(v, cx, cy, 0.5 * s.base)) + 0.5)
					v.zF = funnelPass(v, s, tor)
				end
				zF = v.zF or 0
			else
				for _, l in v.layers do
					l.live = false
				end
			end
			-- (old light cells cleared every few seconds)
			if now - v.cacheAt > 4 * LIGHT_T then
				v.cacheAt = now
				for k, lc in v.lightCache do
					if now - lc.at > 2 * LIGHT_T then
						v.lightCache[k] = nil
					end
				end
			end
			if now - v.spawnAt > SPAWN_T then
				v.spawnAt = now
				local tq = os.clock()
				spawnPass(v, s, tor, cx, cy, HB, zF)
				prof.spawn += os.clock() - tq
			end
			local gamma = s.gammaL or 2e-6
			-- wall parcels
			local i = 1
			while i <= #v.wall do
				local pc = v.wall[i]
				-- (back on the surface and its wind read ~5 times a second, staggered: both change
				-- slowly along the parcel's path, and each seat is up to 3 field samples)
				-- (within ~5 core radii of the tornado its wind turns too fast for that: read each frame)
				local nearTor = tor ~= nil and (pc.x - tor.x) ^ 2 + (pc.y - tor.y) ^ 2 < (5 * (tor.rc or 100)) ^ 2
				if nearTor then
					pc.u, pc.w = cw:windAt(pc.x, pc.y, pc.z + 5)
				end
				if now - (pc.seatAt or -1e9) > SEAT_T * (0.8 + 0.4 * pc.seed) then
					pc.seatAt = now
					local tq = os.clock()
					pc.u, pc.w = cw:windAt(pc.x, pc.y, pc.z + 5)
					pc.z = surfaceAt(s, tor, pc.x, pc.y, pc.z)
					prof.seat += os.clock() - tq
				end
				pc.x += (pc.u or 0) * dt
				pc.y += (pc.w or 0) * dt
				local D = s.base - pc.z
				local dc = sqrt((pc.x - cx) ^ 2 + (pc.y - cy) ^ 2)
				local offStep = abs(levelOf(wantH(v, pc.x, pc.y, 0.7 * s.base)) - pc.lv) > 0.75
				local alive = not pc.dying and not offStep and D > max(20, 0.18 * pc.h) and KAPPA * gamma * D * D * 0.5 > 0.05 and dc < HB and pc.z > zF - 0.5 * pc.h
				pc.a = if alive then min(1, pc.a + dt / FADE_T) else pc.a - dt / FADE_T
				if pc.a <= 0 and not alive then
					release(pc.c)
					v.wall[i] = v.wall[#v.wall]
					v.wall[#v.wall] = nil
					continue
				end
				i += 1
				local h = pc.h
				-- the surface's slope (with the light, once a second)
				if now - pc.lightAt > LIGHT_T * (0.8 + 0.4 * pc.seed) then
					pc.lightAt = now
					local tq = os.clock()
					-- (the slope: one-sided against the parcel's own seat, 2 samples not 4)
					local e = 0.5 * h
					pc.gx = (surfaceAt(s, tor, pc.x + e, pc.y, pc.z) - pc.z) / e
					pc.gy = (surfaceAt(s, tor, pc.x, pc.y + e, pc.z) - pc.z) / e
					-- (the light: shared by the parcels in a cell of ~2 h - it varies over the cloud's
					-- scale, not the parcel's - each cell marched once every LIGHT_T)
					local zl = pc.z + 0.3 * min(D, h)
					local cs = clamp(2 * h, 80, 600)
					local key = floor(pc.x / cs) * 73856093 + floor(pc.y / cs) * 19349663 + floor(zl / cs) * 83492791 + pc.lv
					local lc = v.lightCache[key]
					if not lc or now - lc.at > LIGHT_T then
						local ts, tsk = lightAt(s, tor, pc.x, pc.y, zl, L, max(30, 0.5 * h))
						lc = { at = now, ts = ts, tsk = tsk }
						v.lightCache[key] = lc
						prof.marches += 1
					end
					pc.ts, pc.tsk = lc.ts, lc.tsk
					prof.light += os.clock() - tq
				end
				-- the patch: h x h along the surface, the cloud's depth above it (its lower part:
				-- deeper than ~1.5 h it is hidden behind its own near side)
				local depth = min(D, h)
				local zc = pc.z + 0.5 * depth
				local wp = C.toWorldAbout(pc.x, pc.y, zc, cx, cy, ks)
				local c = pc.c
				setPos(c, wp)
				local hh = 0.5 * h * ks
				-- (wide haze cards, each its cell's optical depth shared among the ~pi/4 WFIT^2 that
				-- overlap a point: the stack still gives the cell's own transmittance, but smooth)
				shape(c, Vector3.new(hh, pc.gx * hh, 0), Vector3.new(0, pc.gy * hh, -hh), Vector3.new(0, 0.5 * depth * ks, 0), WFIT)
				-- Beer-Lambert through the patch's box along the sight line
				local vd = wp - camPos
				local vm = max(vd.Magnitude, 1e-3)
				local vx, vy, vz = abs(vd.X) / vm, abs(vd.Z) / vm, abs(vd.Y) / vm
				local chord = min(D / max(vz, 1e-3), h / max(vx, 1e-3), h / max(vy, 1e-3))
				local qm = min(gamma * 0.5 * D, CloudField.QCAP)
				local tau = KAPPA * qm * chord / (0.785 * WFIT * WFIT)
				local op = (1 - exp(-tau)) * clamp(pc.a, 0, 1) * (1 - smooth(0.8 * HB, HB, dc))
				-- (the haze puff: no rim, so the stacked parcels read as one surface, not bubbles)
				setTex(c, TEX.haze)
				setTr(c, 1 - clamp(op, 0, 0.98))
				setCol(c, colourOf(L, pc.ts, pc.tsk, 0.9))
				setOn(c, op > 0.004)
				nDrawn += 1
			end
			-- funnel slices
			if tor then
				local p = tor.params
				local H = max(100, p.cloudBase or s.base)
				local mx, my = C.fromWorld(camPos)
				for li, l in v.layers do
					l.a = if l.live then min(1, l.a + dt / 0.4) else l.a - dt / 0.4
					if l.a <= 0 then
						for _, c in l.cards do
							setOn(c, false)
						end
						continue
					end
					local z = l.z
					local ax, ay = Vortex.axisAt(p, z)
					local x0, y0 = tor.x + ax, tor.y + ay
					local bx, by = Vortex.axisAt(p, min(z + l.dz, H))
					local gz = C.groundAt(x0, y0)
					local function alt(zz: number): number
						return zz + gz * max(0, 1 - zz / H)
					end
					local wp = C.toWorldAbout(x0, y0, alt(z), cx, cy, ks)
					-- the axis's direction over this slice (world, studs, half length)
					local wq = C.toWorldAbout(tor.x + bx, tor.y + by, alt(min(z + l.dz, H)), cx, cy, ks)
					local ad = (wq - wp) * 0.65
					-- view direction, horizontal (sim)
					local dxv, dyv = x0 - mx, y0 - my
					local dl = max(sqrt(dxv * dxv + dyv * dyv), 1)
					dxv, dyv = dxv / dl, dyv / dl
					local r = l.r
					local rs = r * ks
					-- slice
					local c = l.cards[1]
					setPos(c, wp + ad)
					shape(c, Vector3.new(rs, 0, 0), Vector3.new(0, 0, rs), ad)
					local tau0 = chordTau(s, tor, x0, y0, z, r, 0, dxv, dyv)
					setTex(c, if tau0 > 6 then TEX.s4 elseif tau0 > 2 then TEX.s2 else TEX.soft)
					local lt = l.light
					if not lt or now - lt.at > LIGHT_T then
						local ts, tsk = lightAt(s, tor, x0, y0, z, L, max(20, 0.5 * r))
						lt = { at = now, ts = ts, tsk = tsk }
						l.light = lt
					end
					setTr(c, 1 - clamp((1 - exp(-tau0)) * l.a, 0, 0.98))
					setCol(c, colourOf(L, lt.ts, lt.tsk, 0.85))
					setOn(c, true)
					nDrawn += 1
					-- tags: orbiting at the vortex's wind at 0.85 r (counter-clockwise for a cyclonic
					-- tornado: the sign of its circulation), each lit by the side it is on
					local rt = 0.85 * r
					-- (the swirl's own turn: its north wind east of the axis less west of it, so the
					-- translation cancels; about the params' own axis point)
					local pax, pay = (p.x or tor.x) + ax, (p.y or tor.y) + ay
					local _, va = Vortex.sample(p, pax + rt, pay, z)
					local _, vb = Vortex.sample(p, pax - rt, pay, z)
					local om = (va - vb) / (2 * max(rt, 1))
					local sd = L.sunDir
					for k = 1, 2 do
						local th = l.th[k] + om * dt
						l.th[k] = th % TAU
						local ox, oy = cos(th) * rt, sin(th) * rt
						local tc = l.cards[1 + k]
						local tp = C.toWorldAbout(x0 + ox, y0 + oy, alt(z), cx, cy, ks) + ad
						setPos(tc, tp)
						local hs = 0.45 * r * ks
						-- (tangent round the axis, and along it)
						shape(tc, Vector3.new(-sin(th) * hs, 0, -cos(th) * hs), Vector3.new(cos(th), 0, -sin(th)) * (0.25 * rs), ad * 0.8)
						-- its offset across the sight line, and which side it is on
						local b = abs(ox * -dyv + oy * dxv)
						local near = ox * dxv + oy * dyv < 0
						local tauT = chordTau(s, tor, x0, y0, z, r, min(b, 0.98 * r), dxv, dyv) * 0.5
						local facing = cos(th) * sd.X + sin(th) * -sd.Z
						local col = colourOf(L, lt.ts * (0.4 + 0.6 * max(0, facing)), lt.tsk, 0.85)
						setCol(tc, col)
						setTr(tc, 1 - clamp((1 - exp(-tauT)) * l.a * (if near then 0.8 else 0.3), 0, 0.9))
						setOn(tc, true)
						nDrawn += 2
					end
				end
			end
		end
		if not on then
			for _, v in vols do
				dropVol(v)
			end
			table.clear(vols)
		end
		if on then
			local nw = 0
			for _, v in vols do
				nw += #v.wall
			end
			local msg = string.format("%d vols · %d wall · %d cards · %.2f ms", (function()
				local n = 0
				for _ in vols do
					n += 1
				end
				return n
			end)(), nw, nDrawn, (os.clock() - t0) * 1000)
			ctx.root:SetAttribute("VolumeCards", msg)
			prof.frames += 1
			prof.total += os.clock() - t0
			if now - (self.printAt or 0) > 5 then
				self.printAt = now
				local f = max(prof.frames, 1)
				msg ..= string.format(" | mean %.2f ms: spawn %.2f seat %.2f light %.2f (%d marches/s)", prof.total / f * 1000, prof.spawn / f * 1000, prof.seat / f * 1000, prof.light / f * 1000, prof.marches / 5)
				prof.frames, prof.total, prof.spawn, prof.seat, prof.light, prof.marches = 0, 0, 0, 0, 0, 0
				local hs = {}
				for _, v in vols do
					table.insert(hs, string.format("theta %.3f cand %d h@tor %.0f zF %.0f layers %d", v.theta, v.area, v.h, v.zF or -1, #v.layers))
				end
				print("[volume] " .. msg .. " | " .. table.concat(hs, "; "))
			end
		end
	end
	return self
end

return VolumeCards
