import { clamp } from './scenarios/math.js?v=2.20.1';

const RISK_ORDER = ['TSTM', 'MRGN', 'SLGT', 'ENH', 'MDT', 'HIGH'];
const RISK_COLORS = { TSTM: '#c1e9c1', MRGN: '#66a366', SLGT: '#ffe066', ENH: '#ffa366', MDT: '#e06666', HIGH: '#ee99ee' };
// Colors sampled from the operational-style SPC probability legends.
// Tornado uniquely uses green for 2% and brown for 5%.
const TORNADO_PROBABILITY_COLORS = {
  0: '#17202a',
  2: '#79ba7a',
  5: '#bd998a',
  10: '#ffe481',
  15: '#ff8080',
  30: '#ff80ff',
  45: '#c896f7',
  60: '#8080ff'
};

const WIND_HAIL_PROBABILITY_COLORS = {
  0: '#17202a',
  5: '#c5a392',
  15: '#ffeb7f',
  30: '#ff7f7f',
  45: '#ff7fff',
  60: '#c896f7',
  75: '#8080ff',
  90: '#80ffff'
};

const LAYERS = {
  risk: { label: 'Categorical outlook', units: '', min: 0, max: 5, stops: Object.values(RISK_COLORS), categorical: true, contour: 'risk' },
  tornadoRisk: { label: 'Tornado probability', units: '%', min: 0, max: 60, stops: Object.values(TORNADO_PROBABILITY_COLORS), probability: true, contour: 'probability' },
  hailRisk: { label: 'Hail probability', units: '%', min: 0, max: 60, stops: Object.values(WIND_HAIL_PROBABILITY_COLORS).slice(0, 6), probability: true, contour: 'probability' },
  windRisk: { label: 'Wind probability', units: '%', min: 0, max: 90, stops: Object.values(WIND_HAIL_PROBABILITY_COLORS), probability: true, contour: 'probability' },
  temperature: { label: 'Surface temperature', units: '°F', min: 35, max: 105, stops: ['#3d5ba9','#6aa6d9','#d5e9ec','#f4d35e','#ee964b','#c53b32'] },
  dewpoint: { label: 'Surface dewpoint', units: '°F', min: 15, max: 80, stops: ['#7a4c2a','#b88a56','#d7cf91','#77b255','#287a3d','#073b24'] },
  pressure: { label: 'Surface pressure', units: 'mb', min: 988, max: 1024, stops: ['#6f2dbd','#3155a4','#47a6c6','#cce5df','#f4d35e','#ef8354'] },
  cape: { label: 'CAPE', units: 'J/kg', min: 0, max: 6000, stops: ['#25282c','#5d8f35','#e5d84a','#f08a35','#d83232','#8736a5'] },
  cin: { label: 'CIN', units: 'J/kg', min: 0, max: 200, stops: ['#f4f4f4','#8bd3dd','#4d96d7','#5342a8','#24124d'] },
  srh: { label: '0–1 km SRH', units: 'm²/s²', min: 0, max: 750, stops: ['#26272a','#457b9d','#a8dadc','#f4a261','#e63946','#761f86'] },
  bulkShear: { label: '0–6 km bulk shear', units: 'kt', min: 0, max: 90, stops: ['#292b2f','#3b82a0','#55b98f','#d6d645','#f28c28','#bd2b38'] },
  vtp: { label: 'Violent tornado parameter', units: '', min: 0, max: 5, stops: ['#27282c','#355c7d','#5b6fb5','#9b59b6','#e74c3c','#ff9f43'] },
  stp: { label: 'Significant tornado parameter', units: '', min: 0, max: 12, stops: ['#27282c','#4d7f4b','#e4d84c','#f29e3d','#d93b3b','#812091'] },
  forcing: { label: 'Forcing score', units: '', min: 0, max: 1, stops: ['#20242a','#325d7d','#49a6a1','#d7cf5c','#e57b36','#b72e4c'] },
  readiness: { label: 'Convective readiness', units: '%', min: 0, max: 100, stops: ['#20242a','#355f8d','#55aa82','#ded85c','#ee8736','#c22c45'] },
  trigger: { label: 'Trigger strength', units: '%', min: 0, max: 100, stops: ['#20242a','#355f8d','#55aa82','#ded85c','#ee8736','#c22c45'] },
  initiation: { label: 'Convective initiation potential', units: '%', min: 0, max: 100, stops: ['#20242a','#355f8d','#55aa82','#ded85c','#ee8736','#c22c45'] },
  initiationForecast: { label: 'Forecast initiation probability', units: '%', min: 0, max: 100, stops: ['#20242a','#355f8d','#55aa82','#ded85c','#ee8736','#c22c45'] },
  stormCoverage: { label: 'Expected storm coverage', units: '%', min: 0, max: 100, stops: ['#20242a','#385c86','#49a5b8','#8bc66e','#e4d257','#ec704d'] },
  supercellFraction: { label: 'Expected supercell fraction', units: '%', min: 0, max: 100, stops: ['#20242a','#3c5f85','#5a9d96','#c6c75a','#e38a40','#b73755'] },
  linearFraction: { label: 'Expected linear-storm fraction', units: '%', min: 0, max: 100, stops: ['#20242a','#3c5f85','#5a9d96','#c6c75a','#e38a40','#b73755'] },
  tornadoIntensity: { label: 'Conditional tornado intensity', units: '%', min: 0, max: 120, stops: ['#20242a','#355f8d','#55aa82','#ded85c','#ee8736','#c22c45'] },
  hailIntensity: { label: 'Conditional hail intensity', units: '%', min: 0, max: 120, stops: ['#20242a','#355f8d','#55aa82','#ded85c','#ee8736','#c22c45'] },
  windIntensity: { label: 'Conditional wind intensity', units: '%', min: 0, max: 120, stops: ['#20242a','#355f8d','#55aa82','#ded85c','#ee8736','#c22c45'] },
  verticalMotion: { label: 'Diagnosed vertical motion', units: 'm/s', min: 0, max: 1.25, stops: ['#20242a','#385c86','#49a5b8','#8bc66e','#e4d257','#ec704d'] },
  emlInfluence: { label: 'Elevated mixed layer influence', units: '%', min: 0, max: 100, stops: ['#20242a','#65523d','#9d7045','#d49a4a','#e8c56a','#f4e3a1'] },
  lapseRate: { label: '700–500 mb lapse rate', units: '°C/km', min: 5, max: 9.5, stops: ['#315b7d','#5c9ca8','#b7c979','#e4c55f','#df7e3f','#b73232'] },
  airMass: { label: 'Air mass class', units: '', min: 0, max: 5, stops: ['#5383b8','#70a9c7','#c6a879','#d9c85e','#67a66b','#a67bb8'] },
  coherence: { label: 'Synoptic coherence', units: '%', min: 0, max: 100, stops: ['#8f2331','#cf653f','#e2bd54','#9fca72','#4e9b77','#336f68'] },
  windSurface: { label: 'Surface wind', units: 'kt', min: 0, max: 45, stops: ['#20242a','#365f8d','#50a4b8','#94c96d','#e6d65d','#eb6f4b'], wind: 'surface' },
  wind800: { label: '800 mb wind', units: 'kt', min: 0, max: 75, stops: ['#20242a','#365f8d','#50a4b8','#94c96d','#e6d65d','#eb6f4b'], wind: 800 },
  wind500: { label: '500 mb wind', units: 'kt', min: 0, max: 100, stops: ['#20242a','#365f8d','#50a4b8','#94c96d','#e6d65d','#eb6f4b'], wind: 500 },
  wind250: { label: '250 mb wind', units: 'kt', min: 0, max: 170, stops: ['#20242a','#365f8d','#50a4b8','#94c96d','#e6d65d','#eb6f4b'], wind: 250 }
};

