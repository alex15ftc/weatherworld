// The Enhanced Fujita scale's damage indicators (DIs) and degrees of damage (DODs) that a
// survey of this map can find: what stands on the ground here (houses, manufactured homes,
// farm outbuildings, schools, metal buildings, trees). Each degree of damage has the wind
// expected to cause it and its lower and upper bounds (3-second gust, mph), from the scale's
// own tables (Texas Tech University, "A Recommendation for an Enhanced Fujita Scale", 2006,
// Appendix A). A survey rates a tornado from the highest wind its damage supports, as the
// National Weather Service does; damage the scale has no indicator for rates nothing.
export const EF_THRESHOLDS = [65, 86, 111, 136, 166, 201];
export const TREE_POLE_CAP_MPH = 135;
export const efFromWind = mph => (mph >= 201 ? 5 : mph >= 166 ? 4 : mph >= 136 ? 3 : mph >= 111 ? 2 : mph >= 86 ? 1 : mph >= 65 ? 0 : -1);

// [description, expected, lower bound, upper bound]
export const DAMAGE_INDICATORS = Object.freeze({
  SBO: { number: 1, name: 'Small barns or farm outbuildings', dods: [
    ['Threshold of visible damage', 62, 53, 78], ['Loss of wood or metal roof panels', 74, 61, 91], ['Collapse of doors', 83, 68, 102],
    ['Major loss of roof panels', 90, 78, 110], ['Uplift or collapse of roof structure', 93, 77, 114], ['Collapse of walls', 97, 81, 119],
    ['Overturning or sliding of entire structure', 99, 83, 118], ['Total destruction of building', 112, 94, 131]] },
  FR12: { number: 2, name: 'One- or two-family residence', dods: [
    ['Threshold of visible damage', 65, 53, 80], ['Loss of roof covering material (<20%), gutters and/or awning; loss of vinyl or metal siding', 79, 63, 97],
    ['Broken glass in doors and windows', 96, 79, 114], ['Uplift of roof deck and loss of significant roof covering material (>20%); collapse of chimney; garage doors collapse inward; failure of porch or carport', 97, 81, 116],
    ['Entire house shifts off foundation', 121, 103, 141], ['Large sections of roof structure removed; most walls remain standing', 122, 104, 142],
    ['Exterior walls collapsed', 132, 113, 153], ['Most walls collapsed, except small interior rooms', 152, 127, 178], ['All walls collapsed', 170, 142, 198],
    ['Destruction of engineered and/or well-constructed residence; slab swept clean', 200, 165, 220]] },
  MHSW: { number: 3, name: 'Single-wide manufactured home', dods: [
    ['Threshold of visible damage', 61, 51, 76], ['Loss of shingles or partial uplift of one-piece metal roof covering', 74, 61, 92],
    ['Unit slides off block piers but remains upright', 87, 72, 103], ['Complete uplift of roof; most walls remain standing', 89, 73, 112],
    ['Unit rolls on its side or upside down; remains essentially intact', 98, 84, 114], ['Destruction of roof and walls leaving floor and undercarriage in place', 105, 87, 123],
    ['Unit rolls or vaults; roof and walls separate from floor and undercarriage', 109, 96, 128], ['Undercarriage separates from unit; rolls, tumbles and is badly bent', 118, 101, 136],
    ['Complete destruction of unit; debris blown away', 127, 110, 148]] },
  MHDW: { number: 4, name: 'Double-wide manufactured home', dods: [
    ['Threshold of visible damage', 61, 51, 76], ['Loss of shingles or other roof covering (<20%)', 76, 62, 88], ['Damaged porches or carports', 78, 67, 96],
    ['Broken windows', 83, 68, 95], ['Uplift of roof deck and loss of significant roof covering material (>20%)', 88, 75, 108],
    ['Complete uplift of roof; most walls remain standing', 93, 77, 110], ['Unit slides off CMU block piers', 94, 78, 109],
    ['Removal of entire roof structure leaving most walls standing', 97, 80, 117], ['Complete destruction of roof and walls leaving undercarriage in place', 113, 93, 131],
    ['Unit rolls, displaces or vaults', 114, 82, 130], ['Undercarriage separates from floor, rolls and tumbles, badly bent', 127, 109, 145],
    ['Complete destruction of unit; debris blows away', 134, 119, 154]] },
  ES: { number: 15, name: 'Elementary school (single story)', dods: [
    ['Threshold of visible damage', 65, 47, 80], ['Loss of roof covering (<20%)', 79, 66, 99], ['Broken windows', 87, 71, 106], ['Exterior door failures', 99, 85, 118],
    ['Uplift of some roof decking; significant loss of roofing material (>20%); loss of rooftop HVAC', 101, 82, 121], ['Damage to or loss of wall cladding', 108, 92, 127],
    ['Uplift or collapse of roof structure', 125, 108, 148], ['Collapse of non-bearing walls', 139, 117, 162], ['Collapse of load-bearing walls', 153, 130, 180],
    ['Total destruction of a large section of building or entire building', 176, 152, 203]] },
  MBS: { number: 21, name: 'Metal building system', dods: [
    ['Threshold of visible damage', 67, 54, 83], ['Inward or outward collapse of overhead doors', 89, 75, 108], ['Metal roof or wall panels pulled from the building', 95, 78, 120],
    ['Column anchorage failed', 117, 96, 135], ['Buckling of roof purlins', 118, 95, 138], ['Failure of X-braces in the lateral load resisting system', 138, 118, 158],
    ['Progressive collapse of rigid frames', 143, 120, 168], ['Total destruction of building', 155, 132, 178]] },
  // Distribution lines on wood poles: the wood-pole degrees of the transmission-line indicator.
  ETL: { number: 24, name: 'Electrical line (wood poles)', dods: [
    ['Threshold of visible damage', 83, 70, 98], ['Broken wood cross member', 99, 80, 114], ['Wood poles leaning', 108, 85, 130], ['Broken wood poles', 118, 98, 142]] },
  TH: { number: 27, name: 'Hardwood tree', dods: [
    ['Small limbs broken (up to 1 in diameter)', 60, 48, 72], ['Large branches broken (1-3 in diameter)', 74, 61, 88], ['Trees uprooted', 94, 76, 118],
    ['Trunks snapped', 107, 93, 134], ['Trees debarked with only stubs of largest branches remaining', 143, 123, 167]] },
  TS: { number: 28, name: 'Softwood tree', dods: [
    ['Small limbs broken (up to 1 in diameter)', 60, 48, 72], ['Large branches broken (1-3 in diameter)', 75, 62, 88], ['Trees uprooted', 87, 73, 113],
    ['Trunks snapped', 104, 88, 128], ['Trees debarked with only stubs of largest branches remaining', 131, 112, 153]] }
});

