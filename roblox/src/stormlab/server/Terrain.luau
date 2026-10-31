--!nonstrict
-- The lab's uneven ground as real Terrain (physical: debris, vehicles and the camera meet it), the
-- same heights LabConfig.groundAt gives every renderer: rolling hills round the town site
-- (LabConfig.GROUND.relief), flat on the town's pad and fading to flat by the edge. Outside it the
-- client's farmland tiles (Render/Ground) are the ground. Rebuilt when the town moves.
--
-- Built chunk by chunk, nearest the town first, under a time budget per frame (2026-10-29: the old
-- build wrote every column from the datum up in strips from one corner, took many minutes, left
-- near-empty voxels - holes - wherever a hill came down close to the datum, and Terrain:Clear()
-- before a rebuild ran past the script timeout). Each chunk:
--   clears its own box of anything an earlier build left there,
--   lays a solid sheet just under the datum (so the ground is never holed),
--   fills the solid part of its hills with FillBlock and writes voxels only for the few layers its
--   surface passes through (heights from a coarse grid, interpolated).
-- After that, whatever an earlier build left outside the new area is erased. A newer build (the
-- town moved again) stops an older one; what that one left is erased by the newer one.
local Workspace = game:GetService("Workspace")

local Terrain = {}

local CHUNK = 64 -- voxel columns a side per chunk
local ERASE = 256 -- voxel columns a side per FillBlock when erasing an old area
local STEP = 4 -- heights are computed every STEP columns and interpolated between
local BUDGET = 0.006 -- s of work per frame before yielding
-- the sheet's top, m below the datum: under the town's ground plate (its top is the datum) and
-- above the client's farmland tiles (their top is 0.3 m below), so neither flickers
local SHEET_TOP = -0.08

local generation = 0
local built: { any } = {} -- the boxes (studs) builds have filled and nothing has erased yet

-- erase box A outside box B (both { x0, z0, x1, z1, bottom, top } in studs), a block at a time
local function eraseOutside(terrain: Terrain, A: any, B: any?, res: number, pace: () -> boolean): boolean
	local rects = {}
	if not B or B.x0 >= A.x1 or B.x1 <= A.x0 or B.z0 >= A.z1 or B.z1 <= A.z0 then
		rects = { { A.x0, A.z0, A.x1, A.z1 } }
	else
		-- the strips of A left of, right of, before and after B
		if B.x0 > A.x0 then
			table.insert(rects, { A.x0, A.z0, B.x0, A.z1 })
		end
		if B.x1 < A.x1 then
			table.insert(rects, { B.x1, A.z0, A.x1, A.z1 })
		end
		local mx0, mx1 = math.max(A.x0, B.x0), math.min(A.x1, B.x1)
		if B.z0 > A.z0 then
			table.insert(rects, { mx0, A.z0, mx1, B.z0 })
		end
		if B.z1 < A.z1 then
			table.insert(rects, { mx0, B.z1, mx1, A.z1 })
		end
	end
	local h = A.top - A.bottom
	local blk = ERASE * res
	for _, r in rects do
		for x = r[1], r[3] - 1e-6, blk do
			for z = r[2], r[4] - 1e-6, blk do
				local w, d = math.min(blk, r[3] - x), math.min(blk, r[4] - z)
				terrain:FillBlock(CFrame.new(x + w / 2, A.bottom + h / 2, z + d / 2), Vector3.new(w, h, d), Enum.Material.Air)
				if not pace() then
					return false
				end
			end
		end
	end
	return true
end