export class Renderer {
  constructor(canvas, atmosphere) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.atmosphere = atmosphere;
    this.cellSize = 58;
    this.showFeatures = true;
    this.showRegions = true;
    this.showRegionLabels = true;
    this.showGrid = true;
    this.smoothGeometry = true;
    this.hoverCell = null;
    this.selectedCell = null;
    this.stateKey = 'initial';
    this.forecastDay = 'day1';
    this.colorLuts = buildColorLuts();
    this.resize();
  }

  setStateKey(key) {
    this.stateKey = String(key);
  }

  clearCache() {
    // Retained for compatibility with state restoration. The direct grid renderer
    // does not cache bitmap frames.
  }

  resize() {
    const maxMap = 900;
    this.cellSize = Math.max(12, Math.min(70, Math.floor(maxMap / Math.max(this.atmosphere.width, this.atmosphere.height))));
    this.canvas.width = this.atmosphere.width * this.cellSize;
    this.canvas.height = this.atmosphere.height * this.cellSize;
    this.clearCache();
  }

  getLayerInfo(layer) { return LAYERS[layer] ?? LAYERS.temperature; }

  draw(layer, { fast = false } = {}) {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.drawAtmosphericField(layer);

    const info = this.getLayerInfo(layer);
    const cellCount = this.atmosphere.width * this.atmosphere.height;
    const allowDenseDetail = cellCount <= 1600;

    if (!fast && allowDenseDetail && this.cellSize >= 31 && !info.wind) {
      this.atmosphere.forEachCell((cell, x, y) => {
        this.drawCellLabel(cell, x, y, layer, this.valueForLayer(cell, layer), info);
      });
    }

    if (info.wind) this.drawWindField(info.wind, fast);
    if (!fast && info.contour === 'risk') this.drawRiskContours();
    if (!fast && info.contour === 'probability') {
      this.drawProbabilityContours(layer);
      this.drawConditionalIntensity(layer);
    }
    if (!fast && this.showFeatures) {
      this.drawFeatures();
      this.drawMesoscaleBoundaryObjects();
    }
    if (!fast && (this.showRegions || this.showRegionLabels)) this.drawRegions();
    this.drawStorms(fast);
    this.drawSelection();
  }

  drawAtmosphericField(layer) {
    const info = this.getLayerInfo(layer);
    const width = this.atmosphere.width, height = this.atmosphere.height;
    if (!this.fieldRaster || this.fieldRaster.width !== width || this.fieldRaster.height !== height) {
      this.fieldRaster = typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(width, height)
        : document.createElement('canvas');
      this.fieldRaster.width = width;
      this.fieldRaster.height = height;
      this.fieldRasterContext = this.fieldRaster.getContext('2d', { alpha: false, willReadFrequently: false });
      this.fieldImageData = this.fieldRasterContext.createImageData(width, height);
    }
    const pixels = this.fieldImageData.data;
    let offset = 0;
    for (let y = 0; y < height; y++) {
      const row = this.atmosphere.cells[y];
      for (let x = 0; x < width; x++) {
        const cell = row[x];
        const color = this.colorForLayer(cell, layer, this.valueForLayer(cell, layer), info);
        const rgb = parseHexColor(color);
        pixels[offset++] = rgb[0]; pixels[offset++] = rgb[1]; pixels[offset++] = rgb[2]; pixels[offset++] = 255;
      }
    }
    this.fieldRasterContext.putImageData(this.fieldImageData, 0, 0);
    this.ctx.save();
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(this.fieldRaster, 0, 0, width, height, 0, 0, this.canvas.width, this.canvas.height);
    this.ctx.restore();
    if (this.showGrid) this.drawGridLines();
  }

  drawGridLines() {
    const ctx = this.ctx;
    ctx.strokeStyle = 'rgba(8,12,18,.24)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 1; x < this.atmosphere.width; x++) {
      const px = x * this.cellSize + 0.5;
      ctx.moveTo(px, 0); ctx.lineTo(px, this.canvas.height);
    }
    for (let y = 1; y < this.atmosphere.height; y++) {
      const py = y * this.cellSize + 0.5;
      ctx.moveTo(0, py); ctx.lineTo(this.canvas.width, py);
    }
    ctx.stroke();
  }

  drawWindField(level, fast) {
    const dimension = Math.max(this.atmosphere.width, this.atmosphere.height);
    const stride = fast
      ? (dimension >= 75 ? 6 : dimension >= 50 ? 5 : dimension >= 30 ? 3 : 2)
      : (dimension >= 100 ? 6 : dimension >= 75 ? 5 : dimension >= 50 ? 4 : dimension >= 30 ? 2 : 1);
    for (let y = 0; y < this.atmosphere.height; y += stride) {
      for (let x = 0; x < this.atmosphere.width; x += stride) {
        this.drawWindBarb(this.atmosphere.cells[y][x], x, y, level);
      }
    }
  }

  forecastForCell(cell) { return cell.predictiveOutlook?.[this.forecastDay] ?? null; }

  displayedRisk(cell) { return this.forecastForCell(cell)?.risk ?? cell.derived.risk; }

  colorForLayer(cell, layer, value, info) {
    if (layer === 'risk') return RISK_COLORS[this.displayedRisk(cell)];
    if (info.probability) return probabilityColor(value, layer);
    const lut = this.colorLuts.get(layer);
    const t = clamp((value - info.min) / (info.max - info.min), 0, 1);
    return lut[Math.min(255, Math.max(0, Math.round(t * 255)))];
  }

  fillForLayer(cell, layer, value, info) {
    if (layer === 'risk') return RISK_COLORS[this.displayedRisk(cell)];
    if (info.probability) return probabilityColor(value, layer);
    return colorScale(value, info.min, info.max, info.stops);
  }

  drawCellLabel(cell, x, y, layer, value, info) {
    const ctx = this.ctx;
    let text = formatValue(value, layer);
    if (layer === 'risk') text = this.displayedRisk(cell);
    if (info.probability) text = `${value}%`;
    ctx.font = `700 ${Math.max(9, this.cellSize * .18)}px ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(2, this.cellSize * .05);
    ctx.strokeStyle = 'rgba(0,0,0,.7)';
    ctx.strokeText(text, x * this.cellSize + this.cellSize / 2, y * this.cellSize + this.cellSize / 2);
    ctx.fillStyle = '#fff';
    ctx.fillText(text, x * this.cellSize + this.cellSize / 2, y * this.cellSize + this.cellSize / 2);
  }

  valueForLayer(cell, layer) {
    switch (layer) {
      case 'risk': return RISK_ORDER.indexOf(this.displayedRisk(cell));
      case 'tornadoRisk': return this.forecastForCell(cell)?.tornadoProbability ?? cell.derived.hazards.tornadoProbability;
      case 'hailRisk': return this.forecastForCell(cell)?.hailProbability ?? cell.derived.hazards.hailProbability;
      case 'windRisk': return this.forecastForCell(cell)?.windProbability ?? cell.derived.hazards.windProbability;
      case 'temperature': return cell.surface.temperature;
      case 'dewpoint': return cell.surface.dewpoint;
      case 'pressure': return cell.surface.seaLevelPressure ?? cell.surface.pressure;
      case 'cape': return cell.derived.cape;
      case 'cin': return cell.derived.cin;
      case 'srh': return cell.derived.srh;
      case 'bulkShear': return cell.derived.bulkShear;
      case 'vtp': return cell.derived.vtp ?? 0;
      case 'stp': return cell.derived.stp;
      case 'forcing': return cell.dynamics?.forcingScore ?? 0;
      case 'readiness': return (cell.dynamics?.convectiveReadiness ?? 0) * 100;
      case 'trigger': return (cell.dynamics?.triggerStrength ?? 0) * 100;
      case 'initiation': return (cell.dynamics?.initiationPotential ?? 0) * 100;
      case 'initiationForecast': return (cell.forecast?.initiationProbability ?? 0) * 100;
      case 'stormCoverage': return (cell.forecast?.stormCoverage ?? 0) * 100;
      case 'supercellFraction': return (cell.forecast?.discreteFraction ?? 0) * 100;
      case 'linearFraction': return (cell.forecast?.linearFraction ?? 0) * 100;
      case 'tornadoIntensity': return (cell.forecast?.conditionalTornadoIntensity ?? 0) * 100;
      case 'hailIntensity': return (cell.forecast?.conditionalHailIntensity ?? 0) * 100;
      case 'windIntensity': return (cell.forecast?.conditionalWindIntensity ?? 0) * 100;
      case 'verticalMotion': return cell.dynamics?.verticalVelocityMs ?? 0;
      case 'emlInfluence': return (cell.features?.emlInfluence ?? 0) * 100;
      case 'lapseRate': return cell.features?.midlevelLapseRateCkm ?? 6.3;
      case 'airMass': return ({ cP:0, mP:1, cT:2, elevated:3, mT:4, upslope:5 })[cell.features?.airMass] ?? 4;
      case 'coherence': return (cell.features?.synopticCoherence ?? 1) * 100;
      case 'windSurface': return cell.surface.wind.speed;
      case 'wind800': return windAtPressure(cell, 800).windSpeed;
      case 'wind500': return cell.levels[500].windSpeed;
      case 'wind250': return cell.levels[250].windSpeed;
      default: return 0;
    }
  }

  drawWindBarb(cell, x, y, level) {
    const wind = level === 'surface'
      ? { direction: cell.surface.wind.direction, speed: cell.surface.wind.speed }
      : windAtPressure(cell, level);
    const cx = x * this.cellSize + this.cellSize / 2;
    const cy = y * this.cellSize + this.cellSize / 2;
    const shaft = this.cellSize * 0.55;
    const angle = wind.direction * Math.PI / 180;
    const ux = Math.sin(angle), uy = -Math.cos(angle);
    const x2 = cx + ux * shaft * .48, y2 = cy + uy * shaft * .48;
    const x1 = cx - ux * shaft * .48, y1 = cy - uy * shaft * .48;
    const ctx = this.ctx;
    ctx.strokeStyle = '#fff';
    ctx.fillStyle = '#fff';
    ctx.lineWidth = Math.max(1.2, this.cellSize * .032);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();

    let remaining = Math.round(wind.speed / 5) * 5;
    let offset = 0;
    const spacing = Math.max(3, this.cellSize * .075);
    const barbLength = this.cellSize * .20;
    const px = Math.cos(angle), py = Math.sin(angle);
    while (remaining >= 50) {
      const bx = x2 - ux * offset, by = y2 - uy * offset;
      const nx = x2 - ux * (offset + spacing * 1.5), ny = y2 - uy * (offset + spacing * 1.5);
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + px * barbLength, by + py * barbLength); ctx.lineTo(nx, ny); ctx.closePath(); ctx.fill();
      remaining -= 50; offset += spacing * 1.8;
    }
    while (remaining >= 10) {
      const bx = x2 - ux * offset, by = y2 - uy * offset;
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + px * barbLength, by + py * barbLength); ctx.stroke();
      remaining -= 10; offset += spacing;
    }
    if (remaining >= 5) {
      const bx = x2 - ux * offset, by = y2 - uy * offset;
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + px * barbLength * .55, by + py * barbLength * .55); ctx.stroke();
    }
  }

  drawRiskContours() {
    for (let threshold = 1; threshold < RISK_ORDER.length; threshold++) {
      this.drawThresholdContour(cell => RISK_ORDER.indexOf(this.displayedRisk(cell)) >= threshold, RISK_COLORS[RISK_ORDER[threshold]], Math.max(2, this.cellSize * .055));
    }
  }

  drawProbabilityContours(layer) {
    const thresholds = layer === 'tornadoRisk'
      ? [2, 5, 10, 15, 30, 45, 60]
      : layer === 'windRisk'
        ? [5, 15, 30, 45, 60, 75, 90]
        : [5, 15, 30, 45, 60];
    for (const threshold of thresholds) {
      this.drawThresholdContour(
        cell => this.valueForLayer(cell, layer) >= threshold,
        probabilityColor(threshold, layer),
        Math.max(2, this.cellSize * .055)
      );
    }
  }

  drawConditionalIntensity(layer) {
    const hazard = layer === 'tornadoRisk' ? 'tornado' : layer === 'hailRisk' ? 'hail' : layer === 'windRisk' ? 'wind' : null;
    if (!hazard) return;
    const key = `${hazard}Cig`;
    const maxCig = hazard === 'hail' ? 2 : 3;

    // Fill each diagnosed CIG area with the operational-style line pattern:
    // CIG1 broken diagonal, CIG2 solid diagonal, CIG3 crossed solid diagonal.
    this.atmosphere.forEachCell((cell, x, y) => {
      const cig = cell.derived.hazards[key] ?? 0;
      if (cig > 0) this.drawCigCell(x, y, cig);
    });

    // Draw nested boundaries. CIG1 is dashed; CIG2/CIG3 are solid.
    for (let cig = 1; cig <= maxCig; cig++) {
      const dashed = cig === 1;
      this.drawThresholdContour(
        cell => (cell.derived.hazards[key] ?? 0) >= cig,
        cig === 3 ? '#111111' : '#202020',
        Math.max(2, this.cellSize * (cig === 3 ? .075 : .055)),
        dashed ? [Math.max(5, this.cellSize * .18), Math.max(4, this.cellSize * .12)] : []
      );
    }
  }

  drawCigCell(x, y, cig) {
    const ctx = this.ctx;
    const left = x * this.cellSize;
    const top = y * this.cellSize;
    const size = this.cellSize;
    const spacing = Math.max(7, size * .22);
    const extend = size;

    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, size, size);
    ctx.clip();
    ctx.lineWidth = Math.max(1.25, size * .028);
    ctx.strokeStyle = 'rgba(15,15,15,.78)';
    ctx.lineCap = 'butt';

    const drawDiagonalSet = (reverse = false, dashed = false) => {
      ctx.setLineDash(dashed ? [Math.max(3, size * .09), Math.max(3, size * .07)] : []);
      for (let offset = -extend; offset <= size + extend; offset += spacing) {
        ctx.beginPath();
        if (!reverse) {
          ctx.moveTo(left + offset, top + size);
          ctx.lineTo(left + offset + size, top);
        } else {
          ctx.moveTo(left + offset, top);
          ctx.lineTo(left + offset + size, top + size);
        }
        ctx.stroke();
      }
    };

    if (cig === 1) drawDiagonalSet(false, true);
    if (cig === 2) drawDiagonalSet(false, false);
    if (cig >= 3) {
      drawDiagonalSet(false, false);
      drawDiagonalSet(true, false);
    }
    ctx.restore();
  }

  drawThresholdContour(predicate, color, width, dash = []) {
    const loops = traceCellRegion(this.atmosphere, predicate, this.cellSize);
    const ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash(dash);
    for (const loop of loops) {
      const points = this.smoothGeometry ? chaikin(loop, 2, true) : loop;
      strokePolyline(ctx, points, true);
    }
    ctx.setLineDash([]);
  }

  drawFeatures() {
    // Persistent mesoscale objects are the only authoritative boundary lines.
    // The grid projection remains available to diagnostics and layers but is not
    // rendered as a second, visually conflicting feature set.
    this.drawSynopticCenters();
  }

  strokeWeatherFeature(points, color, type) {
    const ctx = this.ctx;
    const width = Math.max(2, this.cellSize * .06);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (type === 'dryline') ctx.setLineDash([this.cellSize * .18, this.cellSize * .12]);
    strokePolyline(ctx, points, false);
    ctx.setLineDash([]);

    const spacing = this.cellSize * 1.45;
    forEachPointAlongPolyline(points, spacing, (point, tangent, index) => {
      if (type === 'cold') drawColdFrontSymbol(ctx, point, tangent, this.cellSize * .17, index);
      if (type === 'warm') drawWarmFrontSymbol(ctx, point, tangent, this.cellSize * .14, index);
      if (type === 'dryline') drawDrylineSymbol(ctx, point, tangent, this.cellSize * .10, index);
    });
    ctx.restore();
  }


  drawSynopticCenters() {
    const analyzed = this.atmosphere.analysis?.pressureSystems?.centers
      ?? this.atmosphere.analysis?.pressureCenters;
    if (Array.isArray(analyzed) && analyzed.length) {
      for (const center of analyzed) {
        const cell = this.atmosphere.getCell(center.x, center.y);
        if (cell) this.drawPressureCenter(cell, center.type, center.type === 'L' ? '#ef5350' : '#42a5f5', center.pressureHpa ?? center.pressure);
      }
      return;
    }
    let low = null, high = null;
    this.atmosphere.forEachCell(cell => {
      const pressure = cell.surface.seaLevelPressure ?? cell.surface.pressure;
      if (!low || pressure < low.pressure) low = { cell, pressure };
      if (!high || pressure > high.pressure) high = { cell, pressure };
    });
    if (low) this.drawPressureCenter(low.cell, 'L', '#ef5350', low.pressure);
    if (high) this.drawPressureCenter(high.cell, 'H', '#42a5f5', high.pressure);
  }

  drawPressureCenter(cell, label, color, pressure) {
    const ctx = this.ctx;
    const x = (cell.x + .5) * this.cellSize;
    const y = (cell.y + .5) * this.cellSize;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `900 ${Math.max(18, this.cellSize * .62)}px ui-sans-serif, sans-serif`;
    ctx.lineWidth = Math.max(3, this.cellSize * .09);
    ctx.strokeStyle = 'rgba(255,255,255,.92)';
    ctx.strokeText(label, x, y);
    ctx.fillStyle = color;
    ctx.fillText(label, x, y);
    ctx.font = `700 ${Math.max(9, this.cellSize * .19)}px ui-monospace, monospace`;
    ctx.strokeStyle = 'rgba(0,0,0,.72)';
    ctx.lineWidth = 3;
    ctx.strokeText(Math.round(pressure).toString(), x, y + this.cellSize * .48);
    ctx.fillStyle = '#fff';
    ctx.fillText(Math.round(pressure).toString(), x, y + this.cellSize * .48);
    ctx.restore();
  }


  drawMesoscaleBoundaryObjects() {
    const boundaries = this.atmosphere.mesoscale?.boundaries ?? [];
    if (!boundaries.length) return;
    const kmToPx = this.cellSize / this.atmosphere.cellSizeKm;
    const ctx = this.ctx;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const boundary of boundaries) {
      if (!boundary.active || boundary.pointsKm.length < 2) continue;
      const points = boundary.pointsKm.map(point => ({ x: point.x * kmToPx, y: point.y * kmToPx }));
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
      ctx.lineWidth = Math.max(2.2, this.cellSize * 0.085);
      ctx.strokeStyle = boundary.type === 'cold' ? '#2563eb' : boundary.type === 'warm' ? '#dc2626' : '#c08457';
      if (boundary.type === 'dryline') ctx.setLineDash([this.cellSize * 0.34, this.cellSize * 0.20]);
      else ctx.setLineDash([]);
      ctx.globalAlpha = 0.92;
      ctx.stroke();
      ctx.setLineDash([]);
      const midpoint = points[Math.floor(points.length / 2)];
      ctx.font = `800 ${Math.max(8, this.cellSize * 0.15)}px ui-monospace, monospace`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.75)';
      ctx.strokeText(boundary.id, midpoint.x, midpoint.y - 3);
      ctx.fillStyle = '#fff'; ctx.fillText(boundary.id, midpoint.x, midpoint.y - 3);
    }
    ctx.restore();
  }

  drawStorms(fast = false) {
    const storms = this.atmosphere.storms ?? [];
    if (!storms.length) return;
    const ctx = this.ctx;
    const kmToPx = this.cellSize / this.atmosphere.cellSizeKm;
    ctx.save();
    for (const storm of storms) {
      const x = storm.positionKm.x * kmToPx;
      const y = storm.positionKm.y * kmToPx;
      if (x < -60 || y < -60 || x > this.canvas.width + 60 || y > this.canvas.height + 60) continue;
      const radius = Math.max(4, this.cellSize * (0.14 + storm.intensity * 0.18));

      if ((storm.coldPoolStrength ?? 0) > 0.12) {
        ctx.beginPath();
        ctx.arc(x, y, Math.max(radius * 2, (storm.coldPoolRadiusKm ?? 8) * kmToPx), 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(125,211,252,${0.12 + storm.coldPoolStrength * 0.34})`;
        ctx.lineWidth = Math.max(1, radius * 0.12);
        ctx.setLineDash([Math.max(3, radius * .45), Math.max(2, radius * .30)]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.beginPath();
      ctx.arc(x, y, radius * 1.8, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${0.10 + storm.intensity * 0.15})`;
      ctx.fill();

      ctx.beginPath();
      if (storm.mode === 'linear segment' || storm.mode === 'QLCS' || storm.mode === 'MCS') {
        ctx.rect(x - radius * 1.15, y - radius * .65, radius * 2.3, radius * 1.3);
      } else if (storm.mode.includes('supercell')) {
        ctx.moveTo(x, y - radius); ctx.lineTo(x + radius, y); ctx.lineTo(x, y + radius); ctx.lineTo(x - radius, y); ctx.closePath();
      } else {
        ctx.arc(x, y, radius, 0, Math.PI * 2);
      }
      const weakening = storm.lifecycleState === 'weakening' || storm.lifecycleState === 'dissipating';
      ctx.fillStyle = weakening ? '#9ca3af' : storm.mode.includes('left-moving') ? '#a78bfa' : storm.mode.includes('supercell') ? '#f97316' : storm.mode === 'MCS' || storm.mode === 'QLCS' ? '#38bdf8' : '#f8fafc';
      ctx.fill();
      ctx.lineWidth = Math.max(1.5, radius * 0.18);
      ctx.strokeStyle = '#111827';
      ctx.stroke();

      const speed = Math.hypot(storm.velocityKph.east, storm.velocityKph.north);
      if (speed > 1) {
        const scale = Math.min(this.cellSize * 0.9, speed * kmToPx * 0.18);
        const ux = storm.velocityKph.east / speed;
        const uy = -storm.velocityKph.north / speed;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + ux * scale, y + uy * scale);
        ctx.strokeStyle = 'rgba(17,24,39,.85)'; ctx.lineWidth = Math.max(1.5, radius * 0.14); ctx.stroke();
      }
      if (!fast && this.cellSize >= 15) {
        ctx.font = `700 ${Math.max(8, this.cellSize * .16)}px ui-monospace, monospace`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.78)';
        const label = `${storm.id} ${abbreviateStormMode(storm.mode)}`;
        ctx.strokeText(label, x, y - radius - 2);
        ctx.fillStyle = '#fff'; ctx.fillText(label, x, y - radius - 2);
      }
    }
    ctx.restore();
  }


  drawRegions() {
    const ctx = this.ctx;
    const framework = this.atmosphere.worldFramework;
    if (!framework) return;
    ctx.save();

    if (this.showRegions) {
      // Permanent world-region borders are deliberately solid and double-stroked.
      // This visually separates them from dashed drylines and CIG1 contours.
      const buildBorderPath = () => {
        ctx.beginPath();
        for (let y = 0; y < framework.height; y++) {
          for (let x = 0; x < framework.width; x++) {
            const id = framework.cells[y][x].regionId;
            if (x + 1 < framework.width && framework.cells[y][x + 1].regionId !== id) {
              const px = (x + 1) * this.cellSize;
              ctx.moveTo(px, y * this.cellSize); ctx.lineTo(px, (y + 1) * this.cellSize);
            }
            if (y + 1 < framework.height && framework.cells[y + 1][x].regionId !== id) {
              const py = (y + 1) * this.cellSize;
              ctx.moveTo(x * this.cellSize, py); ctx.lineTo((x + 1) * this.cellSize, py);
            }
          }
        }
      };
      ctx.setLineDash([]);
      buildBorderPath();
      ctx.strokeStyle = 'rgba(0,0,0,.62)';
      ctx.lineWidth = Math.max(3, this.cellSize * 0.085);
      ctx.stroke();
      buildBorderPath();
      ctx.strokeStyle = 'rgba(255,255,255,.88)';
      ctx.lineWidth = Math.max(1.2, this.cellSize * 0.035);
      ctx.stroke();
    }

    if (this.showRegionLabels) {
      for (const region of framework.regions ?? []) {
        const x = region.centroid.x * this.cellSize, y = region.centroid.y * this.cellSize;
        ctx.font = `800 ${Math.max(10, this.cellSize * .22)}px ui-sans-serif, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.lineWidth = Math.max(3, this.cellSize * .08); ctx.strokeStyle = 'rgba(0,0,0,.78)';
        ctx.strokeText(region.shortLabel, x, y); ctx.fillStyle = 'rgba(255,255,255,.96)'; ctx.fillText(region.shortLabel, x, y);
      }
    }
    ctx.restore();
  }

  drawSelection() {
    const ctx = this.ctx;
    const draw = (cell, color, width) => {
      if (!cell) return;
      ctx.strokeStyle = color; ctx.lineWidth = width;
      ctx.strokeRect(cell.x * this.cellSize + width / 2, cell.y * this.cellSize + width / 2, this.cellSize - width, this.cellSize - width);
    };
    draw(this.hoverCell, 'rgba(255,255,255,.7)', 2);
    draw(this.selectedCell, '#ffffff', 4);
  }

  cellFromEvent(event) {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;

    // clientX/clientY are stable for mouse, pen, and synthesized click events.
    // offsetX/offsetY are retained as a fallback for older embedded browsers.
    const cssX = Number.isFinite(event.clientX)
      ? event.clientX - rect.left
      : event.offsetX;
    const cssY = Number.isFinite(event.clientY)
      ? event.clientY - rect.top
      : event.offsetY;
    if (!Number.isFinite(cssX) || !Number.isFinite(cssY)) return null;
    if (cssX < 0 || cssY < 0 || cssX >= rect.width || cssY >= rect.height) return null;

    const pixelX = cssX * (this.canvas.width / rect.width);
    const pixelY = cssY * (this.canvas.height / rect.height);
    const x = Math.floor(pixelX / this.cellSize);
    const y = Math.floor(pixelY / this.cellSize);
    return this.atmosphere.getCell(x, y) ?? null;
  }
}


