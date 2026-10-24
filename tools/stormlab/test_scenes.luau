-- Each visual test scene's tornado, from the physics (tools for tuning shared/VisualTests).
--   luau --codegen tools/stormlab/test_scenes.luau
local Json = require("../../roblox/src/stormlab/shared/Sim/Json")
local World = require("../../roblox/src/stormlab/shared/Sim/World")
local Vortex = require("../../roblox/src/stormlab/shared/Sim/Vortex")
local VisualTests = require("../../roblox/src/stormlab/shared/VisualTests")
local data = Json.decode(require("../../roblox/src/stormlab/data/Supercell"))
local world = World.new(data)
for _, scene in VisualTests.SCENES do
	local t0 = os.clock()
	local t = world:labScene(scene, VisualTests.SITE)
	if not t then print(scene.id, "no tornado") continue end
	local cond = {}
	for _, z in { 5, 100, 300, 600 } do table.insert(cond, string.format("%d:%.0f", z, Vortex.condensationRadius(t, z))) end
	local p = Vortex.params(t)
	local rain = 0
	for a = 0, 11 do for _, r in { 300, 800, 1500, 2500 } do rain = math.max(rain, world.precip.rainRate:sample(t.x + r * math.cos(a * 0.52), t.y + r * math.sin(a * 0.52))) end end
	print(string.format("%-14s %-22s vc %4.1f rc %4.0f S %.2f subs %.1f base %4.0f tilt %4.0f wave %3.0f decay %.2f O %.2f ef %d | cond %s | rain %.0f mm/h  (%.1fs)",
		scene.id, t.stage, t.vc, t.rc, t.swirl, p.subCount, t.cloudBase, math.sqrt(t.topX ^ 2 + t.topY ^ 2), t.wave, t.decay, t.O, t.ef, table.concat(cond, " "), rain, os.clock() - t0))
end
-- the profile family each scene's tornado draws as (StateAdapter's scale R + ProfileLibrary.weights)
local Profiles = require("../../roblox/src/stormlab/client/Tornado/ProfileLibrary")
print("\nprofile weights per scene:")
for _, scene in VisualTests.SCENES do
	local t = world:labScene(scene, VisualTests.SITE)
	if t then
		local p = Vortex.params(t)
		local H = math.max(100, t.cloudBase)
		local sum = 0
		for _, hf in { 0.15, 0.3, 0.45, 0.6, 0.75 } do
			local z = H * hf
			local rcz = Vortex.rcAt(p, z)
			sum += math.max(math.min(Vortex.condensationRadius(t, z), 3 * rcz), 1.15 * rcz)
		end
		local R = sum / 5
		local w = Profiles.weights(t, R)
		print(string.format("%-14s R %4.0f  rope %.2f cone %.2f stovepipe %.2f wedge %.2f", scene.id, R, w.rope, w.cone, w.stovepipe, w.wedge))
	end
end
