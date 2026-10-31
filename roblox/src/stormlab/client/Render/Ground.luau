--!nonstrict
-- The ground around the camera: plain farmland tiles (client-only) that follow the camera, so
-- the lab has ground anywhere in its ~240 km domain. The town's own ground (server, physical)
-- sits a little higher where it exists. Fields vary a little in colour (seeded per tile) like
-- Plains section-line farmland.
-- The tiles lie at the datum (their top 0.3 m below it, under the terrain's base sheet): the server's Terrain
-- (LabConfig.GROUND.relief) covers them out to its radius. A tile is at most 2048 studs (a Part's
-- largest size: bigger tiles were clamped and left gaps between them, 2026-10-29). Tile sizes
-- are metres, crossed to studs through Config (docs/stormlab/SCALE-RULES.md).
local Workspace = game:GetService("Workspace")

local Ground = {}

function Ground.new(ctx: any): any
	local C = ctx.Config
	local G = C.GROUND
	local Noise = ctx.Sim.Noise
	local folder = Instance.new("Folder")
	folder.Name = "Ground"
	folder.Parent = ctx.root
	-- (a Part is at most 2048 studs a side; the tiles reach past the part draw range)
	local tile = math.min(G.tile, C.metres(2048))
	local radius = math.max(G.radius, math.ceil(C.studs(C.LIMITS.partRange) / C.studs(tile)) + 1)
	local n = 2 * radius + 1
	local tiles = {}
	for _ = 1, n * n do
		local p = Instance.new("Part")
		p.Anchored, p.CanCollide, p.CanQuery, p.CanTouch = true, false, false, false
		p.CastShadow = false
		p.Size = Vector3.new(C.studs(tile), C.studs(2), C.studs(tile))
		p.Material = Enum.Material[G.material] or Enum.Material.Grass
		p.TopSurface = Enum.SurfaceType.Smooth
		p.Parent = folder
		table.insert(tiles, p)
	end
	local self = { lastI = nil, lastJ = nil }
	local parts, cfs = {}, {}
	function self:update(_dt: number)
		local cx, cy = ctx:simCamera()
		local ti, tj = math.floor(cx / tile + 0.5), math.floor(cy / tile + 0.5)
		local gc = C.groundCentre
		if ti == self.lastI and tj == self.lastJ and gc == self.lastC then
			return
		end
		self.lastI, self.lastJ, self.lastC = ti, tj, gc
		-- tiles wholly inside the terrain's area sink 2 m under it: the terrain is the ground there,
		-- and its base sheet (on a 1.1 m voxel grid) can't sit reliably 0.2 m above a tile, so the
		-- tiles showed through round the town (2026-10-29)
		local R = G.relief
		local inR = if gc and R and R.amp > 0 then R.radius - 0.75 * tile else -1
		table.clear(parts)
		table.clear(cfs)
		local k = 0
		for di = -radius, radius do
			for dj = -radius, radius do
				k += 1
				local p = tiles[k]
				local i, j = ti + di, tj + dj
				local h = Noise.hash(i, j, 1, 5)
				local base = G.colour
				local f = 0.85 + 0.25 * h
				local wheat = Noise.hash(i, j, 2, 5) > 0.7
				if wheat then
					p.Color = Color3.fromRGB(math.floor(150 * f), math.floor(136 * f), math.floor(86 * f))
				else
					p.Color = Color3.fromRGB(math.floor(base[1] * f), math.floor(base[2] * f), math.floor(base[3] * f))
				end
				table.insert(parts, p)
				local z = -1.3
				if inR > 0 then
					local fx = math.abs(i * tile - gc.x) + 0.5 * tile
					local fy = math.abs(j * tile - gc.y) + 0.5 * tile
					if fx * fx + fy * fy < inR * inR then
						z = -3.3
					end
				end
				table.insert(cfs, CFrame.new(C.toWorld(i * tile, j * tile, z)))
			end
		end
		Workspace:BulkMoveTo(parts, cfs, Enum.BulkMoveMode.FireCFrameChanged)
	end
	function self:destroy()
		folder:Destroy()
	end
	return self
end

return Ground
