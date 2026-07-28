export class UI {
  constructor() {
    const byId = id => document.getElementById(id);
    this.layer = byId('layer');
    this.outlookDay = byId('outlookDay');
    this.outlookIssueLabel = byId('outlookIssueLabel');
    this.liveMode = byId('liveMode');
    this.liveStatus = byId('liveStatus');
    this.diagnosedRisk = byId('diagnosedRisk');
    this.diagnosedDescription = byId('diagnosedDescription');
    this.primaryHazard = byId('primaryHazard');
    this.stormMode = byId('stormMode');
    this.analysisReasons = byId('analysisReasons');
    this.analysisLimitations = byId('analysisLimitations');
    this.synopticPattern = byId('synopticPattern');
    this.synopticStage = byId('synopticStage');
    this.analogConfidence = byId('analogConfidence');
    this.outlookDiscussion = byId('outlookDiscussion');
    this.width = byId('gridWidth');
    this.height = byId('gridHeight');
    this.domainSize = byId('domainSize');
    this.stepTime = byId('stepTime');
    this.playTime = byId('playTime');
    this.simulationTime = byId('simulationTime');
    this.timeLabel = byId('timeLabel');
    this.seed = byId('seed');
    this.randomSeed = byId('randomSeed');
    this.generate = byId('generate');
    this.toggleFeatures = byId('toggleFeatures');
    this.toggleRegions = byId('toggleRegions');
    this.toggleRegionLabels = byId('toggleRegionLabels');
    this.toggleGrid = byId('toggleGrid');
    this.toggleSmoothing = byId('toggleSmoothing');
    this.info = byId('cellInfo');
    this.cellTitle = byId('cellTitle');
    this.canvas = byId('mapCanvas');
    this.mapInteractionLayer = byId('mapInteractionLayer');
    this.tooltip = byId('tooltip');
    this.mapTitle = byId('mapTitle');
    this.mapSubtitle = byId('mapSubtitle');
    this.summary = byId('summary');
    this.legendLabel = byId('legendLabel');
    this.legendUnits = byId('legendUnits');
    this.legendGradient = byId('legendGradient');
    this.legendMin = byId('legendMin');
    this.legendMax = byId('legendMax');
    this.bindSoundingElements();
  }

  setLegend(info) {
    this.legendLabel.textContent = info.label;
    this.legendUnits.textContent = info.units;
    this.legendMin.textContent = info.min;
    this.legendMax.textContent = info.max;
    this.legendGradient.style.background = `linear-gradient(90deg, ${info.stops.join(',')})`;
  }

  showCell(cell) {
    if (!cell) return;
    this.cellTitle.textContent = `Cell (${cell.x}, ${cell.y}) · 10 × 10 mi`;
    const features = [];
    if (cell.features.front) features.push(`${cell.features.front} front`);
    if (cell.features.dryline) features.push('dryline');
    if (cell.features.warmSector) features.push('warm sector');
    if (cell.features.moistureAxis) features.push('moisture axis');
    if (cell.features.leeTrough) features.push('lee trough');
    if (cell.features.shortwaveTrough) features.push('shortwave trough');
    if (cell.features.upperTrough) features.push('upper trough');
    if (cell.features.jetStreak) features.push('jet streak');

    this.info.classList.remove('muted');
    this.info.innerHTML = `
      ${group('Surface', [
        metric('Station pressure', `${cell.surface.pressure.toFixed(1)} mb`),
        metric('Sea-level pressure', `${cell.surface.seaLevelPressure.toFixed(1)} mb`),
        metric('Elevation', `${cell.terrain.elevationM.toFixed(0)} m`),
        metric('Region', cell.region?.label ?? 'Unassigned'),
        metric('Air mass', cell.features.airMass ?? '—'),
        metric('Air-mass origin', cell.features.airMassOrigin ?? '—'),
        metric('Cell footprint', `${cell.x*10}–${(cell.x+1)*10} km E · ${cell.y*10}–${(cell.y+1)*10} km S`),
        metric('Temperature', `${cell.surface.temperature.toFixed(1)} °F`),
        metric('Dewpoint', `${cell.surface.dewpoint.toFixed(1)} °F`),
        metric('Wind', `${Math.round(cell.surface.wind.direction)}° at ${cell.surface.wind.speed.toFixed(0)} kt`)
      ])}
      ${group('Upper air', [
        metric('800 mb', `${Math.round(interpolatedLevel(cell,800).windDirection)}° at ${interpolatedLevel(cell,800).windSpeed.toFixed(0)} kt`),
        metric('500 mb', `${Math.round(cell.levels[500].windDirection)}° at ${cell.levels[500].windSpeed.toFixed(0)} kt`),
        metric('250 mb', `${Math.round(cell.levels[250].windDirection)}° at ${cell.levels[250].windSpeed.toFixed(0)} kt`)
      ])}
      ${group('Severe parameters', [
        metric('CAPE', `${cell.derived.cape.toFixed(0)} J/kg`),
        metric('CIN', `${cell.derived.cin.toFixed(0)} J/kg`),
        metric('0–1 km SRH', `${cell.derived.srh.toFixed(0)} m²/s²`),
        metric('0–6 km shear', `${cell.derived.bulkShear.toFixed(0)} kt`),
        metric('LCL', `${cell.derived.lcl.toFixed(0)} m`),
        metric('STP', cell.derived.stp.toFixed(1)),
        metric('VTP', (cell.derived.vtp ?? 0).toFixed(1)),
        metric('SCP', cell.derived.scp.toFixed(1)),
        metric('Diagnosed risk', cell.derived.risk),
        metric('Primary hazard', capitalize(cell.derived.hazards.dominant)),
        metric('Storm mode', cell.derived.diagnostics.stormMode),
        metric('Severe support', `${Math.round(cell.derived.diagnostics.severeSupport * 100)}%`),
        metric('Readiness', `${Math.round((cell.dynamics?.convectiveReadiness ?? 0) * 100)}%`),
        metric('Trigger', `${Math.round((cell.dynamics?.triggerStrength ?? 0) * 100)}%`),
        metric('Convective potential', `${Math.round((cell.forecast?.convectivePotential ?? cell.dynamics?.convectiveReadiness ?? 0) * 100)}%`),
        metric('Initiation probability', `${Math.round((cell.forecast?.initiationProbability ?? 0) * 100)}%`),
        metric('Cap break probability', `${Math.round((cell.forecast?.capBreakProbability ?? cell.forecast?.capFailureProbability ?? 0) * 100)}%`),
        metric('Expected cap break', cell.forecast?.expectedCapBreakHourUtc == null ? 'No break expected' : `${String(Math.round(cell.forecast.expectedCapBreakHourUtc)%24).padStart(2,'0')}Z`),
        metric('MLCIN', `${Math.round(cell.derived?.mlcinSigned ?? -(cell.derived?.cin ?? 0))} J/kg`),
        metric('0–1 km lapse rate', `${(cell.derived?.lapseRate01km ?? 0).toFixed(1)} °C/km`),
        metric('0–3 km lapse rate', `${(cell.derived?.lapseRate03km ?? 0).toFixed(1)} °C/km`),
        metric('Boundary strength', `${Math.round((cell.features.boundaryStrength ?? 0) * 100)}%`),
        metric('Convergence', `${Math.round((cell.features.convergence ?? 0) * 100)}%`),
        metric('Wind shift', `${(cell.features.windShift ?? 0).toFixed(0)}°`),
        metric('Temperature gradient', `${(cell.features.temperatureGradient ?? 0).toFixed(1)} °F/100 km`),
        metric('Dewpoint gradient', `${(cell.features.dewpointGradient ?? 0).toFixed(1)} °F/100 km`),
        metric('Pressure tendency', `${(cell.features.pressureTendency ?? 0).toFixed(2)} mb/hr`),
        metric('EML influence', `${Math.round((cell.features.emlInfluence ?? 0) * 100)}%`),
        metric('EML depth', `${Math.round(cell.features.emlDepthHpa ?? 0)} hPa`),
        metric('Midlevel lapse rate', `${(cell.features.midlevelLapseRateCkm ?? 0).toFixed(1)} °C/km`),
        metric('Synoptic coherence', `${Math.round((cell.features.synopticCoherence ?? 1) * 100)}%`)
      ])}
      ${group('Hazard analysis', [
        metric('Tornado probability', `${cell.derived.hazards.tornadoProbability}%`),
        metric('Tornado category', cell.derived.hazards.categories.tornado),
        metric('Tornado intensity', cigLabel('tornado', cell.derived.hazards.tornadoCig)),
        metric('Hail probability', `${cell.derived.hazards.hailProbability}%`),
        metric('Hail category', cell.derived.hazards.categories.hail),
        metric('Hail intensity', cigLabel('hail', cell.derived.hazards.hailCig)),
        metric('Wind probability', `${cell.derived.hazards.windProbability}%`),
        metric('Wind category', cell.derived.hazards.categories.wind),
        metric('Wind intensity', cigLabel('wind', cell.derived.hazards.windCig)),
        metric('Tornado environment', scoreLabel(cell.derived.hazards.tornado)),
        metric('Hail environment', scoreLabel(cell.derived.hazards.hail)),
        metric('Wind environment', scoreLabel(cell.derived.hazards.wind))
      ])}
      <div class="info-group"><h3>Limiting factors</h3>${cell.derived.diagnostics.limitingFactors.length ? cell.derived.diagnostics.limitingFactors.map(f => `<span class="feature-pill">${f}</span>`).join('') : '<span class="muted">No major limitation diagnosed</span>'}</div>
      <div class="info-group"><h3>Features</h3>${features.length ? features.map(f => `<span class="feature-pill">${f}</span>`).join('') : '<span class="muted">None detected</span>'}</div>
    `;
  }

  showTooltip(cell, event, layerInfo, value) {
    this.tooltip.classList.remove('hidden');
    this.tooltip.style.left = `${event.clientX + 14}px`;
    this.tooltip.style.top = `${event.clientY + 14}px`;
    this.tooltip.innerHTML = `<strong>(${cell.x}, ${cell.y})</strong><br>${layerInfo.label}: ${formatTooltip(value, layerInfo.units)}`;
  }

  hideTooltip() { this.tooltip.classList.add('hidden'); }
}

