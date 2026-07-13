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

const receipt = 'proved: pytest -q - 12 passed · blast: medium · skipped: none';
const tests = [];
function test(name, fn) { tests.push([name, fn]); }

test('activate: SessionStart injects the complete reflex through Codex JSON', () => {
  const out = runHook(ACTIVATE, { hook_event_name: 'SessionStart' }, freshHome());
  const parsed = JSON.parse(out);
  assert.strictEqual(parsed.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(parsed.hookSpecificOutput.additionalContext, /DEV-RIGOR REFLEX ACTIVE/);
  assert.match(parsed.hookSpecificOutput.additionalContext, /proved:/);
});

test('activate: SubagentStart injects the same reflex', () => {
  const out = runHook(ACTIVATE, { hook_event_name: 'SubagentStart' }, freshHome(), ['subagent']);
  const parsed = JSON.parse(out);
  assert.strictEqual(parsed.hookSpecificOutput.hookEventName, 'SubagentStart');
  assert.match(parsed.hookSpecificOutput.additionalContext, /DEV-RIGOR REFLEX ACTIVE/);
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

test('ground: a blocked response cannot loop and the next real prompt starts clean', () => {
  const home = freshHome();
  record(home, 'ground-retry', 'apply_patch', { command: '*** Update File: src/app.ts' });
  record(home, 'ground-retry', 'Bash', { command: 'npm test' }, { exit_code: 0 });
  const blocked = JSON.parse(stop(home, 'ground-retry', 'All done.'));
  assert.strictEqual(blocked.decision, 'block');
  assert.strictEqual(stop(home, 'ground-retry', 'The hook requested a receipt.', true).trim(), '');
  prompt(home, 'ground-retry', 'Explain what happened without changing anything.');
  assert.strictEqual(stop(home, 'ground-retry', 'The prior coding response omitted its receipt.').trim(), '');
});

test('ground: the same turn is blocked at most once when Codex omits stop_hook_active', () => {
  const home = freshHome();
  record(home, 'ground-circuit', 'apply_patch', { command: '*** Update File: src/app.ts' });
  record(home, 'ground-circuit', 'Bash', { command: 'npm test' }, { exit_code: 0 });
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
  const second = JSON.parse(stop(home, 'ground-rearm-after-block', 'Done without a receipt.'));
  assert.strictEqual(second.decision, 'block');
  assert.match(second.reason, /evidence receipt/i);
  assert.strictEqual(stop(home, 'ground-rearm-after-block', 'Hook feedback retry.').trim(), '');
});

test('ground: missing turn_id fails open and creates no active ledger', () => {
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
  assert.strictEqual(fs.existsSync(state) && fs.readdirSync(state).some((name) => name.startsWith('ground-v3-')), false);
});

test('ground: inability to persist a block fails open instead of creating a retry loop', () => {
  const home = freshHome();
  record(home, 'ground-read-only', 'apply_patch', { command: '*** Update File: src/app.ts' });
  const state = path.join(home, 'dev-rigor-stack', 'state');
  const ledgerName = fs.readdirSync(state).find((name) => name.startsWith('ground-v3-'));
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
    .filter((name) => name.startsWith('ground-v3-'));
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
  const ledgerName = fs.readdirSync(state).find((name) => name.startsWith('ground-v3-'));
  const lines = fs.readFileSync(path.join(state, ledgerName), 'utf8').trim().split('\n');
  assert.strictEqual(lines.filter((line) => line.startsWith('E ')).length, 24);
  assert.strictEqual(lines.filter((line) => line.startsWith('X ')).length, 1);
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

test('ground: successful execution without the evidence receipt still blocks', () => {
  const home = freshHome();
  record(home, 'ground-4', 'apply_patch', { command: '*** Update File: src/main.rs' });
  record(home, 'ground-4', 'Bash', { command: 'cargo test' }, { exit_code: 0 });
  const parsed = JSON.parse(stop(home, 'ground-4', 'All done.'));
  assert.strictEqual(parsed.decision, 'block');
  assert.match(parsed.reason, /evidence receipt/i);
});

test('ground: documentation-only edits do not create a runtime-proof demand', () => {
  const home = freshHome();
  record(home, 'ground-5', 'apply_patch', { command: '*** Update File: README.md' });
  assert.strictEqual(stop(home, 'ground-5', '').trim(), '');
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
  assert.match(output, /DEV-RIGOR REFLEX ACTIVE/);
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
