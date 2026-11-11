--!nonstrict
--!native
-- Storm bodies as meshes (2026-10-31; LabConfig.STORM_MESH, key F switches mesh / cards).
-- The most prominent storms' tower (with its dome and overshooting top), anvil and rain-free base
-- are one opaque, self-lit EditableMesh each, shaped from the same fields as the billboard cards
-- (CloudParts/StormShape: the cloud's radius round the tilted updraft, the anvil from the upper
-- winds, the base deck and its clear slot). Their wall cloud, inflow band, scud, rain shafts and
-- tornado stay billboards (Render/StormCards, WallStream, TornadoCards...).
--   bodies   closed grids (rows x columns, the columns wrapping round) in one mesh: the tower as a
--            surface of revolution round the tilted updraft centre with lobes from smooth 3-D noise
--            that rise with the updraft (smooth in the banded, rotating zone above the base), the
--            anvil as a flat-topped slab along the upper winds, thinning and fraying downstream,
--            the base as a flat-bottomed lens with a ragged edge, lumps underneath and the clear
--            slot pressed up into it
--   draw     a scaled copy pulled toward the camera (cam + (P - cam) * kv): it looks the same from
--            the camera and a whole storm fits the 2048-stud part limit and the ~7000-stud draw
--            range. LabConfig.pull carries kv to everything drawn about the storm (its cards,
--            wall cloud, tornado, dust, rain, flashes) so they keep their depth order against it.
--            Opaque: any vertex alpha under 1 sends a mesh to the see-through pass, where its own
--            faces are not depth-sorted (docs/storm-visuals/PLAN.md, 2026-10-23)
--   light    vertex colours on a Neon part (the colours are the whole look): sun through the storm's
--            own cloud (StormShape.sunLit: a march toward the sun - the tower shades its far side,
--            the anvil and the deck shade what is under them), wrapped Lambert on the true surface
--            normal, sky light by how much sky the surface faces, a silver edge toward the sun,
--            haze and the storm's rain fog as the cards (Render/StormCards' scene light)
--   which    the storms biggest on screen (extent over distance), held with hysteresis; meshes are
--            pooled (EditableMesh memory is tight on clients; destroying and rebuilding leaked it)
--   cost     reshapes every STORM_MESH.rebuildEvery s and shading run as jobs within buildMs a frame
-- Debug: ctx.root attribute StormVolume; Workspace attribute StormVolumeNormals colours by normal.
local AssetService = game:GetService("AssetService")
local Workspace = game:GetService("Workspace")
local UserInputService = game:GetService("UserInputService")

local Parts = script.Parent:WaitForChild("CloudParts")
local Util = require(Parts:WaitForChild("Util"))
local StormShape = require(Parts:WaitForChild("StormShape"))

local StormVolume = {}

local BOUNDS = 1020 -- the mesh's fixed half-size, studs (a part is at most 2048 a side)
local TAU = 2 * math.pi
local sqrt, cos, sin, max, min, clamp, abs, exp = math.sqrt, math.cos, math.sin, math.max, math.min, math.clamp, math.abs, math.exp
local noise = math.noise
local ramp = Util.ramp

local function smoothstep(a: number, b: number, x: number): number
	local t = clamp((x - a) / (b - a), 0, 1)
	return t * t * (3 - 2 * t)
end
-- smooth noise, two octaves (~-1..1)
local function fbm(x: number, y: number, z: number): number
	return 1.6 * (noise(x, y, z) + 0.5 * noise(2.03 * x + 17.1, 2.03 * y - 5.3, 2.03 * z + 9.7))
end
-- irregular lobes: the sample point itself pushed about by a coarser noise (domain warp), three
-- octaves; no regular rows, rings or spirals (2026-10-31 review: bands read as ribbons)
local function lumps(x: number, y: number, z: number): number
	local wx = noise(0.45 * x + 3.1, 0.45 * y, 0.45 * z - 7.4)
	local wy = noise(0.45 * x - 8.2, 0.45 * y + 1.7, 0.45 * z)
	local wz = noise(0.45 * x, 0.45 * y - 4.6, 0.45 * z + 5.9)
	x, y, z = x + 0.9 * wx, y + 0.9 * wy, z + 0.9 * wz
	return 1.5 * (noise(x, y, z) + 0.5 * noise(2.1 * x + 11.3, 2.1 * y - 2.9, 2.1 * z + 4.4)
		+ 0.25 * noise(4.3 * x - 6.6, 4.3 * y + 9.1, 4.3 * z - 1.2))
end

