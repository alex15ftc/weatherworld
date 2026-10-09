import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSeedVerification } from '../js/verification/ForecastVerificationEngine.js';
import { critiqueVerification, aggregateCritiques } from '../js/verification/CalibrationCritic.js';
import { buildConsistencyAudit, aggregateConsistencyAudits } from '../js/verification/ConsistencyAuditFramework.js';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2); const get=(n,d)=>{const i=args.indexOf(n);return i>=0?args[i+1]:d};
const start=Number(get('--start','100000')); const count=Math.max(1,Number(get('--count','10'))); const hours=Math.max(.5,Number(get('--hours','72')));
const members=[];
for(let i=0;i<count;i++){
 const seed=start+i; const report=runSeedVerification(seed,{hours});
 const verified=report.forecast?.byDay?.day1?.latest?.forecastOverallRisk;
 const issued=report.forecast?.latestIssuedByDay?.day1?.forecastOverallRisk;
 const risk={label:verified??issued??'UNAVAILABLE',verificationStatus:verified?'VERIFIED':issued?'INCOMPLETE_TRUTH_WINDOW':'UNAVAILABLE'};
 const critic=critiqueVerification(report,{}); const score=critic.consistencyScore;
 const consistencyAudit=buildConsistencyAudit(report,critic);
 members.push({seed,score,risk,critic,consistencyAudit,event:report.event,scenario:report.scenario,forecastAvailability:{productsScored:report.forecast?.productsScored??0,productsSkipped:report.forecast?.productsSkipped??0}});
 console.log(`[audit] ${i+1}/${count} seed=${seed} risk=${risk.label} status=${risk.verificationStatus} consistency=${score.toFixed(3)} flags=${critic.flags.length}`);
}
const output={schemaVersion:2,generatedAt:new Date().toISOString(),startSeed:start,count,hours,note:hours<72?'Short audits use latest issued risk but cannot fully verify all Day 1 products. Use --hours 72 for outlook calibration.':null,aggregate:{...aggregateCritiques(members),consistencyAudit:aggregateConsistencyAudits(members)},members};
const dir=path.join(ROOT,'calibration/reports');fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,`audit-${start}-${count}-${hours}h.json`);fs.writeFileSync(file,JSON.stringify(output,null,2)+'\n');console.log(`[audit] wrote ${path.relative(ROOT,file)}`);
