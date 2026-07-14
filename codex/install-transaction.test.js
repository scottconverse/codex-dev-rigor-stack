#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { treeDigest, managedRuntimeDigest } = require('./install-transaction.js');

const ROOT = path.resolve(__dirname, '..');
const COORDINATOR = path.join(__dirname, 'install-transaction.js');
const SKILLS = [
  'dev-rigor-stack', 'dev-rigor-stack-continuity', 'dev-rigor-stack-plan',
  'dev-rigor-stack-build', 'dev-rigor-stack-proof-gate', 'dev-rigor-stack-audit-lite',
  'dev-rigor-stack-audit-team', 'dev-rigor-stack-walkthrough',
  'dev-rigor-stack-visitor-audit', 'dev-rigor-stack-gauntletgate',
  'dev-rigor-stack-merge-gate', 'dev-rigor-stack-docs-gate',
  'dev-rigor-stack-release', 'coder-tdd-qa', 'proof-gate', 'audit-lite',
  'audit-team', 'gauntletgate', 'visitor-audit',
];

function invoke(args, env = {}, expected = 0) {
  const result = spawnSync(process.execPath, [COORDINATOR, ...args], {
    cwd: ROOT,
    env: { ...process.env, CI: '1', ...env },
    encoding: 'utf8',
    timeout: 120000,
  });
  assert.strictEqual(result.status, expected,
    `unexpected exit for ${args.join(' ')}\nstdout=${result.stdout}\nstderr=${result.stderr}`);
  return result;
}

function installArgs(home, extra = []) {
  return ['install', '--repo', ROOT, '--codex-home', home, ...extra];
}

function uninstallArgs(home) {
  return ['uninstall', '--codex-home', home, '--skip-trust-revocation'];
}

async function waitFor(file, child, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) return;
    if (child.exitCode !== null) throw new Error(`child exited before barrier: ${child.exitCode}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for ${file}`);
}

function waitForExit(child, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('child exit timed out'));
    }, timeoutMs);
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

function spawnPaused(args, control, barrier, extraEnv = {}) {
  fs.mkdirSync(control, { recursive: true });
  return spawn(process.execPath, [COORDINATOR, ...args], {
    cwd: ROOT,
    env: {
      ...process.env,
      CI: '1',
      DEV_RIGOR_TXN_PAUSE_AT: barrier,
      DEV_RIGOR_TXN_CONTROL_DIR: control,
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function assertNoOwnedInstall(home) {
  assert.ok(!fs.existsSync(path.join(home, 'dev-rigor-stack')), 'runtime survived rollback');
  for (const skill of SKILLS) {
    assert.ok(!fs.existsSync(path.join(home, 'skills', skill)), `${skill} survived rollback`);
  }
}

function snapshot(root) {
  const result = {};
  if (!fs.existsSync(root)) return result;
  function visit(current, relative = '') {
    const stat = fs.lstatSync(current);
    const key = relative.replace(/\\/g, '/');
    if (relative) {
      if (stat.isSymbolicLink()) result[key] = `link:${fs.readlinkSync(current)}`;
      else if (stat.isDirectory()) result[key] = 'dir';
      else result[key] = `file:${crypto.createHash('sha256').update(fs.readFileSync(current)).digest('hex')}`;
    }
    if (stat.isDirectory() && !stat.isSymbolicLink()) {
      for (const name of fs.readdirSync(current).sort()) visit(path.join(current, name), path.join(relative, name));
    }
  }
  visit(root);
  return result;
}

function fileHash(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function assertTransactionClean(home) {
  for (const parent of ['.staging', '.rollback', '.transactions']) {
    const namespace = path.join(home, parent, 'dev-rigor-stack');
    assert.ok(!fs.existsSync(namespace), `transaction namespace survived: ${namespace}`);
  }
}

async function testHappyOwnershipAndForeignPreservation(root) {
  const pristine = path.join(root, 'pristine');
  invoke(installArgs(pristine, ['--no-backup']));
  assert.ok(fs.existsSync(path.join(pristine, 'dev-rigor-stack', 'install-ownership-v2.json')));
  invoke(uninstallArgs(pristine));
  assert.ok(!fs.existsSync(path.join(pristine, 'hooks.json')), 'owned empty hooks.json survived');
  assert.ok(!fs.existsSync(path.join(pristine, 'skills')), 'owned empty skills directory survived');
  assertTransactionClean(pristine);

  const preexisting = path.join(root, 'preexisting');
  fs.mkdirSync(path.join(preexisting, 'skills'), { recursive: true });
  fs.writeFileSync(path.join(preexisting, 'hooks.json'), '{"hooks": {}}\n');
  invoke(installArgs(preexisting, ['--no-backup']));
  invoke(uninstallArgs(preexisting));
  assert.ok(fs.statSync(path.join(preexisting, 'skills')).isDirectory());
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(preexisting, 'hooks.json'))), { hooks: {} });

  const foreign = path.join(root, 'foreign');
  invoke(installArgs(foreign, ['--no-backup']));
  const foreignFile = path.join(foreign, 'skills', 'foreign-owner', 'keep.bin');
  fs.mkdirSync(path.dirname(foreignFile));
  fs.writeFileSync(foreignFile, Buffer.from([0, 1, 255]));
  const hooksPath = path.join(foreign, 'hooks.json');
  const hooks = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
  hooks.foreignRoot = { preserve: true };
  fs.writeFileSync(hooksPath, `${JSON.stringify(hooks, null, 2)}\n`);
  invoke(uninstallArgs(foreign));
  assert.deepStrictEqual(fs.readFileSync(foreignFile), Buffer.from([0, 1, 255]));
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(hooksPath, 'utf8')).foreignRoot, { preserve: true });
}

function seedCurrentV4State(home, includeForeign = true) {
  const state = path.join(home, 'dev-rigor-stack', 'state');
  fs.mkdirSync(state, { recursive: true });
  const taskKey = 'a'.repeat(64);
  const salt = '3'.repeat(64);
  const saltCommitment = crypto.createHash('sha256').update(salt).update('\0').digest('hex');
  const exact = {
    [`task-v4-${taskKey}.json`]: `${JSON.stringify({ version: 4, taskKey, mode: 'ON', salt })}\n`,
    [`task-genesis-v4-${taskKey}.json`]: `${JSON.stringify({ version: 4, taskKey, saltCommitment })}\n`,
    [`evidence-v4-${'2'.repeat(16)}.json`]: '{"version":4,"proof":"privacy-safe"}\n',
    [`mechanical-v4-${'b'.repeat(64)}.log`]: 'M debt\n',
    [`ground-v4-${'c'.repeat(64)}.log`]: 'E proof.js\n',
    [`pre-v4-${'d'.repeat(64)}.json`]: '{"pending":true}\n',
    [`router-v4-${'e'.repeat(64)}.log`]: 'route\n',
    [`exec-v4-${'f'.repeat(64)}.receipt`]: 'nonce:0\n',
  };
  for (const [name, content] of Object.entries(exact)) fs.writeFileSync(path.join(state, name), content);
  for (const name of ['associations-v4', 'association-debt-v4', 'association-resolutions-v4']) {
    fs.mkdirSync(path.join(state, name));
    fs.writeFileSync(path.join(state, name, 'keep.json'), '{}\n');
  }
  const expected = new Set([...Object.keys(exact), 'associations-v4', 'association-debt-v4', 'association-resolutions-v4']);
  if (includeForeign) {
    fs.writeFileSync(path.join(state, 'ground-v3-legacy.log'), 'legacy\n');
    fs.writeFileSync(path.join(state, 'unknown-v4-file.txt'), 'unknown\n');
    expected.add('ground-v3-legacy.log');
    expected.add('unknown-v4-file.txt');
  }
  return expected;
}