function metric(label, value) { return `<div class="metric"><span>${label}</span><strong>${value}</strong></div>`; }
function group(title, rows) { return `<div class="info-group"><h3>${title}</h3>${rows.join('')}</div>`; }
function formatTooltip(value, units) { return `${Number.isInteger(value) ? value : (Math.abs(value) < 20 ? value.toFixed(1) : value.toFixed(0))}${units === '%' ? '%' : ` ${units}`}`.trim(); }

function capitalize(value) { return value ? value.charAt(0).toUpperCase() + value.slice(1) : '—'; }
function scoreLabel(value) { const percent = Math.round(value * 100); if (percent >= 90) return `Extreme (${percent}%)`; if (percent >= 75) return `High (${percent}%)`; if (percent >= 55) return `Moderate (${percent}%)`; if (percent >= 35) return `Low (${percent}%)`; return `Minimal (${percent}%)`; }


function cigLabel(hazard, cig) {
  if (!cig) return 'No intensity highlight';
  const descriptions = {
    tornado: { 1: 'CIG1 · reasonable max EF2', 2: 'CIG2 · reasonable max EF3', 3: 'CIG3 · reasonable max EF4+' },
    wind: { 1: 'CIG1 · peak gusts 65+ kt', 2: 'CIG2 · bow echo/derecho possible', 3: 'CIG3 · high-end derecho' },
    hail: { 1: 'CIG1 · 2.0–3.5 in hail', 2: 'CIG2 · greater than 3.5 in hail' }
  };
  return descriptions[hazard]?.[cig] ?? `CIG${cig}`;
}

