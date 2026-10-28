-- Lab radar of the focus supercell at one time, from the full precip volume and from what the
-- client rebuilds from precipLite (Precip.packLite -> unpackLite). Prints frames in the format
-- tools/stormlab/radar_frames.py reads (REF row over SRV row).
--   luau --codegen tools/radar_compare/lab_full_vs_lite.luau -a <minutes> > out.txt
local Json = require("../../roblox/src/stormlab/shared/Sim/Json")
local World = require("../../roblox/src/stormlab/shared/Sim/World")
local Radar = require("../../roblox/src/stormlab/shared/Sim/Radar")
local Precip = require("../../roblox/src/stormlab/shared/Sim/Precip")
local args = { ... }
local minutes = tonumber(args[1] or "") or 60
local world = World.new(Json.decode(require("../../roblox/src/stormlab/data/Supercell")))
world:spinUp(600)
for _ = 1, minutes * 12 do world:step(5) end
local best, bestRot = nil, -1
for _, s in world.storms do
	if not s.dead and (s.rot or 0) * (s.W or 0) > bestRot then best, bestRot = s, (s.rot or 0) * (s.W or 0) end
end
local s = best
local site = Radar.site(s.x - 21213, s.y - 21213, { seed = 11 })
local liteBuf = world.precip:packLite()
local fullBuf = world.precip:pack()
local lite = Precip.unpackLite(liteBuf, world.env.extent)
local full = Precip.unpack(fullBuf, world.env.extent)
print(string.format("BYTES full=%d lite=%d", buffer.len(fullBuf), buffer.len(liteBuf)))
local N, HALF = 160, 30000
local function frame(label, vol, elev)
	local ctx = { vol = vol, tornadoes = world.tornadoes, coldPool = world.coldPool,
		freezing = (s.freezing and s.freezing > 500) and s.freezing or 4000,
		wind = function(x, y, z) return world:windAt(x, y, z) end }
	local refRows, velRows = {}, {}
	for j = N - 1, 0, -1 do
		local rr, vr = {}, {}
		for i = 0, N - 1 do
			local x = s.x - HALF + (i + 0.5) * (2 * HALF / N)
			local y = s.y - HALF + (j + 0.5) * (2 * HALF / N)
			local dx, dy = x - site.x, y - site.y
			local ground = math.sqrt(dx * dx + dy * dy)
			local az = math.deg(math.atan2(dx, dy)) % 360
			local dbz, v = Radar.gate(site, ctx, az, ground, elev, minutes)
			local r, g, b, r2, g2, b2 = 0.04, 0.05, 0.07, 0.04, 0.05, 0.07
			if dbz then
				r, g, b = Radar.refColour(dbz)
				local srv = v - ((s.u or 0) * dx / ground + (s.v or 0) * dy / ground)
				r2, g2, b2 = Radar.velColour(srv, 35)
			end
			table.insert(rr, string.format("%02x%02x%02x", math.floor(r * 255), math.floor(g * 255), math.floor(b * 255)))
			table.insert(vr, string.format("%02x%02x%02x", math.floor(r2 * 255), math.floor(g2 * 255), math.floor(b2 * 255)))
		end
		table.insert(refRows, table.concat(rr)); table.insert(velRows, table.concat(vr))
	end
	print(string.format("FRAME %s elev=%.1f t=%d storm=%s W=%.0f rot=%.2f tornadoes=%d", label, elev, minutes, tostring(s.id), s.W, s.rot or 0, #world.tornadoes))
	print("REF " .. N); for _, r in refRows do print(r) end
	print("SRV " .. N); for _, r in velRows do print(r) end
end
frame("sim", world.precip, 0.5)
frame("full-wire", full, 0.5)
frame("lite-wire", lite, 0.5)
frame("full-wire", full, 2.4)
frame("lite-wire", lite, 2.4)