function traceCellRegion(atmosphere, predicate, cellSize) {
  const segments = [];
  const key = (x, y) => `${x},${y}`;
  const add = (a, b) => segments.push({ a, b, used: false });
  atmosphere.forEachCell((cell, x, y) => {
    if (!predicate(cell)) return;
    const l = x * cellSize, t = y * cellSize, r = l + cellSize, b = t + cellSize;
    if (!atmosphere.getCell(x, y - 1) || !predicate(atmosphere.getCell(x, y - 1))) add({x:l,y:t},{x:r,y:t});
    if (!atmosphere.getCell(x + 1, y) || !predicate(atmosphere.getCell(x + 1, y))) add({x:r,y:t},{x:r,y:b});
    if (!atmosphere.getCell(x, y + 1) || !predicate(atmosphere.getCell(x, y + 1))) add({x:r,y:b},{x:l,y:b});
    if (!atmosphere.getCell(x - 1, y) || !predicate(atmosphere.getCell(x - 1, y))) add({x:l,y:b},{x:l,y:t});
  });
  const byStart = new Map();
  segments.forEach((segment, index) => {
    const k = key(segment.a.x, segment.a.y);
    if (!byStart.has(k)) byStart.set(k, []);
    byStart.get(k).push(index);
  });
  const loops = [];
  for (let i = 0; i < segments.length; i++) {
    if (segments[i].used) continue;
    const points = [segments[i].a, segments[i].b];
    segments[i].used = true;
    let current = segments[i].b;
    for (let guard = 0; guard < segments.length + 2; guard++) {
      const candidates = byStart.get(key(current.x, current.y)) || [];
      const nextIndex = candidates.find(index => !segments[index].used);
      if (nextIndex == null) break;
      const next = segments[nextIndex];
      next.used = true;
      points.push(next.b);
      current = next.b;
      if (current.x === points[0].x && current.y === points[0].y) break;
    }
    if (points.length >= 4) loops.push(points);
  }
  return loops;
}

