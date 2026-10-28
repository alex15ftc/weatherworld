--!nonstrict
-- The client's mirror of the authoritative atmosphere: built from the same engine scenario data
-- (the environment's columns) plus the server's snapshots (storms, systems, tornadoes, the cold
-- pool and precipitation volume), so the client evaluates exactly the same wind field
-- (World.windAt) for radar, dust, debris and rain without simulating anything itself.
local function dep(name: string): any
	if script then
		return require((script :: any).Parent:FindFirstChild(name))
	end
	return (require :: any)("./" .. name)
end
local World = dep("World")
local Environment = dep("Environment")
local ColdPool = dep("ColdPool")
local Precip = dep("Precip")
local Vortex = dep("Vortex")
local Storm = dep("Storm")

local ClientWorld = {}

function ClientWorld.new(data: any): any
	local env = Environment.new(data)
	local cw = setmetatable({
		data = data,
		meta = data.meta,
		env = env,
		coldPool = ColdPool.new(env),
		storms = {},
		profiles = {},
		systems = { vortices = {}, systems = {}, fronts = {} },
		systemsSnap = { systems = {}, vortices = {}, fronts = {} },
		tornadoes = {},
		boundaries = {},
		vol = nil,
		time = 0,
		clockUtc = data.meta.simHourUtc,
		isClient = true,
	}, { __index = World })
	env.coldPool = cw.coldPool
	cw.vol = Precip.unpack(buffer.create(4), env.extent)
	return cw
end

-- the world snapshot (World.snapshot) ~2 Hz
function ClientWorld.applySnapshot(cw: any, snap: any)
	cw.time = snap.time
	cw.clockUtc = snap.clockUtc
	cw.env.clockUtc = snap.clockUtc
	local storms = {}
	for _, s in snap.storms do
		-- the vertical profile arrives separately and only when it changes
		local prof = cw.profiles[s.id]
		if prof then
			s.wprof, s.tiltX, s.tiltY = prof.wprof, prof.tiltX, prof.tiltY
		end
		if s.wprof then
			Storm.prepare(s)
			table.insert(storms, s)
		end
	end
	cw.storms = storms
	cw.systemsSnap = snap.systems
	local vort = {}
	for _, v in snap.systems.vortices do
		table.insert(vort, v)
	end
	cw.systems = { vortices = vort, systems = snap.systems.systems, fronts = snap.systems.fronts }
	cw.boundaries = snap.boundaries
	World.rebuildBuckets(cw)
end

function ClientWorld.applyProfiles(cw: any, list: any)
	for _, p in list do
		cw.profiles[p.id] = p
	end
end

-- tornado states (Tornado.snapshot list) 10-20 Hz
function ClientWorld.applyTornadoes(cw: any, list: any)
	local out = {}
	for _, t in list do
		if not t.ended then
			t.params = Vortex.params(t)
		end
		table.insert(out, t)
	end
	cw.tornadoes = out
end

function ClientWorld.applyColdPool(cw: any, b: buffer)
	World.unpackColdPool(cw.coldPool, b)
end

-- the full volume (Precip.pack): everything, the radar's best data
function ClientWorld.applyPrecip(cw: any, b: buffer)
	cw.vol = Precip.unpack(b, cw.env.extent)
	cw.volFull = cw.vol
end

-- the light rain frame (Precip.packLite): the renderers' surface rain and hail, and an approximate
-- profile (the radar keeps the last full volume when it has one: cw.volFull)
function ClientWorld.applyPrecipLite(cw: any, b: buffer)
	cw.vol = Precip.unpackLite(b, cw.env.extent)
end

-- surface rain (mm/h) and hail (cm) at a point
function ClientWorld.surfacePrecip(cw: any, x: number, y: number): (number, number)
	return Precip.surface(cw.vol, x, y)
end

return ClientWorld
