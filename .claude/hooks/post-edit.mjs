// PostToolUse hook for Edit/Write/MultiEdit.
// - .luau files: lint with selene (errors only; warnings are left for manual runs).
// - Engine files: once per session, remind about the regression suite.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let input = {};
try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { process.exit(0); }
const file = input.tool_input?.file_path;
if (!file) process.exit(0);

const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
const rel = path.relative(root, file).split(path.sep).join('/');

if (rel.endsWith('.luau') && !rel.startsWith('..')) {
  const r = spawnSync('selene', ['--display-style', 'quiet', file], { cwd: root, encoding: 'utf8', windowsHide: true });
  const errors = `${r.stdout || ''}${r.stderr || ''}`.split(/\r?\n/)
    .filter((l) => /error\[|parse error/i.test(l) && !/^\s*\d+ (parse )?errors?$/i.test(l))
    // Known false positive: selene's Roblox std lacks Vector3 axis methods.
    .filter((l) => !/does not contain the field `Cross`/.test(l));
  if (errors.length) {
    process.stderr.write(`selene found errors in ${rel}:\n${errors.join('\n')}\n`);
    process.exit(2);
  }
}

const ENGINE = /^js\/(storms|world|atmosphere|mesoscale)\//;
if (ENGINE.test(rel)) {
  const marker = path.join(os.tmpdir(), `ww-regress-reminder-${input.session_id || 'x'}`);
  if (!fs.existsSync(marker)) {
    fs.writeFileSync(marker, '');
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: 'Engine file edited. Per the regression-suite rule: a baseline must exist before the batch and '
          + 'a check must run after it (see the engine-batch skill). No fix is kept if a measure regresses beyond tolerance.',
      },
    }));
  }
}
process.exit(0);