function StormVolume.new(ctx: any): any
	local C = ctx.Config
	local M = C.STORM_MESH
	if not M or not M.enabled then
		return { update = function() end }
	end
	Util.init(ctx.Sim)
	local Storm = ctx.Sim.Storm
	local folder = Instance.new("Folder")
	folder.Name = "StormVolume"
	folder.Parent = ctx.root
	ctx.meshStorms = {}
	ctx.state.stormStyle = ctx.state.stormStyle or M.defaultStyle or "mesh"
	local CardPlan = require(Parts:WaitForChild("CardPlan"))
	CardPlan.meshDetail = M.detailCards ~= false and ctx.state.stormStyle == "mesh"
	CardPlan.detailEdgeOnly = M.detailEdgeOnly ~= false
	CardPlan.detailAlpha = M.detailAlpha or 0.7
	UserInputService.InputBegan:Connect(function(input, processed)
		-- F: mesh with detail cards -> mesh alone -> cards alone (to judge each part by itself)
		if not processed and input.KeyCode == Enum.KeyCode.F then
			local nxt = { mesh = "meshOnly", meshOnly = "cards", cards = "mesh" }
			ctx.state.stormStyle = nxt[ctx.state.stormStyle] or "mesh"
			CardPlan.meshDetail = M.detailCards ~= false and ctx.state.stormStyle == "mesh"
		end
		-- Period (debug): leave out one part of the storm's card plan at a time, to find which part
		-- draws an artefact (CardPlan's sections; Render/StormCards re-plans on the switch)
		if not processed and input.KeyCode == Enum.KeyCode.Period then
			local order = { "tower", "anvil", "forwardFlank", "base", "inflowBand", "striations", "wallScud" }
			local cur = ctx.state.hideSection
			local nxt = nil
			if cur == nil then
				nxt = order[1]
			else
				for i, n in order do
					if n == cur then
						nxt = order[i + 1]
					end
				end
			end
			ctx.state.hideSection = nxt
			print("[cards] hiding section:", nxt or "none")
		end
	end)

	local BODIES = {
		{ name = "tower", rows = M.tower[1], cols = M.tower[2] },
		{ name = "anvil", rows = M.anvil[1], cols = M.anvil[2] },
		{ name = "base", rows = M.base[1], cols = M.base[2] },
	}
	local NV = 0
	for _, b in BODIES do
		b.off = NV
		NV += b.rows * b.cols
	end

	-- the job runner: coroutines resumed within the frame's budget (pace() yields when it is spent)
	local jobs = {}
	local frameStart = 0
	local budget = (M.buildMs or 2.5) / 1000
	local function pace()
		if os.clock() - frameStart > budget then
			coroutine.yield()
		end
	end
	local function addJob(fn: () -> ())
		table.insert(jobs, coroutine.create(fn))
	end

	-- A pooled mesh (built once in its own thread: CreateMeshPartAsync yields).
	local slots = {}
	local function newSlot(): any
		local slot = {
			ready = false, failed = false, owner = nil, shown = false, k = 1,
			X = table.create(NV, 0), Y = table.create(NV, 0), Z = table.create(NV, 0),
			NX = table.create(NV, 0), NY = table.create(NV, 0), NZ = table.create(NV, 1),
			LIT = table.create(NV, 1), ALB = table.create(NV, 0.8),
			loc = table.create(NV, Vector3.zero), col = table.create(NV, Color3.new()),
			cx = 0, cy = 0, cz = 0, -- (the mesh's centre, storm-local m)
		}
		task.spawn(function()
			local ok, err = pcall(function()
				local em = AssetService:CreateEditableMesh()
				-- fixed bounds: two far corners in a zero-area face, so the part's size never changes
				local L = BOUNDS
				local b1 = em:AddVertex(Vector3.new(-L, -L, -L))
				local b2 = em:AddVertex(Vector3.new(L, L, L))
				local b3 = em:AddVertex(Vector3.new(L, L, L))
				em:AddTriangle(b1, b2, b3)
				local vids = table.create(NV)
				for i = 1, NV do
					vids[i] = em:AddVertex(Vector3.zero)
				end
				local ops = 0
				for _, b in BODIES do
					local rows, cols, off = b.rows, b.cols, b.off
					local function v(i: number, j: number): number
						return vids[off + (i - 1) * cols + ((j - 1) % cols) + 1]
					end
					-- rows go up the profile, columns counter-clockwise round it (seen from above,
					-- sim frame): (a, b, c) and (a, c, d) face outward
					for i = 1, rows - 1 do
						for j = 1, cols do
							local a, bb, c, d = v(i, j), v(i, j + 1), v(i + 1, j + 1), v(i + 1, j)
							em:AddTriangle(a, bb, c)
							em:AddTriangle(a, c, d)
						end
						ops += 2 * cols
						if ops > 3000 then
							ops = 0
							task.wait()
						end
					end
				end
				local cids = table.create(NV)
				for i, vid in vids do
					local c = em:AddColor(Color3.new(0.5, 0.5, 0.5), 1)
					cids[i] = c
					for _, f in em:GetVertexFaces(vid) do
						em:SetVertexFaceColor(vid, f, c)
					end
					if i % 1500 == 0 then
						task.wait()
					end
				end
				local hidden = em:AddColor(Color3.new(0.5, 0.5, 0.5), 1)
				for _, vid in { b1, b2, b3 } do
					for _, f in em:GetVertexFaces(vid) do
						em:SetVertexFaceColor(vid, f, hidden)
					end
				end
				local part = AssetService:CreateMeshPartAsync(Content.fromObject(em))
				part.Name = "StormMesh"
				part.Anchored, part.CanCollide, part.CanQuery, part.CanTouch = true, false, false, false
				part.CastShadow = false
				part.Material = Enum.Material.Neon
				part.Color = Color3.new(1, 1, 1)
				part.Transparency = 0
				pcall(function()
					part.DoubleSided = true
				end)
				part.LocalTransparencyModifier = 1
				part.CFrame = CFrame.new(0, -1e5, 0)
				part.Parent = folder
				slot.em, slot.part, slot.vids, slot.cids = em, part, vids, cids
				slot.ready = true
			end)
			if not ok then
				slot.failed = true
				warn("[StormVolume] couldn't build a storm mesh: " .. tostring(err))
			end
		end)
		return slot
	end

	-- Shape ------------------------------------------------------------------------------------
	-- every body's points (storm-local m, z above the datum), albedo, normals and sun, into slot
	local function shape(slot: any, s: any, sh: any, vT: number)
		local X, Y, Z, ALB = slot.X, slot.Y, slot.Z, slot.ALB
		local seed = (s.seed or 1) % 997
		local W = sh.W
		local base, el, top, colTop, fade, maturity = sh.base, sh.el, sh.top, sh.colTop, sh.fade, sh.maturity
		local cloudR = sh.cloudR
		local crisp = ramp(W, 8, 35) * (1 - fade)

		-- Tower: bottom pole, sides base -> colTop, a dome (or the overshooting top), top pole
		local T = BODIES[1]
		local rowsT, colsT = T.rows, T.cols
		local rMid = cloudR(base + 0.5 * (colTop - base))
		local lam = max((M.lobeSize or 0.4) * rMid, 500) -- (lobe wavelength, m)
		local boil = 0.25 * max(W, 3) * vT -- (the lobes rise with the updraft)
		-- the banded, rotating zone above the base (CardPlan's striation rules)
		local vmid = abs(s.vmid or 0)
		local qs = ramp(s.rot or 0, 0.25, 0.7) * ramp(vmid, 10, 25) * (1 - fade) * maturity
		local dryUp = 1 - ramp(s.efficiency or 0.5, 0.35, 0.7)
		local ms = qs * ramp(s.rot or 0, 0.5, 0.9) * ramp(vmid, 15, 30) * (0.35 + 0.65 * dryUp)
		local striZ = base + (500 + 4500 * ms)
		-- the dome / overshooting top
		local rTop, txT, tyT = cloudR(max(base, colTop - 400))
		local zCap, rCap = colTop + 0.55 * rTop, rTop
		local over = top - el
		if sh.anvil then
			zCap, rCap = colTop + 0.3 * rTop, rTop * 0.8 -- (hidden in the anvil's root)
			if fade == 0 and maturity >= 0.97 and over > 150 then
				local ruE = Storm.updraftRadiusAt(s, el)
				local wO = clamp(1.4 * ruE, 1200, 9000) * (0.5 + 0.5 * ramp(over, 150, 1500)) * ramp(W, 5, 15)
				if wO > 300 then
					zCap, rCap = top, max(0.5 * wO, 600)
				end
			end
		end
		local nDome = math.floor(rowsT * 0.22)
		local nSide = rowsT - 2 - nDome -- (rows 2 .. nSide + 1)
		-- (the column starts inside the base lens: its flat bottom on the base's would flicker)
		local zBot = base + (if sh.deck then 0.5 * sh.deck.thick else 0)
		local albT = 0.84 - 0.08 * fade + 0.04 * crisp
		local lobeA = (M.lobe or 0.13) * (0.6 + 0.6 * crisp) * (1 - 0.6 * fade)
		for i = 1, rowsT do
			local z, r, cx, cy, phi
			if i == 1 then
				local _, bx, by = cloudR(zBot)
				z, r, cx, cy, phi = zBot, 0, bx, by, -math.pi / 2
			elseif i <= nSide + 1 then
				local f = (i - 2) / max(nSide - 1, 1)
				z = zBot + (colTop - zBot) * f
				r, cx, cy = cloudR(z)
				phi = 0
				if z < striZ and qs > 0.05 then
					-- the bell of the rotating zone flaring toward the base (no stacked tiers: as
					-- solid rings they read as plates and ribbons; the banding is left to the cards)
					local zf = (z - base) / max(striZ - base, 1)
					r *= 1 + 0.3 * ms * (1 - zf) ^ 2
				end
			else
				local u = (i - nSide - 1) / (nDome + 1) -- (0 at colTop .. 1 at the pole)
				local a = u * math.pi / 2
				local rr = rTop + (rCap - rTop) * smoothstep(0, 0.35, u)
				z = colTop + (zCap - colTop) * sin(a)
				r = rr * cos(a)
				cx, cy = txT, tyT
				phi = a
				if i == rowsT then
					r = 0
				end
			end
			-- lobes: smooth plateaued noise, pushed out along the surface; laminar in the banded zone
			local lam2 = if phi == 0 then 1 - 0.85 * ms * (1 - smoothstep(striZ - 600, striZ, z)) else 1
			local cphi, sphi = cos(phi), sin(phi)
			for j = 1, colsT do
				local th = (j - 1) / colsT * TAU
				local ct, st = cos(th), sin(th)
				local px, py = cx + ct * r, cy + st * r
				local n = lumps(px / lam + seed, py / lam - 0.37 * seed, (z - boil) / lam)
				-- (plain smooth noise: a plateau shaping made steep creases that drew as shards)
				local bump = clamp(n, -1, 1) -- (-1 crease .. 1 lobe top)
				local d = lobeA * lam2 * max(r, 0.3 * rTop) * bump * (if i == 1 or i == rowsT then 0 else 1)
				local k = T.off + (i - 1) * colsT + j
				X[k], Y[k], Z[k] = px + ct * cphi * d, py + st * cphi * d, z + sphi * d
				ALB[k] = albT * (0.96 + 0.04 * bump)
			end
			pace()
		end

		-- Anvil: rows along the upper winds, columns round a flat-topped section
		local A = sh.anvil
		local AV = BODIES[2]
		if A then
			local rowsA, colsA = AV.rows, AV.cols
			local px0, py0 = -A.dy, A.dx
			local total = A.len + A.rr
			for i = 1, rowsA do
				local along = -A.rr + total * (i - 1) / (rowsA - 1)
				local w, tp, th = sh.anvilAt(max(along, 0))
				local f = clamp(along / max(A.len, 1), 0, 1)
				local cap = 1
				if along < 0 then
					cap = sqrt(max(0, 1 - (along / A.rr) ^ 2))
				elseif f > 0.85 then
					cap = sqrt(max(0, 1 - ((f - 0.85) / 0.15) ^ 2))
				end
				if i == 1 or i == rowsA then
					cap = 0
				end
				local hw = 0.5 * w * cap
				local ht = 0.5 * th * (0.4 + 0.6 * cap)
				local mx, my = A.rx + A.dx * along, A.ry + A.dy * along
				local zc = tp - 0.5 * th
				for j = 1, colsA do
					local psi = (j - 1) / colsA * TAU
					local c, sn = cos(psi), sin(psi)
					-- (superellipse: a flat top, a rounder underside, rounded sides)
					local yv = (if c >= 0 then 1 else -1) * abs(c) ^ 0.5
					local zv = (if sn >= 0 then 1 else -1) * abs(sn) ^ (if sn >= 0 then 0.3 else 0.7)
					local fr = 1 + 0.12 * fbm(along / 6000 + seed, psi * 0.8, 3.1) * (0.4 + 0.6 * f)
					local x, y = mx + px0 * yv * hw * fr, my + py0 * yv * hw * fr
					local z = zc + zv * ht
					if sn > 0 then
						-- knuckles on the young, upwind part of the top
						z += 0.35 * th * cap * max(0, fbm(x / 3500, y / 3500, seed + 4.2)) * (1 - f) * sn
					else
						z += 0.12 * th * cap * fbm(x / 5000, y / 5000, seed + 7.7) * -sn
					end
					local k = AV.off + (i - 1) * colsA + j
					-- (each row of the section turns the same way round as the tower's columns
					-- seen along the anvil: outward faces)
					X[k], Y[k], Z[k] = x, y, z
					ALB[k] = if sn > 0 then 0.92 else 0.82
				end
				pace()
			end
		else
			-- (no anvil yet: its points collapse into the tower's top)
			for k = AV.off + 1, AV.off + AV.rows * AV.cols do
				X[k], Y[k], Z[k] = txT, tyT, colTop
				ALB[k] = 0.9
			end
		end

		-- Base: a flat-bottomed lens, bottom pole to top pole
		local D = sh.deck
		local BB = BODIES[3]
		if D then
			local rowsB, colsB = BB.rows, BB.cols
			local albB = 0.72 - 0.12 * ramp(top - base, 6000, 13000)
			local thick = D.thick
			for i = 1, rowsB do
				local u = (i - 1) / (rowsB - 1)
				local phi = -math.pi / 2 + math.pi * u
				local cp, sp = cos(phi), sin(phi)
				-- (a rounded, tapering edge: a near-vertical rim of even thickness read as a flat
				-- disk from the ground, 2026-10-31 review)
				local rho = (abs(cp)) ^ 0.7
				local zs = if sp < 0 then -(abs(sp) ^ 0.45) else sp ^ 0.9
				if i == 1 or i == rowsB then
					rho = 0
				end
				for j = 1, colsB do
					local th = (j - 1) / colsB * TAU
					local ct, st = cos(th), sin(th)
					local R = D.r * (1 + clamp(0.16 * lumps(ct * 1.1 + seed, st * 1.1, 0.5) + 0.06 * lumps(ct * 4, st * 4, seed + 2), -0.35, 0.35))
					local x, y = D.x + ct * R * rho, D.y + st * R * rho
					-- (its thickness varies across it)
					local thk = thick * (0.5 + clamp(0.5 + 0.45 * lumps(x / 4500, y / 4500, seed + 5.5), 0, 1))
					local z = base + thk * (0.5 + 0.5 * zs) + (thick - thk) * 0.5
					local slotV = Util.slotAt(D.slot, x, y)
					if sp < 0 then
						-- lumps under the base and the clear slot pressed up into it
						z += 80 * lumps(x / 1600, y / 1600, seed + 1.3) * rho + slotV * thick * 0.85
					end
					local k = BB.off + (i - 1) * colsB + j
					X[k], Y[k], Z[k] = x, y, z
					ALB[k] = albB * (1 + 0.15 * slotV)
				end
				pace()
			end
		else
			local _, bx, by = cloudR(base)
			for k = BB.off + 1, BB.off + BB.rows * BB.cols do
				X[k], Y[k], Z[k] = bx, by, base
				ALB[k] = 0.7
			end
		end

		-- normals (rows x columns, columns wrapping; a pole falls back to out from the body's centre)
		local NXa, NYa, NZa = slot.NX, slot.NY, slot.NZ
		for _, b in BODIES do
			local rows, cols, off = b.rows, b.cols, b.off
			local sx, sy, sz = 0, 0, 0
			for k = off + 1, off + rows * cols do
				sx += X[k]
				sy += Y[k]
				sz += Z[k]
			end
			local nn = rows * cols
			sx, sy, sz = sx / nn, sy / nn, sz / nn
			for i = 1, rows do
				local iu, id = min(i + 1, rows), max(i - 1, 1)
				for j = 1, cols do
					local k = off + (i - 1) * cols + j
					local jr, jl = j % cols + 1, (j - 2) % cols + 1
					local ku, kd = off + (iu - 1) * cols + j, off + (id - 1) * cols + j
					local kr, kl = off + (i - 1) * cols + jr, off + (i - 1) * cols + jl
					-- (round x along: outward for counter-clockwise columns and rows going up)
					local ax, ay, az = X[kr] - X[kl], Y[kr] - Y[kl], Z[kr] - Z[kl]
					local bx, by, bz = X[ku] - X[kd], Y[ku] - Y[kd], Z[ku] - Z[kd]
					local nx, ny, nz = ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx
					local m = sqrt(nx * nx + ny * ny + nz * nz)
					if m < 1e-6 then
						nx, ny, nz = X[k] - sx, Y[k] - sy, Z[k] - sz
						m = sqrt(nx * nx + ny * ny + nz * nz)
					end
					if m < 1e-6 then
						nx, ny, nz, m = 0, 0, 1, 1
					end
					NXa[k], NYa[k], NZa[k] = nx / m, ny / m, nz / m
				end
				if i % 8 == 0 then
					pace()
				end
			end
		end

		-- smoothed normals: light scattered through a cloud follows its broad form, not each lump's
		-- facet (two passes over each point's four neighbours; abrupt turns had drawn white beside
		-- near-black, 2026-10-31 review)
		do
			local tx, ty, tz = table.create(NV, 0), table.create(NV, 0), table.create(NV, 0)
			for _ = 1, M.normalSmooth or 3 do
				for _, b in BODIES do
					local rows, cols, off = b.rows, b.cols, b.off
					for i = 1, rows do
						local iu, id = min(i + 1, rows), max(i - 1, 1)
						for j = 1, cols do
							local k = off + (i - 1) * cols + j
							local kr = off + (i - 1) * cols + j % cols + 1
							local kl = off + (i - 1) * cols + (j - 2) % cols + 1
							local ku, kd = off + (iu - 1) * cols + j, off + (id - 1) * cols + j
							local nx = 2 * NXa[k] + NXa[kr] + NXa[kl] + NXa[ku] + NXa[kd]
							local ny = 2 * NYa[k] + NYa[kr] + NYa[kl] + NYa[ku] + NYa[kd]
							local nz = 2 * NZa[k] + NZa[kr] + NZa[kl] + NZa[ku] + NZa[kd]
							local m = sqrt(nx * nx + ny * ny + nz * nz)
							if m < 1e-6 then
								tx[k], ty[k], tz[k] = NXa[k], NYa[k], NZa[k]
							else
								tx[k], ty[k], tz[k] = nx / m, ny / m, nz / m
							end
						end
					end
				end
				for k = 1, NV do
					NXa[k], NYa[k], NZa[k] = tx[k], ty[k], tz[k]
				end
				pace()
			end
		end

		-- sun through the storm's own cloud, from just outside the surface. The base is sampled from
		-- inside its own slab (a base is optically thick: its sides and underside are lit through it)
		local LIT = slot.LIT
		local b0, b1 = BODIES[3].off, BODIES[3].off + BODIES[3].rows * BODIES[3].cols
		for k = 1, NV do
			if D and k > b0 and k <= b1 then
				local ix, iy = D.x + 0.85 * (X[k] - D.x), D.y + 0.85 * (Y[k] - D.y)
				LIT[k] = sh.sunLit(ix, iy, base + 0.5 * D.thick)
			else
				LIT[k] = sh.sunLit(X[k] + 60 * NXa[k], Y[k] + 60 * NYa[k], Z[k] + 60 * NZa[k])
			end
			if k % 200 == 0 then
				pace()
			end
		end

		-- the mesh's centre and its scale: the largest copy that fits the part's bounds, in 3% steps
		-- (a step changes every card drawn about the storm, so it changes rarely)
		local x0, x1, y0, y1, z0, z1 = math.huge, -math.huge, math.huge, -math.huge, math.huge, -math.huge
		for k = 1, NV do
			local x, y, z = X[k], Y[k], Z[k]
			x0, x1 = min(x0, x), max(x1, x)
			y0, y1 = min(y0, y), max(y1, y)
			z0, z1 = min(z0, z), max(z1, z)
		end
		local cx, cy, cz = 0.5 * (x0 + x1), 0.5 * (y0 + y1), 0.5 * (z0 + z1)
		local ext = C.studs(0.5 * max(x1 - x0, y1 - y0, z1 - z0, 1))
		local k0 = min(1, (BOUNDS - 4) / ext)
		k0 = 1.03 ^ math.floor(math.log(k0) / math.log(1.03))
		local loc = slot.loc
		for k = 1, NV do
			loc[k] = C.toLocal(X[k] - cx, Y[k] - cy, Z[k] - cz) * k0
		end
		slot.em:BatchSetValues(slot.vids, loc)
		slot.cx, slot.cy, slot.cz, slot.k = cx, cy, cz, k0
		slot.reach2 = (max(15000, 1.6 * ((D and D.r) or 6000))) ^ 2
		slot.shapedAt = os.clock()
		slot.shadeDirty = true
	end

	-- Shade ------------------------------------------------------------------------------------
	-- (the colours stay under ~0.85: brighter Neon blooms into a white halo)
	local SUN_GAIN = 1.1
	local CAP = 0.72
	-- (Neon draws its colour brighter than an unlit billboard draws the same colour: the mesh's
	-- colours are scaled to match the cards beside it; LabConfig.STORM_MESH.exposure)
	local EXPOSURE = M.exposure or 0.6
	local function shade(slot: any, g: any, camM: Vector3)
		local L = ctx.stormShade and ctx.stormShade.light and ctx.stormShade.light()
		if not L then
			return
		end
		local X, Y, Z, NXa, NYa, NZa, LIT, ALB = slot.X, slot.Y, slot.Z, slot.NX, slot.NY, slot.NZ, slot.LIT, slot.ALB
		local col = slot.col
		local ox, oy = g.px, g.py
		local sx, sy, sz = L.sx, L.sy, L.sz
		local hazeC = Util.light.haze
		local night = L.night
		local fogC = L.fog
		-- the storm's rain fog (Render/StormCards: rain between the camera and the storm's centre)
		local grp = ctx.stormShade.group and ctx.stormShade.group(slot.owner)
		local fog = (grp and grp.fog) or 0
		local fogTau = if fog > 0.01 then -math.log(1 - min(fog, 0.97)) else 0
		local baseZ = slot.base or 1000
		local distC = max(sqrt((ox - camM.X) ^ 2 + (oy - camM.Y) ^ 2), 500)
		local debugN = Workspace:GetAttribute("StormVolumeNormals") == true
		local warm = L.warm
		local cr, cg, cb = 1.04, 1.0 - 0.18 * warm, 0.9 - 0.36 * warm
		for k = 1, NV do
			local px, py, pz = ox + X[k], oy + Y[k], Z[k]
			local vx, vy, vz = px - camM.X, py - camM.Y, pz - camM.Z
			local d = max(sqrt(vx * vx + vy * vy + vz * vz), 1)
			vx, vy, vz = vx / d, vy / d, vz / d
			local nx, ny, nz = NXa[k], NYa[k], NZa[k]
			local lit = LIT[k]
			local facing = nx * sx + ny * sy + nz * sz
			-- (soft: light scattered through the volume reaches faces turned away and cloud in the
			-- storm's shadow - a cloud is never lit by its surface angle alone)
			local floor = 0.5 * clamp(1 + facing, 0.4, 1)
			local litS = 0.2 + 0.8 * lit
			local s = L.direct * litS * 0.9 * SUN_GAIN * (floor + (1 - floor) * max(0, 0.25 + 0.75 * facing))
			-- forward scatter: an edge seen toward the sun glows (the silver lining)
			local rim = 1 - abs(nx * vx + ny * vy + nz * vz)
			local fwd = max(0, vx * sx + vy * sy + vz * sz) ^ 4
			if fwd > 0.01 then
				s += 0.4 * L.direct * lit * fwd * rim * rim
			end
			-- sky light: an up-facing surface sees the whole sky, a down-facing one the dark ground
			-- under the storm's shadow; deep in the storm's shade less of it
			local sky = L.sky * (0.38 + 0.62 * (0.5 + 0.5 * nz) ^ 1.5) * (0.75 + 0.25 * lit)
			local deep = 0.6 * (1 - min(lit, 1)) * (1 - night)
			local a = ALB[k]
			local r = a * (sky * (0.93 - 0.2 * deep) + s * cr)
			local gg = a * (sky * (0.99 - 0.04 * deep) + s * cg)
			local b = a * (sky * (1.1 + 0.04 * deep) + s * cb)
			local over = max(r, gg, b, CAP) / CAP
			r, gg, b = r / over, gg / over, b / over
			-- rain fog (rain lies below the base: a sight line to height z spends base / z of its
			-- length in it, and the fog grows with distance) and haze
			if fogTau > 0 then
				local f = 1 - exp(-fogTau * min(1, baseZ / max(pz, 1)) * min(1, d / distC))
				r, gg, b = r + (fogC.R - r) * f, gg + (fogC.G - gg) * f, b + (fogC.B - b) * f
			end
			local hf = Util.hazeF(d) * (1 - night)
			if hf > 0.01 then
				r, gg, b = r + (hazeC.R - r) * hf, gg + (hazeC.G - gg) * hf, b + (hazeC.B - b) * hf
			end
			if debugN then
				r, gg, b = 0.5 + 0.5 * nx, 0.5 + 0.5 * nz, 0.5 + 0.5 * ny
			end
			-- (last: the haze and fog colours are scaled too - mixed in after it, far storms faded to
			-- a near-white haze that Neon drew as a glow)
			col[k] = Color3.new(clamp(EXPOSURE * r, 0, 1), clamp(EXPOSURE * gg, 0, 1), clamp(EXPOSURE * b, 0, 1))
			if k % 300 == 0 then
				pace()
			end
		end
		slot.em:BatchSetValues(slot.cids, col)
		slot.shadedFrom = camM
		slot.shadedSun = Vector3.new(sx, sy, sz)
		slot.shadedAt = os.clock()
		slot.shadeDirty = false
	end

	-- Which storms ----------------------------------------------------------------------------
	local groups = {} -- id -> { px, py } (the storm's glide, as StormCards')
	local busy = {} -- slot -> true while a job of it runs
	local function score(s: any, camX: number, camY: number): number
		local d = sqrt((s.x - camX) ^ 2 + (s.y - camY) ^ 2)
		local ext = 6000 + 0.5 * max(s.anvilLen or 0, 0) + 0.5 * max(s.top or 10000, 0)
		return ext / max(d, 2000)
	end
	local function release(slot: any)
		if slot.owner then
			ctx.meshStorms[slot.owner] = nil
		end
		slot.owner, slot.shown, slot.shapedAt = nil, false, nil
		if slot.part then
			slot.part.LocalTransparencyModifier = 1
		end
	end

	local self = {}
	local lastStat = 0
	function self:update(dt: number)
		frameStart = os.clock()
		local on = ctx.state.show.clouds ~= false and ctx.state.stormStyle ~= "cards"
		if not on then
			for _, slot in slots do
				release(slot)
			end
			table.clear(C.pull)
			return
		end
		local cw = ctx.cw
		local camS = Workspace.CurrentCamera.CFrame.Position
		local camM = Vector3.new(C.fromWorld(camS))
		local simT = ctx:simTime()
		local dtSnap = clamp(simT - (cw.time or simT), -5, 60)
		local simDt = if ctx.state.paused then 0 else dt * (ctx.state.timeScale or 1)
		local vT = ctx:visualTime()

		-- the storms by size on screen; holders count 1.5x (hysteresis)
		local byId = {}
		local ranked = {}
		for _, s in cw.storms do
			if s.wprof and s.tiltX then
				local id = tostring(s.id)
				byId[id] = s
				local sc = score(s, camM.X, camM.Y)
				if ctx.meshStorms[id] then
					sc *= 1.5
				end
				table.insert(ranked, { id = id, sc = sc })
			end
		end
		table.sort(ranked, function(a, b)
			return a.sc > b.sc
		end)
		local want = {}
		for i = 1, min(#ranked, M.maxStorms or 3) do
			want[ranked[i].id] = true
		end
		-- free the slots of storms no longer wanted (not while a job is writing them)
		for _, slot in slots do
			if slot.owner and (not want[slot.owner] or not byId[slot.owner]) and not busy[slot] then
				release(slot)
			end
		end
		-- give wanted storms a slot
		for id in want do
			local has = false
			for _, slot in slots do
				if slot.owner == id then
					has = true
				end
			end
			if not has then
				local free
				for _, slot in slots do
					if not slot.owner and not slot.failed then
						free = slot
						break
					end
				end
				if not free and #slots < (M.maxStorms or 3) then
					free = newSlot()
					table.insert(slots, free)
				end
				if free then
					free.owner = id
					free.shown = false
					free.shapedAt = nil
				end
			end
		end

		-- each held storm: glide, reshape when due, re-shade when the view or light moved
		for _, slot in slots do
			local id = slot.owner
			local s = id and byId[id]
			if s and slot.ready then
				local g = groups[id]
				if not g then
					g = {}
					groups[id] = g
				end
				local tx, ty = s.x + (s.u or 0) * dtSnap, s.y + (s.v or 0) * dtSnap
				if not g.px or (tx - g.px) ^ 2 + (ty - g.py) ^ 2 > 3000 ^ 2 then
					g.px, g.py = tx, ty
				else
					local ease = 1 - exp(-dt / 1.5)
					g.px += (s.u or 0) * simDt + (tx - g.px) * ease
					g.py += (s.v or 0) * simDt + (ty - g.py) * ease
				end
				if not busy[slot] then
					local due = not slot.shapedAt or os.clock() - slot.shapedAt > (M.rebuildEvery or 3)
					if due then
						local sh = StormShape.build(s, Storm)
						if sh then
							busy[slot] = true
							slot.base = sh.base
							addJob(function()
								shape(slot, s, sh, vT)
								busy[slot] = nil
							end)
						end
					elseif slot.shapedAt then
						local L = ctx.stormShade and ctx.stormShade.light and ctx.stormShade.light()
						local d = sqrt((g.px + slot.cx - camM.X) ^ 2 + (g.py + slot.cy - camM.Y) ^ 2) + 1000
						local moved = slot.shadedFrom and (camM - slot.shadedFrom).Magnitude > 0.02 * d
						local sunMoved = L and slot.shadedSun and (Vector3.new(L.sx, L.sy, L.sz) - slot.shadedSun).Magnitude > 0.01
						local old = not slot.shadedAt or os.clock() - slot.shadedAt > 1.5
						if slot.shadeDirty or moved or sunMoved or old then
							busy[slot] = true
							local camAt = camM
							addJob(function()
								shade(slot, g, camAt)
								busy[slot] = nil
								if slot.owner == id then
									slot.shown = true
									ctx.meshStorms[id] = true
								end
							end)
						end
					end
				end
			end
		end

		-- run jobs within the budget
		local i = 1
		while i <= #jobs and os.clock() - frameStart < budget do
			local co = jobs[i]
			local ok, err = coroutine.resume(co)
			if not ok then
				warn("[StormVolume] " .. tostring(err))
			end
			if coroutine.status(co) == "dead" then
				table.remove(jobs, i)
			else
				i += 1
			end
		end
		-- (a job of a slot released meanwhile left `busy` set only until it ended)

		-- place the meshes (scaled copies along the view) and publish the pull for the cards
		table.clear(C.pull)
		for _, slot in slots do
			local id = slot.owner
			local g = id and groups[id]
			if slot.ready and slot.shown and g and slot.part then
				local kv = slot.k
				local P = C.toWorld(g.px + slot.cx, g.py + slot.cy, slot.cz)
				slot.part.CFrame = CFrame.new(camS + (P - camS) * kv)
				slot.part.LocalTransparencyModifier = 0
				table.insert(C.pull, { x = g.px, y = g.py, r2 = slot.reach2 or 2.25e8, k = kv })
			elseif slot.part then
				slot.part.LocalTransparencyModifier = 1
			end
		end
		for id in groups do
			if not byId[id] then
				groups[id] = nil
			end
		end
		local now = os.clock()
		if now - lastStat > 0.5 then
			lastStat = now
			local n, ks = 0, {}
			for _, slot in slots do
				if slot.shown then
					n += 1
					table.insert(ks, string.format("%s k%.4f", tostring(slot.owner), slot.k))
				end
			end
			ctx.root:SetAttribute("StormVolume", string.format("%d meshes · %d jobs · %s", n, #jobs, table.concat(ks, " ")))
		end
	end
	return self
end

return StormVolume
