import { clamp01 } from './random.js';

export class ConvectiveBudget {
  constructor(grid) {
    this.grid = grid;
  }

  consumeAt(index, { overturning = .02, precipitation = .01, coldPool = .03 } = {}) {
    const f = this.grid.fields;
    f.availableInstability[index] = clamp01(f.availableInstability[index] - overturning);
    f.moistureSupply[index] = clamp01(f.moistureSupply[index] - precipitation);
    f.coldPool[index] = clamp01(f.coldPool[index] + coldPool);
    f.stabilization[index] = clamp01(f.stabilization[index] + overturning * .8);
  }

  recover(deltaHours) {
    const f = this.grid.fields;
    for (let i = 0; i < this.grid.cellCount; i++) {
      f.availableInstability[i] = clamp01(f.availableInstability[i] + deltaHours * .012);
      f.moistureSupply[i] = clamp01(f.moistureSupply[i] + deltaHours * .007);
      f.coldPool[i] = clamp01(f.coldPool[i] - deltaHours * .06);
      f.stabilization[i] = clamp01(f.stabilization[i] - deltaHours * .035);
    }
  }
}
