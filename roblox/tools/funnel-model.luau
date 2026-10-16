--!strict
-- Turns the model Roblox imported from Art/tornado/funnel-rig.fbx (scripts/blender/build_funnel_rig.py)
-- into the game's close-up tornado funnel: just the skinned MeshPart and its bones, named
-- TornadoFunnel, double-sided (seen from inside too; scripts cannot set that), anchored and out of
-- physics. Upload the result as a Model (tools/upload-images.mjs model); TornadoAssetService loads it.
--   lune run tools/funnel-model.luau <imported.rbxm> <out.rbxm>
local fs = require("@lune/fs")
local process = require("@lune/process")
local roblox = require("@lune/roblox")

local funnel: any
for _, root in roblox.deserializeModel(fs.readFile(process.args[1])) do
	for _, inst in { root, table.unpack(root:GetDescendants()) } do
		if inst:IsA("MeshPart") and not funnel then
			funnel = inst
		end
	end
end
assert(funnel, "no MeshPart in the model")

funnel.Parent = nil
funnel.Name = "TornadoFunnel"
funnel.DoubleSided = true
funnel.Anchored = true
funnel.CanCollide = false
funnel.CanQuery = false
funnel.CanTouch = false
funnel.CastShadow = false
funnel.Massless = true
for _, inst in funnel:GetDescendants() do
	if not inst:IsA("Bone") then
		inst:Destroy()
	end
end
fs.writeFile(process.args[2], roblox.serializeModel({ funnel }))
print(`TornadoFunnel: {#funnel:GetDescendants()} bones, size {funnel.Size}`)