function chaikin(points, iterations = 2, closed = false) {
  let result = points.map(point => ({...point}));
  for (let iteration = 0; iteration < iterations; iteration++) {
    const next = [];
    if (!closed) next.push(result[0]);
    const limit = closed ? result.length : result.length - 1;
    for (let i = 0; i < limit; i++) {
      const a = result[i];
      const b = result[(i + 1) % result.length];
      next.push({ x: a.x * .75 + b.x * .25, y: a.y * .75 + b.y * .25 });
      next.push({ x: a.x * .25 + b.x * .75, y: a.y * .25 + b.y * .75 });
    }
    if (!closed) next.push(result[result.length - 1]);
    result = next;
  }
  return result;
}


function polylineLength(points) {
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    length += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return length;
}

function strokePolyline(ctx, points, closed) {
  if (!points || points.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  if (closed) ctx.closePath();
  ctx.stroke();
}

function collectFeatureComponents(atmosphere, predicate) {
  const visited = new Set();
  const components = [];
  const key = (x, y) => `${x},${y}`;
  atmosphere.forEachCell((cell, x, y) => {
    if (!predicate(cell) || visited.has(key(x,y))) return;
    const queue = [cell];
    const component = [];
    visited.add(key(x,y));
    while (queue.length) {
      const current = queue.shift();
      component.push(current);
      for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]]) {
        const neighbor = atmosphere.getCell(current.x+dx,current.y+dy);
        if (!neighbor || !predicate(neighbor) || visited.has(key(neighbor.x,neighbor.y))) continue;
        visited.add(key(neighbor.x,neighbor.y));
        queue.push(neighbor);
      }
    }
    components.push(component);
  });
  return components;
}