async function testBackupsStateAndOriginCleanup(root) {
  const clean = path.join(root, 'backup-clean');
  invoke(installArgs(clean, ['--no-backup']));
  const expectedState = seedCurrentV4State(clean);
  const stateRoot = path.join(clean, 'dev-rigor-stack', 'state');
  const expectedStateBytes = Object.fromEntries(Object.entries(snapshot(stateRoot))
    .filter(([relative]) => expectedState.has(relative.split('/')[0])));
  invoke(installArgs(clean));
  const stateNames = new Set(fs.readdirSync(stateRoot));
  assert.deepStrictEqual(stateNames, expectedState, 'same-version update dropped persistent owned or foreign state');
  assert.deepStrictEqual(snapshot(stateRoot), expectedStateBytes,
    'same-version update changed persistent state bytes');
  const ownershipPath = path.join(clean, 'dev-rigor-stack', 'install-ownership-v2.json');
  const ownership = JSON.parse(fs.readFileSync(ownershipPath, 'utf8'));
  assert.strictEqual(ownership.backups.length, 1, 'default backup-bearing update did not record exactly one backup');
  assert.strictEqual(ownership.backups[0].skills.present, true);
  assert.strictEqual(ownership.backups[0].home.present, true);
  assert.match(ownership.backups[0].skills.digest, /^[a-f0-9]{64}$/);
  assert.match(ownership.backups[0].home.digest, /^[a-f0-9]{64}$/);
  const foreignStateExpected = snapshot(clean);
  const foreignStateRefusal = invoke(uninstallArgs(clean), {}, 1);
  assert.match(`${foreignStateRefusal.stdout}\n${foreignStateRefusal.stderr}`, /STATE.*unrecognized/i,
    'uninstall did not identify unowned persistent state explicitly');
  assert.deepStrictEqual(snapshot(clean), foreignStateExpected, 'uninstall refusal changed unowned persistent state');
  fs.unlinkSync(path.join(stateRoot, 'ground-v3-legacy.log'));
  fs.unlinkSync(path.join(stateRoot, 'unknown-v4-file.txt'));
  invoke(uninstallArgs(clean));
  assert.ok(!fs.existsSync(path.join(clean, 'dev-rigor-stack')),
    'successful uninstall retained exact owned task-genesis state');
  assert.ok(!fs.existsSync(path.join(clean, '.backup')), 'owned backup parent survived clean uninstall');
  assert.ok(!fs.existsSync(path.join(clean, 'skills')), 'owned skills/backup root survived clean uninstall');
  assert.ok(!fs.existsSync(path.join(clean, 'hooks.json')), 'owned hooks file survived clean uninstall');
  assertTransactionClean(clean);

  const foreign = path.join(root, 'backup-foreign');
  invoke(installArgs(foreign, ['--no-backup']));
  invoke(installArgs(foreign));
  const foreignOwnership = JSON.parse(fs.readFileSync(path.join(foreign, 'dev-rigor-stack', 'install-ownership-v2.json'), 'utf8'));
  const backup = foreignOwnership.backups[0];
  const skillsNamespace = path.join(foreign, 'skills', '.backup', 'codex-dev-rigor-stack');
  const homeNamespace = path.join(foreign, '.backup', 'codex-dev-rigor-stack');
  const unknown = path.join(skillsNamespace, 'foreign-owner', 'keep.bin');
  fs.mkdirSync(path.dirname(unknown));
  fs.writeFileSync(unknown, Buffer.from([9, 8, 7]));
  const tamperedHome = path.join(homeNamespace, backup.id);
  const markerPath = path.join(tamperedHome, '.dev-rigor-backup-owner-v1.json');
  const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  marker.lineage = '0'.repeat(32);
  fs.writeFileSync(markerPath, `${JSON.stringify(marker, null, 2)}\n`);
  const result = invoke(uninstallArgs(foreign));
  const parsed = JSON.parse(result.stdout);
  assert.ok(parsed.warnings.some((warning) => /preserved/.test(warning)), 'modified backup preservation was not visible');
  assert.ok(!fs.existsSync(path.join(skillsNamespace, backup.id)), 'exact owned skills backup survived uninstall');
  assert.deepStrictEqual(fs.readFileSync(unknown), Buffer.from([9, 8, 7]), 'foreign backup sibling was removed');
  assert.ok(fs.existsSync(tamperedHome), 'tampered backup marker was trusted and recursively deleted');
  assertTransactionClean(foreign);

  const digestTamper = path.join(root, 'backup-digest-tamper');
  invoke(installArgs(digestTamper, ['--no-backup']));
  invoke(installArgs(digestTamper));
  const digestOwnership = JSON.parse(fs.readFileSync(
    path.join(digestTamper, 'dev-rigor-stack', 'install-ownership-v2.json'), 'utf8'));
  const digestBackup = digestOwnership.backups[0];
  const tamperedSkills = path.join(
    digestTamper, 'skills', '.backup', 'codex-dev-rigor-stack', digestBackup.id);
  fs.writeFileSync(path.join(tamperedSkills, 'content-added-after-backup.bin'), Buffer.from([4, 5, 6]));
  const digestResult = invoke(uninstallArgs(digestTamper));
  const digestParsed = JSON.parse(digestResult.stdout);
  assert.ok(digestParsed.warnings.some((warning) => /preserved/.test(warning)),
    'backup digest mismatch preservation was not visible');
  assert.ok(fs.existsSync(tamperedSkills), 'backup content digest mismatch was trusted and recursively deleted');
  assertTransactionClean(digestTamper);
}

async function testUninstallCrashRecovery(root) {
  const home = path.join(root, 'uninstall-crash');
  invoke(installArgs(home, ['--no-backup']));
  seedCurrentV4State(home, false);
  for (const name of ['.staging', '.rollback', '.transactions']) fs.mkdirSync(path.join(home, name), { recursive: true });
  const expected = snapshot(home);
  for (const crashAt of ['after-skills', 'after-runtime', 'after-hooks-apply', 'before-commit']) {
    invoke(uninstallArgs(home), { DEV_RIGOR_TXN_CRASH_AT: crashAt }, 86);
    invoke(['recover-only', '--codex-home', home]);
    assert.deepStrictEqual(snapshot(home), expected, `uninstall recovery changed profile after ${crashAt}`);
    assertTransactionClean(home);
  }
  invoke(uninstallArgs(home));
}

async function testCaughtFailuresAndMissingHooks(root) {
  const fresh = path.join(root, 'fresh-failure');
  invoke(installArgs(fresh, ['--no-backup']), { DEV_RIGOR_INSTALL_TEST_FAIL_AT: 'mid-commit' }, 1);
  assert.deepStrictEqual(snapshot(fresh), {}, 'caught fresh install failure left owned scaffolding');

  const update = path.join(root, 'late-failure');
  invoke(installArgs(update, ['--no-backup']));
  const before = snapshot(update);
  invoke(installArgs(update), { DEV_RIGOR_INSTALL_TEST_FAIL_AT: 'backup-finalization' }, 1);
  assert.deepStrictEqual(snapshot(update), before, 'late backup-finalization failure was not byte-exact');
  invoke(uninstallArgs(update));

  const missingHooks = path.join(root, 'missing-hooks');
  invoke(installArgs(missingHooks, ['--no-backup']));
  fs.unlinkSync(path.join(missingHooks, 'hooks.json'));
  invoke(uninstallArgs(missingHooks));
  assert.ok(!fs.existsSync(path.join(missingHooks, 'hooks.json')), 'uninstall manufactured a missing hooks.json');
}

async function testJournalCannotRedirectOwnedDeletion(root) {
  const home = path.join(root, 'journal-path-binding');
  invoke(installArgs(home, ['--no-backup']));
  invoke(installArgs(home), { DEV_RIGOR_TXN_CRASH_AT: 'after-runtime' }, 86);
  const journals = path.join(home, '.transactions', 'dev-rigor-stack', 'journals');
  const transaction = fs.readdirSync(journals)[0];
  const snapshots = fs.readdirSync(path.join(journals, transaction)).sort();
  const latest = path.join(journals, transaction, snapshots[snapshots.length - 1]);
  const journal = JSON.parse(fs.readFileSync(latest, 'utf8'));
  const victim = path.join(root, 'foreign-victim');
  fs.mkdirSync(victim);
  fs.writeFileSync(path.join(victim, 'keep.txt'), 'foreign\n');
  journal.backupPlan.skillsPath = victim;
  fs.writeFileSync(latest, `${JSON.stringify(journal, null, 2)}\n`);
  const refused = invoke(['recover-only', '--codex-home', home], {}, 1);
  assert.match(`${refused.stdout}\n${refused.stderr}`, /JOURNAL.*backup plan path/i,
    'redirected journal failed for an incidental reason instead of strict path validation');
  assert.strictEqual(fs.readFileSync(path.join(victim, 'keep.txt'), 'utf8'), 'foreign\n');
}

