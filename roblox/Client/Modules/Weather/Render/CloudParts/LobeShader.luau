--!nonstrict
--!native
-- A software shader for the lobe cards (2026-10-29). Roblox has no custom GPU shaders, so the
-- light inside a cumuliform card is computed here, in Luau, into EditableImages: a run of sun
-- angles instead of the three fixed Blender bakes (front / side / back, LabConfig.LOBES).
--
-- Each lobe is the lobe bake's shape (tools/blender/lobe_bake.py lobe_grid: a cluster of spheres
-- with smaller domes up and out, a flatter side where it joins its cloud, smooth billows) seen
-- along the view as two surfaces: its front (toward the viewer) and back depth, per pixel. The
-- card is turned so its frame's top faces the sun on screen (Render/StormCards), so in the frame
-- the sun is straight up, tilted toward or away from the viewer by vs (the sun's component along
-- the view: -1 behind the viewer, front lit; +1 behind the cloud, back lit). Per pixel:
--   sun      sunlight reaching the visible surface: a march toward the sun through the lobe's
--            soft-edged body (shadows from domes above and in front; through the body when back
--            lit), Beer-Lambert with a multiple-scattering tail (0.7 e^-t + 0.3 e^-0.2t), the
--            Henyey-Greenstein phase (g 0.3: thin edges glow when back lit - the silver lining),
--            and a soft facing term
--   sky      sky light, less in the creases (the surface below its surroundings) and more where
--            the cloud is thin
-- The result is toned to the old sheets' brightness (mean ~0.88 over the lobe) and contrast is a
-- share of the light's own variation, so the storm-scale light in the card's colour (StormCards
-- shadeCard) still carries the storm, and this the lobe.
--
-- Sheets: tower / under / soft are 4 x 4 lobes of FRAME px; *_near the first four lobes at
-- NEAR_FRAME px (2 x 2), the same shapes (each lobe has its own random stream). `under` also has
-- a sky-only sheet (amb: lumps deep in the storm's shadow). Built once, in the background, BUDGET
-- ms a frame; until a family is ready its cards keep the Blender bakes.
local AssetService = game:GetService("AssetService")

local LobeShader = {}

local CELL = 1.3 -- lobe units across a frame (a lobe is ~1 across)
local K, DS = 20, 0.03 -- sun march steps and step (lobe units)
local SIGMA, G = 22.0, 0.3
local MEAN, CONTRAST = 0.88, 0.6

local FAM = {
	tower = { spheres = { 3, 6 }, sub = 14, flat = 0.3, flip = false, billow = { { 2.2, 0.09 }, { 4.5, 0.035 } }, salt = 11 },
	under = { spheres = { 3, 6 }, sub = 12, flat = 0.45, flip = true, billow = { { 2.0, 0.08 }, { 4.0, 0.03 } }, salt = 23 },
	soft = { spheres = { 2, 4 }, sub = 6, flat = 0.0, flip = false, billow = { { 1.6, 0.06 } }, salt = 37 },
}

local exp, sqrt, max, min, floor, clamp = math.exp, math.sqrt, math.max, math.min, math.floor, math.clamp
local rf, wf = buffer.readf32, buffer.writef32

-- the background budget: yield when this frame's share is spent
local budgetMs = 3
local sliceAt = 0
local function tick()
	if os.clock() - sliceAt > budgetMs / 1000 then
		task.wait()
		sliceAt = os.clock()
	end
end

local function newF(n: number): buffer
	return buffer.create(n * 4)
end

local function normal(rng: Random): number
	local u1 = max(rng:NextNumber(), 1e-9)
	return sqrt(-2 * math.log(u1)) * math.cos(2 * math.pi * rng:NextNumber())
end

-- smooth value noise on a 16 x 16 lattice (wraps)
local function lattice(rng: Random): { number }
	local g = table.create(256)
	for i = 1, 256 do
		g[i] = normal(rng)
	end
	return g
end
local function vnoise(g: { number }, x: number, y: number, sc: number): number
	local u, v = (x * sc) % 16, (y * sc) % 16
	local i, j = floor(u), floor(v)
	local fu, fv = u - i, v - j
	fu, fv = fu * fu * (3 - 2 * fu), fv * fv * (3 - 2 * fv)
	local i1, j1 = (i + 1) % 16, (j + 1) % 16
	local a, b = g[i * 16 + j + 1], g[i1 * 16 + j + 1]
	local c, d = g[i * 16 + j1 + 1], g[i1 * 16 + j1 + 1]
	return (a * (1 - fu) + b * fu) * (1 - fv) + (c * (1 - fu) + d * fu) * fv
end

-- box blur (radius r px, edges clamped), separable running sums
local function blur(src: buffer, R: number, r: number): buffer
	local tmp, dst = newF(R * R), newF(R * R)
	local k = 2 * r + 1
	for i = 0, R - 1 do
		local row = i * R
		local s = 0
		for j = -r, r do
			s += rf(src, (row + clamp(j, 0, R - 1)) * 4)
		end
		for j = 0, R - 1 do
			wf(tmp, (row + j) * 4, s / k)
			s += rf(src, (row + min(j + r + 1, R - 1)) * 4) - rf(src, (row + max(j - r, 0)) * 4)
		end
	end
	for j = 0, R - 1 do
		local s = 0
		for i = -r, r do
			s += rf(tmp, (clamp(i, 0, R - 1) * R + j) * 4)
		end
		for i = 0, R - 1 do
			wf(dst, (i * R + j) * 4, s / k)
			s += rf(tmp, (min(i + r + 1, R - 1) * R + j) * 4) - rf(tmp, (max(i - r, 0) * R + j) * 4)
		end
	end
	return dst
end

-- one lobe's shape at R px: front / back depth (toward the viewer +), coverage and the blurred
-- copies the light needs
local function shape(famName: string, idx: number, R: number): any
	local fam = FAM[famName]
	local rng = Random.new(5000 + fam.salt * 101 + idx * 7919)
	local sph = {}
	for _ = 1, rng:NextInteger(fam.spheres[1], fam.spheres[2]) do
		table.insert(sph, { rng:NextNumber(-0.24, 0.24), rng:NextNumber(-0.14, 0.14), rng:NextNumber(-0.14, 0.1), rng:NextNumber(0.2, 0.3) })
	end
	local nBase = #sph
	for _ = 1, fam.sub do
		local b = sph[rng:NextInteger(1, nBase)]
		local dx, dy, dz = normal(rng), normal(rng), normal(rng)
		dz = math.abs(dz) * 0.8 + 0.2 * dz -- (mostly up and out)
		local m = max(sqrt(dx * dx + dy * dy + dz * dz), 1e-6)
		local r = b[4]
		table.insert(sph, { b[1] + dx / m * r * 0.9, b[2] + dy / m * r * 0.9, b[3] + dz / m * r * 0.9, rng:NextNumber(0.09, 0.16) })
	end
	local lats = {}
	for k = 1, #fam.billow + 2 do
		lats[k] = lattice(rng)
	end
	local N = R * R
	local zf, zb, mask = newF(N), newF(N), newF(N)
	local sc = R / 128 -- (blur radii were set at 128 px)
	for i = 0, R - 1 do
		local U = -(((i + 0.5) / R - 0.5) * CELL)
		for j = 0, R - 1 do
			local X = ((j + 0.5) / R - 0.5) * CELL
			local f, b = -9, 9
			for _, s in sph do
				local cz = if fam.flip then -s[3] else s[3]
				local d2 = (X - s[1]) ^ 2 + (U - cz) ^ 2
				local r2 = s[4] * s[4]
				if d2 < r2 then
					local h = sqrt(r2 - d2)
					-- (Blender's y is depth away from the camera)
					f = max(f, -s[2] + h)
					b = min(b, -s[2] - h)
				end
			end
			local p = (i * R + j) * 4
			if f > b then
				for k, bl in fam.billow do
					f += bl[2] * vnoise(lats[k], X + 5, U + 5, bl[1] * 2)
				end
				if fam.flat > 0 then
					local cut = if fam.flip then 0.36 - U else U + 0.36
					f = b + (f - b) * (0.25 + 0.75 * clamp(cut / 0.12, 0, 1))
				end
			end
			wf(zf, p, f)
			wf(zb, p, b)
			wf(mask, p, if f > b then 1 else 0)
		end
		tick()
	end
	-- rounded joins: the surfaces smoothed where the cloud is
	local r6 = math.max(1, floor(6 * sc + 0.5))
	local zfm, zbm = newF(N), newF(N)
	for p = 0, N - 1 do
		local m = rf(mask, p * 4)
		wf(zfm, p * 4, rf(zf, p * 4) * m)
		wf(zbm, p * 4, rf(zb, p * 4) * m)
	end
	local w, zfs, zbs = blur(mask, R, r6), blur(zfm, R, r6), blur(zbm, R, r6)
	tick()
	local t, cov = newF(N), newF(N)
	local nE1, nE2 = lats[#fam.billow + 1], lats[#fam.billow + 2]
	for i = 0, R - 1 do
		local U = -(((i + 0.5) / R - 0.5) * CELL)
		for j = 0, R - 1 do
			local X = ((j + 0.5) / R - 0.5) * CELL
			local p = (i * R + j) * 4
			if rf(mask, p) > 0 then
				local ww = rf(w, p) + 1e-6
				wf(zf, p, rf(zfs, p) / ww)
				wf(zb, p, rf(zbs, p) / ww)
			end
			local tt = max(0, rf(zf, p) - rf(zb, p))
			wf(t, p, tt)
			-- coverage: a soft fringe broken by noise
			local edge = 0
			if tt > 0 then
				edge = vnoise(nE1, X + 11, U + 3, 9) * 0.05 + vnoise(nE2, X + 2, U + 7, 22) * 0.025
			end
			wf(cov, p, clamp((tt + edge - 0.02) / 0.4, 0, 1))
		end
	end
	cov = blur(cov, R, r6)
	for p = 0, N - 1 do
		local c = rf(cov, p * 4)
		wf(cov, p * 4, c * c * (3 - 2 * c))
	end
	tick()
	local r4 = math.max(1, floor(4 * sc + 0.5))
	local r8 = math.max(1, floor(8 * sc + 0.5))
	local zm = newF(N)
	for p = 0, N - 1 do
		wf(zm, p * 4, if rf(t, p * 4) > 0 then rf(zf, p * 4) else 0)
	end
	local zmb = blur(zm, R, r8)
	local ao = newF(N)
	for p = 0, N - 1 do
		wf(ao, p * 4, clamp(1 - 3 * max(0, rf(zmb, p * 4) - rf(zm, p * 4)), 0.5, 1))
	end
	local sh = { R = R, zf = zf, zb = zb, cov = cov, ao = ao, tb = blur(t, R, r4),
		zfb = blur(zf, R, r4), zbb = blur(zb, R, r4), covb = blur(cov, R, r4) }
	tick()
	return sh
end

local function hg(c: number): number
	return (1 - G * G) / (1 + G * G - 2 * G * c) ^ 1.5
end

-- the light at every pixel of a lobe for sun tilt vs (ambOnly: sky light alone)
local function relight(sh: any, vs: number, ambOnly: boolean): buffer
	local R = sh.R
	local zf, zfb, zbb, covb, ao, tb = sh.zf, sh.zfb, sh.zbb, sh.covb, sh.ao, sh.tb
	local Lt = -vs
	local Lu = sqrt(max(0, 1 - Lt * Lt))
	local px = CELL / R
	local phase = hg(-Lt) / hg(0)
	local out = newF(R * R)
	for i = 0, R - 1 do
		local iu, id = max(i - 1, 0), min(i + 1, R - 1)
		for j = 0, R - 1 do
			local p = (i * R + j) * 4
			local sky = rf(ao, p) * (0.75 + 0.25 * exp(-4 * rf(tb, p)))
			local v = sky
			if not ambOnly then
				local jl, jr = max(j - 1, 0), min(j + 1, R - 1)
				local z = rf(zf, p)
				local gx = (rf(zf, (i * R + jr) * 4) - rf(zf, (i * R + jl) * 4)) / ((jr - jl) * px)
				local gu = -(rf(zf, (id * R + j) * 4) - rf(zf, (iu * R + j) * 4)) / ((id - iu) * px)
				local nl = sqrt(gx * gx + gu * gu + 1)
				local ndl = (-gu * Lu + Lt) / nl
				local z0 = z - 0.03
				local path = 0
				for k = 1, K do
					local s = k * DS
					local qr = clamp(floor(i - s * Lu / px + 0.5), 0, R - 1)
					local q = (qr * R + j) * 4
					local qz = z0 + s * Lt
					local a = (rf(zfb, q) - qz) / 0.08
					if a > 0 then
						local b = (qz - rf(zbb, q)) / 0.08
						if b > 0 then
							path += min(a, 1) * min(b, 1) * rf(covb, q) * DS
						end
					end
				end
				local T = 0.7 * exp(-SIGMA * path) + 0.3 * exp(-0.2 * SIGMA * path)
				local surf = 0.55 + 0.45 * clamp(ndl * 0.5 + 0.5, 0, 1)
				v = 0.4 * sky + 0.6 * T * phase * surf
			end
			wf(out, p, v)
		end
		tick()
	end
	return out
end

-- one sheet (per x per lobes of R px) for sun tilt vs: an EditableImage, or nil
local function sheet(shapes: { any }, per: number, vs: number, ambOnly: boolean): any?
	local R = shapes[1].R
	local raws = {}
	local sum, n = 0, 0
	for k, sh in shapes do
		local raw = relight(sh, vs, ambOnly)
		raws[k] = raw
		for p = 0, R * R - 1 do
			if rf(sh.cov, p * 4) > 0.5 then
				sum += rf(raw, p * 4)
				n += 1
			end
		end
	end
	local mean = max(sum / max(n, 1), 1e-3)
	local S = per * R
	local img = buffer.create(S * S * 4)
	for k, sh in shapes do
		local raw = raws[k]
		local r0, c0 = floor((k - 1) / per) * R, ((k - 1) % per) * R
		for i = 0, R - 1 do
			for j = 0, R - 1 do
				local p = (i * R + j) * 4
				local L = clamp(MEAN * (1 + CONTRAST * (rf(raw, p) - mean) / mean), 0, 1)
				local o = ((r0 + i) * S + c0 + j) * 4
				local g = floor(L * 255 + 0.5)
				buffer.writeu8(img, o, g)
				buffer.writeu8(img, o + 1, g)
				buffer.writeu8(img, o + 2, g)
				buffer.writeu8(img, o + 3, floor(rf(sh.cov, p) * 255 + 0.5))
			end
		end
		tick()
	end
	local ok, ei = pcall(function()
		return AssetService:CreateEditableImage({ Size = Vector2.new(S, S) })
	end)
	if not ok or not ei then
		warn("[StormLab] LobeShader: no EditableImage (" .. tostring(ei) .. ")")
		return nil
	end
	ei:WritePixelsBuffer(Vector2.zero, Vector2.new(S, S), img)
	return ei
end

-- LobeShader.sheets[family] = { bins = { vs... }, img = { Content... }, amb = Content?, frame, per }
-- once ready (nil before). cfg: LabConfig.LOBE_SHADER.
LobeShader.sheets = {}
LobeShader.status = "idle"

function LobeShader.start(cfg: any)
	if LobeShader.status ~= "idle" then
		return
	end
	LobeShader.status = "building"
	budgetMs = cfg.budgetMs or 3
	local bins = cfg.bins or { -0.8, -0.4, 0, 0.4, 0.8 }
	local frame, nearFrame = cfg.frame or 128, cfg.nearFrame or 256
	task.spawn(function()
		sliceAt = os.clock()
		local t0 = os.clock()
		local keep = {} -- (the EditableImages: kept alive)
		for _, fam in { "soft", "tower", "under" } do
			for _, near in { false, true } do
				if near and fam == "soft" then
					continue
				end
				local R = if near then nearFrame else frame
				local per = if near then 2 else 4
				local shapes = {}
				for idx = 0, per * per - 1 do
					shapes[idx + 1] = shape(fam, idx, R)
				end
				local set = { bins = bins, img = {}, frame = R, per = per }
				for b, vs in bins do
					local ei = sheet(shapes, per, vs, false)
					if not ei then
						LobeShader.status = "failed"
						return
					end
					table.insert(keep, ei)
					set.img[b] = Content.fromObject(ei)
				end
				if fam == "under" then
					local ei = sheet(shapes, per, 0, true)
					if ei then
						table.insert(keep, ei)
						set.amb = Content.fromObject(ei)
					end
				end
				LobeShader.sheets[fam .. (if near then "_near" else "")] = set
			end
		end
		LobeShader.keep = keep
		LobeShader.status = string.format("ready in %.1f s", os.clock() - t0)
	end)
end

-- the bin for tilt vs, kept while vs stays within 0.6 of a bin step of it (no flicker)
function LobeShader.pick(set: any, vs: number, last: number?): number
	local bins = set.bins
	local step = if #bins > 1 then (bins[#bins] - bins[1]) / (#bins - 1) else 1
	if last and bins[last] and math.abs(vs - bins[last]) < 0.6 * step then
		return last
	end
	local best, bd = 1, math.huge
	for b, v in bins do
		local d = math.abs(vs - v)
		if d < bd then
			best, bd = b, d
		end
	end
	return best
end

return LobeShader
