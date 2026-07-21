#!/usr/bin/env node
/**
 * Full demo dataset: seed-demo → seed-infra → seed-providers.
 *
 *   npm run seed:all -- --reset
 *   docker compose exec api npm run seed:all -- --reset
 *
 * Forwards CLI flags (e.g. --reset) and SEED_EMPLOYEES to seed-demo.
 * Do not run against production.
 */
const { spawnSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
const steps = [
  ['scripts/seed-demo.js', args],
  ['scripts/seed-infra-demo.js', []],
  ['scripts/seed-providers-demo.js', []],
];

for (const [script, scriptArgs] of steps) {
  console.log(`\n======== ${script} ${scriptArgs.join(' ')} ========`);
  const r = spawnSync(process.execPath, [path.join(root, script), ...scriptArgs], {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
  });
  if (r.status !== 0) process.exit(r.status || 1);
}
console.log('\n[seed:all] complete');