async function testPreparationAndStateRaces(root) {
  const stateHome = path.join(root, 'state-generation-race');
  invoke(installArgs(stateHome, ['--no-backup']));
  const state = path.join(stateHome, 'dev-rigor-stack', 'state');
  fs.mkdirSync(state, { recursive: true });
  const stateKey = 'a'.repeat(64);
  const stateSalt = 'b'.repeat(64);
  const task = path.join(state, `task-v4-${stateKey}.json`);
  fs.writeFileSync(task, `${JSON.stringify({ version: 4, taskKey: stateKey, mode: 'ON', salt: stateSalt, generation: 'A' })}\n`);
  fs.writeFileSync(path.join(state, `task-genesis-v4-${stateKey}.json`), `${JSON.stringify({
    version: 4,
    taskKey: stateKey,
    saltCommitment: crypto.createHash('sha256').update(stateSalt).update('\0').digest('hex'),
  })}\n`);
  const expected = snapshot(stateHome);
  const control = path.join(root, 'state-race-control');
  const updating = spawnPaused(installArgs(stateHome, ['--no-backup']), control, 'install:after-state-stage');
  await waitFor(path.join(control, 'install_after-state-stage.ready'), updating);
  fs.writeFileSync(task, `${JSON.stringify({ version: 4, taskKey: stateKey, mode: 'ON', salt: stateSalt, generation: 'B' })}\n`);
  const taskRelative = path.relative(stateHome, task).replace(/\\/g, '/');
  expected[taskRelative] = `file:${crypto.createHash('sha256').update(fs.readFileSync(task)).digest('hex')}`;
  fs.writeFileSync(path.join(control, 'install_after-state-stage.continue'), 'continue\n');
  const updateExit = await waitForExit(updating);
  assert.notStrictEqual(updateExit.code, 0, 'install accepted a newer active state generation with an older staged generation');
  assert.deepStrictEqual(snapshot(stateHome), expected, 'state-generation rejection did not restore the exact newer profile');
  assert.strictEqual(JSON.parse(fs.readFileSync(task, 'utf8')).generation, 'B');
  assertTransactionClean(stateHome);

  const backupHome = path.join(root, 'partial-backup-crash');
  invoke(installArgs(backupHome, ['--no-backup']));
  const backupExpected = snapshot(backupHome);
  invoke(installArgs(backupHome), { DEV_RIGOR_TXN_CRASH_AT: 'install:after-backup-copy' }, 86);
  invoke(['recover-only', '--codex-home', backupHome]);
  assert.deepStrictEqual(snapshot(backupHome), backupExpected,
    'markerless partial backup crash did not restore the exact profile');
  assertTransactionClean(backupHome);
}

async function testInstallSourceFreeze(root) {
  const source = path.join(root, 'mutable-source');
  fs.mkdirSync(source, { recursive: true });
  fs.cpSync(path.join(ROOT, 'codex'), path.join(source, 'codex'), { recursive: true });
  fs.mkdirSync(path.join(source, 'skills'), { recursive: true });
  for (const name of SKILLS) {
    fs.cpSync(path.join(ROOT, 'skills', name), path.join(source, 'skills', name), { recursive: true });
  }
  const home = path.join(root, 'source-freeze-home');
  const control = path.join(root, 'source-freeze-control');
  const args = ['install', '--repo', source, '--codex-home', home, '--no-backup'];
  const child = spawnPaused(args, control, 'install:after-source-baseline');
  await waitFor(path.join(control, 'install_after-source-baseline.ready'), child);
  fs.appendFileSync(path.join(source, 'skills', 'visitor-audit', 'SKILL.md'), '\nsource-race\n');
  fs.writeFileSync(path.join(control, 'install_after-source-baseline.continue'), 'continue\n');
  const result = await waitForExit(child);
  assert.notStrictEqual(result.code, 0, 'installer accepted a repository change after freezing its source baseline');
  assertNoOwnedInstall(home);
  assertTransactionClean(home);
  assert.deepStrictEqual(snapshot(home), {}, 'source-race refusal left profile mutations or transaction scaffolding');

  const runtimeHome = path.join(root, 'runtime-source-freeze-home');
  const runtimeControl = path.join(root, 'runtime-source-freeze-control');
  const runtimeChild = spawnPaused(
    ['install', '--repo', source, '--codex-home', runtimeHome, '--no-backup'],
    runtimeControl, 'install:after-source-baseline');
  await waitFor(path.join(runtimeControl, 'install_after-source-baseline.ready'), runtimeChild);
  fs.appendFileSync(path.join(source, 'codex', 'hooks', 'wire-hooks.js'), '\n// runtime-source-race\n');
  fs.writeFileSync(path.join(runtimeControl, 'install_after-source-baseline.continue'), 'continue\n');
  const runtimeResult = await waitForExit(runtimeChild);
  assert.notStrictEqual(runtimeResult.code, 0,
    'installer accepted a runtime repository change after freezing its source baseline');
  assertNoOwnedInstall(runtimeHome);
  assertTransactionClean(runtimeHome);
  assert.deepStrictEqual(snapshot(runtimeHome), {},
    'runtime source-race refusal left profile mutations or transaction scaffolding');
}

