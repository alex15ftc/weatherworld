--!strict
-- Brings the weather products in (outlooks, radar; warnings and the rest later) and hands them
-- to the players who open them (docs/ROBLOX-UI-PLAN.md). The weather server decides everything
-- in a product; the place only draws it.
--
-- Source (Workspace attribute ProductSource, else "http" when a feed URL is set, else "snapshot"):
--   http      polls GET /api/game/v1/manifest every PRODUCT_POLL_SECONDS and fetches each product
--             whose version changed (GET /api/game/v1/product/<id>); a product no longer listed
--             (an old radar frame) is let go. Same URL and key as the storm frames
--             (StormHostService).
--   snapshot  ServerStorage.WorldData.ProductSnapshot (scripts/export-product-snapshot.mjs).
--
-- A radar product (a site's tilt radar.site.<ID>.<product>.<T>, or a mosaic radar.mosaic.<kind>)
-- is fetched the first time a player asks for it, and kept up to date while some player has asked
-- for it in the last SITE_KEEP_SECONDS. An earlier scan of one (<id>.h<seconds>, for a loop) never
-- changes: it is fetched once and let go when no longer asked for.
--
-- The storm reports and damage surveys (reports.*, survey.*) are also handed to ReportArchive,
-- which keeps the finished days in a DataStore; a report product the weather server no longer
-- lists (an older day) is given from there, and the archive's index is the product
-- "reports.archive".
--
-- Shared/Net/ProductNet:
--   Get       request (id, haveVersion?) -> { version, text? } (text left out when the player
--             already has that version; nil for an unknown product)
--   Manifest  request () -> { [id]: version }
--   Changed   event fired to every player with { [id]: version | false } when products change
--             (false: gone)

local HttpService = game:GetService("HttpService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local ServerStorage = game:GetService("ServerStorage")
local Players = game:GetService("Players")

local Shared = ReplicatedStorage.Shared
local Config = require(Shared.World.Config)
local ProductNet = require(Shared.Net.ProductNet)
local ReportArchive = require(ServerStorage.Modules.ReportArchive)

local ProductFeedService = {}

type Product = { version: string, text: string }
local products: { [string]: Product } = {}
-- Products this place makes itself (the report archive's index).
local localProducts: { [string]: Product } = {}

local function isReport(id: string): boolean
	return string.match(id, "^reports%.") ~= nil or string.match(id, "^survey%.") ~= nil
end

local SITE_KEEP_SECONDS = 90
-- Radar and satellite products made only when asked for, and their loops' earlier scans; and the
-- lightning (only the radar layer shows it, and it keeps asking while it does), so a server whose
-- players have no radar on does not pull it every storm tick.
local function onDemand(id: string): boolean
	return id == "lightning"
		or string.match(id, "^radar%.site%.[%w]+%.[%w]+[%.%w]*$") ~= nil
		or string.match(id, "^radar%.mosaic%.[%w]+[%.%w]*$") ~= nil
		or string.match(id, "^radar%.rotation%.[%w]+$") ~= nil
		or string.match(id, "^satellite%.[%w]+[%.%w]*$") ~= nil
end
local function isFrame(id: string): boolean
	return onDemand(id) and string.match(id, "%.h%d+$") ~= nil
end
local siteAsked: { [string]: number } = {} -- site product id -> when a player last asked for it
local fetchOnDemand: ((id: string) -> ())? = nil -- set by the http source
local fetchDirect: ((id: string) -> Product?)? = nil -- a product straight from the weather server (http source)

-- The requests made for players (on-demand products, report days and surveys not held) share the
-- whole server's HTTP budget (500 a minute) with the manifest poll, the products it pulls and the
-- storm frames (StormHostService): they may spend at most ON_DEMAND_PER_MINUTE of it, in bursts of
-- ON_DEMAND_BURST, so a few players looping radars cannot starve the rest.
local ON_DEMAND_PER_MINUTE, ON_DEMAND_BURST = 180, 30
local httpTokens, httpTokensAt = ON_DEMAND_BURST, os.clock()
local function takeHttpToken(): boolean
	local now = os.clock()
	httpTokens = math.min(ON_DEMAND_BURST, httpTokens + (now - httpTokensAt) * ON_DEMAND_PER_MINUTE / 60)
	httpTokensAt = now
	if httpTokens < 1 then
		return false
	end
	httpTokens -= 1
	return true
end
-- A product the weather server did not give (not found, or an error) is not asked of it again
-- for MISS_SECONDS.
local MISS_SECONDS = 45
local missed: { [string]: number } = {}
local function recentlyMissed(id: string): boolean
	local at = missed[id]
	return at ~= nil and os.clock() - at < MISS_SECONDS
end
-- An earlier scan (<loop>.h<seconds>) is asked of the weather server only while the newest product
-- of its loop, held here, lists it (its `loop`: {"id":"<loop>.h<seconds>",...}).
local function frameListed(id: string): boolean
	local base = string.match(id, "^(.+)%.h%d+$")
	local held = if base then products[base] else nil
	return held ~= nil and string.find(held.text, `"id":"{id}"`, 1, true) ~= nil
end

local changedEvent = ProductNet.Changed:Server()

local function versions(): { [string]: string }
	local out = {}
	for id, product in products do
		out[id] = product.version
	end
	for id, product in localProducts do
		out[id] = product.version
	end
	return out
end

local function announce(changed: { [string]: string | boolean })
	if next(changed) then
		changedEvent:FireAll(changed)
	end
end

-- A player may ask for at most GET_BURST products in any GET_WINDOW seconds.
local GET_BURST, GET_WINDOW = 60, 10 -- (a radar loop is ten products)
-- Of those, at most HTTP_BURST may be products not held here (each one a request to the weather
-- server): a radar loop and a satellite loop started together are about twenty.
local HTTP_BURST = 24
local asked: { [Player]: { number } } = {}
local askedHttp: { [Player]: { number } } = {}

-- Whether a player may ask once more within `burst` in any GET_WINDOW seconds (and counts it).
local function withinRate(byPlayer: { [Player]: { number } }, player: Player, burst: number, now: number): boolean
	local times = byPlayer[player] or {}
	byPlayer[player] = times
	while times[1] and now - times[1] > GET_WINDOW do
		table.remove(times, 1)
	end
	if #times >= burst then
		return false
	end
	table.insert(times, now)
	return true
end

-- (id is a string of at most 80 characters and haveVersion a string or nil: ProductNet's validator)
local function getProduct(player: Player, id: string, haveVersion: string?): any
	local now = os.clock()
	if not withinRate(asked, player, GET_BURST, now) then
		return nil
	end
	local demand = onDemand(id)
	local holding = products[id] ~= nil or localProducts[id] ~= nil
	if demand and not holding and isFrame(id) and not frameListed(id) then
		return nil -- not a scan of a loop held here (or one let go)
	end
	if demand then
		siteAsked[id] = now
	end
	if not holding and (demand or isReport(id)) and fetchOnDemand then
		-- Costs a request to the weather server (a report day may still come from the archive).
		if (demand and recentlyMissed(id)) or not withinRate(askedHttp, player, HTTP_BURST, now) then
			return nil
		end
		if demand then
			(fetchOnDemand :: (string) -> ())(id)
		end
	end
	local product = products[id] or localProducts[id]
	if not product and isReport(id) then
		product = ReportArchive.get(id)
	end
	if not product then
		return nil
	end
	if haveVersion == product.version then
		return { version = product.version }
	end
	return { version = product.version, text = product.text }
end

local function getManifest(_player: Player)
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

	fetchDirect = function(id: string): Product?
		if not takeHttpToken() then
			return nil -- over the players' share of the HTTP budget: asked again later
		end
		local got, text, responseHeaders = get(`/api/game/v1/product/{id}`)
		if not got then
			return nil
		end
		return { version = versionOf(responseHeaders, HttpService:GenerateGUID(false)), text = text }
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
		if recentlyMissed(id) or not takeHttpToken() then
			return -- not found lately, or over the players' share of the HTTP budget: asked again later
		end
		fetching[id] = true
		local got, text, responseHeaders = get(`/api/game/v1/product/{id}`)
		if got then
			missed[id] = nil
			local version = versionOf(responseHeaders, HttpService:GenerateGUID(false))
			products[id] = { version = version, text = text }
			announce({ [id] = version })
			if isReport(id) then
				ReportArchive.offer(id, products[id])
			end
		else
			missed[id] = os.clock()
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
				local site = onDemand(id)
				local held = products[id]
				-- A site scan is kept current only while someone still asks for it.
				local wanted = not site or (siteAsked[id] ~= nil and now - siteAsked[id] < SITE_KEEP_SECONDS)
				if wanted and (not held or held.version ~= entry.version) and not fetching[id] then
					local got, text, responseHeaders = get(`/api/game/v1/product/{id}`)
					if got then
						local version = versionOf(responseHeaders, entry.version)
						products[id] = { version = version, text = text }
						changed[id] = version
						if isReport(id) then
							ReportArchive.offer(id, products[id])
						end
					else
						warn(`[ProductFeed] {id}: {text}`)
					end
				end
			end
			-- Let go what is no longer listed (old radar frames) or no longer asked for; a site
			-- scan still asked for but dropped from the list (no new scan for a while) is asked again.
			for id in products do
				local site = onDemand(id)
				local stillAsked = site and siteAsked[id] ~= nil and now - siteAsked[id] < SITE_KEEP_SECONDS
				if site and not stillAsked then
					products[id] = nil
					siteAsked[id] = nil
					changed[id] = false
				elseif listed[id] == nil and not fetching[id] then
					if stillAsked and isFrame(id) then
						-- an earlier scan is never listed and never changes: keep it as it is
					elseif stillAsked then
						if not recentlyMissed(id) then
							task.spawn(fetchOnDemand :: (string) -> (), id)
						end
					else
						products[id] = nil
						changed[id] = false
					end
				end
			end
			-- Asks that never got a product, and old misses, are let go.
			for id, at in siteAsked do
				if not products[id] and now - at >= SITE_KEEP_SECONDS then
					siteAsked[id] = nil
				end
			end
			for id, at in missed do
				if os.clock() - at >= MISS_SECONDS then
					missed[id] = nil
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
		if isReport(id) then
			ReportArchive.offer(id, products[id])
		end
	end
	table.sort(ids)
	print(`[ProductFeed] snapshot recorded {meta.recordedAt}: {#ids} products`)
	announce(changed)
end

function ProductFeedService.Init()
	ProductNet.Get:Server():OnInvoke(getProduct)
	ProductNet.Manifest:Server():OnInvoke(getManifest)
	Players.PlayerRemoving:Connect(function(player: Player)
		asked[player] = nil
		askedHttp[player] = nil
	end)
end

function ProductFeedService.Start()
	local source = workspace:GetAttribute("ProductSource")
	local url = (workspace:GetAttribute("WeatherFeedUrl") :: string?) or Config.WEATHER_FEED_URL
	local http = source == "http" or (source == nil and url ~= "")
	ReportArchive.start({
		-- A recorded snapshot is not a live world: its days are not kept.
		write = http,
		fetch = function(id: string): Product?
			return products[id] or (if fetchDirect then (fetchDirect :: (string) -> Product?)(id) else nil)
		end,
		publish = function(id: string, entry: Product)
			localProducts[id] = entry
			announce({ [id] = entry.version })
		end,
	})
	if http then
		task.spawn(runHttp, (string.gsub(url, "/+$", "")))
	else
		task.spawn(runSnapshot)
	end
end

return ProductFeedService
