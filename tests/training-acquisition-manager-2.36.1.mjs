import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import {
  createCaseAcquisition, planAcquisition, saveAcquisitionCatalog,
  loadAcquisitionCatalog, setStage, summarizeAcquisition
} from '../js/training/acquisition/AcquisitionManager.js';
import { createAtmosphericRecord, validateAtmosphericRecord } from '../js/training/AtmosphericRecordSchema.js';
import { ensureTrainingLayout } from '../js/training/TrainingCorpusManager.js';

const temp = await mkdtemp(path.join(os.tmpdir(), 'ww-2361-'));
try {
  const paths = await ensureTrainingLayout(path.join(temp, 'training'), path.join(temp, 'cache'), { createExternalCache: true });
  const record = createCaseAcquisition('2024-05-06');
  setStage(record, 'spc', 'complete');
  setStage(record, 'era5Raw', 'downloaded');
  setStage(record, 'era5Extracted', 'complete');
  setStage(record, 'noaa', 'complete');
  assert.equal(record.eligibleForTraining, true);

  const cases = { '2024-05-06': record, '2020-08-10': createCaseAcquisition('2020-08-10') };
  const missing = planAcquisition({ dates: Object.keys(cases), cases, missingOnly: true, include: ['era5', 'noaa'] });
  assert.deepEqual(missing.map(item => `${item.date}:${item.source}`), ['2020-08-10:era5', '2020-08-10:noaa']);

  await saveAcquisitionCatalog(paths.acquisition, { cases });
  const loaded = await loadAcquisitionCatalog(paths.acquisition);
  assert.equal(loaded.cases['2024-05-06'].eligibleForTraining, true);
  assert.deepEqual(summarizeAcquisition(loaded), { cases: 2, spc: 1, era5Raw: 1, era5Extracted: 1, noaa: 1, paired: 0, ready: 1, failed: 0 });

  const atmosphere = createAtmosphericRecord({ eventDate: '2024-05-06', surface: { cape: { max: 3000 } }, derived: { capeMaxJkg: 3000 } });
  assert.equal(validateAtmosphericRecord(atmosphere).valid, true);
  await writeFile(path.join(paths.era5Records, '2024-05-06.json'), JSON.stringify(atmosphere));
  assert.equal(JSON.parse(await readFile(path.join(paths.era5Records, '2024-05-06.json'), 'utf8')).source, 'ERA5');
  console.log('2.36.1 training acquisition manager tests passed.');
} finally {
  await rm(temp, { recursive: true, force: true });
}
