--!strict
-- Prints the mesh asset id of the first MeshPart in a downloaded model file (.rbxm): what
-- tools/upload-images.mjs records for an uploaded volume mesh.
--   lune run tools/mesh-id.luau <model.rbxm>
local fs = require("@lune/fs")
local process = require("@lune/process")
local roblox = require("@lune/roblox")

for _, root in roblox.deserializeModel(fs.readFile(process.args[1])) do
	for _, inst in { root, table.unpack(root:GetDescendants()) } do
		if inst:IsA("MeshPart") then
			local content = tostring((inst :: any).MeshContent)
			local id = string.match(content, "rbxassetid://(%d+)")
			if id then
				print(id)
				return
			end
		end
	end
end
error("no MeshPart with a mesh in the model")
