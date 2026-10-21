--!strict
-- Brings the weather products in (outlooks, radar; warnings and the rest later) and hands them
-- to the players who open them (docs/ROBLOX-UI-PLAN.md). The weather server decides everything
-- in a product; the place only draws it.
--
-- Source (Workspace attribute ProductSource, else "http" when a feed URL is set, else "snapshot"):
--   http      polls GET /api/game/v1/manifest every PRODUCT_POLL_SECONDS and fetches each product
--             whose version changed (GET /api/game/v1/product/<id>); a product no longer listed
--             (an old radar frame) is let go. Same URL and key as the storm frames
--             (server/WeatherFeed.luau).
--   snapshot  ServerStorage.WorldData.ProductSnapshot (scripts/export-product-snapshot.mjs).
--
-- A single radar's scan (radar.site.<ID>.<product>) is fetched the first time a player asks for
-- it, and kept up to date while some player has asked for it in the last SITE_KEEP_SECONDS.
--
-- ReplicatedStorage.Products:
--   Get       RemoteFunction (id, haveVersion?) -> { version, text? } (text left out when the
--             player already has that version; nil for an unknown product)
--   Manifest  RemoteFunction () -> { [id]: version }
--   Changed   RemoteEvent fired to every player with { [id]: version | false } when products
--             change (false: gone)