function extractFeatureCenterline(cells, cellSize) {
  if (cells.length < 2) return [];

  const meanX = cells.reduce((sum, cell) => sum + cell.x, 0) / cells.length;
  const meanY = cells.reduce((sum, cell) => sum + cell.y, 0) / cells.length;
  let xx = 0, yy = 0, xy = 0;
  for (const cell of cells) {
    const dx = cell.x - meanX;
    const dy = cell.y - meanY;
    xx += dx * dx;
    yy += dy * dy;
    xy += dx * dy;
  }

  const angle = 0.5 * Math.atan2(2 * xy, xx - yy);
  const axis = { x: Math.cos(angle), y: Math.sin(angle) };
  const normal = { x: -axis.y, y: axis.x };
  const bins = new Map();

  for (const cell of cells) {
    const dx = cell.x - meanX;
    const dy = cell.y - meanY;
    const along = dx * axis.x + dy * axis.y;
    const across = dx * normal.x + dy * normal.y;
    const key = Math.round(along);
    if (!bins.has(key)) bins.set(key, []);
    bins.get(key).push({ along, across });
  }

  const points = [...bins.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, values]) => {
      const along = values.reduce((sum, value) => sum + value.along, 0) / values.length;
      const offsets = values.map(value => value.across).sort((a, b) => a - b);
      const across = offsets[Math.floor(offsets.length / 2)];
      return {
        x: (meanX + axis.x * along + normal.x * across + 0.5) * cellSize,
        y: (meanY + axis.y * along + normal.y * across + 0.5) * cellSize
      };
    });

  return removeNearDuplicatePoints(points, cellSize * 0.3);
}

