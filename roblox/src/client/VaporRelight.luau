--!strict
--!native
-- Cloud vapor relit live (the tornado's FunnelImpostor way, for clouds): each puffy piece has a
-- light grid baked in Blender (tools/blender/cloud_relight_bake.py --grid 1, shared/Weather/
-- CloudKit/Relight): the same volume rendered with the sun at 8 azimuths round the view at 15 and
-- 50 degrees up and overhead, and by sky light alone, plus its coverage. Light adds up and changes
-- smoothly with the sun's direction, so the cloud under any sun is the blend of the (up to four)
-- nearest renders, plus sky: here, into a small EditableImage per piece and storm,
-- redrawn when the sun's angle to the view or the light's colour changes (a few images a frame at
-- most, within a time budget). The baked 4-light sheets stand in when no image is free.
--
--   VaporRelight.available(name)                    -- has this piece a basis?
--   VaporRelight.want(key, name, sunLocal, sunColour, skyColour) -> Content?   -- each frame
--   VaporRelight.step()                             -- once a frame: redraw, free unused images
--
-- sunLocal: toward the sun in the image's frame (x: image right, y: up, z: toward the viewer).
local AssetService = game:GetService("AssetService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("World"):WaitForChild("Config"))
local R = Config.STORM_KIT.vapor.relight

local VaporRelight = {}

type Basis = { size: number, scale: number, data: buffer, channels: number }
local bases: { [string]: Basis | false } = {}

-- base64 -> buffer
local B64: { [number]: number } = {}
do
	local alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
	for i = 1, 64 do
		B64[string.byte(alphabet, i)] = i - 1
	end
end
local function decode(s: string): buffer
	local n = #s
	local pad = 0
	if string.byte(s, n) == 61 then
		pad += 1
	end
	if string.byte(s, n - 1) == 61 then
		pad += 1
	end
	local out = buffer.create(n // 4 * 3 - pad)
	local o = 0
	local total = buffer.len(out)
	for i = 1, n, 4 do
		local a, b = B64[string.byte(s, i)] or 0, B64[string.byte(s, i + 1)] or 0
		local c, d = B64[string.byte(s, i + 2)] or 0, B64[string.byte(s, i + 3)] or 0
		local v = a * 262144 + b * 4096 + c * 64 + d
		if o < total then
			buffer.writeu8(out, o, v // 65536)
		end
		if o + 1 < total then
			buffer.writeu8(out, o + 1, (v // 256) % 256)
		end
		if o + 2 < total then
			buffer.writeu8(out, o + 2, v % 256)
		end
		o += 3
	end
	return out
end

-- The grid from its uploaded image (tools/blender/relight_pack.py: 1024 x 512, 8 tiles of 256 of
-- three channels in R, G, B), read back into the same layout as the Luau data. Yields.
local function fromPack(id: string): buffer?
	local ok, image = pcall(function()
		return (AssetService :: any):CreateEditableImageAsync(Content.fromUri(id))
	end)
	if not ok or not image then
		warn("[VaporRelight] could not read " .. id .. ": " .. tostring(image))
		return nil
	end
	local size = 256
	local px = image:ReadPixelsBuffer(Vector2.zero, Vector2.new(size * 4, size * 2))
	image:Destroy()
	local out = buffer.create(size * size * 19)
	local W = size * 4
	for t = 0, 6 do
		local tx, ty = (t % 4) * size, (t // 4) * size
		for c = 0, 2 do
			local k = t * 3 + c
			if k < 19 then
				for y = 0, size - 1 do
					local srcRow = ((ty + y) * W + tx) * 4 + c
					local dstRow = y * size * 19 + k
					for x = 0, size - 1 do
						buffer.writeu8(out, dstRow + x * 19, buffer.readu8(px, srcRow + x * 4))
					end
				end
			end
		end
	end
	return out
end

local function basisFor(name: string): Basis?
	local b = bases[name]
	if b ~= nil then
		return b or nil
	end
	bases[name] = false
	local pack = R.packs and R.packs[name]
	if pack and pack ~= "" then
		-- (read in the background; the baked sheets stand in meanwhile)
		task.spawn(function()
			local data = fromPack(pack)
			VaporRelight.stats.packCheck = if data then name .. " pack read" else name .. " pack FAILED"
			-- (check: the upload's bytes against the Luau data, where both are here)
			local folder = ReplicatedStorage.Shared.Weather.CloudKit:FindFirstChild("Relight")
			local mod = folder and folder:FindFirstChild(name)
			if data and mod and mod:IsA("ModuleScript") then
				local ok, d = pcall(require, mod)
				if ok and type(d) == "table" and (d :: any).data then
					local ref = decode((d :: any).data)
					local maxDiff, diffs = 0, 0
					for i = 0, math.min(buffer.len(ref), buffer.len(data)) - 1 do
						local dd = math.abs(buffer.readu8(ref, i) - buffer.readu8(data, i))
						if dd > 0 then
							diffs += 1
							maxDiff = math.max(maxDiff, dd)
						end
					end
					local msg = string.format("%s upload vs data: %d of %d bytes differ, max %d", name, diffs, buffer.len(ref), maxDiff)
					VaporRelight.stats.packCheck = msg
					print("[VaporRelight] " .. msg)
				end
			end
			if data then
				bases[name] = { size = 256, scale = R.scale, data = data, channels = 19 }
			end
		end)
		return nil
	end
	local folder = ReplicatedStorage.Shared.Weather.CloudKit:FindFirstChild("Relight")
	local mod = folder and folder:FindFirstChild(name)
	if not (mod and mod:IsA("ModuleScript")) then
		return nil
	end
	local ok, d = pcall(require, mod)
	if not ok or type(d) ~= "table" or (d :: any).format ~= "grid" or (d :: any).channels ~= 19 then
		warn("[VaporRelight] not a light grid: " .. name)
		return nil
	end
	local basis = { size = (d :: any).size, scale = (d :: any).scale, data = decode((d :: any).data), channels = 19 }
	bases[name] = basis
	return basis
end

function VaporRelight.available(name: string): boolean
	if not R.enabled then
		return false
	end
	if R.packs and R.packs[name] and R.packs[name] ~= "" then
		return true
	end
	local folder = ReplicatedStorage.Shared.Weather.CloudKit:FindFirstChild("Relight")
	return folder ~= nil and folder:FindFirstChild(name) ~= nil
end

type Slot = {
	name: string,
	image: EditableImage,
	content: Content,
	out: buffer,
	-- what it shows, and what it should show
	shown: { number }?,
	wanted: { number },
	usedAt: number,
	drawn: boolean,
}
local slots: { [string]: Slot } = {}
local count = 0

-- The sun and sky as numbers: four (channel, weight) pairs of the grid (the renders nearest the
-- sun's direction), then the sun's and the sky's colours.
local RING_E = { 15, 50 } -- (the grid's two rings, degrees up; channel 16 overhead)
local function params(sunLocal: Vector3, sun: Color3, sky: Color3): { number }
	local s = if sunLocal.Magnitude > 1e-4 then sunLocal.Unit else Vector3.yAxis
	-- azimuth: 0 = sun behind the viewer (+z), 90 = image right (+x); elevation above the horizon
	local az = math.deg(math.atan2(s.X, s.Z)) % 360
	local el = math.deg(math.asin(math.clamp(s.Y, -1, 1)))
	local a0 = math.floor(az / 45) % 8
	local a1 = (a0 + 1) % 8
	local ta = (az - a0 * 45) / 45
	local pairs_ = {}
	local function ring(r: number, w: number)
		table.insert(pairs_, r * 8 + a0)
		table.insert(pairs_, w * (1 - ta))
		table.insert(pairs_, r * 8 + a1)
		table.insert(pairs_, w * ta)
	end
	if el <= RING_E[1] then
		ring(0, 1) -- (a low sun: the lowest ring)
		table.insert(pairs_, 16)
		table.insert(pairs_, 0)
	elseif el <= RING_E[2] then
		local t = (el - RING_E[1]) / (RING_E[2] - RING_E[1])
		ring(0, 1 - t)
		ring(1, t)
	else
		local t = math.clamp((el - RING_E[2]) / (90 - RING_E[2]), 0, 1)
		ring(1, 1 - t)
		table.insert(pairs_, 16)
		table.insert(pairs_, t)
	end
	while #pairs_ < 8 do
		table.insert(pairs_, 16)
		table.insert(pairs_, 0)
	end
	local out = table.move(pairs_, 1, 8, 1, {})
	for _, v in { sun.R, sun.G, sun.B, sky.R, sky.G, sky.B } do
		table.insert(out, v)
	end
	return out
end

local function differs(a: { number }?, b: { number }): boolean
	if not a then
		return true
	end
	for i = 1, #b do
		if math.abs(a[i] - b[i]) > R.redrawStep then
			return true
		end
	end
	return false
end

function VaporRelight.want(key: string, name: string, sunLocal: Vector3, sunColour: Color3, skyColour: Color3, clock: number): Content?
	local slot = slots[key]
	if not slot then
		if count >= R.maxImages then
			return nil
		end
		local basis = basisFor(name)
		if not basis then
			return nil
		end
		local ok, image = pcall(function()
			return AssetService:CreateEditableImage({ Size = Vector2.new(basis.size, basis.size) })
		end)
		if not ok or not image then
			return nil
		end
		count += 1
		slot = {
			name = name,
			image = image,
			content = Content.fromObject(image),
			out = buffer.create(basis.size * basis.size * 4),
			shown = nil,
			wanted = params(sunLocal, sunColour, skyColour),
			usedAt = os.clock(),
			drawn = false,
		}
		slots[key] = slot
	end
	local s = slot :: Slot
	s.usedAt = os.clock()
	s.wanted = params(sunLocal, sunColour, skyColour)
	return if s.drawn then s.content else nil
end

-- (the light channels are stored as sqrt(v / scale): this table squares them back)
local SQ = table.create(256, 0)
for b = 0, 255 do
	SQ[b + 1] = (b / 255) ^ 2
end

-- linear light 0..1 -> sRGB byte (the renders are linear; the image shows display values)
local SRGB = table.create(1024, 0)
for i = 0, 1023 do
	local x = i / 1023
	local v = if x <= 0.0031308 then 12.92 * x else 1.055 * x ^ (1 / 2.4) - 0.055
	SRGB[i + 1] = math.floor(v * 255 + 0.5)
end

-- One image's pixels: each the blend of the nearest grid renders, plus sky.
local function draw(slot: Slot, basis: Basis)
	local p = slot.wanted
	local c1, w1, c2, w2, c3, w3, c4, w4 = p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8]
	-- (to a 0..1023 index of linear light; then straight colour: / coverage)
	local k = basis.scale * 1023
	local sr, sg, sb = p[9] * k, p[10] * k, p[11] * k
	local kr, kg, kb = p[12] * k, p[13] * k, p[14] * k
	local srgb = SRGB
	local data, out = basis.data, slot.out
	local stride = basis.channels
	local n = basis.size * basis.size
	local sq = SQ
	for i = 0, n - 1 do
		local o = i * stride
		local alpha = buffer.readu8(data, o + 18)
		local q = i * 4
		if alpha == 0 then
			buffer.writeu32(out, q, 0)
		else
			local sunL = w1 * sq[buffer.readu8(data, o + c1) + 1] + w2 * sq[buffer.readu8(data, o + c2) + 1]
				+ w3 * sq[buffer.readu8(data, o + c3) + 1] + w4 * sq[buffer.readu8(data, o + c4) + 1]
			local skyL = sq[buffer.readu8(data, o + 17) + 1]
			-- (premultiplied renders: back to straight colour at the soft edges)
			local inv = 255 / alpha
			local r = math.min(1023, (sunL * sr + skyL * kr) * inv) // 1
			local g = math.min(1023, (sunL * sg + skyL * kg) * inv) // 1
			local b = math.min(1023, (sunL * sb + skyL * kb) * inv) // 1
			buffer.writeu8(out, q, srgb[r + 1])
			buffer.writeu8(out, q + 1, srgb[g + 1])
			buffer.writeu8(out, q + 2, srgb[b + 1])
			buffer.writeu8(out, q + 3, alpha)
		end
	end
	slot.image:WritePixelsBuffer(Vector2.zero, Vector2.new(basis.size, basis.size), out)
	slot.shown = table.clone(slot.wanted)
	slot.drawn = true
end

VaporRelight.stats = { images = 0, drawsPerSecond = 0, drawMs = 0, lastDrawMs = 0, packCheck = "" }
local drawsThisSecond, secondAt = 0, os.clock()

function VaporRelight.step(clock: number)
	-- free images nobody asked for lately
	for key, slot in slots do
		if clock - slot.usedAt > R.freeAfter then
			slot.image:Destroy()
			slots[key] = nil
			count -= 1
		end
	end
	-- redraw the most out-of-date ones, within the budget
	local t0 = os.clock()
	local budget = R.budgetMs / 1000
	for _, slot in slots do
		if os.clock() - t0 > budget then
			break
		end
		if differs(slot.shown, slot.wanted) then
			local basis = basisFor(slot.name)
			if basis then
				local td = os.clock()
				draw(slot, basis)
				VaporRelight.stats.lastDrawMs = (os.clock() - td) * 1000
				drawsThisSecond += 1
			end
		end
	end
	local st = VaporRelight.stats
	st.images = count
	st.drawMs += ((os.clock() - t0) * 1000 - st.drawMs) * 0.1
	if os.clock() - secondAt >= 1 then
		st.drawsPerSecond = drawsThisSecond
		drawsThisSecond, secondAt = 0, os.clock()
	end
end

return VaporRelight
