--!nonstrict
--!native
-- A dense 2-D field on a regular grid in lab metres (x east, y north). Cell (i, j) has its centre
-- at (x0 + (i - 0.5) * dx, y0 + (j - 0.5) * dx), i = 1..nx, j = 1..ny; values are stored flat at
-- index i + (j - 1) * nx.
local Grid = {}
Grid.__index = Grid

export type Grid = {
	nx: number,
	ny: number,
	dx: number,
	x0: number,
	y0: number,
	v: { number },
	sample: (Grid, number, number) -> number,
	get: (Grid, number, number) -> number,
	set: (Grid, number, number, number) -> (),
	index: (Grid, number, number) -> number,
	cellOf: (Grid, number, number) -> (number, number),
	centre: (Grid, number, number) -> (number, number),
	gradient: (Grid, number, number) -> (number, number),
	fill: (Grid, number) -> (),
	copy: (Grid) -> Grid,
	sum: (Grid) -> number,
	max: (Grid) -> number,
}

function Grid.new(nx: number, ny: number, dx: number, x0: number, y0: number, value: number?): Grid
	local self = setmetatable({ nx = nx, ny = ny, dx = dx, x0 = x0, y0 = y0, v = table.create(nx * ny, value or 0) }, Grid)
	return (self :: any) :: Grid
end

function Grid.index(self: Grid, i: number, j: number): number
	return i + (j - 1) * self.nx
end

function Grid.get(self: Grid, i: number, j: number): number
	i = math.clamp(i, 1, self.nx)
	j = math.clamp(j, 1, self.ny)
	return self.v[i + (j - 1) * self.nx]
end

function Grid.set(self: Grid, i: number, j: number, value: number)
	self.v[i + (j - 1) * self.nx] = value
end

-- the cell containing (x, y) (may be outside 1..n)
function Grid.cellOf(self: Grid, x: number, y: number): (number, number)
	return math.floor((x - self.x0) / self.dx) + 1, math.floor((y - self.y0) / self.dx) + 1
end

function Grid.centre(self: Grid, i: number, j: number): (number, number)
	return self.x0 + (i - 0.5) * self.dx, self.y0 + (j - 0.5) * self.dx
end

-- bilinear between cell centres, clamped at the edges
function Grid.sample(self: Grid, x: number, y: number): number
	local gx = (x - self.x0) / self.dx + 0.5
	local gy = (y - self.y0) / self.dx + 0.5
	local nx, ny = self.nx, self.ny
	gx = math.clamp(gx, 1, nx)
	gy = math.clamp(gy, 1, ny)
	local i, j = math.min(nx - 1, math.floor(gx)), math.min(ny - 1, math.floor(gy))
	if nx == 1 then
		i = 1
	end
	if ny == 1 then
		j = 1
	end
	local fx, fy = gx - i, gy - j
	local v = self.v
	local k = i + (j - 1) * nx
	local a = v[k]
	local b = v[math.min(k + 1, #v)]
	local c = v[math.min(k + nx, #v)]
	local d = v[math.min(k + nx + 1, #v)]
	return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy
end

-- d/dx, d/dy (per metre) by centred differences of the bilinear sample
function Grid.gradient(self: Grid, x: number, y: number): (number, number)
	local h = self.dx
	return (self:sample(x + h, y) - self:sample(x - h, y)) / (2 * h), (self:sample(x, y + h) - self:sample(x, y - h)) / (2 * h)
end

function Grid.fill(self: Grid, value: number)
	for k = 1, #self.v do
		self.v[k] = value
	end
end

function Grid.copy(self: Grid): Grid
	local g = Grid.new(self.nx, self.ny, self.dx, self.x0, self.y0)
	g.v = table.clone(self.v)
	return g
end

function Grid.sum(self: Grid): number
	local s = 0
	for _, x in self.v do
		s += x
	end
	return s
end

function Grid.max(self: Grid): number
	local m = -math.huge
	for _, x in self.v do
		if x > m then
			m = x
		end
	end
	return m
end

-- Semi-Lagrangian advection of `field` by the velocity grids (u, v sampled at each centre) over dt.
-- edge: the value flowing in from outside (nil: clamp)
function Grid.advect(field: Grid, u: Grid, v: Grid, dt: number, scale: number?)
	local s = scale or 1
	local out = table.create(#field.v, 0)
	local nx = field.nx
	for j = 1, field.ny do
		for i = 1, nx do
			local x, y = field:centre(i, j)
			local uu, vv = u:sample(x, y) * s, v:sample(x, y) * s
			-- midpoint back-trajectory
			local xm, ym = x - 0.5 * uu * dt, y - 0.5 * vv * dt
			uu, vv = u:sample(xm, ym) * s, v:sample(xm, ym) * s
			out[i + (j - 1) * nx] = field:sample(x - uu * dt, y - vv * dt)
		end
	end
	field.v = out
end

return Grid
