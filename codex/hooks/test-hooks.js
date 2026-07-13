#!/usr/bin/env node
// Hermetic contract suite for the active Codex hook runtime.

const assert = require('assert');
const { execFileSync, execSync, spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOOKS = __dirname;
const CODEX = path.join(HOOKS, '..');
const ACTIVATE = path.join(HOOKS, 'dev-rigor-activate.js');
const ROUTER = path.join(HOOKS, 'dev-rigor-router.js');
const GROUND = path.join(HOOKS, 'dev-rigor-ground.js');
const WIRE = path.join(HOOKS, 'wire-hooks.js');

for (const required of [ACTIVATE, ROUTER, GROUND, WIRE, path.join(CODEX, 'dev-rigor-reflex.md')]) {
  assert.ok(fs.existsSync(required), `missing active Codex hook artifact: ${required}`);
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-dev-rigor-hooks-'));
let serial = 0;

function freshHome() {
  const dir = path.join(tmpRoot, `home-${++serial}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function runHook(script, input, home, args = []) {
  return execFileSync('node', [script, ...args], {
    input: JSON.stringify(input),
    env: { ...process.env, CODEX_HOME: home },
    encoding: 'utf8',
  });
}

function runHookAsync(script, input, home, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      env: { ...process.env, CODEX_HOME: home }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`hook exited ${code}: ${stderr}`));
    });
    child.stdin.end(JSON.stringify(input));
  });
}

function record(home, session, toolName, toolInput, toolResponse = {}, turn = 'turn-1') {
  return runHook(GROUND, {
    session_id: session,
    turn_id: turn,
    hook_event_name: 'PostToolUse',
    tool_name: toolName,
    tool_input: toolInput,
    tool_response: toolResponse,
  }, home, ['record']);
}

function stop(home, session, message = '', active = false, mode = 'stop', turn = 'turn-1') {
  return runHook(GROUND, {
    session_id: session,
    turn_id: turn,
    hook_event_name: mode === 'subagent' ? 'SubagentStop' : 'Stop',
    stop_hook_active: active,
    last_assistant_message: message,
  }, home, ['check']);
}

function prompt(home, session, message, turn = 'turn-1') {
  return runHook(ROUTER, {
    session_id: session,
    turn_id: turn,
    hook_event_name: 'UserPromptSubmit',
    prompt: message,
  }, home);
}

function stateFiles(home, prefix) {
  const state = path.join(home, 'dev-rigor-stack', 'state');
  return fs.existsSync(state) ? fs.readdirSync(state).filter((name) => name.startsWith(prefix)) : [];
}

function stateLines(home, prefix = 'ground-v4-') {
  const state = path.join(home, 'dev-rigor-stack', 'state');
  return stateFiles(home, prefix).flatMap((name) =>
    fs.readFileSync(path.join(state, name), 'utf8').split('\n').filter(Boolean)
  );
}

function taskState(home) {
  const state = path.join(home, 'dev-rigor-stack', 'state');
  const files = stateFiles(home, 'task-v4-');
  assert.strictEqual(files.length, 1, 'expected exactly one task state');
  return JSON.parse(fs.readFileSync(path.join(state, files[0]), 'utf8'));
}

const receipt = 'proved: pytest -q - 12 passed · blast: medium · skipped: none';
const tests = [];
function test(name, fn) { tests.push([name, fn]); }

test('activate: SessionStart injects the compact invariant contract through Codex JSON', () => {
  const out = runHook(ACTIVATE, { session_id: 'activate-core', hook_event_name: 'SessionStart' }, freshHome());
  const parsed = JSON.parse(out);
  assert.strictEqual(parsed.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(parsed.hookSpecificOutput.additionalContext, /DEV-RIGOR CORE ACTIVE/);
  assert.match(parsed.hookSpecificOutput.additionalContext, /substantive proof/i);
  assert.doesNotMatch(parsed.hookSpecificOutput.additionalContext, /For every coding unit, route through/);
});

test('activate: unbound SubagentStart visibly fails open in WARN', () => {
  const out = runHook(ACTIVATE, { session_id: 'unbound-child', hook_event_name: 'SubagentStart' }, freshHome(), ['subagent']);
  const parsed = JSON.parse(out);
  assert.strictEqual(parsed.hookSpecificOutput.hookEventName, 'SubagentStart');
  assert.match(parsed.hookSpecificOutput.additionalContext, /mode:\s*WARN/i);
  assert.match(parsed.hookSpecificOutput.additionalContext, /parent task identity.*unavailable/i);
});

test('activate: compaction restores task mode and active routed discipline', () => {
  const home = freshHome();
  prompt(home, 'compact-parent', 'DevRigorWARN');
  prompt(home, 'compact-parent', 'Fix the parser crash and prove the regression.');
  const out = runHook(ACTIVATE, {
    session_id: 'compact-parent', hook_event_name: 'SessionStart', source: 'compact',
  }, home);
  const context = JSON.parse(out).hookSpecificOutput.additionalContext;
  assert.match(context, /mode:\s*WARN/i);
  assert.match(context, /INVESTIGATION PROTOCOL/);
});

test('activate: bound subagent inherits live parent controls including later OFF', () => {
  const home = freshHome();
  const started = runHook(ACTIVATE, {
    session_id: 'bound-child', parent_session_id: 'bound-parent', hook_event_name: 'SubagentStart',
  }, home, ['subagent']);
  assert.match(JSON.parse(started).hookSpecificOutput.additionalContext, /mode:\s*ON/i);
  prompt(home, 'bound-parent', 'DevRigorOFF');
  record(home, 'bound-child', 'apply_patch', { command: '*** Update File: src/child.ts' });
  assert.strictEqual(stop(home, 'bound-child', '', false, 'subagent').trim(), '');
  assert.strictEqual(stateFiles(home, 'ground-v4-').length, 0);
});

test('router: Codex UserPromptSubmit returns hook-specific additional context', () => {
  const out = runHook(ROUTER, {
    session_id: 'router-1',
    hook_event_name: 'UserPromptSubmit',
    prompt: 'Fix the parser crash and prove the failing regression.',
  }, freshHome());
  const parsed = JSON.parse(out);
  assert.strictEqual(parsed.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.match(parsed.hookSpecificOutput.additionalContext, /INVESTIGATION/);
});

test('router: non-code prompts remain silent', () => {
  const out = runHook(ROUTER, {
    session_id: 'router-2',
    hook_event_name: 'UserPromptSubmit',
    prompt: 'What did you think of that article?',
  }, freshHome());
  assert.strictEqual(out.trim(), '');
});

test('router: prompt routing never creates or mutates a grounding ledger', () => {
  const home = freshHome();
  prompt(home, 'router-no-ground', 'Fix the parser crash and prove the regression.', 'turn-prompt');
  const state = path.join(home, 'dev-rigor-stack', 'state');
  const files = fs.existsSync(state) ? fs.readdirSync(state) : [];
  assert.strictEqual(files.some((name) => name.startsWith('ground-')), false);
});

test('ground: apply_patch runnable edit without a later execution blocks Stop', () => {
  const home = freshHome();
  record(home, 'ground-1', 'apply_patch', {
    command: '*** Begin Patch\n*** Update File: src/app.py\n@@\n-old\n+new\n*** End Patch',
  });
  const parsed = JSON.parse(stop(home, 'ground-1', receipt));
  assert.strictEqual(parsed.decision, 'block');
  assert.match(parsed.reason, /after the latest runnable edit/i);
});

test('ground: execution after edit plus receipt passes', () => {
  const home = freshHome();
  record(home, 'ground-2', 'apply_patch', { command: '*** Update File: src/app.ts' });
  record(home, 'ground-2', 'Bash', { command: 'npm test' }, { exit_code: 0 });
  assert.strictEqual(stop(home, 'ground-2', receipt).trim(), '');
});

test('ground: accepted receipt checkpoints the edit so later conversation passes', () => {
  const home = freshHome();
  record(home, 'ground-checkpoint', 'apply_patch', { command: '*** Update File: src/app.ts' });
  record(home, 'ground-checkpoint', 'Bash', { command: 'npm test' }, { exit_code: 0 });
  assert.strictEqual(stop(home, 'ground-checkpoint', receipt).trim(), '');
  assert.strictEqual(stop(home, 'ground-checkpoint', 'Here is the status you requested.').trim(), '');
});

test('ground: a later edit after an accepted receipt re-arms proof enforcement', () => {
  const home = freshHome();
  record(home, 'ground-rearm', 'apply_patch', { command: '*** Update File: src/app.ts' });
  record(home, 'ground-rearm', 'Bash', { command: 'npm test' }, { exit_code: 0 });
  assert.strictEqual(stop(home, 'ground-rearm', receipt).trim(), '');
  record(home, 'ground-rearm', 'apply_patch', { command: '*** Update File: src/later.ts' });
  const parsed = JSON.parse(stop(home, 'ground-rearm', receipt));
  assert.strictEqual(parsed.decision, 'block');
  assert.match(parsed.reason, /latest runnable edit/i);
});

test('ground: a distinct Codex turn passes even when an older turn remains unresolved', () => {
  const home = freshHome();
  record(home, 'ground-turn', 'apply_patch', { command: '*** Update File: src/app.ts' }, {}, 'turn-edit');
  assert.strictEqual(stop(home, 'ground-turn', 'Here is the read-only status report.', false, 'stop', 'turn-status').trim(), '');
});

test('ground: an edit after the current prompt boundary still requires proof', () => {
  const home = freshHome();
  prompt(home, 'ground-current-turn', 'Please update src/app.ts for me.', 'turn-edit');
  record(home, 'ground-current-turn', 'apply_patch', { command: '*** Update File: src/app.ts' }, {}, 'turn-edit');
  const parsed = JSON.parse(stop(home, 'ground-current-turn', receipt, false, 'stop', 'turn-edit'));
  assert.strictEqual(parsed.decision, 'block');
  assert.match(parsed.reason, /latest runnable edit/i);
});

test('ground: an ambient prompt with another turn id cannot clear dirty coding state', () => {
  const home = freshHome();
  record(home, 'ground-ambient', 'apply_patch', { command: '*** Update File: src/app.ts' }, {}, 'turn-edit');
  prompt(home, 'ground-ambient', 'Background suggestion event.', 'turn-ambient');
  const parsed = JSON.parse(stop(home, 'ground-ambient', receipt, false, 'stop', 'turn-edit'));
  assert.strictEqual(parsed.decision, 'block');
  assert.match(parsed.reason, /latest runnable edit/i);
});

test('ground: a substantive block cannot loop and leaves visible unresolved proof debt', () => {
  const home = freshHome();
  record(home, 'ground-retry', 'apply_patch', { command: '*** Update File: src/app.ts' });
  const blocked = JSON.parse(stop(home, 'ground-retry', 'All done.'));
  assert.strictEqual(blocked.decision, 'block');
  assert.strictEqual(stop(home, 'ground-retry', 'The hook requested a receipt.', true).trim(), '');
  assert.ok(stateLines(home).some((line) => line.startsWith('U ')), 'circuit release must record unresolved proof');
  const status = JSON.parse(prompt(home, 'ground-retry', 'DevRigorSTATUS'));
  assert.match(status.hookSpecificOutput.additionalContext, /unresolved proof:\s*yes/i);
});

test('ground: proof resolves debt only for the same or a verified superseding edit set', () => {
  const home = freshHome();
  record(home, 'ground-debt-superset', 'apply_patch', { command: '*** Update File: src/app.ts' }, {}, 'turn-debt');
  assert.strictEqual(JSON.parse(stop(home, 'ground-debt-superset', 'Done.', false, 'stop', 'turn-debt')).decision, 'block');
  assert.strictEqual(stop(home, 'ground-debt-superset', 'Released after the one-block circuit.', true, 'stop', 'turn-debt').trim(), '');
  assert.strictEqual(taskState(home).unresolved.length, 1);

  record(home, 'ground-debt-superset', 'apply_patch', { command: '*** Update File: src/helper.ts' }, {}, 'turn-proof');
  record(home, 'ground-debt-superset', 'Bash', { command: 'npm test' }, { exit_code: 0 }, 'turn-proof');
  assert.strictEqual(stop(home, 'ground-debt-superset', receipt, false, 'stop', 'turn-proof').trim(), '');
  assert.strictEqual(taskState(home).unresolved.length, 0, 'a proved superset containing every indebted edit must resolve the older debt');
});

test('ground: the same turn is blocked at most once when Codex omits stop_hook_active', () => {
  const home = freshHome();
  record(home, 'ground-circuit', 'apply_patch', { command: '*** Update File: src/app.ts' });
  const first = JSON.parse(stop(home, 'ground-circuit', 'All done.'));
  assert.strictEqual(first.decision, 'block');
  assert.strictEqual(stop(home, 'ground-circuit', 'Explanation after hook feedback.').trim(), '');
  assert.strictEqual(stop(home, 'ground-circuit', 'Later conversation in the same turn.').trim(), '');
});

test('ground: stop_hook_active clears a prior block instead of leaving poison state', () => {
  const home = freshHome();
  record(home, 'ground-active-clear', 'apply_patch', { command: '*** Update File: src/app.ts' });
  const first = JSON.parse(stop(home, 'ground-active-clear', receipt));
  assert.strictEqual(first.decision, 'block');
  assert.strictEqual(stop(home, 'ground-active-clear', 'Hook continuation.', true).trim(), '');
  assert.strictEqual(stop(home, 'ground-active-clear', 'Ordinary follow-up in the same turn.').trim(), '');
});

test('ground: stop_hook_active without a prior block does not silently clear dirty work', () => {
  const home = freshHome();
  record(home, 'ground-active-no-block', 'apply_patch', { command: '*** Update File: src/app.ts' });
  assert.strictEqual(stop(home, 'ground-active-no-block', 'Platform retry.', true).trim(), '');
  const parsed = JSON.parse(stop(home, 'ground-active-no-block', receipt));
  assert.strictEqual(parsed.decision, 'block');
  assert.match(parsed.reason, /latest runnable edit/i);
});

test('ground: new tool activity after a block re-arms the current turn', () => {
  const home = freshHome();
  record(home, 'ground-rearm-after-block', 'apply_patch', { command: '*** Update File: src/app.ts' });
  const first = JSON.parse(stop(home, 'ground-rearm-after-block', receipt));
  assert.strictEqual(first.decision, 'block');
  record(home, 'ground-rearm-after-block', 'Bash', { command: 'npm test' }, { exit_code: 0 });
  assert.strictEqual(stop(home, 'ground-rearm-after-block', 'Done without a receipt.').trim(), '');
  assert.ok(stateLines(home).some((line) => line.startsWith('W ') && /missing-receipt/.test(line)));
});

test('ground: missing turn_id fails open, creates no ledger, and warns once on the task', () => {
  const home = freshHome();
  runHook(GROUND, {
    session_id: 'ground-no-turn', hook_event_name: 'PostToolUse', tool_name: 'apply_patch',
    tool_input: { command: '*** Update File: src/app.ts' }, tool_response: {},
  }, home, ['record']);
  const out = runHook(GROUND, {
    session_id: 'ground-no-turn', hook_event_name: 'Stop', stop_hook_active: false,
    last_assistant_message: '',
  }, home, ['check']);
  assert.strictEqual(out.trim(), '');
  const state = path.join(home, 'dev-rigor-stack', 'state');
  assert.strictEqual(fs.existsSync(state) && fs.readdirSync(state).some((name) => name.startsWith('ground-v4-')), false);
  const warned = JSON.parse(prompt(home, 'ground-no-turn', 'What enforcement is active?'));
  assert.match(warned.hookSpecificOutput.additionalContext, /mechanical enforcement is unavailable.*turn_id/i);
  assert.strictEqual(prompt(home, 'ground-no-turn', 'Thanks, continue normally.').trim(), '');
});

test('ground: retention prunes expired and over-budget inactive state but preserves current files', () => {
  const home = freshHome();
  const state = path.join(home, 'dev-rigor-stack', 'state');
  fs.mkdirSync(state, { recursive: true });
  const expired = path.join(state, 'ground-v4-expired.log');
  fs.writeFileSync(expired, 'old\n');
  const old = new Date(Date.now() - 8 * 24 * 3600 * 1000);
  fs.utimesSync(expired, old, old);
  for (let index = 0; index < 6; index++) {
    const file = path.join(state, `ground-v4-budget-${index}.log`);
    fs.writeFileSync(file, Buffer.alloc(1024 * 1024, index));
    const time = new Date(Date.now() - (6 - index) * 60000);
    fs.utimesSync(file, time, time);
  }
  record(home, 'retention-active', 'apply_patch', { command: '*** Update File: src/active.ts' });
  assert.strictEqual(fs.existsSync(expired), false);
  const files = fs.readdirSync(state).map((name) => path.join(state, name));
  const total = files.reduce((sum, file) => sum + fs.statSync(file).size, 0);
  assert.ok(total <= 5 * 1024 * 1024 + 4096, `state budget exceeded: ${total}`);
  assert.ok(files.some((file) => path.basename(file).startsWith('ground-v4-') && fs.statSync(file).size < 4096));
});

test('ground: state permissions are owner-only on POSIX', () => {
  if (process.platform === 'win32') return;
  const home = freshHome();
  record(home, 'permissions', 'apply_patch', { command: '*** Update File: src/app.ts' });
  const state = path.join(home, 'dev-rigor-stack', 'state');
  assert.strictEqual(fs.statSync(state).mode & 0o777, 0o700);
  for (const name of fs.readdirSync(state)) assert.strictEqual(fs.statSync(path.join(state, name)).mode & 0o777, 0o600);
});

test('ground: inability to persist a block fails open instead of creating a retry loop', () => {
  const home = freshHome();
  record(home, 'ground-read-only', 'apply_patch', { command: '*** Update File: src/app.ts' });
  const state = path.join(home, 'dev-rigor-stack', 'state');
  const ledgerName = fs.readdirSync(state).find((name) => name.startsWith('ground-v4-'));
  const ledger = path.join(state, ledgerName);
  fs.chmodSync(ledger, 0o444);
  try {
    assert.strictEqual(stop(home, 'ground-read-only', receipt).trim(), '');
  } finally {
    fs.chmodSync(ledger, 0o666);
  }
});

test('ground: legacy 1.6.1 and 1.6.2 ledgers remain audit history and cannot poison v3 turns', () => {
  const home = freshHome();
  const state = path.join(home, 'dev-rigor-stack', 'state');
  fs.mkdirSync(state, { recursive: true });
  fs.writeFileSync(path.join(state, 'ground-ground-legacy.log'), 'E src/old.ts\nX Bash\n');
  fs.writeFileSync(path.join(state, 'ground-v2-ground-legacy.log'), 'E src/old.ts\nX Bash\n');
  assert.strictEqual(stop(home, 'ground-legacy', 'Ordinary conversation.').trim(), '');
});

test('ground: the same turn id in different sessions remains isolated', () => {
  const home = freshHome();
  record(home, 'session-a', 'apply_patch', { command: '*** Update File: src/a.ts' }, {}, 'shared-turn');
  assert.strictEqual(stop(home, 'session-b', 'Conversation only.', false, 'stop', 'shared-turn').trim(), '');
  const parsed = JSON.parse(stop(home, 'session-a', receipt, false, 'stop', 'shared-turn'));
  assert.strictEqual(parsed.decision, 'block');
});

test('ground: identity hashing prevents sanitized path collisions', () => {
  const home = freshHome();
  record(home, 'session/a', 'apply_patch', { command: '*** Update File: src/a.ts' }, {}, 'turn?1');
  assert.strictEqual(stop(home, 'sessiona', 'Conversation only.', false, 'stop', 'turn1').trim(), '');
  const parsed = JSON.parse(stop(home, 'session/a', receipt, false, 'stop', 'turn?1'));
  assert.strictEqual(parsed.decision, 'block');
  const ledgers = fs.readdirSync(path.join(home, 'dev-rigor-stack', 'state'))
    .filter((name) => name.startsWith('ground-v4-'));
  assert.strictEqual(ledgers.length, 1);
});

test('ground: concurrent PostToolUse writes retain every edit event', async () => {
  const home = freshHome();
  const session = 'ground-concurrent';
  const turn = 'turn-concurrent';
  await Promise.all(Array.from({ length: 24 }, (_, index) => runHookAsync(GROUND, {
    session_id: session,
    turn_id: turn,
    hook_event_name: 'PostToolUse',
    tool_name: 'apply_patch',
    tool_input: { command: `*** Update File: src/file-${index}.ts` },
    tool_response: {},
  }, home, ['record'])));
  record(home, session, 'Bash', { command: 'npm test' }, { exit_code: 0 }, turn);
  assert.strictEqual(stop(home, session, receipt, false, 'stop', turn).trim(), '');
  const state = path.join(home, 'dev-rigor-stack', 'state');
  const ledgerName = fs.readdirSync(state).find((name) => name.startsWith('ground-v4-'));
  const lines = fs.readFileSync(path.join(state, ledgerName), 'utf8').trim().split('\n');
  assert.strictEqual(lines.filter((line) => line.startsWith('E ')).length, 24);
  assert.strictEqual(lines.filter((line) => line.startsWith('T ')).length, 1);
  assert.strictEqual(lines.filter((line) => line.startsWith('C ')).length, 1);
});

test('ground: full Codex-shaped nested failure response cannot count as proof', () => {
  const home = freshHome();
  record(home, 'ground-shaped', 'apply_patch', {
    command: '*** Update File: src/app.ts', cwd: 'C:\\repo', timeout_ms: 120000,
  }, { content: [{ type: 'text', text: 'patch applied' }] }, 'turn-shaped');
  record(home, 'ground-shaped', 'shell_command', {
    command: 'npm test', cwd: 'C:\\repo', timeout_ms: 120000,
  }, { content: [{ type: 'text', text: 'Exit code: 1\n1 test failed' }] }, 'turn-shaped');
  const parsed = JSON.parse(stop(home, 'ground-shaped', receipt, false, 'stop', 'turn-shaped'));
  assert.strictEqual(parsed.decision, 'block');
  assert.match(parsed.reason, /latest runnable edit/i);
});

test('ground: a live Codex policy rejection cannot count as proof', () => {
  const home = freshHome();
  record(home, 'ground-policy-rejection', 'apply_patch', {
    command: '*** Update File: src/app.ts',
  }, { content: [{ type: 'text', text: 'patch applied' }] });
  record(home, 'ground-policy-rejection', 'Bash', { command: 'npm test' }, {
    content: [{
      type: 'text',
      text: '`powershell.exe -Command npm test` rejected: blocked by policy',
    }],
  });
  const parsed = JSON.parse(stop(home, 'ground-policy-rejection', receipt));
  assert.strictEqual(parsed.decision, 'block');
  assert.match(parsed.reason, /latest runnable edit/i);
});

test('ground: successful output mentioning error handling cannot be misclassified', () => {
  const home = freshHome();
  record(home, 'ground-success-wording', 'apply_patch', {
    command: '*** Update File: src/app.ts',
  });
  record(home, 'ground-success-wording', 'Bash', { command: 'npm test' }, {
    content: [{ type: 'text', text: 'Error handling tests passed\nExit code: 0' }],
  });
  assert.strictEqual(stop(home, 'ground-success-wording', receipt).trim(), '');
});

test('ground: an explicitly failed execution does not satisfy the gate', () => {
  const home = freshHome();
  record(home, 'ground-failed', 'apply_patch', { command: '*** Update File: src/app.ts' });
  record(home, 'ground-failed', 'Bash', { command: 'npm test' }, { exit_code: 1 });
  const parsed = JSON.parse(stop(home, 'ground-failed', 'proved: npm test - 1 failed · blast: low · skipped: none'));
  assert.strictEqual(parsed.decision, 'block');
  assert.match(parsed.reason, /after the latest runnable edit/i);
});

test('ground: an execution before a trailing edit does not count', () => {
  const home = freshHome();
  record(home, 'ground-3', 'apply_patch', { command: '*** Update File: src/app.ts' });
  record(home, 'ground-3', 'Bash', { command: 'npm test' }, { exit_code: 0 });
  record(home, 'ground-3', 'apply_patch', { command: '*** Update File: src/app.ts' });
  const parsed = JSON.parse(stop(home, 'ground-3', receipt));
  assert.strictEqual(parsed.decision, 'block');
  assert.match(parsed.reason, /latest runnable edit/i);
});

test('ground: successful qualifying proof without the evidence receipt is non-destructive', () => {
  const home = freshHome();
  record(home, 'ground-4', 'apply_patch', { command: '*** Update File: src/main.rs' });
  record(home, 'ground-4', 'Bash', { command: 'cargo test' }, { exit_code: 0 });
  assert.strictEqual(stop(home, 'ground-4', 'All done.').trim(), '');
  const lines = stateLines(home);
  assert.ok(lines.some((line) => line.startsWith('T ')));
  assert.ok(lines.some((line) => line.startsWith('W ') && /missing-receipt/.test(line)));
  assert.ok(lines.some((line) => line.startsWith('C ') && /proof-accepted/.test(line)));
});

test('ground: public documentation edits create an artifact-specific proof demand', () => {
  const home = freshHome();
  record(home, 'ground-5', 'apply_patch', { command: '*** Update File: README.md' });
  const parsed = JSON.parse(stop(home, 'ground-5', ''));
  assert.strictEqual(parsed.decision, 'block');
});

test('ground: inspection commands cannot satisfy proof', () => {
  const home = freshHome();
  record(home, 'ground-inspection', 'apply_patch', { command: '*** Update File: src/app.ts' });
  record(home, 'ground-inspection', 'PowerShell', { command: 'git status' }, { exit_code: 0 });
  const parsed = JSON.parse(stop(home, 'ground-inspection', receipt));
  assert.strictEqual(parsed.decision, 'block');
  assert.ok(stateLines(home).some((line) => line.startsWith('I ')));
});

test('ground: structured failing test result outranks process exit zero', () => {
  const home = freshHome();
  record(home, 'ground-structured-fail', 'apply_patch', { command: '*** Update File: src/app.ts' });
  record(home, 'ground-structured-fail', 'Bash', { command: 'npm test' }, {
    exit_code: 0, test_result: { passed: 4, failed: 1 },
  });
  const parsed = JSON.parse(stop(home, 'ground-structured-fail', receipt));
  assert.strictEqual(parsed.decision, 'block');
  assert.ok(stateLines(home).some((line) => line.startsWith('F ')));
});

test('ground: structured passing test result outranks incidental failure text', () => {
  const home = freshHome();
  record(home, 'ground-structured-pass', 'apply_patch', { command: '*** Update File: src/app.ts' });
  record(home, 'ground-structured-pass', 'Bash', { command: 'npm test' }, {
    exit_code: 0,
    test_result: { passed: 5, failed: 0 },
    content: [{ type: 'text', text: 'fixture: 1 failed is expected by the meta-test' }],
  });
  assert.strictEqual(stop(home, 'ground-structured-pass', receipt).trim(), '');
  assert.ok(stateLines(home).some((line) => line.startsWith('T ')));
});

test('ground: obvious shell writes re-arm proof without storing raw sensitive arguments', () => {
  const home = freshHome();
  const secret = 'super-secret-token-value';
  record(home, 'ground-shell-write', 'PowerShell', {
    command: `Set-Content -LiteralPath src/generated.ts -Value '${secret}'`,
  }, { exit_code: 0 });
  const parsed = JSON.parse(stop(home, 'ground-shell-write', receipt));
  assert.strictEqual(parsed.decision, 'block');
  const raw = stateLines(home).join('\n');
  assert.doesNotMatch(raw, new RegExp(secret));
  assert.doesNotMatch(raw, /Set-Content|generated\.ts/);
});

test('ground: formatter and generator changes use G and require later proof', () => {
  const home = freshHome();
  record(home, 'ground-generated', 'Bash', { command: 'npm run generate' }, {
    exit_code: 0, changed_files: ['src/generated.ts'],
  });
  const parsed = JSON.parse(stop(home, 'ground-generated', receipt));
  assert.strictEqual(parsed.decision, 'block');
  assert.ok(stateLines(home).some((line) => line.startsWith('G ')));
});

test('ground: qualifying evidence token is bound to task, turn, edit set, and result', () => {
  const home = freshHome();
  record(home, 'ground-token', 'apply_patch', { command: '*** Update File: src/app.ts' }, {}, 'turn-a');
  record(home, 'ground-token', 'Bash', { command: 'npm test' }, { exit_code: 0 }, 'turn-a');
  const proof = stateLines(home).find((line) => line.startsWith('T '));
  assert.match(proof || '', /proof-id:[a-f0-9]{16}/);
  assert.match(proof || '', /edit-set:[a-f0-9]{16}/);
  assert.strictEqual(stop(home, 'ground-token', 'proved: proof-id:deadbeefdeadbeef · blast: low · skipped: none', false, 'stop', 'turn-a').trim(), '');
  assert.ok(stateLines(home).some((line) => line.startsWith('W ') && /invalid-proof-id/.test(line)));
});

test('router: exact task controls change only that task and quoted controls do not', () => {
  const home = freshHome();
  const off = JSON.parse(prompt(home, 'control-a', 'DevRigorOFF'));
  assert.match(off.hookSpecificOutput.additionalContext, /mode:\s*OFF/i);
  const quoted = prompt(home, 'control-b', 'The documentation says `DevRigorOFF` disables enforcement.');
  assert.strictEqual(quoted.trim(), '');
  const statusA = JSON.parse(prompt(home, 'control-a', 'DevRigorSTATUS'));
  const statusB = JSON.parse(prompt(home, 'control-b', 'DevRigorSTATUS'));
  assert.match(statusA.hookSpecificOutput.additionalContext, /mode:\s*OFF/i);
  assert.match(statusB.hookSpecificOutput.additionalContext, /mode:\s*ON/i);
});

test('ground: OFF and WARN are task-scoped while ON retains substantive enforcement', () => {
  const home = freshHome();
  prompt(home, 'mode-off', 'DevRigorOFF');
  record(home, 'mode-off', 'apply_patch', { command: '*** Update File: src/off.ts' });
  assert.strictEqual(stop(home, 'mode-off', '').trim(), '');
  assert.strictEqual(stateFiles(home, 'ground-v4-').length, 0);

  prompt(home, 'mode-warn', 'DevRigorWARN');
  record(home, 'mode-warn', 'apply_patch', { command: '*** Update File: src/warn.ts' });
  assert.strictEqual(stop(home, 'mode-warn', '').trim(), '');
  assert.ok(stateLines(home).some((line) => line.startsWith('W ')));

  record(home, 'mode-on', 'apply_patch', { command: '*** Update File: src/on.ts' });
  assert.strictEqual(JSON.parse(stop(home, 'mode-on', '')).decision, 'block');
});

test('ground: stop_hook_active is an anti-loop guard', () => {
  const home = freshHome();
  record(home, 'ground-6', 'apply_patch', { command: '*** Update File: src/app.py' });
  assert.strictEqual(stop(home, 'ground-6', '', true).trim(), '');
});

test('ground: SubagentStop uses the same enforcement contract', () => {
  const home = freshHome();
  record(home, 'ground-7', 'apply_patch', { command: '*** Update File: src/app.py' });
  const parsed = JSON.parse(stop(home, 'ground-7', receipt, false, 'subagent'));
  assert.strictEqual(parsed.decision, 'block');
});

test('ground: garbage input fails open without output', () => {
  const out = execFileSync('node', [GROUND, 'check'], {
    input: '{{{',
    env: { ...process.env, CODEX_HOME: freshHome() },
    encoding: 'utf8',
  });
  assert.strictEqual(out.trim(), '');
});

test('wire: creates every active Codex lifecycle event and is idempotent', () => {
  const home = freshHome();
  execFileSync('node', [WIRE, home, CODEX], { encoding: 'utf8' });
  const first = JSON.parse(fs.readFileSync(path.join(home, 'hooks.json'), 'utf8'));
  for (const event of ['SessionStart', 'SubagentStart', 'UserPromptSubmit', 'PostToolUse', 'Stop', 'SubagentStop']) {
    assert.ok(first.hooks[event]?.length, `missing hooks.${event}`);
  }
  assert.match(JSON.stringify(first.hooks), /Dev Rigor hook integrity check failed/);
  assert.match(JSON.stringify(first.hooks), /createHash/);
  assert.doesNotMatch(JSON.stringify(first.hooks), /CLAUDE_CONFIG_DIR|\.claude/);
  execFileSync('node', [WIRE, home, CODEX], { encoding: 'utf8' });
  const second = JSON.parse(fs.readFileSync(path.join(home, 'hooks.json'), 'utf8'));
  assert.deepStrictEqual(second, first);
});

test('wire: trusted definition executes exact bytes and refuses a changed runtime file', () => {
  const home = freshHome();
  const runtime = path.join(tmpRoot, `integrity-runtime-${serial}`);
  fs.cpSync(CODEX, runtime, { recursive: true });
  execFileSync('node', [WIRE, home, runtime], { encoding: 'utf8' });
  const configured = JSON.parse(fs.readFileSync(path.join(home, 'hooks.json'), 'utf8'));
  const command = configured.hooks.SessionStart[0].hooks[0].command;
  assert.match(command, /_compile\(b\.toString\(\),f\)/);
  assert.doesNotMatch(command, /require\(f\)/);
  const input = JSON.stringify({ hook_event_name: 'SessionStart' });
  const output = execSync(command, {
    input,
    encoding: 'utf8',
    shell: true,
    env: { ...process.env, CODEX_HOME: home },
  });
  assert.match(output, /DEV-RIGOR CORE ACTIVE/);
  fs.appendFileSync(path.join(runtime, 'hooks', 'dev-rigor-activate.js'), '\n// tampered after trust\n');
  assert.throws(() => execSync(command, {
    input,
    encoding: 'utf8',
    shell: true,
    env: { ...process.env, CODEX_HOME: home },
    stdio: 'pipe',
  }), /integrity check failed/i);
});

test('wire: preserves foreign hooks while replacing an existing owned entry', () => {
  const home = freshHome();
  const ownedCommand = `node "${path.join(CODEX, 'hooks', 'dev-rigor-ground.js')}" check`;
  fs.writeFileSync(path.join(home, 'hooks.json'), JSON.stringify({
    hooks: {
      Stop: [
        { hooks: [{ type: 'command', command: 'node foreign-stop.js' }] },
        { hooks: [{ type: 'command', command: ownedCommand }], matcher: 'stale-matcher' },
      ],
    },
  }));
  execFileSync('node', [WIRE, home, CODEX], { encoding: 'utf8' });
  const parsed = JSON.parse(fs.readFileSync(path.join(home, 'hooks.json'), 'utf8'));
  assert.match(JSON.stringify(parsed.hooks.Stop), /foreign-stop/);
  assert.strictEqual(parsed.hooks.Stop.length, 2);
  assert.strictEqual(parsed.hooks.Stop.filter((entry) => JSON.stringify(entry).includes('integrity check failed')).length, 1);
  assert.doesNotMatch(JSON.stringify(parsed.hooks.Stop), /stale-matcher/);
});

test('wire: preserves a foreign hook that uses a managed-looking filename', () => {
  const home = freshHome();
  const foreignRoot = path.join(tmpRoot, 'foreign-runtime');
  const target = path.join(home, 'hooks.json');
  const foreignCommand = `node "${path.join(foreignRoot, 'hooks', 'dev-rigor-ground.js')}" check`;
  fs.writeFileSync(target, JSON.stringify({
    hooks: { Stop: [{ hooks: [{ type: 'command', command: foreignCommand }] }] },
  }));
  execFileSync('node', [WIRE, home, CODEX], { encoding: 'utf8' });
  const wired = JSON.parse(fs.readFileSync(target, 'utf8'));
  assert.ok(wired.hooks.Stop.some((entry) => entry.hooks?.[0]?.command === foreignCommand));
  execFileSync('node', [WIRE, '--remove', home, CODEX], { encoding: 'utf8' });
  const removed = JSON.parse(fs.readFileSync(target, 'utf8'));
  assert.ok(removed.hooks.Stop.some((entry) => entry.hooks?.[0]?.command === foreignCommand));
});

test('wire: refuses corrupt hooks.json and leaves it byte-identical', () => {
  const home = freshHome();
  const target = path.join(home, 'hooks.json');
  const corrupt = '{"hooks": [}';
  fs.writeFileSync(target, corrupt);
  assert.throws(() => execFileSync('node', [WIRE, home, CODEX], { encoding: 'utf8', stdio: 'pipe' }));
  assert.strictEqual(fs.readFileSync(target, 'utf8'), corrupt);
});

test('wire: preflight validates configuration without writing it', () => {
  const cleanHome = freshHome();
  const out = execFileSync('node', [WIRE, '--check', cleanHome, CODEX], { encoding: 'utf8' });
  assert.match(out, /preflight/i);
  assert.strictEqual(fs.existsSync(path.join(cleanHome, 'hooks.json')), false);

  const corruptHome = freshHome();
  const target = path.join(corruptHome, 'hooks.json');
  fs.writeFileSync(target, '{bad json');
  assert.throws(() => execFileSync('node', [WIRE, '--check', corruptHome, CODEX], { encoding: 'utf8', stdio: 'pipe' }));
  assert.strictEqual(fs.readFileSync(target, 'utf8'), '{bad json');
});

test('wire: remove deletes only owned entries and preserves foreign hooks', () => {
  const home = freshHome();
  execFileSync('node', [WIRE, home, CODEX], { encoding: 'utf8' });
  const target = path.join(home, 'hooks.json');
  const configured = JSON.parse(fs.readFileSync(target, 'utf8'));
  configured.hooks.Stop.push({ hooks: [{ type: 'command', command: 'node foreign.js' }] });
  fs.writeFileSync(target, JSON.stringify(configured, null, 2));
  execFileSync('node', [WIRE, '--remove', home, CODEX], { encoding: 'utf8' });
  const removed = JSON.parse(fs.readFileSync(target, 'utf8'));
  assert.match(JSON.stringify(removed), /foreign\.js/);
  assert.doesNotMatch(JSON.stringify(removed), /dev-rigor-(activate|router|ground)/);
});

test('revoke-trust: removes owned hashes and preserves foreign trust state', () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, 'revoke-trust.js'), '--self-test'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /owned state removed and foreign state preserved/);
});

(async () => {
  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`  ok    ${name}`);
    } catch (error) {
      failed++;
      console.error(`  FAIL  ${name}`);
      console.error(error.stack || error);
    }
  }
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  if (failed) {
    console.error(`\n${failed}/${tests.length} FAILED`);
    process.exit(1);
  }
  console.log(`\nALL PASS (${tests.length} tests)`);
})();
