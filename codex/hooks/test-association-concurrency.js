#!/usr/bin/env node
'use strict';

// Standalone adversarial contracts for task controls and subagent association state.
// Kept separate from test-hooks.js so cross-process failures can be run directly.

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

function defaultTask(overrides = {}) {
  return {
    version: 4,
    mode: 'ON',
    salt: crypto.randomBytes(32).toString('hex'),
    dirtyEdits: [], proofs: [], unresolved: [], warnings: {}, notices: [], children: [],
    checkpoint: 0, blockCount: 0,
    delivery: { preToolUse: 0, postToolUse: 0, stop: 0 },
    ...overrides,
  };
}

function freshHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-rigor-association-'));
  fs.mkdirSync(stateDir(home), { recursive: true });
  return home;
}

function writeTask(home, session, task) {
  fs.mkdirSync(stateDir(home), { recursive: true });
  const value = defaultTask({ ...task, taskKey: taskKey(session) });
  fs.writeFileSync(taskPath(home, session), JSON.stringify(value) + '\n');
  fs.writeFileSync(genesisPath(home, session), JSON.stringify({
    version: 4, taskKey: taskKey(session), saltCommitment: hash(value.salt),
  }) + '\n');
}

function readTask(home, session) {
  return JSON.parse(fs.readFileSync(taskPath(home, session), 'utf8'));
}

function writeEdge(home, parent, child, content) {
  const target = edgePath(home, parent, child);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content === undefined ? JSON.stringify({
    version: 4, parentKey: taskKey(parent), childKey: taskKey(child),
  }) + '\n' : content);
}

function run(script, args, payload, home) {
  return execFileSync(process.execPath, [script, ...args], {
    env: { ...process.env, CODEX_HOME: home },
    input: JSON.stringify(payload), encoding: 'utf8', windowsHide: true,
  }).trim();
}

function runAsync(script, args, payload, home) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      env: { ...process.env, CODEX_HOME: home },
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`hook exited ${code}: ${stderr}`));
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

function activate(home, session, parent = '') {
  return run(ACTIVATE, parent ? ['subagent'] : [], {
    session_id: session,
    ...(parent ? { parent_session_id: parent } : {}),
    hook_event_name: parent ? 'SubagentStart' : 'SessionStart',
  }, home);
}

function status(home, session) {
  const output = run(ROUTER, [], {
    session_id: session, turn_id: 'status-turn', prompt: 'DevRigorSTATUS',
  }, home);
  return JSON.parse(output).hookSpecificOutput.additionalContext;
}

function test(name, fn) { tests.push({ name, fn }); }