async function testOwnershipAndPathRefusals(root) {
  const missing = path.join(root, 'missing-ownership');
  invoke(installArgs(missing, ['--no-backup']));
  fs.unlinkSync(path.join(missing, 'dev-rigor-stack', 'install-ownership-v2.json'));
  const missingExpected = snapshot(missing);
  const missingRefusal = invoke(uninstallArgs(missing), {}, 1);
  assert.match(`${missingRefusal.stdout}\n${missingRefusal.stderr}`, /OWNERSHIP.*missing/i,
    'missing ownership failed for an incidental reason');
  assert.deepStrictEqual(snapshot(missing), missingExpected, 'missing ownership refusal changed the profile');

  for (const backupMode of ['no-backup', 'default-backup']) {
    const unowned = path.join(root, `unowned-existing-runtime-${backupMode}`);
    const unownedRuntime = path.join(unowned, 'dev-rigor-stack');
    fs.mkdirSync(unownedRuntime, { recursive: true });
    fs.writeFileSync(path.join(unownedRuntime, 'foreign-owner.bin'), Buffer.from([0, 222, 173, 190, 239]));
    for (const name of SKILLS) {
      const unownedSkill = path.join(unowned, 'skills', name);
      fs.mkdirSync(unownedSkill, { recursive: true });
      fs.writeFileSync(path.join(unownedSkill, 'foreign-owner.bin'), Buffer.from(`foreign:${name}\n`));
    }
    const unownedExpected = snapshot(unowned);
    const extra = backupMode === 'no-backup' ? ['--no-backup'] : [];
    const unownedRefusal = invoke(installArgs(unowned, extra), {}, 1);
    assert.match(`${unownedRefusal.stdout}\n${unownedRefusal.stderr}`, /OWNERSHIP.*missing/i,
      `unowned existing runtime ${backupMode} failed for an incidental reason`);
    assert.deepStrictEqual(snapshot(unowned), unownedExpected,
      `unowned existing runtime ${backupMode} was not preserved byte-for-byte`);
  }

  const foreign = path.join(root, 'managed-tree-foreign');
  invoke(installArgs(foreign, ['--no-backup']));
  fs.writeFileSync(path.join(foreign, 'dev-rigor-stack', 'user-owned.bin'), Buffer.from([7, 0, 7]));
  fs.writeFileSync(path.join(foreign, 'skills', 'visitor-audit', 'user-owned.bin'), Buffer.from([8, 0, 8]));
  const foreignExpected = snapshot(foreign);
  invoke(uninstallArgs(foreign), {}, 1);
  assert.deepStrictEqual(snapshot(foreign), foreignExpected, 'foreign managed-tree refusal changed the profile');

  const legacyMarker = path.join(root, 'foreign-v1-marker');
  invoke(installArgs(legacyMarker, ['--no-backup']));
  fs.writeFileSync(path.join(legacyMarker, 'dev-rigor-stack', 'install-ownership-v1.json'), '{"foreign":true}\n');
  const legacyMarkerExpected = snapshot(legacyMarker);
  const legacyMarkerRefusal = invoke(uninstallArgs(legacyMarker), {}, 1);
  assert.match(`${legacyMarkerRefusal.stdout}\n${legacyMarkerRefusal.stderr}`, /OWNERSHIP.*runtime changed/i,
    'foreign v1 marker remained outside the v2 managed-runtime digest');
  assert.deepStrictEqual(snapshot(legacyMarker), legacyMarkerExpected,
    'foreign v1 ownership-marker refusal changed the profile');

  const overlap = path.join(root, 'overlap-home-target');
  invoke(['install', '--repo', ROOT, '--codex-home', overlap, '--target', overlap, '--no-backup'], {}, 1);
  assert.deepStrictEqual(snapshot(overlap), {}, 'overlapping home/target refusal left transaction or install artifacts');

  const containingRoot = path.join(root, 'target-contains-home');
  const containedHome = path.join(containingRoot, 'home');
  fs.mkdirSync(containingRoot);
  const containingExpected = snapshot(containingRoot);
  invoke(['install', '--repo', ROOT, '--codex-home', containedHome, '--target', containingRoot, '--no-backup'], {}, 1);
  assert.deepStrictEqual(snapshot(containingRoot), containingExpected,
    'target-containing-home refusal changed the containing target');

  const customInsideHome = path.join(root, 'custom-target-inside-home');
  invoke(['install', '--repo', ROOT, '--codex-home', customInsideHome,
    '--target', path.join(customInsideHome, 'custom-skills'), '--no-backup'], {}, 1);
  assert.deepStrictEqual(snapshot(customInsideHome), {},
    'noncanonical target-inside-home refusal left transaction or install artifacts');

  const repositoryTargetHome = path.join(root, 'repository-target-overlap-home');
  invoke(['install', '--repo', ROOT, '--codex-home', repositoryTargetHome,
    '--target', ROOT, '--no-backup'], {}, 1);
  assert.deepStrictEqual(snapshot(repositoryTargetHome), {},
    'repository/target overlap refusal left transaction or install artifacts');
}

async function testGenesisStateContract(root) {
  const cases = [
    ['genesis', `task-genesis-v4-${'A'.repeat(64)}.json`, /STATE.*task-genesis/i],
    ['evidence', `evidence-v4-${'2'.repeat(15)}.json`, /STATE.*evidence-v4/i],
    ['receipt', 'exec-v4-not-a-valid-receipt.receipt', /STATE.*exec-v4/i],
  ];
  for (const [label, filename, refusalPattern] of cases) {
    const home = path.join(root, `${label}-state-contract`);
    invoke(installArgs(home, ['--no-backup']));
    const state = path.join(home, 'dev-rigor-stack', 'state');
    fs.mkdirSync(state, { recursive: true });
    fs.writeFileSync(path.join(state, filename), '{"foreign":true}\n');
    const expected = snapshot(home);

    const installRefusal = invoke(installArgs(home, ['--no-backup']), {}, 1);
    assert.match(`${installRefusal.stdout}\n${installRefusal.stderr}`, refusalPattern,
      `malformed ${label} install refusal was not visible and specific`);
    assert.deepStrictEqual(snapshot(home), expected,
      `malformed ${label} install refusal changed the profile`);
    assertTransactionClean(home);

    const uninstallRefusal = invoke(uninstallArgs(home), {}, 1);
    assert.match(`${uninstallRefusal.stdout}\n${uninstallRefusal.stderr}`, refusalPattern,
      `malformed ${label} uninstall refusal was not visible and specific`);
    assert.deepStrictEqual(snapshot(home), expected,
      `malformed ${label} uninstall refusal changed the profile`);
    assertTransactionClean(home);
  }
}

function seedLegacyPr11Task(home, taskKey = '4'.repeat(64)) {
  const state = path.join(home, 'dev-rigor-stack', 'state');
  fs.mkdirSync(state, { recursive: true });
  const legacy = {
    version: 4,
    mode: 'OFF',
    salt: '5'.repeat(64),
    dirtyEdits: ['6'.repeat(16)],
    proofs: [{ token: '7'.repeat(16), checkpoint: 2, edits: ['e'.repeat(16)] }],
    unresolved: [{ id: '8'.repeat(16), editSetHash: '9'.repeat(16), edits: ['6'.repeat(16)], status: 'unresolved' }],
    warnings: { mechanicalUnavailable: { reason: 'missing-turn-id', delivered: false } },
    notices: [{ id: 'notice', message: 'preserve me', delivered: false }],
    children: ['a'.repeat(64)],
    checkpoint: 2,
    blockCount: 1,
    delivery: { preToolUse: 3, postToolUse: 2, stop: 1 },
  };
  const task = path.join(state, `task-v4-${taskKey}.json`);
  fs.writeFileSync(task, `${JSON.stringify(legacy)}\n`);
  return { state, task, taskKey, legacy };
}

async function testLegacyCurrentV4Migration(root) {
  const home = path.join(root, 'legacy-pr11-migration');
  invoke(installArgs(home, ['--no-backup']));
  const seeded = seedLegacyPr11Task(home);
  const before = fs.readFileSync(seeded.task);
  invoke(installArgs(home, ['--no-backup']));
  const migrated = JSON.parse(fs.readFileSync(seeded.task, 'utf8'));
  for (const [field, value] of Object.entries(seeded.legacy)) {
    if (!['dirtyEdits', 'notices', 'mechanical'].includes(field)) {
      assert.deepStrictEqual(migrated[field], value, `successful legacy migration changed PR11 field ${field}`);
    }
  }
  const proofEdits = seeded.legacy.proofs.flatMap((proof) => proof.edits || []);
  assert.deepStrictEqual(new Set(migrated.dirtyEdits), new Set([...seeded.legacy.dirtyEdits, ...proofEdits]),
    'migration did not re-arm the exact pre-canonical proof edit union');
  assert.deepStrictEqual(migrated.notices.slice(0, seeded.legacy.notices.length), seeded.legacy.notices,
    'successful legacy migration changed prior notices while appending its warning');
  assert.strictEqual(migrated.taskKey, seeded.taskKey, 'legacy task was not bound to its filename key');
  assert.ok(migrated.mechanical.some((item) => item.reason === 'legacy-proof-unverifiable' && item.status === 'unresolved'),
    'pre-canonical proof was silently treated as current accepted evidence');
  assert.ok(migrated.notices.some((item) => item.id.startsWith('legacy-proof-unverifiable:') && item.delivered === false),
    'pre-canonical proof migration did not surface a release-visible warning');
  const genesisPath = path.join(seeded.state, `task-genesis-v4-${seeded.taskKey}.json`);
  assert.ok(fs.existsSync(genesisPath), 'legacy migration did not create a current genesis record');
  const genesis = JSON.parse(fs.readFileSync(genesisPath, 'utf8'));
  assert.deepStrictEqual(genesis, {
    version: 4,
    taskKey: seeded.taskKey,
    saltCommitment: crypto.createHash('sha256').update(seeded.legacy.salt).update('\0').digest('hex'),
  }, 'legacy migration did not create the exact current genesis contract');

  const rollback = path.join(root, 'legacy-pr11-migration-rollback');
  invoke(installArgs(rollback, ['--no-backup']));
  const rollbackSeed = seedLegacyPr11Task(rollback, 'b'.repeat(64));
  const expected = snapshot(rollback);
  invoke(installArgs(rollback, ['--no-backup']), { DEV_RIGOR_INSTALL_TEST_FAIL_AT: 'backup-finalization' }, 1);
  assert.deepStrictEqual(snapshot(rollback), expected, 'failed migration did not restore exact legacy bytes and genesis absence');
  assert.deepStrictEqual(fs.readFileSync(rollbackSeed.task), Buffer.from(`${JSON.stringify(rollbackSeed.legacy)}\n`));
  assert.ok(!fs.existsSync(path.join(rollbackSeed.state, `task-genesis-v4-${rollbackSeed.taskKey}.json`)),
    'failed migration left a current genesis beside restored legacy bytes');

  for (const [label, taskValue, createGenesis] of [
    ['malformed', { version: 4, mode: 'ON' }, false],
    ['ambiguous', { version: 4, mode: 'ON', salt: 'c'.repeat(64) }, true],
  ]) {
    const refusedHome = path.join(root, `legacy-${label}-refusal`);
    invoke(installArgs(refusedHome, ['--no-backup']));
    const key = 'd'.repeat(64);
    const state = path.join(refusedHome, 'dev-rigor-stack', 'state');
    fs.mkdirSync(state, { recursive: true });
    fs.writeFileSync(path.join(state, `task-v4-${key}.json`), `${JSON.stringify(taskValue)}\n`);
    if (createGenesis) fs.writeFileSync(path.join(state, `task-genesis-v4-${key}.json`),
      `${JSON.stringify({ version: 4, taskKey: key, saltCommitment: 'e'.repeat(64) })}\n`);
    const refusedBefore = snapshot(refusedHome);
    const refused = invoke(installArgs(refusedHome, ['--no-backup']), {}, 1);
    assert.match(`${refused.stdout}\n${refused.stderr}`, /STATE.*(?:legacy|task|genesis)/i,
      `${label} legacy state did not fail closed for the state contract`);
    assert.deepStrictEqual(snapshot(refusedHome), refusedBefore, `${label} legacy refusal mutated the profile`);
    assertTransactionClean(refusedHome);
  }
  assert.notDeepStrictEqual(fs.readFileSync(seeded.task), before, 'successful migration did not change legacy bytes');
}