// The degree of damage a wind does to one indicator, and the wind the survey estimates from it.
// quality (0-1) is how well this one was built: each degree needs a wind between its bounds,
// lower for a poorly built one. The survey reads the degree and estimates the wind within its
// bounds that the construction calls for, as a surveyor does: lower for a poorly built one,
// higher for a well-built one (it cannot see the wind itself). Null
// below the first degree: no damage to see.
export function damageAt(di, windMph, quality = 0.5) {
  const dods = DAMAGE_INDICATORS[di].dods;
  let found = -1;
  for (let k = 0; k < dods.length; k++) {
    const [, , lo, hi] = dods[k], needed = lo + (hi - lo) * quality;
    if (windMph >= needed) found = k; else break;
  }
  if (found < 0) return null;
  const [description, expected, lo, hi] = dods[found];
  // Trees and poles fail too variably to rate above EF2 on their own (survey practice): their
  // estimate stops at TREE_POLE_CAP_MPH.
  const capped = ['TH', 'TS', 'ETL'].includes(di) ? TREE_POLE_CAP_MPH : Infinity;
  const estimatedMph = Math.min(capped, Math.round((lo + (hi - lo) * quality) / 5) * 5);
  return { dod: found + 1, description, expectedMph: expected, lowerMph: lo, upperMph: hi, estimatedMph, ef: efFromWind(estimatedMph) };
}