function smoothOpenPolyline(points, passes = 2) {
  let result = points.map(point => ({ ...point }));
  for (let pass = 0; pass < passes; pass++) {
    if (result.length < 3) break;
    const next = [result[0]];
    for (let i = 1; i < result.length - 1; i++) {
      next.push({
        x: result[i - 1].x * 0.25 + result[i].x * 0.5 + result[i + 1].x * 0.25,
        y: result[i - 1].y * 0.25 + result[i].y * 0.5 + result[i + 1].y * 0.25
      });
    }
    next.push(result[result.length - 1]);
    result = next;
  }
  return result;
}

function removeNearDuplicatePoints(points, minimumDistance) {
  const result = [];
  for (const point of points) {
    const previous = result[result.length - 1];
    if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) >= minimumDistance) {
      result.push(point);
    }
  }
  if (result.length === 1 && points.length > 1) result.push(points[points.length - 1]);
  return result;
}

function forEachPointAlongPolyline(points, spacing, callback) {
  let remaining = spacing * .55;
  let index = 0;
  for (let i=1;i<points.length;i++) {
    const a=points[i-1], b=points[i];
    const dx=b.x-a.x, dy=b.y-a.y, length=Math.hypot(dx,dy);
    if (!length) continue;
    while (remaining <= length) {
      const t=remaining/length;
      callback({x:a.x+dx*t,y:a.y+dy*t},{x:dx/length,y:dy/length},index++);
      remaining += spacing;
    }
    remaining -= length;
  }
}

