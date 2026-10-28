--!nonstrict
-- The lab's uneven ground as real Terrain (physical: debris, vehicles and the camera meet it), the
-- same heights LabConfig.groundAt gives every renderer: rolling hills round the town site
-- (LabConfig.GROUND.relief), flat on the town's pad and fading to flat by the edge. Outside it the
-- client's farmland tiles (Render/Ground) are the ground. Built in chunks with a yield between
-- them; rebuilt when the town moves.
local Workspace = game:GetService("Workspace")

local Terrain = {}

local CHUNK = 96 -- voxel columns a side per WriteVoxels call

function Terrain.build(C: any, cx: number, cy: number, yieldFn: (() -> ())?): number
	local R = C.GROUND.relief
	local terrain = Workspace.Terrain
	terrain:Clear()
	if not R or R.amp <= 0 then
		return 0
	end
	C.groundCentre = { x = cx, y = cy }
	local K = C.SCALE
	local res = R.voxel or 4 -- studs
	-- the area in studs (X east, Z south), whole voxels
	local half = R.radius * K
	local x0 = math.floor((cx * K - half) / res) * res
	local z0 = math.floor((-cy * K - half) / res) * res
	local n = math.ceil(2 * half / res)
	local layers = math.ceil(R.amp * K / res) + 1
	local filled = 0
	for bi = 0, n - 1, CHUNK do
		for bj = 0, n - 1, CHUNK do
			local ni, nj = math.min(CHUNK, n - bi), math.min(CHUNK, n - bj)
			local mats, occ = {}, {}
			local any = false
			for i = 1, ni do
				mats[i], occ[i] = {}, {}
				for l = 1, layers do
					mats[i][l], occ[i][l] = {}, {}
				end
			end
			for i = 1, ni do
				local X = x0 + (bi + i - 0.5) * res
				for j = 1, nj do
					local Z = z0 + (bj + j - 0.5) * res
					-- the ground's height there (studs above the datum)
					local h = C.groundAt(X / K, -Z / K) * K
					for l = 1, layers do
						local bottom = (l - 1) * res
						local o = math.clamp((h - bottom) / res, 0, 1)
						mats[i][l][j] = if o > 0 then Enum.Material.Grass else Enum.Material.Air
						occ[i][l][j] = o
						if o > 0 then
							any = true
							filled += 1
						end
					end
				end
			end
			if any then
				local lo = Vector3.new(x0 + bi * res, 0, z0 + bj * res)
				local hi = lo + Vector3.new(ni * res, layers * res, nj * res)
				terrain:WriteVoxels(Region3.new(lo, hi), res, mats, occ)
			end
			if yieldFn then
				yieldFn()
			end
		end
	end
	return filled
end

return Terrain
