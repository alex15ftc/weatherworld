export class Boundary {
  constructor({ id, type, pointsKm, velocityKph, strength = 0.65, widthKm = 28, ageHours = 0 }) {
    this.id = id;
    this.type = type;
    this.pointsKm = pointsKm.map(point => ({ x: point.x, y: point.y }));
    this.velocityKph = { east: velocityKph.east, north: velocityKph.north };
    this.strength = strength;
    this.widthKm = widthKm;
    this.ageHours = ageHours;
    this.active = true;
  }
}