function featureNormal(tangent, index) {
  const side = index % 2 === 0 ? 1 : 1;
  return {x:-tangent.y*side,y:tangent.x*side};
}
function drawColdFrontSymbol(ctx, point, tangent, size, index) {
  const n=featureNormal(tangent,index);
  ctx.beginPath();
  ctx.moveTo(point.x-tangent.x*size*.72,point.y-tangent.y*size*.72);
  ctx.lineTo(point.x+n.x*size,point.y+n.y*size);
  ctx.lineTo(point.x+tangent.x*size*.72,point.y+tangent.y*size*.72);
  ctx.closePath(); ctx.fill();
}
function drawWarmFrontSymbol(ctx, point, tangent, radius, index) {
  const n=featureNormal(tangent,index);
  const angle=Math.atan2(tangent.y,tangent.x);
  ctx.save(); ctx.translate(point.x,point.y); ctx.rotate(angle);
  ctx.beginPath(); ctx.arc(0,0,radius,Math.PI,0); ctx.fill(); ctx.restore();
}
function drawDrylineSymbol(ctx, point, tangent, radius, index) {
  const n=featureNormal(tangent,index);
  ctx.beginPath(); ctx.arc(point.x+n.x*radius*.7,point.y+n.y*radius*.7,radius,0,Math.PI*2); ctx.fill();
}

