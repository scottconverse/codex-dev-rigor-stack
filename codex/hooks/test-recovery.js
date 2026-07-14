#!/usr/bin/env node
'use strict';

// Hermetic black-box contracts for exact-task owner-directed state recovery.

const assert = require('assert');
const { execFileSync, spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOOKS = __dirname;
const ACTIVATE = path.join(HOOKS, 'dev-rigor-activate.js');
const ROUTER = path.join(HOOKS, 'dev-rigor-router.js');
const tests = [];

function hash(value) {
  return crypto.createHash('sha256').update(String(value)).update('\0').digest('hex');
}

function taskKey(session) { return hash(session); }
function stateDir(home) { return path.join(home, 'dev-rigor-stack', 'state'); }
function taskPath(home, session) { return path.join(stateDir(home), `task-v4-${taskKey(session)}.json`); }
function genesisPath(home, session) { return path.join(stateDir(home), `task-genesis-v4-${taskKey(session)}.json`); }
function edgePath(home, parent, child) {
  return path.join(stateDir(home), 'associations-v4', taskKey(parent), `${taskKey(child)}.json`);
}
function markerPath(home, parentKey, childKey, code) {
  return path.join(stateDir(home), 'association-debt-v4', parentKey,
    `${childKey}-${hash(code).slice(0, 16)}.json`);
}
function resolutionDir(home, markerParentKey) {
  return path.join(stateDir(home), 'association-resolutions-v4', markerParentKey);
}
function mechanicalPath(home, session) {
  return path.join(stateDir(home), `mechanical-v4-${taskKey(session)}.log`);
}

function defaultTask(overrides = {}) {
  return {
    version: 4,
    mode: 'ON',
    salt: crypto.randomBytes(32).toString('hex'),
    dirtyEdits: [], proofs: [], unresolved: [], warnings: {}, notices: [], mechanical: [], children: [],
    checkpoint: 0, blockCount: 0,
    delivery: { preToolUse: 0, postToolUse: 0, stop: 0 },
    ...overrides,
  };
}

function freshHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-rigor-recovery-'));
  fs.mkdirSync(stateDir(home), { recursive: true });
  return home;
}

function writeTask(home, session, overrides = {}) {
  fs.mkdirSync(stateDir(home), { recursive: true });
  const task = defaultTask({ ...overrides, taskKey: taskKey(session) });
  fs.writeFileSync(taskPath(home, session), JSON.stringify(task) + '\n');
  fs.writeFileSync(genesisPath(home, session), JSON.stringify({
    version: 4, taskKey: taskKey(session), saltCommitment: hash(task.salt),
  }) + '\n');
}

function readTask(home, session) {
  return JSON.parse(fs.readFileSync(taskPath(home, session), 'utf8'));
}

function writeEdge(home, parent, child) {
  const target = edgePath(home, parent, child);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify({
    version: 4, parentKey: taskKey(parent), childKey: taskKey(child),
  }) + '\n');
}

function writeMarker(home, parentKey, childKey, code, overrides = {}) {
  const id = hash(`${parentKey}\0${childKey}\0${code}`).slice(0, 16);
  const target = markerPath(home, parentKey, childKey, code);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify({
    version: 4, id, parentKey, childKey, code, status: 'unresolved', ...overrides,
  }) + '\n');
  return { id, target };
}

function run(script, args, payload, home) {
  return execFileSync(process.execPath, [script, ...args], {
    env: { ...process.env, CODEX_HOME: home },
    input: JSON.stringify(payload), encoding: 'utf8', windowsHide: true,
  }).trim();
}

function activate(home, session, parent = '') {
  return run(ACTIVATE, parent ? ['subagent'] : [], {
    session_id: session,
    ...(parent ? { parent_session_id: parent } : {}),
    hook_event_name: parent ? 'SubagentStart' : 'SessionStart',
  }, home);
}

function activateUnbound(home, session) {
  return run(ACTIVATE, ['subagent'], {
    session_id: session, hook_event_name: 'SubagentStart',
  }, home);
}

function control(home, session, prompt) {
  return run(ROUTER, [], { session_id: session, turn_id: `turn-${prompt}`, prompt }, home);
}