async function testCanonicalAliasRecovery(root) {
  const realHome = path.join(root, 'canonical-alias-real');
  const aliasHome = path.join(root, 'canonical-alias-link');
  fs.mkdirSync(realHome, { recursive: true });
  fs.symlinkSync(realHome, aliasHome, process.platform === 'win32' ? 'junction' : 'dir');

  invoke(installArgs(aliasHome, ['--no-backup']), { DEV_RIGOR_TXN_CRASH_AT: 'install:after-runtime' }, 86);
  fs.unlinkSync(aliasHome);
  invoke(['recover-only', '--codex-home', realHome]);
  assertNoOwnedInstall(realHome);
  assertTransactionClean(realHome);
  assert.deepStrictEqual(snapshot(realHome), {},
    'canonical recovery through the real profile path left alias-bound artifacts');
}

async function testDigestFraming(root) {
  const split = path.join(root, 'digest-split-tree');
  const fused = path.join(root, 'digest-fused-tree');
  fs.mkdirSync(split, { recursive: true });
  fs.mkdirSync(fused, { recursive: true });
  fs.writeFileSync(path.join(split, 'a'), Buffer.from('x'));
  fs.writeFileSync(path.join(split, 'b'), Buffer.from('y'));
  fs.writeFileSync(path.join(fused, 'a'), Buffer.from('xF\0b\0y'));

  assert.notStrictEqual(treeDigest(split), treeDigest(fused),
    'tree digest serialization allowed two different trees to share one digest');
  assert.notStrictEqual(managedRuntimeDigest(split), managedRuntimeDigest(fused),
    'managed runtime digest serialization allowed two different trees to share one digest');
}

async function testRecoveryOriginsAndJournalValidation(root) {
  const existing = path.join(root, 'preexisting-journal-parent');
  fs.mkdirSync(path.join(existing, '.transactions', 'dev-rigor-stack', 'journals'), { recursive: true });
  const existingExpected = snapshot(existing);
  invoke(['recover-only', '--codex-home', existing]);
  assert.deepStrictEqual(snapshot(existing), existingExpected, 'recover-only removed pre-existing journal scaffolding');

  const committed = path.join(root, 'committed-origin-crash');
  invoke(installArgs(committed, ['--no-backup']));
  invoke(uninstallArgs(committed), { DEV_RIGOR_TXN_CRASH_AT: 'uninstall:before-origin-cleanup' }, 86);
  invoke(['recover-only', '--codex-home', committed]);
  assert.deepStrictEqual(snapshot(committed), {}, 'committed uninstall recovery stranded owned origin scaffolding');

  const lockCleanup = path.join(root, 'lock-cleanup-crash');
  invoke(['recover-only', '--codex-home', lockCleanup],
    { DEV_RIGOR_TXN_CRASH_AT: 'transaction:after-lock-removal' }, 86);
  assert.ok(fs.existsSync(path.join(lockCleanup, '.dev-rigor-stack-transaction-release-v1', 'owner.json')),
    'lock removal exposed an unowned cleanup window instead of a durable release intent');
  invoke(['recover-only', '--codex-home', lockCleanup]);
  assert.deepStrictEqual(snapshot(lockCleanup), {}, 'lock-cleanup recovery lost its scaffold origin intent');

  const homeTombstone = path.join(root, 'home-tombstone-cleanup');
  const tombstonePath = `${homeTombstone}.dev-rigor-stack-transaction-release-v1`;
  invoke(['recover-only', '--codex-home', homeTombstone],
    { DEV_RIGOR_TXN_CRASH_AT: 'transaction:after-home-tombstone' }, 86);
  assert.ok(!fs.existsSync(homeTombstone) && fs.existsSync(tombstonePath),
    'home cleanup did not atomically retain its durable release intent in the tombstone');
  invoke(['recover-only', '--codex-home', homeTombstone]);
  assert.ok(!fs.existsSync(homeTombstone) && !fs.existsSync(tombstonePath),
    'next invocation did not finish exact tombstone cleanup');

  const strict = path.join(root, 'strict-journal-shape');
  invoke(installArgs(strict, ['--no-backup']));
  invoke(installArgs(strict, ['--no-backup']), { DEV_RIGOR_TXN_CRASH_AT: 'install:after-runtime' }, 86);
  const journals = path.join(strict, '.transactions', 'dev-rigor-stack', 'journals');
  const transaction = fs.readdirSync(journals)[0];
  const snapshots = fs.readdirSync(path.join(journals, transaction)).sort();
  const latest = path.join(journals, transaction, snapshots[snapshots.length - 1]);
  const journal = JSON.parse(fs.readFileSync(latest, 'utf8'));
  journal.sequence = 'not-an-integer';
  journal.baselineScaffolds = {};
  fs.writeFileSync(latest, `${JSON.stringify(journal, null, 2)}\n`);
  const refused = invoke(['recover-only', '--codex-home', strict], {}, 1);
  assert.match(`${refused.stdout}\n${refused.stderr}`, /JOURNAL/i, 'damaged journal was not rejected as journal corruption');

  const applying = path.join(root, 'incomplete-applying-journal');
  invoke(installArgs(applying, ['--no-backup']));
  invoke(installArgs(applying, ['--no-backup']), { DEV_RIGOR_TXN_CRASH_AT: 'install:after-runtime' }, 86);
  const applyingJournals = path.join(applying, '.transactions', 'dev-rigor-stack', 'journals');
  const applyingTransaction = fs.readdirSync(applyingJournals)[0];
  const applyingSnapshots = fs.readdirSync(path.join(applyingJournals, applyingTransaction)).sort();
  const applyingLatest = path.join(applyingJournals, applyingTransaction,
    applyingSnapshots[applyingSnapshots.length - 1]);
  const incomplete = JSON.parse(fs.readFileSync(applyingLatest, 'utf8'));
  assert.strictEqual(incomplete.phase, 'APPLYING', 'crash fixture did not retain an APPLYING journal');
  delete incomplete.preparedDigests.skills[SKILLS[0]];
  fs.writeFileSync(applyingLatest, `${JSON.stringify(incomplete, null, 2)}\n`);
  const incompleteRefusal = invoke(['recover-only', '--codex-home', applying], {}, 1);
  assert.match(`${incompleteRefusal.stdout}\n${incompleteRefusal.stderr}`,
    /JOURNAL.*complete managed-tree digests/i,
    'structurally incomplete APPLYING journal was not rejected before recovery');
}

