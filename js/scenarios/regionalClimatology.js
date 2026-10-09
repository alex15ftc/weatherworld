export const REGIONS = [
  { id: 'NW_HIGH_PLAINS', label: 'Northwest High Plains', shortLabel: 'NW High Plains', elevationClass: 'high', dewpointBaselineF: 52, emlFrequency: 0.88, moistureRecovery: 0.62 },
  { id: 'SW_HIGH_PLAINS', label: 'Southwest High Plains', shortLabel: 'SW High Plains', elevationClass: 'high', dewpointBaselineF: 55, emlFrequency: 0.94, moistureRecovery: 0.68 },
  { id: 'N_CENTRAL_PLAINS', label: 'North-Central Plains', shortLabel: 'N-Central Plains', elevationClass: 'mid', dewpointBaselineF: 58, emlFrequency: 0.72, moistureRecovery: 0.82 },
  { id: 'S_CENTRAL_PLAINS', label: 'South-Central Plains', shortLabel: 'S-Central Plains', elevationClass: 'mid', dewpointBaselineF: 63, emlFrequency: 0.76, moistureRecovery: 0.94 },
  { id: 'NE_LOW_PLAINS', label: 'Northeast Low Plains', shortLabel: 'NE Low Plains', elevationClass: 'low', dewpointBaselineF: 61, emlFrequency: 0.48, moistureRecovery: 1.02 },
  { id: 'SE_LOW_PLAINS', label: 'Southeast Low Plains', shortLabel: 'SE Low Plains', elevationClass: 'low', dewpointBaselineF: 67, emlFrequency: 0.42, moistureRecovery: 1.15 }
];

const BY_ID = new Map(REGIONS.map(region => [region.id, region]));

function regionCentroid(world, id) {
  let xSum = 0, ySum = 0, count = 0;
  world.forEachCell((cell, x, y) => {
    if (cell.features.regionId !== id) return;
    xSum += x + 0.5; ySum += y + 0.5; count += 1;
  });
  return count ? { x: xSum / count, y: ySum / count } : { x: 0, y: 0 };
}