function controlAsync(home, session, prompt) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [ROUTER], {
      env: { ...process.env, CODEX_HOME: home },
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve(stdout.trim())
      : reject(new Error(`router exited ${code}: ${stderr}`)));
    child.stdin.end(JSON.stringify({ session_id: session, turn_id: `turn-${prompt}`, prompt }));
  });
}

function context(output) {
  assert.ok(output, 'control produced no user-visible output');
  return JSON.parse(output).hookSpecificOutput.additionalContext;
}

function status(home, session) { return context(control(home, session, 'DevRigorSTATUS')); }
function repair(home, session) { return context(control(home, session, 'DevRigorREPAIR')); }
function test(name, fn) { tests.push({ name, fn }); }

test('REPAIR: known router debt is resolved by one correlated task transaction and retry is idempotent', () => {
  const home = freshHome();
  try {
    activate(home, 'repair-mechanical');
    const key = taskKey('repair-mechanical');
    const lock = path.join(stateDir(home), `task-lock-v4-${key}`);
    fs.mkdirSync(lock);
    fs.writeFileSync(path.join(lock, 'owner'), 'held-by-test');
    const failed = context(control(home, 'repair-mechanical', 'DevRigorWARN'));
    assert.match(failed, /mechanical debt .*release-blocking/i);
    fs.rmSync(lock, { recursive: true, force: true });
    const markerLine = fs.readFileSync(mechanicalPath(home, 'repair-mechanical'), 'utf8')
      .split('\n').find((line) => line.startsWith('M '));
    const markerId = markerLine.split(/\s+/)[1];
    fs.appendFileSync(mechanicalPath(home, 'repair-mechanical'), `C ${markerId}\n`);
    const before = status(home, 'repair-mechanical');
    assert.match(before, /mechanical debt:\s*yes\s*\(1\)/i,
      'an uncorrelated legacy C record cleared known router debt');

    const first = repair(home, 'repair-mechanical');
    assert.match(first, /repair transaction:\s*completed/i);
    assert.match(first, /mode:\s*WARN/i, 'repair did not apply the failed owner control outcome');
    assert.match(first, /mechanical resolved:\s*1/i);
    assert.match(status(home, 'repair-mechanical'), /mechanical debt:\s*no/i);
    assert.match(status(home, 'repair-mechanical'), /mechanical resolutions:\s*1\b/i);

    const linesAfterFirst = fs.readFileSync(mechanicalPath(home, 'repair-mechanical'), 'utf8')
      .split('\n').filter((line) => line.startsWith('C '));
    const second = repair(home, 'repair-mechanical');
    assert.match(second, /repair transaction:\s*no eligible records/i);
    assert.match(second, /mechanical resolved:\s*0/i);
    const linesAfterSecond = fs.readFileSync(mechanicalPath(home, 'repair-mechanical'), 'utf8')
      .split('\n').filter((line) => line.startsWith('C '));
    assert.deepStrictEqual(linesAfterSecond, linesAfterFirst, 'retry appended a duplicate resolution');
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('REPAIR: unknown taskless mechanical markers remain exact-task visible and never leak or clear', () => {
  const home = freshHome();
  try {
    activate(home, 'ambiguous-a');
    activate(home, 'ambiguous-b');
    fs.writeFileSync(mechanicalPath(home, 'ambiguous-a'), 'M unknown-a reason:unclassified-taskless-failure\n');
    fs.writeFileSync(mechanicalPath(home, 'ambiguous-b'), 'M unknown-b reason:unclassified-taskless-failure\n');

    const output = repair(home, 'ambiguous-a');
    assert.match(output, /mechanical unresolved:\s*1/i);
    assert.match(output, /unknown-a/);
    assert.doesNotMatch(output, /unknown-b/);
    assert.match(status(home, 'ambiguous-a'), /mechanical debt:\s*yes\s*\(1\).*unknown-a/i);
    assert.match(status(home, 'ambiguous-b'), /mechanical debt:\s*yes\s*\(1\).*unknown-b/i);
    assert.doesNotMatch(fs.readFileSync(mechanicalPath(home, 'ambiguous-a'), 'utf8'), /^C /m);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('REPAIR: later parent binding needs an append-only attestation and only the exact child can create it', () => {
  const home = freshHome();
  try {
    activateUnbound(home, 'unbound-child');
    activate(home, 'bound-parent');
    activate(home, 'unbound-child', 'bound-parent');
    const markerDirectory = path.join(stateDir(home), 'association-debt-v4', taskKey('unbound-child'));
    const markerNames = fs.readdirSync(markerDirectory).filter((name) =>
      name.startsWith(`${taskKey('unbound-child')}-${hash('parent-unavailable').slice(0, 16)}-`));
    assert.strictEqual(markerNames.length, 1, 'expected one occurrence-scoped historical marker');
    const expectedMarker = path.join(markerDirectory, markerNames[0]);
    assert.ok(fs.existsSync(expectedMarker), `historical marker missing: ${expectedMarker}`);
    const beforeRepair = status(home, 'unbound-child');
    assert.match(beforeRepair, /association debt:\s*yes\s*\(1\).*parent-unavailable/i,
      `STATUS silently treated the historical marker as resolved:\n${beforeRepair}\nmarker=${fs.readFileSync(expectedMarker, 'utf8')}`);

    const parentRepair = repair(home, 'bound-parent');
    assert.match(parentRepair, /association resolved:\s*0/i);
    assert.match(status(home, 'unbound-child'), /association debt:\s*yes/i,
      'repair on a different task cleared child-owned debt');

    const childRepair = repair(home, 'unbound-child');
    assert.match(childRepair, /association resolved:\s*1/i);
    assert.match(status(home, 'unbound-child'), /association debt:\s*no/i);
    assert.match(status(home, 'unbound-child'), /association resolutions:\s*1\b/i);

    const directory = resolutionDir(home, taskKey('unbound-child'));
    const firstFiles = fs.readdirSync(directory);
    assert.strictEqual(firstFiles.length, 1);
    const record = JSON.parse(fs.readFileSync(path.join(directory, firstFiles[0]), 'utf8'));
    assert.strictEqual(record.repairTaskKey, taskKey('unbound-child'));
    assert.strictEqual(record.authoritativeParentKey, taskKey('bound-parent'));
    repair(home, 'unbound-child');
    assert.deepStrictEqual(fs.readdirSync(directory), firstFiles, 'retry rewrote or duplicated immutable attestation');
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('REPAIR: a parent may attest its own repaired child marker only when all three invariants already hold', () => {
  const home = freshHome();
  try {
    activate(home, 'parent');
    activate(home, 'child', 'parent');
    const parentKey = taskKey('parent');
    const childKey = taskKey('child');
    const marker = writeMarker(home, parentKey, childKey, 'association-parent-state-failed');
    assert.match(status(home, 'parent'), new RegExp(`association debt:\\s*yes.*${marker.id}`, 'i'));
    assert.match(repair(home, 'parent'), /association resolved:\s*1/i);
    assert.match(status(home, 'parent'), /association debt:\s*no/i);

    // Breaking the parent projection after attestation invalidates the resolution again.
    const parent = readTask(home, 'parent');
    parent.children = [];
    writeTask(home, 'parent', parent);
    const broken = status(home, 'parent');
    assert.match(broken, /association debt:\s*yes/i);
    assert.match(broken, /resolution-invariant-mismatch|association-parent-state-failed/i);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('REPAIR: conflict and corrupt markers remain debt and parentage is never inferred or changed', () => {
  const home = freshHome();
  try {
    activate(home, 'real-parent');
    activate(home, 'attempted-parent');
    activate(home, 'conflicted-child', 'real-parent');
    const beforeParent = readTask(home, 'conflicted-child').parentKey;
    activate(home, 'conflicted-child', 'attempted-parent');
    const conflict = repair(home, 'attempted-parent');
    assert.match(conflict, /association unresolved:\s*[1-9]\d*/i);
    assert.strictEqual(readTask(home, 'conflicted-child').parentKey, beforeParent,
      'repair changed authoritative child parentage');
    assert.match(status(home, 'attempted-parent'), /association debt:\s*yes.*association-parent-conflict/i);

    const corruptDir = path.join(stateDir(home), 'association-debt-v4', taskKey('attempted-parent'));
    fs.writeFileSync(path.join(corruptDir, 'corrupt.json'), '{not json');
    assert.match(repair(home, 'attempted-parent'), /corrupt-association-debt/i);
    assert.match(status(home, 'attempted-parent'), /corrupt-association-debt/i);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('STATUS: corrupt or forged resolution records are visible debt and cannot hide their marker', () => {
  const home = freshHome();
  try {
    activate(home, 'resolution-parent');
    activate(home, 'resolution-child', 'resolution-parent');
    const parentKey = taskKey('resolution-parent');
    const childKey = taskKey('resolution-child');
    const marker = writeMarker(home, parentKey, childKey, 'association-edge-persist-failed');
    assert.match(repair(home, 'resolution-parent'), /association resolved:\s*1/i);
    const directory = resolutionDir(home, parentKey);
    const target = path.join(directory, `${marker.id}.json`);
    assert.ok(fs.existsSync(target), 'expected immutable resolution record was not created');
    const forged = JSON.parse(fs.readFileSync(target, 'utf8'));
    forged.authoritativeParentKey = taskKey('someone-else');
    fs.writeFileSync(target, JSON.stringify(forged) + '\n');
    const text = status(home, 'resolution-parent');
    assert.match(text, /association debt:\s*yes/i);
    assert.match(text, /corrupt-association-resolution/i);
    assert.match(text, new RegExp(marker.id));

    const unrelated = path.join(resolutionDir(home, parentKey), 'orphan-resolution.json');
    fs.writeFileSync(unrelated, '{bad json');
    assert.match(status(home, 'resolution-parent'), /corrupt-association-resolution/i);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('REPAIR: a child cannot resolve a normal marker owned by its parent task', () => {
  const home = freshHome();
  try {
    activate(home, 'exact-parent');
    activate(home, 'exact-child', 'exact-parent');
    const parentKey = taskKey('exact-parent');
    const childKey = taskKey('exact-child');
    const marker = writeMarker(home, parentKey, childKey, 'association-parent-state-failed');
    assert.match(status(home, 'exact-parent'), new RegExp(`association debt:\\s*yes.*${marker.id}`, 'i'));
    assert.match(status(home, 'exact-child'), new RegExp(`association debt:\\s*yes.*${marker.id}`, 'i'),
      'parent-owned debt was not visible from the affected child');
    assert.match(repair(home, 'exact-child'), /association resolved:\s*0/i,
      'child repaired debt owned by its parent');
    assert.match(status(home, 'exact-parent'), new RegExp(`association debt:\\s*yes.*${marker.id}`, 'i'),
      'child repair cleared parent-scoped debt');
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('STATUS: a resolution file without a persisted matching repair transaction is rejected', () => {
  const home = freshHome();
  try {
    activate(home, 'transaction-parent');
    activate(home, 'transaction-child', 'transaction-parent');
    const parentKey = taskKey('transaction-parent');
    const childKey = taskKey('transaction-child');
    const marker = writeMarker(home, parentKey, childKey, 'association-edge-persist-failed');
    assert.match(repair(home, 'transaction-parent'), /association resolved:\s*1/i);
    const task = readTask(home, 'transaction-parent');
    delete task.recovery;
    writeTask(home, 'transaction-parent', task);
    const text = status(home, 'transaction-parent');
    assert.match(text, /association debt:\s*yes/i);
    assert.match(text, /corrupt-association-resolution/i);
    assert.match(text, new RegExp(marker.id));
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('STATUS: a mechanical C without a persisted matching repair transaction is rejected', () => {
  const home = freshHome();
  try {
    activate(home, 'transaction-mechanical');
    const key = taskKey('transaction-mechanical');
    const lock = path.join(stateDir(home), `task-lock-v4-${key}`);
    fs.mkdirSync(lock);
    fs.writeFileSync(path.join(lock, 'owner'), 'held-by-test');
    context(control(home, 'transaction-mechanical', 'DevRigorWARN'));
    fs.rmSync(lock, { recursive: true, force: true });
    assert.match(repair(home, 'transaction-mechanical'), /mechanical resolved:\s*1/i);
    const task = readTask(home, 'transaction-mechanical');
    delete task.recovery;
    writeTask(home, 'transaction-mechanical', task);
    const text = status(home, 'transaction-mechanical');
    assert.match(text, /mechanical debt:\s*yes/i);
    assert.match(text, /corrupt-mechanical-resolution/i);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('REPAIR: concurrent retries append one resolution for one occurrence', async () => {
  const home = freshHome();
  try {
    activate(home, 'concurrent-repair');
    const key = taskKey('concurrent-repair');
    const lock = path.join(stateDir(home), `task-lock-v4-${key}`);
    fs.mkdirSync(lock);
    fs.writeFileSync(path.join(lock, 'owner'), 'held-by-test');
    context(control(home, 'concurrent-repair', 'DevRigorWARN'));
    fs.rmSync(lock, { recursive: true, force: true });
    await Promise.all(Array.from({ length: 32 }, () => controlAsync(home, 'concurrent-repair', 'DevRigorREPAIR')));
    const lines = fs.readFileSync(mechanicalPath(home, 'concurrent-repair'), 'utf8')
      .split('\n').filter((line) => /^C\s+\S+\s+source:repair\b/.test(line));
    assert.strictEqual(lines.length, 1, `expected one correlated resolution, got ${lines.length}`);
    assert.match(status(home, 'concurrent-repair'), /mechanical debt:\s*no/i);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('STATUS: a new association occurrence is not hidden by an older resolution', () => {
  const home = freshHome();
  try {
    activate(home, 'repeat-parent');
    const bkTask = taskPath(home, 'repeat-parent') + '.bak';
    const bkGen = genesisPath(home, 'repeat-parent') + '.bak';
    fs.copyFileSync(taskPath(home, 'repeat-parent'), bkTask);
    fs.copyFileSync(genesisPath(home, 'repeat-parent'), bkGen);
    fs.unlinkSync(taskPath(home, 'repeat-parent'));
    fs.unlinkSync(genesisPath(home, 'repeat-parent'));

    activate(home, 'repeat-child', 'repeat-parent');
    fs.copyFileSync(bkTask, taskPath(home, 'repeat-parent'));
    fs.copyFileSync(bkGen, genesisPath(home, 'repeat-parent'));

    activate(home, 'repeat-child', 'repeat-parent');
    assert.match(repair(home, 'repeat-parent'), /association resolved:\s*1/i);
    assert.match(status(home, 'repeat-child'), /association debt:\s*no/i);

    fs.copyFileSync(taskPath(home, 'repeat-parent'), bkTask);
    fs.copyFileSync(genesisPath(home, 'repeat-parent'), bkGen);

    fs.unlinkSync(taskPath(home, 'repeat-parent'));
    fs.unlinkSync(genesisPath(home, 'repeat-parent'));
    fs.unlinkSync(edgePath(home, 'repeat-parent', 'repeat-child'));

    activate(home, 'repeat-child', 'repeat-parent');
    fs.copyFileSync(bkTask, taskPath(home, 'repeat-parent'));
    fs.copyFileSync(bkGen, genesisPath(home, 'repeat-parent'));

    const text = status(home, 'repeat-child');
    assert.match(text, /association debt:\s*yes\s*\(1\).*missing-parent-state/i,
      'old association attestation masked a new failure occurrence');
    assert.match(text, /association resolutions:\s*1\b/i);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('STATUS: replaying an old mechanical C cannot clear a newer failure occurrence', () => {
  const home = freshHome();
  try {
    activate(home, 'repeat-mechanical');
    const key = taskKey('repeat-mechanical');
    const lock = path.join(stateDir(home), `task-lock-v4-${key}`);
    const failControl = () => {
      fs.mkdirSync(lock);
      fs.writeFileSync(path.join(lock, 'owner'), 'held-by-test');
      context(control(home, 'repeat-mechanical', 'DevRigorWARN'));
      fs.rmSync(lock, { recursive: true, force: true });
    };
    failControl();
    assert.match(repair(home, 'repeat-mechanical'), /mechanical resolved:\s*1/i);
    const oldC = fs.readFileSync(mechanicalPath(home, 'repeat-mechanical'), 'utf8')
      .split('\n').find((line) => /^C\s+\S+\s+source:repair\b/.test(line));
    assert.ok(oldC, 'first repair did not write a correlated C');
    failControl();
    assert.match(status(home, 'repeat-mechanical'), /mechanical debt:\s*yes/i);
    fs.appendFileSync(mechanicalPath(home, 'repeat-mechanical'), `${oldC}\n`);
    assert.match(status(home, 'repeat-mechanical'), /mechanical debt:\s*yes/i,
      'stale C replay cleared a newer failure occurrence');
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('REPAIR: an unknown association code cannot be attested even when graph invariants match', () => {
  const home = freshHome();
  try {
    activate(home, 'unknown-code-parent');
    activate(home, 'unknown-code-child', 'unknown-code-parent');
    const parentKey = taskKey('unknown-code-parent');
    const childKey = taskKey('unknown-code-child');
    const marker = writeMarker(home, parentKey, childKey, 'invented-association-success');
    assert.match(status(home, 'unknown-code-parent'), /association debt:\s*yes/i);
    assert.match(repair(home, 'unknown-code-parent'), /association resolved:\s*0/i);
    const text = status(home, 'unknown-code-parent');
    assert.match(text, /association debt:\s*yes/i);
    assert.match(text, /unknown-association-code|corrupt-association-debt/i);
    assert.doesNotMatch(text, new RegExp(`association resolutions:[^\n]*${marker.id}`, 'i'));
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('STATUS: deleting the immutable edge cannot be hidden by parent and child compatibility projections', () => {
  const home = freshHome();
  try {
    activate(home, 'missing-edge-parent');
    activate(home, 'missing-edge-child', 'missing-edge-parent');
    assert.match(status(home, 'missing-edge-parent'), /association debt:\s*no/i);
    fs.unlinkSync(edgePath(home, 'missing-edge-parent', 'missing-edge-child'));
    const text = status(home, 'missing-edge-parent');
    assert.match(text, /association debt:\s*yes/i);
    assert.match(text, /missing-association-edge/i);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('STATUS: malformed exact-task association namespace entries remain visible debt', () => {
  const home = freshHome();
  try {
    activate(home, 'malformed-namespace');
    const directory = path.join(stateDir(home), 'association-debt-v4');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, taskKey('malformed-namespace')), 'not-a-directory');
    const text = status(home, 'malformed-namespace');
    assert.match(text, /association debt:\s*yes/i);
    assert.match(text, /corrupt-association-debt/i);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('STATUS: malformed unreferenced recovery transactions are visible and not repairable', () => {
  const home = freshHome();
  try {
    activate(home, 'malformed-recovery');
    const task = readTask(home, 'malformed-recovery');
    task.recovery = { version: 4, transactions: [{ id: 'not-a-transaction' }] };
    writeTask(home, 'malformed-recovery', task);
    const before = status(home, 'malformed-recovery');
    assert.match(before, /mechanical debt:\s*yes/i);
    assert.match(before, /corrupt-recovery-transaction/i);
    assert.match(repair(home, 'malformed-recovery'), /mechanical resolved:\s*0/i);
    assert.match(status(home, 'malformed-recovery'), /corrupt-recovery-transaction/i);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('REPAIR: failure to persist the only association marker cannot be acknowledged away', () => {
  const home = freshHome();
  try {
    activate(home, 'lost-association-marker');
    const key = taskKey('lost-association-marker');
    const occurrence = '1234567890abcdef';
    const correlation = hash('missing-marker').slice(0, 16);
    const id = hash(`${key}\0association-debt-persist-failed\0activate\0${correlation}\0${occurrence}`).slice(0, 16);
    fs.writeFileSync(mechanicalPath(home, 'lost-association-marker'),
      `M ${id} reason:association-debt-persist-failed source:activate correlation:${correlation} occurrence:${occurrence}\n`);
    const output = repair(home, 'lost-association-marker');
    assert.match(output, /mechanical resolved:\s*0/i);
    assert.match(output, /mechanical unresolved:\s*1/i);
    assert.match(status(home, 'lost-association-marker'), /association-debt-persist-failed/i);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('REPAIR: legacy generic hook failures without an intended postcondition remain debt', () => {
  const home = freshHome();
  try {
    activate(home, 'legacy-generic-failure');
    const key = taskKey('legacy-generic-failure');
    const id = hash(`${key}\0task-lock-timeout\0router`).slice(0, 16);
    fs.writeFileSync(mechanicalPath(home, 'legacy-generic-failure'),
      `M ${id} reason:task-lock-timeout source:router correlation:${hash('router').slice(0, 16)}\n`);
    const output = repair(home, 'legacy-generic-failure');
    assert.match(output, /mechanical resolved:\s*0/i);
    assert.match(output, /mechanical unresolved:\s*1/i);
    assert.match(status(home, 'legacy-generic-failure'), /task-lock-timeout/i);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('STATUS: deleting the locked parent projection cannot be hidden by child binding and edge', () => {
  const home = freshHome();
  try {
    activate(home, 'missing-projection-parent');
    activate(home, 'missing-projection-child', 'missing-projection-parent');
    const parent = readTask(home, 'missing-projection-parent');
    parent.children = [];
    writeTask(home, 'missing-projection-parent', parent);
    const text = status(home, 'missing-projection-parent');
    assert.match(text, /association debt:\s*yes/i);
    assert.match(text, /missing-parent-projection/i);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('STATUS: a corrupt top-level association namespace cannot erase known child debt', () => {
  const home = freshHome();
  try {
    activateUnbound(home, 'namespace-child');
    assert.match(status(home, 'namespace-child'), /association debt:\s*yes/i);
    const namespace = path.join(stateDir(home), 'association-debt-v4');
    fs.rmSync(namespace, { recursive: true, force: true });
    fs.writeFileSync(namespace, 'not-a-directory');
    const text = status(home, 'namespace-child');
    assert.match(text, /association debt:\s*yes/i);
    assert.match(text, /corrupt-association-debt-namespace/i);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('STATUS: missing exact root task state fails open and cannot report a clean task', () => {
  const home = freshHome();
  try {
    activate(home, 'missing-root-state');
    fs.unlinkSync(taskPath(home, 'missing-root-state'));
    const text = status(home, 'missing-root-state');
    assert.match(text, /mode:\s*WARN/i);
    assert.match(text, /mechanical debt:\s*yes/i);
    assert.match(text, /task-state-missing/i);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('STATUS: malformed critical task fields are corruption, never normalized to clean defaults', () => {
  const home = freshHome();
  try {
    writeTask(home, 'corrupt-critical-task', { unresolved: 'corrupt', children: 'corrupt' });
    const text = status(home, 'corrupt-critical-task');
    assert.match(text, /mode:\s*WARN/i);
    assert.match(text, /mechanical debt:\s*yes/i);
    assert.match(text, /task-state-corrupt/i);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('STATUS: wrong-version or extra-field association edges are corrupt debt', () => {
  const home = freshHome();
  try {
    activate(home, 'corrupt-edge-parent');
    activate(home, 'corrupt-edge-child', 'corrupt-edge-parent');
    fs.writeFileSync(edgePath(home, 'corrupt-edge-parent', 'corrupt-edge-child'), JSON.stringify({
      version: 999,
      parentKey: taskKey('corrupt-edge-parent'),
      childKey: taskKey('corrupt-edge-child'),
      extra: true,
    }) + '\n');
    const text = status(home, 'corrupt-edge-parent');
    assert.match(text, /association debt:\s*yes/i);
    assert.match(text, /corrupt-edge/i);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('STATUS: malformed nonblank mechanical ledger records are visible corruption debt', () => {
  const home = freshHome();
  try {
    activate(home, 'corrupt-mechanical-line');
    fs.writeFileSync(mechanicalPath(home, 'corrupt-mechanical-line'), 'M deadbeef reason:\n');
    const text = status(home, 'corrupt-mechanical-line');
    assert.match(text, /mechanical debt:\s*yes/i);
    assert.match(text, /corrupt-mechanical-record/i);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

(async () => {
  let failures = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      process.stdout.write(`PASS ${name}\n`);
    } catch (error) {
      failures++;
      process.stderr.write(`FAIL ${name}\n${error.stack || error}\n`);
    }
  }
  if (failures) process.exitCode = 1;
  else process.stdout.write(`ALL PASS (${tests.length} recovery tests)\n`);
})();
