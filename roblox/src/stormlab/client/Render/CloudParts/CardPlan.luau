--!nonstrict
--!native
-- One storm's billboard cards (Render/StormCards), laid out from its fields (CloudParts/StormShape)
-- and never from labels. Storm-local sim metres from (s.x, s.y); each card is
--   { x, y, z, w, h, a, tex, frame, albedo, lit, sky, rot }
-- w, h      card size (m); a  opacity; tex / frame  texture name and 4x4 sheet frame (or -1)
-- albedo    the cloud's brightness; lit  direct sun reaching the card's sunward surface through the
--           storm's own cloud (StormShape.sunLit marched from that surface: the sunny side bright,
--           the far side and the base in the storm's shadow); sky  the share of sky light it sees
--           (an underside only sees the ground)
--   tower    rings of cards up the tilted updraft at its radius, a centre card filling the column
--   billows  lumpy cauliflower cards bulging out of the column, more and crisper with W
--   top      a dome while rising, a cap under the anvil when mature; an overshooting top from top-el
--   anvil    a slab of wide flat cards downstream at el, widening and thinning downstream
--   base     wide flat dark cards under the updraft at the cloud base (~2.2 Ru(base))
-- `detail` (0.3 .. 1) thins the cards with distance.
local Util = require(script.Parent:WaitForChild("Util"))
local StormShape = require(script.Parent:WaitForChild("StormShape"))

local CardPlan = {}

local ramp, hash = Util.ramp, Util.hash
local sqrt, cos, sin, max, min, clamp = math.sqrt, math.cos, math.sin, math.max, math.min, math.clamp
local TAU = 2 * math.pi
-- 4 x 4 sheets (a card shows one frame: a tiled sheet reads as a row of beads)
-- (sheets only: their frames have clear edges. The single softFlat image does not, and a large
-- or squashed card of it shows its rectangle)
local SHEETS = { lumpyFlat = true, basePuffs = true, softSheetFlat = true, shredFlat = true, wispFlat = true, wispyFlat = true, strandsFlat = true, striationFlat = true, curtainFlat = true, fractusFlat = true, dirtGrainFlat = true }
-- textures that exist (set by the renderer from LabConfig.TEXTURES: some are optional)
CardPlan.available = {} :: { [string]: boolean }
-- scud and tufts: the torn fractus sheet once uploaded, else the shreds / wisps
local function scudTex(h: number): string
	if CardPlan.available.fractusFlat then
		return "fractusFlat"
	end
	return if h < 0.5 then "shredFlat" else "wispFlat"
end

