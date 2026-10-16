--!strict
-- Turns the model Roblox imported from Art/tornado/funnel-rig.fbx (scripts/blender/build_funnel_rig.py)
-- into the game's close-up tornado funnel: just the skinned MeshPart and its bones, named
-- TornadoFunnel, double-sided (seen from inside too; scripts cannot set that), anchored and out of
-- physics. With the build folder (after tools/upload-images.mjs upload), it also gets its
-- edge-boil frames (scripts/pack-funnel-boil.py) as SurfaceAppearances, which scripts cannot
-- make: Boil/<shell>/fNNN, AlphaMode Transparency; Boil has the attributes Frames and Seconds
-- (of the funnel's clock one loop covers). TornadoMesh swaps them onto the part.
-- Upload the result as a Model (tools/upload-images.mjs model); TornadoAssetService loads it.
--   lune run tools/funnel-model.luau <imported.rbxm> <out.rbxm> [<build dir>]
local fs = require("@lune/fs")
local process = require("@lune/process")
local roblox = require("@lune/roblox")
local serde = require("@lune/serde")
local Instance = roblox.Instance

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
local build = process.args[3]
if build then
	local manifest = serde.decode("json", fs.readFile(`{build}/manifest.json`))
	local ids = serde.decode("json", fs.readFile(`{build}/ids.json`))
	local boil = manifest.boil
	assert(boil, "no boil frames in the manifest (scripts/pack-funnel-boil.py)")
	local folder = Instance.new("Folder")
	folder.Name = "Boil"
	folder:SetAttribute("Frames", boil.frames)
	folder:SetAttribute("Seconds", boil.seconds)
	for shell, files in boil.shells do
		local frames = Instance.new("Folder")
		frames.Name = shell
		for k, file in files do
			local id = ids[file]
			assert(id, `{file} is not uploaded`)
			local appearance: any = Instance.new("SurfaceAppearance")
			appearance.Name = string.format("f%03d", k - 1)
			-- ColorMapContent: the old ColorMap is not saved.
			appearance.ColorMapContent = roblox.Content.fromUri(`rbxassetid://{id}`)
			appearance.AlphaMode = roblox.Enum.AlphaMode.Transparency
			appearance.Parent = frames
		end
		frames.Parent = folder
	end
	folder.Parent = funnel
end

fs.writeFile(process.args[2], roblox.serializeModel({ funnel }))
print(`TornadoFunnel: {#funnel:GetDescendants()} instances, size {funnel.Size}`)
