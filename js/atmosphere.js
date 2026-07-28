import { Cell } from './cell.js?v=2.20.1';
import { SIMULATION_CONFIG } from './simulationConfig.js?v=2.20.1';

export class Atmosphere {
  constructor(width, height) {
    this.cellSizeKm = SIMULATION_CONFIG.cellSizeKm;
    this.cellSizeMiles = SIMULATION_CONFIG.cellSizeMiles;
    this.validHourUtc = SIMULATION_CONFIG.startHourUtc;
    this.resize(width, height);
  }

  resize(width, height) {
    this.width = width;
    this.height = height;
    this.domainWidthKm = width * this.cellSizeKm;
    this.domainWidthMiles = width * this.cellSizeMiles;
    this.domainHeightKm = height * this.cellSizeKm;
    this.domainHeightMiles = height * this.cellSizeMiles;
    this.cells = Array.from({ length: height }, (_, y) =>
      Array.from({ length: width }, (_, x) => new Cell(x, y))
    );
  }

  getCell(x, y) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return null;
    return this.cells[y][x];
  }

  getCellBoundsKm(x, y) {
    return { west: x * this.cellSizeKm, east: (x + 1) * this.cellSizeKm, north: y * this.cellSizeKm, south: (y + 1) * this.cellSizeKm };
  }

  forEachCell(callback) {
    for (let y = 0; y < this.height; y++) for (let x = 0; x < this.width; x++) callback(this.cells[y][x], x, y);
  }
}
