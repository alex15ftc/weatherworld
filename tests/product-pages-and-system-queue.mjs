import fs from 'node:fs';
for (const file of ['index.html','day1.html','day2.html','day3.html']) { const html=fs.readFileSync(new URL('../'+file, import.meta.url),'utf8'); if(!html.includes('product-nav')) throw new Error(file+' missing product navigation'); }
const main=fs.readFileSync(new URL('../js/main.js', import.meta.url),'utf8');
if(!main.includes('prepareUpcomingSystem')) throw new Error('upcoming system queue missing');
if(!main.includes("PAGE_MODE === 'live'")) throw new Error('page mode split missing');
const outlook=fs.readFileSync(new URL('../js/forecast/OutlookCycleEngine.js', import.meta.url),'utf8');
if(!outlook.includes('upcomingSystemWeight')) throw new Error('outlook transition weighting missing');
console.log('product pages and system queue passed');
