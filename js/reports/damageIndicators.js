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
  // Shops, offices, schools and other buildings (2026-11-17), from the same tables (SPC efscale/N.html).
  // ACT's last degree (total destruction) has no winds in the source and is left out.
  ACT: { number: 5, name: "Apartments, condos, townhouses (3 stories or less)", dods: [["Threshold of visible damage", 76, 63, 95], ["Loss of roof covering (<20%)", 99, 82, 121], ["Uplift of roof decking; significant loss of roof covering (>20%)", 124, 107, 146], ["Uplift or collapse of roof structure leaving most walls standing", 138, 120, 158], ["Most top story walls collapsed", 158, 138, 184], ["Almost total destruction of top two stories", 180, 155, 205]] },
  M: { number: 6, name: "Motel", dods: [["Threshold of visible damage", 66, 54, 83], ["Loss of roof covering (<20%)", 80, 67, 99], ["Broken windows or patio doors", 89, 74, 107], ["Uplift of roof decking; significant loss of roof covering (>20%); loss of EIFS wall cladding", 95, 80, 116], ["Uplift or collapse of canopy over driveway", 99, 81, 118], ["Uplift or collapse of roof structure leaving most walls standing", 123, 103, 143], ["Collapse of top story exterior walls", 138, 121, 156], ["Collapse of most top story walls", 143, 127, 162], ["Collapse of top two floors of three or more stories", 170, 144, 185], ["Total destruction of entire building", 190, 163, 217]] },
  MAM: { number: 7, name: "Masonry apartment or motel", dods: [["Threshold of visible damage", 65, 54, 81], ["Loss of roof covering (<20%)", 80, 67, 101], ["Uplift of lightweight metal roof decking", 95, 81, 116], ["Uplift of pre-cast or cast-in-place concrete roof decking", 121, 103, 143], ["Collapse of top story walls", 133, 115, 150], ["Collapse of top two floors of three or more stories", 156, 132, 180], ["Total destruction of a large section of building", 180, 160, 205]] },
  SRB: { number: 8, name: "Small retail building (fast food)", dods: [["Threshold of visible damage", 65, 54, 81], ["Loss of roof covering (<20%)", 78, 65, 98], ["Broken glass in windows and doors", 86, 72, 103], ["Uplift of roof decking; significant loss of roof covering (>20%)", 98, 81, 119], ["Canopies or covered walkways destroyed", 98, 83, 114], ["Uplift or collapse of entire roof structure", 119, 101, 140], ["Collapse of exterior walls; closely spaced interior walls remain standing", 138, 120, 159], ["Total destruction of entire building", 167, 143, 193]] },
  SPB: { number: 9, name: "Small professional building (doctor office, branch bank)", dods: [["Threshold of visible damage", 65, 54, 81], ["Loss of roof covering (<20%)", 78, 65, 98], ["Broken windows, including clear story windows or skylights", 89, 74, 107], ["Exterior doors fail", 100, 82, 118], ["Uplift of roof decking; significant loss of roof covering (>20%); loss of rooftop HVAC equipment", 100, 84, 117], ["Collapsed facade or parapet walls", 103, 85, 123], ["Uplift or collapse of entire roof structure", 124, 105, 145], ["Collapse of exterior walls; closely spaced interior walls remain standing", 144, 123, 165], ["Total destruction of entire building", 157, 148, 200]] },
  SM: { number: 10, name: "Strip mall", dods: [["Threshold of visible damage", 65, 54, 81], ["Uplift of roof covering at eaves and roof corners", 80, 66, 100], ["Broken windows or glass doors", 88, 72, 105], ["Uplift of roof decking", 101, 84, 122], ["Collapsed facade or parapet walls", 103, 85, 125], ["Covered walkways uplifted or collapsed", 103, 86, 125], ["Uplift or collapse of entire roof structure", 122, 103, 143], ["Collapse of exterior walls; closely spaced interior walls remain standing", 140, 117, 165], ["Complete destruction of all or a large section of building", 171, 147, 198]] },
  LSM: { number: 11, name: "Large shopping mall", dods: [["Threshold of visible damage", 71, 59, 86], ["Loss of roof covering (<20%)", 85, 69, 105], ["Broken skylights, clearstory windows and atrium walls", 92, 75, 114], ["Uplift of some roof decking; significant loss of roofing material (>20%); loss of rooftop HVAC", 108, 92, 128], ["Wall cladding stripped starting at corners and progressing to other areas", 111, 94, 131], ["Roof structure uplifted or collapsed", 128, 108, 150], ["Exterior walls in top story collapsed", 144, 124, 166], ["Interior walls of top story collapse", 160, 139, 185], ["Complete destruction of all or a large section of the building", 204, 176, 247]] },
  LIRB: { number: 12, name: "Large isolated (\"big box\") retail building", dods: [["Threshold of visible damage", 68, 57, 83], ["Loss of roof covering (<20%)", 81, 68, 103], ["Uplift of some roof decking; significant loss of roofing material (>20%); loss of rooftop HVAC", 103, 87, 123], ["Long roof spans collapsed downward", 122, 103, 144], ["Uplift and removal of roof structure", 134, 114, 157], ["Inward or outward collapse of exterior walls", 137, 118, 158], ["Complete destruction of all or a large section of the building", 173, 147, 201]] },
  ASR: { number: 13, name: "Automobile showroom", dods: [["Threshold of visible damage", 65, 47, 80], ["Loss of roof covering (<20%)", 80, 67, 101], ["Broken glass in windows or doors", 87, 71, 106], ["Uplift of some roof decking; significant loss of roofing material (>20%); loss of rooftop HVAC", 101, 83, 120], ["Cladding stripped off walls", 112, 94, 132], ["Uplift or collapse of roof structure", 118, 98, 140], ["Exterior walls collapsed", 126, 106, 148], ["Complete destruction of all or a large section of the building", 157, 138, 181]] },
  ASB: { number: 14, name: "Automotive service building", dods: [["Threshold of visible damage", 63, 46, 79], ["Loss of roof covering (<20%)", 78, 65, 99], ["Failure of large overhead doors", 91, 77, 110], ["Uplift of some roof decking; significant loss of roofing material (>20%); loss of rooftop HVAC", 98, 80, 119], ["Collapse of non-bearing masonry or tilt-up walls", 114, 94, 134], ["Uplift or collapse of roof structure", 121, 102, 143], ["Collapse of load-bearing walls", 128, 106, 149], ["Complete destruction of all or a large section of the building", 157, 138, 181]] },
  JHSH: { number: 16, name: "Junior or senior high school", dods: [["Threshold of visible damage", 68, 55, 83], ["Loss of roof covering (<20%)", 79, 66, 99], ["Broken windows", 87, 71, 106], ["Exterior door failures", 101, 83, 121], ["Uplift of metal roof decking; significant loss of roofing material (>20%); loss of rooftop HVAC", 101, 85, 119], ["Damage to or loss of wall cladding", 108, 92, 127], ["Collapse of tall masonry walls at gym, cafeteria or auditorium", 114, 94, 136], ["Uplift or collapse of light steel roof structure", 125, 108, 148], ["Collapse of exterior walls in top floor", 139, 121, 153], ["Most interior walls of top floor collapsed", 158, 133, 186], ["Complete destruction of all or a large section of building", 192, 163, 224]] },
  LRB: { number: 17, name: "Low-rise building (1-4 stories)", dods: [["Threshold of visible damage", 68, 55, 83], ["Loss of roof covering (<20%)", 80, 67, 103], ["Uplift of metal roof decking at eaves and roof corners; significant loss of roofing material (>20%)", 101, 83, 120], ["Broken glass in windows, entryways or atriums", 101, 83, 122], ["Uplift of lightweight roof structure", 133, 114, 157], ["Significant damage to exterior walls and some interior walls", 143, 122, 167], ["Complete destruction of all or a large section of building", 188, 161, 221]] },
  MRB: { number: 18, name: "Mid-rise building (5-20 stories)", dods: [["Threshold of visible damage", 70, 58, 86], ["Loss of roof covering (<20%)", 83, 68, 103], ["Damage to penthouse roof and walls; loss of rooftop HVAC equipment", 92, 75, 113], ["Damage to parapet walls or coping", 99, 83, 118], ["Broken glass in curtain walls; glass in entryways; significant damage to building interior", 101, 83, 120], ["Uplift of lightweight roof decking; significant loss of roofing material (>20%)", 119, 98, 140], ["Broken curtain wall panel anchors", 129, 110, 150], ["Uplift or collapse of roof structure", 136, 118, 158], ["Significant damage to curtain walls and some interior walls", 145, 120, 167], ["Permanent structural deformation", 210, 181, 268]] },
  HRB: { number: 19, name: "High-rise building (more than 20 stories)", dods: [["Threshold of visible damage", 70, 58, 86], ["Loss of roof covering (<20%)", 86, 69, 107], ["Damage to penthouse roof and walls; loss of rooftop HVAC equipment", 93, 75, 111], ["Broken glass in exterior walls at 1st and 2nd floors; broken glass in entryways", 101, 83, 120], ["Damage to parapet walls or coping", 104, 87, 122], ["Broken curtain wall panel anchors", 129, 110, 157], ["Significant loss of roofing material (>20%)", 143, 115, 165], ["Significant damage to curtain walls and interior walls", 145, 123, 172], ["Uplift or collapse of roof structure", 159, 123, 183], ["Significant structural deformation", 228, 190, 290]] },
  IB: { number: 20, name: "Institutional building (hospital, government or university)", dods: [["Threshold of visible damage", 72, 59, 88], ["Loss of roof covering (<20%)", 86, 72, 109], ["Damage to penthouse roof and walls; loss of rooftop HVAC equipment", 92, 75, 111], ["Broken glass in windows or doors", 95, 78, 115], ["Uplift of lightweight roof deck and insulation; significant loss of roofing material (>20%)", 114, 95, 136], ["Facade components torn from structure", 118, 97, 140], ["Damage curtain walls or other wall cladding", 131, 110, 152], ["Uplift of pre-cast concrete roof slabs", 142, 119, 163], ["Uplift of metal deck with concrete fill slab", 146, 118, 170], ["Collapse of some top story exterior walls", 148, 127, 172], ["Significant damage to building envelope", 210, 178, 268]] },
  SSC: { number: 22, name: "Service station canopy", dods: [["Threshold of visible damage", 63, 45, 79], ["Fascia material blown from canopy", 78, 64, 96], ["Metal roof panels stripped from canopy", 92, 74, 113], ["Columns bend or buckle under wind load", 109, 88, 135], ["Canopy collapsed due to column foundation failure", 114, 90, 144], ["Complete destruction of canopy", 133, 110, 163]] },
  WHB: { number: 23, name: "Warehouse building (tilt-up walls or heavy timber)", dods: [["Threshold of visible damage", 68, 55, 83], ["Loss of roofing material (<20%)", 83, 69, 105], ["Inward or outward collapse of overhead doors", 88, 75, 107], ["Uplift of roof deck; significant loss of roofing material (>20%); loss of rooftop HVAC equipment", 103, 88, 122], ["Collapse of other non-bearing exterior walls", 114, 93, 126], ["Collapse of pre-cast concrete tilt-up panels", 124, 102, 144], ["Total destruction of a large section of building or entire building", 158, 131, 186]] },
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