function parseHexColor(color) {
  if (typeof color !== 'string') return [0, 0, 0];
  if (color[0] === '#') {
    const hex = color.slice(1);
    if (hex.length === 3) return hex.split('').map(char => parseInt(char + char, 16));
    if (hex.length >= 6) return [parseInt(hex.slice(0,2),16), parseInt(hex.slice(2,4),16), parseInt(hex.slice(4,6),16)];
  }
  const match = color.match(/rgba?\(([^)]+)\)/i);
  return match ? match[1].split(',').slice(0,3).map(value => Math.max(0, Math.min(255, Number(value) || 0))) : [0,0,0];
}

function buildColorLuts() {
  const result = new Map();
  for (const [layer, info] of Object.entries(LAYERS)) {
    if (info.categorical || info.probability) continue;
    const lut = new Array(256);
    for (let i = 0; i < 256; i++) lut[i] = colorScale(i, 0, 255, info.stops);
    result.set(layer, lut);
  }
  return result;
}

function formatValue(value, layer) {
  if (layer === 'pressure') return value.toFixed(0);
  if (layer === 'stp') return value.toFixed(1);
  return Math.round(value).toString();
}
function probabilityColor(value, layer) {
  const palette = layer === 'tornadoRisk'
    ? TORNADO_PROBABILITY_COLORS
    : WIND_HAIL_PROBABILITY_COLORS;
  const thresholds = Object.keys(palette).map(Number).sort((a,b) => a-b);
  let chosen = thresholds[0];
  for (const threshold of thresholds) if (value >= threshold) chosen = threshold;
  return palette[chosen];
}
function colorScale(value, min, max, stops) {
  const t = clamp((value - min) / (max - min), 0, 1);
  const scaled = t * (stops.length - 1), index = Math.min(stops.length - 2, Math.floor(scaled)), local = scaled - index;
  return interpolateHex(stops[index], stops[index + 1], local);
}
function interpolateHex(a, b, t) {
  const ca = hexToRgb(a), cb = hexToRgb(b);
  return `rgb(${Math.round(ca.r + (cb.r-ca.r)*t)},${Math.round(ca.g + (cb.g-ca.g)*t)},${Math.round(ca.b + (cb.b-ca.b)*t)})`;
}
function hexToRgb(hex) { const value = parseInt(hex.slice(1),16); return { r:value>>16, g:(value>>8)&255, b:value&255 }; }

function abbreviateStormMode(mode) {
  const labels = { 'pulse storm':'PULSE', 'multicell':'MULTI', 'discrete supercell':'RM', 'left-moving supercell':'LM', 'linear segment':'LINE', 'QLCS':'QLCS', 'MCS':'MCS', 'elevated convection':'ELEV' };
  return labels[mode] ?? 'CELL';
}

function windAtPressure(cell, pressure) {
  const direct = cell.levels?.[pressure];
  if (direct) return { direction:Number(direct.windDirection)||0, speed:Number(direct.windSpeed)||0 };
  const levels = Object.entries(cell.levels ?? {}).map(([p,v])=>({p:Number(p),...v})).filter(v=>Number.isFinite(v.p)).sort((a,b)=>b.p-a.p);
  const hi=levels.find(v=>v.p>=pressure), lo=[...levels].reverse().find(v=>v.p<=pressure);
  if (!hi || !lo || hi.p===lo.p) { const v=hi??lo??{}; return {direction:Number(v.windDirection)||0,speed:Number(v.windSpeed)||0}; }
  const f=(hi.p-pressure)/(hi.p-lo.p), ar=(Number(hi.windDirection)||0)*Math.PI/180, br=(Number(lo.windDirection)||0)*Math.PI/180;
  const u=(1-f)*Math.sin(ar)*(Number(hi.windSpeed)||0)+f*Math.sin(br)*(Number(lo.windSpeed)||0);
  const v=(1-f)*Math.cos(ar)*(Number(hi.windSpeed)||0)+f*Math.cos(br)*(Number(lo.windSpeed)||0);
  return {direction:(Math.atan2(u,v)*180/Math.PI+360)%360,speed:Math.hypot(u,v)};
}
