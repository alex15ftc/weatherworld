--!strict
-- The products on this client: asked of the game server (server/ProductFeed.luau) when a
-- screen needs one, kept by version, and asked for again only when the version changes.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local HttpService = game:GetService("HttpService")

local ProductClient = {}

local folder = ReplicatedStorage:WaitForChild("Products")
local getFunction = folder:WaitForChild("Get") :: RemoteFunction
local manifestFunction = folder:WaitForChild("Manifest") :: RemoteFunction
local changedEvent = folder:WaitForChild("Changed") :: RemoteEvent

local latest: { [string]: string } = {}
local held: { [string]: { version: string, data: any } } = {}
local listeners: { (id: string) -> () } = {}

local function tell(id: string)
	for _, listener in listeners do
		task.spawn(listener, id)
	end
end

-- version false: the product is gone (an old radar frame).
local function changed(versions: { [string]: string | boolean })
	for id, version in versions do
		if version == false then
			if latest[id] ~= nil or held[id] ~= nil then
				latest[id] = nil
				held[id] = nil
				tell(id)
			end
		elseif latest[id] ~= version then
			latest[id] = version :: string
			tell(id)
		end
	end
end

changedEvent.OnClientEvent:Connect(changed)
task.spawn(function()
	local ok, versions = pcall(manifestFunction.InvokeServer, manifestFunction)
	if ok and versions then
		changed(versions)
	end
end)

-- Called with a product's id whenever a newer version of it is out, or it is gone.
function ProductClient.onChanged(listener: (id: string) -> ())
	table.insert(listeners, listener)
end

-- The ids out now that start with a prefix ("radar.composite."), sorted.
function ProductClient.ids(prefix: string): { string }
	local out = {}
	for id in latest do
		if string.sub(id, 1, #prefix) == prefix then
			table.insert(out, id)
		end
	end
	table.sort(out)
	return out
end

-- The product, decoded (nil if the server has none). Yields while it is fetched.
function ProductClient.get(id: string): any
	local mine = held[id]
	if mine and mine.version == latest[id] then
		return mine.data
	end
	local ok, answer = pcall(getFunction.InvokeServer, getFunction, id, if mine then mine.version else nil)
	if not ok or not answer then
		return if mine then mine.data else nil
	end
	if answer.text then
		local decoded, data = pcall(HttpService.JSONDecode, HttpService, answer.text)
		if not decoded then
			warn(`[Products] {id}: could not read version {answer.version}`)
			return if mine then mine.data else nil
		end
		held[id] = { version = answer.version, data = data }
	elseif mine then
		mine.version = answer.version
	end
	latest[id] = latest[id] or answer.version
	return held[id] and held[id].data
end

-- Tells the server this product is still being looked at (a single radar's scan is kept
-- current only while someone looks), and gets any newer version.
function ProductClient.touch(id: string)
	local mine = held[id]
	local ok, answer = pcall(getFunction.InvokeServer, getFunction, id, if mine then mine.version else nil)
	if ok and answer and (not mine or answer.version ~= mine.version) then
		latest[id] = answer.version
		if answer.text then
			local decoded, data = pcall(HttpService.JSONDecode, HttpService, answer.text)
			if decoded then
				held[id] = { version = answer.version, data = data }
				tell(id)
			end
		end
	end
end

return ProductClient