async function testBackupCrashAndMalformedMarker(root) {
  const moved = path.join(root, 'backup-move-crash');
  invoke(installArgs(moved, ['--no-backup']));
  invoke(installArgs(moved));
  const expected = snapshot(moved);
  invoke(uninstallArgs(moved), { DEV_RIGOR_TXN_CRASH_AT: 'uninstall:after-backup-move' }, 86);
  invoke(['recover-only', '--codex-home', moved]);
  assert.deepStrictEqual(snapshot(moved), expected, 'backup move crash lost or changed an owned backup');
  assertTransactionClean(moved);

  const tamperedRollback = path.join(root, 'tampered-rollback-backup');
  invoke(installArgs(tamperedRollback, ['--no-backup']));
  invoke(installArgs(tamperedRollback));
  const tamperedOwnership = JSON.parse(fs.readFileSync(
    path.join(tamperedRollback, 'dev-rigor-stack', 'install-ownership-v2.json'), 'utf8'));
  const tamperedEntry = tamperedOwnership.backups[0];
  invoke(uninstallArgs(tamperedRollback), { DEV_RIGOR_TXN_CRASH_AT: 'uninstall:after-backup-move' }, 86);
  const rollbackRoot = path.join(tamperedRollback, '.rollback', 'dev-rigor-stack');
  const rollbackId = fs.readdirSync(rollbackRoot)[0];
  const savedBackup = path.join(rollbackRoot, rollbackId, 'backups', 'skills', tamperedEntry.id);
  fs.writeFileSync(path.join(savedBackup, 'tampered-after-crash.bin'), Buffer.from([1, 3, 3, 7]));
  const tamperedRecovery = invoke(['recover-only', '--codex-home', tamperedRollback], {}, 1);
  assert.match(`${tamperedRecovery.stdout}\n${tamperedRecovery.stderr}`, /CONFLICT.*saved backup changed/i,
    'tampered rollback backup was accepted for an incidental reason');
  assert.ok(fs.existsSync(savedBackup), 'tampered rollback evidence was destructively removed');

  const malformed = path.join(root, 'malformed-backup-marker');
  invoke(installArgs(malformed, ['--no-backup']));
  invoke(installArgs(malformed));
  const ownership = JSON.parse(fs.readFileSync(
    path.join(malformed, 'dev-rigor-stack', 'install-ownership-v2.json'), 'utf8'));
  const backup = ownership.backups[0];
  const backupPath = path.join(malformed, '.backup', 'codex-dev-rigor-stack', backup.id);
  fs.writeFileSync(path.join(backupPath, '.dev-rigor-backup-owner-v1.json'), '{broken\n');
  const result = invoke(uninstallArgs(malformed));
  const parsed = JSON.parse(result.stdout);
  assert.ok(parsed.warnings.some((warning) => /preserved/.test(warning)),
    'malformed marker preservation was not visible');
  assert.ok(fs.existsSync(backupPath), 'malformed marker backup was deleted');
  assertTransactionClean(malformed);
}

function installFakeOutcomeRevoker(home) {
  const runtime = path.join(home, 'dev-rigor-stack');
  const revoker = path.join(runtime, 'hooks', 'revoke-trust.js');
  fs.writeFileSync(revoker, `#!/usr/bin/env node
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const home = path.resolve(process.argv[2]);
const outcomeIndex = process.argv.indexOf('--outcome-file');
const outcome = process.argv[outcomeIndex + 1];
const config = path.join(home, 'config.toml');
let text = fs.existsSync(config) ? fs.readFileSync(config, 'utf8') : '';
if (!text.includes('# fake-revoked')) fs.writeFileSync(config, text + '\\n# fake-revoked\\n');
const after = { exists: fs.existsSync(config), hash: crypto.createHash('sha256').update(fs.readFileSync(config)).digest('hex') };
const comparable = process.platform === 'win32' ? home.toLowerCase() : home;
const record = {
  schema: 'dev-rigor-trust-revocation-outcome-v1',
  codexHomeIdentity: crypto.createHash('sha256').update(comparable, 'utf8').digest('hex'),
  after,
  ownedKeys: Array.from({ length: 7 }, (_, index) => 'owned-' + index),
  version: 'fake-v1',
};
fs.mkdirSync(path.dirname(outcome), { recursive: true });
fs.writeFileSync(outcome, JSON.stringify(record) + '\\n');
`);
  const ownershipPath = path.join(runtime, 'install-ownership-v2.json');
  const ownership = JSON.parse(fs.readFileSync(ownershipPath, 'utf8'));
  ownership.installed.runtime = managedRuntimeDigest(runtime);
  fs.writeFileSync(ownershipPath, `${JSON.stringify(ownership, null, 2)}\n`);
}

async function testTrustCrashRecovery(root) {
  const childGap = path.join(root, 'trust-child-gap');
  invoke(installArgs(childGap, ['--no-backup']));
  fs.writeFileSync(path.join(childGap, 'config.toml'), '[foreign]\nkeep = true\n');
  installFakeOutcomeRevoker(childGap);
  const childExpected = snapshot(childGap);
  invoke(['uninstall', '--codex-home', childGap],
    { DEV_RIGOR_TXN_CRASH_AT: 'uninstall:after-trust-child' }, 86);
  invoke(['recover-only', '--codex-home', childGap]);
  assert.deepStrictEqual(snapshot(childGap), childExpected,
    'crash after trust child return did not restore exact config and installation bytes');
  assertTransactionClean(childGap);

  const retry = path.join(root, 'trust-rollback-retry');
  invoke(installArgs(retry, ['--no-backup']));
  fs.writeFileSync(path.join(retry, 'config.toml'), '[foreign]\nkeep = true\n');
  installFakeOutcomeRevoker(retry);
  const retryExpected = snapshot(retry);
  invoke(['uninstall', '--codex-home', retry], {
    DEV_RIGOR_UNINSTALL_TEST_FAIL_AT: 'mid-remove',
    DEV_RIGOR_TXN_CRASH_AT: 'uninstall:after-trust-restore',
  }, 86);
  invoke(['recover-only', '--codex-home', retry]);
  assert.deepStrictEqual(snapshot(retry), retryExpected,
    'retry after a completed trust restore was not idempotent');
  assertTransactionClean(retry);
}

function sentinelHelper(marker) {
  return `#!/usr/bin/env node\nrequire('fs').writeFileSync(${JSON.stringify(marker)}, 'EXECUTED\\n');\nprocess.exit(1);\n`;
}

function markerWireHelper(realWire, marker) {
  return `#!/usr/bin/env node
'use strict';
const fs = require('fs');
const { spawnSync } = require('child_process');
fs.writeFileSync(${JSON.stringify(marker)}, 'EXECUTED\\n');
const result = spawnSync(process.execPath, [${JSON.stringify(realWire)}, ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(Number.isInteger(result.status) ? result.status : 1);
`;
}

