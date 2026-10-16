--!strict
-- Loads the uploaded storm models (Shared/Weather/Meshes) into ReplicatedStorage.Assets, where
-- the clients find them: Rojo cannot sync a MeshPart's mesh, so they come in as assets.
-- InsertService only loads models the place's owner (or Roblox) owns; uploads go to the owner of
-- the Open Cloud key, so upload with the owner's key. Until a model loads, the clients draw the
-- tornado without it.

local InsertService = game:GetService("InsertService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Meshes = require(ReplicatedStorage.Shared.Weather.Meshes)

local TornadoAssetService = {}

local function load(name: string, assetId: number)
	for attempt = 1, 3 do
		local ok, result = pcall(InsertService.LoadAsset, InsertService, assetId)
		if ok then
			local found = (result :: Instance):FindFirstChild(name, true)
			if found then
				found.Parent = ReplicatedStorage:WaitForChild("Assets")
				result:Destroy()
				return
			end
			warn(`[TornadoAssetService] model {assetId} has no {name}`)
			result:Destroy()
			return
		end
		warn(`[TornadoAssetService] loading {name} ({assetId}), try {attempt}: {result}`)
		task.wait(2 * attempt)
	end
end

function TornadoAssetService.Init() end

function TornadoAssetService.Start()
	load("TornadoFunnel", Meshes.funnel)
end

return TornadoAssetService
