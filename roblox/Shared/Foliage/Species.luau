--!strict
-- The wood and roots of each tree kind, from forestry measurements (green wood, as standing trees
-- are). The sway and breaking mechanics (Foliage/Mechanics) run from these and each tree's rig
-- (Foliage/Kinds); nothing in them is keyed on a wind speed.
--   mor        modulus of rupture of green wood (Pa): the bending stress a stem breaks at
--              (USDA Wood Handbook FPL-GTR-282, table 5-3a: white oak 57 MPa, American elm 50,
--              hackberry 45, eastern cottonwood 37, silver maple 40, eastern red cedar 48)
--   e          modulus of elasticity, green (Pa) (same table)
--   density    green wood density (kg/m3) (wood handbook table 4-3 and moisture contents)
--   anchor     root anchorage: the turning moment that overturns the tree, per kg of stem
--              (N m / kg; tree-pulling tests: Peltola et al. 2000, Nicoll et al. 2006 -
--              120-180 in firm soil, lower for shallow-rooted floodplain trees)
--   cdLeaf     drag coefficient of the foliage at low wind, and vogel the reconfiguration
--              exponent: leaves fold and streamline, so drag grows as U^(2 + vogel) above
--              UREF (Vogel 1989; Vollsinger et al. 2005: -0.5 to -0.9 for broadleaves)
--   damping    the fraction of critical damping of the stems' sway (Moore & Maguire 2004:
--              0.05-0.2, mostly from the crown's drag)
local Species = {}

export type Wood = {
	mor: number,
	e: number,
	density: number,
	anchor: number,
	cdLeaf: number,
	vogel: number,
	damping: number,
}

Species.UREF = 4 -- m/s: below this the foliage keeps its shape (no reconfiguration)

Species.kinds = {
	hardwood = { mor = 52e6, e = 8.8e9, density = 1000, anchor = 165, cdLeaf = 0.45, vogel = -0.75, damping = 0.12 },
	cottonwood = { mor = 37e6, e = 7.0e9, density = 850, anchor = 125, cdLeaf = 0.45, vogel = -0.8, damping = 0.1 },
	yard = { mor = 40e6, e = 6.9e9, density = 950, anchor = 140, cdLeaf = 0.45, vogel = -0.75, damping = 0.12 },
	cedar = { mor = 48e6, e = 4.5e9, density = 720, anchor = 150, cdLeaf = 0.6, vogel = -0.5, damping = 0.08 },
} :: { [string]: Wood }

function Species.of(kind: string): Wood
	return Species.kinds[kind] or Species.kinds.hardwood
end

return Species
