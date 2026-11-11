--!strict
-- The storm's precipitation grid (the feed's `precip`, from the engine's radar field:
-- js/radar/StormPrecipGrid.js): low-level reflectivity (dBZ), hail size (MESH, inches) and snow
-- share on cols x rows cells of cellKm, centred at (xKm, yKm); row-major, the first row the
-- northernmost (smallest yKm), each row west to east.
--
--   Precip.at(grid, xKm, yKm) -> dbz, hailIn, snow     (bilinear between cell centres)
--   Precip.rainRate(dbz)      -> mm/h (Z = 300 R^1.4, convective)
--   Precip.cell(grid, i, j)   -> xKm, yKm of a cell's centre (i column, j row, from 1)
local Precip = {}

function Precip.cell(g: any, i: number, j: number): (number, number)
	return g.xKm + (i - 1 - (g.cols - 1) / 2) * g.cellKm, g.yKm + (j - 1 - (g.rows - 1) / 2) * g.cellKm
end

local function value(list: { number }?, g: any, i: number, j: number): number
	if not list or i < 1 or j < 1 or i > g.cols or j > g.rows then
		return 0
	end
	return list[(j - 1) * g.cols + i] or 0
end

function Precip.at(g: any, xKm: number, yKm: number): (number, number, number)
	if not g then
		return 0, 0, 0
	end
	local fi = (xKm - g.xKm) / g.cellKm + (g.cols - 1) / 2 + 1
	local fj = (yKm - g.yKm) / g.cellKm + (g.rows - 1) / 2 + 1
	local i0, j0 = math.floor(fi), math.floor(fj)
	local u, v = fi - i0, fj - j0
	local function bilinear(list: { number }?): number
		return value(list, g, i0, j0) * (1 - u) * (1 - v) + value(list, g, i0 + 1, j0) * u * (1 - v)
			+ value(list, g, i0, j0 + 1) * (1 - u) * v + value(list, g, i0 + 1, j0 + 1) * u * v
	end
	return bilinear(g.dbz), bilinear(g.hailIn), bilinear(g.snow)
end

function Precip.rainRate(dbz: number): number
	if dbz < 15 then
		return 0
	end
	return (10 ^ (dbz / 10) / 300) ^ (1 / 1.4)
end

return Precip
