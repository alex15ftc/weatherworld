--!nonstrict
-- The ground around the camera: plain farmland tiles (client-only) that follow the camera, so
-- the lab has ground anywhere in its ~240 km domain. The town's own ground (server, physical)
-- sits a little higher where it exists. Fields vary a little in colour (seeded per tile) like
-- Plains section-line farmland.
local Workspace = game:GetService("Workspace")

local Ground = {}

function Ground.new(ctx: any): any
	local C = ctx.Config
	local G = C.GROUND
	local Noise = ctx.Sim.Noise
	local folder = Instance.new("Folder")
	folder.Name = "Ground"
	folder.Parent = ctx.root
	local n = 2 * G.radius + 1
	local tiles = {}
	for _ = 1, n * n do
		local p = Instance.new("Part")
		p.Anchored, p.CanCollide, p.CanQuery, p.CanTouch = true, false, false, false
		p.CastShadow = false
		p.Size = Vector3.new(G.tile, 2, G.tile)
		p.Material = Enum.Material[G.material] or Enum.Material.Grass
		p.TopSurface = Enum.SurfaceType.Smooth
		p.Parent = folder
		table.insert(tiles, p)
	end
	local self = { lastI = nil, lastJ = nil }
	local parts, cfs = {}, {}
	function self:update(_dt: number)
		local cx, cy = ctx:simCamera()
		local ti, tj = math.floor(cx / G.tile + 0.5), math.floor(cy / G.tile + 0.5)
		if ti == self.lastI and tj == self.lastJ then
			return
		end
		self.lastI, self.lastJ = ti, tj
		table.clear(parts)
		table.clear(cfs)
		local k = 0
		for di = -G.radius, G.radius do
			for dj = -G.radius, G.radius do
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
				table.insert(cfs, CFrame.new(C.toWorld(i * G.tile, j * G.tile, -1.15)))
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
