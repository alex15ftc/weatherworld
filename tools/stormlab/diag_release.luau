-- A/B of the precipitation release (2026-10-30): storm C001's strength, inflow CAPE and the
-- positions of its low-level rain and hail cores against the low meso, every 5 min.
--   luau --codegen tools/stormlab/diag_release.luau
-- set mode below: "fallout" (the default release), "nocarry" (no rotation carry while crossing),
-- "angles" (the painted release before 2026-10-30)
local Json = require("../../roblox/src/stormlab/shared/Sim/Json")
local World = require("../../roblox/src/stormlab/shared/Sim/World")
local Storm = require("../../roblox/src/stormlab/shared/Sim/Storm")
local mode = "fallout"
if mode == "angles" then
	Storm.PRECIP_RELEASE = "angles"
elseif mode == "nocarry" then
	Storm.PRECIP_CARRY = false
end
print("release mode: " .. mode)
local data = Json.decode(require("../../roblox/src/stormlab/data/Supercell"))
local world = World.new(data)
world:spinUp(600)
local p = world.precip
local function rel(s, x, y)
	local hx, hy = Storm.heading(s)
	local lx, ly = Storm.lowMesoAt(s)
	local dx, dy = x - lx, y - ly
	local th = math.deg(math.atan2(hy, hx) - math.atan2(dy, dx))
	return (th + 180) % 360 - 180, math.sqrt(dx * dx + dy * dy) / 1000
end
for step = 1, 720 do
	world:step(5)
	if step % 60 == 0 then
		local s
		for _, st in world.storms do
			if st.id == "C001" then
				s = st
			end
		end
		if not s or s.dead then
			print(string.format("t=%3d min: C001 gone", step * 5 // 60))
			break
		end
		local _, u5x, u5y = Storm.wprofAt(s, 5000)
		local cx, cy = s.x + u5x, s.y + u5y
		local rx, ry, rm, hx2, hy2, hm, big = 0, 0, 0, 0, 0, 0, 0
		for i = 1, #p.px do
			if p.alive[i] and p.pz[i] < 1500 and (p.px[i] - cx) ^ 2 + (p.py[i] - cy) ^ 2 < 2.25e8 then
				if p.pk[i] == 1 then
					rx += p.px[i] * p.pm[i]
					ry += p.py[i] * p.pm[i]
					rm += p.pm[i]
				elseif p.pk[i] == 2 and p.pd[i] >= 1 then
					hx2 += p.px[i] * p.pm[i]
					hy2 += p.py[i] * p.pm[i]
					hm += p.pm[i]
					big = math.max(big, p.pd[i])
				end
			end
		end
		local rth, rd = 0, 0
		if rm > 0 then rth, rd = rel(s, rx / rm, ry / rm) end
		local hth, hd = 0, 0
		if hm > 0 then hth, hd = rel(s, hx2 / hm, hy2 / hm) end
		print(string.format("t=%3d min: W %4.1f cape %5.0f cin %6.0f load %.2f base %4.0f | rain %4.0f deg %4.1f km | hail(>=1cm) %4.0f deg %4.1f km max %.1f cm | hailMax %.1f",
			step * 5 // 60, s.W, s.cape or 0, s.cin or 0, s.loading or 0, s.base, rth, rd, hth, hd, big, s.hailMax or 0))
	end
end
