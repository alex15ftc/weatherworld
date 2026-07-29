#!/usr/bin/env node
import { spawn } from 'node:child_process';

const validateCode = await run('node', ['scripts/historical-pipeline.mjs', '--progress', '--write-reports']);
const pairCode = await run('node', ['scripts/pair-historical-training-corpus.mjs']);
if (validateCode !== 0) console.warn('Training preparation completed with rejected SPC records. See data/historical/validation/spc and the catalog error counts.');
process.exitCode = pairCode !== 0 ? pairCode : validateCode;

function run(command, args) {
  return new Promise(resolve => {
    const child = spawn(command, args, { stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('exit', code => resolve(code ?? 1));
    child.on('error', error => { console.error(error); resolve(1); });
  });
}
