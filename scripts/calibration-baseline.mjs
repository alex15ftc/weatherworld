import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2); const get=(n)=>{const i=args.indexOf(n);return i>=0?args[i+1]:null};
const source=get('--source'); const compare=get('--compare');
if(!source) throw new Error('Usage: npm run calibrate:baseline -- --source calibration/reports/<report>.json [--compare calibration/baselines/current.json]');
const report=JSON.parse(fs.readFileSync(path.resolve(source),'utf8'));
const snapshot={schemaVersion:1,createdAt:new Date().toISOString(),source:path.relative(ROOT,path.resolve(source)),meanScore:report.meanScore??report.aggregate?.meanScore??0,meanEnvironmentScore:report.aggregate?.meanEnvironmentScore??0,meanConsistencyScore:report.aggregate?.meanConsistencyScore??0,riskDistribution:report.aggregate?.riskDistribution??{},biasSignals:report.aggregate?.biasSignals??[]};
const dir=path.join(ROOT,'calibration/baselines');fs.mkdirSync(dir,{recursive:true});
if(compare){const prior=JSON.parse(fs.readFileSync(path.resolve(compare),'utf8'));snapshot.comparison={meanScoreDelta:snapshot.meanScore-prior.meanScore,environmentDelta:snapshot.meanEnvironmentScore-prior.meanEnvironmentScore,consistencyDelta:snapshot.meanConsistencyScore-prior.meanConsistencyScore};}
const out=path.join(dir,'current.json');fs.writeFileSync(out,JSON.stringify(snapshot,null,2)+'\n');console.log(`[calibration] wrote ${path.relative(ROOT,out)}`);if(snapshot.comparison)console.log(JSON.stringify(snapshot.comparison,null,2));
