--!nonstrict
-- Storm frames, version 2: the contract between whatever produces the weather (the lab's own
-- simulation today; the engine or a main-game server later) and the billboard renderers.
-- docs/stormlab/FRAME-V2.md has the full field list, units and rates.
--
-- A frame is one message the renderers' client mirror (ClientWorld + Net) applies:
--   kind       arguments                       rate (lab)        applied by
--   state      snapshot, settings?             ~2 Hz             ClientWorld.applySnapshot
--   profiles   { {id, version, wprof, tiltX, tiltY} }  on change ClientWorld.applyProfiles
--   tornado    { Tornado.snapshot }, time      ~15 Hz            ClientWorld.applyTornadoes
--   coldPool   buffer (World.packColdPool)     ~10 s             ClientWorld.applyColdPool
--   precip     buffer (Precip.pack: full 3-D)  ~60 s, optional   ClientWorld.applyPrecip
--   precipLite buffer (Precip.packLite)        ~10 s             ClientWorld.applyPrecipLite
--   flash      { flash }                       as they happen    ctx.signals.flash
--   event      { kind = ... }                  as they happen    ctx.signals.event
-- Frame (recorded / sent over HTTP): { k = kind, t = sim time (s), a = { arguments } }, with
-- buffers as { b64 = "..." } so a frame is plain JSON.
--
-- Units: metres and seconds; x east, y north, z up, from the frame's origin (the scenario window's
-- centre in the lab; a producer converts its own coordinates into this frame). Clock: sim
-- seconds (state.time) and UTC hour (state.clockUtc).
local Frames = {}

Frames.VERSION = 2
Frames.KINDS = { "state", "profiles", "tornado", "coldPool", "precip", "precipLite", "flash", "event" }

-- Fields the renderers read (a producer must send at least these; more is fine)
Frames.STORM_FIELDS = {
	"id", "x", "y", "u", "v", "age", "seed", "W", "Ru", "base", "el", "top", "rot", "vmid", "vlow",
	"lowX", "lowY", "ffdX", "ffdY", "rfdX", "rfdY", "lowering", "wallBase", "precipRate",
	"srU", "srV", "anvilLen", "anvilU", "anvilV", "upperU", "upperV", "profVersion",
}
Frames.PROFILE_FIELDS = { "id", "version", "wprof", "tiltX", "tiltY" }
Frames.TORNADO_FIELDS = {
	"id", "parentId", "x", "y", "ut", "vt", "envU", "envV", "vc", "rc", "swirl", "inflow",
	"cloudBase", "topX", "topY", "bendX", "bendY", "wave", "seed", "time", "O", "decay", "stage",
	"ef", "peakWind", "hold", "debrisLoft", "debrisTop",
}
Frames.STATE_FIELDS = { "time", "clockUtc", "storms", "systems", "boundaries" }

local function missing(t: any, fields: { string }, what: string, out: { string })
	if type(t) ~= "table" then
		table.insert(out, what .. " is not a table")
		return
	end
	for _, f in fields do
		if t[f] == nil then
			table.insert(out, what .. "." .. f)
		end
	end
end

-- Check a frame's arguments against the contract: a list of what is missing (empty when fine).
-- Optional fields (e.g. a dead storm's lowering) may be nil, so producers are checked in tests,
-- not at run time.
function Frames.check(kind: string, args: { any }): { string }
	local out = {}
	local a = args[1]
	if kind == "state" then
		missing(a, Frames.STATE_FIELDS, "state", out)
		if type(a) == "table" and type(a.storms) == "table" then
			for i, s in a.storms do
				if not s.dead then
					missing(s, Frames.STORM_FIELDS, "storms[" .. i .. "]", out)
				end
			end
		end
	elseif kind == "profiles" then
		for i, p in a or {} do
			missing(p, Frames.PROFILE_FIELDS, "profiles[" .. i .. "]", out)
		end
	elseif kind == "tornado" then
		for i, t in a or {} do
			if not t.ended then
				missing(t, Frames.TORNADO_FIELDS, "tornado[" .. i .. "]", out)
			end
		end
	elseif kind == "coldPool" or kind == "precip" or kind == "precipLite" then
		if typeof(a) ~= "buffer" then
			table.insert(out, kind .. " is not a buffer")
		end
	elseif kind ~= "flash" and kind ~= "event" then
		table.insert(out, "unknown kind " .. tostring(kind))
	end
	return out
end

-- base64 (buffers inside JSON frames)
local ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
local ENC = {}
local DEC = {}
for i = 1, 64 do
	local c = string.byte(ALPHA, i)
	ENC[i - 1] = c
	DEC[c] = i - 1
end

function Frames.toBase64(b: buffer): string
	local n = buffer.len(b)
	local out = buffer.create(math.ceil(n / 3) * 4)
	local o = 0
	for i = 0, n - 1, 3 do
		local b0 = buffer.readu8(b, i)
		local b1 = if i + 1 < n then buffer.readu8(b, i + 1) else 0
		local b2 = if i + 2 < n then buffer.readu8(b, i + 2) else 0
		local v = b0 * 65536 + b1 * 256 + b2
		buffer.writeu8(out, o, ENC[v // 262144])
		buffer.writeu8(out, o + 1, ENC[(v // 4096) % 64])
		buffer.writeu8(out, o + 2, if i + 1 < n then ENC[(v // 64) % 64] else 61) -- "="
		buffer.writeu8(out, o + 3, if i + 2 < n then ENC[v % 64] else 61)
		o += 4
	end
	return buffer.tostring(out)
end

function Frames.fromBase64(s: string): buffer
	local len = #s
	local pad = 0
	if len >= 1 and string.byte(s, len) == 61 then
		pad += 1
	end
	if len >= 2 and string.byte(s, len - 1) == 61 then
		pad += 1
	end
	local n = len // 4 * 3 - pad
	local out = buffer.create(math.max(n, 0))
	local o = 0
	for i = 1, len, 4 do
		local c0 = DEC[string.byte(s, i)] or 0
		local c1 = DEC[string.byte(s, i + 1)] or 0
		local c2 = DEC[string.byte(s, i + 2)] or 0
		local c3 = DEC[string.byte(s, i + 3)] or 0
		local v = c0 * 262144 + c1 * 4096 + c2 * 64 + c3
		if o < n then
			buffer.writeu8(out, o, v // 65536)
		end
		if o + 1 < n then
			buffer.writeu8(out, o + 1, (v // 256) % 256)
		end
		if o + 2 < n then
			buffer.writeu8(out, o + 2, v % 256)
		end
		o += 3
	end
	return out
end

-- A frame as plain data (buffers base64'd): { k, t, a }
function Frames.encode(kind: string, t: number, args: { any }): { [string]: any }
	local a = {}
	for i, v in args do
		if typeof(v) == "buffer" then
			a[i] = { b64 = Frames.toBase64(v) }
		else
			a[i] = v
		end
	end
	return { k = kind, t = t, a = a, n = #args }
end

-- (kind, sim time, arguments) from a frame made by Frames.encode (or received as JSON)
function Frames.decode(f: { [string]: any }): (string, number, { any })
	local args = {}
	local n = f.n or #(f.a or {})
	for i = 1, n do
		local v = f.a[i]
		if type(v) == "table" and type(v.b64) == "string" then
			args[i] = Frames.fromBase64(v.b64)
		else
			args[i] = v
		end
	end
	return f.k, f.t or 0, args
end

return Frames
