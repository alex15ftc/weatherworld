--!nonstrict
--!native
-- The wall cloud and its tail cloud as a stream of puffs (style "stream", 2026-10-29; key Y
-- switches back to StormCards' rings of cards). Modelled on a reference made of billboards only:
-- dense round puffs with a feathery rim, heavily overlapped so they read as solid lobes, every
-- puff moving on its own.
--
--   body   NB puffs filling the lowering (CardPlan's shape: radius R, flat underside rising to
--          the base at the rim). Each circles the low-level mesocyclone at the flow's speed at
--          its radius - the sim's own Rankine vortex (Storm.windAt: vlow, core 0.3 Ru) - so the
--          core turns as a solid and the rim lags behind it: the turn shows as shear, not as a
--          rigid spinning plate. A puff inside the core also turns about itself (half the
--          vorticity), which shows from below as its rim rotating.
--   tail   NT puffs riding one path: inflow air from the forward-flank side (the FFD's
--          direction, as CardPlan's tail) carried in at the storm-relative inflow speed while
--          the same vortex turns it - nearly straight far out, wrapping cyclonically round the
--          wall cloud as it gets close, rising into the base and merging there. Puffs are born
--          at the far end (the tail's rounded tip) and travel the whole path, so the tail feeds
--          the wall cloud.
-- Light, haze and rain fog are StormCards' own (ctx.stormShade), and the storm's centre is
-- StormCards' smoothed one, so the stream stays on the scud and the base around it.
local Workspace = game:GetService("Workspace")
local Util = require(script.Parent:WaitForChild("CloudParts"):WaitForChild("Util"))

local WallStream = {}

local NB, NT, NU, NC = 90, 80, 16, 24 -- a storm: body, tail, underside, base collar (wide in isolate) (210 billboards)
local TAIL_SLOTS = 5 -- cross-section: core, two shoulders, two feathered edges
local NLARGE, NMED = 20, 45 -- of the body: big inside pieces, medium outline lumps; the rest small wisps
local MAXS = 3 -- lowerings drawn (those with a tornado first, then nearest): 2 storms' wall clouds, or a storm's and its detached old one
local RANGE = 40000 -- m (not for a lowering with a tornado drawn under it: the tornado has no range)
local TAU = 2 * math.pi
local exp, sqrt, cos, sin, max, min, clamp, abs = math.exp, math.sqrt, math.cos, math.sin, math.max, math.min, math.clamp, math.abs

local function ramp(x: number, a: number, b: number): number
	return clamp((x - a) / (b - a), 0, 1)
end
local function smooth(a: number, b: number, x: number): number
	local t = clamp((x - a) / (b - a), 0, 1)
	return t * t * (3 - 2 * t)
end
local function rnd(i: number, salt: number): number
	local v = sin(i * 12.9898 + salt * 78.233) * 43758.5453
	return v - math.floor(v)
end

function WallStream.new(ctx: any): any
	local C = ctx.Config
	local self = {}
	local folder = Instance.new("Folder")
	folder.Name = "WallStream"
	folder.Parent = ctx.root
	local anchor = Instance.new("Part")
	anchor.Name = "WallAnchor"
	anchor.Anchored, anchor.CanCollide, anchor.CanQuery, anchor.CanTouch = true, false, false, false
	anchor.Transparency = 1
	anchor.Size = Vector3.one
	anchor.Parent = folder
	game:GetService("UserInputService").InputBegan:Connect(function(input, processed)
		if not processed and input.KeyCode == Enum.KeyCode.Y then
			local cur = ctx.state.wallStyle or C.WALL_STYLE or "stream"
			ctx.state.wallStyle = if cur == "stream" then "cards" else "stream"
		elseif not processed and input.KeyCode == Enum.KeyCode.P then
			-- views of the wall cloud from the ground (free camera; P again for the next): under its
			-- rim looking in, from under its middle straight up, from 2 R out, from 0.5 R steeply up
			local b
			for id, v in ctx.wallStreamBase do
				if not b or id == ctx.state.focusId then
					b = v
				end
			end
			if b and b.x then
				local VIEWS = { { 0.9, 40 }, { 0.12, 82 }, { 2.0, 14 }, { 0.5, 60 } }
				ctx.state.wallView = (ctx.state.wallView or 0) % #VIEWS + 1
				local vw = VIEWS[ctx.state.wallView]
				local d = vw[1] * b.r
				ctx.state.cameraGoto = { x = b.x, y = b.y - d, z = 2, lookX = b.x, lookY = b.y + 1, pitch = vw[2] }
			end
		elseif not processed and input.KeyCode == Enum.KeyCode.X and game:GetService("UserInputService"):IsKeyDown(Enum.KeyCode.LeftShift) then
			-- elevation sweep (Shift+X): the funnel's middle seen from 15 to 80 deg up, from the
			-- ground, one step per press (banding hunts)
			local b
			for id, v in ctx.wallStreamBase do
				if not b or id == ctx.state.focusId then
					b = v
				end
			end
			if b and b.x then
				local E = { 15, 25, 35, 42, 50, 58, 66, 74, 80 }
				ctx.state.sweepView = (ctx.state.sweepView or 0) % #E + 1
				local e = math.rad(E[ctx.state.sweepView])
				local zt = 0.5 * b.z
				local d = math.max(30, zt / math.tan(e))
				local az = math.rad(30 * ctx.state.sweepView)
				ctx.state.cameraGoto = { x = b.x + math.sin(az) * d, y = b.y - math.cos(az) * d, z = 2, lookX = b.x, lookY = b.y, pitch = math.deg(e) }
				print(string.format("[sweep] %d: %d deg up, %.0f m out", ctx.state.sweepView, E[ctx.state.sweepView], d))
			end
		elseif not processed and input.KeyCode == Enum.KeyCode.X then
			-- survey: the wall cloud (and any tornado under it) from 16 ground and mid-height views
			-- round it - 4 directions x (3 R out, 1.2 R out, 0.4 R under the rim, 2 R out at half
			-- the wall's height). X again for the next; printed to the output
			local b
			for id, v in ctx.wallStreamBase do
				if not b or id == ctx.state.focusId then
					b = v
				end
			end
			if b and b.x then
				ctx.state.surveyView = (ctx.state.surveyView or 0) % 16 + 1
				local k = ctx.state.surveyView - 1
				local az = math.rad(90 * (k // 4))
				local kind = k % 4 + 1
				local d = ({ 3, 1.2, 0.4, 2 })[kind] * b.r
				local zc = if kind == 4 then 0.5 * b.z else 2
				local zt = ({ 0.5 * b.z, b.z, b.z, 0.6 * b.z })[kind]
				local pitch = math.deg(math.atan2(zt - zc, d))
				local x, y = b.x + math.sin(az) * d, b.y - math.cos(az) * d
				ctx.state.cameraGoto = { x = x, y = y, z = zc, lookX = b.x, lookY = b.y, pitch = pitch }
				print(string.format("[survey] view %d: from %d deg, %.1f R out, %.0f m up, pitch %.0f", k + 1, 90 * (k // 4), d / b.r, zc, pitch))
			end
		elseif not processed and input.KeyCode == Enum.KeyCode.U then
			-- isolate: only the wall cloud, its scud and the tornado (the parent storm's body
			-- and rain hidden), to see how the funnel joins the lowering
			local iso = not ctx.state.isolateWall
			ctx.state.isolateWall = iso
			if iso then
				ctx.state.rainBeforeIsolate = ctx.state.show.rain
				ctx.state.show.rain = false
			else
				ctx.state.show.rain = ctx.state.rainBeforeIsolate
			end
		end
	end)
	local TEX = (C.TEXTURES.smoothPuffFlat ~= "" and C.TEXTURES.smoothPuffFlat) or C.TEXTURES.softFlat
	local WISP = C.TEXTURES.wispSheetFlat or ""
	-- (the side-on tier texture: off by LabConfig.WALL_TIER. Its crisp lens, rotated with each
	-- piece, drew the lowering's outline as a ring of dark pointed teeth seen from 3 km - the game
	-- regrade's worst fault, 2026-11-07; the soft puffs alone read as one smooth lowering)
	local TIER = if C.WALL_TIER == true then (C.TEXTURES.wallTierFlat or "") else ""
	-- (a wisp: one frame of the 2x2 fibre sheet, streaks along its x; fixed for the sprite's life)
	local function makeWisp(c: any, i: number)
		if WISP == "" then
			return
		end
		local f = i % 4
		c.img.Image = WISP
		c.img.ImageRectSize = Vector2.new(512, 512)
		c.img.ImageRectOffset = Vector2.new((f % 2) * 512, (f // 2) * 512)
		c.wisp = true
	end

	local camS, pxK = Vector3.zero, 0
	local function newPuff(i: number): any
		local att = Instance.new("Attachment")
		att.Parent = anchor
		local bb = Instance.new("BillboardGui")
		bb.Adornee = att
		bb.LightInfluence = 0
		bb.Size = UDim2.fromScale(10, 10)
		bb.Enabled = false
		bb.ResetOnSpawn = false
		local img = Instance.new("ImageLabel")
		img.BackgroundTransparency = 1
		img.AnchorPoint = Vector2.new(0.5, 0.5)
		img.Position = UDim2.fromScale(0.5, 0.5)
		img.Size = UDim2.fromScale(1, 1)
		img.Image = TEX
		img.ImageTransparency = 1
		img.Parent = bb
		bb.Parent = anchor
		return { att = att, bb = bb, img = img, on = false, tr = 1, rot = rnd(i, 9) * 360 }
	end
	-- (writes only for changes that show: half a pixel, 1/500 in colour or opacity)
	local function setOn(c: any, v: boolean)
		if c.on ~= v then
			c.on = v
			c.bb.Enabled = v
		end
	end
	local function setPos(c: any, wp: Vector3)
		if c.wp == nil or (wp - c.wp).Magnitude > pxK * (wp - camS).Magnitude then
			c.wp = wp
			c.att.WorldPosition = wp
		end
	end
	local function setSize(c: any, wS: number, hS: number)
		local thr = pxK * ((c.wp or camS) - camS).Magnitude
		if c.sw == nil or abs(wS - c.sw) > thr or abs(hS - c.sh) > thr then
			c.sw, c.sh = wS, hS
			c.bb.Size = UDim2.fromScale(wS, hS)
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
	local function setRot(c: any, rot: number)
		local half = 0.5 * max(c.sw or 1, c.sh or 1)
		local thr = math.deg(pxK * ((c.wp or camS) - camS).Magnitude / max(half, 1e-3))
		if c.rotW == nil or abs(rot - c.rotW) > thr then
			c.rotW = rot
			c.img.Rotation = rot
		end
	end

	local sets = {} -- by storm id
	local function newSet(): any
		local set = { body = {}, tail = {}, under = {}, ceil = {}, th = {}, uth = {}, phase = 0 }
		for i = 1, NB do
			set.body[i] = newPuff(i)
			-- (the dense middle starts on a sunflower spiral, the golden angle apart: see its radius
			-- in update)
			set.th[i] = if i <= NLARGE then (i * 2.39996) % TAU else rnd(i, 1) * TAU
			-- (the small fringe pieces are wisps; the big and medium ones round puffs that blend
			-- into one mass)
			-- (as the tornado: the dense middle soft edge-free puffs, the rest fibre wisps lying
			-- along the flow; the firm-edged puff drew every piece's outline as a bubble)
			-- (medium outline lumps soft round puffs too: as level fibre wisps they read as
			-- horizontal brush strokes, 2026-10-30)
			-- (all soft puffs, as where the funnel meets the lowering - the look the user wants for
			-- the whole wall cloud, 2026-10-30; the fringe as fibre wisps read as loose chips)
			set.body[i].img.Image = C.TEXTURES.softFlat
		end
		for j = 1, NT do
			set.tail[j] = newPuff(NB + j)
			-- (the tail is a band of slices 3 across: a round lump on top, two wisps beside and
			-- below it - the feathered flat underside, 04_wall_cloud_tail_cloud_d)
			-- (all soft puffs: the side wisps read as chips beside the core, 2026-10-30)
			set.tail[j].img.Image = C.TEXTURES.softFlat
		end
		for j = 1, NU do
			set.under[j] = newPuff(NB + NT + j)
			set.uth[j] = rnd(j, 11) * TAU
			-- (all but the middle one are wisps: bands along the turn, so the rotation shows)
			-- (drawn as soft puffs, still laid along the turn: the fibre-wisp streaks, darkened,
			-- drew long high-contrast cards across the underside seen from below, 2026-10-30)
			set.under[j].img.Image = C.TEXTURES.softFlat
			set.under[j].wisp = j > 1
		end
		for j = 1, NC do
			set.ceil[j] = newPuff(NB + NT + NU + j)
		end
		return set
	end
	local function hide(set: any)
		for _, c in set.body do
			setOn(c, false)
		end
		for _, c in set.tail do
			setOn(c, false)
		end
		for _, c in set.under do
			setOn(c, false)
		end
		for _, c in set.ceil do
			setOn(c, false)
		end
	end

	-- the low-level mesocyclone's tangential speed at r (Storm.windAt: Rankine, core Rl, confined
	-- to a few core radii)
	local function vtAt(vlow: number, r: number, Rl: number): number
		local v = if r < Rl then r / Rl else Rl / max(r, 1)
		return abs(vlow) * v * exp(-(r / (3 * Rl)) ^ 2)
	end

	-- one puff's colour: StormCards' card colour (sun reaching the wall, sky, the surface's
	-- facing, haze), then the rain between the camera and it
	local card = { albedo = 0.62, lit = 0.5, sky = 0.5, nx = 0, ny = 0, nz = -1 }
	local fogW, distW = nil, nil -- (this storm's rain in front of its wall cloud: set per storm in update)
	local fogC, distC = nil, nil -- (and in front of its middle, where the funnel is)
	local function shade(sh: any, L: any, g: any, wx: number, wy: number, z: number, nx: number, ny: number, nz: number, cx: number, cy: number, cz: number, base: number): Color3
		local nm = sqrt(nx * nx + ny * ny + nz * nz)
		card.nx, card.ny, card.nz = nx / nm, ny / nm, nz / nm
		local rx, ry, rz = wx - cx, wy - cy, z - cz
		local d = max(sqrt(rx * rx + ry * ry + rz * rz), 1)
		local col = sh.colour(card, L, 0, Util.hazeF(d), rx / d, ry / d, rz / d, 0)
		local fog = fogW or (g and g.fog) or 0
		if fog > 0.01 and L.fog then
			local tau = -math.log(1 - min(fog, 0.97)) * min(1, d / (distW or max(g and g.dCam or 1e4, 500)))
			if fogW and fogC and distC and distW and d > distW then
				-- (past the near edge, the rain toward the middle too - the same march the funnel is
				-- fogged by (StateAdapter.obscuration). Capped at the near edge's, the lowering by the
				-- funnel took ~0.1 of the rain grey against the funnel's ~0.6: a pale funnel under a dark
				-- wall cloud, two objects, user 2026-11-03)
				local tauC = -math.log(1 - min(fogC, 0.97))
				tau += max(0, tauC - tau) * clamp((d - distW) / max(distC - distW, 1), 0, 1.3)
			end
			tau *= min(1, base / max(z, 1))
			col = col:Lerp(L.fog, 1 - exp(-tau))
		end
		return col
	end

	local list, statAt = {}, 0
	function self:update(dt: number)
		local t0 = os.clock()
		local sh = ctx.stormShade
		local cw = ctx.cw
		local style = ctx.state.wallStyle or C.WALL_STYLE or "stream"
		local on = style == "stream" and sh and cw and cw.storms and ctx.state.show.clouds ~= false and not ctx.state.physVolume
		local cam = Workspace.CurrentCamera
		local camPos = cam.CFrame.Position
		camS = camPos
		pxK = 0.5 * 2 * math.tan(math.rad(cam.FieldOfView) / 2) / max(cam.ViewportSize.Y, 1)
		local camX, camY, camZ = C.fromWorld(camPos)
		table.clear(list)
		if on then
			-- (a storm's wall cloud while it has one - and, after it, while its set fades out:
			-- presence, below. It used to go in one frame when the storm died or its lowering or
			-- spin passed a gate, even with a tornado still under it, 2026-11-03)
			local byId = {}
			-- (storms with a tornado drawn under them: their wall cloud is drawn at any distance and
			-- first. The tornado has no range, so past RANGE - or behind 3 nearer storms - it hung
			-- under its storm with sky between its top and the base, where the base's card plan had
			-- left a hole for the wall cloud, user 2026-11-03)
			local torOf = {}
			local adT = ctx.tornadoAdapter
			if adT and ctx.state.show.funnel ~= false then
				for _, e in adT.entries do
					local t = e.snap
					if e.params and (e.fade or 1) > 0.05 and t and t.parentId ~= nil and t.pk ~= "occluded" then
						torOf[tostring(t.parentId)] = true
					end
				end
			end
			for _, s in cw.storms do
				byId[tostring(s.id)] = s
				if s.lowX and s.wallBase then
					local want = not s.dead and (s.lowering or 0) > 30 and (s.rot or 0) > 0.25
					local st = sets[tostring(s.id)]
					if want or (st and st.live and (st.pres or 0) > 0.01) then
						local d = sqrt((s.lowX - camX) ^ 2 + (s.lowY - camY) ^ 2)
						local tor = torOf[tostring(s.id)] == true
						if d < RANGE or tor then
							table.insert(list, { s = s, d = d, want = want, tor = tor })
						end
					end
				end
			end
			-- A detached (occluded) circulation's own lowering (2026-11-03): once its tornado is cut
			-- off and carried on by it (Sim/World detachOccluded), the storm organises a new
			-- lowering at its rear while the old one goes with the roping tornado, rising and
			-- shrinking with its spin. A stand-in storm for it, from the tornado's snapshot, the rest
			-- from its storm. (Before, the storm's one lowering followed the old tornado, then slid
			-- 1.5-2 km to the new circulation when it ended.)
			local ad = ctx.tornadoAdapter
			if ad then
				for _, e in ad.entries do
					local t = e.snap
					if t and t.pk == "occluded" and t.ovl and t.obase and e.params then
						local id = "occ" .. tostring(t.id)
						local parent = byId[tostring(t.parentId)]
						local st = sets[id]
						local H = max(100, e.cloudBase or 600)
						local ax, ay = ctx.Sim.Vortex.axisAt(e, H)
						local lowering = max(0, t.obase - H)
						local rot0 = (st and st.occRot0) or 0.6
						local vl0 = (st and st.occVlow0) or max(t.ovl, 1)
						local rot = rot0 * min(1, t.ovl / max(vl0, 1))
						local want = not t.ended and lowering > 30 and rot > 0.25
						if want or (st and st.live and (st.pres or 0) > 0.01) then
							local o = {
								id = id, x = e.x + ax, y = e.y + ay, lowX = e.x + ax, lowY = e.y + ay,
								lowering = lowering, wallBase = H, base = t.obase, rot = rot,
								vlow = t.ovl, occl = t.oocl or 1, noTail = true, dead = false, occOf = t.parentId,
								occEntry = e,
							}
							local s = if parent then setmetatable(o, { __index = parent }) else o
							local d = sqrt((o.lowX - camX) ^ 2 + (o.lowY - camY) ^ 2)
							-- (its own tornado drawn under it: at any distance, as a storm's above)
							local tor = want and (e.fade or 1) > 0.05
							if d < RANGE or tor then
								table.insert(list, { s = s, d = d, want = want, tor = tor })
							end
						end
					end
				end
			end
			-- a storm's old lowering after it cycled with no tornado to carry it (see the hand-over
			-- below): left where it was, drifting with its storm, fading out
			for _, st in sets do
				local g = st.ghostS
				if g and st.live and (st.pres or 0) > 0.01 then
					local d = sqrt((g.lowX - camX) ^ 2 + (g.lowY - camY) ^ 2)
					if d < RANGE then
						table.insert(list, { s = g, d = d, want = false })
					end
				end
			end
			-- (lowerings with a tornado under them take the MAXS slots first, nearest first)
			table.sort(list, function(a, b)
				if (a.tor == true) ~= (b.tor == true) then
					return a.tor == true
				end
				return a.d < b.d
			end)
		end
		local used = {}
		local n = 0
		local L = if on then sh.light() else nil
		if L and L.sky == nil then
			on, L = false, nil -- (StormCards has not lit a frame yet)
			table.clear(list)
		end
		local vDt = ctx:visualDt(dt)
		local cf = cam.CFrame
		local Vortex = ctx.Sim.Vortex
		ctx.wallStreamBase = ctx.wallStreamBase or {}
		local function moveSet(from: string, to: string)
			local st = sets[from]
			if sets[to] and sets[to] ~= st then
				hide(sets[to])
				sets[to].live = false
				sets[to].ghostS = nil
			end
			sets[from] = nil
			sets[to] = st
			ctx.wallStreamBase[to] = ctx.wallStreamBase[from]
			ctx.wallStreamBase[from] = nil
		end
		-- Hand-overs (2026-11-03). A detached circulation takes over the lowering its storm had
		-- drawn round its tornado (it was already centred on it), so the old wall cloud goes on with
		-- the roping tornado and the storm's next one starts new.
		for _, it in list do
			local s = it.s
			if s.occOf then
				local id, sid = tostring(s.id), tostring(s.occOf)
				local from = if sets[sid] and sets[sid].live then sid elseif sets["ghost" .. sid] and sets["ghost" .. sid].live then "ghost" .. sid else nil
				if not sets[id] and from then
					local st = sets[from]
					moveSet(from, id)
					st.ghostS = nil
					st.occRot0 = st.lastRot or s.rot
					st.occVlow0 = st.lastVlow or s.vlow
				end
			end
		end
		for i = 1, min(MAXS, #list) do
			local s = list[i].s
			local id = tostring(s.id)
			local set = sets[id]
			-- a storm that cycled (its low-level circulation re-formed at its rear, Sim/Storm) with
			-- its old lowering not taken by a detached tornado: the old one becomes a ghost that
			-- fades where it was, and the new one grows from nothing - not one lowering sliding
			-- 1.5-2 km across the sky
			if set and set.live and not s.occOf and not s.ghost and s.cycle ~= nil and set.cycle ~= nil and set.cycle ~= s.cycle then
				local gid = "ghost" .. id
				moveSet(id, gid)
				set.ghostS = setmetatable({
					id = gid, ghost = true, x = set.lastCx, y = set.lastCy, lowX = set.lastCx, lowY = set.lastCy,
					lowering = set.lastLowering or 0, wallBase = set.lastZb or s.wallBase, base = s.base,
					rot = set.lastRot or 0, vlow = set.lastVlow or 0, occl = set.lastOccl or 0,
					u = s.u or 0, v = s.v or 0, noTail = true, dead = false,
				}, { __index = s })
				used[gid] = true -- (drawn from the next frame; kept as it is this one)
				set = nil
			end
			if not set then
				-- (reuse a set a storm left)
				for k, o in sets do
					if not o.live then
						sets[k] = nil
						set = o
						break
					end
				end
				set = set or newSet()
				sets[id] = set
				set.path = nil
				-- (a fresh lowering: grows in from nothing, its place and size not eased from another's)
				set.pres, set.eox, set.eoy, set.eR, set.ezb = 0, nil, nil, nil, nil
				set.ghostS, set.occRot0, set.occVlow0, set.cycle = nil, nil, nil, nil
			end
			used[id] = true
			set.live = true
			if s.ghost then
				-- (drifting on with its storm)
				local simDt = if ctx.state.paused then 0 else dt * (ctx.state.timeScale or 1)
				rawset(s, "lowX", s.lowX + (s.u or 0) * simDt)
				rawset(s, "lowY", s.lowY + (s.v or 0) * simDt)
				rawset(s, "x", s.lowX)
				rawset(s, "y", s.lowY)
			end
			if not s.occOf and not s.ghost then
				set.cycle = s.cycle
			end
			-- presence: in over ~20 s while it has a wall cloud, out over ~20 s once it hasn't (sim time)
			set.pres = (set.pres or 0) + ((if list[i].want then 1 else 0) - (set.pres or 0)) * (1 - exp(-vDt / 20))
			local g = sh.group(id)
			local px, py = (g and g.px) or s.x, (g and g.py) or s.y
			-- the wall cloud's shape: CardPlan's rules (keep them in step)
			local lowering, rot = s.lowering or 0, s.rot or 0
			local q = ramp(lowering, 30, 400) * ramp(rot, 0.25, 0.6)
			local Ru = max(s.Ru or 1500, 300)
			local occl = clamp(s.occl or 0, 0, 1)
			-- (a young lowering is a small one: from 0.3 of its full width, not 0.7 - it appeared at
			-- 70% width, 2026-11-03; CardPlan keeps the same rule)
			local base = s.base or 1000
			local zb = max(s.wallBase, 60)
			local R = Util.wallRadius(Ru, max(base - max(s.wallBase, 60), 30), q, occl)
			-- (eased over ~2 s: the storm's snapshot comes twice a second, and its size and depth
			-- stepped with it)
			local ke = 1 - exp(-dt / 2)
			set.eR = if set.eR then set.eR + (R - set.eR) * ke else R
			set.ezb = if set.ezb then set.ezb + (zb - set.ezb) * ke else zb
			R, zb = set.eR, set.ezb
			set.lastRot, set.lastVlow, set.lastLowering, set.lastZb, set.lastOccl = rot, s.vlow or 0, lowering, zb, occl
			local D = max(base - zb, 30)
			local Rl = 0.3 * Ru
			local sign = if s.leftMover then -1 else 1
			local vlow = s.vlow or 0
			-- (its offset from the storm eased over ~2 s, as its size; a cycle starts a new set)
			local ox, oy = s.lowX - s.x, s.lowY - s.y
			set.eox = if set.eox then set.eox + (ox - set.eox) * ke else ox
			set.eoy = if set.eoy then set.eoy + (oy - set.eoy) * ke else oy
			local cx, cy = px + set.eox, py + set.eoy
			-- the rain between the camera and the wall cloud's near edge: the hook's rain wraps round
			-- the wall beside and behind it, not in front. (Fogged by the line to the storm's centre it
			-- took the core's rain or missed it by chance; to the wall's centre, the hook's rain at the
			-- wall itself, and it drew pale, 2026-10-31)
			fogW, distW = nil, nil
			fogC, distC = nil, nil
			if sh.rainFog then
				local ex, ey = cx - camX, cy - camY
				local dc = max(sqrt(ex * ex + ey * ey), 1)
				local back = min(R, 0.9 * dc)
				if not set.fogAt or os.clock() - set.fogAt > 0.5 then
					set.fogAt = os.clock()
					set.fogW = sh.rainFog(cx - ex / dc * back, cy - ey / dc * back, camX, camY)
					set.distW = max(dc - back, 500)
					set.fogC = sh.rainFog(cx, cy, camX, camY)
					set.distC = max(dc, set.distW + 1)
				end
				fogW, distW = set.fogW, set.distW
				fogC, distC = set.fogC, set.distC
			end
			-- a tornado under it: the low-level circulation is centred on the funnel (the tornado is
			-- its core tightened), so the wall cloud turns about the funnel's top and its middle
			-- lowers toward it - the funnel flares into a lowering, not into a flat underside
			local tor, tRc = nil, 0
			local ad = ctx.tornadoAdapter
			if s.occEntry then
				-- (a detached circulation's own lowering: its own tornado)
				tor = if (s.occEntry.fade or 1) > 0.05 then s.occEntry else nil
			elseif ad and ctx.state.show.funnel ~= false and not s.ghost then
				local best = (1.2 * R) ^ 2
				for _, e in ad.entries do
					-- (a detached tornado has its own lowering: the storm's new one doesn't follow it)
					if e.params and (e.fade or 1) > 0.05 and not (e.snap and e.snap.pk == "occluded") then
						local mine = e.snap and e.snap.parentId ~= nil and tostring(e.snap.parentId) == id
						local d2 = (e.x - cx) ^ 2 + (e.y - cy) ^ 2
						if mine or d2 < best then
							tor, best = e, if mine then -1 else d2
						end
					end
				end
			end
			local dip = 0
			if tor then
				local H = max(100, tor.cloudBase)
				local ax, ay = Vortex.axisAt(tor, H)
				local k = clamp(tor.fade or 1, 0, 1)
				cx, cy = cx + (tor.x + ax - cx) * k, cy + (tor.y + ay - cy) * k
				tRc = Vortex.rcAt(tor.params, H)
				-- (how far the lowering hangs round the funnel: a shallow sag onto the funnel's top.
				-- Up to 300 m it hung a dark bowl over half of a 600 m funnel and swallowed it, the
				-- funnel looking like a thin stub under a black mass, 2026-10-30)
				dip = k * min(0.3 * (base - zb), 0.12 * H, 100)
			end
			set.lastCx, set.lastCy = cx, cy
			-- the underside: flat, rising to the base at the rim; round a funnel it hangs lower in a
			-- broad bowl that narrows onto the funnel's top
			local rDip = max(0.2 * R, 3 * tRc)
			local function zbot(r: number): number
				local z = zb + D * min(r / R, 1) ^ Util.WALL_FLOOR_P
				if dip > 0 then
					z -= dip * (1 - smooth(0, rDip, r))
				end
				return z
			end
			-- (the game: drawn about its storm's anchor, LabConfig.stormAnchor - the funnel's foot - at
			-- the storm's one scale; the lab: about its own centre)
			local acx, acy = C.stormAnchor(if s.ghost then nil else s.id, cx, cy)
			local ks = C.scaleAbout(acx, acy)
			-- (across at ks out to 3 core radii of a tornado under it, easing to the map's beyond -
			-- the game draws the storm body across at its map's scale: LabConfig.radial, as
			-- Shared.CloudModel.WallCloudView. A drawn width takes kA, the scale across there; a
			-- height the vertical ks side-on, kA seen from beneath (sinE). In the lab kA = ks.)
			local trueR = 3 * tRc
			local function kUp(kA: number, sinE: number): number
				return ks + (kA - ks) * sinE
			end
			-- the sun reaching the wall cloud (marched through the storm; twice a second)
			local now = os.clock()
			if not set.litAt or now - set.litAt > 0.5 then
				set.litAt = now
				local Ls = ctx.Tornado.SceneLight.sample(ctx, cx, cy, zb)
				set.lit = 0.5 * clamp(Ls.sun / max(L.direct, 0.05), 0, 1)
				-- where its sky light comes from (SceneLight.skyDir): the side facing open sky lit, the
				-- side facing the storm's body dark - structure in the darkness, not one grey mass
				set.sdx, set.sdy, set.sdA = ctx.Tornado.SceneLight.skyDir(ctx, cx, cy, zb)
			end
			card.lit = set.lit
			local sdx, sdy, sdA = set.sdx or 1, set.sdy or 0, set.sdA or 0
			local function skyTint(col: Color3, hx: number, hy: number, w: number): Color3
				local k = 1 + 0.6 * sdA * w * (hx * sdx + hy * sdy)
				return Color3.new(min(col.R * k, 1), min(col.G * k, 1), min(col.B * k, 1))
			end
			-- (q sets its size, as CardPlan; it is there - opaque - once it has formed at all: a
			-- wall cloud is a dense lowering, its opacity x q drew pale scattered blotches)
			local fadeIn = ramp(q, 0.02, 0.12) * set.pres
			-- body ---------------------------------------------------------------------------
			-- (what a wall cloud looks like, docs/storm-reference/real/04_*: an abrupt step down from
			-- a broad flat base, 3-5x wider than deep, flat-bottomed, its sides laminated into level
			-- tiers wrapping round, ragged fringe at its bottom edge; never above the base it hangs
			-- from. The earlier body rose 0.4 R past the base as a lumpy tower, user 2026-10-30.)
			-- Every piece is a level band drawn as it is seen: its full width across, foreshortened
			-- by the angle it is seen at (a thin streaked lens side-on, wide from beneath), its
			-- streaks along the turn; it orbits at the circulation's speed at its radius.
			local camP = cf.Position
			local function band(c: any, x: number, y: number, z: number, a: number, wideK: number, thick: number, th: number, rr: number): number
				local Pw, kR, kT = C.toWorldRadial(x, y, z, acx, acy, ks, trueR)
				local kA = max(kR, kT) -- (across: the ring's scale, not the radial squeeze)
				setPos(c, Pw)
				local ray = Pw - camP
				local sinE = abs(ray.Y) / max(ray.Magnitude, 1e-3)
				local kH = kUp(kA, sinE)
				local across = ray:Cross(Vector3.yAxis)
				local lv = 0
				if across.Magnitude > 1e-3 then
					lv = math.atan2(across:Dot(cf.UpVector), across:Dot(cf.RightVector))
				end
				if c.wisp then
					-- (streaks: from beneath along the flow's tangent on screen, side-on level; the two
					-- blended as line directions - angles doubled)
					local e = 0.05 * max(rr, 0.1 * R)
					local Pt = C.toWorldRadial(x - sign * sin(th) * e, y + sign * cos(th) * e, z, acx, acy, ks, trueR)
					local d3 = Pt - Pw
					local tg = math.atan2(d3:Dot(cf.UpVector), d3:Dot(cf.RightVector))
					local wt = smooth(0.3, 0.8, sinE)
					local ang = 0.5 * math.atan2((1 - wt) * sin(2 * lv) + wt * sin(2 * tg), (1 - wt) * cos(2 * lv) + wt * cos(2 * tg))
					setSize(c, a * kA, min(a * 0.82, (thick + max(0, wideK * a - thick) * sinE) * 1.1) * kH)
					setRot(c, -math.deg(ang))
				else
					setSize(c, a * kA, min(a * 0.72, thick + max(0, wideK * a - thick) * sinE) * kH)
					setRot(c, -math.deg(lv))
				end
				return sinE, kA
			end
			local function patchy(col: Color3, j: number, salt: number): Color3
				local p = 0.85 + 0.3 * rnd(j, salt)
				return Color3.new(min(col.R * p, 1), min(col.G * p, 1), min(col.B * p, 1))
			end
			-- The lowering lit as ONE volume (what makes it read as a cloud, not a pile of sprites):
			-- a piece is shaded as the surface nearest it - the side (facing out, sky and sun round
			-- it) or the underside (facing down: the dim light from below) - and darker the deeper
			-- inside it sits, so pieces seen through gaps read as the cloud's interior. Light
			-- falls off over ~0.3 of the lowering's depth (or 0.15 R across).
			-- the rain-free base it hangs under (CardPlan's deck: storm-relative centre and radius)
			local dk = g and g.deck
			local dkx, dky, dkr = px + ((dk and dk.x) or 0), py + ((dk and dk.y) or 0), (dk and dk.r) or 2 * R
			local function volShade(j: number, r: number, th: number, z: number, rMax: number, zl: number): Color3
				-- (its sides see the sky only below the base's edge: from depth h under the base with
				-- the base reaching O past it, a side sees sky up to atan(h / O) - a vertical face's
				-- share sin of that. Lit as open-sky sides, the wall took ~2x the base underside's sky
				-- light and drew as the base's grey (0.58 vs 0.57) with a lighter bottom (0.61); the
				-- photo's wall is darker than its base, 0.51 vs 0.57, 2026-11-01)
				local wx, wy = cx + cos(th) * r, cy + sin(th) * r
				local O = max(150, dkr - sqrt((wx - dkx) ^ 2 + (wy - dky) ^ 2))
				local hU = max(30, base - z)
				card.sky = 0.5 * (0.55 + 0.45 * hU / sqrt(hU * hU + O * O))
				local dSide = max(0, rMax - r)
				local dBot = max(0, z - zl)
				local side = smooth(-0.5, 0.5, (dBot / max(D, 1)) - (dSide / max(0.5 * R, 1)))
				-- (normal: side out, or down; blended where the two surfaces meet)
				local nx, ny, nz = cos(th) * side, sin(th) * side, -(1 - side) - 0.2 * side
				local depth = min(dSide / max(0.15 * R, 1), dBot / max(0.3 * D, 1))
				local col = shade(sh, L, g, cx + cos(th) * r, cy + sin(th) * r, z, nx, ny, nz, camX, camY, camZ, base)
				-- (the side's own facing - sky and sun round it - is already in shade(). A 1.7x side boost
				-- here, from a misread of 04_wall_cloud_a, made the wall as bright as the base above it
				-- (0.67 vs 0.66 of the bright sky; the photo: body 0.51, lower band 0.40, base 0.57), so it
				-- vanished into it seen from outside, 2026-11-01)
				local k = (0.55 + 0.45 * math.exp(-depth)) * (0.85 + 0.15 * side) * (0.95 + 0.1 * rnd(j, 9))
				-- (the side facing open sky lighter; the interior keeps its darkness)
				k *= 1 + 0.6 * sdA * side * math.exp(-depth) * (cos(th) * sdx + sin(th) * sdy)
				card.sky = 0.5
				return Color3.new(min(col.R * k, 1), min(col.G * k, 1), min(col.B * k, 1))
			end
			-- The lowering drawn as the tornado is drawn (TornadoCards' spiral stream, 2026-10-30):
			-- fibre wisps lying along the flow on screen, rising through it as a stream (born at its
			-- underside, merged into the base at the top - no fixed pieces to show as plates), each
			-- as opaque as the cloud is dense where it is, lit by the way its surface faces the sun;
			-- big soft pieces carry the dense middle (as the funnel's centre cards).
			-- Its motion (the user's notes, 2026-10-30): a flattened volume whose outline is a
			-- coherent noise field turning with the circulation; turning slower than the tornado
			-- (the low meso's own profile, inner faster); rising (the updraft it is condensing in);
			-- coherent turbulence (neighbours share the same eddies); and near the funnel's top
			-- its velocity blends into the tornado's, so the two turn as one where they meet.
			local omEdge = sign * vtAt(vlow, 0.8 * R, Rl) / (0.8 * R)
			set.edgePh = ((set.edgePh or 0) + omEdge * vDt) % TAU
			local tNow = ctx:simTime()
			local function rEdge(th: number, f: number): number
				local a = th - set.edgePh
				local nz = math.noise(2.2 * cos(a) + 7.1, 2.2 * sin(a) + 3.3, 1.6 * f + 0.004 * tNow)
				-- (a little narrower at its foot than where it meets the base)
				return R * (0.82 + 0.18 * f) * (1 + 0.35 * nz)
			end
			-- the tornado's turn at r (its own wind field: Wood-White profile about its top's core)
			local vcT = if tor then (tor.vc or 0) else 0
			local function omTor(r: number): number
				local Rn = max(r, 1) / max(5, tRc)
				return sign * min(vcT / max(5, tRc) * Vortex.profile(Rn) / Rn, 2.5)
			end
			-- the blend weight of the tornado's flow: inside a few core radii of the funnel's top, in
			-- the lower part of the lowering
			local rBlend = max(4 * tRc, 0.25 * R)
			local function wTor(r: number, f: number): number
				if not tor then
					return 0
				end
				return (1 - smooth(0.4 * rBlend, rBlend, r)) * (1 - smooth(0.2, 0.7, f)) * clamp(tor.fade or 1, 0, 1)
			end
			-- a fibre lying along its flow on screen (round the centre at its turn, up at its rise),
			-- foreshortened as a level band is: a thin streak side-on, broad from beneath
			local function flowCard(c: any, x: number, y: number, z: number, w: number, thick: number, th: number, r: number, om: number, rise: number, aspect: number?)
				local Pw, kR, kT = C.toWorldRadial(x, y, z, acx, acy, ks, trueR)
				local kA = max(kR, kT) -- (across: the ring's scale, not the radial squeeze)
				setPos(c, Pw)
				local ray = Pw - camP
				local sinE = abs(ray.Y) / max(ray.Magnitude, 1e-3)
				local sg = if om >= 0 then 1 else -1
				local e = 0.05 * max(r, 0.1 * R)
				local vt = max(abs(om) * max(r, 1), 1)
				local Pt = C.toWorldRadial(x - sg * sin(th) * e, y + sg * cos(th) * e, z + rise / vt * e, acx, acy, ks, trueR)
				local d3 = Pt - Pw
				local sx, sy = d3:Dot(cf.RightVector), d3:Dot(cf.UpVector)
				local sl = sqrt(sx * sx + sy * sy)
				local onScreen = sl / max(d3.Magnitude, 1e-4)
				local ang = if sl > 1e-5 then -math.deg(math.atan2(sy, sx)) else 0
				ang = ((ang + 90) % 180) - 90
				-- (a fibre is as long as its flow shows on screen: where the flow points at the camera
				-- it is end-on, a short lump. At full length the rise turned those into long steep
				-- streaks - the dark spikes round the rim, 2026-10-30. Side-on it is a level band, so
				-- its tilt is limited, freer seen from beneath)
				local hh = min(0.75 * w, (thick + max(0, 0.6 * w - thick) * sinE))
				local len = max(hh * 1.2, w * (0.35 + 0.95 * onScreen))
				if aspect then
					len = min(len, aspect * hh)
				end
				setSize(c, len * kA, hh * kUp(kA, sinE))
				local tiltMax = 18 + 72 * smooth(0.25, 0.7, sinE)
				setRot(c, clamp(ang, -tiltMax, tiltMax))
			end
			local sr, sg, sb, sk = 0, 0, 0, 0
			set.f = set.f or {}
			local nTier = clamp(math.floor(D / 120 + 0.5), 2, 4)
			local tierH = D / nTier
			for k = 1, NB do
				local c = set.body[k]
				local u, v = rnd(k, 2), rnd(k, 4)
				if k <= NLARGE then
					-- (the dense middle spread evenly over the disc - a sunflower spiral, equal area per
					-- piece. By the sin hash, 18 of the 20 sat at 0.42-0.70 of the rim, a ring with ~700 m
					-- round the funnel nearly empty: from above the funnel flared into a hole, user
					-- 2026-11-03. Odd and even pieces - the low and mid layers - interleave, so each
					-- layer spans the disc too)
					u = (k - 0.5) / NLARGE
				end
				local cls = if k <= NLARGE then 1 elseif k <= NLARGE + NMED then 2 else 3
				-- the stream: the outline wisps rise ~1.5 m/s through the whole depth, the fringe
				-- ~3 m/s through its lower part (scud); the dense middle holds its height
				local f, env, rise = 0.5, 1, 0
				local tier = nil
				if cls == 1 and k % 2 == 1 then
					-- (half the dense middle lower down: all at mid-depth, the lowering's lower ~150 m round
					-- the axis was filled only by the underside discs, which hide unless seen from below -
					-- from level or above the funnel's top ended under the body with the horizon showing
					-- between them, user 2026-11-03. A soft band 1.05 of the depth tall centred at 0.3
					-- and 0.6 of it tall fills it down to the floor, as one cloud with the body above it)
					f = 0.3
				elseif cls == 2 then
					-- the outline as level tiers (04_wall_cloud_a: sides laminated into steps, each a
					-- little wider than the one under it, the lowest ending in a defined flat bottom).
					-- One tier per ~120 m of the lowering's depth; the lumps hold their level and turn.
					tier = (k - NLARGE - 1) % nTier
					f = (tier + 0.5) / nTier
				elseif cls == 3 then
					rise = 3
					-- (the outline lumps stop at 0.88 of the depth: reaching the top they stood up past it
					-- as round bumps, 2026-10-30)
					local span0 = if cls == 2 then 0.88 else 0.6
					local p = ((set.f[k] or v) + rise * vDt / max(span0 * D, 30)) % 1
					set.f[k] = p
					f = span0 * p
					-- (the outline lumps fade only in the last ~8% of their rise: fading from 0.8 left sky
					-- between them along the top - a loose cluster, not one block, 2026-10-30)
					env = smooth(0, 0.12, p) * (1 - smooth(if cls == 2 then 0.92 else 0.8, 1, p))
				end
				local th0 = set.th[k]
				local rMax = rEdge(th0, f)
				-- (dense middle out to 0.72 of the rim, outline lumps and fringe on the rim itself: the
				-- lumps at 0.7-0.95 and the fringe at 0.9-1.15 left gaps inside and fringe wisps floating
				-- outside the cloud like confetti, 2026-10-30)
				local r = if cls == 1 then 0.72 * rMax * sqrt(u)
					elseif cls == 2 then rMax * math.max(0.6, (tier / nTier) ^ 0.25) * (0.95 + 0.08 * u)
					else rMax * (0.8 + 0.18 * u)
				-- coherent turbulence: eddies ~0.3 R across, turning over in a few minutes
				if cls ~= 1 then
					r *= 1 + 0.08 * math.noise(1.5 * cos(th0) + 11, 1.5 * sin(th0) - 4, 2 * f + 0.006 * tNow)
				end
				local wt = wTor(r, f)
				local om = (1 - wt) * sign * vtAt(vlow, max(r, 0.1 * R), Rl) / max(r, 0.1 * R) + wt * omTor(r)
				local th = (th0 + om * vDt) % TAU
				set.th[k] = th
				local ox, oy = cos(th) * r, sin(th) * r
				local zl = zbot(r)
				local span = max(0, base - zl)
				local z = zl + f * span
				if cls == 3 then
					z += 0.06 * span * math.noise(1.5 * cos(th0) - 9, 1.5 * sin(th0) + 6, 2 * f + 0.006 * tNow + 5)
				end
				-- opacity from the density where it is: deep inside opaque, thinning to the outline
				local depthIn = max(0, rMax - r) / max(0.25 * R, 1)
				-- (thin outline strokes left sky between them as brush strokes, 2026-10-30)
				-- (less per piece: dozens overlap on a sight line, so 0.95 each summed to a black,
				-- featureless mass; the inside still reaches opaque, the outline now has relief)
				-- (outline lumps bigger and fainter so they pile up and blend, as the puffs where the funnel
				-- joins: at 1.5+ each drew its own round outline - scallops, 2026-10-30)
				-- (outer region thinner, the dark middle kept: overlapping outline pieces at 0.9 summed
				-- to a near-solid grey from the core to the rim - murky, review 2026-10-30)
				local dens = if cls == 1 then 1.8 elseif cls == 2 then 0.55 + 1.5 * depthIn else 0.24
				-- (side-on the tiers are the wall's solid outline: opaque, so the sky no longer shows
				-- through its lower edge - it drew as the base's grey, 0.66 against the photo's 0.40-0.51,
				-- 2026-11-01. From beneath they keep the thinner outline the 10-30 review asked for.)
				local sideOn = 0
				if cls == 2 then
					local hx, hy = cx + cos(th) * r - camX, cy + sin(th) * r - camY
					local el = (z - camZ) / max(sqrt(hx * hx + hy * hy + (z - camZ) ^ 2), 1e-3)
					sideOn = 1 - smooth(0.3, 0.55, el)
					-- (opaque side-on only with the tier texture: as soft puffs they drew as dark
					-- leaves round the lowering, regrade 2026-11-07)
					if TIER ~= "" then
						dens += (3.0 - dens) * sideOn
					end
				end
				local a = (1 - exp(-dens)) * env
				if cls == 1 then
					-- (the lower half 0.6 of the depth tall: its bottom on the floor, not hanging under it)
					band(c, cx + ox, cy + oy, z, R * (0.75 + 0.25 * rnd(k, 3)), 1, span * (if f < 0.5 then 0.6 else 1.05), th, r)
				elseif cls == 2 then
					local w = R * (0.6 + 0.35 * rnd(k, 3))
					if sideOn > 0.5 and TIER ~= "" then
						-- a level tier: the texture's crisp bottom edge (0.70 of the frame) on the tier's
						-- floor, its soft top up into the tier above
						if c.img.Image ~= TIER then
							c.img.Image = TIER
						end
						-- (a tier sits where the floor is at its radius - zbot rises toward the rim, so the
						-- lowest tier is the inner flat floor and each one above steps out: narrower at the
						-- foot. Card 3 tierH tall: its edge 0.2 of that under its centre)
						-- (1.7x wide: the texture's flat bottom spans its middle ~40%, so tiers as wide as the
						-- outline lumps drew as separate small lenses, 2026-11-01)
						-- (the floor from the tier's own radius, not the piece's: zbot rises as r^4 toward the
						-- rim, so the pieces' 8% radius jitter and eddies put neighbouring lenses' flat
						-- bottoms up to a third of the depth apart - a scalloped edge, 2026-11-01)
						-- One piece the lowering's whole depth, not a tier per ~120 m: side-on each tier
						-- showed only its texture's 40% lens - ~7:1 with pointed tips - and the opaque tiers
						-- stacked as flat discs, SC check 2026-11-01. The crisp bottom (0.70 of the frame) sits
						-- on the floor at the piece's radius, the visible band reaching the base: the frame is
						-- the depth / 0.4 tall, and no wider than ~2.5 x its depth (a wall, not a blade).
						local _ = tier
						local zf = zbot(r)
						local dep = max(base - zf, 0.5 * D)
						local hT = dep / 0.4
						local wA = min(1.7 * w, 2.5 * dep)
						local _, kA = band(c, cx + ox, cy + oy, zf + 0.2 * hT, wA, 0, hT, th, r)
						setSize(c, wA * kA, hT * ks) -- (band caps a level band at 0.72 of its width)
					else
						if c.img.Image ~= TEX then
							c.img.Image = TEX
						end
						-- (no lower than the floor: the floor is where the air condenses, so no cloud hangs
						-- under it. The soft puff fills ~3/4 of its frame, so its visible foot is 0.375 of
						-- the card under its centre; the lowest tier's centre is a quarter of the depth up
						-- and its 0.6-deep puffs hung round bottoms under the flat floor - the scalloped,
						-- bubbly rim, lifecycle review 2026-11-08. Clipped, they are wider than tall and
						-- overlap into one flat-bottomed band)
						local thick = min(0.6 * span + 0.15 * w, max(2.6 * (z - zl), 0.1 * span))
						flowCard(c, cx + ox, cy + oy, z, w, thick, th, r, om, rise, if TIER ~= "" then 1.7 else 2.4)
					end
				else
					-- (short and plump: 0.4 thick, the fringe drew as a sawtooth of dark teeth round the
					-- rim seen from below, 2026-10-30)
					-- (wider, flatter, fainter: at 0.13-0.23 R and 0.6 tall each read as a dark round bead
					-- round the lowering's edge - a ring of balls with the base hidden, SC check 2026-11-02)
					local w = R * (0.22 + 0.14 * rnd(k, 3))
					-- (at most 1.6 x as long as tall: uncapped, the rise and swirl drew them as dark
					-- leaves round the lowering once the tiers were off, 2026-11-07)
					flowCard(c, cx + ox, cy + oy, z, w, 0.35 * w, th, r, om, rise, 1.6)
				end
				setTr(c, 1 - clamp(a * fadeIn, 0, 1))
				local rf = r / R
				local col = volShade(k, r, th, z, rMax, zl)
				setCol(c, col)
				setOn(c, a > 0.005)
				n += 1
				if rf < 0.5 then
					sr += col.R
					sg += col.G
					sb += col.B
					sk += 1
				end
			end
			-- underside --------------------------------------------------------------------
			-- (seen from below the lowering is one solid dark disc, darkest in the middle, with
			-- bands swirling round it)
			for j = 1, NU do
				local c = set.under[j]
				local r = if j == 1 then 0 else R * (0.15 + 0.6 * sqrt(rnd(j, 12)))
				local om = sign * vtAt(vlow, max(r, 0.1 * R), Rl) / max(r, 0.1 * R)
				local th = (set.uth[j] + om * vDt) % TAU
				set.uth[j] = th
				local ox, oy = cos(th) * r, sin(th) * r
				local zl = zbot(r)
				-- (streaks ~half as long: at 0.5-0.8 R they radiated from the middle as pinwheel blades, 2026-10-30)
				local a = if j == 1 then 1.0 * R else R * (0.45 - 0.15 * r / R) * (0.9 + 0.2 * rnd(j, 13))
				band(c, cx + ox, cy + oy, zl + 0.08 * D, a, if c.wisp then 0.6 else 1, 0.2 * D + 0.04 * a, th, r)
				-- (the bands show the turn seen from below; from the side they lie edge-on and drew
				-- long level streaks across the lowering, 2026-10-30: they fade as the view flattens)
				local hx, hy = cx + ox - camX, cy + oy - camY
				local upE = (zl - camZ) / max(sqrt(hx * hx + hy * hy + (zl - camZ) ^ 2), 1e-3)
				-- (the central disc too, from lower: side-on it drew a separate dark flat ellipse under the
				-- wall - the lowest of the stacked discs, SC check 2026-11-01)
				local seen = if c.wisp then smooth(0.35, 0.7, upE) else smooth(0.12, 0.4, upE)
				setTr(c, 1 - clamp((if c.wisp then 0.45 else 0.96) * fadeIn * seen, 0, 1))
				local rf = r / R
				local col = shade(sh, L, g, cx + ox, cy + oy, zl, cos(th) * rf, sin(th) * rf, -1, camX, camY, camZ, base)
				setCol(c, patchy(col, j, 14):Lerp(Color3.new(0, 0, 0), if c.wisp then 0.1 + 0.08 * (1 - rf) else 0.18 * (1 - rf)))
				setOn(c, true)
				n += 1
			end
			-- the base it hangs from (isolate view only - otherwise the storm's own base is
			-- drawn): the broad flat rain-free base, out to ~3 R, a little lighter than the
			-- lowering; without it the wall cloud floats as a blob, user 2026-10-30
			local iso = ctx.state.isolateWall == true
			for j = 1, NC do
				local c = set.ceil[j]
				if iso then
					local r = if j == 1 then 0.5 * R else R * (0.9 + 2.2 * sqrt(rnd(j, 15)))
					local th = rnd(j, 16) * TAU
					local ox, oy = cos(th) * r, sin(th) * r
					local a = R * (2.0 + 0.6 * rnd(j, 17))
					band(c, cx + ox, cy + oy, base + 0.05 * D, a, 1, 0.2 * D + 0.03 * a, th, r)
					setTr(c, 1 - clamp(0.97 * fadeIn, 0, 1))
					local col = shade(sh, L, g, cx + ox, cy + oy, base, 0, 0, -1, camX, camY, camZ, base)
					setCol(c, patchy(col, j, 18))
					setOn(c, true)
					n += 1
				elseif fadeIn > 0.02 then
					-- (outside isolate: the base right over the lowering, where BaseDeck cuts its discs
					-- (within 1.15 R) and the storm's cards are soft-bottomed. The body's cards fade over
					-- their top third, so the lowering ended ~100-150 m under the base's visible bottom and
					-- from the side a band of horizon sky ran between them - the wall cloud and funnel
					-- floated as one blob under the deck, user 2026-11-03. A collar from 0.29 D under the
					-- base to just above it, out to 1.3 R, joins the two as one cloud)
					local r = if j == 1 then 0.2 * R else R * (0.45 + 0.85 * sqrt(rnd(j, 15)))
					local th = rnd(j, 16) * TAU
					local ox, oy = cos(th) * r, sin(th) * r
					local a = R * (0.9 + 0.4 * rnd(j, 17))
					band(c, cx + ox, cy + oy, base - 0.12 * D, a, 1, 0.5 * D, th, r)
					setTr(c, 1 - clamp(0.9 * fadeIn, 0, 1))
					local col = shade(sh, L, g, cx + ox, cy + oy, base - 0.12 * D, 0, 0, -1, camX, camY, camZ, base)
					setCol(c, patchy(col, j, 18))
					setOn(c, true)
					n += 1
				else
					setOn(c, false)
				end
			end
			-- the lowering for Render/TornadoCards: its reach (the funnel keeps its flare inside
			-- it) and the light its underside was shaded with (the funnel's top takes it)
			if sk > 0 then
				local b = ctx.wallStreamBase[id] or {}
				b.col = Color3.new(sr / sk, sg / sk, sb / sk)
				-- (its reach as drawn, in metres at the tornado's true scale: the funnel's flare stays
				-- inside the lowering as drawn, LabConfig.radial)
				b.x, b.y, b.z, b.r = cx, cy, zb, (C.radial(R, trueR, ks, cx, cy)) / ks
				b.tR = trueR -- (Render/Scud: drawn about this centre by the same rule)
				b.floor, b.dip = zbot(0), dip -- (the lowering's floor over the funnel)
				ctx.wallStreamBase[id] = b
				-- (readouts for the light review: the middle's mean colour, the sun reaching it, the scene light)
				if i == 1 and now - (set.dbgAt or 0) > 1 then
					set.dbgAt = now
					folder:SetAttribute("WallMidCol", string.format("%.2f %.2f %.2f", b.col.R, b.col.G, b.col.B))
					folder:SetAttribute("WallLit", set.lit)
					folder:SetAttribute("WallSkyDirect", string.format("%.2f %.2f", L.sky, L.direct))
					folder:SetAttribute("WallR", R)
					folder:SetAttribute("WallFog", string.format("%.2f %.0f", fogW or -1, distW or -1))
					for _, part in { "body", "under" } do
						local wr, wg, wb, wa, cnt = 0, 0, 0, 0, 0
						for _, pc in set[part] do
							if pc.on then
								local al = 1 - pc.img.ImageTransparency
								local cc = pc.img.ImageColor3
								wr += cc.R * al
								wg += cc.G * al
								wb += cc.B * al
								wa += al
								cnt += 1
							end
						end
						folder:SetAttribute("Wall_" .. part, string.format("n%d a%.2f col %.2f %.2f %.2f", cnt, wa / max(cnt, 1), wr / max(wa, 1e-3), wg / max(wa, 1e-3), wb / max(wa, 1e-3)))
					end
				end
			end
			-- tail ---------------------------------------------------------------------------
			-- (the path its air takes: Sim/InflowCloud traces the storm-relative wind back from the
			-- wall cloud's rim and keeps the run of condensed forward-flank air attached to it, so the
			-- tail can't cross the rain core or the rear flank. Until 2026-11-03 it was a spiral aimed
			-- at the forward-flank core point, and its far half hung inside the rain)
			local tailOn = false
			local IC = ctx.Sim.InflowCloud
			if IC and not s.noTail and q > 0.1 and s.lowX then
				if not set.pathAt or now - set.pathAt > 2 then
					set.pathAt = now
					local path, _, _, travel = IC.tail(cw, s, s.lowX, s.lowY, R, zb, base)
					if path and #path >= 3 then
						set.path, set.pathN, set.pathT, set.pathMiss = path, #path, max(travel, 30), 0
						local Lp = 0
						for k2 = 2, #path do
							local a, b = path[k2 - 1], path[k2]
							Lp += sqrt((b[1] - a[1]) ^ 2 + (b[2] - a[2]) ^ 2 + (b[3] - a[3]) ^ 2)
						end
						-- (the spacing between puffs in one lane: the path's length over the slices.
						-- Counted over all NT - 5 puffs share each slice - puffs were sized ~0.7 lane
						-- spacings long and the tail drew as rows of separate dots, 2026-10-30)
						set.gap = Lp / (NT // TAIL_SLOTS)
					else
						-- (one miss keeps the last path: the air's state is sampled, not switched)
						set.pathMiss = (set.pathMiss or 0) + 1
						if set.pathMiss > 1 then
							set.path, set.pathN = nil, 0
						end
					end
				end
				if set.path then
					tailOn = true
					local P, m = set.path, set.pathN
					if m >= 3 then
						set.phase = (set.phase + vDt / set.pathT) % 1
						-- (a thick tube: the reference tail is about a third of the wall cloud's depth across)
						local tT = max(1.5 * D, 0.35 * R) -- (from 1.3 D / 0.3 R: too thin and see-through, user 2026-10-30)
						local NS = NT // TAIL_SLOTS
						for j = 1, NT do
							local c = set.tail[j]
							-- (slices along the path, each 3 puffs across, a little staggered: one puff
							-- at a time along a line read as a string of beads, 2026-10-30)
							local slice, slot = (j - 1) // TAIL_SLOTS, (j - 1) % TAIL_SLOTS
							local sP = ((slice + 0.45 * rnd(j, 8)) / NS + set.phase) % 1
							local u = sP * (m - 1) + 1
							local k2 = min(math.floor(u), m - 1)
							local f = u - k2
							local a, b = P[k2], P[k2 + 1]
							local ox, oy, z = a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, a[3] + (b[3] - a[3]) * f
							-- (born at the far tip, growing to full size: the tail's rounded end;
							-- merged into the base at the end of the path)
							local grow = 0.55 + 0.45 * ramp(sP, 0, 0.10)
							local env = ramp(sP, 0, 0.02) * (1 - ramp(sP, 0.85, 1))
							-- (~4 puffs overlap at every point, each a little different: aligned rims at a regular
							-- spacing drew a saw-tooth edge, 2026-10-29)
							-- (sizes vary 0.7-1.3 and the tail tapers to its far tip; each puff ~2.8 gaps
							-- long. Same-size puffs ~2 gaps long read as a string of beads, 2026-10-30)
							local vj = 0.7 + 0.6 * rnd(j, 5)
							local taper = 0.5 + 0.5 * smooth(0, 0.6, sP)
							local along = clamp(2.6 * (set.gap or tT), 0.85 * tT, 6 * tT) * grow * vj -- (not tapered: shorter puffs left gaps - beads again - toward the tip)
							local thick = tT * grow * (1.15 - 0.3 * rnd(j, 6)) * taper
							-- coherent lobes along the band (review 2026-10-30: one smooth grey shelf).
							-- Read at the puff's place in the inflow air (its slice - fixed for life, so a
							-- lobe travels in with its air, neighbours sharing it), evolving slowly: thick
							-- rounded lobes, thin necks, and now and then a gap where the air is not
							-- condensed - closed near the wall cloud, where the band feeds it.
							local mc = (slice + 0.45 * rnd(j, 8)) / NS
							local lobe = clamp(2.2 * math.noise(mc * 7 + 0.37, 1.7, 0.002 * tNow), -1, 1)
							thick *= 0.65 + 0.7 * smooth(-0.6, 0.6, lobe)
							local gapK = 1 - (1 - smooth(-0.8, -0.35, lobe)) * (1 - smooth(0.6, 0.85, sP))
							local P1 = C.toWorldRadial(cx + a[1], cy + a[2], a[3], acx, acy, ks, trueR)
							local P2 = C.toWorldRadial(cx + b[1], cy + b[2], b[3], acx, acy, ks, trueR)
							-- (stretched along the path as the camera sees it)
							local d3 = P2 - P1
							local sx, sy = d3:Dot(cf.RightVector), d3:Dot(cf.UpVector)
							local sl = sqrt(sx * sx + sy * sy)
							local dl3 = max(d3.Magnitude, 1e-3)
							local onScreen = sl / dl3 -- (1 across the view, 0 end-on)
							-- (soft round puffs need to be long to merge: up to 3.5x as long as thick)
							local wv = min(6 * thick, thick + (along - thick) * onScreen)
							-- (a flat band, not a tube: ~2.5x wider than deep, narrowing to its far tip;
							-- side-on its depth shows, from below its width)
							-- across the band (level, square to the path) and up: the top lump sits higher,
							-- the side wisps lower (the flat underside)
							local nx, ny = b[2] - a[2], -(b[1] - a[1])
							local pl = max(sqrt(nx * nx + ny * ny), 1e-3)
							local wNow = 2.6 * tT * grow * taper
							-- A filled, flattened 3D section instead of three equally spaced beads.
							-- The central lobe carries opacity, shoulders give depth, and edge
							-- wisps break the outline. Shared low-frequency noise prevents jitter.
							local lateral = ({ 0, -0.27, 0.27, -0.49, 0.49 })[slot + 1]
							-- (the side wisps hug the core: offset 0.34 / -0.22 they floated above and below it
							-- as separate flat flakes, 2026-10-30)
							local vertical = ({ 0.1, 0.18, -0.1, -0.13, 0.05 })[slot + 1]
							local eddy = math.noise(sP * 3.5, set.phase * 0.3, 2.1)
							local lat = (lateral + 0.065 * eddy) * wNow * (0.92 + 0.16 * rnd(j, 9))
							local lift = (vertical + 0.07 * eddy) * tT * grow
							-- (lobes bulge up on top; the underside sags under them: an uneven base)
							lift += (if slot == 0 then 0.3 else -0.12) * max(0, lobe) * tT * grow
							ox, oy, z = ox + nx / pl * lat, oy + ny / pl * lat, z + lift
							local Pc, kR, kT = C.toWorldRadial(cx + ox, cy + oy, z, acx, acy, ks, trueR)
							local kA = max(kR, kT) -- (across: the ring's scale, not the radial squeeze)
							setPos(c, Pc)
							local ray = Pc - cf.Position
							local sinE = abs(ray.Y) / max(ray.Magnitude, 1e-3)
							local bandW = (if slot == 0 then 0.52 else if slot <= 2 then 0.38 else 0.27) * wNow * vj
							local deep = thick * (0.6 + 0.4 * sP) * (if slot == 0 then 1.65 else 1.4)
							setSize(c, wv * kA, min(max(0.55, 1 - 0.45 * onScreen) * wv, deep + max(0, bandW - deep) * sinE) * kUp(kA, sinE))
							if sl > 1e-4 then
								-- (each its own lean: +-5 deg, all along the path, drew a hatched band, 2026-10-30)
								-- (along the path only as far as the path shows across the screen: seen from
								-- its end the path runs up the screen and the puffs stood up as tall
								-- spikes, 2026-10-30)
								local pa = ((-math.deg(math.atan2(sy, sx)) + 90) % 180) - 90
								setRot(c, pa * smooth(0.25, 0.7, onScreen) + 30 * (rnd(j, 7) - 0.5) + 8 * math.noise(sP * 4, j * 0.37, 4.2))
							end
							-- (denser where it joins the wall cloud; the feathered side wisps thinner)
							local dens = (if slot == 0 then 1 else if slot <= 2 then 0.95 else 0.7) * (0.92 + 0.08 * sP)
							dens *= gapK * (0.8 + 0.2 * smooth(-0.4, 0.5, lobe))
							setTr(c, 1 - clamp(dens * fadeIn * env, 0, 1))
							local rr = max(sqrt(ox * ox + oy * oy), 1)
							-- (lit by facing open sky; lobes a little brighter on top, necks darker)
							local col = shade(sh, L, g, cx + ox, cy + oy, z, ox / rr, oy / rr, -0.3, camX, camY, camZ, base)
							col = skyTint(col, ox / rr, oy / rr, 1)
							local lk = 0.92 + 0.14 * lobe * (if slot == 0 then 1 else 0.5)
							setCol(c, Color3.new(min(col.R * lk, 1), min(col.G * lk, 1), min(col.B * lk, 1)))
							setOn(c, env > 0.005)
							n += 1
						end
					end
				end
			end
			if not tailOn then
				for _, c in set.tail do
					setOn(c, false)
				end
			end
		end
		for id, set in sets do
			if not used[id] then
				ctx.wallStreamBase[id] = nil
				set.live = false
				hide(set)
			end
		end
		if t0 - statAt > 0.5 then
			statAt = t0
			ctx.root:SetAttribute("WallStream", string.format("%s · %d storms · %d puffs · %.2f ms", style, min(MAXS, #list), n, (os.clock() - t0) * 1000))
		end
	end

	function self:destroy()
		folder:Destroy()
	end
	return self
end

return WallStream
