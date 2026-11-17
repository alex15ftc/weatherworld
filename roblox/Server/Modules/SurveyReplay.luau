--!strict
-- A lifted tornado run past buildings no server had loaded (2026-11-17), for its damage survey
-- (server/BuildingDamage.js job; BuildingDamageService runs it). The tornado is its logged track
-- ([xMi, yMi, hourUtc, mph, yards] per point, map miles) with the survey's wind about it
-- (js/reports/damageSurvey.js windAt: its full wind inside its core, falling off as the distance
-- to the power DECAY to 65 mph at the edge of its width), stepped every STEP_MI along the track;
-- each building meets it through the same EF components (Sim/Damage) from the same seed and
-- quality as when loaded, so the result is the same on any server.
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local ServerStorage = game:GetService("ServerStorage")

local Config = require(ReplicatedStorage.Shared.World.Config)
local Damage = require(ReplicatedStorage.Shared.StormLab.Sim.Damage)
local Noise = require(ReplicatedStorage.Shared.StormLab.Sim.Noise)
local WorldMap = require(ServerStorage.World.WorldMap)
local ChunkGen = require(ServerStorage.World.ChunkGen)

local SurveyReplay = {}

SurveyReplay.DECAY = 0.6 -- (damageSurvey PROFILE.decay)
SurveyReplay.STEP_MI = 0.05

local HALF = Config.MAP_MILES / 2
local CHUNK_MI = Config.CHUNK_STUDS / Config.DESIGN_STUDS_PER_MILE
local MPH = 0.44704

export type Sample = { x: number, y: number, hour: number, mph: number, yards: number }
export type Rec = { n: number, degree: number, dir: number }
-- [chunk, n, di, xMi, yMi, dod, quality, hourUtc] (server/BuildingDamage.js report)
export type Event = { any }

-- A building's strength, the same on every server: its seed, and its build quality (0-1; the
-- components' failure speeds x 0.85-1.15).
function SurveyReplay.strengthOf(cx: number, cz: number, n: number): (number, number)
	return Noise.hashInt(cx, cz, n, 61) % 2147483647, Noise.hash(cx, cz, n, 62)
end

-- The wind byte of a direction in the place (x east, z south; 0 north, 64 east), as
-- StructureDamage.byteOf.
local function byteOf(dx: number, dz: number): number
	return math.floor((math.atan2(dx, -dz) / (2 * math.pi)) % 1 * 256 + 0.5) % 256
end

-- The survey's wind (mph) of a sample at r miles from it.
function SurveyReplay.wind(mph: number, yards: number, r: number): number
	local edge = yards / 1760 / 2
	if mph <= 65 or r > edge then
		return 0
	end
	local core = edge * (65 / mph) ^ (1 / SurveyReplay.DECAY)
	return if r <= core then mph else mph * (core / r) ^ SurveyReplay.DECAY
end

-- The track every STEP_MI.
function SurveyReplay.samples(track: { { number } }): { Sample }
	local out: { Sample } = {}
	for i, b in track do
		local a = track[math.max(1, i - 1)]
		local n = if i == 1 then 1 else math.max(1, math.ceil(math.sqrt((b[1] - a[1]) ^ 2 + (b[2] - a[2]) ^ 2) / SurveyReplay.STEP_MI))
		for k = 1, n do
			local f = if i == 1 then 1 else k / n
			table.insert(out, {
				x = a[1] + (b[1] - a[1]) * f, y = a[2] + (b[2] - a[2]) * f, hour = a[3] + (b[3] - a[3]) * f,
				mph = math.max(65, a[4] + (b[4] - a[4]) * f), yards = math.max(20, a[5] + (b[5] - a[5]) * f),
			})
		end
	end
	return out
end

function SurveyReplay.chunkAt(mx: number, my: number): (number, number)
	return math.floor((mx - HALF) / CHUNK_MI), math.floor((my - HALF) / CHUNK_MI)
end

-- The chunks the swath crosses, in the order it crossed them, but those in skip (by name).
function SurveyReplay.chunks(samples: { Sample }, skip: { [string]: boolean }): { { cx: number, cz: number, name: string } }
	local wanted, order = {}, {}
	for _, p in samples do
		local steps = math.ceil((p.yards / 1760 / 2 + 0.05) / CHUNK_MI)
		for i = -steps, steps do
			for j = -steps, steps do
				local cx, cz = SurveyReplay.chunkAt(p.x + i * CHUNK_MI * 0.999, p.y + j * CHUNK_MI * 0.999)
				local name = ChunkGen.name(cx, cz)
				if not wanted[name] and not skip[name] then
					wanted[name] = true
					table.insert(order, { cx = cx, cz = cz, name = name })
				end
			end
		end
	end
	return order
end

-- A chunk's planned buildings (ChunkGen.structures: n, di, frame, size) run past the tornado:
-- the records to keep and the events to report.
function SurveyReplay.run(cx: number, cz: number, list: { any }, samples: { Sample }): ({ Rec }, { Event })
	local name = ChunkGen.name(cx, cz)
	local recs: { Rec }, events: { Event } = {}, {}
	for _, s in list do
		if not Damage.DI[s.di] then
			continue
		end
		local seed, quality = SurveyReplay.strengthOf(cx, cz, s.n)
		local state = Damage.newStructure(`{name}/{s.n}`, s.di, s.frame.X, s.frame.Z, s.size.Y, seed, 0.85 + 0.3 * quality)
		local bx, by = WorldMap.worldMilesAt(s.frame.X, s.frame.Z)
		for i, p in samples do
			local r = math.sqrt((bx - p.x) ^ 2 + (by - p.y) ^ 2)
			local mph = SurveyReplay.wind(p.mph, p.yards, r)
			if mph > 0 then
				local dt = math.clamp((p.hour - samples[math.max(1, i - 1)].hour) * 3600, 1, 60)
				for _, f in Damage.apply(state, dt, mph * MPH, mph * MPH) do
					-- (the wind there: round the tornado, cyclonic; map y south)
					local re, rn = bx - p.x, -(by - p.y)
					local len = math.max(1e-6, math.sqrt(re * re + rn * rn))
					table.insert(recs, { n = s.n, degree = f.degree, dir = byteOf(-rn / len, -re / len) })
					table.insert(events, { name, s.n, s.di, math.round(bx * 1000) / 1000, math.round(by * 1000) / 1000, f.degree, math.round(quality * 1000) / 1000, math.round(p.hour * 1000) / 1000 })
				end
			end
		end
	end
	return recs, events
end

return SurveyReplay
