--!nonstrict
-- Lightning illumination as a field in space and time (visual plan, phase D). Every flash (from
-- the server's lightning, or injected by a visual test) becomes a short train of pulses at its
-- position; any renderer asks how much flash light reaches a point now:
--   FlashField.at(field, x, y, z) -> illumination 0..~2 (1 = a nearby flash's full light)
--   FlashField.camera(field)       -> the share reaching the camera's surroundings (for the
--                                     limited ground/ambient response; never a daylight pulse)
-- Pulses: cloud-to-ground strokes are 2-4 sharp return strokes with fading continuing current;
-- intracloud flashes are softer, longer flickers lighting the cloud from inside. Light falls off
-- with distance as 1 / (1 + (d / R)^2) with R ~ 2.5 km (cloud-diffused), and overlapping flashes
-- add with a soft cap so a burst never becomes daylight.
local FlashField = {}

local exp, sqrt = math.exp, math.sqrt

function FlashField.new(Noise: any): any
	return { flashes = {}, Noise = Noise, clock = 0 }
end

-- f: { kind, x0, y0, z0, x1, y1, z1, seed, current } (Sim/Lightning flash); t0: client clock
function FlashField.add(field: any, f: any, t0: number)
	local rng = field.Noise.rng(f.seed or 1)
	local pulses = {}
	if f.kind == "ic" then
		local n = rng:int(2, 5)
		local t = 0
		for _ = 1, n do
			table.insert(pulses, { t, rng:range(0.06, 0.16), rng:range(0.35, 0.8) })
			t += rng:range(0.05, 0.22)
		end
	else
		local n = if f.kind == "+cg" then 1 else rng:int(2, 4)
		local t = 0
		for k = 1, n do
			local strength = if k == 1 then 1 else rng:range(0.5, 0.9)
			table.insert(pulses, { t, rng:range(0.03, 0.06), strength })
			-- continuing current after some strokes
			if rng:next() < 0.5 then
				table.insert(pulses, { t + 0.03, rng:range(0.08, 0.2), 0.3 * strength })
			end
			t += rng:range(0.04, 0.12)
		end
	end
	local cur = math.clamp((f.current or 20) / 30, 0.5, 2)
	-- light comes mostly from the channel's lower part for CG, its middle for IC
	local px = if f.kind == "ic" then 0.5 * (f.x0 + f.x1) else 0.65 * f.x1 + 0.35 * f.x0
	local py = if f.kind == "ic" then 0.5 * (f.y0 + f.y1) else 0.65 * f.y1 + 0.35 * f.y0
	local pz = if f.kind == "ic" then 0.5 * (f.z0 + f.z1) else 0.4 * f.z0
	table.insert(field.flashes, {
		x = px, y = py, z = pz, t0 = t0, pulses = pulses,
		intensity = (if f.kind == "ic" then 0.7 else 1.0) * cur,
		radius = if f.kind == "ic" then 3500 else 2500,
		kind = f.kind,
		ends = t0 + 1.2,
	})
end

local function brightness(fl: any, now: number): number
	local t = now - fl.t0
	if t < 0 then
		return 0
	end
	local b = 0
	for _, p in fl.pulses do
		local dt = t - p[1]
		if dt >= 0 then
			-- fast rise, exponential fade
			b += p[3] * math.min(1, dt / 0.008) * exp(-dt / p[2])
		end
	end
	return b * fl.intensity
end

function FlashField.step(field: any, now: number)
	field.clock = now
	local keep = {}
	for _, fl in field.flashes do
		if now < fl.ends then
			table.insert(keep, fl)
		end
	end
	field.flashes = keep
	-- this frame's brightness per flash (so every lookup this frame is cheap)
	for _, fl in field.flashes do
		fl.now = brightness(fl, now)
	end
end

function FlashField.at(field: any, x: number, y: number, z: number): number
	local sum = 0
	for _, fl in field.flashes do
		local b = fl.now or 0
		if b > 0.001 then
			local dx, dy, dz = x - fl.x, y - fl.y, z - fl.z
			local d2 = dx * dx + dy * dy + dz * dz
			sum += b / (1 + d2 / (fl.radius * fl.radius))
		end
	end
	-- overlapping flashes add, softly capped
	return 2 * (1 - exp(-sum / 2))
end

function FlashField.camera(field: any, cx: number, cy: number, cz: number): number
	return FlashField.at(field, cx, cy, math.max(cz, 300))
end

function FlashField.active(field: any): number
	return #field.flashes
end

return FlashField