// The game's buildings (roblox Shared/StormLab/Sim/Damage.DI, BuildingDamageService) name their
// indicators by these abbreviations, except the house and the farm building.
export const GAME_DI = Object.freeze({ house: 'FR12', barn: 'SBO', mobileHome: 'MHSW', tree: 'TH', pole: 'ETL' });
export const indicatorOf = gameDi => GAME_DI[gameDi] ?? (DAMAGE_INDICATORS[gameDi] ? gameDi : null);

// A real building's damage as a survey rates it: the degree it reached in the game (dod, from 1)
// and its build quality (0-1, the game's own draw for it): the wind estimated within the degree's
// bounds as damageAt does. Null for an indicator or degree the tables do not hold.
export function ratePoint(di, dod, quality = 0.5) {
  const row = DAMAGE_INDICATORS[di]?.dods?.[dod - 1];
  if (!row) return null;
  const [description, expected, lo, hi] = row;
  const capped = ['TH', 'TS', 'ETL'].includes(di) ? TREE_POLE_CAP_MPH : Infinity;
  const estimatedMph = Math.min(capped, Math.round((lo + (hi - lo) * quality) / 5) * 5);
  return { dod, description, expectedMph: expected, lowerMph: lo, upperMph: hi, estimatedMph, ef: efFromWind(estimatedMph) };
}
