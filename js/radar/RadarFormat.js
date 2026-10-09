// Radar scan format shared by the authority (which simulates scans) and the radar viewer
// (which renders them). Every product is one byte per gate; byte 0 means "no echo".

export const RADAR_RADIALS = 720;            // 0.5° super-resolution azimuths
export const RADAR_GATE_KM = 0.5;
export const RADAR_RANGE_KM = 230;
export const RADAR_GATES = Math.round(RADAR_RANGE_KM / RADAR_GATE_KM);
export const RADAR_BEAMWIDTH_DEG = 0.95;
export const RADAR_TILTS_DEG = [0.5, 0.9, 1.3, 1.8, 2.4, 3.1, 4.0, 5.1, 6.4];
export const RADAR_ANTENNA_HEIGHT_M = 30;

const EFFECTIVE_EARTH_RADIUS_KM = 6371 * 4 / 3;

// Height of the beam centre above the antenna (4/3 effective-earth model).
export function beamHeightKm(slantRangeKm, elevationDeg) {
  const r = slantRangeKm, re = EFFECTIVE_EARTH_RADIUS_KM, s = Math.sin(elevationDeg * Math.PI / 180);
  return Math.sqrt(r * r + re * re + 2 * r * re * s) - re;
}

export function groundRangeKm(slantRangeKm, elevationDeg) {
  const re = EFFECTIVE_EARTH_RADIUS_KM, h = beamHeightKm(slantRangeKm, elevationDeg);
  return re * Math.asin(slantRangeKm * Math.cos(elevationDeg * Math.PI / 180) / (re + h));
}

export const RADAR_PRODUCTS = {
  reflectivity: {
    label: 'Base reflectivity', short: 'REF', units: 'dBZ', min: -32, step: 0.5, decimals: 1,
    stops: [[-12, 70, 70, 90, 0], [-5, 90, 90, 110, 70], [5, 4, 233, 231, 255], [10, 1, 159, 244, 255], [15, 3, 0, 244, 255],
      [20, 2, 253, 2, 255], [25, 1, 197, 1, 255], [30, 0, 142, 0, 255], [35, 253, 248, 2, 255], [40, 229, 188, 0, 255],
      [45, 253, 149, 0, 255], [50, 253, 0, 0, 255], [55, 212, 0, 0, 255], [60, 188, 0, 0, 255], [65, 248, 0, 253, 255],
      [70, 152, 84, 198, 255], [75, 253, 253, 253, 255], [95, 255, 255, 255, 255]],
    legend: [5, 20, 35, 50, 65, 75]
  },
  velocity: {
    label: 'Base velocity', short: 'VEL', units: 'm/s', min: -63.5, step: 0.5, decimals: 1,
    stops: [[-63.5, 120, 255, 255, 255], [-40, 0, 255, 90, 255], [-25, 0, 200, 40, 255], [-10, 0, 120, 20, 255], [-1, 40, 75, 45, 255],
      [0, 115, 110, 110, 255], [1, 80, 35, 40, 255], [10, 140, 0, 15, 255], [25, 215, 0, 25, 255], [40, 255, 70, 70, 255], [63.5, 255, 210, 170, 255]],
    legend: [-50, -25, 0, 25, 50]
  },
  stormRelativeVelocity: {
    label: 'Storm-relative velocity', short: 'SRV', units: 'm/s', min: -63.5, step: 0.5, decimals: 1,
    stops: null, // shares the velocity table
    legend: [-50, -25, 0, 25, 50]
  },
  correlationCoefficient: {
    label: 'Correlation coefficient', short: 'CC', units: 'ρhv', min: 0.2, step: 0.0035, decimals: 3,
    stops: [[0.2, 20, 20, 95, 255], [0.45, 60, 80, 200, 255], [0.65, 100, 190, 240, 255], [0.75, 90, 220, 100, 255], [0.85, 240, 230, 60, 255],
      [0.9, 250, 150, 30, 255], [0.95, 230, 40, 40, 255], [0.97, 175, 20, 95, 255], [1.0, 240, 170, 230, 255], [1.09, 255, 255, 255, 255]],
    legend: [0.2, 0.6, 0.8, 0.9, 0.97, 1.0]
  },
  differentialReflectivity: {
    label: 'Differential reflectivity', short: 'ZDR', units: 'dB', min: -4, step: 0.05, decimals: 2,
    stops: [[-4, 60, 60, 60, 255], [-1, 120, 120, 140, 255], [0, 200, 200, 200, 255], [0.5, 80, 80, 220, 255], [1, 60, 170, 240, 255],
      [1.5, 70, 220, 140, 255], [2, 90, 220, 60, 255], [2.5, 240, 240, 60, 255], [3, 250, 170, 40, 255], [4, 240, 60, 40, 255],
      [5, 200, 30, 120, 255], [6, 250, 150, 220, 255], [8.7, 255, 255, 255, 255]],
    legend: [-1, 0, 1, 2, 3, 5]
  }
};
RADAR_PRODUCTS.stormRelativeVelocity.stops = RADAR_PRODUCTS.velocity.stops;
export const RADAR_PRODUCT_KEYS = Object.keys(RADAR_PRODUCTS);

export function encodeRadarValue(product, value) {
  const spec = RADAR_PRODUCTS[product];
  return Math.max(1, Math.min(255, 1 + Math.round((value - spec.min) / spec.step)));
}

export function decodeRadarValue(product, byte) {
  if (!byte) return null;
  const spec = RADAR_PRODUCTS[product];
  return spec.min + (byte - 1) * spec.step;
}

// 256-entry RGBA lookup table for a product; entry 0 is transparent.
export function radarColorTable(product) {
  const stops = RADAR_PRODUCTS[product].stops;
  const lut = new Uint8Array(256 * 4);
  for (let b = 1; b < 256; b++) {
    const v = decodeRadarValue(product, b);
    let j = 0;
    while (j < stops.length - 2 && v > stops[j + 1][0]) j++;
    const a = stops[j], c = stops[j + 1];
    const t = Math.max(0, Math.min(1, (v - a[0]) / (c[0] - a[0] || 1)));
    for (let k = 0; k < 4; k++) lut[b * 4 + k] = Math.round(a[k + 1] + (c[k + 1] - a[k + 1]) * t);
  }
  return lut;
}
