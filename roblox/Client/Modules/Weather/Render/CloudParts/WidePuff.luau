--!strict
-- Wide puff textures for flattened cards (LabConfig.WIDE_PUFFS, tools/smoke/wide_puff.py).
-- A billboard is drawn as an upright rectangle. Cards flattened as the camera sees a level sheet
-- side-on drew a square puff squashed up to 1:6 (user 2026-11-10: "stretched from certain
-- angles"). A puff card wider than ~1.4:1 takes the texture made at the nearest width:height
-- (2, 4, 8), so the texture is never stretched more than ~1.4x either way.
local WidePuff = {}

local cfg: any = nil

-- (workspace attribute WidePuffs=false: the old squashed textures, to compare in a play test;
-- read at most twice a second; the Pause key flips it on this client)
local liveOn, liveAt = true, -1
local keyBound = false
function WidePuff.init(C: any)
	cfg = C.WIDE_PUFFS
	if cfg and cfg.enabled == false then
		cfg = nil
	end
	-- Pause (in Studio only): switch the wide puffs off and on on this client, to compare from one
	-- camera. (StormCards picks a card's texture when it re-plans: wait ~5 s before a capture.)
	if cfg and not keyBound and game:GetService("RunService"):IsStudio() then
		keyBound = true
		game:GetService("UserInputService").InputBegan:Connect(function(input, processed)
			if not processed and input.KeyCode == Enum.KeyCode.Pause then
				local on = workspace:GetAttribute("WidePuffs") ~= false
				workspace:SetAttribute("WidePuffs", not on)
				liveAt = -1
				print("[WidePuff] wide puffs", if on then "off" else "on")
			end
		end)
	end
end

function WidePuff.on(): boolean
	if not cfg then
		return false
	end
	local t = os.clock()
	if t - liveAt > 0.5 then
		liveAt = t
		liveOn = workspace:GetAttribute("WidePuffs") ~= false
	end
	return liveOn
end

-- the width:height bucket for a card: 1 (square texture), 2, 4 or 8. Bounds sit at the geometric
-- middles (sqrt 2, 2 sqrt 2, 4 sqrt 2); prev keeps the last bucket within 12 % past a bound, so a
-- card whose shape eases with the camera does not flicker between two textures
local EDGES = { 1.414, 2.828, 5.657 }
local BUCKETS = { 1, 2, 4, 8 }
function WidePuff.bucket(w: number, h: number, prev: number?): number
	if not WidePuff.on() or h <= 0 then
		return 1
	end
	local a = w / h
	local b = 1
	for i, e in EDGES do
		if a >= e then
			b = BUCKETS[i + 1]
		end
	end
	if prev and prev ~= b then
		local pi = table.find(BUCKETS, prev)
		if pi then
			local lo = if pi > 1 then EDGES[pi - 1] / 1.12 else 0
			local hi = if pi <= #EDGES then EDGES[pi] * 1.12 else math.huge
			if a >= lo and a < hi then
				return prev
			end
		end
	end
	return b
end

-- the texture for bucket b (2, 4, 8): detailed (variant i) or haze; nil for bucket 1 or when off
function WidePuff.texture(b: number, detail: boolean, i: number): string?
	if not WidePuff.on() or b <= 1 then
		return nil
	end
	if detail then
		local set = cfg.detail and cfg.detail[b]
		if set and #set > 0 then
			return set[(i % #set) + 1]
		end
	end
	return cfg.haze and cfg.haze[b] or nil
end

-- the funnel's smooth puff for bucket b at edge sharpness level lvl (0, 1, 2: the square smooth
-- puff, its 1/2 and 1/4 ramps); nil for bucket 1 or when off
function WidePuff.funnel(b: number, lvl: number): string?
	if not WidePuff.on() or b <= 1 then
		return nil
	end
	local set = cfg.funnel and cfg.funnel[b]
	return set and set[math.clamp(lvl, 0, 2) + 1] or nil
end

return WidePuff
