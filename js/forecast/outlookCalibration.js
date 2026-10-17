// Calibration of the outlooks' chances (agenda step 5 of the 2026-10-16 plan). The runs'
// average chance of a hazard near a place is not the chance it then happens there: averaged and
// spread out, the runs' chances run low (a Day 1 area at 30% for tornadoes verified about half
// the time), so Moderate was issued on 8% of days that verified Moderate on 20%. As forecast
// centres do with their guidance, the raw chance is mapped to the chance that verified, from a
// record of outlooks set against what happened (scripts/outlook-verify.mjs --calibration-data;
// fitted by scripts/fit-outlook-calibration.mjs): for each outlook day and hazard, points
// [raw chance, chance that verified] (percent), joined by straight lines, never falling. This
// changes what is issued, never the weather. A hazard with no points is issued as it is.
// Fitted 2026-10-16 on 40 mornings (seeds 1-8, 5 each) and checked on 40 others (seeds 9-16):
// Day 1 and Day 2 only. Day 3, made from two runs, did not carry over to the other seeds (its
// higher levels verified at half their value and its category within one fell from 83% to 75%),
// so it is issued as it is.
export const CALIBRATION = Object.freeze({"day1": {"tornado":[[1.5,1], [3.2,2.6], [6.2,4.2], [8.7,7.4], [11.2,7.6], [13.6,10.5], [17.3,15.9], [22.3,21.5], [27.4,37.3], [36,56.6]],
  "wind":[[2,0.4], [5.4,0.7], [8.7,2.3], [11.2,3.8], [13.7,6.6], [17.4,15.6], [22.4,20.1], [27.4,27.1], [34.9,44.9], [44.9,73], [54.8,85.8], [66.8,92.4], [81.3,99.1]],
  "hail":[[1.5,0.3], [2.7,0.5], [4.2,1.5], [6.2,3.5], [8.7,6.6], [11.2,7.3], [13.7,7.8], [17.4,10.2], [22.5,17.2], [27.4,25.2], [34.8,43.8], [44.6,63.3], [54.8,78.2], [66.9,88.6], [81.5,93.5]]},"day2": {"tornado":[[1.4,1.1], [2.7,1.9], [5.3,3.6], [8.7,6.5], [11.2,9.5], [13.7,10.1], [17.4,13.6], [22.4,24], [27,28.5], [36.9,38.2]],
  "wind":[[1.5,2.5], [2.7,3.7], [4.2,4.6], [6.2,6.5], [8.7,11.5], [11.2,15.9], [13.7,19.2], [17.4,23.5], [22.4,30.5], [27.5,36.9], [34.6,44.8], [44.4,53.7], [54.2,67], [66.9,84.1]],
  "hail":[[1.5,0.6], [2.7,2.7], [4.2,3.5], [6.2,7.2], [9.9,9.4], [13.8,11], [17.5,16.3], [22.5,29.7], [27.4,40.4], [34.8,42.5], [44.5,53.6], [54.6,64.9], [65.6,71.6]]}});

// The calibrated chance (percent) for a raw one.
export function calibrateChance(day, hazard, raw, table = CALIBRATION) {
  const points = table[day]?.[hazard];
  if (!points?.length || !(raw > 0)) return raw;
  if (raw <= points[0][0]) return raw * points[0][1] / Math.max(1e-6, points[0][0]);
  for (let k = 1; k < points.length; k++) if (raw <= points[k][0]) { const [x0, y0] = points[k - 1], [x1, y1] = points[k]; return y0 + (y1 - y0) * (raw - x0) / Math.max(1e-6, x1 - x0); }
  return Math.min(100, points.at(-1)[1]);
}
