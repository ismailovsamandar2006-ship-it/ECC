/**
 * Smoke tests for the standalone Vercel app in apps/bank-battle-live.
 *
 * The app is ESM ("type": "module") with its own server test (tests.mjs), so it
 * runs in a child process. The static checks guard the Vercel layout: only
 * public/ is served, so the answer key in lib/questions.js never ships to browsers.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const appDir = path.join(__dirname, '..', '..', 'apps', 'bank-battle-live');

function test(name, fn) {
  try {
    fn();
    console.log(`PASS: ${name}`);
    return true;
  } catch (error) {
    console.log(`FAIL: ${name}`);
    console.log(`  ${error.message}`);
    return false;
  }
}

let passed = 0;
let failed = 0;

if (
  test('game server flow passes (create, join, 30 questions, scoring, winner)', () => {
    const result = spawnSync(process.execPath, ['tests.mjs'], {
      cwd: appDir,
      env: { ...process.env, LOCAL_DEMO: '1' },
      encoding: 'utf8',
      timeout: 60000,
    });
    assert.strictEqual(result.status, 0, `tests.mjs failed:\n${result.stdout}\n${result.stderr}`);
  })
)
  passed++;
else failed++;

if (
  test('vercel.json serves only public/ and does not mix legacy routes with headers', () => {
    const config = JSON.parse(fs.readFileSync(path.join(appDir, 'vercel.json'), 'utf8'));
    assert.strictEqual(config.outputDirectory, 'public');
    assert.strictEqual(config.routes, undefined, 'routes cannot be combined with headers on Vercel');
  })
)
  passed++;
else failed++;

if (
  test('answer key stays server-side (lib/ is outside public/)', () => {
    assert.ok(fs.existsSync(path.join(appDir, 'lib', 'questions.js')));
    assert.ok(!fs.existsSync(path.join(appDir, 'public', 'lib')));
    for (const page of ['index.html', 'host.html', 'play.html', 'screen.html']) {
      assert.ok(fs.existsSync(path.join(appDir, 'public', page)), `missing public/${page}`);
    }
  })
)
  passed++;
else failed++;

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