test('activation: compaction without a parent payload restores only a complete persisted association', () => {
  const home = freshHome();
  try {
    activate(home, 'compact-root');
    activate(home, 'compact-child', 'compact-root');
    run(ROUTER, [], { session_id: 'compact-root', turn_id: 'off', prompt: 'DevRigorOFF' }, home);
    const debtRoot = path.join(stateDir(home), 'association-debt-v4');
    const before = fs.existsSync(debtRoot) ? fs.readdirSync(debtRoot, { recursive: true }).length : 0;
    const output = run(ACTIVATE, ['subagent'], {
      session_id: 'compact-child', hook_event_name: 'SubagentStart', source: 'compact',
    }, home);
    assert.match(output, /Current task mode:\s*OFF/i);
    assert.doesNotMatch(output, /parent task identity is unavailable/i);
    const after = fs.existsSync(debtRoot) ? fs.readdirSync(debtRoot, { recursive: true }).length : 0;
    assert.strictEqual(after, before, 'healthy compaction created association debt');
    assert.strictEqual(readTask(home, 'compact-child').parentKey, taskKey('compact-root'));
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('activation: compact resume never recreates a known missing root as clean', () => {
  const home = freshHome();
  try {
    activate(home, 'missing-root');
    run(ROUTER, [], { session_id: 'missing-root', turn_id: 'off', prompt: 'DevRigorOFF' }, home);
    fs.unlinkSync(taskPath(home, 'missing-root'));
    const output = run(ACTIVATE, [], {
      session_id: 'missing-root', hook_event_name: 'SessionStart', source: 'compact',
    }, home);
    assert.match(output, /Current task mode:\s*WARN/i);
    assert.match(output, /task state is unavailable|mechanical debt/i);
    assert.ok(!fs.existsSync(taskPath(home, 'missing-root')), 'missing root was synthesized as a fresh task');
    assert.match(fs.readFileSync(path.join(stateDir(home), `mechanical-v4-${taskKey('missing-root')}.log`), 'utf8'), /reason:task-state-missing/);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('association: a missing known parent is never synthesized while starting a child', () => {
  const home = freshHome();
  try {
    activate(home, 'lost-parent');
    run(ROUTER, [], { session_id: 'lost-parent', turn_id: 'off', prompt: 'DevRigorOFF' }, home);
    fs.unlinkSync(taskPath(home, 'lost-parent'));
    const output = activate(home, 'new-child', 'lost-parent');
    assert.match(output, /Current task mode:\s*WARN/i);
    assert.match(output, /parent task state is missing-known|not synthesized|missing-parent-state/i);
    assert.ok(!fs.existsSync(taskPath(home, 'lost-parent')), 'parent projection recreated missing parent state');
    assert.strictEqual(readTask(home, 'new-child').mode, 'WARN');
    assert.match(status(home, 'new-child'), /association debt:\s*yes[\s\S]*missing-parent-state/i);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('association: a missing known child is never recreated clean on repeated SubagentStart', () => {
  const home = freshHome();
  try {
    activate(home, 'known-parent');
    activate(home, 'known-child', 'known-parent');
    const child = readTask(home, 'known-child');
    child.dirtyEdits = [hash('lost-dirty-edit').slice(0, 16)];
    writeTask(home, 'known-child', child);
    fs.unlinkSync(taskPath(home, 'known-child'));
    const output = run(ACTIVATE, ['subagent'], {
      session_id: 'known-child', parent_session_id: 'known-parent', hook_event_name: 'SubagentStart', source: 'compact',
    }, home);
    assert.match(output, /Current task mode:\s*WARN/i);
    assert.ok(!fs.existsSync(taskPath(home, 'known-child')), 'known missing child was synthesized clean');
    assert.match(status(home, 'known-parent'), /association debt:\s*yes[\s\S]*(?:missing-child-state|missing child)/i);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('association: 32 concurrent child starts retain every edge and every child debt', async () => {
  const home = freshHome();
  try {
    activate(home, 'parent');
    await Promise.all(Array.from({ length: 32 }, (_, index) => runAsync(ACTIVATE, ['subagent'], {
      session_id: `child-${index}`, parent_session_id: 'parent', hook_event_name: 'SubagentStart',
    }, home)));
    assert.strictEqual(new Set(readTask(home, 'parent').children).size, 32, 'legacy parent.children projection lost a concurrent child');
    for (let index = 0; index < 32; index++) {
      const child = readTask(home, `child-${index}`);
      child.unresolved = [{
        id: hash(`debt-${index}`).slice(0, 16),
        edits: [hash(`edit-${index}`).slice(0, 16)],
        status: 'unresolved',
      }];
      writeTask(home, `child-${index}`, child);
      assert.ok(fs.existsSync(edgePath(home, 'parent', `child-${index}`)), `missing immutable edge child-${index}`);
    }
    const text = status(home, 'parent');
    assert.match(text, /associated subagents:\s*32\b/i);
    assert.match(text, /subagent unresolved proof:\s*32\b/i);
    assert.match(text, /association debt:\s*no/i);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('association: concurrent reparent attempts preserve one immutable parent and expose every conflict', async () => {
  const home = freshHome();
  try {
    const parents = Array.from({ length: 32 }, (_, index) => `parent-${index}`);
    const outputs = await Promise.all(parents.map((parent) => runAsync(ACTIVATE, ['subagent'], {
      session_id: 'shared-child', parent_session_id: parent, hook_event_name: 'SubagentStart',
    }, home)));
    const child = readTask(home, 'shared-child');
    const winner = parents.find((parent) => taskKey(parent) === child.parentKey);
    assert.ok(winner, 'child parentKey did not bind to one requested parent');
    assert.ok(fs.existsSync(edgePath(home, winner, 'shared-child')), 'winning association edge is absent');
    assert.strictEqual(parents.filter((parent) => fs.existsSync(edgePath(home, parent, 'shared-child'))).length, 1);
    assert.strictEqual(outputs.filter((output) => /association conflict|different parent|could not be persisted/i.test(output)).length, 31);
    for (const parent of parents.filter((candidate) => candidate !== winner)) {
      assert.match(status(home, parent), /association debt:\s*yes\s*\(1\)/i, `${parent} did not expose its conflict debt`);
    }
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('controls: OFF and WARN resolve recursively through nested descendants', () => {
  const home = freshHome();
  try {
    activate(home, 'root');
    activate(home, 'child', 'root');
    activate(home, 'grandchild', 'child');
    run(ROUTER, [], { session_id: 'root', turn_id: 'off', prompt: 'DevRigorOFF' }, home);
    assert.match(status(home, 'grandchild'), /mode:\s*OFF/i);
    assert.match(activate(home, 'grandchild', 'child'), /Current task mode:\s*OFF/i);
    run(ROUTER, [], { session_id: 'root', turn_id: 'warn', prompt: 'DevRigorWARN' }, home);
    assert.match(status(home, 'grandchild'), /mode:\s*WARN/i);
    assert.match(activate(home, 'grandchild', 'child'), /Current task mode:\s*WARN/i);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('controls: a descendant-local WARN remains effective beneath an ON root', () => {
  const home = freshHome();
  try {
    activate(home, 'local-root');
    activate(home, 'local-child', 'local-root');
    activate(home, 'local-grandchild', 'local-child');
    run(ROUTER, [], { session_id: 'local-child', turn_id: 'warn', prompt: 'DevRigorWARN' }, home);
    assert.match(status(home, 'local-child'), /mode:\s*WARN/i);
    assert.match(status(home, 'local-grandchild'), /mode:\s*WARN/i);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('controls: explicit local OFF wins consistently when ancestry is missing, corrupt, or cyclic', () => {
  const home = freshHome();
  try {
    const missingParent = taskKey('missing-parent');
    writeTask(home, 'missing-child', { mode: 'OFF', parentKey: missingParent });
    assert.match(status(home, 'missing-child'), /mode:\s*OFF/i);
    assert.match(activate(home, 'missing-child'), /Current task mode:\s*OFF/i);

    writeTask(home, 'corrupt-parent', { mode: 'ON' });
    fs.writeFileSync(taskPath(home, 'corrupt-parent'), '{bad json');
    writeTask(home, 'corrupt-child', { mode: 'OFF', parentKey: taskKey('corrupt-parent') });
    assert.match(status(home, 'corrupt-child'), /mode:\s*OFF/i);

    writeTask(home, 'cycle-off', { mode: 'OFF', parentKey: taskKey('cycle-on') });
    writeTask(home, 'cycle-on', { mode: 'ON', parentKey: taskKey('cycle-off') });
    assert.match(status(home, 'cycle-off'), /mode:\s*OFF/i);
    assert.match(status(home, 'cycle-on'), /mode:\s*OFF/i);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('association: an unbound subagent remains visibly release-blocking in its own STATUS', () => {
  const home = freshHome();
  try {
    const output = run(ACTIVATE, ['subagent'], { session_id: 'unbound-child', hook_event_name: 'SubagentStart' }, home);
    assert.match(output, /mode:\s*WARN/i);
    assert.match(output, /Parent task identity is unavailable/i);
    assert.match(status(home, 'unbound-child'), /association debt:\s*yes\s*\(1\).*parent-unavailable/i);

    activate(home, 'resolved-parent');
    activate(home, 'unbound-child', 'resolved-parent');
    assert.match(status(home, 'unbound-child'), /association debt:\s*yes\s*\(1\).*parent-unavailable/i,
      'later binding silently erased the append-only debt marker before owner-directed repair');
    run(ROUTER, [], { session_id: 'unbound-child', turn_id: 'repair', prompt: 'DevRigorREPAIR' }, home);
    assert.match(status(home, 'unbound-child'), /association debt:\s*no/i,
      'owner-directed repair did not attest the authoritative later binding');
    assert.match(status(home, 'resolved-parent'), /associated subagents:\s*1\b/i);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('STATUS: edge, parentKey, and legacy-child union cannot hide missing, corrupt, orphan, or cyclic state', () => {
  const home = freshHome();
  try {
    const rootKey = taskKey('root');
    const legacyKey = taskKey('legacy-child');
    writeTask(home, 'root', { children: [legacyKey] });
    writeTask(home, 'legacy-child', { parentKey: rootKey });

    // Declared child with no edge: must be counted and reported as orphan association data.
    writeTask(home, 'orphan-child', { parentKey: rootKey });

    // Edge with no task state.
    writeEdge(home, 'root', 'missing-child');

    // Edge with corrupt task state.
    writeEdge(home, 'root', 'corrupt-child');
    fs.writeFileSync(taskPath(home, 'corrupt-child'), '{bad json');

    // A registry cycle must terminate and remain release-visible.
    writeTask(home, 'cycle-child', { parentKey: rootKey });
    writeEdge(home, 'root', 'cycle-child');
    writeEdge(home, 'cycle-child', 'root');

    const text = status(home, 'root');
    assert.match(text, /associated subagents:\s*5\b/i);
    assert.match(text, /association debt:\s*yes\s*\([4-9]\d*\)/i);
    assert.match(text, /missing-child-state|corrupt-child-state|orphan-association|association-cycle/i);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('STATUS: mechanical ledger reports unique unresolved M records minus C records', () => {
  const home = freshHome();
  try {
    activate(home, 'mechanical');
    const ledger = path.join(stateDir(home), `mechanical-v4-${taskKey('mechanical')}.log`);
    fs.writeFileSync(ledger, [
      'M debt-a reason:snapshot-unavailable edit-set:set-a',
      'M debt-b reason:evidence-mismatch edit-set:set-b',
      'M debt-b reason:evidence-mismatch edit-set:set-b',
      'C debt-a',
      '',
    ].join('\n'));
    const text = status(home, 'mechanical');
    assert.match(text, /mechanical debt:\s*yes\s*\(1\).*debt-b/i);
    assert.doesNotMatch(text, /mechanical debt:[^\n]*debt-a/i);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('STATUS: corrupt state is mechanical debt and unrelated corrupt edges stay task-scoped', () => {
  const home = freshHome();
  try {
    activate(home, 'clean-root');
    writeEdge(home, 'unrelated-root', 'unrelated-child', '{bad json');
    assert.match(status(home, 'clean-root'), /association debt:\s*no/i);

    fs.writeFileSync(taskPath(home, 'corrupt-root'), '{bad json');
    const text = status(home, 'corrupt-root');
    assert.match(text, /mode:\s*WARN/i);
    assert.match(text, /mechanical debt:\s*yes\s*\(1\)/i);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('STATUS: an edge without the child parent binding remains association debt', () => {
  const home = freshHome();
  try {
    writeTask(home, 'binding-root');
    writeTask(home, 'binding-child');
    writeEdge(home, 'binding-root', 'binding-child');
    const text = status(home, 'binding-root');
    assert.match(text, /associated subagents:\s*1\b/i);
    assert.match(text, /association debt:\s*yes\s*\([2-9]\d*\)/i);
    assert.match(text, /missing-parent-binding/i);
    assert.match(text, /missing-parent-projection/i);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('router: parent coding reminder includes nested subagent proof and mechanical debt', () => {
  const home = freshHome();
  try {
    activate(home, 'reminder-root');
    activate(home, 'reminder-child', 'reminder-root');
    activate(home, 'reminder-grandchild', 'reminder-child');
    const grandchild = readTask(home, 'reminder-grandchild');
    const proofDebt = hash('nested-proof-debt').slice(0, 16);
    grandchild.unresolved = [{
      id: proofDebt, edits: [hash('nested-edit').slice(0, 16)], status: 'unresolved',
    }];
    writeTask(home, 'reminder-grandchild', grandchild);
    const mechanicalId = hash('nested-mechanical-debt').slice(0, 16);
    fs.writeFileSync(path.join(stateDir(home), `mechanical-v4-${taskKey('reminder-grandchild')}.log`),
      `M ${mechanicalId} reason:snapshot-unavailable edit-set:${hash('nested-set').slice(0, 16)}\n`);
    const output = run(ROUTER, [], {
      session_id: 'reminder-root', turn_id: 'coding-turn', prompt: 'fix src/app.ts',
    }, home);
    const text = JSON.parse(output).hookSpecificOutput.additionalContext;
    assert.match(text, /DEV-RIGOR PROOF DEBT/i);
    assert.match(text, new RegExp(proofDebt));
    assert.match(text, /associated-subagent mechanical debt/i);
    assert.match(text, new RegExp(mechanicalId));
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('retention: routing never deletes unresolved task, mechanical, or association state', () => {
  const home = freshHome();
  try {
    activate(home, 'retained-parent');
    activate(home, 'retained-child', 'retained-parent');
    const child = readTask(home, 'retained-child');
    child.unresolved = [{ id: 'retained-debt', edits: ['retained-edit'], status: 'unresolved' }];
    writeTask(home, 'retained-child', child);
    if (!fs.existsSync(edgePath(home, 'retained-parent', 'retained-child'))) {
      writeEdge(home, 'retained-parent', 'retained-child');
    }
    const mechanical = path.join(stateDir(home), `mechanical-v4-${taskKey('retained-child')}.log`);
    fs.writeFileSync(mechanical, 'M retained-mechanical reason:state-unavailable\n');
    const old = new Date(Date.now() - 8 * 24 * 3600 * 1000);
    for (const file of [taskPath(home, 'retained-child'), mechanical, edgePath(home, 'retained-parent', 'retained-child')]) {
      fs.utimesSync(file, old, old);
    }
    run(ROUTER, [], {
      session_id: 'unrelated', turn_id: 'route', prompt: 'Please implement and fix the failing app.js test.',
    }, home);
    assert.ok(fs.existsSync(taskPath(home, 'retained-child')), 'unresolved child task was pruned');
    assert.ok(fs.existsSync(mechanical), 'mechanical debt ledger was pruned');
    assert.ok(fs.existsSync(edgePath(home, 'retained-parent', 'retained-child')), 'association edge was pruned');
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
  else process.stdout.write(`ALL PASS (${tests.length} association/control tests)\n`);
})();