local HttpService = game:GetService("HttpService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local ServerStorage = game:GetService("ServerStorage")
local Players = game:GetService("Players")

local Config = require(ReplicatedStorage.Shared.World.Config)

local ProductFeed = {}

type Product = { version: string, text: string }
local products: { [string]: Product } = {}

local SITE_KEEP_SECONDS = 90
local SITE_PATTERN = "^radar%.site%.[%w]+%.[%w]+$"
local siteAsked: { [string]: number } = {} -- site product id -> when a player last asked for it
local fetchOnDemand: ((id: string) -> ())? = nil -- set by the http source

local folder = Instance.new("Folder")
folder.Name = "Products"
local getFunction = Instance.new("RemoteFunction")
getFunction.Name = "Get"
getFunction.Parent = folder
local manifestFunction = Instance.new("RemoteFunction")
manifestFunction.Name = "Manifest"
manifestFunction.Parent = folder
local changedEvent = Instance.new("RemoteEvent")
changedEvent.Name = "Changed"
changedEvent.Parent = folder
folder.Parent = ReplicatedStorage

local function versions(): { [string]: string }
	local out = {}
	for id, product in products do
		out[id] = product.version
	end
	return out
end

local function announce(changed: { [string]: string | boolean })
	if next(changed) then
		changedEvent:FireAllClients(changed)
	end
end

-- A player may ask for at most GET_BURST products in any GET_WINDOW seconds.
local GET_BURST, GET_WINDOW = 30, 10
local asked: { [Player]: { number } } = {}
Players.PlayerRemoving:Connect(function(player: Player)
	asked[player] = nil
end)

getFunction.OnServerInvoke = function(player: Player, id: unknown, haveVersion: unknown): any
	if typeof(id) ~= "string" or #id > 80 then
		return nil
	end
	local now = os.clock()
	local times = asked[player] or {}
	asked[player] = times
	while times[1] and now - times[1] > GET_WINDOW do
		table.remove(times, 1)
	end
	if #times >= GET_BURST then
		return nil
	end
	table.insert(times, now)
	if string.match(id, SITE_PATTERN) then
		siteAsked[id] = now
		if not products[id] and fetchOnDemand then
			(fetchOnDemand :: (string) -> ())(id)
		end
	end
	local product = products[id]
	if not product then
		return nil
	end
	if haveVersion == product.version then
		return { version = product.version }
	end
	return { version = product.version, text = product.text }
end

manifestFunction.OnServerInvoke = function(_player: Player)
	return versions()
end

local function runHttp(url: string)
	local key: any = nil
	pcall(function()
		key = HttpService:GetSecret("weather_feed_key")
	end)
	local headers = if key then { ["x-api-key"] = key } else nil
	local function get(route: string): (boolean, string, { [string]: string }?)
		local ok, response = pcall(HttpService.RequestAsync, HttpService, { Url = url .. route, Method = "GET", Headers = headers })
		if ok and response.Success then
			return true, response.Body, response.Headers
		end
		return false, if ok then `HTTP {response.StatusCode}` else tostring(response), nil
	end
	local function versionOf(responseHeaders: { [string]: string }?, fallback: string): string
		for name, value in responseHeaders or {} do
			if string.lower(name) == "x-product-version" then
				return value
			end
		end
		return fallback
	end

	-- A site scan asked for before it is held: fetched once, the other askers waiting for it.
	local fetching: { [string]: boolean } = {}
	fetchOnDemand = function(id: string)
		if fetching[id] then
			local started = os.clock()
			while fetching[id] and os.clock() - started < 15 do
				task.wait(0.1)
			end
			return
		end
		fetching[id] = true
		local got, text, responseHeaders = get(`/api/game/v1/product/{id}`)
		if got then
			local version = versionOf(responseHeaders, HttpService:GenerateGUID(false))
			products[id] = { version = version, text = text }
			announce({ [id] = version })
		else
			warn(`[ProductFeed] {id}: {text}`)
		end
		fetching[id] = nil
	end

	print(`[ProductFeed] polling {url} every {Config.PRODUCT_POLL_SECONDS} s`)
	local failures = 0
	while true do
		local ok, body = get("/api/game/v1/manifest")
		local decoded, manifest = false, nil
		if ok then
			decoded, manifest = pcall(HttpService.JSONDecode, HttpService, body)
		end
		if decoded and manifest then
			failures = 0
			local now = os.clock()
			local changed: { [string]: string | boolean } = {}
			local listed = (manifest :: any).products
			for id, entry in listed do
				local site = string.match(id, SITE_PATTERN) ~= nil
				local held = products[id]
				-- A site scan is kept current only while someone still asks for it.
				local wanted = not site or (siteAsked[id] ~= nil and now - siteAsked[id] < SITE_KEEP_SECONDS)
				if wanted and (not held or held.version ~= entry.version) and not fetching[id] then
					local got, text, responseHeaders = get(`/api/game/v1/product/{id}`)
					if got then
						local version = versionOf(responseHeaders, entry.version)
						products[id] = { version = version, text = text }
						changed[id] = version
					else
						warn(`[ProductFeed] {id}: {text}`)
					end
				end
			end
			-- Let go what is no longer listed (old radar frames) or no longer asked for; a site
			-- scan still asked for but dropped from the list (no new scan for a while) is asked again.
			for id in products do
				local site = string.match(id, SITE_PATTERN) ~= nil
				local stillAsked = site and siteAsked[id] ~= nil and now - siteAsked[id] < SITE_KEEP_SECONDS
				if site and not stillAsked then
					products[id] = nil
					siteAsked[id] = nil
					changed[id] = false
				elseif listed[id] == nil and not fetching[id] then
					if stillAsked then
						task.spawn(fetchOnDemand :: (string) -> (), id)
					else
						products[id] = nil
						changed[id] = false
					end
				end
			end
			announce(changed)
			task.wait(Config.PRODUCT_POLL_SECONDS)
		else
			failures += 1
			if failures == 1 or failures % 10 == 0 then
				warn(`[ProductFeed] {url}: {if ok then "bad manifest" else body} ({failures} failures)`)
			end
			task.wait(math.min(60, Config.PRODUCT_POLL_SECONDS * 2 ^ math.min(failures, 3)))
		end
	end
end

local function runSnapshot()
	local data = ServerStorage:FindFirstChild("WorldData")
	local snapshot = data and data:FindFirstChild("ProductSnapshot")
	if not snapshot then
		warn("[ProductFeed] no snapshot: run `node scripts/export-product-snapshot.mjs`, or set WeatherFeedUrl")
		return
	end
	local meta = require(snapshot:WaitForChild("Meta") :: ModuleScript) :: any
	local changed, ids = {}, {}
	for id, entry in meta.products do
		local parts = require(snapshot:WaitForChild(entry.module) :: ModuleScript) :: any
		products[id] = { version = entry.version, text = table.concat(parts) }
		changed[id] = entry.version
		table.insert(ids, id)
	end
	table.sort(ids)
	print(`[ProductFeed] snapshot recorded {meta.recordedAt}: {#ids} products`)
	announce(changed)
end

function ProductFeed.start()
	local source = workspace:GetAttribute("ProductSource")
	local url = (workspace:GetAttribute("WeatherFeedUrl") :: string?) or Config.WEATHER_FEED_URL
	if source == "http" or (source == nil and url ~= "") then
		task.spawn(runHttp, (string.gsub(url, "/+$", "")))
	else
		task.spawn(runSnapshot)
	end
end

return ProductFeed
