// How the satellite images (js/satellite/Satellite.js) are stored and coloured: one byte a pixel,
// 0 for no data. Clean IR (GOES ABI band 13, 10.3 um) as brightness temperature in degrees C;
// visible (band 2, 0.64 um) as reflectance, stored as its square root, the usual stretch for
// display (the eye reads it that way: thin cloud and the ground stay apart from bright tops).

export const SATELLITE_PRODUCTS = Object.freeze({
  // The enhanced IR scale forecasters read storm tops on: greys for anything warmer than -20 C
  // (ground and low cloud, warm dark), then blue, green, yellow and orange to red at -60 to -70 C,
  // dark red, white near -80 C and magenta for the coldest overshooting tops.
  ir: {
    label: 'Clean IR (10.3 µm)', short: 'IR', units: '°C', min: -110, step: 0.6, decimals: 1,
    stops: [[-110, 255, 170, 255], [-90, 200, 0, 220], [-80, 255, 255, 255], [-72, 120, 0, 0], [-64, 230, 0, 0], [-58, 255, 140, 0],
      [-52, 255, 240, 0], [-42, 0, 180, 60], [-31, 0, 190, 255], [-20.3, 0, 90, 200], [-20, 215, 215, 215], [42, 12, 12, 12]],
    legend: [-90, -80, -70, -60, -50, -40, -30, -20, 0, 20]
  },
  visible: {
    label: 'Visible (0.64 µm)', short: 'VIS', units: '%', sqrt: true, decimals: 0,
    stops: [[0, 0, 0, 0], [1, 255, 255, 255]],
    legend: [5, 20, 40, 60, 80, 100]
  }
});
export const SATELLITE_KINDS = Object.keys(SATELLITE_PRODUCTS);

// A value (IR: degrees C; visible: reflectance 0-1) as its byte, and back.
export function encodeSatelliteValue(product, value) {
  const spec = SATELLITE_PRODUCTS[product];
  if (spec.sqrt) return 1 + Math.round(254 * Math.sqrt(Math.max(0, Math.min(1, value))));
  return Math.max(1, Math.min(255, 1 + Math.round((value - spec.min) / spec.step)));
}
export function decodeSatelliteValue(product, byte) {
  if (!byte) return null;
  const spec = SATELLITE_PRODUCTS[product];
  return spec.sqrt ? ((byte - 1) / 254) ** 2 : spec.min + (byte - 1) * spec.step;
}

// 256-entry RGBA table; entry 0 (no data) is clear. (Visible: grey of the stretched value.)
export function satelliteColorTable(product) {
  const spec = SATELLITE_PRODUCTS[product], lut = new Uint8Array(256 * 4);
  for (let b = 1; b < 256; b++) {
    if (spec.sqrt) { const g = Math.round(255 * (b - 1) / 254); lut.set([g, g, g, 255], b * 4); continue; }
    const v = decodeSatelliteValue(product, b), s = spec.stops;
    let j = 0;
    while (j < s.length - 2 && v > s[j + 1][0]) j++;
    const a = s[j], c = s[j + 1], t = Math.max(0, Math.min(1, (v - a[0]) / (c[0] - a[0] || 1)));
    for (let k = 0; k < 3; k++) lut[b * 4 + k] = Math.round(a[k + 1] + (c[k + 1] - a[k + 1]) * t);
    lut[b * 4 + 3] = 255;
  }
  return lut;
}