async function testPinnedHelperRaces(root) {
  const stagedHome = path.join(root, 'pinned-stage-wire-race');
  invoke(installArgs(stagedHome, ['--no-backup']));
  const stagedMarker = path.join(root, 'pinned-stage-wire-executed.txt');
  const stagedControl = path.join(root, 'pinned-stage-wire-control');
  const stagedChild = spawnPaused(uninstallArgs(stagedHome), stagedControl, 'uninstall:before-wire-helper');
  await waitFor(path.join(stagedControl, 'uninstall_before-wire-helper.ready'), stagedChild);
  const stagedRoot = path.join(stagedHome, '.staging', 'dev-rigor-stack');
  const stagedTransaction = fs.readdirSync(stagedRoot)[0];
  fs.writeFileSync(path.join(stagedRoot, stagedTransaction, 'verified-tools', 'wire-hooks.js'),
    sentinelHelper(stagedMarker));
  fs.writeFileSync(path.join(stagedControl, 'uninstall_before-wire-helper.continue'), 'continue\n');
  const stagedExit = await waitForExit(stagedChild);
  assert.notStrictEqual(stagedExit.code, 0, 'uninstall accepted tampered pinned wire-helper bytes');
  assert.ok(!fs.existsSync(stagedMarker), 'tampered pinned wire helper executed arbitrary code');
  assertTransactionClean(stagedHome);

  const wireHome = path.join(root, 'pinned-wire-race');
  invoke(installArgs(wireHome, ['--no-backup']));
  const wireMarker = path.join(root, 'live-wire-executed.txt');
  const wireControl = path.join(root, 'pinned-wire-control');
  const wireChild = spawnPaused(uninstallArgs(wireHome), wireControl, 'uninstall:before-wire-helper');
  await waitFor(path.join(wireControl, 'uninstall_before-wire-helper.ready'), wireChild);
  fs.writeFileSync(path.join(wireHome, 'dev-rigor-stack', 'hooks', 'wire-hooks.js'), sentinelHelper(wireMarker));
  fs.writeFileSync(path.join(wireControl, 'uninstall_before-wire-helper.continue'), 'continue\n');
  const wireExit = await waitForExit(wireChild);
  assert.notStrictEqual(wireExit.code, 0, 'uninstall accepted a live wire-helper replacement after pinning');
  assert.ok(!fs.existsSync(wireMarker), 'replaced live wire helper executed arbitrary code');
  assertTransactionClean(wireHome);

  const runtimeHome = path.join(root, 'pinned-runtime-race');
  invoke(installArgs(runtimeHome, ['--no-backup']));
  const runtime = path.join(runtimeHome, 'dev-rigor-stack');
  const runtimeWire = path.join(runtime, 'hooks', 'wire-hooks.js');
  const realWire = path.join(runtime, 'hooks', 'wire-hooks.real.js');
  const runtimeMarker = path.join(root, 'runtime-mutated-wire-executed.txt');
  fs.copyFileSync(runtimeWire, realWire);
  fs.writeFileSync(runtimeWire, markerWireHelper(realWire, runtimeMarker));
  const runtimeOwnershipPath = path.join(runtime, 'install-ownership-v2.json');
  const runtimeOwnership = JSON.parse(fs.readFileSync(runtimeOwnershipPath, 'utf8'));
  runtimeOwnership.installed.runtime = managedRuntimeDigest(runtime);
  fs.writeFileSync(runtimeOwnershipPath, `${JSON.stringify(runtimeOwnership, null, 2)}\n`);
  const runtimeControl = path.join(root, 'pinned-runtime-control');
  const runtimeChild = spawnPaused(uninstallArgs(runtimeHome), runtimeControl, 'uninstall:before-wire-helper');
  await waitFor(path.join(runtimeControl, 'uninstall_before-wire-helper.ready'), runtimeChild);
  fs.appendFileSync(path.join(runtime, 'hooks', 'revoke-trust.js'), '\n// concurrent runtime mutation\n');
  fs.writeFileSync(path.join(runtimeControl, 'uninstall_before-wire-helper.continue'), 'continue\n');
  const runtimeExit = await waitForExit(runtimeChild);
  assert.notStrictEqual(runtimeExit.code, 0, 'uninstall accepted a full-runtime change after helper pinning');
  assert.ok(!fs.existsSync(runtimeMarker), 'runtime-changed pinned wire helper executed before CAS refusal');
  assertTransactionClean(runtimeHome);

  const revokerHome = path.join(root, 'pinned-revoker-race');
  invoke(installArgs(revokerHome, ['--no-backup']));
  fs.writeFileSync(path.join(revokerHome, 'config.toml'), '[foreign]\nkeep = true\n');
  installFakeOutcomeRevoker(revokerHome);
  const revokerMarker = path.join(root, 'live-revoker-executed.txt');
  const revokerControl = path.join(root, 'pinned-revoker-control');
  const revokerChild = spawnPaused(['uninstall', '--codex-home', revokerHome], revokerControl, 'uninstall:prepared');
  await waitFor(path.join(revokerControl, 'uninstall_prepared.ready'), revokerChild);
  fs.writeFileSync(path.join(revokerHome, 'dev-rigor-stack', 'hooks', 'revoke-trust.js'), sentinelHelper(revokerMarker));
  fs.writeFileSync(path.join(revokerControl, 'uninstall_prepared.continue'), 'continue\n');
  const revokerExit = await waitForExit(revokerChild);
  assert.notStrictEqual(revokerExit.code, 0, 'uninstall accepted a live revoker replacement after pinning');
  assert.ok(!fs.existsSync(revokerMarker), 'replaced live revoker executed arbitrary code');
  assertTransactionClean(revokerHome);

  const recoveryHome = path.join(root, 'pinned-recovery-race');
  invoke(installArgs(recoveryHome, ['--no-backup']));
  fs.writeFileSync(path.join(recoveryHome, 'config.toml'), '[foreign]\nkeep = true\n');
  installFakeOutcomeRevoker(recoveryHome);
  invoke(['uninstall', '--codex-home', recoveryHome],
    { DEV_RIGOR_TXN_CRASH_AT: 'uninstall:after-trust-child' }, 86);
  const journalRoot = path.join(recoveryHome, '.transactions', 'dev-rigor-stack', 'journals');
  const transaction = fs.readdirSync(journalRoot)[0];
  const outcome = path.join(recoveryHome, '.rollback', 'dev-rigor-stack', transaction, 'trust-outcome.json');
  fs.unlinkSync(outcome);
  const recoveryMarker = path.join(root, 'redirected-recovery-revoker-executed.txt');
  const redirectedRevoker = path.join(root, 'redirected-revoke-trust.js');
  fs.writeFileSync(redirectedRevoker, sentinelHelper(recoveryMarker));
  const snapshots = fs.readdirSync(path.join(journalRoot, transaction)).sort();
  const latest = path.join(journalRoot, transaction, snapshots[snapshots.length - 1]);
  const journal = JSON.parse(fs.readFileSync(latest, 'utf8'));
  journal.verifiedTools.revoker = { path: redirectedRevoker, hash: fileHash(redirectedRevoker) };
  fs.writeFileSync(latest, `${JSON.stringify(journal, null, 2)}\n`);
  const recovery = invoke(['recover-only', '--codex-home', recoveryHome], {}, 1);
  assert.ok(!fs.existsSync(recoveryMarker), 'recovery executed a journal-redirected revoker');
  assert.match(`${recovery.stdout}\n${recovery.stderr}`, /JOURNAL.*path-unbound/i,
    'redirected recovery helper failed for an incidental reason');
}