-- (camDx, camDy: the camera from the storm's centre, m; it picks how the base deck is drawn)
function CardPlan.plan(s: any, Storm: any, detail: number, camDx: number?, camDy: number?): ({ any }, any?, any?)
	local out = {}
	local sh = StormShape.build(s, Storm)
	if not sh then
		return out, nil, nil
	end
	local seed = s.seed or 1
	-- a card's identity: texture + its position rounded to a cell (and a count for cells holding
	-- more than one). Re-plans keep the same key while the storm evolves slowly, so Render/StormCards
	-- updates that card in place, and its look (sheet frame, rotation) comes from the key: no popping.
	local used = {}
	local function cardKey(layer: string, tex: string, x: number, y: number, z: number): (string, number)
		local kx, ky, kz = math.floor(x / 300 + 0.5), math.floor(y / 300 + 0.5), math.floor(z / 200 + 0.5)
		local base = layer .. tex .. ":" .. kx .. "," .. ky .. "," .. kz
		local n = (used[base] or 0) + 1
		used[base] = n
		return base .. "#" .. n, (kx * 7919 + ky * 104729 + kz * 1299709 + n * 31) % 16777213
	end
	local baseZ = s.base or 1200
	-- (nx, ny, nz: the outward normal of the cloud surface the card stands for, sim frame; the
	-- renderer shades it by sun . normal and adds forward scatter at edges seen toward the sun)
	local function add(x: number, y: number, z: number, w: number, h: number, a: number, tex: string, albedo: number, lit: number, sky: number, floor: number?, nx: number?, ny: number?, nz: number?)
		-- (cloud stops at its condensation level: a card above `floor` keeps its bottom there)
		if floor then
			h = min(h, max(60, 2 * (z - floor) + 0.15 * h))
		end
		local key, kh = cardKey("s", tex, x, y, z)
		local c = {
			x = x, y = y, z = z, w = w, h = h, a = a, tex = tex, key = key,
			frame = if SHEETS[tex] then math.floor(hash(seed, kh, 31) * 16) else -1,
			albedo = albedo, lit = lit, sky = sky, rot = hash(seed, kh, 32) * 360,
			nx = nx, ny = ny, nz = nz, ph = hash(seed, kh, 33),
		}
		table.insert(out, c)
		return c
	end
	-- Motion (Render/StormCards animates these every frame, in sim time; each card loops with a
	-- fade at both ends of its cycle):
	--   inflow  drawn toward (tx, ty) by the low-level inflow (speed vin), swirling round it at the
	--           low-level rotation and lifted toward the base (scud, tail cloud)
	--   boil    rising and spreading at a share of the updraft (billows, the top)
	local vlow = max(math.abs(s.vlow or 0), 4)
	local vin = clamp(0.5 * vlow, 4, 20) -- (inflow into the updraft: a share of the low-level rotation)
	local function inflow(c: any, tx: number, ty: number, pull: number, riseTo: number, swirlR: number?)
		local d = sqrt((c.x - tx) ^ 2 + (c.y - ty) ^ 2)
		local P = clamp(pull * d / vin, 40, 420)
		local rm = max(200, d * (1 - 0.5 * pull))
		c.mv = { k = "in", tx = tx, ty = ty, pull = pull, P = P, rise = max(0, riseTo - c.z),
			swirl = if swirlR then clamp(vlow * (swirlR / rm) * P / rm, 0, 2.5) else 0 }
	end
	local function boil(c: any, Wr: number, size: number)
		local rise = 0.35 * size
		c.mv = { k = "up", P = clamp(rise / max(1, 0.12 * Wr), 60, 600), rise = rise, grow = 0.25 }
	end
	local function norm(x: number, y: number, z: number): (number, number, number)
		local m = sqrt(x * x + y * y + z * z)
		if m < 1e-6 then
			return 0, 0, 1
		end
		return x / m, y / m, z / m
	end
	-- Scud as the reference photos show it (docs/storm-reference/real 04_*, 05_*): not loose
	-- floating bits but clusters breaking off a cloud's lower edge - the biggest piece overlapping
	-- the edge, smaller ones hanging lower and trailing downstream (fx, fy: the flow there), with
	-- varied size, tone and spacing. Three forms:
	--   rise    rising cumuliform lumps (moist inflow lifted into the wall cloud: 04_wall_cloud_b)
	--   rag     ragged tatters (rain-cooled outflow near saturation: 05_inflow_region_b)
	--   streak  fibrous streamers drawn round a rotating rim (04_wall_cloud_underside_c)
	-- toX, toY, riseTo: where it is drawn and how high it rises (nil: it only hangs)
	local function cluster(px: number, py: number, zEdge: number, size: number, fx: number, fy: number, kind: string,
		salt: number, alb: number, lit: number, toX: number?, toY: number?, riseTo: number?, swirlR: number?)
		local n = 3 + math.floor(hash(seed, salt, 1) * 4)
		for i = 0, n - 1 do
			local hA, hB, hC = hash(seed, salt + i * 7, 2), hash(seed, salt + i * 7, 3), hash(seed, salt + i * 7, 4)
			local f = i / n
			local sz = size * (1 - 0.6 * f) * (0.7 + 0.6 * hA)
			local drop = size * (0.05 + 0.8 * f) * (0.5 + 0.9 * hB)
			local along = size * 1.3 * f * (hC - 0.2)
			local side = size * 0.45 * (hA - 0.5)
			local x, y = px + fx * along - fy * side, py + fy * along + fx * side
			local z = max(zEdge - drop, 30)
			local tex, w, h, a
			if kind == "rise" then
				tex, w, h, a = "lumpyFlat", sz, sz * 0.8, 0.9 - 0.3 * f
			elseif kind == "rag" then
				tex, w, h, a = scudTex(hB), sz * 1.4, sz * 0.65, 0.8 - 0.3 * f
			else
				tex, w, h, a = "wispFlat", sz * 2.4, sz * 0.32, 0.55 - 0.2 * f
			end
			local c = add(x, y, z, w, h, a, tex, alb * (0.86 + 0.28 * hC), lit, 0.48 + 0.14 * hA)
			if c and toX then
				inflow(c, toX, toY :: number, if kind == "rise" then 0.4 else 0.25, riseTo or z, swirlR)
			end
		end
	end
	local W, base, el, top, fade, maturity = sh.W, sh.base, sh.el, sh.top, sh.fade, sh.maturity
	local colTop = sh.colTop
	local cloudR, sunLitRaw = sh.cloudR, sh.sunLit
	-- (the sun march through the storm is the plan's main cost; light varies smoothly, so it is
	-- memoised on a 300 x 300 x 150 m grid for this plan)
	local litMemo = {}
	local function sunLit(px: number, py: number, pz: number): number
		local key = (math.floor(px / 300) * 4099 + math.floor(py / 300)) * 1031 + math.floor(pz / 150)
		local v = litMemo[key]
		if v == nil then
			v = sunLitRaw(px, py, pz)
			litMemo[key] = v
		end
		return v
	end
	local L = Util.light
	local sx, sy = L.sunSim[1], L.sunSim[2]
	local hs = sqrt(sx * sx + sy * sy)
	local shx, shy = if hs > 1e-3 then sx / hs else 1, if hs > 1e-3 then sy / hs else 0
	local crisp = ramp(W, 8, 35) * (1 - fade)
	local dk = sqrt(clamp(detail, 0.25, 1))

	-- Tower ---------------------------------------------------------------------------------
	if fade < 0.85 and #sh.levels > 0 then
		local albedo = 0.84 - 0.08 * fade + 0.04 * crisp
		local z = base + 0.35 * cloudR(base)
		local lvl = 0
		while z < colTop do
			lvl += 1
			local r, tx, ty = cloudR(z)
			-- the centre fills the column (it sees little sky, gets sun only through the column)
			add(tx, ty, z, 1.7 * r, 1.7 * r, 0.9, "softSheetFlat", albedo, sunLit(tx + shx * r, ty + shy * r, z) * 0.6, 0.6, baseZ)
			local n = clamp(math.floor(8 * dk + 0.5), 4, 9)
			local a0 = hash(seed, lvl, 40) * TAU
			for k = 1, n do
				local a = a0 + (k - 1) / n * TAU
				local ox, oy = cos(a), sin(a)
				local px, py = tx + ox * 0.62 * r, ty + oy * 0.62 * r
				-- lit from its outer surface toward the sun: the sunny side bright, the far side dark
				local lit = sunLit(px + ox * 0.45 * r, py + oy * 0.45 * r, z)
				local wc = 1.05 * r * (0.9 + 0.25 * hash(seed, lvl * 16 + k, 41))
				local nx, ny, nz = norm(ox, oy, 0.15)
				add(px, py, z, wc, wc, 0.92, "lumpyFlat", albedo, lit, 1, baseZ, nx, ny, nz)
			end
			z += clamp(0.45 * r, 250, 1400) / dk
		end
		-- billows
		local H = colTop - base
		local nB = math.floor(detail * clamp(W / 3, 0, 14) * (1 - fade) + 0.5)
		for b = 1, nB do
			local h1, h2, h3 = hash(seed, 100 + b, 4), hash(seed, 100 + b, 5), hash(seed, 100 + b, 6)
			local zb = base + H * (0.3 + 0.65 * h1)
			local r, tx, ty = cloudR(zb)
			local a = h2 * TAU
			local ox, oy = cos(a), sin(a)
			local bs = 2 * r * (0.3 + 0.25 * h3) * (0.8 + 0.3 * crisp)
			local px, py = tx + ox * r * 0.85, ty + oy * r * 0.85
			local nx, ny, nz = norm(ox, oy, 0.3)
			local c = add(px, py, zb, bs, bs, 0.95, "lumpyFlat", 0.93, sunLit(px + ox * bs * 0.5, py + oy * bs * 0.5, zb), 1, baseZ, nx, ny, nz)
			boil(c, W, bs)
		end
		-- the top: a dome while rising (a cluster of cards), a cap under the anvil when mature
		local rTop, tx, ty = cloudR(max(base, colTop - 400))
		local nT = if sh.anvil then 3 else 5
		for k = 1, nT do
			local a = hash(seed, 700 + k, 7) * TAU
			local rr = rTop * 0.5 * hash(seed, 700 + k, 8)
			local px, py = tx + cos(a) * rr, ty + sin(a) * rr
			local cw = rTop * (1.1 + 0.4 * hash(seed, 700 + k, 9))
			local pz = colTop - 0.15 * cw
			local nx, ny, nz = norm(cos(a) * 0.5, sin(a) * 0.5, 1)
			local c = add(px, py, pz, cw, cw * 0.8, 0.95, "lumpyFlat", 0.96, sunLit(px, py, pz + 0.4 * cw), 1, nil, nx, ny, nz)
			if not sh.anvil then
				boil(c, W, cw) -- (a rising dome boils; a cap under the anvil is held by it)
			end
		end
	end
	-- the overshooting top above the anvil, from top - el
	local over = top - el
	if fade == 0 and maturity >= 0.97 and over > 150 then
		local _, tx, ty = Storm.wprofAt(s, el)
		local ruE = Storm.updraftRadiusAt(s, el)
		local wO = clamp(1.4 * ruE, 1200, 9000) * (0.5 + 0.5 * ramp(over, 150, 1500)) * ramp(W, 5, 15)
		if wO > 300 then
			for k = 1, 3 do
				local a = hash(seed, 800 + k, 7) * TAU
				local px, py = tx + cos(a) * wO * 0.15, ty + sin(a) * wO * 0.15
				local pz = el + over * (0.3 + 0.2 * k)
				add(px, py, pz, wO * (1.1 - 0.2 * k), wO * (0.8 - 0.15 * k), 0.95, "lumpyFlat", 0.98, sunLit(px, py, top), 1, nil, 0, 0, 1)
			end
		end
	end

	-- Anvil ---------------------------------------------------------------------------------
	local A = sh.anvil
	if A then
		local total = A.len + A.rr
		local sp = clamp(A.th0 * 1.2, 1200, 3500) / dk
		local cap = math.floor(80 * detail) -- (x3 layers)
		-- (coarser spacing if the slab would take more than its share of cards)
		local function count(spacing: number): number
			local c = 0
			local x = -A.rr
			while x < A.len do
				local w = sh.anvilAt(x)
				c += math.max(1, math.ceil(w / spacing))
				x += spacing
			end
			return c
		end
		while count(sp) > cap and sp < 20000 do
			sp *= 1.25
		end
		local cxv, cyv = -A.dy, A.dx
		local x = -A.rr + 0.5 * sp
		local row = 0
		while x < A.len do
			row += 1
			local w, tp, th = sh.anvilAt(x)
			local cols = math.max(1, math.ceil(w / sp))
			for j = 1, cols do
				local h1 = hash(seed, 200 + row * 31 + j, 10)
				local c = ((j - 0.5) / cols - 0.5) * w
				local px, py = A.rx + A.dx * x + cxv * c, A.ry + A.dy * x + cyv * c
				local pz = tp - 0.5 * th
				-- thinner and fainter toward the downstream end and the edges
				local edge = 1 - 0.5 * math.abs(c) / max(1, 0.5 * w)
				local f = clamp(x / max(A.len, 1), 0, 1)
				-- an anvil is dense ice cloud (opaque near its root), thinning downstream and at its
				-- edges
				local a = clamp(0.95 * edge * (1 - 0.5 * f), 0.3, 0.95)
				local cw = 2.6 * sp * (0.9 + 0.25 * h1)
				-- three layers: the lit top, the body, the shaded underside (what is seen from below)
				local litTop = sunLit(px, py, tp + 60)
				local ch = max(th * 1.3, 0.4 * cw)
				add(px, py, tp - 0.25 * th, cw, ch, a, "lumpyFlat", 0.92, litTop, 0.9, nil, 0, 0, 1)
				add(px - cxv * 0.25 * sp, py - cyv * 0.25 * sp, tp - 0.5 * th, cw, ch, a, "softSheetFlat", 0.88, litTop * 0.6, 0.75)
				add(px + cxv * 0.3 * sp, py + cyv * 0.3 * sp, tp - 0.8 * th, cw * 0.95, ch * 0.8, a, "softSheetFlat", 0.82, litTop * 0.3, 0.6, nil, 0, 0, -1)
			end
			x += sp
		end
	end

	-- Mammatus --------------------------------------------------------------------------------
	-- pouches under a mature, productive anvil (the StormPlan rule: precipitation production, age
	-- and anvil length): patches downstream of the root, each a field of round lobes hanging
	-- below the anvil's underside, lit from below by the low sun and the sky
	if A then
		local m = ramp(s.precipRate or 0, 1e5, 8e5) * ramp(s.age or 0, 1200, 3600) * ramp(A.len, 15000, 40000) * (1 - 0.6 * fade)
		if m > 0.2 then
			local cxv, cyv = -A.dy, A.dx
			local nM = math.max(1, math.floor(m * 4 * detail + 0.5))
			for i = 1, nM do
				local h1, h2 = hash(seed, 300 + i, 12), hash(seed, 300 + i, 13)
				local along = A.len * (0.12 + 0.45 * h1)
				local w, tp, th = sh.anvilAt(along)
				local c = (h2 - 0.5) * 0.5 * w
				local sz = clamp(0.3 * w, 3000, 9000)
				local depth = 300 + 500 * m
				local sp = clamp(sz / (4 + 4 * dk), 500, 1600)
				local n = math.ceil(0.5 * sz / sp)
				for a = -n, n do
					for b = -n, n do
						local hh = hash(seed, 300 + i * 97 + a * 13 + b, 14)
						local hj = hash(seed, 300 + i * 97 + a * 13 + b, 15)
						if (a * a + b * b) * sp * sp < (0.5 * sz) ^ 2 and hh > 0.15 then
							-- jittered (no grid), overlapping pouches hanging from the underside,
							-- coloured like it: they show by their lumps, not as dark spots
							local along2 = along + (a + (hh - 0.5) * 0.8) * sp
							local c2 = c + (b + (hj - 0.5) * 0.8) * sp
							local px, py = A.rx + A.dx * along2 + cxv * c2, A.ry + A.dy * along2 + cyv * c2
							local pw = sp * (1.4 + 0.5 * hh)
							local pz = tp - th - depth * (0.25 + 0.35 * hj)
							add(px, py, pz, pw, pw * 0.75, 0.6 * m, "lumpyFlat", 0.84, sunLit(px, py, pz) * 0.5, 0.6, nil, 0, 0, -1)
						end
					end
				end
			end
		end
	end

	-- Base ----------------------------------------------------------------------------------
	-- the rain-free base round the updraft (~2.2 Ru(base)): lumpy dark cards with a ragged fringe
	-- of scud hanging under it (rising moist inflow condensing below the base), denser toward the
	-- lowering where the inflow converges into the updraft
	local lowX, lowY = (s.lowX or s.x) - s.x, (s.lowY or s.y) - s.y
	if fade < 0.6 and maturity > 0.2 then
		local _, tx, ty = Storm.wprofAt(s, base)
		local Rb = clamp(2.2 * Storm.updraftRadiusAt(s, base), 1500, 15000) * (1 - 0.6 * fade) * (0.55 + 0.45 * ramp(W, 3, 15))
		local thick = 380 + 0.02 * Rb
		local albedo = 0.72 - 0.12 * ramp(top - base, 6000, 13000)
		-- the deck: one continuous sheet, not a carpet of puffs. A few large soft cards overlap
		-- heavily (their edges fall under their neighbours), darker toward the updraft where the
		-- cloud above is thickest (the sun march through the tower and anvil already says so)
		local function deck(px: number, py: number, z: number, cw: number, a: number, alb: number)
			add(px, py, z, cw, max(0.38 * cw, thick), a, "softSheetFlat", alb, sunLit(px, py, base - 80) * 0.6, 0.5, nil, 0, 0, -1)
		end
		-- A billboard faces the camera, so a card is a ceiling only when it is small next to its
		-- distance: seen from under the deck, a big card stands up as a far wall. Near or under
		-- the base the deck is a grid of medium cards; from outside it, a few big ones.
		local cdx, cdy = (camDx or 1e9) - tx, (camDy or 1e9) - ty
		local under = cdx * cdx + cdy * cdy < (1.7 * Rb) ^ 2
		if under then
			local sp = clamp(Rb / (3 + 2 * dk), 600, 2500)
			local n = math.ceil(Rb / sp)
			for i = -n, n do
				for j = -n, n do
					local h1, h2 = hash(seed, 700 + i * 61 + j, 11), hash(seed, 700 + i * 61 + j, 12)
					local ox, oy = (i + (h1 - 0.5) * 0.6) * sp, (j + (h2 - 0.5) * 0.6) * sp
					if ox * ox + oy * oy < (0.95 * Rb) ^ 2 then
						local px, py = tx + ox, ty + oy
						local cw = 2.4 * sp * (0.9 + 0.2 * h1)
						add(px, py, base + 0.45 * thick, cw, max(0.55 * cw, thick), 1, "softSheetFlat",
							albedo * (0.92 + 0.06 * h2), sunLit(px, py, base - 80) * 0.6, 0.5, nil, 0, 0, -1)
					end
				end
			end
		end
		-- two layers, so the deck is opaque where they overlap (a soft sheet frame alone lets the
		-- bright cloud above show through)
		local deckZ: { number } = if under then {} else { base + 0.75 * thick, base + 0.3 * thick }
		for layerI, z in deckZ do
			deck(tx, ty, z, 1.5 * Rb, 1, albedo * 0.92)
			local nRing = 7
			for k = 1, nRing do
				local a = (k - 1 + 0.5 * (layerI - 1)) / nRing * TAU + hash(seed, 510 + k, 11)
				local rr = Rb * (0.5 + 0.12 * hash(seed, 510 + k, 12 + layerI))
				deck(tx + cos(a) * rr, ty + sin(a) * rr, z, Rb * (1.05 + 0.2 * hash(seed, 510 + k, 13)), 1, albedo)
			end
		end
		-- the rim: lumpy cards give the deck a ragged edge where it is seen against the sky
		local nRim = clamp(math.floor(22 * dk), 10, 24)
		for k = 1, nRim do
			local h1, h2 = hash(seed, 530 + k, 11), hash(seed, 530 + k, 12)
			local a = (k - 1 + 0.6 * h1) / nRim * TAU
			local rr = Rb * (0.88 + 0.1 * h2)
			local px, py = tx + cos(a) * rr, ty + sin(a) * rr
			local cw = Rb * (0.32 + 0.15 * h2)
			add(px, py, base + 0.25 * thick, cw, cw * 0.42, 0.9, "lumpyFlat", albedo * 1.02, sunLit(px, py, base - 80) * 0.7, 0.55, nil, cos(a), sin(a), -0.4)
		end
		-- texture underneath: lumps hanging just below the deck on a loose grid (the deck's
		-- structure; they also hide its card edges and cover the top of a funnel)
		local sp = clamp(Rb / (2.2 + 1.4 * dk), 900, 4000)
		local n = math.ceil(Rb / sp)
		for i = -n, n do
			for j = -n, n do
				local h1, h2, h3 = hash(seed, 500 + i * 61 + j, 11), hash(seed, 500 + i * 61 + j, 12), hash(seed, 500 + i * 61 + j, 13)
				local ox, oy = (i + (h1 - 0.5) * 0.8) * sp, (j + (h2 - 0.5) * 0.8) * sp
				local d = sqrt(ox * ox + oy * oy)
				if d < 0.92 * Rb then
					local px, py = tx + ox, ty + oy
					local cw = 1.5 * sp * (0.8 + 0.4 * h3)
					add(px, py, base - 0.02 * thick, cw, cw * 0.38, 0.6 - 0.2 * h3, "lumpyFlat",
						albedo * (0.9 + 0.1 * h2), sunLit(px, py, base - 80) * 0.5, 0.5, nil, 0, 0, -1)
				end
			end
		end
		-- scud under the deck's edge where rain-cooled outflow meets it (the forward flank side,
		-- toward the rain): ragged clusters hanging from the edge, drawn toward the lowering
		if s.ffdX then
			local fdx, fdy = s.ffdX - s.x - tx, s.ffdY - s.y - ty
			local a0 = math.atan2(fdy, fdx)
			local nB = math.floor(7 * dk)
			for k = 1, nB do
				local h1, h2 = hash(seed, 590 + k, 11), hash(seed, 590 + k, 12)
				local a = a0 + (h1 - 0.5) * 1.8
				local rr = Rb * (0.82 + 0.15 * h2)
				local px, py = tx + cos(a) * rr, ty + sin(a) * rr
				local size = clamp(0.05 * Rb, 60, 300) * (0.6 + 0.8 * h2)
				-- (the flow there: round the storm, cyclonically)
				cluster(px, py, base + 20, size, -sin(a), cos(a), "rag", 1590 + k * 37, albedo, sunLit(px, py, base - 100) * 0.6,
					lowX, lowY, base - 30, nil)
			end
		end
	end
	-- Inflow band (beaver tail) ---------------------------------------------------------------
	-- moist inflow riding up over the rain-cooled forward-flank outflow reaches its condensation
	-- level along that boundary: a smooth, flat band at the base, reaching from the updraft out
	-- into the inflow (05_inflow_band_beaver_tail_a). Along the storm-relative low-level inflow
	-- (upstream of the updraft), on the forward-flank side; longer when the inflow is stronger
	-- (air lifted there stays saturated for the minutes it takes to reach the updraft); turbulent
	-- near the updraft, laminar and thinning toward its far end; it drifts in toward the updraft.
	do
		local srU, srV = s.srU or 0, s.srV or 0
		local sr = sqrt(srU * srU + srV * srV)
		if not s.dead and fade < 0.5 and maturity > 0.4 and (s.rot or 0) > 0.3 and sr > 6 then
			local _, ux, uy = Storm.wprofAt(s, base)
			local Ru0 = clamp(2.2 * Storm.updraftRadiusAt(s, base), 1500, 15000)
			local dx, dy = -srU / sr, -srV / sr -- (toward where the inflow comes from)
			-- (its side: toward the forward flank)
			local px0, py0 = -dy, dx
			if s.ffdX then
				local fx, fy = s.ffdX - s.x - ux, s.ffdY - s.y - uy
				if fx * px0 + fy * py0 < 0 then
					px0, py0 = -px0, -py0
				end
			end
			local q = ramp(sr, 6, 18) * ramp(s.rot or 0, 0.3, 0.8)
			local len = clamp(1.1 * Ru0 + 300 * sr, 3000, 14000) * (0.6 + 0.4 * q)
			local wid = clamp(0.12 * Ru0, 600, 1400)
			local nB = math.floor(len / 450 * dk) + 2
			for i = 1, nB do
				local f = (i - 0.5) / nB
				local h1, h2 = hash(seed, 760 + i, 11), hash(seed, 760 + i, 12)
				local along = 0.7 * Ru0 + f * len
				local side = (0.25 + 0.1 * (h1 - 0.5)) * Ru0 * (1 - 0.5 * f)
				local bx, by = ux + dx * along + px0 * side, uy + dy * along + py0 * side
				local w = wid * (1 - 0.55 * f) * (0.85 + 0.3 * h2)
				local z = base - 40 + 80 * h1
				local smooth = f > 0.3
				local c = add(bx, by, z, w * 2.2, max(w * 0.35, 120), (0.75 - 0.45 * f) * q,
					if smooth then "softSheetFlat" else "lumpyFlat", 0.7 - 0.08 * ramp(top - base, 6000, 13000), sunLit(bx, by, z) * 0.8, 0.55,
					nil, 0, 0, -0.6)
				inflow(c, ux, uy, 0.2, base + 60, nil)
			end
		end
	end

	-- Mesocyclone striations -------------------------------------------------------------------
	-- the banded, ribbed updraft base of a rotating storm: stacked rings of wide banded cards
	-- round the updraft just above the cloud base, turning with the mid-level rotation. Shown
	-- where the storm rotates (rot) and the mesocyclone is strong (vmid), as the wall cloud.
	local vmid = math.abs(s.vmid or 0)
	local qs = ramp(s.rot or 0, 0.25, 0.7) * ramp(vmid, 10, 25) * (1 - fade) * maturity
	if CardPlan.available.striationFlat and not s.dead and qs > 0.05 then
		local _, tx, ty = Storm.wprofAt(s, base + 600)
		local nT = if dk > 0.7 then 4 else 3
		for t = 0, nT - 1 do
			local z = base + 120 + t * 340
			local Rr = clamp(1.1 * Storm.updraftRadiusAt(s, z), 1200, 9000) * (1 - 0.06 * t)
			local nR = clamp(math.floor(2 * math.pi * Rr / 1100 * dk), 8, 16)
			local omega = vmid / Rr -- (rad/s: the ring turns with the mesocyclone)
			for k = 1, nR do
				local a = (k - 1 + 0.5 * (t % 2)) / nR * TAU + hash(seed, 800 + t * 31 + k, 11) * 0.3
				local px, py = tx + cos(a) * Rr, ty + sin(a) * Rr
				local cw = 2 * math.pi * Rr / nR * 1.9
				local c = add(px, py, z, cw, min(0.45 * cw, 700), 0.8 * qs, "striationFlat", 0.72,
					sunLit(px, py, z), 0.7, nil, cos(a), sin(a), -0.15)
				if c then
					c.mv = { k = "spin", tx = tx, ty = ty, omega = omega, P = 1 }
				end
			end
		end
	end

	-- Wall cloud, scud round it, tail cloud ----------------------------------------------------
	-- (the same rules as StormPlan: a lowering under the low-level mesocyclone down to wallBase
	-- when lowering and rotation are significant; its cards are relative to the lowering's centre
	-- in `wall`, turned as a whole at vlow / (0.3 Ru) by Render/StormCards, so the scud on it
	-- circles with the rotation)
	local wall = nil
	local lowering = s.lowering or 0
	local rot = s.rot or 0
	if not s.dead and lowering > 30 and rot > 0.25 and s.lowX and s.wallBase then
		-- (docs/stormlab/RESEARCH-WALLCLOUD-HV.md) a localized, abrupt lowering 1-4 km across under
		-- the rain-free base: moistened forward-flank air lowers its condensation level, the
		-- mesocyclone's pressure deficit lowers the centre further (the sim's wallBase). Its body
		-- is smooth and opaque with a sharp edge on the updraft side; the rear-flank side is
		-- ragged; banding and condensation filaments wrap into it as it turns; scud forms below it
		-- (100-600 m below the base) and rises into it at 2-10 m/s.
		local q = ramp(lowering, 30, 400) * ramp(rot, 0.25, 0.6)
		local Ru = max(s.Ru or 1500, 300)
		local lx, ly = lowX, lowY
		local R = 0.5 * clamp(0.9 * Ru, 1000, 3500) * (0.7 + 0.3 * q)
		local zb = max(s.wallBase, 60)
		local D = max(base - zb, 30)
		-- the underside: flat across most of it, rising steeply to the base at the rim
		local function zbot(r: number): number
			local f = math.min(r / R, 1)
			return zb + D * f ^ 4
		end
		wall = { x = lx, y = ly, spin = (s.vlow or 0) / (0.3 * Ru), cards = {} }
		local function addWall(ox: number, oy: number, z: number, cw: number, ch: number, a: number, lit: number, sky: number, tex: string?, albedo: number?, nx: number?, ny: number?, nz: number?)
			local t = tex or "lumpyFlat"
			local key, kh = cardKey("w", t, ox, oy, z)
			local c = {
				x = ox, y = oy, z = z, w = cw, h = ch, a = a, tex = t, key = key,
				frame = if SHEETS[t] then math.floor(hash(seed, kh, 31) * 16) else -1,
				albedo = albedo or 0.58, lit = lit, sky = sky, rot = hash(seed, kh, 32) * 360,
				ph = hash(seed, kh, 33), nx = nx, ny = ny, nz = nz,
			}
			table.insert(wall.cards, c)
			return c
		end
		local litW = sunLit(lx, ly, zb)
		-- (a little darker than the base around it - deeper cloud above it - not a black patch)
		local albW = 0.62
		-- the body: rings of smooth opaque cards, each filling from the underside up into the base
		for ri, fr in { 0, 0.4, 0.72, 0.93 } do
			local r = fr * R
			local nR = if ri == 1 then 1 else clamp(math.floor((4 + 6 * fr) * dk + 0.5), 4, 10)
			for k = 1, nR do
				local a = (k - 1 + 0.5 * (ri % 2)) / nR * TAU
				local ox, oy = cos(a) * r, sin(a) * r
				local zl = zbot(r)
				local hgt = base + 80 - zl
				local cw = if ri == 1 then 1.3 * R else max(2 * math.pi * r / nR * 1.7, 0.5 * R)
				addWall(ox, oy, zl + 0.45 * hgt, cw, max(hgt * 1.25, 0.3 * cw), 1, litW * 0.5, 0.5,
					"softSheetFlat", albW, if ri == 1 then 0 else cos(a), if ri == 1 then 0 else sin(a), -0.5)
			end
		end
		-- texture underneath: a few lumps hanging from the flat underside
		local nU = math.floor(10 * dk)
		for k = 1, nU do
			local h1, h2, h3 = hash(seed, 670 + k, 11), hash(seed, 670 + k, 12), hash(seed, 670 + k, 13)
			local r = 0.8 * R * sqrt(h1)
			local a = h2 * TAU
			local cw = R * (0.35 + 0.25 * h3)
			addWall(cos(a) * r, sin(a) * r, zbot(r) - 0.05 * cw, cw, cw * 0.35, 0.5, litW * 0.5, 0.5,
				"lumpyFlat", albW, 0, 0, -1)
		end
		-- banding: horizontal striations wrapping round its side (they turn with the layer)
		if CardPlan.available.striationFlat then
			for t, fz in { 0.3, 0.68 } do
				local nB = clamp(math.floor(8 * dk), 6, 10)
				for k = 1, nB do
					local a = (k - 1 + 0.5 * t) / nB * TAU
					local r = 0.97 * R
					local cw = 2 * math.pi * r / nB * 1.8
					addWall(cos(a) * r, sin(a) * r, zbot(r * 0.9) + fz * (base - zbot(r * 0.9)), cw, min(0.35 * cw, 0.4 * D + 60),
						0.55 * q, litW * 0.5, 0.5, "striationFlat", albW * 1.08, cos(a), sin(a), 0)
				end
			end
		end
		-- condensation filaments: thin wisps spiralling in from the inflow side and rising into it
		local nF = math.floor(16 * dk * q)
		for k = 1, nF do
			local h1, h2, h3 = hash(seed, 700 + k, 11), hash(seed, 700 + k, 12), hash(seed, 700 + k, 13)
			local a = h1 * TAU
			local r = R * (1.0 + 0.9 * h2)
			local z = zb - 80 + (D + 60) * h3
			local len = R * (0.25 + 0.3 * h3)
			local c = addWall(cos(a) * r, sin(a) * r, z, len, len * 0.16, 0.5, litW * 0.6, 0.55,
				if h2 < 0.5 then "wispFlat" else "shredFlat", albW * 1.1)
			inflow(c, 0, 0, 0.75, base, R)
		end
		-- scud on its rim: clusters breaking off the underside's edge. The kind follows where it
		-- is: rising lumps on the side facing the forward-flank inflow (moist air lifted into it),
		-- ragged tatters toward the rear flank (outflow), streamers round the rest of the
		-- turning rim. They hang 20-300 m pieces down to a few hundred metres below it.
		local ffx, ffy = 1, 0
		if s.ffdX then
			local fx0, fy0 = s.ffdX - s.lowX, s.ffdY - s.lowY
			local fl = max(sqrt(fx0 * fx0 + fy0 * fy0), 1)
			ffx, ffy = fx0 / fl, fy0 / fl
		end
		local rrx, rry = -ffx, -ffy
		if s.rfdX then
			local rx0, ry0 = s.rfdX - s.lowX, s.rfdY - s.lowY
			local rl = max(sqrt(rx0 * rx0 + ry0 * ry0), 1)
			rrx, rry = rx0 / rl, ry0 / rl
		end
		local nC = math.floor(12 * dk * (0.4 + 0.6 * q))
		for k = 1, nC do
			local h1, h2 = hash(seed, 650 + k, 34), hash(seed, 650 + k, 35)
			local a = (k - 1 + 0.7 * h1) / nC * TAU
			local ca, sa = cos(a), sin(a)
			local r = R * (0.82 + 0.18 * h2)
			local px, py = lx + ca * r, ly + sa * r
			local kind = if ca * ffx + sa * ffy > 0.35 then "rise" elseif ca * rrx + sa * rry > 0.35 then "rag" else "streak"
			local size = clamp(0.28 * R * (0.5 + h2), 40, 320)
			-- (round the rim, cyclonically; rising lumps are drawn in and up)
			cluster(px, py, zbot(r) + 30, size, -sa, ca, kind, 2650 + k * 41, albW * (if kind == "rise" then 0.98 else 1.06), sunLit(px, py, zbot(r)) * 0.6,
				lx, ly, if kind == "rise" then zbot(0.3 * R) else zbot(r) - 40, if kind == "rise" then nil else R)
		end
		-- tail cloud: a band at the wall cloud's base streaming in from the forward-flank rain
		if s.ffdX and q > 0.3 then
			local fx, fy = s.ffdX - s.lowX, s.ffdY - s.lowY
			local dl = sqrt(fx * fx + fy * fy)
			if dl > 800 then
				fx, fy = fx / dl, fy / dl
				local len = min(0.8 * dl, 4000)
				local nT = math.max(4, math.floor(len / 220 * dk))
				for i = 1, nT do
					local hh = hash(seed, 600 + i, 33)
					local along = 0.9 * R + (i - 0.5) / nT * len
					local side = (hash(seed, 600 + i, 37) - 0.5) * 0.4 * R
					local px, py = lx + fx * along - fy * side, ly + fy * along + fx * side
					local f = i / nT
					local hz = zb + (0.25 + 0.55 * f) * D
					local cw = R * (0.9 - 0.4 * f) * (0.8 + 0.4 * hh)
					local c = add(px, py, hz, cw, cw * 0.4, 0.8 * (1 - 0.4 * f), if hh < 0.5 then scudTex(hh) else "lumpyFlat", albW * 1.1, sunLit(px, py, hz), 0.5)
					-- (it streams into the wall cloud)
					inflow(c, lx, ly, 0.5, hz + 0.3 * (base - hz), nil)
					-- its far end frays: ragged pieces breaking off its underside
					if f > 0.55 and i % 2 == 0 then
						cluster(px, py, hz - 0.15 * cw, cw * 0.45, -fx, -fy, "rag", 3600 + i * 29, albW * 1.08,
							sunLit(px, py, hz) * 0.7, lx, ly, hz, nil)
					end
				end
			end
		end
	end
	return out, sh, wall
