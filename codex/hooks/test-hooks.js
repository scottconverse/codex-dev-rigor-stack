#!/usr/bin/env node
// Hermetic contract suite for the active Codex hook runtime.

const assert = require('assert');
const { execFileSync, execSync, spawn, spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOOKS = __dirname;
const CODEX = path.join(HOOKS, '..');
const ACTIVATE = path.join(HOOKS, 'dev-rigor-activate.js');
const ROUTER = path.join(HOOKS, 'dev-rigor-router.js');
const GROUND = path.join(HOOKS, 'dev-rigor-ground.js');
const WIRE = path.join(HOOKS, 'wire-hooks.js');
const REVOKER = require(path.join(HOOKS, 'revoke-trust.js'));

for (const required of [ACTIVATE, ROUTER, GROUND, WIRE, path.join(CODEX, 'dev-rigor-reflex.md')]) {
  assert.ok(fs.existsSync(required), `missing active Codex hook artifact: ${required}`);
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-dev-rigor-hooks-'));
let serial = 0;
let toolSerial = 0;
const unitRepo = path.join(tmpRoot, 'unit-repo');
fs.mkdirSync(unitRepo, { recursive: true });
execFileSync('git', ['init', '--quiet'], { cwd: unitRepo });

function freshHome() {
  const dir = path.join(tmpRoot, `home-${++serial}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function freshGitRepo(files = [['src/app.ts', 'export const value = 1;\n']]) {
  const dir = path.join(tmpRoot, `repo-${++serial}`);
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, contents] of files) {
    const target = path.join(dir, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
  }
  execFileSync('git', ['init', '--quiet'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'hooks@example.invalid'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Hook Tests'], { cwd: dir });
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['commit', '--quiet', '-m', 'fixture'], { cwd: dir });
  return dir;
}

function runHook(script, input, home, args = [], extraEnvironment = {}) {
  return execFileSync('node', [script, ...args], {
    input: JSON.stringify(input),
    env: { ...process.env, ...extraEnvironment, CODEX_HOME: home },
    encoding: 'utf8',
  });
}

function stateHash(...values) {
  const digest = crypto.createHash('sha256');
  for (const value of values) digest.update(String(value)).update('\0');
  return digest.digest('hex');
}

function taskStatePath(home, session) {
  return path.join(home, 'dev-rigor-stack', 'state', `task-v4-${stateHash(session)}.json`);
}

function ensureActivated(home, session) {
  if (fs.existsSync(taskStatePath(home, session))) return;
  runHook(ACTIVATE, { session_id: session, hook_event_name: 'SessionStart' }, home);
}

function inferredSyntheticExit(response) {
  const codes = [];
  let structuredPass = false;
  let structuredFail = false;
  const visit = (value, key = '') => {
    if (typeof value === 'string') {
      for (const match of value.matchAll(/(?:exit(?:ed)?(?:\s+with)?(?:\s+code)?|status)\s*[:=]?\s*(-?\d+)/ig)) {
        codes.push(Number(match[1]));
      }
      if (/\b[1-9]\d*\s+(?:tests?\s+)?failed\b/i.test(value)) structuredFail = true;
      if (/\b[1-9]\d*\s+(?:tests?\s+)?passed\b/i.test(value)) structuredPass = true;
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [childKey, child] of Object.entries(value)) {
      if (/^(?:exit_code|exitCode)$/.test(childKey) && Number.isInteger(child)) codes.push(child);
      if (/^(?:test_result|testResult|test_results|testResults|build_result|buildResult|build_results|buildResults)$/.test(childKey) && child && typeof child === 'object') {
        if (Number.isFinite(child.failed) && child.failed > 0 || child.success === false || child.passed === false) structuredFail = true;
        if (Number.isFinite(child.passed) && child.passed > 0 || child.success === true || child.passed === true) structuredPass = true;
      }
      visit(child, childKey);
    }
  };
  visit(response);
  if (codes.some((code) => code !== 0) || structuredFail) return 1;
  if (codes.includes(0) || structuredPass) return 0;
  return null;
}

function synthesizeExecutionReceipt(home, session, turn, toolUseId, response) {
  const code = inferredSyntheticExit(response);
  if (code === null) return;
  const state = path.join(home, 'dev-rigor-stack', 'state');
  const snapshot = path.join(state, `pre-v4-${stateHash(session, turn, toolUseId)}.json`);
  if (!fs.existsSync(snapshot)) return;
  const before = JSON.parse(fs.readFileSync(snapshot, 'utf8'));
  if (!/^[a-f0-9]{32}$/.test(before.executionNonce || '')) return;
  // Unit helpers use shaped fake tool responses for result-precedence tests.
  // Reproduce the correlated receipt a genuinely executed wrapped command would
  // create; adversarial missing-receipt tests call preTool/postTool directly.
  fs.writeFileSync(
    path.join(state, `exec-v4-${stateHash(session, turn, toolUseId)}.receipt`),
    `${before.executionNonce}:${code}`
  );
}

const appendFaultPreload = path.join(tmpRoot, 'append-fault-preload.js');
fs.writeFileSync(appendFaultPreload, [
  "const fs = require('fs');",
  'const original = fs.appendFileSync.bind(fs);',
  'fs.appendFileSync = function(target, data, ...args) {',
  "  const prefix = process.env.DEV_RIGOR_TEST_FAIL_APPEND_PREFIX || '';",
  "  if (prefix && String(data).startsWith(prefix + ' ')) {",
  "    const error = new Error('injected append failure'); error.code = 'EIO'; throw error;",
  '  }',
  '  return original(target, data, ...args);',
  '};',
].join('\n'));

const taskRenameFaultPreload = path.join(tmpRoot, 'task-rename-fault-preload.js');
fs.writeFileSync(taskRenameFaultPreload, [
  "const fs = require('fs');",
  "const path = require('path');",
  'const original = fs.renameSync.bind(fs);',
  'let failed = false;',
  'fs.renameSync = function(source, target) {',
  "  if (!failed && process.env.DEV_RIGOR_TEST_FAIL_TASK_RENAME === '1' && /^task-v4-[a-f0-9]{64}\\.json$/.test(path.basename(String(target)))) {",
  '    failed = true;',
  "    const error = new Error('injected first task rename failure'); error.code = 'EIO'; throw error;",
  '  }',
  '  return original(source, target);',
  '};',
].join('\n'));

function runHookWithAppendFailure(script, input, home, prefix, args = []) {
  return execFileSync('node', ['--require', appendFaultPreload, script, ...args], {
    input: JSON.stringify(input),
    env: { ...process.env, CODEX_HOME: home, DEV_RIGOR_TEST_FAIL_APPEND_PREFIX: prefix },
    encoding: 'utf8',
  });
}

function runActivationWithTaskRenameFailure(input, home) {
  return execFileSync('node', ['--require', taskRenameFaultPreload, ACTIVATE], {
    input: JSON.stringify(input),
    env: { ...process.env, CODEX_HOME: home, DEV_RIGOR_TEST_FAIL_TASK_RENAME: '1' },
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

function record(home, session, toolName, toolInput, toolResponse = {}, turn = 'turn-1', extraEnvironment = {}) {
  ensureActivated(home, session);
  const toolUseId = `unit-tool-${++toolSerial}`;
  const cwd = toolInput && typeof toolInput.cwd === 'string' ? toolInput.cwd : unitRepo;
  if (!/^(?:apply_patch|Edit|Write|MultiEdit|NotebookEdit)$/i.test(toolName)) {
    runHook(GROUND, {
      session_id: session,
      turn_id: turn,
      hook_event_name: 'PreToolUse',
      tool_use_id: toolUseId,
      cwd,
      tool_name: toolName,
      tool_input: toolInput,
    }, home, ['snapshot'], extraEnvironment);
    synthesizeExecutionReceipt(home, session, turn, toolUseId, toolResponse);
  }
  return runHook(GROUND, {
    session_id: session,
    turn_id: turn,
    hook_event_name: 'PostToolUse',
    tool_use_id: toolUseId,
    cwd,
    tool_name: toolName,
    tool_input: toolInput,
    tool_response: toolResponse,
  }, home, ['record'], extraEnvironment);
}

function preTool(home, session, toolName, toolInput, cwd, toolUseId = 'tool-1', turn = 'turn-1', extraEnvironment = {}) {
  ensureActivated(home, session);
  return runHook(GROUND, {
    session_id: session,
    turn_id: turn,
    hook_event_name: 'PreToolUse',
    tool_use_id: toolUseId,
    cwd,
    tool_name: toolName,
    tool_input: toolInput,
  }, home, ['snapshot'], extraEnvironment);
}

function postTool(home, session, toolName, toolInput, toolResponse, cwd, toolUseId = 'tool-1', turn = 'turn-1', extraEnvironment = {}) {
  return runHook(GROUND, {
    session_id: session,
    turn_id: turn,
    hook_event_name: 'PostToolUse',
    tool_use_id: toolUseId,
    cwd,
    tool_name: toolName,
    tool_input: toolInput,
    tool_response: toolResponse,
  }, home, ['record'], extraEnvironment);
}

function executeWrapped(command, cwd, extraEnvironment = {}) {
  const env = { ...process.env, ...extraEnvironment };
  return process.platform === 'win32'
    ? spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], { cwd, env, encoding: 'utf8' })
    : spawnSync('bash', ['-lc', command], { cwd, env, encoding: 'utf8' });
}

function stop(home, session, message = '', active = false, mode = 'stop', turn = 'turn-1', cwd = unitRepo) {
  ensureActivated(home, session);
  return runHook(GROUND, {
    session_id: session,
    turn_id: turn,
    cwd,
    hook_event_name: mode === 'subagent' ? 'SubagentStop' : 'Stop',
    stop_hook_active: active,
    last_assistant_message: message,
  }, home, ['check']);
}

function expectSystemMessage(output, pattern) {
  const parsed = JSON.parse(output);
  assert.match(parsed.systemMessage, pattern);
  return parsed;
}

function prompt(home, session, message, turn = 'turn-1') {
  ensureActivated(home, session);
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

function taskStateForSession(home, session) {
  const key = crypto.createHash('sha256').update(session).update('\0').digest('hex');
  return JSON.parse(fs.readFileSync(path.join(home, 'dev-rigor-stack', 'state', `task-v4-${key}.json`), 'utf8'));
}

function expectedArtifactId(cwd, name) {
  let normalized = path.resolve(cwd, name).replace(/\\/g, '/');
  normalized = path.posix.normalize(normalized);
  if (process.platform === 'win32') normalized = normalized.toLowerCase();
  return crypto.createHash('sha256').update(normalized).update('\0').digest('hex').slice(0, 16);
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
  ensureActivated(home, 'bound-parent');
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

test('router/activate: route state uses exact task identity and cannot collide after sanitization', () => {
  const home = freshHome();
  prompt(home, 'route/a', 'Fix the parser crash and prove the regression.', 'route-turn');
  const routed = runHook(ACTIVATE, { session_id: 'route/a', hook_event_name: 'SessionStart' }, home);
  const unrelated = runHook(ACTIVATE, { session_id: 'routea', hook_event_name: 'SessionStart' }, home);
  assert.match(routed, /INVESTIGATION PROTOCOL/);
  assert.doesNotMatch(unrelated, /INVESTIGATION PROTOCOL/);
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
  expectSystemMessage(stop(home, 'ground-retry', 'The hook requested a receipt.', true), /proof debt remains unresolved/i);
  assert.ok(stateLines(home).some((line) => line.startsWith('U ')), 'circuit release must record unresolved proof');
  const status = JSON.parse(prompt(home, 'ground-retry', 'DevRigorSTATUS'));
  assert.match(status.hookSpecificOutput.additionalContext, /unresolved proof:\s*yes/i);
});

test('ground: proof resolves debt only for the same or a verified superseding edit set', () => {
  const home = freshHome();
  record(home, 'ground-debt-superset', 'apply_patch', { command: '*** Update File: src/app.ts' }, {}, 'turn-debt');
  assert.strictEqual(JSON.parse(stop(home, 'ground-debt-superset', 'Done.', false, 'stop', 'turn-debt')).decision, 'block');
  expectSystemMessage(stop(home, 'ground-debt-superset', 'Released after the one-block circuit.', true, 'stop', 'turn-debt'), /proof debt remains unresolved/i);
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
  expectSystemMessage(stop(home, 'ground-circuit', 'Explanation after hook feedback.'), /proof debt remains unresolved/i);
  assert.strictEqual(stop(home, 'ground-circuit', 'Later conversation in the same turn.').trim(), '');
  const state = path.join(home, 'dev-rigor-stack', 'state');
  const ledgerName = fs.readdirSync(state).find((name) => name.startsWith('ground-v4-'));
  const lines = fs.readFileSync(path.join(state, ledgerName), 'utf8').trim().split('\n');
  assert.strictEqual(lines.filter((line) => line.startsWith('U ')).length, 1, 'turn should be released at most once in ledger');
});

test('ground: stop_hook_active clears a prior block instead of leaving poison state', () => {
  const home = freshHome();
  record(home, 'ground-active-clear', 'apply_patch', { command: '*** Update File: src/app.ts' });
  const first = JSON.parse(stop(home, 'ground-active-clear', receipt));
  assert.strictEqual(first.decision, 'block');
  expectSystemMessage(stop(home, 'ground-active-clear', 'Hook continuation.', true), /proof debt remains unresolved/i);
  assert.strictEqual(stop(home, 'ground-active-clear', 'Ordinary follow-up in the same turn.').trim(), '');
});

test('ground: stop_hook_active without a prior block does not silently clear dirty work', () => {
  const home = freshHome();
  record(home, 'ground-active-no-block', 'apply_patch', { command: '*** Update File: src/app.ts' });
  expectSystemMessage(stop(home, 'ground-active-no-block', 'Platform retry.', true), /released.*proof debt remains unresolved|proof debt remains unresolved/i);
  const parsed = JSON.parse(stop(home, 'ground-active-no-block', receipt));
  assert.strictEqual(parsed.decision, 'block');
  assert.match(parsed.reason, /latest runnable edit/i);
});

test('ground: a first stop_hook_active release records debt instead of losing enforcement', () => {
  const home = freshHome();
  const session = 'ground-active-first-release';
  record(home, session, 'apply_patch', { command: '*** Update File: src/app.ts' });
  const output = stop(home, session, 'Another Stop hook is already active.', true);
  expectSystemMessage(output, /released.*proof debt remains unresolved|proof debt.*release-blocking/i);
  const task = taskStateForSession(home, session);
  assert.strictEqual(task.dirtyEdits.length, 1);
  assert.strictEqual(task.unresolved.length, 1);
  assert.strictEqual(task.blockCount, 0);
  assert.ok(stateLines(home).some((line) => line.startsWith('U ')));
  const status = JSON.parse(prompt(home, session, 'DevRigorSTATUS'));
  assert.match(status.hookSpecificOutput.additionalContext, /unresolved proof:\s*yes/i);
});

test('ground: proof after a block can resolve the current turn without a second block', () => {
  const home = freshHome();
  record(home, 'ground-rearm-after-block', 'apply_patch', { command: '*** Update File: src/app.ts' });
  const first = JSON.parse(stop(home, 'ground-rearm-after-block', receipt));
  assert.strictEqual(first.decision, 'block');
  record(home, 'ground-rearm-after-block', 'Bash', { command: 'npm test' }, { exit_code: 0 });
  expectSystemMessage(stop(home, 'ground-rearm-after-block', 'Done without a receipt.', true), /optional evidence receipt was missing/i);
  assert.ok(stateLines(home).some((line) => line.startsWith('W ') && /missing-receipt/.test(line)));
  assert.ok(stateLines(home).some((line) => line.startsWith('C ')), 'post-block proof did not checkpoint under stop_hook_active');
  assert.strictEqual(taskState(home).unresolved.length, 0, 'post-block proof did not clear matching debt');
});

test('ground: inspection or another unproved edit after a block cannot cause a second block', () => {
  const home = freshHome();
  record(home, 'ground-one-block-tools', 'apply_patch', { command: '*** Update File: src/app.ts' });
  assert.strictEqual(JSON.parse(stop(home, 'ground-one-block-tools', 'Done.')).decision, 'block');
  record(home, 'ground-one-block-tools', 'Bash', { command: 'git status --short' }, { exit_code: 0 });
  record(home, 'ground-one-block-tools', 'apply_patch', { command: '*** Update File: src/helper.ts' });
  expectSystemMessage(stop(home, 'ground-one-block-tools', 'Still unproved.'), /proof debt remains unresolved/i);
  const lines = stateLines(home);
  assert.strictEqual(lines.filter((line) => line.startsWith('K ')).length, 1);
  assert.ok(lines.some((line) => line.startsWith('U ')), 'the non-destructive release must remain visible');
  const debts = taskState(home).unresolved;
  assert.strictEqual(debts.length, 2, 'the original and superseding unproved edit sets must remain visible');
  assert.ok(debts.some((debt) => debt.edits.length === 2), 'the superseding debt must contain both affected edits');
});

test('ground: missing turn_id fails open, creates no ledger, and warns once on the task', () => {
  const home = freshHome();
  ensureActivated(home, 'ground-no-turn');
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

test('ground: retention preserves immutable task genesis under expiry and budget pressure', () => {
  const home = freshHome();
  const session = 'retention-task-genesis';
  const state = path.join(home, 'dev-rigor-stack', 'state');
  record(home, session, 'apply_patch', { command: '*** Update File: src/active.ts' });
  const genesis = path.join(state, `task-genesis-v4-${stateHash(session)}.json`);
  assert.ok(fs.existsSync(genesis), 'activation did not create immutable task genesis');
  const original = fs.readFileSync(genesis);
  const old = new Date(Date.now() - 8 * 24 * 3600 * 1000);
  fs.utimesSync(genesis, old, old);
  for (let index = 0; index < 6; index++) {
    fs.writeFileSync(path.join(state, `ground-v4-genesis-pressure-${index}.log`), Buffer.alloc(1024 * 1024, index));
  }
  record(home, 'retention-genesis-pruner', 'apply_patch', { command: '*** Update File: src/pruner.ts' });
  assert.ok(fs.existsSync(genesis), 'retention erased immutable task genesis');
  assert.deepStrictEqual(fs.readFileSync(genesis), original, 'retention changed immutable task genesis');
  const status = JSON.parse(prompt(home, session, 'DevRigorSTATUS')).hookSpecificOutput.additionalContext;
  assert.doesNotMatch(status, /task[- ]state-(?:missing|corrupt)|genesis.*(?:missing|corrupt)/i);
});

test('ground: retention cannot delete another invocation active PreToolUse snapshot', () => {
  const home = freshHome();
  preTool(home, 'snapshot-owner', 'Bash', { command: 'npm test' }, unitRepo, 'active-snapshot', 'snapshot-turn');
  const state = path.join(home, 'dev-rigor-stack', 'state');
  const snapshot = fs.readdirSync(state).find((name) => name.startsWith('pre-v4-'));
  assert.ok(snapshot);
  for (let index = 0; index < 6; index++) fs.writeFileSync(path.join(state, `ground-v4-pressure-${index}.log`), Buffer.alloc(1024 * 1024, index));
  record(home, 'snapshot-pruner', 'apply_patch', { command: '*** Update File: src/pruner.ts' });
  assert.ok(fs.existsSync(path.join(state, snapshot)), 'fresh in-flight snapshot was pruned under the state budget');
});

test('ground: retention preserves the exact ledger referenced by unresolved proof debt', () => {
  const home = freshHome();
  const session = 'retention-unresolved-ledger';
  const turn = 'turn-retention-unresolved';
  record(home, session, 'apply_patch', { command: '*** Update File: src/app.ts' }, {}, turn);
  assert.strictEqual(JSON.parse(stop(home, session, 'Done.', false, 'stop', turn)).decision, 'block');
  const state = path.join(home, 'dev-rigor-stack', 'state');
  const ledgerId = crypto.createHash('sha256').update(session).update('\0').update(turn).update('\0').digest('hex');
  const ledger = path.join(state, `ground-v4-${ledgerId}.log`);
  const old = new Date(Date.now() - 8 * 24 * 3600 * 1000);
  fs.utimesSync(ledger, old, old);
  for (let index = 0; index < 6; index++) fs.writeFileSync(path.join(state, `ground-v4-unresolved-pressure-${index}.log`), Buffer.alloc(1024 * 1024, index));

  record(home, 'retention-unresolved-pruner', 'apply_patch', { command: '*** Update File: src/pruner.ts' });
  assert.ok(fs.existsSync(ledger), 'retention erased the ledger that proves unresolved debt');
  assert.match(fs.readFileSync(ledger, 'utf8'), /^E |\nK /m);
});

test('ground: retention preserves the accepted ledger bound to the current checkpoint', () => {
  const home = freshHome();
  const session = 'retention-checkpoint-ledger';
  const turn = 'turn-retention-checkpoint';
  record(home, session, 'apply_patch', { command: '*** Update File: src/app.ts' }, {}, turn);
  record(home, session, 'Bash', { command: 'npm test' }, { exit_code: 0 }, turn);
  assert.strictEqual(stop(home, session, receipt, false, 'stop', turn).trim(), '');
  const task = taskStateForSession(home, session);
  assert.strictEqual(task.checkpoint, 1);
  const state = path.join(home, 'dev-rigor-stack', 'state');
  const ledgerId = crypto.createHash('sha256').update(session).update('\0').update(turn).update('\0').digest('hex');
  const ledger = path.join(state, `ground-v4-${ledgerId}.log`);
  const old = new Date(Date.now() - 8 * 24 * 3600 * 1000);
  fs.utimesSync(ledger, old, old);
  for (let index = 0; index < 6; index++) fs.writeFileSync(path.join(state, `ground-v4-checkpoint-pressure-${index}.log`), Buffer.alloc(1024 * 1024, index));

  record(home, 'retention-checkpoint-pruner', 'apply_patch', { command: '*** Update File: src/pruner.ts' });
  assert.ok(fs.existsSync(ledger), 'retention erased the ledger bound to the current accepted checkpoint');
  assert.match(fs.readFileSync(ledger, 'utf8'), /^C proof-accepted/m);
});

test('ground: state permissions are owner-only on POSIX', () => {
  if (process.platform === 'win32') return;
  const home = freshHome();
  record(home, 'permissions', 'apply_patch', { command: '*** Update File: src/app.ts' });
  const state = path.join(home, 'dev-rigor-stack', 'state');
  assert.strictEqual(fs.statSync(state).mode & 0o777, 0o700);
  for (const name of fs.readdirSync(state)) assert.strictEqual(fs.statSync(path.join(state, name)).mode & 0o777, 0o600);
});

test('ground: inability to persist a block visibly fails open instead of creating a retry loop', () => {
  const home = freshHome();
  record(home, 'ground-read-only', 'apply_patch', { command: '*** Update File: src/app.ts' });
  const state = path.join(home, 'dev-rigor-stack', 'state');
  const ledgerName = fs.readdirSync(state).find((name) => name.startsWith('ground-v4-'));
  const ledger = path.join(state, ledgerName);
  fs.chmodSync(ledger, 0o444);
  try {
    const output = JSON.parse(stop(home, 'ground-read-only', receipt));
    assert.match(output.systemMessage, /block could not persist.*proof and mechanical debt .*release-blocking/i);
    const task = taskStateForSession(home, 'ground-read-only');
    assert.ok(task.dirtyEdits.length, 'failed persistence erased the dirty edit');
    assert.ok(task.unresolved.length, 'failed persistence erased proof debt');
  } finally {
    fs.chmodSync(ledger, 0o666);
  }
});

test('ground: a corrupt task state is preserved and visibly fails open', () => {
  const home = freshHome();
  const session = 'ground-corrupt-task';
  record(home, session, 'apply_patch', { command: '*** Update File: src/original.ts' });
  const key = crypto.createHash('sha256').update(session).update('\0').digest('hex');
  const target = path.join(home, 'dev-rigor-stack', 'state', `task-v4-${key}.json`);
  const corrupt = '{"version":4,"mode":';
  fs.writeFileSync(target, corrupt);
  const output = record(home, session, 'apply_patch', { command: '*** Update File: src/later.ts' });
  assert.match(output, /systemMessage/);
  assert.match(output, /task-state-corrupt/);
  assert.strictEqual(fs.readFileSync(target, 'utf8'), corrupt);
  assert.ok(stateFiles(home, `mechanical-v4-${key}`).length > 0);
});

test('ground: deleted task state cannot be recreated as clean by a later hook event', () => {
  const home = freshHome();
  const session = 'ground-deleted-task';
  const key = crypto.createHash('sha256').update(session).update('\0').digest('hex');
  runHook(ACTIVATE, { session_id: session, hook_event_name: 'SessionStart' }, home);
  record(home, session, 'apply_patch', { command: '*** Update File: src/app.ts' }, {}, 'edit-turn');
  const target = path.join(home, 'dev-rigor-stack', 'state', `task-v4-${key}.json`);
  fs.unlinkSync(target);
  const output = runHook(GROUND, {
    session_id: session, turn_id: 'later-turn', cwd: unitRepo, hook_event_name: 'Stop',
    stop_hook_active: false, last_assistant_message: 'Status report.',
  }, home, ['check']);
  expectSystemMessage(output, /task[- ]state.*missing|missing.*task[- ]state/i);
  assert.ok(!fs.existsSync(target), 'missing task state was synthesized during a later hook event');
  assert.ok(stateLines(home, `mechanical-v4-${key}`).some((line) => /reason:task-state-missing/.test(line)));
  const status = JSON.parse(prompt(home, session, 'DevRigorSTATUS'));
  assert.match(status.hookSpecificOutput.additionalContext, /mode:\s*WARN/i);
  assert.match(status.hookSpecificOutput.additionalContext, /mechanical debt:\s*yes/i);
  assert.doesNotMatch(status.hookSpecificOutput.additionalContext, /mechanical debt:\s*no/i);
});

test('ground: a task-lock timeout visibly fails open and records mechanical debt', () => {
  const home = freshHome();
  const session = 'ground-lock-timeout';
  const key = crypto.createHash('sha256').update(session).update('\0').digest('hex');
  const state = path.join(home, 'dev-rigor-stack', 'state');
  const lock = path.join(state, `task-lock-v4-${key}`);
  fs.mkdirSync(lock, { recursive: true });
  fs.writeFileSync(path.join(lock, 'owner'), 'other-process');
  const output = execFileSync(process.execPath, [GROUND, 'record'], {
    input: JSON.stringify({
      session_id: session, turn_id: 'turn-lock', hook_event_name: 'PostToolUse',
      tool_name: 'apply_patch', tool_input: { command: '*** Update File: src/locked.ts' }, tool_response: {},
    }),
    env: { ...process.env, CODEX_HOME: home, DEV_RIGOR_LOCK_TIMEOUT_MS: '250' },
    encoding: 'utf8',
  });
  assert.match(output, /systemMessage/);
  assert.match(output, /task-lock-timeout/);
  assert.ok(stateFiles(home, `mechanical-v4-${key}`).length > 0);
});

test('ground: legacy 1.6.1 and 1.6.2 ledgers remain audit history and cannot poison v4 turns', () => {
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
  ensureActivated(home, session);
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
  const task = taskStateForSession(home, session);
  assert.strictEqual(task.proofs[task.proofs.length - 1].edits.length, 24);
  assert.strictEqual(task.dirtyEdits.length, 0);
});

test('ground: concurrent edit observations retain the exact dirty and debt edit sets', async () => {
  const home = freshHome();
  const session = 'ground-concurrent-debt';
  const turn = 'turn-concurrent-debt';
  ensureActivated(home, session);
  await Promise.all(Array.from({ length: 32 }, (_, index) => runHookAsync(GROUND, {
    session_id: session,
    turn_id: turn,
    hook_event_name: 'PostToolUse',
    tool_name: 'apply_patch',
    tool_input: { command: `*** Update File: src/debt-${index}.ts` },
    tool_response: {},
  }, home, ['record'])));
  assert.strictEqual(taskStateForSession(home, session).dirtyEdits.length, 32);
  assert.strictEqual(JSON.parse(stop(home, session, 'Done.', false, 'stop', turn)).decision, 'block');
  stop(home, session, 'Continued.', true, 'stop', turn);
  const task = taskStateForSession(home, session);
  assert.strictEqual(task.unresolved.length, 1);
  assert.strictEqual(task.unresolved[0].edits.length, 32);
});

test('ground: concurrent Stops produce exactly one block and one released-unproved transition', async () => {
  const home = freshHome();
  const session = 'ground-concurrent-stops';
  const turn = 'turn-concurrent-stops';
  record(home, session, 'apply_patch', { command: '*** Update File: src/concurrent-stop.ts' }, {}, turn);
  const outputs = await Promise.all(Array.from({ length: 16 }, () => runHookAsync(GROUND, {
    session_id: session,
    turn_id: turn,
    hook_event_name: 'Stop',
    stop_hook_active: false,
    last_assistant_message: 'Done.',
  }, home, ['check'])));
  assert.strictEqual(outputs.filter((output) => /"decision":"block"/.test(output)).length, 1);
  assert.strictEqual(outputs.filter((output) => /systemMessage/.test(output)).length, 1);
  const lines = stateLines(home);
  assert.strictEqual(lines.filter((line) => line.startsWith('K ')).length, 1);
  assert.strictEqual(lines.filter((line) => line.startsWith('U ')).length, 1);
  assert.strictEqual(taskStateForSession(home, session).blockCount, 1);
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

test('ground: successful process status outranks incidental policy-rejection wording', () => {
  const home = freshHome();
  record(home, 'ground-policy-wording', 'apply_patch', { command: '*** Update File: src/app.ts' });
  record(home, 'ground-policy-wording', 'Bash', { command: 'npm test' }, {
    exit_code: 0,
    content: [{ type: 'text', text: 'test passed: unauthorized request is rejected by policy' }],
  });
  assert.strictEqual(stop(home, 'ground-policy-wording', receipt).trim(), '');
  assert.ok(stateLines(home).some((line) => line.startsWith('T ')));
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
  record(home, 'ground-4', 'Bash', { command: 'npm test' }, { exit_code: 0 });
  expectSystemMessage(stop(home, 'ground-4', 'All done.'), /optional evidence receipt was missing/i);
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

test('ground: harmless and unknown shell commands cannot satisfy substantive proof', () => {
  const commands = ['echo hello', 'pwd', 'Get-Date', 'git fetch', 'sleep 0', 'custom-status-probe --quiet', 'curl https://example.invalid/test'];
  for (const [index, command] of commands.entries()) {
    const home = freshHome();
    const session = `ground-harmless-${index}`;
    record(home, session, 'apply_patch', { command: '*** Update File: src/app.ts' });
    record(home, session, index === 2 ? 'PowerShell' : 'Bash', { command }, { exit_code: 0 });
    const parsed = JSON.parse(stop(home, session, receipt));
    assert.strictEqual(parsed.decision, 'block', `${command} incorrectly satisfied proof`);
    assert.ok(stateLines(home).some((line) => line.startsWith('I ')), `${command} was not classified as non-proof`);
    assert.ok(!stateLines(home).some((line) => /^[RTB] /.test(line)), `${command} emitted qualifying evidence`);
  }
});

test('ground: version, help, eval, and keyword-shaped commands remain non-proof', () => {
  const commands = [
    'node --version',
    'node -p process.version',
    'node -e "console.log(process.version)"',
    'python --version',
    'python -c "print(1)"',
    'npm --version',
    'npm view test',
    'npm exec echo test',
    'custom-probe --test',
    'custom-probe --build',
    'dotnet build --version',
    'dotnet build --help',
    'cargo test --help',
    'pytest --help',
    'pytest --co -q tests',
    'pytest --setup-only -q tests',
    'pytest --setup-show -q tests',
    'pytest --fixtures tests',
    'pytest --fixtures-per-test tests',
    'pytest --markers',
    'pytest --trace-config',
    'tsc --version',
    'ruby -v',
    'php --version',
    'java -version',
    'curl https://example.invalid/test',
    './build/tool --version',
    'C:\\test\\echo.exe ok',
    'node --version && echo test',
    'npm test && echo done',
    'notnpm test',
    'npm-test',
  ];
  for (const [index, command] of commands.entries()) {
    const home = freshHome();
    const session = `ground-info-${index}`;
    record(home, session, 'apply_patch', { command: '*** Update File: src/app.ts' });
    record(home, session, 'Bash', { command }, { exit_code: 0 });
    const output = stop(home, session, receipt);
    assert.match(output, /"decision":"block"/, `${command} incorrectly satisfied proof`);
    const parsed = JSON.parse(output);
    assert.strictEqual(parsed.decision, 'block', `${command} incorrectly satisfied proof`);
    assert.ok(!stateLines(home).some((line) => /^[RTB] /.test(line)), `${command} emitted qualifying evidence`);
  }

  for (const [index, tool] of ['mcp__foo__snapshot_status', 'mcp__foo__navigate_help'].entries()) {
    const home = freshHome();
    const session = `ground-tool-keyword-${index}`;
    record(home, session, 'apply_patch', { command: '*** Update File: src/app.ts' });
    record(home, session, tool, {}, { success: true });
    const output = stop(home, session, receipt);
    assert.match(output, /"decision":"block"/, `${tool} incorrectly satisfied proof`);
    assert.ok(!stateLines(home).some((line) => /^[RTB] /.test(line)), `${tool} emitted qualifying evidence`);
  }

  const actionHome = freshHome();
  record(actionHome, 'ground-fake-action', 'apply_patch', { command: '*** Update File: src/app.ts' });
  record(actionHome, 'ground-fake-action', 'mcp__foo__probe', { action: 'click' }, { success: true });
  assert.match(stop(actionHome, 'ground-fake-action', receipt), /"decision":"block"/, 'an unknown tool with a proof-shaped action escaped exact tool-family classification');
  assert.ok(!stateLines(actionHome).some((line) => line.startsWith('R ')));
});

test('ground: package-manager no-op flags cannot satisfy substantive proof', () => {
  const home = freshHome();
  const session = 'ground-package-noop';
  const turn = 'turn-package-noop';
  const toolUseId = 'tool-package-noop';
  const repo = freshGitRepo([['package.json', '{"name":"no-test-script","version":"1.0.0"}\n']]);
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const command = `${npm} run test --if-present`;
  record(home, session, 'apply_patch', { command: '*** Update File: src/app.ts' }, {}, turn);
  const rawPre = preTool(home, session, 'Bash', { command }, repo, toolUseId, turn);
  const pre = rawPre.trim() ? JSON.parse(rawPre) : {};
  const effective = pre.hookSpecificOutput && pre.hookSpecificOutput.updatedInput
    ? pre.hookSpecificOutput.updatedInput.command : command;
  const execution = executeWrapped(effective, repo);
  assert.strictEqual(execution.status, 0, execution.stderr);
  postTool(home, session, 'Bash', { command }, execution.stdout, repo, toolUseId, turn);
  assert.strictEqual(JSON.parse(stop(home, session, receipt, false, 'stop', turn)).decision, 'block');
  assert.ok(!stateLines(home).some((line) => line.startsWith('T ')), '--if-present emitted test proof');
});

test('ground: path-qualified executable lookalikes cannot satisfy substantive proof', () => {
  const home = freshHome();
  const session = 'ground-path-spoof';
  const turn = 'turn-path-spoof';
  const toolUseId = 'tool-path-spoof';
  const filename = process.platform === 'win32' ? 'pytest.cmd' : 'pytest';
  const source = process.platform === 'win32' ? '@exit /b 0\r\n' : '#!/bin/sh\nexit 0\n';
  const repo = freshGitRepo([[filename, source]]);
  if (process.platform !== 'win32') {
    fs.chmodSync(path.join(repo, filename), 0o755);
    execFileSync('git', ['add', filename], { cwd: repo });
    execFileSync('git', ['commit', '--quiet', '--amend', '--no-edit'], { cwd: repo });
  }
  const command = process.platform === 'win32' ? '.\\pytest.cmd' : './pytest';
  record(home, session, 'apply_patch', { command: '*** Update File: src/app.ts' }, {}, turn);
  const rawPre = preTool(home, session, 'Bash', { command }, repo, toolUseId, turn);
  const pre = rawPre.trim() ? JSON.parse(rawPre) : {};
  const effective = pre.hookSpecificOutput && pre.hookSpecificOutput.updatedInput
    ? pre.hookSpecificOutput.updatedInput.command : command;
  const execution = executeWrapped(effective, repo);
  assert.strictEqual(execution.status, 0, execution.stderr);
  postTool(home, session, 'Bash', { command }, execution.stdout, repo, toolUseId, turn);
  assert.strictEqual(JSON.parse(stop(home, session, receipt, false, 'stop', turn)).decision, 'block');
  assert.ok(!stateLines(home).some((line) => line.startsWith('T ')), 'path-qualified lookalike emitted test proof');
});

test('ground: exact supported test, build, and run shapes remain qualifying', () => {
  const commands = [
    ['npm test -- --runInBand', 'T'],
    ['python -m pytest -q', 'T'],
    ['node scripts/render.js', 'R'],
    ['node scripts/render.js --test', 'R'],
    ['python scripts/smoke.py', 'R'],
  ];
  for (const [index, [command, eventClass]] of commands.entries()) {
    const home = freshHome();
    const session = `ground-supported-${index}`;
    record(home, session, 'apply_patch', { command: '*** Update File: src/app.ts' });
    record(home, session, 'Bash', { command }, { exit_code: 0 });
    assert.strictEqual(stop(home, session, receipt).trim(), '', `${command} did not qualify`);
    assert.ok(stateLines(home).some((line) => line.startsWith(`${eventClass} `)), `${command} emitted the wrong evidence class`);
  }

  const shimDirectory = path.join(tmpRoot, `trusted-tool-shims-${++serial}`);
  fs.mkdirSync(shimDirectory, { recursive: true });
  const shimName = process.platform === 'win32' ? 'dotnet.cmd' : 'dotnet';
  fs.writeFileSync(path.join(shimDirectory, shimName), process.platform === 'win32'
    ? '@echo off\r\nexit /b 0\r\n' : '#!/bin/sh\nexit 0\n');
  if (process.platform !== 'win32') fs.chmodSync(path.join(shimDirectory, shimName), 0o755);
  const originalPath = process.env.PATH;
  process.env.PATH = `${shimDirectory}${path.delimiter}${originalPath}`;
  try {
    const dotnetHome = freshHome();
    record(dotnetHome, 'ground-supported-dotnet', 'apply_patch', { command: '*** Update File: src/app.cs' });
    record(dotnetHome, 'ground-supported-dotnet', 'Bash', { command: 'dotnet build src/App.csproj' }, { exit_code: 0 });
    assert.strictEqual(stop(dotnetHome, 'ground-supported-dotnet', receipt).trim(), '');
    assert.ok(stateLines(dotnetHome).some((line) => line.startsWith('B ')));
  } finally { process.env.PATH = originalPath; }

  const home = freshHome();
  record(home, 'ground-supported-browser', 'apply_patch', { command: '*** Update File: src/ui.ts' });
  record(home, 'ground-supported-browser', 'mcp__browser__click', { action: 'click' }, { success: true });
  assert.strictEqual(stop(home, 'ground-supported-browser', receipt).trim(), '');
  assert.ok(stateLines(home).some((line) => line.startsWith('R ')));
});

test('ground: PreToolUse/PostToolUse detects an opaque shell write to a tracked source file', () => {
  const home = freshHome();
  const repo = path.join(tmpRoot, `shell-write-repo-${serial}`);
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src', 'app.ts'), 'export const value = 1;\n');
  execFileSync('git', ['init', '--quiet'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'dev-rigor@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Dev Rigor Test'], { cwd: repo });
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '--quiet', '-m', 'fixture'], { cwd: repo });

  const command = `python -c "open('src/app.ts','w').write('export const value = 2;\\n')"`;
  preTool(home, 'ground-opaque-write', 'Bash', { command }, repo, 'opaque-write');
  execFileSync(process.execPath, ['-e', "require('fs').writeFileSync('src/app.ts','export const value = 2;\\n')"], { cwd: repo });
  postTool(home, 'ground-opaque-write', 'Bash', { command }, { exit_code: 0 }, repo, 'opaque-write');

  const parsed = JSON.parse(stop(home, 'ground-opaque-write', receipt));
  assert.strictEqual(parsed.decision, 'block');
  assert.ok(stateLines(home).some((line) => line.startsWith('G ')), 'tracked shell change was not recorded');
});

test('ground: clean-to-clean commit, amend, branch switch, and detached HEAD transitions re-arm proof', () => {
  const scenarios = ['commit', 'amend', 'branch-switch', 'detached-head', 'mode-only-commit'];
  for (const [index, name] of scenarios.entries()) {
    const home = freshHome();
    const repo = freshGitRepo();
    let transition;
    if (name === 'commit') {
      transition = () => {
        fs.writeFileSync(path.join(repo, 'src', 'app.ts'), 'export const value = 2;\n');
        execFileSync('git', ['add', 'src/app.ts'], { cwd: repo });
        execFileSync('git', ['commit', '--quiet', '-m', 'opaque'], { cwd: repo });
      };
    } else if (name === 'amend') {
      transition = () => {
        fs.writeFileSync(path.join(repo, 'src', 'app.ts'), 'export const value = 3;\n');
        execFileSync('git', ['add', 'src/app.ts'], { cwd: repo });
        execFileSync('git', ['commit', '--quiet', '--amend', '--no-edit'], { cwd: repo });
      };
    } else if (name === 'branch-switch') {
      const original = execFileSync('git', ['branch', '--show-current'], { cwd: repo, encoding: 'utf8' }).trim();
      execFileSync('git', ['switch', '--quiet', '-c', 'alternate'], { cwd: repo });
      fs.writeFileSync(path.join(repo, 'src', 'app.ts'), 'export const value = 4;\n');
      execFileSync('git', ['commit', '--quiet', '-am', 'alternate'], { cwd: repo });
      execFileSync('git', ['switch', '--quiet', original], { cwd: repo });
      transition = () => execFileSync('git', ['switch', '--quiet', 'alternate'], { cwd: repo });
    } else if (name === 'detached-head') {
      const prior = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
      fs.writeFileSync(path.join(repo, 'src', 'app.ts'), 'export const value = 5;\n');
      execFileSync('git', ['commit', '--quiet', '-am', 'second'], { cwd: repo });
      transition = () => execFileSync('git', ['switch', '--quiet', '--detach', prior], { cwd: repo });
    } else {
      // With file-mode observation disabled, this changes only Git's tree and
      // index identities. Worktree bytes and filesystem metadata stay stable,
      // so entry fingerprints cannot mask a missing tree comparison.
      execFileSync('git', ['config', 'core.filemode', 'false'], { cwd: repo });
      transition = () => {
        execFileSync('git', ['update-index', '--chmod=+x', 'src/app.ts'], { cwd: repo });
        execFileSync('git', ['commit', '--quiet', '-m', 'mode-only tree change'], { cwd: repo });
      };
    }
    const command = name === 'branch-switch' ? 'git switch alternate' :
      name === 'detached-head' ? 'git switch --detach HEAD~1' : `opaque-${name}`;
    preTool(home, `ground-head-${index}`, 'PowerShell', { command }, repo, `head-${index}`, 'turn-head');
    transition();
    postTool(home, `ground-head-${index}`, 'PowerShell', { command }, { exit_code: 0 }, repo, `head-${index}`, 'turn-head');
    const output = stop(home, `ground-head-${index}`, receipt, false, 'stop', 'turn-head');
    assert.match(output, /"decision":"block"/, `${name} transition escaped detection`);
    const parsed = JSON.parse(output);
    assert.strictEqual(parsed.decision, 'block', `${name} transition escaped detection`);
    assert.ok(stateLines(home).some((line) => line.startsWith('G ')), `${name} did not record generated-change evidence`);
  }
});

test('ground: repository identity-only and index-only transitions re-arm proof', () => {
  const scenarios = ['empty-commit', 'metadata-amend', 'same-oid-branch', 'same-oid-detach', 'index-only', 'unborn-first-commit'];
  for (const [index, name] of scenarios.entries()) {
    const home = freshHome();
    let repo = name === 'unborn-first-commit' ? path.join(tmpRoot, `unborn-${++serial}`) : freshGitRepo();
    if (name === 'unborn-first-commit') {
      fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
      fs.writeFileSync(path.join(repo, 'src', 'app.ts'), 'export const value = 1;\n');
      execFileSync('git', ['init', '--quiet'], { cwd: repo });
      execFileSync('git', ['config', 'user.email', 'hooks@example.invalid'], { cwd: repo });
      execFileSync('git', ['config', 'user.name', 'Hook Tests'], { cwd: repo });
    }
    let transition;
    if (name === 'empty-commit') {
      transition = () => execFileSync('git', ['commit', '--quiet', '--allow-empty', '-m', 'identity only'], { cwd: repo });
    } else if (name === 'metadata-amend') {
      transition = () => execFileSync('git', ['commit', '--quiet', '--amend', '--no-edit', '-m', 'metadata changed'], { cwd: repo });
    } else if (name === 'same-oid-branch') {
      execFileSync('git', ['branch', 'same-oid'], { cwd: repo });
      transition = () => execFileSync('git', ['switch', '--quiet', 'same-oid'], { cwd: repo });
    } else if (name === 'same-oid-detach') {
      const oid = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
      transition = () => execFileSync('git', ['switch', '--quiet', '--detach', oid], { cwd: repo });
    } else if (name === 'index-only') {
      fs.writeFileSync(path.join(repo, 'src', 'app.ts'), 'export const value = 2;\n');
      const first = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: repo, input: 'export const value = 3;\n', encoding: 'utf8' }).trim();
      execFileSync('git', ['update-index', '--cacheinfo', `100644,${first},src/app.ts`], { cwd: repo });
      transition = () => {
        const second = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: repo, input: 'export const value = 4;\n', encoding: 'utf8' }).trim();
        execFileSync('git', ['update-index', '--cacheinfo', `100644,${second},src/app.ts`], { cwd: repo });
      };
    } else {
      transition = () => {
        execFileSync('git', ['add', 'src/app.ts'], { cwd: repo });
        execFileSync('git', ['commit', '--quiet', '-m', 'first'], { cwd: repo });
      };
    }
    const session = `ground-identity-${index}`;
    const command = `identity-transition-${name}`;
    preTool(home, session, 'PowerShell', { command }, repo, `identity-${index}`, 'turn-identity');
    transition();
    postTool(home, session, 'PowerShell', { command }, { exit_code: 0 }, repo, `identity-${index}`, 'turn-identity');
    const output = stop(home, session, receipt, false, 'stop', 'turn-identity');
    assert.match(output, /"decision":"block"/, `${name} transition escaped detection`);
    assert.ok(stateLines(home).some((line) => line.startsWith('G ')), `${name} did not record generated-change evidence`);
  }
});

test('ground: hidden index visibility flag changes re-arm proof', () => {
  for (const [index, flag] of ['--assume-unchanged', '--skip-worktree'].entries()) {
    const home = freshHome();
    const repo = freshGitRepo();
    const session = `ground-index-flag-${index}`;
    preTool(home, session, 'PowerShell', { command: `git update-index ${flag} src/app.ts` }, repo, `index-flag-${index}`, 'turn-index-flag');
    execFileSync('git', ['update-index', flag, 'src/app.ts'], { cwd: repo });
    postTool(home, session, 'PowerShell', { command: `git update-index ${flag} src/app.ts` }, { exit_code: 0 }, repo, `index-flag-${index}`, 'turn-index-flag');
    assert.match(stop(home, session, receipt, false, 'stop', 'turn-index-flag'), /"decision":"block"/, `${flag} transition escaped index observation`);
    assert.ok(stateLines(home).some((line) => line.startsWith('G ')));
  }
});

test('ground: pre-existing hidden index paths remain content-observable', () => {
  for (const [index, flag] of ['--assume-unchanged', '--skip-worktree'].entries()) {
    const home = freshHome();
    const repo = freshGitRepo();
    const session = `ground-hidden-content-${index}`;
    execFileSync('git', ['update-index', flag, 'src/app.ts'], { cwd: repo });
    preTool(home, session, 'PowerShell', { command: 'node scripts/render.js' }, repo, `hidden-content-${index}`, 'turn-hidden');
    fs.writeFileSync(path.join(repo, 'src', 'app.ts'), `export const value = ${index + 20};\n`);
    postTool(home, session, 'PowerShell', { command: 'node scripts/render.js' }, { exit_code: 0 }, repo, `hidden-content-${index}`, 'turn-hidden');
    assert.match(stop(home, session, receipt, false, 'stop', 'turn-hidden'), /"decision":"block"/,
      `${flag} hid a content mutation from repository observation`);
    assert.ok(stateLines(home).some((line) => line.startsWith('G ')));
  }
});

test('ground: an already-dirty submodule cannot change commits invisibly', () => {
  const home = freshHome();
  const submoduleSource = freshGitRepo();
  const first = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: submoduleSource, encoding: 'utf8' }).trim();
  fs.writeFileSync(path.join(submoduleSource, 'src', 'app.ts'), 'export const value = 2;\n');
  execFileSync('git', ['commit', '--quiet', '-am', 'second'], { cwd: submoduleSource });
  const second = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: submoduleSource, encoding: 'utf8' }).trim();
  fs.writeFileSync(path.join(submoduleSource, 'src', 'app.ts'), 'export const value = 3;\n');
  execFileSync('git', ['commit', '--quiet', '-am', 'third'], { cwd: submoduleSource });

  const parent = freshGitRepo();
  execFileSync('git', ['-c', 'protocol.file.allow=always', 'submodule', 'add', '--quiet', submoduleSource, 'vendor/sub'], { cwd: parent });
  execFileSync('git', ['commit', '--quiet', '-am', 'add submodule'], { cwd: parent });
  const nested = path.join(parent, 'vendor', 'sub');
  execFileSync('git', ['checkout', '--quiet', first], { cwd: nested });
  const beforeStatus = execFileSync('git', ['status', '--porcelain=v2'], { cwd: parent, encoding: 'utf8' });

  preTool(home, 'ground-submodule-content', 'PowerShell', { command: 'node scripts/render.js' }, parent, 'submodule-content', 'turn-submodule');
  execFileSync('git', ['checkout', '--quiet', second], { cwd: nested });
  const afterStatus = execFileSync('git', ['status', '--porcelain=v2'], { cwd: parent, encoding: 'utf8' });
  assert.strictEqual(afterStatus, beforeStatus, 'fixture must preserve identical parent status bytes');
  postTool(home, 'ground-submodule-content', 'PowerShell', { command: 'node scripts/render.js' }, { exit_code: 0 }, parent, 'submodule-content', 'turn-submodule');
  assert.match(stop(home, 'ground-submodule-content', receipt, false, 'stop', 'turn-submodule'), /"decision":"block"/,
    'submodule commit movement escaped repository observation');
  assert.ok(stateLines(home).some((line) => line.startsWith('G ')));
});

test('ground: already-dirty submodule worktree content remains observable', () => {
  const home = freshHome();
  const submoduleSource = freshGitRepo();
  const parent = freshGitRepo();
  execFileSync('git', ['-c', 'protocol.file.allow=always', 'submodule', 'add', '--quiet', submoduleSource, 'vendor/sub'], { cwd: parent });
  execFileSync('git', ['commit', '--quiet', '-am', 'add submodule'], { cwd: parent });
  const nested = path.join(parent, 'vendor', 'sub');
  const nestedFile = path.join(nested, 'src', 'app.ts');
  fs.writeFileSync(nestedFile, 'export const value = 41;\n');
  const beforeStatus = execFileSync('git', ['status', '--porcelain=v2'], { cwd: parent, encoding: 'utf8' });

  preTool(home, 'ground-submodule-worktree', 'PowerShell', { command: 'node scripts/render.js' }, parent, 'submodule-worktree', 'turn-submodule-worktree');
  fs.writeFileSync(nestedFile, 'export const value = 42;\n');
  const afterStatus = execFileSync('git', ['status', '--porcelain=v2'], { cwd: parent, encoding: 'utf8' });
  assert.strictEqual(afterStatus, beforeStatus, 'fixture must preserve identical parent status bytes');
  postTool(home, 'ground-submodule-worktree', 'PowerShell', { command: 'node scripts/render.js' }, { exit_code: 0 }, parent, 'submodule-worktree', 'turn-submodule-worktree');
  assert.match(stop(home, 'ground-submodule-worktree', receipt, false, 'stop', 'turn-submodule-worktree'), /"decision":"block"/,
    'submodule worktree content movement escaped repository observation');
  assert.ok(stateLines(home).some((line) => line.startsWith('G ')));
});

test('ground: PostToolUse repository observation has one bounded deadline and fails safe', () => {
  const home = freshHome();
  const repo = freshGitRepo();
  const session = 'ground-shared-observation-deadline';
  const turn = 'turn-shared-observation-deadline';
  const toolUseId = 'shared-observation-deadline';
  preTool(home, session, 'PowerShell', { command: 'node scripts/render.js' }, repo, toolUseId, turn);

  const started = Date.now();
  const warning = execFileSync(process.execPath, [GROUND, 'record'], {
    input: JSON.stringify({
      session_id: session,
      turn_id: turn,
      hook_event_name: 'PostToolUse',
      tool_use_id: toolUseId,
      cwd: repo,
      tool_name: 'PowerShell',
      tool_input: { command: 'node scripts/render.js' },
      tool_response: { exit_code: 0 },
    }),
    env: { ...process.env, CODEX_HOME: home, DEV_RIGOR_TEST_OBSERVATION_BUDGET_MS: '1' },
    encoding: 'utf8',
    timeout: 5000,
  });
  assert.ok(Date.now() - started < 5000, 'repository observation exhausted the hook safety margin');
  assert.match(warning, /systemMessage/i);
  assert.match(warning, /comparison was unavailable|repository observation/i);
  assert.ok(stateLines(home).some((line) => line.startsWith('G ')), 'timeout did not record a conservative generated change');
  assert.ok(stateLines(home, 'mechanical-v4-').some((line) => /snapshot-unavailable/.test(line)), 'timeout did not record mechanical debt');
  assert.match(stop(home, session, receipt, false, 'stop', turn), /"decision":"block"/);

  const source = fs.readFileSync(GROUND, 'utf8');
  const budget = source.match(/const POST_OBSERVATION_BUDGET_MS = (\d+);/);
  assert.ok(budget && Number(budget[1]) <= 5000, 'Post observation does not reserve ten seconds for lock/persistence');
  assert.match(source, /const observationDeadline = Date\.now\(\) \+ postObservationBudgetMs\(\);/);
  assert.match(source, /worktreeSnapshot\(cwd, observationDeadline\)/);
  assert.match(source, /worktreeChanges\(before, after, cwd, observationDeadline\)/);
});

test('ground: unavailable repository comparison records visible mechanical debt instead of proof', () => {
  const home = freshHome();
  const repo = freshGitRepo();
  const session = 'ground-identity-unavailable';
  preTool(home, session, 'PowerShell', { command: 'node scripts/run.js' }, repo, 'identity-unavailable', 'turn-unavailable');
  const snapshotDir = path.join(home, 'dev-rigor-stack', 'state');
  const snapshotName = fs.readdirSync(snapshotDir).find((name) => name.startsWith('pre-v4-'));
  const snapshotFile = path.join(snapshotDir, snapshotName);
  const snapshot = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'));
  snapshot.head = '0000000000000000000000000000000000000000';
  fs.writeFileSync(snapshotFile, JSON.stringify(snapshot));
  const warning = postTool(home, session, 'PowerShell', { command: 'node scripts/run.js' }, { exit_code: 0 }, repo, 'identity-unavailable', 'turn-unavailable');
  assert.match(warning, /systemMessage/i);
  assert.match(stop(home, session, receipt, false, 'stop', 'turn-unavailable'), /"decision":"block"/);
  const status = JSON.parse(prompt(home, session, 'DevRigorSTATUS'));
  assert.match(status.hookSpecificOutput.additionalContext, /mechanical debt/i);
});

test('ground: direct and opaque edits track binary, image, font, document, archive, and extensionless assets', () => {
  const assets = ['logo.png', 'vector.svg', 'font.woff2', 'manual.pdf', 'bundle.zip', 'tool.exe', 'library.dll', 'module.wasm', 'runtime'];
  const directEscapes = [];
  const opaqueEscapes = [];
  for (const [index, name] of assets.entries()) {
    const directHome = freshHome();
    const directSession = `ground-asset-direct-${index}`;
    record(directHome, directSession, 'apply_patch', { command: `*** Update File: assets/${name}` });
    if (!/"decision":"block"/.test(stop(directHome, directSession, receipt))) directEscapes.push(name);
    assert.ok(stateLines(directHome).some((line) => line.startsWith('E ') && line.includes(`edit:${expectedArtifactId(unitRepo, `assets/${name}`)}`)), `direct ${name} did not preserve its exact artifact identity`);

    const opaqueHome = freshHome();
    const repo = freshGitRepo([[`assets/${name}`, Buffer.from([1, 2, 3, index])]]);
    const command = 'python scripts/update_asset.py';
    preTool(opaqueHome, `ground-asset-opaque-${index}`, 'PowerShell', { command }, repo, `asset-${index}`, 'turn-asset');
    fs.writeFileSync(path.join(repo, 'assets', name), Buffer.from([9, 8, 7, index]));
    postTool(opaqueHome, `ground-asset-opaque-${index}`, 'PowerShell', { command }, { exit_code: 0 }, repo, `asset-${index}`, 'turn-asset');
    if (!/"decision":"block"/.test(stop(opaqueHome, `ground-asset-opaque-${index}`, receipt, false, 'stop', 'turn-asset'))) opaqueEscapes.push(name);
    assert.ok(stateLines(opaqueHome).some((line) => line.startsWith('G ') && line.includes(`edit:${expectedArtifactId(repo, `assets/${name}`)}`)), `opaque ${name} did not preserve its exact artifact identity`);
  }
  assert.deepStrictEqual(directEscapes, [], `direct asset edits escaped: ${directEscapes.join(', ')}`);
  assert.deepStrictEqual(opaqueEscapes, [], `opaque asset edits escaped: ${opaqueEscapes.join(', ')}`);
});

test('ground: nested edit-tool paths, response paths, and missing paths fail safely', () => {
  const cases = [
    ['MultiEdit', { edits: [{ file_path: 'src/nested.ts' }] }, {}, 'src/nested.ts'],
    ['NotebookEdit', { notebook_path: 'analysis.ipynb' }, {}, 'analysis.ipynb'],
    ['Write', {}, { changed_files: ['assets/logo.png'] }, 'assets/logo.png'],
  ];
  for (const [index, [tool, input, response, expectedPath]] of cases.entries()) {
    const home = freshHome();
    const session = `ground-nested-edit-${index}`;
    record(home, session, tool, input, response);
    assert.match(stop(home, session, receipt), /"decision":"block"/, `${tool} path escaped edit detection`);
    assert.ok(stateLines(home).some((line) => line.startsWith('E ') && line.includes(`edit:${expectedArtifactId(unitRepo, expectedPath)}`)), `${tool} did not record the authoritative path identity`);
  }
  const home = freshHome();
  const warning = record(home, 'ground-pathless-edit', 'Write', {}, {});
  assert.match(warning, /systemMessage/i);
  assert.match(stop(home, 'ground-pathless-edit', receipt), /"decision":"block"/);
});

test('ground: later proof resolves mechanical debt only when it covers the affected edit set', () => {
  const home = freshHome();
  const session = 'ground-mechanical-resolution';
  record(home, session, 'Write', {}, {}, 'mechanical-turn');
  const marker = stateLines(home, 'mechanical-v4-').find((line) => line.startsWith('M '));
  assert.match(marker || '', /edit-set:[a-f0-9]{16}/);
  const id = marker.match(/^M ([a-f0-9]{16})/)[1];
  record(home, session, 'Bash', { command: 'npm test' }, { exit_code: 0 }, 'mechanical-turn');
  assert.strictEqual(stop(home, session, receipt, false, 'stop', 'mechanical-turn').trim(), '');
  assert.ok(stateLines(home, 'mechanical-v4-').some((line) => line === `C ${id}`));
  const task = taskStateForSession(home, session);
  assert.strictEqual(task.mechanical.find((item) => item.id === id).status, 'resolved');
});

test('ground: missing PreToolUse observation fails safe for an unknown shell execution', () => {
  const home = freshHome();
  ensureActivated(home, 'ground-missing-pre');
  runHook(GROUND, {
    session_id: 'ground-missing-pre',
    turn_id: 'turn-missing-pre',
    hook_event_name: 'PostToolUse',
    tool_use_id: 'missing-pre-tool',
    cwd: unitRepo,
    tool_name: 'Bash',
    tool_input: { command: 'custom-generator --opaque' },
    tool_response: { exit_code: 0 },
  }, home, ['record']);
  const parsed = JSON.parse(stop(home, 'ground-missing-pre', receipt, false, 'stop', 'turn-missing-pre'));
  assert.strictEqual(parsed.decision, 'block');
  assert.ok(stateLines(home).some((line) => line.startsWith('G ')), 'missing pre-observation did not re-arm proof');
});

test('ground: Stop reconciles a failed shell mutation when Codex omits PostToolUse', () => {
  const home = freshHome();
  const session = 'ground-failed-no-post-mutation';
  const turn = 'turn-failed-no-post-mutation';
  const repo = freshGitRepo();
  preTool(home, session, 'Bash', { command: 'node scripts/fail.js' }, repo, 'failed-no-post', turn);
  fs.writeFileSync(path.join(repo, 'src', 'app.ts'), 'export const value = 99;\n');

  const parsed = JSON.parse(stop(home, session, receipt, false, 'stop', turn, repo));
  assert.strictEqual(parsed.decision, 'block');
  const lines = stateLines(home);
  assert.ok(lines.some((line) => line.startsWith('F class:R')), 'missing PostToolUse was not recorded as failed/unavailable proof');
  assert.ok(lines.some((line) => line.startsWith('G ')), 'failed shell mutation was not recovered from the pending PreToolUse snapshot');
  assert.strictEqual(taskStateForSession(home, session).pendingObservations.length, 0);
});

test('ground: an unconsumed PreToolUse snapshot cannot disappear when reconciliation is unavailable', () => {
  const home = freshHome();
  const session = 'ground-failed-no-post-missing-snapshot';
  const turn = 'turn-failed-no-post-missing-snapshot';
  const repo = freshGitRepo();
  preTool(home, session, 'Bash', { command: 'node scripts/fail.js' }, repo, 'missing-pending-snapshot', turn);
  const state = path.join(home, 'dev-rigor-stack', 'state');
  for (const name of stateFiles(home, 'pre-v4-')) fs.unlinkSync(path.join(state, name));

  const parsed = JSON.parse(stop(home, session, receipt, false, 'stop', turn, repo));
  assert.strictEqual(parsed.decision, 'block');
  assert.ok(stateLines(home).some((line) => line.startsWith('G ')), 'missing pending snapshot did not create a conservative generated edit');
  const task = taskStateForSession(home, session);
  assert.ok(task.mechanical.some((item) => item.status === 'unresolved' && item.reason === 'snapshot-unavailable'));
  assert.strictEqual(task.pendingObservations.length, 0);
});

test('ground: successful PostToolUse consumes its pending observation exactly once', () => {
  const home = freshHome();
  const session = 'ground-pending-post-consumed';
  const turn = 'turn-pending-post-consumed';
  const repo = freshGitRepo([['scripts/live.js', "process.stdout.write('ok\\n');\n"]]);
  const toolUseId = 'pending-post-consumed';
  const input = { command: 'node scripts/live.js' };
  const pre = JSON.parse(preTool(home, session, 'Bash', input, repo, toolUseId, turn));
  const execution = executeWrapped(pre.hookSpecificOutput.updatedInput.command, repo);
  assert.strictEqual(execution.status, 0, execution.stderr);
  postTool(home, session, 'Bash', input, execution.stdout, repo, toolUseId, turn);
  assert.strictEqual(taskStateForSession(home, session).pendingObservations.length, 0);
  stop(home, session, receipt, false, 'stop', turn, repo);
  assert.strictEqual(stateLines(home).filter((line) => line.startsWith('R ')).length, 1);
});

test('ground: structured failing test result outranks process exit zero', () => {
  const home = freshHome();
  const session = 'ground-structured-fail';
  const turn = 'turn-structured-fail';
  const toolUseId = 'structured-fail-tool';
  record(home, session, 'apply_patch', { command: '*** Update File: src/app.ts' }, {}, turn);
  const input = { command: 'node --test' };
  const pre = JSON.parse(preTool(home, session, 'Bash', input, unitRepo, toolUseId, turn));
  const execution = executeWrapped(pre.hookSpecificOutput.updatedInput.command, unitRepo);
  assert.strictEqual(execution.status, 0, execution.stderr);
  postTool(home, session, 'Bash', input, {
    exit_code: 0, test_result: { passed: 4, failed: 1 },
  }, unitRepo, toolUseId, turn);
  const parsed = JSON.parse(stop(home, session, receipt, false, 'stop', turn));
  assert.strictEqual(parsed.decision, 'block');
  assert.ok(stateLines(home).some((line) => line.startsWith('F ')));
});

test('ground: explicit failed status outranks process exit zero', () => {
  const home = freshHome();
  record(home, 'ground-explicit-status-fail', 'apply_patch', { command: '*** Update File: src/app.ts' });
  record(home, 'ground-explicit-status-fail', 'Bash', { command: 'npm test' }, {
    exit_code: 0, status: 'failed',
  });
  const parsed = JSON.parse(stop(home, 'ground-explicit-status-fail', receipt));
  assert.strictEqual(parsed.decision, 'block');
  assert.ok(stateLines(home).some((line) => line.startsWith('F ')));
});

test('ground: completed status and failure text cannot be promoted to proof', () => {
  const home = freshHome();
  record(home, 'ground-completed-failure', 'apply_patch', { command: '*** Update File: src/app.ts' });
  record(home, 'ground-completed-failure', 'Bash', { command: 'npm test' }, {
    status: 'completed',
    content: [{ type: 'text', text: '1 test failed' }],
  });
  const parsed = JSON.parse(stop(home, 'ground-completed-failure', receipt));
  assert.strictEqual(parsed.decision, 'block');
  assert.ok(!stateLines(home).some((line) => line.startsWith('T ')), 'completed transport status emitted test proof');
});

test('ground: zero passing tests cannot satisfy substantive proof', () => {
  const home = freshHome();
  record(home, 'ground-zero-passed', 'apply_patch', { command: '*** Update File: src/app.ts' });
  record(home, 'ground-zero-passed', 'Bash', { command: 'npm test' }, {
    content: [{ type: 'text', text: '0 tests passed' }],
  });
  const parsed = JSON.parse(stop(home, 'ground-zero-passed', receipt));
  assert.strictEqual(parsed.decision, 'block');
  assert.ok(!stateLines(home).some((line) => line.startsWith('T ')), 'zero-test output emitted test proof');
});

test('ground: structured zero-test metadata cannot satisfy substantive proof', () => {
  for (const [suffix, testResult] of [
    ['counts', { passed: 0, failed: 0 }],
    ['failed-only', { failed: 0 }],
  ]) {
    const home = freshHome();
    const session = `ground-structured-zero-${suffix}`;
    record(home, session, 'apply_patch', { command: '*** Update File: src/app.ts' });
    record(home, session, 'Bash', { command: 'npm test' }, {
      exit_code: 0, test_result: testResult,
    });
    const parsed = JSON.parse(stop(home, session, receipt));
    assert.strictEqual(parsed.decision, 'block');
    assert.ok(!stateLines(home).some((line) => line.startsWith('T ')), 'zero-test structured metadata emitted test proof');
  }
});

test('ground: arbitrary nested success metadata is not an authoritative result', () => {
  const home = freshHome();
  record(home, 'ground-nested-success', 'apply_patch', { command: '*** Update File: src/app.ts' });
  record(home, 'ground-nested-success', 'Bash', { command: 'npm test' }, {
    metadata: { adapter: { success: true } },
    content: [{ type: 'text', text: 'result unavailable' }],
  });
  const parsed = JSON.parse(stop(home, 'ground-nested-success', receipt));
  assert.strictEqual(parsed.decision, 'block');
  assert.ok(!stateLines(home).some((line) => line.startsWith('T ')), 'nested metadata emitted test proof');
});

test('ground: PreToolUse exit receipt proves the exact real-client raw-string success shape', () => {
  const home = freshHome();
  const session = 'ground-live-string-success';
  const turn = 'turn-live-string-success';
  const toolUseId = 'tool-live-string-success';
  const repo = freshGitRepo([['scripts/live.js', "process.stdout.write('LIVE_HOOK_OK\\n');\n"]]);
  record(home, session, 'apply_patch', { command: '*** Update File: src/app.ts' }, {}, turn);
  const originalInput = { command: 'node scripts/live.js' };
  const pre = JSON.parse(preTool(home, session, 'Bash', originalInput, repo, toolUseId, turn));
  const updated = pre.hookSpecificOutput && pre.hookSpecificOutput.updatedInput;
  assert.strictEqual(pre.hookSpecificOutput.permissionDecision, 'allow');
  assert.ok(updated && typeof updated.command === 'string' && updated.command !== originalInput.command);
  const execution = executeWrapped(updated.command, repo);
  assert.strictEqual(execution.status, 0, execution.stderr);
  assert.strictEqual(execution.stdout, 'LIVE_HOOK_OK\n');
  postTool(home, session, 'Bash', originalInput, execution.stdout, repo, toolUseId, turn);
  assert.strictEqual(stop(home, session, receipt, false, 'stop', turn).trim(), '');
  assert.ok(stateLines(home).some((line) => line.startsWith('R ')), 'raw-string success did not emit run proof');
});

test('ground: exit receipt handles empty success and rejects a non-zero raw-string execution', () => {
  for (const [index, fixture] of [
    { name: 'empty', source: '', expected: 0 },
    { name: 'failure', source: "process.stdout.write('FAIL_SENTINEL\\n'); process.exit(7);", expected: 7 },
  ].entries()) {
    const home = freshHome();
    const session = `ground-live-string-${fixture.name}`;
    const turn = `turn-live-string-${fixture.name}`;
    const toolUseId = `tool-live-string-${fixture.name}`;
    const repo = freshGitRepo([[`scripts/${fixture.name}.js`, `${fixture.source}\n`]]);
    record(home, session, 'apply_patch', { command: '*** Update File: src/app.ts' }, {}, turn);
    const input = { command: `node scripts/${fixture.name}.js` };
    const pre = JSON.parse(preTool(home, session, 'Bash', input, repo, toolUseId, turn));
    const execution = executeWrapped(pre.hookSpecificOutput.updatedInput.command, repo);
    assert.strictEqual(execution.status, fixture.expected, execution.stderr);
    postTool(home, session, 'Bash', input, execution.stdout, repo, toolUseId, turn);
    const output = stop(home, session, receipt, false, 'stop', turn);
    if (fixture.expected === 0) {
      assert.strictEqual(output.trim(), '', 'empty stdout exit zero was not accepted through its receipt');
      assert.ok(stateLines(home).some((line) => line.startsWith('R ')));
    } else {
      assert.strictEqual(JSON.parse(output).decision, 'block');
      assert.ok(stateLines(home).some((line) => line.startsWith('F ')));
      assert.ok(!stateLines(home).some((line) => line.startsWith('R ')));
    }
  }
});

test('ground: missing exit receipt cannot promote an ambiguous raw string', () => {
  const home = freshHome();
  const session = 'ground-live-string-missing-receipt';
  const turn = 'turn-live-string-missing-receipt';
  const toolUseId = 'tool-live-string-missing-receipt';
  const repo = freshGitRepo([['scripts/live.js', "process.stdout.write('LIVE_HOOK_OK\\n');\n"]]);
  record(home, session, 'apply_patch', { command: '*** Update File: src/app.ts' }, {}, turn);
  const input = { command: 'node scripts/live.js' };
  const pre = JSON.parse(preTool(home, session, 'Bash', input, repo, toolUseId, turn));
  assert.ok(pre.hookSpecificOutput.updatedInput.command);
  const warning = postTool(home, session, 'Bash', input, 'LIVE_HOOK_OK\n', repo, toolUseId, turn);
  expectSystemMessage(warning, /execution receipt.*unavailable|exit receipt.*missing/i);
  assert.strictEqual(JSON.parse(stop(home, session, receipt, false, 'stop', turn)).decision, 'block');
  const task = taskStateForSession(home, session);
  assert.ok(task.mechanical.some((item) => item.status === 'unresolved' && item.reason === 'execution-receipt-missing'));
});

test('ground: missing exit receipt cannot promote an object-shaped success response', () => {
  const home = freshHome();
  const session = 'ground-object-missing-receipt';
  const turn = 'turn-object-missing-receipt';
  const toolUseId = 'tool-object-missing-receipt';
  const repo = freshGitRepo([['scripts/live.js', "process.stdout.write('LIVE_HOOK_OK\\n');\n"]]);
  record(home, session, 'apply_patch', { command: '*** Update File: src/app.ts' }, {}, turn);
  const input = { command: 'node scripts/live.js' };
  const pre = JSON.parse(preTool(home, session, 'Bash', input, repo, toolUseId, turn));
  assert.ok(pre.hookSpecificOutput.updatedInput.command);
  const warning = postTool(home, session, 'Bash', input, { exit_code: 0, stdout: 'synthetic' }, repo, toolUseId, turn);
  expectSystemMessage(warning, /execution receipt.*unavailable|exit receipt.*missing/i);
  assert.strictEqual(JSON.parse(stop(home, session, receipt, false, 'stop', turn)).decision, 'block');
  assert.ok(!stateLines(home).some((line) => /^[RTB] /.test(line)), 'unexecuted object response emitted proof');
  assert.ok(!stateLines(home).some((line) => line.startsWith('C ')), 'unexecuted object response checkpointed proof');
});

test('ground: structured success metadata cannot outrank a missing correlated exit receipt', () => {
  const home = freshHome();
  const session = 'ground-structured-missing-receipt';
  const turn = 'turn-structured-missing-receipt';
  const toolUseId = 'tool-structured-missing-receipt';
  const repo = freshGitRepo([['scripts/live.js', "process.stdout.write('LIVE_HOOK_OK\\n');\n"]]);
  record(home, session, 'apply_patch', { command: '*** Update File: src/app.ts' }, {}, turn);
  const input = { command: 'node scripts/live.js' };
  preTool(home, session, 'Bash', input, repo, toolUseId, turn);
  const warning = postTool(home, session, 'Bash', input, {
    exit_code: 0, test_result: { passed: 12, failed: 0 },
  }, repo, toolUseId, turn);
  expectSystemMessage(warning, /execution receipt.*unavailable|exit receipt.*missing/i);
  assert.strictEqual(JSON.parse(stop(home, session, receipt, false, 'stop', turn)).decision, 'block');
  assert.ok(!stateLines(home).some((line) => /^[RTB] proof-id:/.test(line)));
});

test('ground: a clean qualifying execution records observation without proof debt', () => {
  const home = freshHome();
  const session = 'ground-clean-run';
  const turn = 'turn-clean-run';
  const toolUseId = 'tool-clean-run';
  const repo = freshGitRepo([['scripts/live.js', "process.stdout.write('LIVE_HOOK_OK\\n');\n"]]);
  const input = { command: 'node scripts/live.js' };
  const pre = JSON.parse(preTool(home, session, 'Bash', input, repo, toolUseId, turn));
  const execution = executeWrapped(pre.hookSpecificOutput.updatedInput.command, repo);
  assert.strictEqual(execution.status, 0, execution.stderr);
  assert.strictEqual(postTool(home, session, 'Bash', input, execution.stdout, repo, toolUseId, turn).trim(), '');
  assert.strictEqual(stop(home, session, 'Read-only run completed.', false, 'stop', turn).trim(), '');
  const task = taskStateForSession(home, session);
  assert.deepStrictEqual(task.dirtyEdits, []);
  assert.deepStrictEqual(task.unresolved, []);
  assert.strictEqual(task.checkpoint, 0);
  assert.strictEqual(task.proofs.length, 0);
  assert.ok(!task.mechanical.some((item) => item.status === 'unresolved'));
  assert.ok(stateLines(home).some((line) => line === 'R observation-only result:pass'));
  assert.ok(!stateLines(home).some((line) => line.startsWith('C ')));
});

test('ground: multiple fail-open warnings are emitted as one valid hook response', () => {
  const home = freshHome();
  const session = 'ground-multiple-warnings';
  const turn = 'turn-multiple-warnings';
  const toolUseId = 'tool-multiple-warnings';
  const nonRepository = path.join(tmpRoot, `non-repository-${++serial}`);
  fs.mkdirSync(nonRepository, { recursive: true });
  const input = { command: 'node missing.js' };
  const pre = JSON.parse(preTool(home, session, 'Bash', input, nonRepository, toolUseId, turn));
  assert.ok(pre.hookSpecificOutput.updatedInput.command);
  const raw = postTool(home, session, 'Bash', input, 'synthetic output', nonRepository, toolUseId, turn);
  const parsed = JSON.parse(raw);
  assert.match(parsed.systemMessage, /repository comparison was unavailable/i);
  assert.match(parsed.systemMessage, /execution receipt.*missing|exit receipt.*missing/i);
  const notices = taskStateForSession(home, session).notices;
  assert.ok(notices.length >= 2);
  assert.ok(notices.every((notice) => notice.delivered === true));
});

test('ground: a repository-local PATH shadow cannot impersonate a trusted test executable', () => {
  const home = freshHome();
  const session = 'ground-path-shadow';
  const turn = 'turn-path-shadow';
  const toolUseId = 'tool-path-shadow';
  const name = process.platform === 'win32' ? 'pytest.cmd' : 'pytest';
  const body = process.platform === 'win32' ? '@echo off\r\nexit /b 0\r\n' : '#!/bin/sh\nexit 0\n';
  const repo = freshGitRepo([[name, body]]);
  if (process.platform !== 'win32') fs.chmodSync(path.join(repo, name), 0o755);
  const originalPath = process.env.PATH;
  process.env.PATH = `${repo}${path.delimiter}${originalPath}`;
  try {
    record(home, session, 'apply_patch', { command: '*** Update File: src/app.ts' }, {}, turn);
    const input = { command: 'pytest' };
    const pre = preTool(home, session, 'Bash', input, repo, toolUseId, turn);
    assert.strictEqual(pre.trim(), '', 'untrusted PATH shadow was wrapped as a qualifying execution');
    const execution = executeWrapped(input.command, repo);
    assert.strictEqual(execution.status, 0, execution.stderr);
    postTool(home, session, 'Bash', input, { exit_code: 0 }, repo, toolUseId, turn);
    assert.strictEqual(JSON.parse(stop(home, session, receipt, false, 'stop', turn, repo)).decision, 'block');
    assert.ok(!stateLines(home).some((line) => /^T proof-id:/.test(line)), 'PATH shadow emitted test proof');
  } finally {
    process.env.PATH = originalPath;
  }
});

test('ground: clean filters cannot hide worktree-byte changes from generated-change observation', () => {
  const home = freshHome();
  const session = 'ground-clean-filter';
  const turn = 'turn-clean-filter';
  const toolUseId = 'tool-clean-filter';
  const repo = freshGitRepo([
    ['.gitattributes', 'app.txt filter=hide\n'],
    ['app.txt', 'SAFE\n'],
    ['clean-filter.js', "process.stdin.resume(); process.stdin.on('end', () => process.stdout.write('SAFE\\n'));\n"],
    ['passthrough.js', 'process.stdin.pipe(process.stdout);\n'],
    ['mutate.js', "require('fs').writeFileSync('app.txt', 'SAFE\\nhidden runtime line\\n'); require('child_process').execFileSync('git', ['add', 'app.txt']);\n"],
  ]);
  execFileSync('git', ['config', 'filter.hide.clean', 'node clean-filter.js'], { cwd: repo });
  execFileSync('git', ['config', 'filter.hide.smudge', 'node passthrough.js'], { cwd: repo });
  execFileSync('git', ['config', 'filter.hide.required', 'true'], { cwd: repo });
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '--quiet', '--amend', '--no-edit'], { cwd: repo });

  record(home, session, 'apply_patch', { command: '*** Update File: src/other.ts' }, {}, turn);
  const input = { command: 'node mutate.js' };
  const pre = JSON.parse(preTool(home, session, 'Bash', input, repo, toolUseId, turn));
  const execution = executeWrapped(pre.hookSpecificOutput.updatedInput.command, repo);
  assert.strictEqual(execution.status, 0, execution.stderr);
  postTool(home, session, 'Bash', input, execution.stdout, repo, toolUseId, turn);
  assert.strictEqual(execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }), '');
  assert.match(fs.readFileSync(path.join(repo, 'app.txt'), 'utf8'), /hidden runtime line/);
  assert.ok(stateLines(home).some((line) => line.startsWith('G ')), 'filter-hidden change did not re-arm proof');
  assert.strictEqual(JSON.parse(stop(home, session, receipt, false, 'stop', turn, repo)).decision, 'block');
});

test('ground: pending PreToolUse survives compaction and is reconciled by a later-turn Stop', () => {
  const home = freshHome();
  const session = 'ground-pending-compaction';
  const sourceTurn = 'turn-before-compaction';
  const stopTurn = 'turn-after-compaction';
  const toolUseId = 'tool-before-compaction';
  const repo = freshGitRepo([
    ['src/app.js', "module.exports = 'before';\n"],
    ['mutate.js', "require('fs').writeFileSync('src/app.js', `module.exports = 'after';\\n`);\n"],
  ]);
  const input = { command: 'node mutate.js' };
  const pre = JSON.parse(preTool(home, session, 'Bash', input, repo, toolUseId, sourceTurn));
  const execution = executeWrapped(pre.hookSpecificOutput.updatedInput.command, repo);
  assert.strictEqual(execution.status, 0, execution.stderr);
  runHook(ACTIVATE, { session_id: session, hook_event_name: 'SessionStart', source: 'compact' }, home);
  const result = stop(home, session, '', false, 'stop', stopTurn, repo);
  assert.strictEqual(JSON.parse(result).decision, 'block');
  const task = taskStateForSession(home, session);
  assert.strictEqual(task.pendingObservations.length, 0);
  assert.ok(task.dirtyEdits.length > 0 || task.unresolved.length > 0);
  assert.ok(stateLines(home).some((line) => line.startsWith('G ')));
});

test('ground/router: pending observations are release-visible before Stop reconciliation', () => {
  const home = freshHome();
  const session = 'ground-pending-status';
  const repo = freshGitRepo([['scripts/live.js', "process.stdout.write('ok\\n');\n"]]);
  preTool(home, session, 'Bash', { command: 'node scripts/live.js' }, repo, 'pending-status-tool', 'pending-status-turn');
  const status = JSON.parse(prompt(home, session, 'DevRigorSTATUS')).hookSpecificOutput.additionalContext;
  assert.match(status, /pending (?:tool |repository )?observations?:\s*1\b|in-flight (?:tool )?observations?:\s*1\b/i);
  assert.match(status, /release[- ]blocking/i);
});

test('router: parent STATUS aggregates child dirty edits and in-flight observations before child Stop', () => {
  const home = freshHome();
  const parent = 'status-dirty-parent';
  const child = 'status-dirty-child';
  ensureActivated(home, parent);
  runHook(ACTIVATE, {
    session_id: child, parent_session_id: parent, hook_event_name: 'SubagentStart',
  }, home, ['subagent']);
  record(home, child, 'apply_patch', { command: '*** Update File: src/child.ts' }, {}, 'child-edit-turn');
  const repo = freshGitRepo([['scripts/live.js', "process.stdout.write('ok\\n');\n"]]);
  preTool(home, child, 'Bash', { command: 'node scripts/live.js' }, repo, 'child-pending-tool', 'child-pending-turn');
  const status = JSON.parse(prompt(home, parent, 'DevRigorSTATUS')).hookSpecificOutput.additionalContext;
  assert.match(status, /subagent dirty edits:\s*1\b/i);
  assert.match(status, /subagent pending observations:\s*1\b/i);
  const reminder = JSON.parse(prompt(home, parent, 'fix src/app.ts', 'parent-coding-turn')).hookSpecificOutput.additionalContext;
  assert.match(reminder, /associated-subagent task\(s\) with dirty edits/i);
  assert.match(reminder, /associated-subagent task\(s\) with pending tool observations/i);
  assert.match(reminder, /Release gates remain blocked/i);
});

test('ground: task state copied from another task is rejected by immutable task identity', () => {
  const home = freshHome();
  const sessionA = 'task-identity-a';
  const sessionB = 'task-identity-b';
  ensureActivated(home, sessionA);
  ensureActivated(home, sessionB);
  record(home, sessionA, 'apply_patch', { command: '*** Update File: src/app.ts' }, {}, 'identity-edit');
  fs.copyFileSync(taskStatePath(home, sessionB), taskStatePath(home, sessionA));
  const status = JSON.parse(runHook(ROUTER, {
    session_id: sessionA, turn_id: 'identity-status', prompt: 'DevRigorSTATUS',
  }, home)).hookSpecificOutput.additionalContext;
  assert.match(status, /mode:\s*WARN/i);
  assert.match(status, /task-state-(?:corrupt|identity)|identity mismatch/i);
  assert.doesNotMatch(status, /dirty edit:\s*no[\s\S]*mechanical debt:\s*no/i);
});

test('ground/router: unresolved mechanical records are never evicted before exact-set proof resolves them', () => {
  const home = freshHome();
  const session = 'ground-mechanical-retention';
  const turn = 'mechanical-retention-turn';
  for (let index = 0; index < 65; index++) record(home, session, 'Write', {}, {}, turn);
  assert.strictEqual(taskStateForSession(home, session).mechanical.filter((item) => item.status === 'unresolved').length, 65);
  record(home, session, 'Bash', { command: 'npm test' }, { exit_code: 0 }, turn);
  assert.strictEqual(stop(home, session, receipt, false, 'stop', turn).trim(), '');
  const task = taskStateForSession(home, session);
  assert.strictEqual(task.mechanical.filter((item) => item.status === 'unresolved').length, 0);
  const status = JSON.parse(prompt(home, session, 'DevRigorSTATUS')).hookSpecificOutput.additionalContext;
  assert.match(status, /mechanical debt:\s*no/i);
});

test('hooks: an old lock owned by a live process is never stolen', () => {
  const home = freshHome();
  const session = 'live-owner-lock';
  ensureActivated(home, session);
  const lock = path.join(home, 'dev-rigor-stack', 'state', `task-lock-v4-${stateHash(session)}`);
  fs.mkdirSync(lock);
  fs.writeFileSync(path.join(lock, 'owner'), `${process.pid}-live-owner`);
  const old = new Date(Date.now() - 120000);
  fs.utimesSync(lock, old, old);
  const output = runHook(ROUTER, {
    session_id: session, turn_id: 'lock-control', prompt: 'DevRigorOFF',
  }, home);
  const text = JSON.parse(output).hookSpecificOutput.additionalContext;
  assert.match(text, /task-lock-timeout|could not be persisted|fails open/i);
  assert.strictEqual(taskStateForSession(home, session).mode, 'ON');
  assert.ok(fs.existsSync(lock), 'live owner lock was stolen');
  for (const source of [ACTIVATE, ROUTER, GROUND].map((file) => fs.readFileSync(file, 'utf8'))) {
    assert.doesNotMatch(source, /mtimeMs\s*>\s*30000[\s\S]{0,300}renameSync\(target,\s*stale\)/,
      'runtime contains age-only lock stealing');
  }
});

test('ground: absent or ambiguous execution results cannot become proof', () => {
  const responses = [
    {},
    { content: [{ type: 'text', text: 'command completed' }] },
    { status: 'unknown' },
  ];
  for (const [index, response] of responses.entries()) {
    const home = freshHome();
    const session = `ground-ambiguous-result-${index}`;
    record(home, session, 'apply_patch', { command: '*** Update File: src/app.ts' });
    record(home, session, 'Bash', { command: 'npm test' }, response);
    assert.match(stop(home, session, receipt), /"decision":"block"/);
    assert.ok(!stateLines(home).some((line) => line.startsWith('T ')), 'ambiguous response emitted test proof');
  }

  const explicitTextHome = freshHome();
  record(explicitTextHome, 'ground-explicit-text-pass', 'apply_patch', { command: '*** Update File: src/app.ts' });
  record(explicitTextHome, 'ground-explicit-text-pass', 'Bash', { command: 'npm test' }, {
    content: [{ type: 'text', text: 'Exit code: 0\n12 passed' }],
  });
  assert.strictEqual(stop(explicitTextHome, 'ground-explicit-text-pass', receipt).trim(), '');
});

test('ground: a later qualifying turn clears the exact circuit-released edit debt', () => {
  const home = freshHome();
  const session = 'ground-cross-turn-debt';
  record(home, session, 'apply_patch', { command: '*** Update File: src/app.ts' }, {}, 'edit-turn');
  assert.match(stop(home, session, receipt, false, 'stop', 'edit-turn'), /"decision":"block"/);
  stop(home, session, receipt, true, 'stop', 'edit-turn');
  assert.strictEqual(taskState(home).unresolved.length, 1);

  record(home, session, 'Bash', { command: 'npm test' }, { exit_code: 0 }, 'proof-turn');
  assert.strictEqual(stop(home, session, receipt, false, 'stop', 'proof-turn').trim(), '');
  const task = taskState(home);
  assert.strictEqual(task.dirtyEdits.length, 0);
  assert.strictEqual(task.unresolved.length, 0);
  assert.strictEqual(task.checkpoint, 1);
  assert.ok(stateLines(home).some((line) => line.startsWith('C ')));
});

test('ground: ledger append failure stays visible and cannot silently accept a dirty task', () => {
  const home = freshHome();
  const session = 'ground-ledger-write-failure';
  const turn = 'ledger-failure-turn';
  const state = path.join(home, 'dev-rigor-stack', 'state');
  fs.mkdirSync(state, { recursive: true });
  const ledgerId = crypto.createHash('sha256').update(session).update('\0').update(turn).update('\0').digest('hex');
  fs.mkdirSync(path.join(state, `ground-v4-${ledgerId}.log`));

  const warning = record(home, session, 'apply_patch', { command: '*** Update File: src/app.ts' }, {}, turn);
  assert.match(warning, /systemMessage/i);
  stop(home, session, receipt, false, 'stop', turn);
  const task = taskState(home);
  assert.strictEqual(task.dirtyEdits.length, 1);
  assert.strictEqual(task.unresolved.length, 1);
  const status = JSON.parse(prompt(home, session, 'DevRigorSTATUS'));
  assert.match(status.hookSpecificOutput.additionalContext, /mechanical debt:\s*yes/i);
});

test('ground: failed K persistence releases visibly without erasing unresolved proof state', () => {
  const home = freshHome();
  const session = 'ground-k-append-failure';
  const turn = 'turn-k-append-failure';
  record(home, session, 'apply_patch', { command: '*** Update File: src/app.ts' }, {}, turn);
  const output = runHookWithAppendFailure(GROUND, {
    session_id: session,
    turn_id: turn,
    hook_event_name: 'Stop',
    stop_hook_active: false,
    last_assistant_message: 'Done.',
  }, home, 'K', ['check']);
  expectSystemMessage(output, /could not persist.*block|ledger.*persist/i);
  const task = taskStateForSession(home, session);
  assert.strictEqual(task.dirtyEdits.length, 1);
  assert.strictEqual(task.unresolved.length, 1);
  assert.ok(task.mechanical.some((item) => item.status === 'unresolved' && item.reason === 'ledger-write-failed'));
  assert.ok(!stateLines(home).some((line) => line.startsWith('K ')), 'failed K unexpectedly reached the ledger');
});

test('ground: failed U persistence remains visible and does not checkpoint proof debt', () => {
  const home = freshHome();
  const session = 'ground-u-append-failure';
  const turn = 'turn-u-append-failure';
  record(home, session, 'apply_patch', { command: '*** Update File: src/app.ts' }, {}, turn);
  assert.strictEqual(JSON.parse(stop(home, session, 'Done.', false, 'stop', turn)).decision, 'block');
  const output = runHookWithAppendFailure(GROUND, {
    session_id: session,
    turn_id: turn,
    hook_event_name: 'Stop',
    stop_hook_active: true,
    last_assistant_message: 'Still working.',
  }, home, 'U', ['check']);
  expectSystemMessage(output, /could not persist.*release|ledger.*persist/i);
  const task = taskStateForSession(home, session);
  assert.strictEqual(task.dirtyEdits.length, 1);
  assert.strictEqual(task.unresolved.length, 1);
  assert.strictEqual(task.checkpoint, 0);
  assert.ok(task.mechanical.some((item) => item.status === 'unresolved' && item.reason === 'ledger-write-failed'));
  assert.ok(!stateLines(home).some((line) => line.startsWith('U ')), 'failed U unexpectedly reached the ledger');
});

test('ground: failed C persistence cannot accept proof or clear the dirty edit set', () => {
  const home = freshHome();
  const session = 'ground-c-append-failure';
  const turn = 'turn-c-append-failure';
  record(home, session, 'apply_patch', { command: '*** Update File: src/app.ts' }, {}, turn);
  record(home, session, 'Bash', { command: 'npm test' }, { exit_code: 0 }, turn);
  const output = runHookWithAppendFailure(GROUND, {
    session_id: session,
    turn_id: turn,
    hook_event_name: 'Stop',
    stop_hook_active: false,
    last_assistant_message: receipt,
  }, home, 'C', ['check']);
  expectSystemMessage(output, /proof checkpoint.*could not persist|ledger.*persist/i);
  const task = taskStateForSession(home, session);
  assert.strictEqual(task.dirtyEdits.length, 1);
  assert.strictEqual(task.unresolved.length, 1);
  assert.strictEqual(task.checkpoint, 0);
  assert.ok(task.mechanical.some((item) => item.status === 'unresolved' && item.reason === 'ledger-write-failed'));
  assert.ok(!stateLines(home).some((line) => line.startsWith('C ')), 'failed C unexpectedly reached the ledger');
});

test('ground: a copied proof event from another turn cannot clear proof debt', () => {
  const home = freshHome();
  const session = 'ground-copied-proof';
  const sourceTurn = 'turn-proof-source';
  const targetTurn = 'turn-proof-target';
  record(home, session, 'apply_patch', { command: '*** Update File: src/app.ts' }, {}, sourceTurn);
  record(home, session, 'Bash', { command: 'npm test' }, { exit_code: 0 }, sourceTurn);
  const proofLine = stateLines(home).find((line) => line.startsWith('T '));
  assert.ok(proofLine, 'source proof was not recorded');
  const state = path.join(home, 'dev-rigor-stack', 'state');
  const targetLedgerId = crypto.createHash('sha256').update(session).update('\0').update(targetTurn).update('\0').digest('hex');
  fs.appendFileSync(path.join(state, `ground-v4-${targetLedgerId}.log`), `${proofLine}\n`);

  const output = stop(home, session, receipt, false, 'stop', targetTurn);
  expectSystemMessage(output, /proof event.*task turn|proof.*mismatch/i);
  const task = taskStateForSession(home, session);
  assert.strictEqual(task.dirtyEdits.length, 1);
  assert.strictEqual(task.checkpoint, 0);
  assert.ok(task.mechanical.some((item) => item.status === 'unresolved' && item.reason === 'evidence-mismatch'));
  assert.ok(!stateLines(home).some((line) => line.startsWith('C ')), 'copied evidence was checkpointed');
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

test('ground: any failure across multiple structured test results wins', () => {
  const home = freshHome();
  record(home, 'ground-structured-many', 'apply_patch', { command: '*** Update File: src/app.ts' });
  record(home, 'ground-structured-many', 'Bash', { command: 'npm test' }, {
    exit_code: 0,
    phases: [
      { test_result: { passed: 5, failed: 0 } },
      { test_result: { passed: 3, failed: 1 } },
    ],
  });
  const parsed = JSON.parse(stop(home, 'ground-structured-many', receipt));
  assert.strictEqual(parsed.decision, 'block');
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

test('ground: check-only formatters do not fabricate generated changes', () => {
  const home = freshHome();
  record(home, 'ground-format-check', 'Bash', { command: 'prettier --check .' }, { exit_code: 0 });
  assert.strictEqual(stop(home, 'ground-format-check', 'Formatting check passed.').trim(), '');
  assert.ok(!stateLines(home).some((line) => line.startsWith('G ')));
});

test('ground: qualifying evidence token is bound to task, turn, edit set, and result', () => {
  const home = freshHome();
  record(home, 'ground-token', 'apply_patch', { command: '*** Update File: src/app.ts' }, {}, 'turn-a');
  record(home, 'ground-token', 'Bash', { command: 'npm test' }, { exit_code: 0 }, 'turn-a');
  const proof = stateLines(home).find((line) => line.startsWith('T '));
  assert.match(proof || '', /proof-id:[a-f0-9]{16}/);
  assert.match(proof || '', /edit-set:[a-f0-9]{16}/);
  expectSystemMessage(stop(home, 'ground-token', 'proved: proof-id:deadbeefdeadbeef · blast: low · skipped: none', false, 'stop', 'turn-a'), /proof-id did not match/i);
  assert.ok(stateLines(home).some((line) => line.startsWith('W ') && /invalid-proof-id/.test(line)));
});

test('ground: evidence tokens bind the exact execution fingerprint and target checkpoint', () => {
  const home = freshHome();
  record(home, 'ground-token-execution', 'apply_patch', { command: '*** Update File: src/app.ts' }, {}, 'turn-token');
  record(home, 'ground-token-execution', 'Bash', { command: 'npm test -- --runInBand' }, { exit_code: 0 }, 'turn-token');
  record(home, 'ground-token-execution', 'Bash', { command: 'npm test -- --coverage' }, { exit_code: 0 }, 'turn-token');
  const proofs = stateLines(home).filter((line) => line.startsWith('T '));
  assert.strictEqual(proofs.length, 2);
  const tokens = proofs.map((line) => line.match(/proof-id:([a-f0-9]{16})/)[1]);
  assert.notStrictEqual(tokens[0], tokens[1], 'different executions produced a reusable token');
  for (const proof of proofs) {
    assert.match(proof, /exec:[a-f0-9]{16}/);
    assert.match(proof, /checkpoint:1\b/);
  }

  // The descriptor also contains command and response hashes, so merely
  // comparing two ordinary executions would not prove that the HMAC itself
  // binds executionHash. Rewrite every non-HMAC copy of the execution hash;
  // the unchanged token must then be rejected.
  const attackHome = freshHome();
  const session = 'ground-token-execution-tamper';
  const turn = 'turn-token-execution-tamper';
  record(attackHome, session, 'apply_patch', { command: '*** Update File: src/app.ts' }, {}, turn);
  record(attackHome, session, 'Bash', { command: 'npm test' }, { exit_code: 0 }, turn);
  const state = path.join(attackHome, 'dev-rigor-stack', 'state');
  const ledgerTarget = path.join(state, stateFiles(attackHome, 'ground-v4-')[0]);
  const proofLine = fs.readFileSync(ledgerTarget, 'utf8').split('\n').find((line) => /^T proof-id:/.test(line));
  const originalExecution = proofLine.match(/exec:([a-f0-9]{16})/)[1];
  const forgedExecution = originalExecution === 'fedcba9876543210' ? '0123456789abcdef' : 'fedcba9876543210';
  fs.writeFileSync(ledgerTarget, fs.readFileSync(ledgerTarget, 'utf8').replace(
    `exec:${originalExecution}`, `exec:${forgedExecution}`
  ));
  const taskTarget = taskStatePath(attackHome, session);
  const task = JSON.parse(fs.readFileSync(taskTarget, 'utf8'));
  task.proofs[0].executionHash = forgedExecution;
  fs.writeFileSync(taskTarget, JSON.stringify(task));
  const evidenceTarget = path.join(state, stateFiles(attackHome, 'evidence-v4-')[0]);
  const evidence = JSON.parse(fs.readFileSync(evidenceTarget, 'utf8'));
  evidence.executionHash = forgedExecution;
  fs.writeFileSync(evidenceTarget, JSON.stringify(evidence));
  expectSystemMessage(stop(attackHome, session, 'Done.', false, 'stop', turn), /proof event does not match/i);
  assert.strictEqual(taskStateForSession(attackHome, session).checkpoint, 0,
    'a token detached from the execution fingerprint reached a checkpoint');
});

test('ground: canonical evidence record is privacy-safe, semantic, and token-bound', () => {
  const home = freshHome();
  const session = 'ground-evidence-record';
  const turn = 'turn-evidence-record';
  const secret = 'SUPER_SECRET_ARGUMENT_7d3f';
  record(home, session, 'apply_patch', { command: '*** Update File: src/app.ts' }, {}, turn);
  record(home, session, 'Bash', { command: `npm test -- --token ${secret}` }, {
    exit_code: 0, test_result: { passed: 12, failed: 0 },
  }, turn);
  const files = stateFiles(home, 'evidence-v4-');
  assert.strictEqual(files.length, 1, 'qualifying proof has no canonical evidence record');
  const state = path.join(home, 'dev-rigor-stack', 'state');
  const raw = fs.readFileSync(path.join(state, files[0]), 'utf8');
  const evidence = JSON.parse(raw);
  assert.doesNotMatch(raw, new RegExp(secret));
  assert.doesNotMatch(JSON.stringify(taskStateForSession(home, session)), new RegExp(secret));
  assert.strictEqual(evidence.version, 4);
  assert.strictEqual(evidence.eventClass, 'T');
  assert.strictEqual(evidence.descriptor.executable, 'npm');
  assert.strictEqual(evidence.descriptor.operation, 'package-test');
  assert.match(evidence.descriptor.commandHash, /^[a-f0-9]{16}$/);
  assert.match(evidence.descriptor.originHash, /^[a-f0-9]{16}$/);
  assert.match(evidence.descriptorHash, /^[a-f0-9]{16}$/);
  assert.match(evidence.executionHash, /^[a-f0-9]{16}$/);
  assert.strictEqual(evidence.checkpoint, 1);
  assert.match(stateLines(home).find((line) => /^T proof-id:/.test(line)) || '',
    new RegExp(`descriptor:${evidence.descriptorHash}`));
  const pendingStatus = JSON.parse(prompt(home, session, 'DevRigorSTATUS')).hookSpecificOutput.additionalContext;
  assert.match(pendingStatus, /latest accepted proof:\s*none/i);
  assert.match(pendingStatus, /proof candidates awaiting Stop:\s*1\b/i);
  assert.strictEqual(stop(home, session, receipt, false, 'stop', turn).trim(), '');
  const acceptedStatus = JSON.parse(prompt(home, session, 'DevRigorSTATUS')).hookSpecificOutput.additionalContext;
  assert.match(acceptedStatus, /latest accepted proof:\s*T\s*\/\s*[a-f0-9]{16}\s*\/\s*npm:package-test/i);
  assert.match(acceptedStatus, /proof candidates awaiting Stop:\s*0\b/i);
});

test('ground: missing or tampered canonical evidence cannot checkpoint proof', () => {
  for (const action of ['delete', 'tamper']) {
    const home = freshHome();
    const session = `ground-evidence-${action}`;
    const turn = `turn-evidence-${action}`;
    record(home, session, 'apply_patch', { command: '*** Update File: src/app.ts' }, {}, turn);
    record(home, session, 'Bash', { command: 'npm test' }, { exit_code: 0 }, turn);
    const state = path.join(home, 'dev-rigor-stack', 'state');
    const target = path.join(state, stateFiles(home, 'evidence-v4-')[0]);
    if (action === 'delete') fs.unlinkSync(target);
    else {
      const evidence = JSON.parse(fs.readFileSync(target, 'utf8'));
      evidence.descriptor.operation = 'forged-operation';
      fs.writeFileSync(target, JSON.stringify(evidence) + '\n');
    }
    expectSystemMessage(stop(home, session, receipt, false, 'stop', turn), /evidence.*does not match|proof event does not match/i);
    const task = taskStateForSession(home, session);
    assert.ok(task.dirtyEdits.length > 0);
    assert.strictEqual(task.checkpoint, 0);
    assert.ok(!stateLines(home).some((line) => line.startsWith('C proof-accepted')));
  }
});

test('ground/router: warnings are visible and unresolved debt is injected into the next coding turn', () => {
  const home = freshHome();
  prompt(home, 'visible-warn', 'DevRigorWARN');
  record(home, 'visible-warn', 'apply_patch', { command: '*** Update File: src/warn.ts' }, {}, 'turn-warn');
  const warning = JSON.parse(stop(home, 'visible-warn', 'Done.', false, 'stop', 'turn-warn'));
  assert.match(warning.systemMessage, /unproved edit/i);

  prompt(home, 'visible-debt', 'DevRigorON');
  record(home, 'visible-debt', 'apply_patch', { command: '*** Update File: src/debt.ts' }, {}, 'turn-debt');
  assert.strictEqual(JSON.parse(stop(home, 'visible-debt', 'Done.', false, 'stop', 'turn-debt')).decision, 'block');
  const released = JSON.parse(stop(home, 'visible-debt', 'Continuing after the block.', true, 'stop', 'turn-debt'));
  assert.match(released.systemMessage, /released-unproved|proof debt/i);
  const debtId = taskStateForSession(home, 'visible-debt').unresolved[0].id;
  const next = JSON.parse(prompt(home, 'visible-debt', 'fix it', 'turn-next'));
  assert.match(next.hookSpecificOutput.additionalContext, /DEV-RIGOR PROOF DEBT/i);
  assert.match(next.hookSpecificOutput.additionalContext, new RegExp(debtId));
});

test('router: STATUS reports checkpoints, block count, debt identifiers, and observed delivery without overclaiming trust', () => {
  const home = freshHome();
  record(home, 'status-evidence', 'apply_patch', { command: '*** Update File: src/app.ts' }, {}, 'turn-status');
  assert.strictEqual(JSON.parse(stop(home, 'status-evidence', 'Done.', false, 'stop', 'turn-status')).decision, 'block');
  stop(home, 'status-evidence', 'Retry.', true, 'stop', 'turn-status');
  const debtId = taskState(home).unresolved[0].id;
  const status = JSON.parse(prompt(home, 'status-evidence', 'DevRigorSTATUS'));
  const text = status.hookSpecificOutput.additionalContext;
  assert.match(text, /checkpoint:\s*0/i);
  assert.match(text, /substantive blocks:\s*1/i);
  assert.match(text, new RegExp(debtId));
  assert.match(text, /delivery observed:/i);
  assert.match(text, /trust:\s*not established by task ledger/i);
  assert.doesNotMatch(text, /hook delivery:\s*verified/i);
});

test('router: parent STATUS aggregates authoritatively associated subagent proof debt', () => {
  const home = freshHome();
  ensureActivated(home, 'status-parent');
  runHook(ACTIVATE, {
    session_id: 'status-child', parent_session_id: 'status-parent', hook_event_name: 'SubagentStart', turn_id: 'turn-child',
  }, home, ['subagent']);
  record(home, 'status-child', 'apply_patch', { command: '*** Update File: src/child.ts' }, {}, 'turn-child');
  assert.strictEqual(JSON.parse(stop(home, 'status-child', 'Done.', false, 'subagent', 'turn-child')).decision, 'block');
  stop(home, 'status-child', 'Retry.', true, 'subagent', 'turn-child');
  const childDebt = taskStateForSession(home, 'status-child').unresolved[0].id;
  const status = JSON.parse(prompt(home, 'status-parent', 'DevRigorSTATUS'));
  const text = status.hookSpecificOutput.additionalContext;
  assert.match(text, /associated subagents:\s*1/i);
  assert.match(text, /subagent unresolved proof:\s*1/i);
  assert.match(text, new RegExp(childDebt));
});

test('activate/router: 32 concurrent and nested authoritative children all remain release-visible', async () => {
  const home = freshHome();
  const parent = 'concurrent-parent';
  ensureActivated(home, parent);
  await Promise.all(Array.from({ length: 32 }, (_, index) => runHookAsync(ACTIVATE, {
    session_id: `concurrent-child-${index}`,
    parent_session_id: parent,
    hook_event_name: 'SubagentStart',
  }, home, ['subagent'])));
  runHook(ACTIVATE, {
    session_id: 'concurrent-grandchild',
    parent_session_id: 'concurrent-child-0',
    hook_event_name: 'SubagentStart',
  }, home, ['subagent']);
  record(home, 'concurrent-grandchild', 'apply_patch', { command: '*** Update File: src/grandchild.ts' }, {}, 'grandchild-turn');
  assert.strictEqual(JSON.parse(stop(home, 'concurrent-grandchild', 'Done.', false, 'subagent', 'grandchild-turn')).decision, 'block');
  stop(home, 'concurrent-grandchild', 'Continued.', true, 'subagent', 'grandchild-turn');
  const status = JSON.parse(prompt(home, parent, 'DevRigorSTATUS'));
  const text = status.hookSpecificOutput.additionalContext;
  assert.match(text, /associated subagents:\s*33/i);
  assert.match(text, /subagent unresolved proof:\s*1/i);
  assert.match(text, new RegExp(taskStateForSession(home, 'concurrent-grandchild').unresolved[0].id));
});

test('activate/ground: OFF propagates through the full authoritative parent chain', () => {
  const home = freshHome();
  ensureActivated(home, 'nested-root');
  runHook(ACTIVATE, {
    session_id: 'nested-child', parent_session_id: 'nested-root', hook_event_name: 'SubagentStart',
  }, home, ['subagent']);
  runHook(ACTIVATE, {
    session_id: 'nested-grandchild', parent_session_id: 'nested-child', hook_event_name: 'SubagentStart',
  }, home, ['subagent']);
  prompt(home, 'nested-root', 'DevRigorOFF');
  record(home, 'nested-grandchild', 'apply_patch', { command: '*** Update File: src/nested.ts' }, {}, 'nested-turn');
  assert.strictEqual(stop(home, 'nested-grandchild', 'Done.', false, 'subagent', 'nested-turn').trim(), '');
});

test('ground/router: retention never erases unresolved associated child debt', () => {
  const home = freshHome();
  ensureActivated(home, 'retained-debt-parent');
  runHook(ACTIVATE, {
    session_id: 'retained-debt-child', parent_session_id: 'retained-debt-parent', hook_event_name: 'SubagentStart',
  }, home, ['subagent']);
  record(home, 'retained-debt-child', 'apply_patch', { command: '*** Update File: src/retained.ts' }, {}, 'retained-turn');
  assert.strictEqual(JSON.parse(stop(home, 'retained-debt-child', 'Done.', false, 'subagent', 'retained-turn')).decision, 'block');
  stop(home, 'retained-debt-child', 'Continued.', true, 'subagent', 'retained-turn');
  const childKey = crypto.createHash('sha256').update('retained-debt-child').update('\0').digest('hex');
  const childState = path.join(home, 'dev-rigor-stack', 'state', `task-v4-${childKey}.json`);
  const old = new Date(Date.now() - 8 * 24 * 3600 * 1000);
  fs.utimesSync(childState, old, old);
  record(home, 'retained-debt-parent', 'Bash', { command: 'echo maintenance' }, { exit_code: 0 }, 'maintenance-turn');
  assert.ok(fs.existsSync(childState), 'retention deleted unresolved child task state');
  const status = JSON.parse(prompt(home, 'retained-debt-parent', 'DevRigorSTATUS'));
  assert.match(status.hookSpecificOutput.additionalContext, /associated subagents:\s*1/i);
  assert.match(status.hookSpecificOutput.additionalContext, /subagent unresolved proof:\s*1/i);
});

test('router: exact task controls change only that task and quoted controls do not', () => {
  const home = freshHome();
  runHook(ACTIVATE, { session_id: 'control-b', hook_event_name: 'SessionStart' }, home);
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
  expectSystemMessage(stop(home, 'mode-warn', ''), /unproved edit was released/i);
  assert.ok(stateLines(home).some((line) => line.startsWith('W ')));

  record(home, 'mode-on', 'apply_patch', { command: '*** Update File: src/on.ts' });
  assert.strictEqual(JSON.parse(stop(home, 'mode-on', '')).decision, 'block');
});

test('ground: stop_hook_active is an anti-loop guard', () => {
  const home = freshHome();
  record(home, 'ground-6', 'apply_patch', { command: '*** Update File: src/app.py' });
  expectSystemMessage(stop(home, 'ground-6', '', true), /proof debt remains unresolved/i);
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

test('hooks: a task lock left by a dead process is reclaimed without losing the edit event', () => {
  const home = freshHome();
  const session = 'lock-dead-owner';
  ensureActivated(home, session);
  const lock = path.join(home, 'dev-rigor-stack', 'state', `task-lock-v4-${stateHash(session)}`);
  fs.mkdirSync(lock, { recursive: true });
  fs.writeFileSync(path.join(lock, 'owner'), `99999999-${'a'.repeat(24)}`);

  const output = record(home, session, 'apply_patch', {
    command: '*** Update File: src/dead-lock.ts',
  }, {}, 'dead-lock-turn', { DEV_RIGOR_LOCK_TIMEOUT_MS: '250' });
  assert.doesNotMatch(output, /task-lock-timeout/i);
  assert.ok(stateLines(home).some((line) => /^E /.test(line)), 'the recovered invocation lost its edit');
  assert.doesNotMatch(stateLines(home, 'mechanical-v4-').join('\n'), /reason:task-lock-timeout/);
});

test('hooks: a task lock directory with no owner is reclaimed without losing the edit event', () => {
  const home = freshHome();
  const session = 'lock-missing-owner';
  ensureActivated(home, session);
  const lock = path.join(home, 'dev-rigor-stack', 'state', `task-lock-v4-${stateHash(session)}`);
  fs.mkdirSync(lock, { recursive: true });

  const output = record(home, session, 'apply_patch', {
    command: '*** Update File: src/missing-owner.ts',
  }, {}, 'missing-owner-turn', { DEV_RIGOR_LOCK_TIMEOUT_MS: '250' });
  assert.doesNotMatch(output, /task-lock-timeout/i);
  assert.ok(stateLines(home).some((line) => /^E /.test(line)), 'the recovered invocation lost its edit');
  assert.doesNotMatch(stateLines(home, 'mechanical-v4-').join('\n'), /reason:task-lock-timeout/);
});

test('hooks: a reused live PID with a mismatched persisted process identity is reclaimed', () => {
  const home = freshHome();
  const session = 'lock-pid-reuse';
  ensureActivated(home, session);
  const lock = path.join(home, 'dev-rigor-stack', 'state', `task-lock-v4-${stateHash(session)}`);
  fs.mkdirSync(lock, { recursive: true });
  fs.writeFileSync(path.join(lock, 'owner'), JSON.stringify({
    version: 4,
    pid: process.pid,
    processStartIdentity: 'not-the-current-process-start',
    nonce: 'b'.repeat(24),
  }));

  const output = record(home, session, 'apply_patch', {
    command: '*** Update File: src/reused-pid.ts',
  }, {}, 'pid-reuse-turn', { DEV_RIGOR_LOCK_TIMEOUT_MS: '250' });
  assert.doesNotMatch(output, /task-lock-timeout/i);
  assert.ok(stateLines(home).some((line) => /^E /.test(line)), 'PID reuse recovery lost its edit');
});

test('activate: a crash after first task genesis creation recovers the exact pending task', () => {
  const home = freshHome();
  const session = 'activation-genesis-crash';
  const first = runActivationWithTaskRenameFailure({
    session_id: session, hook_event_name: 'SessionStart',
  }, home);
  assert.match(first, /mode:\s*WARN/i);
  const state = path.join(home, 'dev-rigor-stack', 'state');
  assert.strictEqual(stateFiles(home, 'task-genesis-v4-').length, 1, 'fault did not reach the post-genesis window');
  assert.strictEqual(fs.readdirSync(state).filter((name) => /^task-v4-[a-f0-9]{64}\.json$/.test(name)).length, 0,
    'fault unexpectedly committed the task');
  assert.ok(fs.readdirSync(state).some((name) => /^task-v4-[a-f0-9]{64}\.json\..+\.tmp$/.test(name)), 'recoverable exact task temporary was not preserved');

  const resumed = runHook(ACTIVATE, {
    session_id: session, hook_event_name: 'SessionStart', source: 'resume',
  }, home);
  assert.match(resumed, /Current task mode:\s*ON/i);
  assert.strictEqual(stateFiles(home, 'task-v4-').length, 1);
  assert.strictEqual(stateFiles(home, 'task-genesis-v4-').length, 1);
  const status = JSON.parse(prompt(home, session, 'DevRigorSTATUS')).hookSpecificOutput.additionalContext;
  assert.match(status, /mechanical debt:\s*no/i);
});

test('router: a dirty edit persisted before Stop is reminded after compaction', () => {
  const home = freshHome();
  const session = 'dirty-before-stop-compaction';
  record(home, session, 'apply_patch', {
    command: '*** Update File: src/dirty-before-stop.ts',
  }, {}, 'edit-before-crash');
  runHook(ACTIVATE, {
    session_id: session, hook_event_name: 'SessionStart', source: 'compact',
  }, home);

  const raw = prompt(home, session, 'fix src/dirty-before-stop.ts', 'turn-after-compact');
  assert.ok(raw.trim(), 'the resumed coding prompt received no dirty-state reminder');
  const context = JSON.parse(raw).hookSpecificOutput.additionalContext;
  assert.match(context, /DEV-RIGOR PROOF DEBT/i);
  assert.match(context, /dirty edit/i);
  assert.match(context, /Release gates remain blocked/i);
});

test('router: parent STATUS and reminders aggregate invalid child and grandchild canonical evidence', () => {
  const home = freshHome();
  const parent = 'invalid-evidence-parent';
  const child = 'invalid-evidence-child';
  const grandchild = 'invalid-evidence-grandchild';
  ensureActivated(home, parent);
  runHook(ACTIVATE, {
    session_id: child, parent_session_id: parent, hook_event_name: 'SubagentStart',
  }, home, ['subagent']);
  runHook(ACTIVATE, {
    session_id: grandchild, parent_session_id: child, hook_event_name: 'SubagentStart',
  }, home, ['subagent']);

  for (const [session, turn, file] of [
    [child, 'child-proof-turn', 'src/child-proof.ts'],
    [grandchild, 'grandchild-proof-turn', 'src/grandchild-proof.ts'],
  ]) {
    record(home, session, 'apply_patch', { command: `*** Update File: ${file}` }, {}, turn);
    record(home, session, 'Bash', { command: 'npm test' }, { exit_code: 0 }, turn);
    assert.strictEqual(stop(home, session, receipt, false, 'stop', turn).trim(), '');
    const task = taskStateForSession(home, session);
    const accepted = task.proofs.find((proof) => proof.checkpoint === task.checkpoint);
    assert.ok(accepted, `${session} did not establish the test precondition`);
    fs.unlinkSync(path.join(home, 'dev-rigor-stack', 'state', accepted.evidence));
  }

  const childStatus = JSON.parse(prompt(home, child, 'DevRigorSTATUS')).hookSpecificOutput.additionalContext;
  const grandchildStatus = JSON.parse(prompt(home, grandchild, 'DevRigorSTATUS')).hookSpecificOutput.additionalContext;
  assert.match(childStatus, /latest accepted proof:\s*invalid canonical evidence/i);
  assert.match(grandchildStatus, /latest accepted proof:\s*invalid canonical evidence/i);

  const parentStatus = JSON.parse(prompt(home, parent, 'DevRigorSTATUS')).hookSpecificOutput.additionalContext;
  assert.match(parentStatus, /subagent invalid canonical evidence:\s*2\b/i);
  const reminder = JSON.parse(prompt(home, parent, 'fix src/parent.ts', 'parent-invalid-evidence-turn')).hookSpecificOutput.additionalContext;
  assert.match(reminder, /associated-subagent invalid canonical evidence/i);
  assert.match(reminder, /Release gates remain blocked/i);
});

test('ground: a failed edit call with no repository change does not create dirty state', () => {
  const home = freshHome();
  const session = 'failed-edit-no-change';
  const turn = 'failed-edit-turn';
  const toolUseId = 'failed-edit-tool';
  const input = { file_path: 'src/not-written.ts', old_string: 'old', new_string: 'new' };
  preTool(home, session, 'Edit', input, unitRepo, toolUseId, turn);
  postTool(home, session, 'Edit', input, {
    is_error: true, error: 'old_string was not found', status: 'failed',
  }, unitRepo, toolUseId, turn);
  assert.deepStrictEqual(taskStateForSession(home, session).dirtyEdits, []);
  assert.strictEqual(stop(home, session, 'The requested edit failed.', false, 'stop', turn).trim(), '');
});

test('ground: a cancelled edit call with no repository change does not create dirty state', () => {
  const home = freshHome();
  const session = 'cancelled-edit-no-change';
  const turn = 'cancelled-edit-turn';
  const toolUseId = 'cancelled-edit-tool';
  const input = { file_path: 'src/not-written.ts', content: 'not written' };
  preTool(home, session, 'Write', input, unitRepo, toolUseId, turn);
  postTool(home, session, 'Write', input, {
    success: false, status: 'cancelled', error: 'cancelled by owner',
  }, unitRepo, toolUseId, turn);
  assert.deepStrictEqual(taskStateForSession(home, session).dirtyEdits, []);
  assert.strictEqual(stop(home, session, 'The requested edit was cancelled.', false, 'stop', turn).trim(), '');
});

test('ground: a partially failed multi-edit records only authoritative changed paths', () => {
  const home = freshHome();
  const session = 'partial-multi-edit';
  const turn = 'partial-multi-turn';
  const toolUseId = 'partial-multi-tool';
  const repo = freshGitRepo([
    ['src/changed.ts', 'export const changed = 1;\n'],
    ['src/unchanged.ts', 'export const unchanged = 1;\n'],
  ]);
  const input = { edits: [
    { file_path: 'src/changed.ts', old_string: '1', new_string: '2' },
    { file_path: 'src/unchanged.ts', old_string: 'missing', new_string: '2' },
  ] };
  preTool(home, session, 'MultiEdit', input, repo, toolUseId, turn);
  fs.writeFileSync(path.join(repo, 'src', 'changed.ts'), 'export const changed = 2;\n');
  postTool(home, session, 'MultiEdit', input, {
    success: false, status: 'failed', changed_files: ['src/changed.ts'], error: 'second edit failed',
  }, repo, toolUseId, turn);

  assert.deepStrictEqual(taskStateForSession(home, session).dirtyEdits,
    [expectedArtifactId(repo, 'src/changed.ts')]);
  assert.match(stop(home, session, 'One edit applied before the second failed.', false, 'stop', turn, repo), /"decision":"block"/);
});

test('ground: an observed no-op formatter or generator does not fabricate a generated change', () => {
  for (const [index, command] of ['prettier --write src/app.js', 'npm run generate'].entries()) {
    const home = freshHome();
    const session = `observed-noop-generator-${index}`;
    const turn = `observed-noop-turn-${index}`;
    const repo = freshGitRepo([['src/app.js', 'module.exports = 1;\n']]);
    preTool(home, session, 'Bash', { command }, repo, `noop-tool-${index}`, turn);
    postTool(home, session, 'Bash', { command }, { exit_code: 0 }, repo, `noop-tool-${index}`, turn);
    assert.deepStrictEqual(taskStateForSession(home, session).dirtyEdits, [], `${command} fabricated dirty state`);
    assert.strictEqual(stop(home, session, 'No files changed.', false, 'stop', turn, repo).trim(), '');
  }
});

test('ground: retention preserves an aged snapshot referenced by a pending observation', () => {
  const home = freshHome();
  const session = 'aged-pending-snapshot';
  preTool(home, session, 'PowerShell', { command: 'Get-Date' }, unitRepo, 'aged-pending-tool', 'aged-pending-turn');
  const task = taskStateForSession(home, session);
  assert.strictEqual(task.pendingObservations.length, 1);
  const snapshot = path.join(home, 'dev-rigor-stack', 'state', task.pendingObservations[0].id);
  assert.ok(fs.existsSync(snapshot));
  const old = new Date(Date.now() - 8 * 24 * 3600 * 1000);
  fs.utimesSync(snapshot, old, old);

  record(home, 'aged-pending-pruner', 'apply_patch', {
    command: '*** Update File: src/pruner.ts',
  });
  assert.ok(fs.existsSync(snapshot), 'retention deleted an observation still referenced by task state');
});

test('ground: WARN surfaces one notice for one unchanged unproved edit state', () => {
  const home = freshHome();
  const session = 'warn-once-per-state';
  const turn = 'warn-once-turn';
  ensureActivated(home, session);
  prompt(home, session, 'DevRigorWARN');
  record(home, session, 'apply_patch', {
    command: '*** Update File: src/warn-once.ts',
  }, {}, turn);
  const first = stop(home, session, 'Changed the file.', false, 'stop', turn);
  const second = stop(home, session, 'Changed the file.', false, 'stop', turn);
  assert.match(first, /Dev Rigor WARN/i);
  assert.strictEqual(second.trim(), '', 'the same unchanged WARN state was delivered more than once');
});

test('ground: a stable repository with 20,001 indexed paths remains observable without fabricated debt', () => {
  const home = freshHome();
  const session = 'ground-20001-indexed-paths';
  const turn = 'turn-20001-indexed-paths';
  const toolUseId = 'tool-20001-indexed-paths';
  const repo = path.join(tmpRoot, `repo-many-index-paths-${++serial}`);
  fs.mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '--quiet'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'hooks@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Hook Tests'], { cwd: repo });
  const blob = execFileSync('git', ['hash-object', '-w', '--stdin'], {
    cwd: repo, input: Buffer.alloc(0), encoding: 'utf8',
  }).trim();
  const index = Array.from({ length: 20001 }, (_, position) =>
    `100644 ${blob}\tvirtual/file-${String(position).padStart(5, '0')}.txt\n`).join('');
  execFileSync('git', ['update-index', '--index-info'], {
    cwd: repo, input: index, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
  });
  const tree = execFileSync('git', ['write-tree'], { cwd: repo, encoding: 'utf8' }).trim();
  const commit = execFileSync('git', ['commit-tree', tree], {
    cwd: repo, input: 'fixture\n', encoding: 'utf8',
  }).trim();
  execFileSync('git', ['update-ref', 'HEAD', commit], { cwd: repo });

  const input = { command: 'Get-Date' };
  preTool(home, session, 'PowerShell', input, repo, toolUseId, turn);
  postTool(home, session, 'PowerShell', input, { exit_code: 0 }, repo, toolUseId, turn);
  const task = taskStateForSession(home, session);
  assert.deepStrictEqual(task.dirtyEdits, [], 'an unchanged large index fabricated a generated edit');
  assert.strictEqual(task.mechanical.filter((item) => item.status === 'unresolved').length, 0,
    'an unchanged large index fabricated release-blocking mechanical debt');
  assert.strictEqual(stop(home, session, 'Read-only inspection completed.', false, 'stop', turn, repo).trim(), '');
});

test('ground: a qualifying execution can prove an edit while a tracked dirty file exceeds 16 MiB', () => {
  const home = freshHome();
  const session = 'ground-large-dirty-file';
  const turn = 'turn-large-dirty-file';
  const toolUseId = 'tool-large-dirty-file';
  const repo = freshGitRepo([
    ['assets/large.bin', Buffer.alloc(16 * 1024 * 1024 + 1)],
    ['scripts/render.js', "process.stdout.write('rendered\\n');\n"],
  ]);
  const largeFile = path.join(repo, 'assets', 'large.bin');
  const handle = fs.openSync(largeFile, 'r+');
  try { fs.writeSync(handle, Buffer.from([1]), 0, 1, 0); }
  finally { fs.closeSync(handle); }
  record(home, session, 'apply_patch', {
    command: '*** Update File: assets/large.bin', cwd: repo,
  }, {}, turn);

  const input = { command: 'node scripts/render.js' };
  const pre = JSON.parse(preTool(home, session, 'Bash', input, repo, toolUseId, turn));
  const execution = executeWrapped(pre.hookSpecificOutput.updatedInput.command, repo);
  assert.strictEqual(execution.status, 0, execution.stderr);
  postTool(home, session, 'Bash', input, execution.stdout, repo, toolUseId, turn);
  assert.strictEqual(stop(home, session, receipt, false, 'stop', turn, repo).trim(), '');
  const task = taskStateForSession(home, session);
  assert.strictEqual(task.checkpoint, 1);
  assert.deepStrictEqual(task.dirtyEdits, []);
});

test('ground: an arbitrary external PATH shim cannot impersonate a supported runtime', () => {
  const home = freshHome();
  const session = 'ground-external-path-shim';
  const turn = 'turn-external-path-shim';
  const toolUseId = 'tool-external-path-shim';
  const repo = freshGitRepo([['scripts/render.js', "process.stdout.write('real render\\n');\n"]]);
  const shim = path.join(tmpRoot, `external-path-shim-${++serial}`);
  fs.mkdirSync(shim, { recursive: true });
  const filename = process.platform === 'win32' ? 'node.cmd' : 'node';
  const target = path.join(shim, filename);
  fs.writeFileSync(target, process.platform === 'win32'
    ? '@echo off\r\necho untrusted shim\r\nexit /b 0\r\n'
    : '#!/bin/sh\necho untrusted shim\nexit 0\n');
  if (process.platform !== 'win32') fs.chmodSync(target, 0o755);
  const environment = { PATH: `${shim}${path.delimiter}${process.env.PATH}` };
  record(home, session, 'apply_patch', {
    command: '*** Update File: src/app.ts', cwd: repo,
  }, {}, turn);
  const output = preTool(home, session, 'Bash', {
    command: 'node scripts/render.js',
  }, repo, toolUseId, turn, environment);
  assert.strictEqual(output.trim(), '', 'an arbitrary executable found earlier on PATH was trusted as substantive proof');
});

test('ground: same-path executable replacement between PreToolUse and PostToolUse invalidates proof', () => {
  const home = freshHome();
  const session = 'ground-same-path-executable-replacement';
  const turn = 'turn-same-path-executable-replacement';
  const toolUseId = 'tool-same-path-executable-replacement';
  const repo = freshGitRepo();
  const shim = path.join(tmpRoot, `replaceable-path-shim-${++serial}`);
  fs.mkdirSync(shim, { recursive: true });
  const filename = process.platform === 'win32' ? 'pytest.cmd' : 'pytest';
  const target = path.join(shim, filename);
  const before = process.platform === 'win32'
    ? '@echo off\r\necho BEFORE\r\nexit /b 0\r\n'
    : '#!/bin/sh\necho BEFORE\nexit 0\n';
  const after = process.platform === 'win32'
    ? '@echo off\r\necho AFTER!\r\nexit /b 0\r\n'
    : '#!/bin/sh\necho AFTER!\nexit 0\n';
  fs.writeFileSync(target, before);
  if (process.platform !== 'win32') fs.chmodSync(target, 0o755);
  const environment = { PATH: `${shim}${path.delimiter}${process.env.PATH}` };
  record(home, session, 'apply_patch', {
    command: '*** Update File: src/app.ts', cwd: repo,
  }, {}, turn);
  const input = { command: 'pytest -q' };
  const rawPre = preTool(home, session, 'Bash', input, repo, toolUseId, turn, environment);
  const parsedPre = rawPre.trim() ? JSON.parse(rawPre) : {};
  fs.writeFileSync(target, after);
  if (process.platform !== 'win32') fs.chmodSync(target, 0o755);
  const effective = parsedPre.hookSpecificOutput && parsedPre.hookSpecificOutput.updatedInput
    ? parsedPre.hookSpecificOutput.updatedInput.command : input.command;
  const execution = process.platform === 'win32'
    ? spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', effective], {
      cwd: repo, env: { ...process.env, ...environment }, encoding: 'utf8',
    })
    : spawnSync('bash', ['-c', effective], {
      cwd: repo, env: { ...process.env, ...environment }, encoding: 'utf8',
  });
  assert.strictEqual(execution.status, 0, execution.stderr);
  postTool(home, session, 'Bash', input, execution.stdout, repo, toolUseId, turn, environment);
  const stopOutput = stop(home, session, receipt, false, 'stop', turn, repo);
  assert.ok(stopOutput.trim(), 'same-path executable replacement was accepted as proof');
  assert.strictEqual(JSON.parse(stopOutput).decision, 'block');
  assert.ok(!stateLines(home).some((line) => /^T proof-id:/.test(line)),
    'a replaced executable produced accepted proof from its stale PreToolUse identity');
});

test('ground: a real correlated node test run that executes zero tests cannot satisfy proof', () => {
  const home = freshHome();
  const session = 'ground-real-zero-tests';
  const turn = 'turn-real-zero-tests';
  const toolUseId = 'tool-real-zero-tests';
  const repo = freshGitRepo([['package.json', '{"name":"zero-tests","private":true}\n']]);
  record(home, session, 'apply_patch', {
    command: '*** Update File: src/app.ts', cwd: repo,
  }, {}, turn);
  const input = { command: 'node --test' };
  const pre = JSON.parse(preTool(home, session, 'Bash', input, repo, toolUseId, turn));
  const execution = executeWrapped(pre.hookSpecificOutput.updatedInput.command, repo);
  assert.strictEqual(execution.status, 0, execution.stderr);
  assert.match(execution.stdout, /1\.\.0|\btests\s+0\b|\b0\s+tests\b/i,
    'the fixture unexpectedly executed one or more tests');
  postTool(home, session, 'Bash', input, execution.stdout, repo, toolUseId, turn);
  const stopOutput = stop(home, session, receipt, false, 'stop', turn, repo);
  assert.ok(stopOutput.trim(), 'a real zero-test run was accepted as substantive proof');
  assert.strictEqual(JSON.parse(stopOutput).decision, 'block');
  assert.ok(!stateLines(home).some((line) => /^T proof-id:/.test(line)), 'zero executed tests emitted accepted proof');
});

test('ground: duplicate PreToolUse cannot overwrite the original repository observation', () => {
  const home = freshHome();
  const session = 'ground-duplicate-pretool';
  const turn = 'turn-duplicate-pretool';
  const toolUseId = 'tool-duplicate-pretool';
  const repo = freshGitRepo([['src/app.js', "module.exports = 'before';\n"]]);
  const input = { command: 'Get-Date' };
  preTool(home, session, 'PowerShell', input, repo, toolUseId, turn);
  fs.writeFileSync(path.join(repo, 'src', 'app.js'), "module.exports = 'after';\n");
  preTool(home, session, 'PowerShell', input, repo, toolUseId, turn);
  assert.strictEqual(taskStateForSession(home, session).pendingObservations.length, 1);
  postTool(home, session, 'PowerShell', input, { exit_code: 0 }, repo, toolUseId, turn);
  const stopOutput = stop(home, session, 'Done.', false, 'stop', turn, repo);
  assert.ok(stopOutput.trim(), 'duplicate PreToolUse erased the original change boundary');
  assert.strictEqual(JSON.parse(stopOutput).decision, 'block');
  assert.ok(stateLines(home).some((line) => line.startsWith('G ') &&
    line.includes(`edit:${expectedArtifactId(repo, 'src/app.js')}`)),
  'the duplicated PreToolUse erased the original change boundary');
});

test('ground: pending observations from two repositories reconcile against their own roots', () => {
  const home = freshHome();
  const session = 'ground-two-repository-pending';
  const sourceTurn = 'turn-two-repository-tools';
  const stopTurn = 'turn-two-repository-stop';
  const repoA = freshGitRepo([['src/a.js', "module.exports = 'before-a';\n"]]);
  const repoB = freshGitRepo([['src/b.js', "module.exports = 'before-b';\n"]]);
  const input = { command: 'Get-Date' };
  preTool(home, session, 'PowerShell', input, repoA, 'tool-repo-a', sourceTurn);
  fs.writeFileSync(path.join(repoA, 'src', 'a.js'), "module.exports = 'after-a';\n");
  preTool(home, session, 'PowerShell', input, repoB, 'tool-repo-b', sourceTurn);
  fs.writeFileSync(path.join(repoB, 'src', 'b.js'), "module.exports = 'after-b';\n");
  assert.strictEqual(taskStateForSession(home, session).pendingObservations.length, 2);

  assert.strictEqual(JSON.parse(stop(home, session, 'Done.', false, 'stop', stopTurn, repoA)).decision, 'block');
  const generated = stateLines(home).filter((line) => line.startsWith('G '));
  assert.ok(generated.some((line) => line.includes(`edit:${expectedArtifactId(repoA, 'src/a.js')}`)),
    'repository A change was not recovered from its own observation');
  assert.ok(generated.some((line) => line.includes(`edit:${expectedArtifactId(repoB, 'src/b.js')}`)),
    'repository B change was reconciled against the wrong repository root');
  assert.strictEqual(taskStateForSession(home, session).pendingObservations.length, 0);
});

test('wire: creates every active Codex lifecycle event and is idempotent', () => {
  const home = freshHome();
  execFileSync('node', [WIRE, home, CODEX], { encoding: 'utf8' });
  const first = JSON.parse(fs.readFileSync(path.join(home, 'hooks.json'), 'utf8'));
  for (const event of ['SessionStart', 'SubagentStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'SubagentStop']) {
    assert.ok(first.hooks[event]?.length, `missing hooks.${event}`);
    const expectedTimeout = ['PreToolUse', 'PostToolUse', 'Stop', 'SubagentStop'].includes(event) ? 15 : 5;
    assert.strictEqual(first.hooks[event][0].hooks[0].timeout, expectedTimeout, `${event} timeout does not cover its bounded runtime`);
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

test('revoke-trust: explicit alternate CODEX_HOME overrides the ambient profile for the child app-server', () => {
  const ambient = path.join(tmpRoot, 'ambient-profile');
  const target = path.join(tmpRoot, 'explicit-target-profile');
  const childEnvironment = REVOKER.codexEnvironment(target, { ...process.env, CODEX_HOME: ambient });
  assert.strictEqual(childEnvironment.CODEX_HOME, path.resolve(target));
  assert.notStrictEqual(childEnvironment.CODEX_HOME, path.resolve(ambient));
});

test('ground: same-size executable replacement with altered bytes is detected', () => {
  const home = freshHome();
  const session = 'ground-same-size-replacement';
  const turn = 'turn-same-size-replacement';
  const toolUseId = 'tool-same-size-replacement';
  const repo = freshGitRepo();
  const shim = path.join(tmpRoot, `same-size-shim-${++serial}`);
  fs.mkdirSync(shim, { recursive: true });
  const filename = process.platform === 'win32' ? 'python.exe' : 'python';
  const target = path.join(shim, filename);

  const size = 70000;
  const buffer1 = Buffer.alloc(size, 0);
  if (process.platform === 'win32') {
    buffer1[0] = 0x4d; buffer1[1] = 0x5a;
    buffer1.writeUInt32LE(64, 0x3c);
    buffer1[64] = 0x50; buffer1[65] = 0x45;
  } else {
    buffer1[0] = 0x7f; buffer1[1] = 0x45; buffer1[2] = 0x4c; buffer1[3] = 0x46;
  }
  buffer1[size - 1] = 1;

  const buffer2 = Buffer.from(buffer1);
  buffer2[size - 1] = 2;

  fs.writeFileSync(target, buffer1);
  if (process.platform !== 'win32') fs.chmodSync(target, 0o755);
  const environment = { PATH: `${shim}${path.delimiter}${process.env.PATH}` };

  record(home, session, 'apply_patch', {
    command: '*** Update File: src/app.ts', cwd: repo,
  }, {}, turn);

  const input = { command: 'python scripts/render.py' };
  const rawPre = preTool(home, session, 'Bash', input, repo, toolUseId, turn, environment);
  assert.ok(rawPre.trim() !== '', 'should trust mock python');

  fs.writeFileSync(target, buffer2);
  if (process.platform !== 'win32') fs.chmodSync(target, 0o755);

  const parsedPre = JSON.parse(rawPre);
  const effective = parsedPre.hookSpecificOutput && parsedPre.hookSpecificOutput.updatedInput
    ? parsedPre.hookSpecificOutput.updatedInput.command : input.command;

  postTool(home, session, 'Bash', input, 'Exit code: 0\n1 passed', repo, toolUseId, turn, environment);

  const stopOutput = stop(home, session, 'receipt', false, 'stop', turn, repo);
  const parsedStop = JSON.parse(stopOutput);
  assert.strictEqual(parsedStop.decision, 'block', 'Same-size altered binary replacement was not blocked');
  assert.match(parsedStop.reason, /latest runnable edit/i);
});

test('ground: isNativeBinary rejects fake PE starting with MZ but without signature', () => {
  const home = freshHome();
  const session = 'ground-fake-pe-check';
  const turn = 'turn-fake-pe-check';
  const shim = path.join(tmpRoot, `fake-pe-shim-${++serial}`);
  fs.mkdirSync(shim, { recursive: true });
  const filename = process.platform === 'win32' ? 'python.exe' : 'python';
  const target = path.join(shim, filename);

  const buffer = Buffer.alloc(100, 0);
  buffer[0] = 0x4d; buffer[1] = 0x5a;
  fs.writeFileSync(target, buffer);
  if (process.platform !== 'win32') fs.chmodSync(target, 0o755);

  const environment = { PATH: `${shim}${path.delimiter}${process.env.PATH}` };
  record(home, session, 'apply_patch', {
    command: '*** Update File: src/app.ts', cwd: unitRepo,
  }, {}, turn);

  const output = preTool(home, session, 'Bash', {
    command: 'python scripts/render.py',
  }, unitRepo, 'tool-fake-pe', turn, environment);
  assert.strictEqual(output.trim(), '', 'should reject fake PE');
});

(async () => {
  let failed = 0;
  const filter = process.env.DEV_RIGOR_TEST_FILTER || '';
  const selected = filter ? tests.filter(([name]) => name.includes(filter)) : tests;
  if (filter && selected.length === 0) throw new Error(`No hook test matched DEV_RIGOR_TEST_FILTER=${filter}`);
  for (const [name, fn] of selected) {
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
  console.log(`\nALL PASS (${selected.length} tests${filter ? `, filter: ${filter}` : ''})`);
})();
