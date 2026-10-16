--!strict
-- The storm-volume shell meshes (Shared/Weather/Textures volumes, uploaded from
-- scripts/bake-volume-meshes.mjs) made into MeshParts once, here on the server, and put in
-- ReplicatedStorage.StormMeshes for every client's Volumes module to copy. This is the route that
-- needs no EditableMesh (which a place may not be allowed, or have the budget for). The folder's
-- Ready attribute is true once every mesh has been tried.

local AssetService = game:GetService("AssetService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Textures = require(ReplicatedStorage.Shared.Weather.Textures)

local StormMeshService = {}

local folder: Folder

function StormMeshService.Init()
	folder = Instance.new("Folder")
	folder.Name = "StormMeshes"
	folder:SetAttribute("Ready", false)
	folder.Parent = ReplicatedStorage
end

function StormMeshService.Start()
	local made, failed = 0, 0
	for kind, variants in Textures.volumes do
		for variant, shells in variants do
			for shell, id in shells do
				if id == "" then
					continue
				end
				local ok, part = pcall(function()
					return AssetService:CreateMeshPartAsync(Content.fromUri(id), { CollisionFidelity = Enum.CollisionFidelity.Box })
				end)
				if ok and part then
					part.Name = `{kind}-{variant}-{shell}`
					part.Anchored, part.CanCollide, part.CanQuery, part.CanTouch, part.CastShadow = true, false, false, false, false
					part.Parent = folder
					made += 1
				else
					failed += 1
					warn(`[StormMeshService] could not load {kind}-{variant}-{shell} ({id}): {part}`)
				end
			end
		end
	end
	folder:SetAttribute("Ready", true)
	print(`[StormMeshService] {made} storm volume meshes ready{if failed > 0 then `, {failed} failed` else ""}`)
end

return StormMeshService
