// The Roblox map's scale, which the generator's character-scale sizes depend on. Map distance is
// squashed (STUDS_PER_MILE, roblox/src/shared/World/Config.luau, keep the two equal); things built
// at character scale (road cross-sections, lots, buildings, interchange ramps, airfield layouts)
// keep their size in studs, so in map miles they grow as the map is squashed.
//   AT_1000(mi)  a size first written in map miles at 1000 studs a mile, kept at the same studs
//   STUDS(n)     a size of n studs, in map miles
// Distances that are the map's own (town spacing, town extents, section lines, highway routes,
// county and warning-area sizes) stay in map miles and do not use these.
export const STUDS_PER_MILE = 600;
export const K = 1000 / STUDS_PER_MILE;
export const AT_1000 = mi => mi * K;
export const STUDS = n => n / STUDS_PER_MILE;
