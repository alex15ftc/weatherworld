export const REAL_MS_PER_SIM_STEP = 120_000;
export const SIM_HOURS_PER_STEP = 0.5;
export const MAX_CATCHUP_STEPS = 1008; // 21 simulated days; prevents pathological browser stalls.

export class WeatherAuthorityClock {
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
  }

  dueSteps(state, at = this.now()) {
    const anchor = Number(state?.authorityRealTimestamp ?? state?.updatedAt ?? at);
    const elapsed = Math.max(0, at - anchor);
    return Math.min(MAX_CATCHUP_STEPS, Math.floor(elapsed / REAL_MS_PER_SIM_STEP));
  }

  consume(state, steps, at = this.now()) {
    const safeSteps = Math.max(0, Math.floor(Number(steps) || 0));
    const anchor = Number(state?.authorityRealTimestamp ?? state?.updatedAt ?? at);
    return {
      authorityRealTimestamp: safeSteps > 0 ? anchor + safeSteps * REAL_MS_PER_SIM_STEP : Math.min(anchor, at),
      simulatedHoursAdvanced: safeSteps * SIM_HOURS_PER_STEP
    };
  }

  nextTickInMs(state, at = this.now()) {
    const anchor = Number(state?.authorityRealTimestamp ?? state?.updatedAt ?? at);
    const elapsed = Math.max(0, at - anchor);
    const remainder = elapsed % REAL_MS_PER_SIM_STEP;
    return remainder === 0 ? REAL_MS_PER_SIM_STEP : REAL_MS_PER_SIM_STEP - remainder;
  }
}