async function testAtomicTrustRestore(root) {
  const crashHome = path.join(root, 'atomic-trust-crash');
  invoke(installArgs(crashHome, ['--no-backup']));
  fs.writeFileSync(path.join(crashHome, 'config.toml'), '[foreign]\nkeep = true\n');
  installFakeOutcomeRevoker(crashHome);
  const expected = snapshot(crashHome);
  invoke(['uninstall', '--codex-home', crashHome], {
    DEV_RIGOR_UNINSTALL_TEST_FAIL_AT: 'mid-remove',
    DEV_RIGOR_TXN_CRASH_AT: 'uninstall:after-trust-displacement',
  }, 86);
  assert.ok(!fs.existsSync(path.join(crashHome, 'config.toml')),
    'crash injection did not occur in the atomic displacement window');
  invoke(['recover-only', '--codex-home', crashHome]);
  assert.deepStrictEqual(snapshot(crashHome), expected,
    'recovery did not reconcile the durable trust candidate and displaced file exactly');
  assertTransactionClean(crashHome);

  const beforeRace = path.join(root, 'atomic-trust-before-race');
  invoke(installArgs(beforeRace, ['--no-backup']));
  fs.writeFileSync(path.join(beforeRace, 'config.toml'), '[foreign]\nkeep = true\n');
  installFakeOutcomeRevoker(beforeRace);
  const beforeControl = path.join(root, 'atomic-trust-before-control');
  const beforeChild = spawnPaused(['uninstall', '--codex-home', beforeRace], beforeControl,
    'uninstall:before-trust-displacement', { DEV_RIGOR_UNINSTALL_TEST_FAIL_AT: 'mid-remove' });
  await waitFor(path.join(beforeControl, 'uninstall_before-trust-displacement.ready'), beforeChild);
  const concurrentBefore = '[foreign]\nconcurrent = "before-displacement"\n';
  fs.writeFileSync(path.join(beforeRace, 'config.toml'), concurrentBefore);
  fs.writeFileSync(path.join(beforeControl, 'uninstall_before-trust-displacement.continue'), 'continue\n');
  const beforeExit = await waitForExit(beforeChild);
  assert.notStrictEqual(beforeExit.code, 0, 'trust rollback overwrote a write at the pre-displacement CAS boundary');
  assert.ok(fs.existsSync(path.join(beforeRace, 'config.toml')),
    'pre-displacement concurrent config was displaced from its active path');
  assert.strictEqual(fs.readFileSync(path.join(beforeRace, 'config.toml'), 'utf8'), concurrentBefore,
    'pre-displacement concurrent config bytes were lost');

  const afterRace = path.join(root, 'atomic-trust-after-race');
  invoke(installArgs(afterRace, ['--no-backup']));
  fs.writeFileSync(path.join(afterRace, 'config.toml'), '[foreign]\nkeep = true\n');
  installFakeOutcomeRevoker(afterRace);
  const afterControl = path.join(root, 'atomic-trust-after-control');
  const afterChild = spawnPaused(['uninstall', '--codex-home', afterRace], afterControl,
    'uninstall:after-trust-displacement', { DEV_RIGOR_UNINSTALL_TEST_FAIL_AT: 'mid-remove' });
  await waitFor(path.join(afterControl, 'uninstall_after-trust-displacement.ready'), afterChild);
  const concurrentAfter = '[foreign]\nconcurrent = "after-displacement"\n';
  fs.writeFileSync(path.join(afterRace, 'config.toml'), concurrentAfter);
  fs.writeFileSync(path.join(afterControl, 'uninstall_after-trust-displacement.continue'), 'continue\n');
  const afterExit = await waitForExit(afterChild);
  assert.notStrictEqual(afterExit.code, 0, 'trust rollback overwrote a file recreated after displacement');
  assert.strictEqual(fs.readFileSync(path.join(afterRace, 'config.toml'), 'utf8'), concurrentAfter,
    'post-displacement concurrent config bytes were lost');
}

async function testLockInitializationRace(root) {
  const home = path.join(root, 'lock-initialization-race');
  const control = path.join(root, 'lock-initialization-control');
  const owner = spawnPaused(['recover-only', '--codex-home', home], control, 'transaction:after-lock-directory');
  await waitFor(path.join(control, 'transaction_after-lock-directory.ready'), owner);
  const contender = invoke(['recover-only', '--codex-home', home], {}, 1);
  assert.match(`${contender.stdout}\n${contender.stderr}`, /LOCKED/i,
    'contender did not visibly refuse an ownerless lock still being initialized');
  fs.writeFileSync(path.join(control, 'transaction_after-lock-directory.continue'), 'continue\n');
  const ownerExit = await waitForExit(owner);
  assert.strictEqual(ownerExit.code, 0, 'original lock creator lost ownership during initialization');
  assert.deepStrictEqual(snapshot(home), {}, 'lock initialization race left profile scaffolding');
}

async function testHooksCasAndCrashRecovery(root) {
  const casHome = path.join(root, 'cas');
  fs.mkdirSync(casHome, { recursive: true });
  const hooksPath = path.join(casHome, 'hooks.json');
  fs.writeFileSync(hooksPath, '{"hooks":{},"before":true}\n');
  const control = path.join(root, 'cas-control');
  const child = spawnPaused(installArgs(casHome, ['--no-backup']), control, 'install:before-hooks-cas');
  await waitFor(path.join(control, 'install_before-hooks-cas.ready'), child);
  const locked = invoke(installArgs(casHome, ['--no-backup']), {}, 1);
  assert.match(`${locked.stdout}\n${locked.stderr}`, /lock/i, 'concurrent transaction did not visibly refuse the live lock');
  fs.writeFileSync(hooksPath, '{"hooks":{},"before":true,"concurrent":true}\n');
  fs.writeFileSync(path.join(control, 'install_before-hooks-cas.continue'), 'continue\n');
  const casExit = await waitForExit(child);
  assert.notStrictEqual(casExit.code, 0, 'CAS mismatch was accepted');
  assert.strictEqual(JSON.parse(fs.readFileSync(hooksPath, 'utf8')).concurrent, true);
  assertNoOwnedInstall(casHome);
  assertTransactionClean(casHome);

  const crashHome = path.join(root, 'crash');
  const crashControl = path.join(root, 'crash-control');
  const crashing = spawnPaused(installArgs(crashHome, ['--no-backup']), crashControl, 'install:after-runtime');
  await waitFor(path.join(crashControl, 'install_after-runtime.ready'), crashing);
  crashing.kill('SIGKILL');
  await waitForExit(crashing);
  const staleClaim = path.join(crashHome, '.transactions', 'dev-rigor-stack', 'lock', 'recovery-claim');
  fs.mkdirSync(staleClaim);
  fs.writeFileSync(path.join(staleClaim, 'owner.json'), '{"pid":2147483646}\n');
  invoke(['recover-only', '--codex-home', crashHome]);
  assertNoOwnedInstall(crashHome);
  assertTransactionClean(crashHome);
}

async function main() {
  assert.ok(fs.existsSync(COORDINATOR), 'install transaction coordinator is missing');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-rigor-install-transaction-'));
  try {
    const groups = [
      ['ownership-foreign', testHappyOwnershipAndForeignPreservation],
      ['backups-v4', testBackupsStateAndOriginCleanup],
      ['uninstall-crash', testUninstallCrashRecovery],
      ['caught-failures', testCaughtFailuresAndMissingHooks],
      ['journal-binding', testJournalCannotRedirectOwnedDeletion],
      ['hooks-cas-lock', testHooksCasAndCrashRecovery],
      ['prepare-state-races', testPreparationAndStateRaces],
      ['install-source-freeze', testInstallSourceFreeze],
      ['ownership-path-refusals', testOwnershipAndPathRefusals],
      ['recovery-origin-journal', testRecoveryOriginsAndJournalValidation],
      ['backup-crash-marker', testBackupCrashAndMalformedMarker],
      ['trust-crash-recovery', testTrustCrashRecovery],
      ['pinned-helper-races', testPinnedHelperRaces],
      ['atomic-trust-restore', testAtomicTrustRestore],
      ['lock-initialization-race', testLockInitializationRace],
      ['genesis-state-contract', testGenesisStateContract],
      ['legacy-v4-migration', testLegacyCurrentV4Migration],
      ['canonical-alias-recovery', testCanonicalAliasRecovery],
      ['digest-framing', testDigestFraming],
    ];
    const filter = String(process.env.DEV_RIGOR_INSTALL_TEST_FILTER || '').trim();
    const selected = filter ? groups.filter(([label]) => label.includes(filter)) : groups;
    assert.ok(selected.length, `no install transaction test group matched: ${filter}`);
    for (const [label, test] of selected) {
      await test(root);
      process.stdout.write(`  ok ${label}\n`);
    }
    process.stdout.write('install transaction coordinator: ownership, CAS, and crash recovery PASS\n');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
