export const MILES_TO_KM = 1.609344;
export const CELL_SIZE_MILES = 10;
export const CELL_SIZE_KM = CELL_SIZE_MILES * MILES_TO_KM;

export const SIMULATION_CONFIG = Object.freeze({
  cellSizeMiles: CELL_SIZE_MILES,
  cellSizeKm: CELL_SIZE_KM,
  fixedColumns: 50,
  fixedRows: 50,
  minColumns: 50,
  minRows: 50,
  maxColumns: 50,
  maxRows: 50,
  defaultColumns: 50,
  defaultRows: 50,
  startHourUtc: 12,
  endHourUtc: 30,
  timestepHours: 1
});