function Terrain.build(C: any, cx: number, cy: number, yieldFn: (() -> ())?): number
	generation += 1
	local myGen = generation
	local R = C.GROUND.relief
	local terrain = Workspace.Terrain
	local t0 = os.clock()
	local function pace(): boolean
		if generation ~= myGen then
			return false
		end
		if os.clock() - t0 > BUDGET then
			if yieldFn then
				yieldFn()
			end
			t0 = os.clock()
		end
		return generation == myGen
	end
	if #built == 0 then
		terrain:Clear() -- (nothing of ours there yet, so this is quick)
	end
	local res = 4 -- studs (WriteVoxels takes only 4)
	if not R or R.amp <= 0 then
		for i = #built, 1, -1 do
			if not eraseOutside(terrain, built[i], nil, res, pace) then
				return 0
			end
			table.remove(built, i)
		end
		return 0
	end
	-- match the farmland tiles' colour (Render/Ground) so the edge between them doesn't show
	local gc = C.GROUND.colour
	terrain:SetMaterialColor(Enum.Material.Grass, Color3.fromRGB(gc[1], gc[2], gc[3]))
	C.groundCentre = { x = cx, y = cy }
	local K = C.SCALE
	local half = R.radius * K
	local x0 = math.floor((cx * K - half) / res) * res
	local z0 = math.floor((-cy * K - half) / res) * res
	local n = math.ceil(2 * half / res)
	-- (the lab's datum is flat; datumY is it on the voxel grid, which WriteVoxels needs. Heights
	-- are measured from the true datum: from the rounded one the sheet sat up to half a voxel
	-- (0.56 m) low, under the farmland tiles, which then showed through round the town)
	local trueY = C.toWorld(cx, cy, 0).Y
	local datumY = math.floor(trueY / res + 0.5) * res
	local off = trueY - datumY -- studs, -res/2 .. res/2
	local sheetTop = trueY + SHEET_TOP * K
	local sheetBottom = math.floor((sheetTop - res) / res) * res - res
	local top = datumY + math.ceil((R.amp * K + res) / res) * res
	-- this build's box (kept in `built` until a later build erases it); the older ones' boxes,
	-- for clearing each chunk of what they left there
	local area = { x0 = x0, z0 = z0, x1 = x0 + n * res, z1 = z0 + n * res, bottom = sheetBottom, top = top }
	local older = table.clone(built)
	table.insert(built, area)
	local clearBottom, clearTop = sheetBottom, top
	for _, A in older do
		clearBottom, clearTop = math.min(clearBottom, A.bottom), math.max(clearTop, A.top)
	end

	local chunks = {}
	local ccx, ccz = (cx * K - x0) / res, (-cy * K - z0) / res -- the town in columns
	for bi = 0, n - 1, CHUNK do
		for bj = 0, n - 1, CHUNK do
			local mi, mj = bi + CHUNK / 2 - ccx, bj + CHUNK / 2 - ccz
			table.insert(chunks, { bi, bj, mi * mi + mj * mj })
		end
	end
	table.sort(chunks, function(a, b)
		return a[3] < b[3]
	end)
	local flatR = R.flat * K / res -- the pad and beyond the edge are flat: no hills there
	local edgeR = R.radius * K / res
	local sheetH = sheetTop - sheetBottom
	local filled = 0
	local hs = {} -- heights (studs above the datum) on the coarse grid
	for _, ch in chunks do
		local bi, bj = ch[1], ch[2]
		local ni, nj = math.min(CHUNK, n - bi), math.min(CHUNK, n - bj)
		local lx, lz = x0 + bi * res, z0 + bj * res
		local w, d = ni * res, nj * res
		-- clear what an older build left here, then the sheet
		if #older > 0 then
			terrain:FillBlock(CFrame.new(lx + w / 2, (clearBottom + clearTop) / 2, lz + d / 2), Vector3.new(w, clearTop - clearBottom, d), Enum.Material.Air)
		end
		terrain:FillBlock(CFrame.new(lx + w / 2, sheetBottom + sheetH / 2, lz + d / 2), Vector3.new(w, sheetH, d), Enum.Material.Grass)
		-- the chunk's nearest and farthest columns from the town: all flat (on the pad or beyond
		-- the edge) needs no hills
		local dxn = math.max(0, math.abs(bi + ni / 2 - ccx) - ni / 2)
		local dzn = math.max(0, math.abs(bj + nj / 2 - ccz) - nj / 2)
		local dxf = math.abs(bi + ni / 2 - ccx) + ni / 2
		local dzf = math.abs(bj + nj / 2 - ccz) + nj / 2
		local hilly = dxn * dxn + dzn * dzn < edgeR * edgeR and dxf * dxf + dzf * dzf > flatR * flatR
		if hilly then
			-- heights on the coarse grid (columns 0, STEP, ... up to ni / nj), studs above the datum
			local gi, gj = math.ceil(ni / STEP), math.ceil(nj / STEP)
			local hmin, hmax = math.huge, -math.huge
			for a = 0, gi do
				local row = hs[a] or {}
				hs[a] = row
				local X = x0 + (bi + a * STEP + 0.5) * res
				for b = 0, gj do
					local Z = z0 + (bj + b * STEP + 0.5) * res
					-- (studs above datumY; never below the sheet, or the layers written over it
					-- would cut its top away)
					row[b] = math.max(C.groundAt(X / K, -Z / K), SHEET_TOP) * K + off
				end
			end
			-- every column's height (bilinear), and the chunk's range
			local colH = {}
			for i = 1, ni do
				local fa = (i - 1) / STEP
				local a = math.floor(fa)
				local ta = fa - a
				local r0, r1 = hs[a], hs[math.min(a + 1, gi)]
				local col = {}
				colH[i] = col
				for j = 1, nj do
					local fb = (j - 1) / STEP
					local b = math.floor(fb)
					local tb = fb - b
					local b1 = math.min(b + 1, gj)
					local h = (r0[b] * (1 - tb) + r0[b1] * tb) * (1 - ta) + (r1[b] * (1 - tb) + r1[b1] * tb) * ta
					col[j] = h
					if h < hmin then
						hmin = h
					end
					if h > hmax then
						hmax = h
					end
				end
			end
			if hmax > 0.05 * res then
				-- the solid part under the lowest column (whole voxels above the datum)
				local solid = math.max(0, math.floor(hmin / res))
				if solid > 0 then
					local size = Vector3.new(w, solid * res, d)
					terrain:FillBlock(CFrame.new(lx + w / 2, datumY + size.Y / 2, lz + d / 2), size, Enum.Material.Grass)
				end
				-- the layers the surface passes through
				local l0 = solid
				local layers = math.ceil(hmax / res) - l0
				if layers > 0 then
					local mats, occ = table.create(ni), table.create(ni)
					for i = 1, ni do
						local col = colH[i]
						local mi, oi = table.create(layers), table.create(layers)
						mats[i], occ[i] = mi, oi
						for l = 1, layers do
							local bottom = (l0 + l - 1) * res
							local ml, ol = table.create(nj), table.create(nj)
							mi[l], oi[l] = ml, ol
							for j = 1, nj do
								local o = (col[j] - bottom) / res
								if o >= 1 then
									ml[j], ol[j] = Enum.Material.Grass, 1
									filled += 1
								elseif o > 0 then
									ml[j], ol[j] = Enum.Material.Grass, o
									filled += 1
								else
									ml[j], ol[j] = Enum.Material.Air, 0
								end
							end
						end
					end
					local lo = Vector3.new(lx, datumY + l0 * res, lz)
					terrain:WriteVoxels(Region3.new(lo, lo + Vector3.new(w, layers * res, d)), res, mats, occ)
				end
			end
		end
		if not pace() then
			return filled
		end
	end
	-- what older builds left outside this one
	for _, A in older do
		if not eraseOutside(terrain, A, area, res, pace) then
			return filled
		end
		local i = table.find(built, A)
		if i then
			table.remove(built, i)
		end
	end
	return filled
end

return Terrain