UI.prototype.bindSoundingElements = function() {
  const byId = id => document.getElementById(id);
  this.openSounding = byId('openSounding');
  this.soundingModal = byId('soundingModal');
  this.closeSounding = byId('closeSounding');
  this.soundingTitle = byId('soundingTitle');
  this.soundingSubtitle = byId('soundingSubtitle');
  this.soundingMetrics = byId('soundingMetrics');
  this.skewTCanvas = byId('skewTCanvas');
  this.hodoCanvas = byId('hodoCanvas');
  this.forcingDetails = byId('forcingDetails');
  this.profileTableBody = byId('profileTableBody');
};

function interpolatedLevel(cell, pressure) {
  if (cell.levels?.[pressure]) return cell.levels[pressure];
  const upper = cell.levels?.[850], lower = cell.levels?.[700];
  if (!upper || !lower) return upper ?? lower ?? { windDirection:0, windSpeed:0 };
  const f = (850-pressure)/(850-700);
  const a=upper.windDirection*Math.PI/180,b=lower.windDirection*Math.PI/180;
  const u=(1-f)*Math.sin(a)*upper.windSpeed+f*Math.sin(b)*lower.windSpeed;
  const v=(1-f)*Math.cos(a)*upper.windSpeed+f*Math.cos(b)*lower.windSpeed;
  return { windDirection:(Math.atan2(u,v)*180/Math.PI+360)%360, windSpeed:Math.hypot(u,v) };
}
