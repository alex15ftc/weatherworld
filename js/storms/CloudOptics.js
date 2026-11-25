// Cloud and rain optics: one source for the satellite's images (js/satellite/Satellite.js) and the light
// under a storm (js/storms/StormLight.js, the frames' and the scene's).
//   liquid  visible optical depth 1.5 LWP / r_e (r_e 10 um), per g/m2 of liquid water path
//   ice     IWP (-6.656e-3 + 3.686 / D_ge) (Fu 1996, D_ge 50 um): about 0.067 per g/m2
//   g       the asymmetry of cloud scattering, 0.85
//   diffuse transmittance, two-stream: 1 / (1 + 0.75 (1 - g) tau) (no absorption; a thick cloud of
//           optical depth 50-200 passes 15-4% of the light on it)
//   rain    Marshall-Palmer: water content M = 0.072 R^0.88 g/m3 at R mm/h, drops exponential in size with
//           Lambda = 4.1 R^-0.21 /mm, so r_e = 3 / Lambda; extinction 1.5 M / (rho_w r_e) - about 2 /km at
//           50 mm/h (visibility ~2 km in heavy rain)
//   snow    falling from a stratiform deck at ~1 m/s (aggregates 1-1.5 m/s: Locatelli & Hobbs 1974)
export const CLOUD_OPTICS = Object.freeze({ reUm: 10, dgeUm: 50, g: 0.85, snowFallMs: 1 });

export const TAU_LIQUID_PER_GM2 = 1.5 / CLOUD_OPTICS.reUm;
export const TAU_ICE_PER_GM2 = 3.686 / CLOUD_OPTICS.dgeUm - 6.656e-3;
export const diffuseTransmittance = tau => 1 / (1 + 0.75 * (1 - CLOUD_OPTICS.g) * Math.max(0, Number(tau) || 0));
export const rainWaterGm3 = mmh => (mmh > 0 ? 0.072 * mmh ** 0.88 : 0);
// Rain's extinction (per km).
export function rainExtinctionPerKm(mmh) {
  if (!(mmh > 0)) return 0;
  const reM = 3 / (4.1 * mmh ** -0.21) * 1e-3;
  return 1.5 * rainWaterGm3(mmh) * 1e-3 / (1000 * reM) * 1000;
}
