--!native
-- What the client draws, per model column, packed into one buffer:
--   cloud runs: the lowest two contiguous runs of cloud (qc + qsn above CLOUD, kg/kg: snow is
--   the anvil's visible cloud), base and top
--   (m; 0 = none) - the storm's body and an anvil above a clear gap
--   rain at the ground (mm/h, hail included), surface temperature perturbation (K), vertical vorticity at the
--   lowest level and at 1 km (1/s), updraft at 5 km (m/s), wind at the lowest level (m/s), the hail
--   part of the surface rate (mm/h liquid equivalent)
-- All straight from the model's fields; nothing is shaped here.
local Snapshot = {}

Snapshot.CLOUD = 1e-4
Snapshot.FIELDS = 11 -- base1 top1 base2 top2 rain dth zeta0 zeta1 w5 pool-wind hail
local F32 = 4

function Snapshot.pack(m: any): buffer
	local nx, ny, nz = m.nx, m.ny, m.nz
	local nf = Snapshot.FIELDS
	local b = buffer.create(24 + nx * ny * nf * F32)
	buffer.writeu16(b, 0, nx)
	buffer.writeu16(b, 2, ny)
	buffer.writef32(b, 4, m.dx)
	buffer.writef32(b, 8, m.time)
	buffer.writei32(b, 12, m.ox)
	buffer.writei32(b, 16, m.oy)
	buffer.writef32(b, 20, m.uhMax or 0)
	local qc, qsn, th, w, u, v = m.qc, m.qsn, m.th, m.w, m.u, m.v
	local zf, th0 = m.zf, m.th0
	local k1, k5 = m:levelAt(1000), m:levelAt(5000)
	local CL = Snapshot.CLOUD
	local SXY = m.SXY
	local o = 24
	for j = 1, ny do
		for i = 1, nx do
			local col = m:idx(i, j, 0)
			local runs = { 0, 0, 0, 0 }
			local nr, inside = 0, false
			for k = 1, nz do
				local n = col + k * SXY
				-- (cloud: droplets and the anvil's ice; falling rain and hail are not cloud - js/cloudmodel/FrameCodec.js)
				local c = qc[n] + qsn[n]
				if c > CL then
					if not inside then
						nr += 1
						if nr > 2 then
							break
						end
						runs[2 * nr - 1] = zf[k]
						inside = true
					end
					runs[2 * nr] = zf[k + 1]
				else
					inside = false
				end
			end
			local n1 = col + SXY
			local ug = 0.5 * (u[n1] + u[n1 + 1]) + m.umove
			local vg = 0.5 * (v[n1] + v[n1 + m.SX]) + m.vmove
			local vals = {
				runs[1], runs[2], runs[3], runs[4],
				m.rainSfc[(j + 1) * m.SX + i + 2],
				th[n1] - th0[1],
				m:zeta(i, j, 1),
				m:zeta(i, j, k1),
				0.5 * (w[col + k5 * SXY] + w[col + (k5 + 1) * SXY]),
				math.sqrt(ug * ug + vg * vg),
				m.hailSfc[(j + 1) * m.SX + i + 2],
			}
			for f = 1, nf do
				buffer.writef32(b, o, vals[f])
				o += F32
			end
		end
	end
	return b
end

-- reader: header, then field f (1..FIELDS) of column (i, j)
function Snapshot.header(b: buffer): (number, number, number, number, number, number, number)
	return buffer.readu16(b, 0), buffer.readu16(b, 2), buffer.readf32(b, 4), buffer.readf32(b, 8), buffer.readi32(b, 12), buffer.readi32(b, 16), buffer.readf32(b, 20)
end

function Snapshot.get(b: buffer, nx: number, i: number, j: number, f: number): number
	return buffer.readf32(b, 24 + (((j - 1) * nx + (i - 1)) * Snapshot.FIELDS + (f - 1)) * F32)
end

-- The nest (fine grid) per column: the lowest cloud run's base and top (m; below 3 km only - the
-- wall cloud, a lowering, a funnel), vorticity at the lowest level (1/s), ground-relative wind
-- there (m/s), pressure perturbation there (Pa). Header: nx, ny, dx, X0, Y0 (its south-west corner
-- in the outermost model's box, m - a nest in a nest adds up its parents' corners).
Snapshot.NEST_FIELDS = 5
function Snapshot.packNest(n: any): buffer
	local nx, ny, nz = n.nx, n.ny, n.nz
	local nf = Snapshot.NEST_FIELDS
	local b = buffer.create(20 + nx * ny * nf * F32)
	buffer.writeu16(b, 0, nx)
	buffer.writeu16(b, 2, ny)
	buffer.writef32(b, 4, n.dx)
	local X0, Y0, up = n.X0, n.Y0, n.parent
	while up and up.parent do
		X0 += up.X0
		Y0 += up.Y0
		up = up.parent
	end
	buffer.writef32(b, 8, X0)
	buffer.writef32(b, 12, Y0)
	buffer.writef32(b, 16, n.time)
	local qc, zf, SXY = n.qc, n.zf, n.SXY
	local o = 20
	for j = 1, ny do
		for i = 1, nx do
			local col = n:idx(i, j, 0)
			local zb, zt = 0, 0
			for k = 1, nz do
				if zf[k] > 3000 then
					break
				end
				if qc[col + k * SXY] > Snapshot.CLOUD then
					if zt == 0 then
						zb = zf[k]
					end
					zt = zf[k + 1]
				elseif zt > 0 then
					break
				end
			end
			local n1 = col + SXY
			local ug = 0.5 * (n.u[n1] + n.u[n1 + 1]) + n.umove
			local vg = 0.5 * (n.v[n1] + n.v[n1 + n.SX]) + n.vmove
			local vals = { zb, zt, n:zeta(i, j, 1), math.sqrt(ug * ug + vg * vg), n.p[n1] }
			for f = 1, nf do
				buffer.writef32(b, o, vals[f])
				o += F32
			end
		end
	end
	return b
end

function Snapshot.nestHeader(b: buffer): (number, number, number, number, number, number)
	return buffer.readu16(b, 0), buffer.readu16(b, 2), buffer.readf32(b, 4), buffer.readf32(b, 8), buffer.readf32(b, 12), buffer.readf32(b, 16)
end

function Snapshot.getNest(b: buffer, nx: number, i: number, j: number, f: number): number
	return buffer.readf32(b, 20 + (((j - 1) * nx + (i - 1)) * Snapshot.NEST_FIELDS + (f - 1)) * F32)
end

return Snapshot
