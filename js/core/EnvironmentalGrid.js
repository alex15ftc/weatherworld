export const ENVIRONMENT_FIELDS = Object.freeze([
  'temperature2m', 'dewpoint2m', 'pressure', 'mlcape', 'mlcin', 'lcl',
  'shear01km', 'shear06km', 'srh01km', 'srh03km', 'lapseRate700500',
  'effectiveInflowDepth', 'forcing', 'convergence', 'lift',
  'initiationPotential', 'stormCoveragePotential', 'severePotential',
  'availableInstability', 'moistureSupply', 'coldPool', 'stabilization'
]);

export const UPDATE_TIER = Object.freeze({ DORMANT: 0, POTENTIAL: 1, ACTIVE: 2 });

export class EnvironmentalGrid {
  constructor({ width = 100, height = 100, cellSizeKm = 10 } = {}) {
    if (width <= 0 || height <= 0 || cellSizeKm <= 0) throw new RangeError('Grid dimensions and cell size must be positive.');
    this.width = Math.floor(width);
    this.height = Math.floor(height);
    this.cellSizeKm = cellSizeKm;
    this.cellCount = this.width * this.height;
    this.fields = Object.fromEntries(ENVIRONMENT_FIELDS.map(name => [name, new Float32Array(this.cellCount)]));
    this.previous = Object.fromEntries(ENVIRONMENT_FIELDS.map(name => [name, new Float32Array(this.cellCount)]));
    this.updateTier = new Uint8Array(this.cellCount);
    this.activeStormCount = new Uint8Array(this.cellCount);
    this.boundaryMask = new Uint16Array(this.cellCount);
    this.fields.availableInstability.fill(1);
    this.fields.moistureSupply.fill(1);
  }

  index(x, y) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return -1;
    return Math.floor(y) * this.width + Math.floor(x);
  }

  beginUpdate() {
    for (const name of ENVIRONMENT_FIELDS) this.previous[name].set(this.fields[name]);
  }

  sample(field, x, y, interpolation = 1) {
    const index = this.index(x, y);
    if (index < 0 || !this.fields[field]) return null;
    const progress = Math.max(0, Math.min(1, interpolation));
    return this.previous[field][index] + (this.fields[field][index] - this.previous[field][index]) * progress;
  }

  classifyTiers() {
    const initiation = this.fields.initiationPotential;
    const severe = this.fields.severePotential;
    for (let i = 0; i < this.cellCount; i++) {
      this.updateTier[i] = this.activeStormCount[i] > 0 || initiation[i] > .55
        ? UPDATE_TIER.ACTIVE
        : severe[i] > .25 ? UPDATE_TIER.POTENTIAL : UPDATE_TIER.DORMANT;
    }
  }
}
