--!strict
-- Cloud Lab client: barebones drawing of the model's snapshot, a tabletop view (SCALE studs per
-- metre: 1 km = 100 studs). Everything drawn is a model field, nothing shaped:
--   ground tiles   surface temperature perturbation: white (none) to blue (-8 K, the cold pool)
--   cloud columns  each column's two lowest cloud runs (qc + 0.3 qr > 1e-4), grey boxes
--   rain shafts    surface rain, from the ground to the cloud base, more opaque as it's heavier,
--                  blue for rain, white for hail
--   rotation       red posts where the vorticity at the lowest level (50 m) exceeds 0.01 /s,
--                  height ~ vorticity; magenta where 1 km vorticity does
-- The camera is yours.

local CloudLabController = {}

function CloudLabController.Start()
	local ReplicatedStorage = game:GetService("ReplicatedStorage")
	local Players = game:GetService("Players")

	local Shared = ReplicatedStorage.Shared
	local CloudLabNet = require(Shared.Net.CloudLabNet)
	local Snapshot = require(Shared.CloudModel.Snapshot) :: any
	local remote = CloudLabNet.Snapshot:Client()
	local nestRemote = CloudLabNet.NestSnapshot:Client()
	local fineRemote = CloudLabNet.FineSnapshot:Client()

	local SCALE = 0.1 -- studs per metre
	local root = Instance.new("Folder")
	root.Name = "CloudLabView"
	root.Parent = workspace

	local function part(name: string, color: Color3, transparency: number): Part
		local p = Instance.new("Part")
		p.Name = name
		p.Anchored = true
		p.CanCollide = false
		p.CanQuery = false
		p.CanTouch = false
		p.CastShadow = false
		p.Material = Enum.Material.SmoothPlastic
		p.Color = color
		p.Transparency = transparency
		p.TopSurface = Enum.SurfaceType.Smooth
		p.BottomSurface = Enum.SurfaceType.Smooth
		return p
	end

	local tiles: { Part } = {}
	local clouds: { Part } = {}
	local rains: { Part } = {}
	local rots: { Part } = {}
	local built = 0

	local function build(nx: number, ny: number, dx: number)
		root:ClearAllChildren()
		table.clear(tiles)
		table.clear(clouds)
		table.clear(rains)
		table.clear(rots)
		local s = dx * SCALE
		for j = 1, ny do
			for i = 1, nx do
				local c = (j - 1) * nx + i
				local x, z = (i - 0.5 - nx / 2) * s, -(j - 0.5 - ny / 2) * s
				local t = part("Tile", Color3.new(0.85, 0.85, 0.8), 0)
				t.Size = Vector3.new(s, 1, s)
				t.Position = Vector3.new(x, -0.5, z)
				t.Parent = root
				tiles[c] = t
				for r = 1, 2 do
					local cl = part("Cloud", Color3.new(0.92, 0.92, 0.95), 1)
					cl.Size = Vector3.new(s, 1, s)
					cl.Position = Vector3.new(x, 0, z)
					cl.Parent = root
					clouds[2 * (c - 1) + r] = cl
				end
				local rn = part("Rain", Color3.fromRGB(70, 110, 200), 1)
				rn.Size = Vector3.new(s * 0.8, 1, s * 0.8)
				rn.Position = Vector3.new(x, 0, z)
				rn.Parent = root
				rains[c] = rn
				local rt = part("Rot", Color3.fromRGB(220, 40, 40), 1)
				rt.Size = Vector3.new(s * 0.4, 1, s * 0.4)
				rt.Position = Vector3.new(x, 0, z)
				rt.Parent = root
				rots[c] = rt
			end
		end
		built = nx
	end

	local gui = Instance.new("ScreenGui")
	gui.Name = "CloudLabHud"
	gui.ResetOnSpawn = false
	local label = Instance.new("TextLabel")
	label.Size = UDim2.fromOffset(640, 122)
	label.Position = UDim2.fromOffset(12, 12)
	label.BackgroundTransparency = 0.4
	label.BackgroundColor3 = Color3.new(0, 0, 0)
	label.TextColor3 = Color3.new(1, 1, 1)
	label.TextXAlignment = Enum.TextXAlignment.Left
	label.Font = Enum.Font.Code
	label.TextSize = 14
	label.Text = "Cloud Lab: waiting for the model..."
	label.Parent = gui
	-- (live mode has its own HUD, LiveView.client.luau)
	label.Visible = workspace:GetAttribute("CloudLabLive") ~= true
	gui.Parent = Players.LocalPlayer:WaitForChild("PlayerGui")

	-- The nests: each one's lowest cloud below 3 km (grey columns at the nest's spacing: wall cloud,
	-- lowerings, a funnel if one condenses) and red posts where its 50 m vorticity passes a threshold
	local parentNx, parentDx = 64, 1000
	local nestTexts: { [string]: string } = {}
	local function nestView(rem: any, name: string, color: Color3, rotAt: number, shrink: number)
		local folder = Instance.new("Folder")
		folder.Name = name
		folder.Parent = workspace
		local cloudParts: { Part } = {}
		local rotParts: { Part } = {}
		local builtN = 0
		rem:On(function(b: buffer)
			local nx, ny, dx, X0, Y0 = Snapshot.nestHeader(b)
			if builtN ~= nx * ny then
				folder:ClearAllChildren()
				table.clear(cloudParts)
				table.clear(rotParts)
				for c = 1, nx * ny do
					local cl = part(name .. "Cloud", color, 1)
					cl.Parent = folder
					cloudParts[c] = cl
					local rt = part(name .. "Rot", Color3.fromRGB(255, 30, 30), 1)
					rt.Parent = folder
					rotParts[c] = rt
				end
				builtN = nx * ny
			end
			local s = dx * SCALE
			local zmax, vmax, pmin, low = 0, 0, 0, math.huge
			for j = 1, ny do
				for i = 1, nx do
					local c = (j - 1) * nx + i
					local xm = X0 + (i - 0.5) * dx - 0.5 * parentNx * parentDx
					local ym = Y0 + (j - 0.5) * dx - 0.5 * parentNx * parentDx
					local x, z = xm * SCALE, -ym * SCALE
					local get = function(f: number): number
						return Snapshot.getNest(b, nx, i, j, f)
					end
					local zb, zt = get(1), get(2)
					local cl = cloudParts[c]
					if zt > zb then
						low = math.min(low, zb)
						cl.Transparency = 0.15
						cl.Size = Vector3.new(s * shrink, (zt - zb) * SCALE, s * shrink)
						cl.Position = Vector3.new(x, 0.5 * (zb + zt) * SCALE, z)
					else
						cl.Transparency = 1
					end
					local zv = get(3)
					zmax = math.max(zmax, zv)
					vmax = math.max(vmax, get(4))
					pmin = math.min(pmin, get(5))
					local rt = rotParts[c]
					if zv > rotAt then
						local h = 10000 * zv * SCALE
						rt.Transparency = 0
						rt.Size = Vector3.new(s * 0.5, h, s * 0.5)
						rt.Position = Vector3.new(x, 0.5 * h, z)
					else
						rt.Transparency = 1
					end
				end
			end
			nestTexts[name] = string.format("\n%s %.1f m: zeta 50 m %.3f /s  wind %.0f m/s  lowest cloud %s", name, dx, zmax, vmax, if low < math.huge then string.format("%.0f m", low) else "-")
		end)
	end
	nestView(nestRemote, "Nest", Color3.fromRGB(95, 100, 110), 0.02, 1)
	nestView(fineRemote, "Fine", Color3.fromRGB(60, 62, 70), 0.05, 0.96)

	remote:On(function(b: buffer)
		local nx, ny, dx, time, ox, oy, uh = Snapshot.header(b)
		parentNx, parentDx = nx, dx
		if built ~= nx then
			build(nx, ny, dx)
		end
		local s = dx * SCALE
		local wmax, rmax, poolMin, z0max, z1max = 0, 0, 0, 0, 0
		for j = 1, ny do
			for i = 1, nx do
				local c = (j - 1) * nx + i
				local x, z = (i - 0.5 - nx / 2) * s, -(j - 0.5 - ny / 2) * s
				local get = function(f: number): number
					return Snapshot.get(b, nx, i, j, f)
				end
				-- ground: the cold pool
				local dth = get(6)
				poolMin = math.min(poolMin, dth)
				local cold = math.clamp(-dth / 8, 0, 1)
				tiles[c].Color = Color3.new(0.85 - 0.6 * cold, 0.85 - 0.45 * cold, 0.8 + 0.15 * cold)
				-- cloud runs
				for r = 1, 2 do
					local zb, zt = get(2 * r - 1), get(2 * r)
					local cl = clouds[2 * (c - 1) + r]
					if zt > zb then
						cl.Transparency = 0.35
						cl.Size = Vector3.new(s, (zt - zb) * SCALE, s)
						cl.Position = Vector3.new(x, 0.5 * (zb + zt) * SCALE, z)
					else
						cl.Transparency = 1
					end
				end
				-- rain shaft to the cloud base (or 2 km)
				local rate = get(5)
				rmax = math.max(rmax, rate)
				local rn = rains[c]
				if rate > 1 then
					local top = get(1)
					if top <= 0 then
						top = 2000
					end
					rn.Transparency = 1 - math.clamp(0.15 + 0.6 * math.log10(rate) / 2.3, 0.15, 0.75)
					-- whiter where the ground precipitation is hail
					local hf = math.clamp(get(11) / rate, 0, 1)
					rn.Color = Color3.fromRGB(70, 110, 200):Lerp(Color3.fromRGB(235, 240, 250), hf)
					rn.Size = Vector3.new(s * 0.8, top * SCALE, s * 0.8)
					rn.Position = Vector3.new(x, 0.5 * top * SCALE, z)
				else
					rn.Transparency = 1
				end
				-- rotation
				local z0v, z1v = get(7), get(8)
				z0max = math.max(z0max, z0v)
				z1max = math.max(z1max, z1v)
				local rt = rots[c]
				if z0v > 0.01 then
					rt.Color = Color3.fromRGB(220, 40, 40)
					rt.Transparency = 0
					local h = 30000 * z0v * SCALE
					rt.Size = Vector3.new(s * 0.4, h, s * 0.4)
					rt.Position = Vector3.new(x, 0.5 * h, z)
				elseif z1v > 0.01 then
					rt.Color = Color3.fromRGB(200, 60, 200)
					rt.Transparency = 0.3
					local h = 30000 * z1v * SCALE
					rt.Size = Vector3.new(s * 0.3, h, s * 0.3)
					rt.Position = Vector3.new(x, 1000 * SCALE + 0.5 * h, z)
				else
					rt.Transparency = 1
				end
				wmax = math.max(wmax, get(9))
			end
		end
		local eng = workspace:GetAttribute("CloudLabEngine")
		label.Text = (if type(eng) == "string" then eng .. "\n" else "") .. string.format(
			"Cloud Lab  t %d min  (grid moved %d,%d km)\nw(5 km) %.0f m/s  rain %.0f mm/h  cold pool %.1f K  UH %.0f\nzeta 50 m %.3f /s   1 km %.3f /s",
			time // 60, ox * dx / 1000, oy * dx / 1000, wmax, rmax, poolMin, uh, z0max, z1max) .. (nestTexts.Nest or "") .. (nestTexts.Fine or "")
	end)
	-- (listening: the server sends the latest snapshot now)
	CloudLabNet.Ready:Client():Fire("snapshot")
end

return CloudLabController
