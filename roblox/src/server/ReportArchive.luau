--!strict
-- The storm reports and damage surveys, kept in a DataStore (docs/ROBLOX-UI-PLAN.md, step 6).
-- The weather server works them out and holds the last two weeks of days; the place keeps every
-- finished day it is sent for Config.REPORT_ARCHIVE_DAYS days of the world's clock, and gives
-- them to players from here, so the history outlives the weather server's log, its restarts
-- and its downtime.
--
-- What is kept is the weather server's own product text, unchanged (server/GameProducts.js):
--   <world>/days     the index: { world, days = { ["<N>"] = { day, startHourUtc, version,
--                    tornadoes, reports = { tornado, hail, wind }, surveys = { [tornado id] = version } } } }
--   <world>/d/<N>    { v = version, t = text } of reports.day.<N>, once the day is final
--   <world>/s/<id>   { v = version, t = text } of survey.<id>, once the tornado has lifted
-- <world> is the storm log's worldId: a new world numbers its days from 1 again.
--
-- One game server at a time writes (a MemoryStore lease); the writes are the same text on every
-- server, so a second writer while the lease changes hands does no harm. Any server reads.
-- The players get the index as the product "reports.archive" (server/ProductFeed.luau).

local DataStoreService = game:GetService("DataStoreService")
local MemoryStoreService = game:GetService("MemoryStoreService")
local HttpService = game:GetService("HttpService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage.Shared.World.Config)

local ReportArchive = {}

export type Entry = { version: string, text: string }
type DayRecord = {
	day: number,
	startHourUtc: number,
	version: string,
	tornadoes: number,
	reports: { tornado: number, hail: number, wind: number },
	surveys: { [string]: string },
}
type Index = { world: string, days: { [string]: DayRecord } }

local LEASE_SECONDS = 90 -- the writer renews every LEASE_SECONDS / 3
local INDEX_RELOAD_SECONDS = 300 -- the servers that do not write learn of new days this often
local CACHE_SIZE = 96 -- products read back, kept in memory

local store: DataStore? = nil
local leases: MemoryStoreHashMap? = nil
local canWrite = false
local isWriter = false
-- Set by ProductFeed: a product as the weather server gives it now (nil when it has none), and
-- the way to tell the players a product changed.
local fetch: ((id: string) -> Entry?)? = nil
local publish: ((id: string, entry: Entry) -> ())? = nil

local world: string? = nil
local index: Index? = nil
local archiveProduct: Entry? = nil
local cache: { [string]: Entry } = {}
local cacheOrder: { string } = {}
local queue: { () -> () } = {}
local queued: { [string]: boolean } = {}
local working = false
local warned: { [string]: boolean } = {}
local lastDays: any = nil -- the last reports.days, for catching up when this server starts writing

local function warnOnce(what: string, message: string)
	if not warned[what] then
		warned[what] = true
		warn(`[ReportArchive] {message}`)
	end
end

-- FNV-1a of a text, as a short version string.
local function hashOf(text: string): string
	local h = 2166136261
	for k = 1, #text do
		h = bit32.bxor(h, string.byte(text, k))
		h = (h * 16777619) % 4294967296
	end
	return string.format("%08x", h)
end

local function keyOf(id: string): string?
	if not world then
		return nil
	end
	local day = string.match(id, "^reports%.day%.(%d+)$")
	if day then
		return `{world}/d/{day}`
	end
	local tornado = string.match(id, "^survey%.(.+)$")
	if tornado and tornado ~= "indicators" then
		return `{world}/s/{tornado}`
	end
	return nil
end

local function remember(id: string, entry: Entry)
	if not cache[id] then
		table.insert(cacheOrder, id)
		if #cacheOrder > CACHE_SIZE then
			cache[table.remove(cacheOrder, 1) :: string] = nil
		end
	end
	cache[id] = entry
end

-- A DataStore call, waiting for the request budget and trying again on failure.
local function call<T>(kind: Enum.DataStoreRequestType, fn: () -> T): (boolean, T?)
	for attempt = 1, 3 do
		while DataStoreService:GetRequestBudgetForRequestType(kind) < 1 do
			task.wait(1)
		end
		local ok, result = pcall(fn)
		if ok then
			return true, result
		end
		warnOnce(`call{attempt}{tostring(kind)}`, `{tostring(kind)}: {result}`)
		task.wait(2 ^ attempt)
	end
	return false, nil
end

-- The writes, one at a time, so a busy day does not spend the request budget all at once.
local function enqueue(key: string, job: () -> ())
	if queued[key] then
		return
	end
	queued[key] = true
	table.insert(queue, function()
		queued[key] = nil
		job()
	end)
	if working then
		return
	end
	working = true
	task.spawn(function()
		while #queue > 0 do
			local nextJob = table.remove(queue, 1) :: () -> ()
			local ok, problem = pcall(nextJob)
			if not ok then
				warn(`[ReportArchive] {problem}`)
			end
		end
		working = false
	end)
end

-- The index as the players get it: the kept days, newest first.
local function publishIndex()
	local current = index
	if not current then
		return
	end
	local days = {}
	for _, record in current.days do
		table.insert(days, { day = record.day, startHourUtc = record.startHourUtc, tornadoes = record.tornadoes, reports = record.reports })
	end
	table.sort(days, function(a, b)
		return a.day > b.day
	end)
	local text = HttpService:JSONEncode({ v = 1, id = "reports.archive", kind = "report-archive", world = current.world, keepDays = Config.REPORT_ARCHIVE_DAYS, days = days })
	local entry = { version = hashOf(text), text = text }
	if archiveProduct and archiveProduct.version == entry.version then
		return
	end
	archiveProduct = entry
	if publish then
		(publish :: (string, Entry) -> ())("reports.archive", entry)
	end
end

local function loadIndex()
	local w = world
	if not w then
		return
	end
	local found: any = nil
	if store then
		local ds = store :: DataStore
		local ok, value = call(Enum.DataStoreRequestType.GetAsync, function()
			return ds:GetAsync(`{w}/days`)
		end)
		if not ok then
			return
		end
		found = value
	end
	if world ~= w then
		return -- the world changed while this was read
	end
	index = if type(found) == "table" and type(found.days) == "table" then found :: Index else { world = w, days = {} }
	publishIndex()
end

local function storeEntry(id: string, entry: Entry): boolean
	local key = keyOf(id)
	local ds = store
	if not key or not ds then
		return false
	end
	local ok = call(Enum.DataStoreRequestType.UpdateAsync, function()
		return (ds :: DataStore):UpdateAsync(key, function(old: any)
			if type(old) == "table" and old.v == entry.version then
				return nil -- already kept
			end
			return { v = entry.version, t = entry.text }
		end)
	end)
	return ok
end

-- A finished day: its surveys first, then the day, then the index (which also lets go of the
-- days older than REPORT_ARCHIVE_DAYS).
local function archiveDay(id: string, entry: Entry, product: any)
	local current = index
	local ds = store
	if not current or not ds or current.world ~= product.world then
		return
	end
	local record = current.days[tostring(product.day)]
	if record and record.version == entry.version then
		return
	end
	local surveys: { [string]: string } = {}
	for _, tornado in product.tornadoes do
		local surveyId = `survey.{tornado.id}`
		local known = record and record.surveys[tornado.id]
		local got = if fetch then (fetch :: (string) -> Entry?)(surveyId) else nil
		if got then
			if got.version ~= known and not storeEntry(surveyId, got) then
				return -- tried again with the next offer of the day
			end
			surveys[tornado.id] = got.version
		elseif known then
			surveys[tornado.id] = known
		else
			warnOnce(`survey{tornado.id}`, `{surveyId}: not available; day {product.day} kept later`)
			return
		end
	end
	if not storeEntry(id, entry) then
		return
	end
	local counts: any = { tornado = 0, hail = 0, wind = 0 }
	for _, report in product.reports do
		counts[report.type] = (counts[report.type] or 0) + 1
	end
	local newRecord: DayRecord = { day = product.day, startHourUtc = product.startHourUtc, version = entry.version, tornadoes = #product.tornadoes, reports = counts, surveys = surveys }
	local dropped: { DayRecord } = {}
	local w = current.world
	local ok, saved = call(Enum.DataStoreRequestType.UpdateAsync, function()
		return ds:UpdateAsync(`{w}/days`, function(old: any)
			local kept: Index = if type(old) == "table" and type(old.days) == "table" then old else { world = w, days = {} }
			kept.days[tostring(newRecord.day)] = newRecord
			table.clear(dropped)
			local newest = 0
			for _, r in kept.days do
				newest = math.max(newest, r.day)
			end
			for key, r in kept.days do
				if r.day <= newest - Config.REPORT_ARCHIVE_DAYS then
					table.insert(dropped, r)
					kept.days[key] = nil
				end
			end
			return kept
		end)
	end)
	if not ok or world ~= w then
		return
	end
	index = saved :: Index
	publishIndex()
	print(`[ReportArchive] kept day {newRecord.day}: {#product.reports} reports, {newRecord.tornadoes} surveys`)
	-- The days now too old to keep.
	for _, r in dropped do
		for tornadoId in r.surveys do
			call(Enum.DataStoreRequestType.SetIncrementAsync, function()
				return ds:RemoveAsync(`{w}/s/{tornadoId}`)
			end)
		end
		call(Enum.DataStoreRequestType.SetIncrementAsync, function()
			return ds:RemoveAsync(`{w}/d/{r.day}`)
		end)
	end
end

-- The weather server's days not kept yet (the place was down, or no server was up, when they
-- ended): asked for while it still holds them.
local function catchUp(product: any)
	local current = index
	if not current or current.world ~= product.world or not fetch then
		return
	end
	for _, d in product.days do
		if d.day < product.currentDay and not current.days[tostring(d.day)] then
			local id = `reports.day.{d.day}`
			enqueue(id, function()
				local got = (fetch :: (string) -> Entry?)(id)
				if not got then
					return
				end
				local decoded, day = pcall(HttpService.JSONDecode, HttpService, got.text)
				if decoded and day.final then
					archiveDay(id, got, day)
				end
			end)
		end
	end
end

local function setWorld(w: string?)
	if w == world then
		return
	end
	world = w
	index = nil
	table.clear(cache)
	table.clear(cacheOrder)
	if w then
		task.spawn(loadIndex)
	end
end

-- A report product as the weather server sent it (from ProductFeed, whenever it gets one).
function ReportArchive.offer(id: string, entry: Entry)
	local decoded, product = pcall(HttpService.JSONDecode, HttpService, entry.text)
	if not decoded or type(product) ~= "table" then
		return
	end
	if product.kind == "report-days" then
		lastDays = product
		setWorld(product.world)
		if canWrite and isWriter then
			task.spawn(function()
				while world == product.world and not index do
					task.wait(1)
				end
				catchUp(product)
			end)
		end
	elseif product.kind == "report-day" and product.final and canWrite and isWriter and product.world == world then
		enqueue(id, function()
			archiveDay(id, entry, product)
		end)
	end
end

-- A report product no longer in the weather server's manifest (an older day), or one it has
-- dropped: from the archive, else from the weather server while it still holds it. Yields.
function ReportArchive.get(id: string): Entry?
	if id == "reports.archive" then
		return archiveProduct
	end
	local held = cache[id]
	if held then
		return held
	end
	local key = keyOf(id)
	local ds = store
	if key and ds then
		local ok, value: any = call(Enum.DataStoreRequestType.GetAsync, function()
			return ds:GetAsync(key)
		end)
		if ok and type(value) == "table" and type(value.t) == "string" then
			local entry = { version = value.v, text = value.t }
			remember(id, entry)
			return entry
		end
	end
	local got = if fetch then (fetch :: (string) -> Entry?)(id) else nil
	if got then
		remember(id, got)
	end
	return got
end

-- options.write: whether this place may write (not from a recorded snapshot); fetch and publish
-- as above.
function ReportArchive.start(options: { write: boolean, fetch: (id: string) -> Entry?, publish: (id: string, entry: Entry) -> () })
	fetch = options.fetch
	publish = options.publish
	local ok, result = pcall(DataStoreService.GetDataStore, DataStoreService, Config.REPORT_ARCHIVE_STORE)
	if ok then
		store = result
	else
		warnOnce("store", `no DataStore ({result}); old report days come from the weather server only. In Studio: Game Settings > Security > Enable Studio Access to API Services`)
	end
	canWrite = options.write and store ~= nil
	if not canWrite then
		return
	end
	local leaseOk, map = pcall(MemoryStoreService.GetHashMap, MemoryStoreService, "ReportArchive")
	if leaseOk then
		leases = map
	end
	-- The writer's lease: kept while this server renews it; taken when it lapses.
	task.spawn(function()
		while true do
			local held = false
			local lease = leases
			if lease then
				local got, holder = pcall(function()
					return (lease :: MemoryStoreHashMap):UpdateAsync("writer", function(old: any)
						if old == nil or old == game.JobId then
							return game.JobId
						end
						return nil
					end, LEASE_SECONDS)
				end)
				-- Without a MemoryStore (or when it fails) this server writes: the writes are idempotent.
				held = if got then holder == game.JobId else true
			else
				held = true
			end
			local became = held and not isWriter
			isWriter = held
			if became then
				print("[ReportArchive] this server keeps the report days")
				if lastDays and index then
					catchUp(lastDays)
				end
			end
			task.wait(LEASE_SECONDS / 3)
		end
	end)
	task.spawn(function()
		while true do
			task.wait(INDEX_RELOAD_SECONDS)
			loadIndex()
		end
	end)
end

return ReportArchive
