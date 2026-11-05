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
-- lobe     (optional) the lit lobe family the renderer draws a card with ("tower", "under",
--          "soft"); cumuliform lumpyFlat cards default to tower / under by their normal
--          (Render/StormCards, docs/stormlab/CONDENSATION-DETAIL.md)
local Util = require(script.Parent:WaitForChild("Util"))
local StormShape = require(script.Parent:WaitForChild("StormShape"))

local CardPlan = {}
-- the flat deck's reach round the camera (m; set by Render/BaseDeck when it runs): under the base,
-- billboard deck cards are left out there, the flat tiles are the ceiling
CardPlan.flatDeckRange = 0
CardPlan.flatDeckReach = 0 -- (m: how far the flat tiles reach at all)
CardPlan.flatDeckDisc = 0 -- (m: a disc's width)
CardPlan.flatDeckSteep = 0 -- (the discs' patch over the camera reaches this x the base's height above it)
CardPlan.flatDeckSolid = false -- (opaque discs inside the soft edge band: they cut cards along their plane)
CardPlan.planHole = nil -- (the storm being planned: its wall cloud's base { x, y, r } (sim m) - no discs round it)
CardPlan.bandPath = nil -- (the storm being planned: its beaver tail's path, Sim/InflowCloud.band - storm-relative { dx, dy, z } from the updraft outward)

-- the point a share f (0..1) of the way along a path of { x, y, z } points, and its direction there
local function alongPath(path: { { number } }, f: number): (number, number, number, number, number)
	local L = 0
	for i = 2, #path do
		L += math.sqrt((path[i][1] - path[i - 1][1]) ^ 2 + (path[i][2] - path[i - 1][2]) ^ 2)
	end
	local want, acc = math.clamp(f, 0, 1) * L, 0
	for i = 2, #path do
		local a, b = path[i - 1], path[i]
		local dl = math.sqrt((b[1] - a[1]) ^ 2 + (b[2] - a[2]) ^ 2)
		if acc + dl >= want or i == #path then
			local t = if dl > 0 then math.clamp((want - acc) / dl, 0, 1) else 0
			local d = math.max(dl, 1e-3)
			return a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t, (b[1] - a[1]) / d, (b[2] - a[2]) / d
		end
		acc += dl
	end
	local p = path[1]
	return p[1], p[2], p[3], 1, 0
end

local ramp, hash = Util.ramp, Util.hash
local sqrt, cos, sin, max, min, clamp = math.sqrt, math.cos, math.sin, math.max, math.min, math.clamp
local TAU = 2 * math.pi
-- 4 x 4 sheets (a card shows one frame: a tiled sheet reads as a row of beads)
-- (sheets only: their frames have clear edges. The single softFlat image does not, and a large
-- or squashed card of it shows its rectangle)
local SHEETS = { lumpyFlat = true, basePuffs = true, softSheetFlat = true, shredFlat = true, wispFlat = true, wispyFlat = true, strandsFlat = true, striationFlat = true, curtainFlat = true, fractusFlat = true, dirtGrainFlat = true }
-- textures that exist (set by the renderer from LabConfig.TEXTURES: some are optional)
CardPlan.available = {} :: { [string]: boolean }
CardPlan.meshBody = false
CardPlan.meshDetail = true
-- (over a mesh: detail cards only on its silhouette, and their opacity; Render/StormVolume)
CardPlan.detailEdgeOnly = true
CardPlan.detailAlpha = 0.7
-- when Render/Scud draws wind-driven scud, the plan leaves out its own moving scud clusters (the
-- ones drawn in toward the lowering); the hanging fringe and the tail cloud stay
CardPlan.dynamicScud = false
-- scud and tufts: the torn fractus sheet once uploaded, else the shreds / wisps
local function scudTex(h: number): string
	if CardPlan.available.fractusFlat then
		return "fractusFlat"
	end
	return if h < 0.5 then "shredFlat" else "wispFlat"
end

-- (camDx, camDy: the camera from the storm's centre, m; it picks how the base deck is drawn.
-- camZ: its height, m, for the deck cards' foreshortening)
-- (set by Render/StormCards: Render/WallStream draws the wall cloud's body and tail)
CardPlan.wallStream = false

-- Card identity across re-plans (2026-11-03). A card's key was its texture and its place rounded
-- to a 300 x 300 x 200 m cell plus a count: a growing tower's levels slid through the cells, so
-- its cards re-keyed and cross-faded every plan (a shimmer), and when one moved cell the count
-- of the ones after it changed - a kept key on another card, which jumped. Now each card takes
-- the key (and sheet frame, turn) of the nearest card of its kind (layer, texture, section) in
-- its storm's last plan, if one is within ~0.6 of its size; only the rest are new.
local prevPlan: { [string]: { cards: { any }, at: number } } = {}
-- (two grids: 400 m cells for ordinary cards, 8 km for big ones - anvil and deck cards are tens of
-- km wide, and searched by their own reach in the fine grid one card took millions of cells: the
-- client hung, 2026-11-03. Each search is at most 2 cells either way)
local REKEY_CELL, REKEY_BIG = 400, 8000
local function rekeyCell(size: number): number
	return if size > 0.5 * REKEY_BIG then REKEY_BIG else REKEY_CELL
end
local function rekey(tag: string, list: { any })
	local prev = prevPlan[tag]
	local grid = {}
	local function cellOf(x: number, y: number, z: number, cs: number): (number, number, number)
		return math.floor(x / cs), math.floor(y / cs), math.floor(z / cs)
	end
	-- (numeric cell keys: cells within +-50000 across, +-500 up)
	local function cellKey(cx: number, cy: number, cz: number): number
		return (cx + 50000) * 1e9 + (cy + 50000) * 1e3 + (cz + 500)
	end
	if prev then
		for _, p in prev.cards do
			local cs = rekeyCell(p.size or 0)
			local cx, cy, cz = cellOf(p.x, p.y, p.z, cs)
			local gk = p.grp .. "|" .. cs
			local gg = grid[gk]
			if not gg then
				gg = {}
				grid[gk] = gg
			end
			local k = cellKey(cx, cy, cz)
			local b = gg[k]
			if not b then
				b = {}
				gg[k] = b
			end
			table.insert(b, p)
		end
	end
	local claimed = {}
	local matched = {}
	for i, c in list do
		local grp = (c.tex or "") .. "/" .. (c.sec or "")
		c.grp = grp
		if prev then
			local size = math.max(c.w or 0, c.h or 0)
			local reach = math.max(60, 0.6 * size)
			local best, bd = nil, reach * reach
			local cs = rekeyCell(size)
			local cx, cy, cz = cellOf(c.x, c.y, c.z, cs)
			local span = math.min(math.ceil(reach / cs), 2)
			local gg = grid[grp .. "|" .. cs] or {}
			for ix = cx - span, cx + span do
				for iy = cy - span, cy + span do
					for iz = cz - span, cz + span do
						local b = gg[cellKey(ix, iy, iz)]
						if b then
							for _, p in b do
								if not claimed[p.key] then
									local d2 = (p.x - c.x) ^ 2 + (p.y - c.y) ^ 2 + (p.z - c.z) ^ 2
									if d2 < bd then
										best, bd = p, d2
									end
								end
							end
						end
					end
				end
			end
			if best then
				claimed[best.key] = true
				matched[i] = true
				c.key = best.key
				c.frame, c.rot, c.ph = best.frame, best.rot, best.ph
			end
		end
	end
	-- (the rest: their own keys, kept clear of every key taken above)
	local seen = {}
	for i, c in list do
		if c.key == nil then
			c.key = "anon" .. i
		end
		if not matched[i] then
			local k, n = c.key, 0
			while claimed[k] or seen[k] do
				n += 1
				k = c.key .. "~" .. n
			end
			c.key = k
		end
		seen[c.key] = true
	end
	local keep = table.create(#list)
	for _, c in list do
		table.insert(keep, { key = c.key, grp = c.grp, x = c.x, y = c.y, z = c.z, size = math.max(c.w or 0, c.h or 0), frame = c.frame, rot = c.rot, ph = c.ph })
	end
	prevPlan[tag] = { cards = keep, at = os.clock() }
	-- (storms gone: their plans dropped after 2 min unused)
	for k, v in prevPlan do
		if os.clock() - v.at > 120 then
			prevPlan[k] = nil
		end
	end
end

-- a flat card's height as the camera sees it: a level sheet cw across and t thick at elevation e
-- shows cw sin e + t cos e tall. A billboard is always drawn upright at full height, so a km-wide
-- piece of a cloud base seen low on the horizon hung a soft curtain down to the ground in front of
-- everything beyond it (2026-10-29). Overhead the card keeps its full height. dx, dy, dz: the
-- card's centre from the camera (m)
local function seenHeight(dx: number, dy: number, dz: number, cw: number, ch: number, t: number): number
	dz = math.abs(dz)
	local Dh = sqrt(dx * dx + dy * dy)
	local Ls = max(1, sqrt(Dh * Dh + dz * dz))
	local sinE, cosE = dz / Ls, Dh / Ls
	-- (and its lower edge stands for the sheet's far edge, which is still at cloud height: it can't
	-- drop below that edge's sight line, dz (cw/2) / (Dh + cw/2) under the card's centre. Without
	-- this a lump near overhead still hung to the ground)
	local drop = dz * 0.5 * cw / (Dh + 0.5 * cw)
	local fit = 2 * drop / max(cosE, 0.05) + t
	return clamp(min(cw * sinE + t * cosE, fit), min(t, ch), ch)
end

function CardPlan.plan(s: any, Storm: any, detail: number, camDx: number?, camDy: number?, camZ: number?): ({ any }, any?, any?, any?)
	local out = {}
	local sh = StormShape.build(s, Storm)
	if not sh then
		return out, nil, nil
	end
	-- (the storm's body is drawn as a mesh - Render/StormVolume: no tower, top, anvil, base deck
	-- or striation cards; set by Render/StormCards before each plan)
	local meshBody = CardPlan.meshBody == true
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
	-- (which part of the plan a card comes from: c.sec; CardPlan.hideSection leaves one out - debug
	-- key Period in Render/StormCards, to find which part draws an artefact)
	local section = "misc"
	-- (each part's presence, 2026-11-03: its cards' opacity x this, from a ramp of the field that
	-- gates it - so a part fades in and out over re-plans (StormCards fades a kept card's opacity)
	-- instead of appearing or going at a threshold. Gates sit where the ramp is ~0)
	local presA = 1
	local tagTower = false -- (cards added while true are the tower's outer lobes: see the end of plan)
	local function add(x: number, y: number, z: number, w: number, h: number, a: number, tex: string, albedo: number, lit: number, sky: number, floor: number?, nx: number?, ny: number?, nz: number?)
		-- (cloud stops at its condensation level: a card above `floor` keeps its bottom there)
		if floor then
			h = min(h, max(60, 2 * (z - floor) + 0.15 * h))
		end
		a *= presA
		local key, kh = cardKey("s", tex, x, y, z)
		local c = {
			x = x, y = y, z = z, w = w, h = h, a = a, tex = tex, key = key,
			frame = if SHEETS[tex] then math.floor(hash(seed, kh, 31) * 16) else -1,
			albedo = albedo, lit = lit, sky = sky, rot = hash(seed, kh, 32) * 360,
			nx = nx, ny = ny, nz = nz, ph = hash(seed, kh, 33),
			tw = tagTower or nil, sec = section,
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
	local function boil(c: any, Wr: number, size: number, flank: boolean?)
		local rise = 0.35 * size
		-- (edge: the cloud's radius by height, so the flow can evaporate a billow carried out of the
		-- tower into the dry air round it - Flow.trace)
		c.mv = { k = "up", P = clamp(rise / max(1, 0.12 * Wr), 60, 600), rise = rise, grow = 0.25, edge = if flank then sh.cloudR else nil }
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
		if toX and CardPlan.dynamicScud then
			return
		end
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
	-- Seen from below: the sight line from a camera under the cloud base to a point above it
	-- crosses the base inside the column's footprint (radius r round cx, cy), so what is seen
	-- there is the base's underside, not the column's side. The tower's lowest lobes and core
	-- cards were lit as its sunny flank from under the base - round pale blobs and a near-white
	-- sheet among the dark base sheets (2026-10-31)
	local function belowBase(px: number, py: number, pz: number, cx: number, cy: number, r: number): boolean
		if camDx == nil or camDy == nil then
			return false
		end
		local cz = camZ or 2
		if cz >= base or pz <= base then
			return false
		end
		local t = (base - cz) / (pz - cz)
		local qx, qy = camDx + (px - camDx) * t, camDy + (py - camDy) * t
		return (qx - cx) ^ 2 + (qy - cy) ^ 2 < r * r
	end
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
	-- crisp turrets only where the updraft still feeds the cloud (Round 38: per level, from
	-- StormShape.freshAt - the share of the drawn cloud that is fresh; was one ramp(W) for all of it).
	-- Left-over cloud is soft and ragged where liquid, fibrous where glaciated (iceAt), and thins
	-- as its water rains out
	local crisp = ramp(W, 8, 35) * (1 - fade)
	local freshAt, iceAt = sh.freshAt, sh.iceAt
	local dk = sqrt(clamp(detail, 0.25, 1))
	-- a left-over (unfed) piece of cloud: soft sheet where liquid, wisps where glaciated (h: the
	-- card's own draw against the ice share, so the texture changes card by card, not all at once)
	local function remnantTex(ice: number, h: number): string
		return if h < ice then "wispFlat" else "softSheetFlat"
	end

	section = "tower"
	-- Tower ---------------------------------------------------------------------------------
	-- (a storm drawn as a mesh keeps its tower's lobes, billows and dome as detail over the mesh:
	-- CardPlan.meshDetail, LabConfig.STORM_MESH.detailCards)
	tagTower = true
	presA = 1 - ramp(fade, 0.6, 0.97) -- (gone at 0.85 in one step: the tower vanished in 1.2 s)
	if (not meshBody or CardPlan.meshDetail) and fade < 0.97 and #sh.levels > 0 then
		local albedo = 0.84 - 0.08 * fade + 0.04 * crisp
		local z = base + 0.35 * cloudR(base)
		local rB, bx, by = cloudR(base) -- (the column's footprint on the base)
		-- a point on the tower's side at direction (ox, oy) is on its silhouette when that direction
		-- is across the line of sight (the camera's direction from the axis)
		local detA = CardPlan.detailAlpha
		local function onEdge(ax: number, ay: number, ox: number, oy: number): boolean
			if not CardPlan.detailEdgeOnly or camDx == nil or camDy == nil then
				return true
			end
			local cx, cy = camDx - ax, camDy - ay
			local m = sqrt(cx * cx + cy * cy)
			return m < 1 or math.abs(ox * cx + oy * cy) / m < 0.5
		end
		local lvl = 0
		while z < colTop do
			lvl += 1
			local r, tx, ty = cloudR(z)
			local fr, qn = freshAt(z)
			local ice = iceAt(z)
			local thin = 0.55 + 0.45 * qn -- (left-over cloud thins as its water rains out)
			if r < 200 then
				z += 500 / dk -- (a level the cloud has gone from: an eroded remnant)
				continue
			end
			-- the centre fills the column (it sees little sky, gets sun only through the column; with
			-- the body drawn as a mesh, the mesh fills it)
			if meshBody then
				-- (none)
			elseif belowBase(tx, ty, z, bx, by, rB) then
				-- (as a base card: a down-facing sheet in the light under the base)
				add(tx, ty, z, 1.7 * r, 1.7 * r, 0.9, "softSheetFlat", albedo, sunLit(tx, ty, base - 80) * 0.6, 0.5, baseZ, 0, 0, -1)
			elseif min(1.7 * r, max(60, 2 * (z - baseZ) + 0.15 * 1.7 * r)) < 0.6 * 1.7 * r then
				-- (just above the base the floor squashes the core into a wide flat oval: a pale lens
				-- face-on in the tower, SC check 2026-11-01. The lobes and the base fill it there)
			else
				local cc = add(tx, ty, z, 1.7 * r, 1.7 * r, 0.9 * (fr + (1 - fr) * thin), "softSheetFlat", albedo, sunLit(tx + shx * r, ty + shy * r, z) * 0.6, 0.6, baseZ)
				cc.lobe = "soft"
				cc.core = true
			end

			local n = clamp(math.floor(8 * dk + 0.5), 4, 9)
			local a0 = hash(seed, lvl, 40) * TAU
			for k = 1, n do
				local a = a0 + (k - 1) / n * TAU
				local ox, oy = cos(a), sin(a)
				-- a gentle mix of sizes (about one card in four a bigger lobe set a little further
				-- in). A strong mix of big and small cards read as a pile of bubbles (2026-10-25)
				local hb = hash(seed, lvl * 16 + k, 42)
				local big = hb < 0.25
				local out = if big then 0.56 else 0.62 + 0.05 * hb
				if meshBody then
					out += 0.33 -- (on the mesh's surface, not inside it)
				end
				local px, py = tx + ox * out * r, ty + oy * out * r
				-- (over a mesh, a card on the face toward the camera only covers it: keep the edge)
				local face = meshBody and not onEdge(tx, ty, ox, oy)
				-- lit from its outer surface toward the sun: the sunny side bright, the far side dark
				local lit = sunLit(px + ox * 0.45 * r, py + oy * 0.45 * r, z)
				local wc = r * (if big then 1.2 else 0.9 + 0.15 * hb) * (0.9 + 0.25 * hash(seed, lvl * 16 + k, 41))
				local nx, ny, nz = norm(ox, oy, 0.15)
				if face and belowBase(px, py, z, bx, by, rB) then
					-- (none)
				elseif belowBase(px, py, z, bx, by, rB) then
					add(px, py, z, wc, wc, 0.92, "softSheetFlat", albedo, sunLit(px, py, base - 80) * 0.6, 0.5, baseZ, 0, 0, -1)
				elseif hash(seed, lvl * 16 + k, 43) < fr then
					add(px, py, z, wc, wc, if face then 0.4 * detA elseif meshBody then detA else 0.92, "lumpyFlat", albedo, lit, 1, baseZ, nx, ny, nz)
				else
					-- (left over: no updraft renews its turrets)
					local tex = remnantTex(ice, hash(seed, lvl * 16 + k, 44))
					local wisp = tex == "wispFlat"
					local c = add(px, py, z, if wisp then 1.3 * wc else wc, if wisp then 0.7 * wc else wc, (if face then 0.4 * detA elseif meshBody then detA else 0.88) * thin,
						tex, albedo + (if wisp then 0.04 else 0), lit, 1, baseZ, nx, ny, nz)
					if not wisp then
						c.lobe = "soft"
					end
				end
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
			-- (turrets boil only where the updraft still feeds the cloud)
			if hash(seed, 100 + b, 7) >= (freshAt(zb)) then
				continue
			end
			local a = h2 * TAU
			local ox, oy = cos(a), sin(a)
			local bs = 2 * r * (0.3 + 0.25 * h3) * (0.8 + 0.3 * crisp)
			local px, py = tx + ox * r * 0.85, ty + oy * r * 0.85
			local nx, ny, nz = norm(ox, oy, 0.3)
			local c = if belowBase(px, py, zb, bx, by, rB) or (meshBody and not onEdge(tx, ty, ox, oy)) then nil else add(px, py, zb, bs, bs, if meshBody then detA else 0.95, "lumpyFlat", 0.93, sunLit(px + ox * bs * 0.5, py + oy * bs * 0.5, zb), 1, baseZ, nx, ny, nz)
			if c then
				boil(c, W, bs, true)
			end
		end
		-- the top: a dome while rising (a cluster of cards), a cap under the anvil when mature
		local rTop, tx, ty = cloudR(max(base, colTop - 400))
		local frT, qnT = freshAt(max(base, colTop - 400))
		local iceT = iceAt(colTop)
		local nT = if sh.anvil then 3 else 5
		for k = 1, nT do
			local a = hash(seed, 700 + k, 7) * TAU
			local rr = rTop * 0.5 * hash(seed, 700 + k, 8)
			local px, py = tx + cos(a) * rr, ty + sin(a) * rr
			local cw = rTop * (1.1 + 0.4 * hash(seed, 700 + k, 9))
			local pz = colTop - 0.15 * cw
			local nx, ny, nz = norm(cos(a) * 0.5, sin(a) * 0.5, 1)
			if hash(seed, 700 + k, 10) < frT then
				local c = add(px, py, pz, cw, cw * 0.8, 0.95, "lumpyFlat", 0.96, sunLit(px, py, pz + 0.4 * cw), 1, nil, nx, ny, nz)
				if not sh.anvil then
					boil(c, W, cw) -- (a rising dome boils; a cap under the anvil is held by it)
				end
			else
				-- (a left-over top: flattened, soft or fibrous - it no longer rises)
				local tex = remnantTex(iceT, hash(seed, 700 + k, 11))
				local c = add(px, py, pz + 0.1 * cw, cw * 1.15, cw * 0.5, 0.9 * (0.55 + 0.45 * qnT), tex, 0.95, sunLit(px, py, pz + 0.4 * cw), 1, nil, nx, ny, nz)
				if tex ~= "wispFlat" then
					c.lobe = "soft"
				end
			end
		end
	end
	-- the overshooting top above the anvil, from top - el
	local over = top - el
	presA = ramp(maturity, 0.9, 1) * (1 - ramp(fade, 0, 0.15)) -- (was on at maturity 0.97 and fade 0, at half size)
	if not meshBody and fade < 0.15 and maturity >= 0.9 and over > 150 then
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

	tagTower = false
	section = "anvil"
	-- Anvil ---------------------------------------------------------------------------------
	local A = sh.anvil
	presA = if A then (A.a or 1) else 1
	if A and not meshBody then
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
				local at = add(px, py, tp - 0.25 * th, cw, ch, a, "lumpyFlat", 0.92, litTop, 0.9, nil, 0, 0, 1)
				at.lobe = "soft" -- (an anvil's top is smooth ice cloud)
				add(px - cxv * 0.25 * sp, py - cyv * 0.25 * sp, tp - 0.5 * th, cw, ch, a, "softSheetFlat", 0.88, litTop * 0.6, 0.75)
				add(px + cxv * 0.3 * sp, py + cyv * 0.3 * sp, tp - 0.8 * th, cw * 0.95, ch * 0.8, a, "softSheetFlat", 0.82, litTop * 0.3, 0.6, nil, 0, 0, -1)
			end
			x += sp
		end
	end

	section = "forwardFlank"
	-- Forward flank: the cloud over the storm's rain --------------------------------------------
	-- (2026-10-31, Round 17) Rain falls out of cloud: wherever the precipitation field says this
	-- storm is raining (CardPlan.rainAt, set by Render/StormCards: the surface rain of the storm
	-- nearest each point) there is cloud from about the base up into the anvil - the forward
	-- flank's deep, dark body that makes a supercell low and wide in photos (docs/storm-reference
	-- real 01_*, 03_*). Before this the rain curtains hung out of clear sky beside a lone tower.
	-- Each raining cell gets a ragged dark underside; cells on the rain area's edge get side walls
	-- (outward normals, lit by the sun march); cells not under the anvil get a top. Heavier rain:
	-- a darker, lower, deeper cloud.
	local rainAt = CardPlan.rainAt
	presA = ramp(maturity, 0.15, 0.4) * (1 - ramp(fade, 0.75, 0.98))
	if rainAt and not meshBody and maturity > 0.15 and fade < 0.98 then
		local sp = clamp(2200 / dk, 2200, 4500)
		local reach = min(45000, 3 * (s.Ru or 3000) + 0.5 * (s.anvilLen or 0))
		local n = math.ceil(reach / sp)
		local cells = {}
		local function at(i: number, j: number): number
			return cells[(i + 512) * 1024 + (j + 512)] or 0
		end
		for i = -n, n do
			for j = -n, n do
				local r = rainAt(s.x + i * sp, s.y + j * sp)
				if r > 0.5 then
					cells[(i + 512) * 1024 + (j + 512)] = r
				end
			end
		end
		local A2 = sh.anvil
		local function underAnvil(px: number, py: number): boolean
			return A2 ~= nil and sh.inCloud(px, py, A2.top0 - 0.5 * A2.th0)
		end
		-- the rain region's cloud joins the storm's volume for the sun march, so its far side and
		-- its depths are in its own shadow (lit as open sky it drew pale grey, 2026-10-31)
		local elR = el
		sh.ffAt = function(x: number, y: number, z: number): boolean
			if z < base - 250 or z > elR then
				return false
			end
			local r = at(math.floor(x / sp + 0.5), math.floor(y / sp + 0.5))
			return r > 0 and z < base + (elR - base) * (0.35 + 0.45 * ramp(r, 0.5, 40))
		end
		-- raining within about a cell of (x, y): the rain-free base runs on to the forward flank's
		-- underside there (Round 27)
		sh.rainNear = function(x: number, y: number): boolean
			local ci, cj = math.floor(x / sp + 0.5), math.floor(y / sp + 0.5)
			for di = -1, 1 do
				for dj = -1, 1 do
					if at(ci + di, cj + dj) > 0 then
						return true
					end
				end
			end
			return false
		end
		table.clear(litMemo) -- (light worked out before the forward flank existed)
		-- seen from below the cloud base, a wall or top card whose sight line crosses the base inside
		-- the rain area is behind the forward flank's own underside: left out (drawn upright, one
		-- hung overhead as a big pale oval, 2026-11-01 shot P2)
		local function hiddenFF(px: number, py: number, pz: number): boolean
			if camDx == nil or camDy == nil then
				return false
			end
			local cz = camZ or 2
			local zc = base - 150
			if cz >= zc or pz <= zc then
				return false
			end
			local t = (zc - cz) / (pz - cz)
			local qx, qy = (camDx :: number) + (px - (camDx :: number)) * t, (camDy :: number) + (py - (camDy :: number)) * t
			return at(math.floor(qx / sp + 0.5), math.floor(qy / sp + 0.5)) > 0
		end
		for i = -n, n do
			for j = -n, n do
				local r = at(i, j)
				if r > 0 then
					local h1, h2, h3 = hash(seed, 900 + i * 97 + j, 51), hash(seed, 900 + i * 97 + j, 52), hash(seed, 900 + i * 97 + j, 53)
					local qv = ramp(r, 0.5, 40)
					-- (each cell in by its rain: on at 0.5 mm/h at 0.9 it popped, and its walls flipped as
					-- neighbours came and went, 2026-11-03)
					local wr = ramp(r, 0.5, 3)
					local px, py = (i + (h1 - 0.5) * 0.5) * sp, (j + (h2 - 0.5) * 0.5) * sp
					local anv = underAnvil(px, py)
					local zb = base - (60 + 220 * qv) * h3 -- (rain-cooled air saturates lower: a ragged, lowered underside)
					local topZ = if anv then sh.anvil.top0 - 0.6 * sh.anvil.th0 else base + (el - base) * (0.35 + 0.45 * qv)
					local cw = 1.9 * sp * (0.9 + 0.25 * h2)
					-- the underside
					local uh = if camDx then seenHeight(px - camDx, py - (camDy or 0), zb - (camZ or 2), cw, 0.38 * cw, 300 + 300 * qv) else 0.38 * cw
					add(px, py, zb, cw, uh, 0.9 * wr, "softSheetFlat", 0.62 - 0.18 * qv, sunLit(px, py, zb - 80) * 0.5, 0.45, nil, 0, 0, -1)
					-- the side walls on the rain area's edge (outward: toward the cells without rain)
					local ex, ey, nOpen = 0, 0, 0
					for _, d in { { 1, 0 }, { -1, 0 }, { 0, 1 }, { 0, -1 } } do
						-- (how open that side is: by the neighbour's own weight, so a wall comes and goes
						-- as the neighbour does)
						local o = 1 - ramp(at(i + d[1], j + d[2]), 0.5, 3)
						ex += d[1] * o
						ey += d[2] * o
						nOpen += o
					end
					local em = sqrt(ex * ex + ey * ey)
					local wk = clamp(em, 0, 1)
					if em < 0.3 and nOpen > 0.5 then
						wk = 1
						-- (open on opposite sides - a lone cell, or a one-cell-wide band - the outward
						-- directions cancelled and it had no wall: its lumpy top floated alone over a thin
						-- underside, the "lone puff" beside young towers, SC check 2026-11-02. The wall
						-- then faces the camera, the side that shows)
						local vx, vy = (camDx or (px + 1)) - px, (camDy or py) - py
						if at(i + 1, j) ~= 0 or at(i - 1, j) ~= 0 then
							vx = 0 -- (a band along x: its open sides are +-y)
						elseif at(i, j + 1) ~= 0 or at(i, j - 1) ~= 0 then
							vy = 0
						end
						local vm = sqrt(vx * vx + vy * vy)
						if vm > 1e-3 then
							ex, ey, em = vx / vm, vy / vm, 1
						end
					end
					if em > 0 then
						ex, ey = ex / em, ey / em
						-- one tall soft sheet from the underside to the top (round lumps stacked up the
						-- wall read as chains of beads, 2026-10-31), wider than the cell so neighbours
						-- overlap; lumpy cards only along its top edge
						local depth = topZ - zb
						local wx, wy = px + ex * 0.35 * sp, py + ey * 0.35 * sp
						local nx, ny, nz = norm(ex, ey, 0.1)
						local midZ = zb + 0.5 * depth
						local wall = if hiddenFF(wx, wy, midZ) then nil else add(wx, wy, midZ, 2.4 * sp, depth * 1.15, 0.92 * wr * wk, "softSheetFlat", 0.6 - 0.12 * qv,
							sunLit(wx + ex * sp, wy + ey * sp, midZ), 0.7, nil, nx, ny, nz)
						if wall then
							wall.lobe = "soft"
						end
						if not anv and not hiddenFF(wx, wy, topZ) then
							local hk = hash(seed, 900 + i * 97 + j, 54)
							local wc = 1.3 * sp * (0.85 + 0.3 * hk)
							local c = add(wx, wy, topZ - 0.3 * wc, wc, wc * 0.8, 0.9 * wr * wk, "lumpyFlat", 0.78,
								sunLit(wx + ex * 0.5 * wc, wy + ey * 0.5 * wc, topZ), 0.9, nil, norm(ex, ey, 0.6))
							c.lobe = "tower"
						end
					end
					-- the top where no anvil covers it (seen from far off and from above)
					if not anv and not hiddenFF(px, py, topZ) then
						local cwT = 1.6 * sp * (0.9 + 0.3 * h1)
						add(px, py, topZ - 0.2 * cwT, cwT, cwT * 0.7, 0.9 * wr, "lumpyFlat", 0.8, sunLit(px, py, topZ + 200), 0.95, base, 0, 0, 1)
					end
				end
			end
		end
	end

	section = "base"
	-- Base ----------------------------------------------------------------------------------
	-- the rain-free base round the updraft (~2.2 Ru(base)): lumpy dark cards with a ragged fringe
	-- of scud hanging under it (rising moist inflow condensing below the base), denser toward the
	-- lowering where the inflow converges into the updraft
	local lowX, lowY = (s.lowX or s.x) - s.x, (s.lowY or s.y) - s.y
	-- the clear slot (Util.slotAt): the base, its lumps and rim are thinned there, with a frayed lip
	local sl = Util.slotParams(s)
	local deckInfo = nil -- (the rain-free base for Render/BaseDeck: centre, radius, height, slot)
	local function slot(px: number, py: number): number
		return Util.slotAt(sl, px, py)
	end
	-- (sh.deck: none under a storm with neither an updraft nor a remembered cloud foot, Round 38)
	presA = if sh.deck then (sh.deck.a or 1) else 1
	if sh.deck then
		-- the rain-free base reaches from the wall cloud (on its rear edge, by the rain) out toward
		-- the storm's right flank and flanking line: its centre sits beyond the updraft, away from
		-- the low meso (StormShape: the same deck shades what hangs under it)
		local D = sh.deck :: any
		local tx, ty, Rb, thick = D.x, D.y, D.r, D.thick
		local albedo = 0.72 - 0.12 * ramp(top - base, 6000, 13000)
		-- the deck: one continuous sheet, not a carpet of puffs. A few large soft cards overlap
		-- heavily (their edges fall under their neighbours), darker toward the updraft where the
		-- cloud above is thickest (the sun march through the tower and anvil already says so)
		-- a flat card's height as the camera sees it: a level sheet cw across and t thick at
		-- elevation e shows cw sin e + t cos e tall. A billboard is always drawn upright at full
		-- height, so a km-wide piece of the base seen low on the horizon hung a soft curtain down
		-- to the ground in front of everything beyond it - it veiled a wedge 3.5 km away until it
		-- had no sides (2026-10-29). Overhead the card keeps its full height.
		local function seenH(px: number, py: number, z: number, cw: number, ch: number, t: number): number
			if camDx == nil or camDy == nil then
				return ch
			end
			return seenHeight(px - camDx, py - camDy, z - (camZ or 2), cw, ch, t)
		end
		local function deck(px: number, py: number, z: number, cw: number, a: number, alb: number)
			-- (seen at its slant, as the grid cards: drawn upright at 0.38 x its width, the far deck
			-- stood up as a flat grey saucer from behind and far, SC check 2026-11-01)
			add(px, py, z, cw, seenH(px, py, z, cw, max(0.38 * cw, thick), thick), a, "softSheetFlat", alb, sunLit(px, py, base - 80) * 0.6, 0.5, nil, 0, 0, -1)
		end
		-- A billboard faces the camera, so a card is a ceiling only when it is small next to its
		-- distance: seen from under the deck, a big card stands up as a far wall. Near or under
		-- the base the deck is a grid of medium cards; from outside it, a few big ones.
		local cdx, cdy = (camDx or 1e9) - tx, (camDy or 1e9) - ty
		local under = cdx * cdx + cdy * cdy < (1.7 * Rb) ^ 2
		deckInfo = if meshBody then nil else { x = tx, y = ty, r = Rb, z = base, slot = sl }
		-- (a storm drawn as a mesh: its base is the mesh's; only the scud under its edge stays cards)
		if not meshBody then
		if under then
			local sp = clamp(Rb / (3 + 2 * dk), 600, 2500)
			-- the deck reaches past 0.95 Rb where the storm rains close by: the rain-free base and the
			-- forward flank's underside are one cloud - drawn only round the updraft, sky showed
			-- between the base and the rain area's cloud (SC check 2026-11-01)
			local rainNear = sh.rainNear
			local reachB = if rainNear then 1.8 * Rb else Rb
			local n = math.ceil(reachB / sp)
			for i = -n, n do
				for j = -n, n do
					local h1, h2 = hash(seed, 700 + i * 61 + j, 11), hash(seed, 700 + i * 61 + j, 12)
					local ox, oy = (i + (h1 - 0.5) * 0.3) * sp, (j + (h2 - 0.5) * 0.3) * sp
					local px, py = tx + ox, ty + oy
					-- where the card's centre is against the solid discs' patch (Render/BaseDeck: disc
					-- centres within 0.75 of the base's radius and within the steep patch over the
					-- camera, each disc reaching ~0.4 of its width past its centre): m > 0 inside
					local dCam = sqrt((px - (camDx or 1e9)) ^ 2 + (py - (camDy or 1e9)) ^ 2)
					local rCam = CardPlan.flatDeckReach
					local m = min(0.75 * Rb - sqrt(ox * ox + oy * oy), rCam - dCam)
					-- (and no discs round the wall cloud: Render/BaseDeck leaves out discs whose centre
					-- is within 1.15 R + half a disc of it. Without this the cards were left out there
					-- too, and the sky showed round the wall cloud, 2026-10-30)
					local hole = CardPlan.planHole
					if hole and hole.x and hole.r then
						m = min(m, sqrt((px - (hole.x - s.x)) ^ 2 + (py - (hole.y - s.y)) ^ 2) - (1.15 * hole.r + 0.5 * CardPlan.flatDeckDisc))
					end
					m += 0.4 * CardPlan.flatDeckDisc
					-- (a soft sheet frame is opaque over ~40% of its size: 2.4 x the step, jittered 0.3 of
					-- a step either way, left sky between the cores - the base broke into dark lumps with
					-- blue between them, SC check 2026-11-01. 3 x the step makes the cores meet)
					local cw = 3 * sp * (0.9 + 0.2 * h1)
					local deckOn = CardPlan.flatDeckReach > 0 and rCam > 0
					-- (the patch's outer grid steps are soft see-through edge discs: a card above them
					-- would show through, so "inside" starts past them. All discs soft: none are solid,
					-- and a card is left out as soon as the discs cover it)
					local solidDeck = CardPlan.flatDeckSolid
					local solid = if solidDeck then 2.2 * CardPlan.flatDeckDisc else 0
					-- (left out well inside the patch: the solid discs are the base there)
					local nearCam = deckOn and m > 0.35 * cw + solid
					local ca = 1 - slot(px, py)
					local d2 = ox * ox + oy * oy
					local inDeck = d2 < (0.95 * Rb) ^ 2 or (rainNear ~= nil and d2 < reachB * reachB and rainNear(px, py))
					if inDeck and not nearCam and ca > 0.15 then
						local z = base + 0.45 * thick
						local ch = seenH(px, py, z, cw, max(0.55 * cw, thick), thick)
						-- (only solid discs cut: soft ones, see-through, showed a card lifted over them as a
						-- squashed dark lens - the "saucer" - 2026-10-31)
						if solidDeck and deckOn and m > solid - 0.5 * cw then
							-- (a card reaching the solid discs sits wholly above their plane, or the plane
							-- cuts it along a straight line. Never hung below it: a km-wide card hung
							-- under the base drew a cloud wall in front of distant tornadoes, 2026-10-30;
							-- the soft see-through edge discs hide the patch's edge instead)
							z = max(z, base + 0.5 * ch + 10)
						end
						add(px, py, z, cw, ch, ca, "softSheetFlat",
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
		end -- (not meshBody)
		-- (a mesh base keeps the rim as detail: its soft ragged edge over the mesh's)
		if not meshBody or CardPlan.meshDetail then
		-- the rim: lumpy cards give the deck a ragged edge where it is seen against the sky
		local nRim = clamp(math.floor(22 * dk), 10, 24)
		for k = 1, nRim do
			local h1, h2 = hash(seed, 530 + k, 11), hash(seed, 530 + k, 12)
			local a = (k - 1 + 0.6 * h1) / nRim * TAU
			local rr = Rb * (0.88 + 0.1 * h2)
			local px, py = tx + cos(a) * rr, ty + sin(a) * rr
			local cw = Rb * (0.32 + 0.15 * h2)
			local zr = base + 0.25 * thick
			-- (seen from below - over ~8.5 deg up - the rim is the deck's underside going on:
			-- smooth sheet, facing down. Its km-wide lumps hung as pouches over a camera under the
			-- base, 2026-10-31; as CardPlan.fromPieces)
			local dxr, dyr = px - (camDx or 1e9), py - (camDy or 1e9)
			-- (and from outside the base: lumpy rim cards drew a row of dark ovals along the edge of a
			-- pale lens at 10-20 km, 2026-10-31 P1)
			if not under or zr - (camZ or 2) > 0.15 * sqrt(dxr * dxr + dyr * dyr) then
				add(px, py, zr, cw, seenH(px, py, zr, cw, cw * 0.42, 0.5 * thick), 0.9 * (1 - slot(px, py)), "softSheetFlat", albedo * 1.02, sunLit(px, py, base - 80) * 0.7, 0.55, nil, 0, 0, -1)
			else
				add(px, py, zr, cw, cw * 0.42, 0.9 * (1 - slot(px, py)), "lumpyFlat", albedo * 1.02, sunLit(px, py, base - 80) * 0.7, 0.55, nil, cos(a), sin(a), -0.4)
			end
		end
		end
		if not meshBody then
		-- texture underneath: lumps hanging just below the deck on a loose grid (the deck's
		-- structure; they also hide its card edges and cover the top of a funnel)
		local sp = clamp(Rb / (2.2 + 1.4 * dk), 900, 4000)
		local n = math.ceil(Rb / sp)
		for i = -n, n do
			for j = -n, n do
				local h1, h2, h3 = hash(seed, 500 + i * 61 + j, 11), hash(seed, 500 + i * 61 + j, 12), hash(seed, 500 + i * 61 + j, 13)
				local ox, oy = (i + (h1 - 0.5) * 0.8) * sp, (j + (h2 - 0.5) * 0.8) * sp
				local d = sqrt(ox * ox + oy * oy)
				local px, py = tx + ox, ty + oy
				local ca = 1 - slot(px, py)
				if d < 0.92 * Rb and ca > 0.15 then
					-- near the camera the lumps are drawn at their own size: a base's lumps are the
					-- boundary layer's eddies, about as wide as the base is high (~1.2 base). A grid
					-- lump 3-6 km wide drawn at its centre's distance stood up as a lone oval whose
					-- far half sat in front of the funnel (2026-10-29); far off, one big card is fine
					-- (it is small on screen and foreshortened to a strip)
					local fineSp = clamp(1.2 * base, 500, sp)
					local m = 1
					local dcam2 = (px - (camDx or 1e9)) ^ 2 + (py - (camDy or 1e9)) ^ 2
					if dcam2 < (2.5 * sp) ^ 2 then
						m = clamp(math.ceil(sp / fineSp), 1, 3)
					end
					local sub = sp / m
					for a2 = 0, m - 1 do
						for b2 = 0, m - 1 do
							local hk = 500 + i * 61 + j + (a2 * 3 + b2) * 7919
							local g1, g2, g3 = h1, h2, h3
							local qx, qy = px, py
							if m > 1 then
								g1, g2, g3 = hash(seed, hk, 14), hash(seed, hk, 15), hash(seed, hk, 16)
								qx = px + ((a2 + 0.5) / m - 0.5) * sp + (g1 - 0.5) * 0.6 * sub
								qy = py + ((b2 + 0.5) / m - 0.5) * sp + (g2 - 0.5) * 0.6 * sub
							end
							local cq = 1 - slot(qx, qy)
							if cq > 0.15 then
								local cw = 1.5 * sub * (0.8 + 0.4 * g3)
								local z = base - 0.02 * thick
								-- (under the flat deck a lump hangs wholly below it: a km-wide card crossing the
								-- deck's plane was cut by it along a straight line, 2026-10-29)
								-- (where the discs are, shrunk and hung below them; faded out past the steep patch
								-- overhead - seen low in the sky the shrunken lumps read as crisp dark ovals, 2026-10-30)
								local rCam = CardPlan.flatDeckReach
								local rFade = CardPlan.flatDeckSteep * max(0, base - (camZ or 2))
								local reachQ = 0.4 * CardPlan.flatDeckDisc + 0.5 * cw
								local fadeQ = 1
								if rCam > 0 and (qx - (camDx or 1e9)) ^ 2 + (qy - (camDy or 1e9)) ^ 2 < (rCam + reachQ) ^ 2
									and (qx - tx) ^ 2 + (qy - ty) ^ 2 < (0.75 * Rb + reachQ) ^ 2 then
									cw = min(cw, 350 * (0.8 + 0.4 * g3))
									z = base - 0.19 * cw - 15
									-- (and they fade out toward the patch's edge: seen low in the sky the small
									-- lumps were crisp dark ovals; overhead they mottle the ceiling)
									local dq = sqrt((qx - (camDx or 1e9)) ^ 2 + (qy - (camDy or 1e9)) ^ 2)
									fadeQ = 1 - ramp(dq, 0.45 * rFade, 0.85 * rFade)
								end
								-- (a lump hangs ~0.25 of the deck's depth below it)
								-- (low contrast: the deck's own structure, not dots on it. At 0.6 alpha and 0.9-1.0 of
								-- its albedo they read as a grid of dark ovals from under the base, 2026-10-29)
								-- (seen from below - over ~8.5 deg up - a lump is the base's underside going on, as the rim
								-- and the sheet: smooth sheet. As lumpy cards they read from under the base as crisp dark
								-- ovals. Lit as the sheet (0.6) they drew pale smears over the darker discs, 2026-10-31)
								local dxq, dyq = qx - (camDx or 1e9), qy - (camDy or 1e9)
								local fromBelow = z - (camZ or 2) > 0.15 * sqrt(dxq * dxq + dyq * dyq)
								-- (and from outside the base: at 10-20 km the lumpy cards read as a row of dark
								-- ovals in a pale lens - the "saucer", 2026-10-31 shots P1/SC)
								add(qx, qy, z, cw, seenH(qx, qy, z, cw, cw * 0.38, 0.5 * thick), (0.4 - 0.15 * g3) * cq * fadeQ,
									if fromBelow or not under then "softSheetFlat" else "lumpyFlat",
									albedo * (0.98 + 0.06 * g2), sunLit(qx, qy, base - 80) * 0.5, 0.5, nil, 0, 0, -1)
							end
						end
					end
				end
			end
		end
		-- the slot's lip: torn wisps along both edges of the clear band, where the drying cloud frays
		if sl and sl.k > 0.15 then
			local nLip = math.floor(14 * dk * sl.k)
			for k = 1, nLip do
				local h1, h2 = hash(seed, 560 + k, 11), hash(seed, 560 + k, 12)
				local a = sl.a0 + 0.2 + (k - 0.5 + 0.5 * (h1 - 0.5)) / nLip * sl.span
				local side = if k % 2 == 0 then 1 else -1
				local rr = sl.rr + side * sl.w * (0.85 + 0.3 * h2)
				local px, py = sl.lx + cos(a) * rr, sl.ly + sin(a) * rr
				local cw = sl.w * (0.6 + 0.5 * h2)
				add(px, py, base - 0.23 * cw - 15, cw, cw * 0.45, 0.55 * sl.k, if h1 < 0.5 then "wispFlat" else "shredFlat",
					albedo * 1.05, sunLit(px, py, base - 80) * 0.8, 0.55, nil, 0, 0, -1)
			end
		end
		end -- (not meshBody)
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
	section = "inflowBand"
	-- Inflow band (beaver tail) ---------------------------------------------------------------
	-- moist inflow riding in over the rain-cooled forward-flank outflow, condensed just under the
	-- base: a smooth, flat band reaching from the updraft out into the inflow
	-- (05_inflow_band_beaver_tail_a). Its path is its air's: CardPlan.bandPath, from
	-- Sim/InflowCloud, traces the storm-relative wind back from the updraft's edge while that air's
	-- condensation level lies under the band, so it can't cross the rain core or the rear flank.
	-- (Until 2026-11-03 it was a straight line along one wind vector, pushed toward the forward
	-- flank.) Turbulent near the updraft, laminar and thinning toward its far end; it drifts in
	-- toward the updraft.
	do
		local srU, srV = s.srU or 0, s.srV or 0
		local sr = sqrt(srU * srU + srV * srV)
		local bp = CardPlan.bandPath
		-- (it needs the updraft drawing the inflow in - W, not the storm's dead flag)
		presA = ramp(W, 2, 8) * (1 - ramp(fade, 0.35, 0.7)) * ramp(maturity, 0.3, 0.5) * ramp(s.rot or 0, 0.25, 0.4) * ramp(sr, 4, 8)
		-- (drawn from where the path leaves the base deck, as before: inside it the deck covers it)
		local _, ux, uy = Storm.wprofAt(s, base)
		local Ru0 = clamp(2.2 * Storm.updraftRadiusAt(s, base), 1500, 15000)
		local Lb, sA = 0, nil
		if bp and #bp >= 2 then
			for k2 = 1, #bp do
				if k2 > 1 then
					Lb += sqrt((bp[k2][1] - bp[k2 - 1][1]) ^ 2 + (bp[k2][2] - bp[k2 - 1][2]) ^ 2)
				end
				if not sA and (bp[k2][1] - ux) ^ 2 + (bp[k2][2] - uy) ^ 2 >= (0.85 * Ru0) ^ 2 then
					sA = Lb
				end
			end
		end
		if sA and Lb - sA > 1500 and W > 2 and fade < 0.7 and maturity > 0.3 and (s.rot or 0) > 0.25 and sr > 4 then
			local q = ramp(sr, 6, 18) * ramp(s.rot or 0, 0.3, 0.8)
			local len = Lb - sA
			local wid = clamp(0.12 * Ru0, 600, 1400)
			-- (segments ~0.35 of the band's width apart: its soft-puff frames are opaque over only
			-- their middle ~half, so at the old 450 m - 900 m at a distant storm's lower detail -
			-- the band drew as a row of separate dark ovals, 2026-11-01)
			local nB = math.floor(len / (0.35 * wid)) + 2
			for i = 1, nB do
				local f = (i - 0.5) / nB
				local h1, h2 = hash(seed, 760 + i, 11), hash(seed, 760 + i, 12)
				-- (from the base deck's edge out into the clear inflow, where it shows against the
				-- sky; a little below the base: the inflow lifted over the outflow condenses there)
				local bx, by, _, dx, dy = alongPath(bp, (sA + f * len) / Lb)
				-- (a little off the path either side: the band's ragged width)
				local side = 0.1 * (h1 - 0.5) * Ru0 * (1 - 0.5 * f)
				bx, by = bx - dy * side, by + dx * side
				local w = wid * (1 - 0.55 * f) * (0.85 + 0.3 * h2)
				local z = base - 90 + 60 * h1
				local smooth = f > 0.3
				-- (a flat band: its height as seen from the camera (seenHeight), and seen from well
				-- below - over ~8.5 deg up - its smooth underside. Drawn upright and lumpy, its first
				-- segment hung under the base as a dark lens - the "saucer" - 2026-10-31)
				local wB, tB = w * 2.2, max(w * 0.35, 120)
				local hB = tB
				if camDx and camDy then
					local ddx, ddy, ddz = bx - (camDx :: number), by - (camDy :: number), z - (camZ or 2)
					hB = seenHeight(ddx, ddy, ddz, wB, max(0.38 * wB, tB), tB)
					-- (it must also cover the on-screen step to its neighbour along the band: seen
					-- end-on - the band running toward the camera, as from the inflow side - the next
					-- segment sits higher in the view by step x (along-band share of the sight line) x
					-- sin(elevation), more than a foreshortened sheet's height, and the band drew as a
					-- diagonal row of dark beads up the sky, 2026-11-01. softSheetFlat's frames are
					-- soft round puffs, opaque over only ~40% of their height: covering the step itself
					-- still left sky between the cores - 2.6x the step makes the cores meet)
					local Dh = sqrt(ddx * ddx + ddy * ddy)
					local L = max(1, sqrt(Dh * Dh + ddz * ddz))
					local radial = math.abs((ddx * dx + ddy * dy) / max(Dh, 1))
					local stepB = len / nB
					hB = max(hB, min(2.6 * stepB * radial * math.abs(ddz) / L + tB, 2.5 * tB + 2.6 * stepB))
					-- (and from beyond ~6 km: the root's turbulence is too fine to see there, and its
					-- lumpy cards - drawn as round hanging lobes - stacked up as a row of dark knobs
					-- off the base's end, 2026-11-01)
					smooth = smooth or ddz > 0.15 * Dh or Dh > 6000
				end
				-- (per-card opacity for the spacing: the band as dense as it was at 450 m steps)
				local aB = 1 - (1 - min((0.75 - 0.45 * f) * q, 0.99)) ^ ((len / nB) / 450)
				local c = add(bx, by, z, wB, hB, aB,
					if smooth then "softSheetFlat" else "lumpyFlat", 0.7 - 0.08 * ramp(top - base, 6000, 13000), sunLit(bx, by, z) * 0.8, 0.55,
					nil, 0, 0, -0.6)
				-- (only its turbulent root drifts in: the laminar band is where lifted air condenses,
				-- fixed to the boundary while the air flows through it. Every segment drifting ~2 km
				-- a cycle and fading at its ends broke the band into a row of pale beads, 2026-11-01)
				if f <= 0.3 then
					inflow(c, ux, uy, 0.2, base + 60, nil)
				end
			end
		end
	end

	section = "striations"
	-- Mesocyclone striations -------------------------------------------------------------------
	-- the banded, ribbed updraft base of a rotating storm: stacked rings of wide banded cards
	-- round the updraft just above the cloud base, turning with the mid-level rotation. Shown
	-- where the storm rotates (rot) and the mesocyclone is strong (vmid), as the wall cloud.
	-- The "mothership" (stacked-plates) look is the same structure seen clearly: a strongly rotating
	-- updraft (rot, vmid) that little rain hides. Low precipitation efficiency (dry mid-levels,
	-- LP / classic storms) leaves the updraft visible from base to anvil; an HP storm's is wrapped
	-- in rain (NWS spotter guide; Moller et al. 1994). So the banded zone's depth, its flare and
	-- its tier count all grow with `ms`, and the tower's lobes in that zone go smooth (laminar).
	local vmid = math.abs(s.vmid or 0)
	local qs = ramp(s.rot or 0, 0.25, 0.7) * ramp(vmid, 10, 25) * (1 - fade) * maturity
	local dryUp = 1 - ramp(s.efficiency or 0.5, 0.35, 0.7) -- (how little rain veils the updraft)
	local ms = qs * ramp(s.rot or 0, 0.5, 0.9) * ramp(vmid, 15, 30) * (0.35 + 0.65 * dryUp)
	local striZ = base + (500 + 4500 * ms) -- (top of the banded zone)
	tagTower = true -- (the bands and plates are on the tower's side: hidden from under the base too)
	presA = ramp(W, 2, 8)
	if not meshBody and CardPlan.available.striationFlat and W > 2 and qs > 0.05 then
		local nT = (if dk > 0.7 then 4 else 3) + math.floor(5 * ms * dk + 0.5)
		local Hs = striZ - base - 120
		local dz = Hs / nT
		for t = 0, nT - 1 do
			local z = base + 120 + (t + 0.5) * dz
			local zf = (z - base) / max(Hs, 1) -- (0 at the base, 1 at the zone's top)
			local rT, tx, ty = cloudR(z)
			-- each tier a plate on the tower's surface, flaring out toward the base (the bell of a
			-- mothership), alternate tiers a little proud: the stacked-plate lips
			local lip = if t % 2 == 0 then 1.06 else 0.98
			local Rr = clamp(max(rT, 0.9 * Storm.updraftRadiusAt(s, z)) * (1 + 0.45 * ms * (1 - zf)) * lip, 1000, 12000)
			local nR = clamp(math.floor(2 * math.pi * Rr / 1100 * dk), 8, 14)
			local omega = vmid / Rr -- (rad/s: the ring turns with the mesocyclone)
			-- the plate: a ring seen from the side is one flat ellipse, 2 Rr wide and its depth plus
			-- 2 Rr sin(elevation) tall. Drawn as a lens per ring card it broke into a pile of
			-- separate grey ovals (2026-11-01, shots P5 and SC). One card per tier, on the ring's
			-- near side so it sits over the tower's lobes; the renderer's lobe shading gives its
			-- lit lip and shaded underside
			local onePlate = camDx ~= nil and camDy ~= nil
			if onePlate and ms > 0.1 then
				local vx, vy = (camDx :: number) - tx, (camDy :: number) - ty
				local vl = max(sqrt(vx * vx + vy * vy), 1)
				local ux, uy = vx / vl, vy / vl
				local se = math.abs(z - (camZ or 2)) / sqrt(vl * vl + (z - (camZ or 2)) ^ 2)
				local px, py = tx + ux * 0.6 * Rr, ty + uy * 0.6 * Rr
				local pw = 2.1 * Rr
				local ph = min(1.35 * dz + 2 * Rr * se, 0.6 * pw)
				if not belowBase(px, py, z, tx, ty, Rr) then
					local p = add(px, py, z, pw, ph, (0.55 + 0.4 * ms) * qs * ramp(ms, 0.1, 0.3), "lumpyFlat", 0.8, sunLit(px, py, z), 0.8, nil, ux, uy, 0.25)
					p.lobe = "soft"
				end
			end
			for k = 1, nR do
				local a = (k - 1 + 0.5 * (t % 2)) / nR * TAU + hash(seed, 800 + t * 31 + k, 11) * 0.3
				local px, py = tx + cos(a) * Rr, ty + sin(a) * Rr
				local cw = 2 * math.pi * Rr / nR * 1.9
				-- a billboard on the ring's silhouette is seen side-on but drawn face-on: its full
				-- width stuck out past the outline as a smeared streak (2026-10-29). There it is
				-- narrowed and faded; facing the camera it keeps its width
				local fa = 1
				-- (and a band on the upright flank seen steeply from below is foreshortened: hT cos e
				-- + its depth sin e tall at elevation e. Drawn upright at full height each band hung
				-- overhead as a bright lens, 2026-10-31)
				local fe = 1
				if camDx and camDy then
					local vx, vy = (camDx :: number) - px, (camDy :: number) - py
					local vl = max(sqrt(vx * vx + vy * vy), 1)
					fa = math.abs(cos(a) * vx / vl + sin(a) * vy / vl)
					local vz = z - (camZ or 2)
					local d3 = sqrt(vl * vl + vz * vz)
					fe = vl / d3 + 0.15 * math.abs(vz) / d3
				end
				-- (narrowed on the silhouette they stuck out past the outline as small ovals: faded
				-- there instead, 2026-11-01)
				cw *= 0.8 + 0.2 * fa
				-- (tall enough that neighbouring tiers touch: one banded wall, not floating rings)
				local hT = clamp(1.35 * dz, 0.2 * cw, 0.6 * cw) * clamp(fe, 0.2, 1)
				fa *= 0.3 + 0.7 * clamp(fe, 0, 1)
				-- (bands on the updraft's flank: from under the base the flank is hidden by it)
				if belowBase(px, py, z, tx, ty, Rr) then
					continue
				end
				local litP = sunLit(px, py, z)
				-- the plate: a flattened, shaded lens (a lit, rounded lip; the renderer's lobe
				-- shading darkens its underside: the groove under each plate). The more mothership,
				-- the more of the tier is plate rather than soft banding
				if ms > 0.2 and not onePlate then
					local p = add(px, py, z, cw, min(hT, 0.42 * cw), (0.55 + 0.4 * ms) * qs * (0.3 + 0.7 * fa), "lumpyFlat",
						0.8, litP, 0.8, nil, cos(a), sin(a), 0.25)
					p.lobe = "soft"
					p.mv = { k = "spin", tx = tx, ty = ty, omega = omega, P = 1 }
				end
				-- the banding over it (fibres along the flow), a little below: the shaded groove
				-- (low contrast against the tower: darker bands read as rows of dark ovals from afar)
				local c = add(px, py, z - 0.3 * dz, cw, hT, (0.6 - 0.3 * ms) * qs * fa * fa, "striationFlat",
					0.74 + 0.06 * ms * (1 - zf), litP * (1 - 0.25 * ms), 0.7, nil, cos(a), sin(a), -0.3)
				if c then
					c.mv = { k = "spin", tx = tx, ty = ty, omega = omega, P = 1 }
				end
			end
		end
	end
	tagTower = false
	-- (the tower's lobes in the banded zone are smooth: laminar, rotating inflow, not boiling)
	if ms > 0.15 then
		for _, c in out do
			if c.tex == "lumpyFlat" and c.lobe == nil and (c.nz or 0) > -0.3 and c.z < striZ and c.z > base
				and hash(seed, math.floor(c.x + c.z), 61) < 0.25 + 0.75 * ms then
				c.lobe = "soft"
			end
		end
	end

	section = "wallScud"
	-- Wall cloud, scud round it, tail cloud ----------------------------------------------------
	-- (the same rules as StormPlan: a lowering under the low-level mesocyclone down to wallBase
	-- when lowering and rotation are significant; its cards are relative to the lowering's centre
	-- in `wall`, turned as a whole at vlow / (0.3 Ru) by Render/StormCards, so the scud on it
	-- circles with the rotation)
	local wall = nil
	local lowering = s.lowering or 0
	local rot = s.rot or 0
	presA = ramp(W, 2, 8) * ramp(lowering, 30, 120) * ramp(rot, 0.25, 0.35)
	if W > 2 and lowering > 30 and rot > 0.25 and s.lowX and s.wallBase then
		-- (docs/stormlab/RESEARCH-WALLCLOUD-HV.md) a localized, abrupt lowering 1-4 km across under
		-- the rain-free base: moistened forward-flank air lowers its condensation level, the
		-- mesocyclone's pressure deficit lowers the centre further (the sim's wallBase). Its body
		-- is smooth and opaque with a sharp edge on the updraft side; the rear-flank side is
		-- ragged; banding and condensation filaments wrap into it as it turns; scud forms below it
		-- (100-600 m below the base) and rises into it at 2-10 m/s.
		local q = ramp(lowering, 30, 400) * ramp(rot, 0.25, 0.6)
		local Ru = max(s.Ru or 1500, 300)
		local lx, ly = lowX, lowY
		-- (as the storm occludes the RFD wraps round it and erodes it: it shrinks and its rear side
		-- goes ragged, a horseshoe open toward the clear slot; RESEARCH-WALLCLOUD-HV.md, NWS spotter guide)
		local occl = clamp(s.occl or 0, 0, 1)
		local R = 0.5 * clamp(0.9 * Ru, 1000, 3500) * (0.3 + 0.7 * q) * (1 - 0.35 * occl) -- (young lowerings small, as WallStream, 2026-11-03)
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
			a *= presA
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
		-- (how much of the rim facing the RFD is eaten: some always ragged, more as it occludes)
		local function eaten(ca: number, sa: number): number
			return clamp((ca * rrx + sa * rry - 0.2) / 0.6, 0, 1) * (0.3 + 0.6 * occl)
		end
		-- (style "stream": Render/WallStream draws the body, the banding, the filaments and the tail
		-- as puffs carried by the rotation and the inflow; only the scud stays here)
		local streamed = CardPlan.wallStream == true
		-- the body: rings of smooth opaque cards, each filling from the underside up into the base
		for ri, fr in (if streamed then {} else { 0, 0.4, 0.72, 0.93 }) :: { number } do
			local r = fr * R
			local nR = if ri == 1 then 1 else clamp(math.floor((4 + 6 * fr) * dk + 0.5), 4, 10)
			for k = 1, nR do
				local a = (k - 1 + 0.5 * (ri % 2)) / nR * TAU
				local ox, oy = cos(a) * r, sin(a) * r
				local zl = zbot(r)
				local hgt = base + 80 - zl
				local cw = if ri == 1 then 1.3 * R else max(2 * math.pi * r / nR * 1.7, 0.5 * R)
				local e = if ri == 1 then 0 else eaten(cos(a), sin(a)) * fr
				if e < 0.85 then
					-- (an eaten card is pulled in and torn: shred texture, thinner, its foot lifted)
					local tex = if e > 0.35 then "shredFlat" else "softSheetFlat"
					local pull = 1 - 0.3 * e
					addWall(ox * pull, oy * pull, zl + 0.45 * hgt + 0.25 * e * hgt, cw * (1 - 0.3 * e), max(hgt * 1.25, 0.3 * cw) * (1 - 0.4 * e),
						1 - 0.6 * e, litW * 0.5, 0.5, tex, albW * (1 + 0.1 * e), if ri == 1 then 0 else cos(a), if ri == 1 then 0 else sin(a), -0.5)
				end
			end
		end
		-- texture underneath: a few lumps hanging from the flat underside
		local nU = if streamed then 0 else math.floor(10 * dk)
		for k = 1, nU do
			local h1, h2, h3 = hash(seed, 670 + k, 11), hash(seed, 670 + k, 12), hash(seed, 670 + k, 13)
			local r = 0.8 * R * sqrt(h1)
			local a = h2 * TAU
			local cw = R * (0.35 + 0.25 * h3)
			addWall(cos(a) * r, sin(a) * r, zbot(r) - 0.05 * cw, cw, cw * 0.35, 0.5, litW * 0.5, 0.5,
				"lumpyFlat", albW, 0, 0, -1)
		end
		-- banding: horizontal striations wrapping round its side (they turn with the layer)
		if CardPlan.available.striationFlat and not streamed then
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
		local nF = if streamed then 0 else math.floor(16 * dk * q)
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
		-- (wherever there is a wall cloud at all: the same ingested outflow air that lowers it)
		if s.ffdX and q > 0.1 and not streamed then
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
	-- Skylight the storm's own cloud hides (2026-11-01): a card on a cloud's side or top lit by
	-- the whole sky drew its shaded faces pale (P1 mean 121 vs the photo's 85). Each such card
	-- looks out along its normal and up: rays through the storm's volume (tower, anvil, forward
	-- flank: sh.inCloud) that stay in cloud see no sky. Memoised on a 600 x 600 x 300 m grid.
	local tSky0 = os.clock()
	if CardPlan.skyOcclusion ~= false then
		local visMemo = {}
		local ce, se = cos(math.rad(35)), sin(math.rad(35))
		local function skyVis(px: number, py: number, pz: number, nx: number, ny: number): number
			local key = (math.floor(px / 600) * 4099 + math.floor(py / 600)) * 1031 + math.floor(pz / 300)
			local v = visMemo[key]
			if v then
				return v
			end
			local open, wsum = 0, 0
			for k = 0, 6 do
				local dx, dy, dz
				if k == 0 then
					dx, dy, dz = 0, 0, 1
				else
					local a = (k - 1) / 6 * TAU
					dx, dy, dz = cos(a) * ce, sin(a) * ce, se
				end
				-- (rays facing away from the card's surface see the cloud behind it: half weight)
				local w = 0.5 + 0.5 * clamp(dx * nx + dy * ny + 0.5 * dz, 0, 1)
				local free = 1
				for i = 1, 8 do
					local d = 900 * i
					if sh.inCloud(px + dx * d, py + dy * d, pz + dz * d) then
						free = 0
						break
					end
				end
				open += w * free
				wsum += w
			end
			v = open / wsum
			visMemo[key] = v
			return v
		end
		for _, c in out do
			local nx, ny, nz = c.nx, c.ny, c.nz
			if nx and nz > -0.5 and c.sky then
				c.sky *= 0.35 + 0.65 * skyVis(c.x + nx * 500, c.y + ny * 500, c.z + nz * 500, nx, ny)
			end
		end
	end
	CardPlan.lastSkyMs = (os.clock() - tSky0) * 1000 -- (the skylight pass's cost: StormCardsSkyMs)
	-- Seen from under the base, the tower's lobes above it are behind the base wherever the sight
	-- line crosses the rain-free base (its deck) outside the clear slot. belowBase only caught the
	-- column's own footprint, so a sunlit lobe seen through the deck beside it drew as a big pale
	-- oval overhead (2026-11-01, shot P2)
	local D = sh.deck
	-- (only with the camera well under the base, where the deck is drawn solid overhead: near its
	-- edge the deck is thin grazing cards that don't hide what is behind, and leaving the tower
	-- out there opened a band of blue sky over the base, 2026-11-01 shot P1 at 6 km)
	if D and camDx and camDy and (camZ or 2) < base - 50
		and ((camDx :: number) - D.x) ^ 2 + ((camDy :: number) - D.y) ^ 2 < (0.75 * D.r) ^ 2 then
		local cz = camZ or 2
		local kept = {}
		for _, c in out do
			local hide = false
			-- (not the cards already drawn as the base's underside: nz -1)
			if c.tw and c.nz ~= -1 and c.z > base then
				local t = (base - cz) / (c.z - cz)
				local qx, qy = (camDx :: number) + (c.x - (camDx :: number)) * t, (camDy :: number) + (c.y - (camDy :: number)) * t
				hide = (qx - D.x) ^ 2 + (qy - D.y) ^ 2 < (0.9 * D.r) ^ 2 and Util.slotAt(D.slot, qx, qy) < 0.5
			end
			if not hide then
				table.insert(kept, c)
			end
		end
		out = kept
	end
	local hideSec = CardPlan.hideSection
	if hideSec then
		local kept = {}
		for _, c in out do
			if c.sec ~= hideSec then
				table.insert(kept, c)
			end
		end
		out = kept
		if wall and hideSec == "wallScud" then
			wall.cards = {}
		end
	end
	rekey(tostring(s.id) .. "/s", out)
	if wall then
		rekey(tostring(s.id) .. "/w", wall.cards)
	end
	return out, sh, wall, deckInfo
end

-- Cards filling kit-style pieces ({ cf = unit box bottom-middle, Roblox axis order but metres;
-- size (m); colour }),
-- e.g. the shelf clouds of CloudParts/ShelfPlan: each box becomes a grid of soft lumpy cards
-- (spacing from its height), its brightness from the piece's colour. Positions in sim metres,
-- absolute (as the pieces). camX, camY, camZ (optional, sim metres): the camera, for the cards'
-- seen heights.
-- (2026-10-31: the pieces' cards were drawn at full height whatever the view - each km-wide
-- round lump stood upright and its lower half hung below the piece's flat bottom, so from under
-- a squall line's shelf and dark base strip the sky was a field of hanging pouches, mammatus-like.
-- Now a card keeps its bottom at its piece's bottom, is foreshortened as the deck's cards are
-- (seenHeight), and the thin base strip - and any card seen from well below - is smooth sheet
-- facing down, not round lumps)
function CardPlan.fromPieces(pieces: { any }, seed: number, detail: number, camX: number?, camY: number?, camZ: number?): { any }
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
		-- (a thin slab - the dark base strip behind a shelf - is a sheet seen from below)
		local slab = Y < 0.5 * math.min(X, Z)
		local zBot = pc.cf.Position.Y -- (cf: the box's bottom middle; Roblox axis order, metres)
		for ix = 1, nx do
			for iz = 1, nz do
				for iy = 1, ny do
					-- (each card a little off its grid place, its own size and opacity, and ~2x as wide
					-- as the grid step: same-size cards 1.5 steps wide at one opacity drew a shelf seen
					-- side-on as a string of identical beads, 2026-10-31)
					local hc = (ix * 92821 + iz * 68917 + iy * 3571 + pi * 131) % 16777213
					local j1, j2, j3 = hash(seed, hc, 41), hash(seed, hc, 42), hash(seed, hc, 43)
					local u, w = (ix - 0.5 + 0.6 * (j1 - 0.5)) / nx - 0.5, (iz - 0.5 + 0.6 * (j2 - 0.5)) / nz - 0.5
					local v = (iy - 0.5) / ny
					local p = pc.cf * Vector3.new(u * X, v * Y, w * Z)
					local x, y, z = p.X, -p.Z, p.Y
					local kx, ky, kz = math.floor(x / 300 + 0.5), math.floor(y / 300 + 0.5), math.floor(z / 200 + 0.5)
					local base = "p" .. kx .. "," .. ky .. "," .. kz
					local n = (used[base] or 0) + 1
					used[base] = n
					local kh = (kx * 7919 + ky * 104729 + kz * 1299709 + n * 31 + pi) % 16777213
					local cw = 2.1 * math.max(X / nx, Z / nz) * (0.75 + 0.5 * j3)
					local t = Y / ny
					local h = math.max(t * 1.3, 0.5 * cw)
					-- (seen from below - over ~8.5 deg up - it is the piece's flat underside that shows:
					-- smooth sheet, facing down. A km-wide round lump there is a hanging pouch; at 24 deg
					-- a scalloped row of them still hung lower in the sky, 2026-10-31)
					local under = slab
					local far = false
					if camX and camY then
						local dx, dy, dz = x - camX, y - camY, z - (camZ or 2)
						h = seenHeight(dx, dy, dz, cw, h, t)
						under = under or dz > 0.15 * sqrt(dx * dx + dy * dy)
						-- (small on screen - under ~11 deg across - the lumps' round outlines read as a row of
						-- beads along the line: a smooth sheet there; past 10 km they still showed nearer in,
						-- 2026-10-31)
						far = cw < 0.2 * sqrt(dx * dx + dy * dy + dz * dz)
					end
					-- (no lower than the piece's bottom, as add()'s floor)
					h = min(h, max(60, 2 * (z - zBot) + 0.15 * h))
					table.insert(out, {
						x = x, y = y, z = z, w = cw, h = h, a = 0.7 + 0.25 * hash(seed, hc, 44),
						tex = if under or far then "softSheetFlat" else "lumpyFlat", key = base .. "#" .. n, frame = math.floor(hash(seed, kh, 31) * 16),
						albedo = albedo, lit = 0.5, sky = 0.6, rot = hash(seed, kh, 32) * 360,
						nx = if under then 0 else nil, ny = if under then 0 else nil, nz = if under then -1 else nil,
					})
				end
			end
		end
	end
	return out
end

return CardPlan
