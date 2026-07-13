#!/usr/bin/env node
// Hermetic contract suite for the active Codex hook runtime.

const assert = require('assert');
const { execFileSync, execSync, spawnSync } = require('child_process');
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

function record(home, session, toolName, toolInput, toolResponse = {}) {
  return runHook(GROUND, {
    session_id: session,
    hook_event_name: 'PostToolUse',
    tool_name: toolName,
    tool_input: toolInput,
    tool_response: toolResponse,
  }, home, ['record']);
}

function stop(home, session, message = '', active = false, mode = 'stop') {
  return runHook(GROUND, {
    session_id: session,
    hook_event_name: mode === 'subagent' ? 'SubagentStop' : 'Stop',
    stop_hook_active: active,
    last_assistant_message: message,
  }, home, ['check']);
}

function prompt(home, session, message) {
  return runHook(ROUTER, {
    session_id: session,
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

test('ground: a new user prompt scopes out unresolved edits from an older turn', () => {
  const home = freshHome();
  record(home, 'ground-turn', 'apply_patch', { command: '*** Update File: src/app.ts' });
  prompt(home, 'ground-turn', 'What is the current project status?');
  assert.strictEqual(stop(home, 'ground-turn', 'Here is the read-only status report.').trim(), '');
});

test('ground: an edit after the current prompt boundary still requires proof', () => {
  const home = freshHome();
  prompt(home, 'ground-current-turn', 'Please update src/app.ts for me.');
  record(home, 'ground-current-turn', 'apply_patch', { command: '*** Update File: src/app.ts' });
  const parsed = JSON.parse(stop(home, 'ground-current-turn', receipt));
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

test('ground: legacy 1.6.1 ledgers remain audit history and cannot poison 1.6.2 turns', () => {
  const home = freshHome();
  const state = path.join(home, 'dev-rigor-stack', 'state');
  fs.mkdirSync(state, { recursive: true });
  fs.writeFileSync(path.join(state, 'ground-ground-legacy.log'), 'E src/old.ts\nX Bash\n');
  assert.strictEqual(stop(home, 'ground-legacy', 'Ordinary conversation.').trim(), '');
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
