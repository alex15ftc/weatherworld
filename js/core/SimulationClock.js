export const DEFAULT_CADENCES = Object.freeze({
  synoptic: 20 * 60, mesoscale: 3 * 60, storms: 5, visuals: 0, outlooks: 6 * 60 * 60
});

export class SimulationClock {
  constructor(cadences = DEFAULT_CADENCES) {
    this.elapsedSeconds = 0;
    this.cadences = { ...DEFAULT_CADENCES, ...cadences };
    this.accumulators = Object.fromEntries(Object.keys(this.cadences).map(key => [key, 0]));
  }

  advance(deltaSeconds) {
    const delta = Math.max(0, Number(deltaSeconds) || 0);
    this.elapsedSeconds += delta;
    const due = {};
    for (const [layer, cadence] of Object.entries(this.cadences)) {
      if (cadence === 0) { due[layer] = 1; continue; }
      this.accumulators[layer] += delta;
      due[layer] = Math.floor(this.accumulators[layer] / cadence);
      this.accumulators[layer] -= due[layer] * cadence;
    }
    return due;
  }
}
