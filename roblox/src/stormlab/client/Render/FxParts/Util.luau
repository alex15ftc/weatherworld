--!nonstrict
-- Helpers shared by the atmosphere-effect renderers (Render/NearPrecip, Render/Lightning,
-- Render/Sky). Not a renderer itself: init.client.luau only starts ModuleScripts directly in
-- Render/, and this lives in Render/FxParts/.
local Lighting = game:GetService("Lighting")

local Util = {}

-- Roblox's Atmosphere fog (measured in Studio 2026-10-22, roblox/src/client/SkyLight.luau): an
-- object x studs away keeps exp(-k x) of its contrast with k = FOG_A * Density ^ FOG_POWER per
-- stud (fits Density 0.1-0.3 within ~10%). Visibility (2% contrast) = 3.912 / k.
Util.FOG_A = 0.188
Util.FOG_POWER = 4.15

function Util.densityForExtinction(k: number): number
	if k <= 0 then
		return 0
	end
	return (k / Util.FOG_A) ^ (1 / Util.FOG_POWER)
end

function Util.extinctionForDensity(d: number): number
	if d <= 0 then
		return 0
	end
	return Util.FOG_A * d ^ Util.FOG_POWER
end

function Util.ramp(x: number, a: number, b: number): number
	return math.clamp((x - a) / (b - a), 0, 1)
end

-- exponential approach: the share of the gap closed in dt for an e-folding time tau
function Util.ease(dt: number, tau: number): number
	return 1 - math.exp(-dt / math.max(1e-3, tau))
end

function Util.scale(c: Color3, k: number): Color3
	return Color3.new(math.clamp(c.R * k, 0, 1), math.clamp(c.G * k, 0, 1), math.clamp(c.B * k, 0, 1))
end

-- an anchored, non-physical, non-queryable part
function Util.part(props: { [string]: any }?): Part
	local p = Instance.new("Part")
	p.Anchored = true
	p.CanCollide = false
	p.CanQuery = false
	p.CanTouch = false
	p.CastShadow = false
	p.Locked = true
	p.TopSurface = Enum.SurfaceType.Smooth
	p.BottomSurface = Enum.SurfaceType.Smooth
	p.Material = Enum.Material.SmoothPlastic
	if props then
		for k, v in props do
			(p :: any)[k] = v
		end
	end
	return p
end

-- Lighting's Atmosphere (found or created; Render/Sky is its only writer)
function Util.atmosphere(): Atmosphere
	local a = Lighting:FindFirstChildOfClass("Atmosphere")
	if not a then
		a = Instance.new("Atmosphere")
		a.Name = "Atmosphere"
		a.Parent = Lighting
	end
	return a :: Atmosphere
end

-- a ColorCorrectionEffect of our own (each renderer owns one by name, so they never fight)
function Util.colorEffect(name: string): ColorCorrectionEffect
	local e = Lighting:FindFirstChild(name)
	if not (e and e:IsA("ColorCorrectionEffect")) then
		e = Instance.new("ColorCorrectionEffect")
		e.Name = name
		e.Parent = Lighting
	end
	return e :: ColorCorrectionEffect
end

-- a ray from the camera straight down to the drawn ground (ignoring the lab's visuals); the sim
-- ground (z = 0) when nothing is hit
local rayParams: RaycastParams? = nil
function Util.groundY(root: Instance, from: Vector3): number
	if not rayParams then
		local rp = RaycastParams.new()
		rp.FilterType = Enum.RaycastFilterType.Exclude
		rp.IgnoreWater = false
		rayParams = rp
	end
	local rp = rayParams :: RaycastParams
	rp.FilterDescendantsInstances = { root }
	local hit = workspace:Raycast(from + Vector3.new(0, 5, 0), Vector3.new(0, -4000, 0), rp)
	if hit then
		return hit.Position.Y
	end
	return 0
end

return Util