end

-- Cards filling kit-style pieces ({ cf = unit box bottom-middle, Roblox frame; size; colour }),
-- e.g. the shelf clouds of CloudParts/ShelfPlan: each box becomes a grid of soft lumpy cards
-- (spacing from its height), its brightness from the piece's colour. Positions in sim metres,
-- absolute (as the pieces).
function CardPlan.fromPieces(pieces: { any }, seed: number, detail: number): { any }
	local out = {}
	local used = {}
	local dk = sqrt(clamp(detail, 0.25, 1))
	local budget = math.floor(320 * detail)
	for pi, pc in pieces do
		if #out >= budget then
			break
		end
		local X, Y, Z = pc.size.X, pc.size.Y, pc.size.Z
		local sp = clamp(0.8 * Y, 200, 2500) / dk
		local nx, nz = math.max(1, math.floor(X / sp + 0.5)), math.max(1, math.floor(Z / sp + 0.5))
		local ny = if Y > 1.6 * sp then 2 else 1
		local col = pc.colour or Color3.new(0.6, 0.6, 0.6)
		local lum = 0.3 * col.R + 0.59 * col.G + 0.11 * col.B
		local albedo = clamp(lum * 1.25, 0.35, 0.9)
		for ix = 1, nx do
			for iz = 1, nz do
				for iy = 1, ny do
					local u, w = (ix - 0.5) / nx - 0.5, (iz - 0.5) / nz - 0.5
					local v = (iy - 0.5) / ny
					local p = pc.cf * Vector3.new(u * X, v * Y, w * Z)
					local x, y, z = p.X, -p.Z, p.Y
					local kx, ky, kz = math.floor(x / 300 + 0.5), math.floor(y / 300 + 0.5), math.floor(z / 200 + 0.5)
					local base = "p" .. kx .. "," .. ky .. "," .. kz
					local n = (used[base] or 0) + 1
					used[base] = n
					local kh = (kx * 7919 + ky * 104729 + kz * 1299709 + n * 31 + pi) % 16777213
					local cw = 1.5 * math.max(X / nx, Z / nz)
					table.insert(out, {
						x = x, y = y, z = z, w = cw, h = math.max(Y / ny * 1.3, 0.5 * cw), a = 0.9,
						tex = "lumpyFlat", key = base .. "#" .. n, frame = math.floor(hash(seed, kh, 31) * 16),
						albedo = albedo, lit = 0.5, sky = 0.6, rot = hash(seed, kh, 32) * 360,
					})
				end
			end
		end
	end
	return out
end

return CardPlan
