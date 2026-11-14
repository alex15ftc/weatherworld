--!strict
-- Tire compounds the driver can fit from the F4 menu. Each one replaces the
-- grip and curve of the car's own tire (VehicleConfig.Tire) and keeps its size,
-- inertia and nominal load. "Stock" is the car's tire as configured.
--
-- Roughly:
--   Street  all-season / touring, ~0.95 g. Soft carcass: the curve peaks late
--           and fades gently past it, so it slides progressively.
--   Sport   max-performance summer tire (200-300 treadwear), ~1.1 g.
--   Race    R-compound / semi-slick (Cup 2 R, A052 class), ~1.3 g. Stiffer,
--           peaks sooner and drops off harder past the peak.
--   Slick   dry racing slick, ~1.5 g. Very stiff, peaky, and loses more grip
--           per unit of extra load, so weight transfer matters more.

local TireCompounds = {}

export type Compound = {
	Name: string,
	Mu: number,
	LongB: number,
	LongC: number,
	LongE: number,
	LatB: number,
	LatC: number,
	LatE: number,
	LoadSensitivity: number,
	RollingResistance: number,
}

TireCompounds.Order = { "Stock", "Street", "Sport", "Race", "Slick" }

TireCompounds.ByName = {
	Street = {
		Name = "Street",
		Mu = 0.95,
		LongB = 11, LongC = 1.45, LongE = -0.5,
		LatB = 10, LatC = 1.35, LatE = -0.6,
		LoadSensitivity = 0.08,
		RollingResistance = 0.013,
	},
	Sport = {
		Name = "Sport",
		Mu = 1.10,
		LongB = 14, LongC = 1.50, LongE = -0.2,
		LatB = 14, LatC = 1.40, LatE = -0.3,
		LoadSensitivity = 0.10,
		RollingResistance = 0.012,
	},
	Race = {
		Name = "Race",
		Mu = 1.30,
		LongB = 16, LongC = 1.55, LongE = -0.1,
		LatB = 16, LatC = 1.45, LatE = -0.15,
		LoadSensitivity = 0.12,
		RollingResistance = 0.011,
	},
	Slick = {
		Name = "Slick",
		Mu = 1.50,
		LongB = 18, LongC = 1.60, LongE = 0.0,
		LatB = 19, LatC = 1.55, LatE = 0.0,
		LoadSensitivity = 0.15,
		RollingResistance = 0.010,
	},
} :: { [string]: Compound }

-- The car's tire config with a compound fitted ("Stock" or an unknown name
-- returns the base unchanged).
function TireCompounds.apply(base: any, name: string): any
	local c = TireCompounds.ByName[name]
	if not c then
		return base
	end
	local t = table.clone(base)
	t.Mu = c.Mu
	t.LongB, t.LongC, t.LongE = c.LongB, c.LongC, c.LongE
	t.LatB, t.LatC, t.LatE = c.LatB, c.LatC, c.LatE
	t.LoadSensitivity = c.LoadSensitivity
	t.RollingResistance = c.RollingResistance
	return t
end

return TireCompounds
