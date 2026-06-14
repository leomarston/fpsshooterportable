// Static check: parse every source file, then run the headless logic tests.
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.js')) out.push(p);
  }
  return out;
}

let failed = 0;
for (const f of [...walk('src'), 'serve.js']) {
  try { execFileSync('node', ['--check', f], { stdio: 'pipe' }); }
  catch (e) { failed++; console.log('SYNTAX FAIL:', f, '\n', e.stderr?.toString() || e.message); }
}
console.log(failed ? `\n${failed} syntax error(s).` : 'Syntax: all source files OK.');
if (failed) process.exit(1);

console.log('\nRunning logic tests…');
try { execFileSync('node', ['--import', './tools/loader.mjs', 'tools/logictest.mjs'], { stdio: 'inherit' }); }
catch { process.exit(1); }
