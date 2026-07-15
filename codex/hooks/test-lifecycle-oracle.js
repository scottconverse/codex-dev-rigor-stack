#!/usr/bin/env node
// Deterministic, unauthenticated lifecycle oracle for the real Codex hook sources.

const assert = require('assert');
const { execFileSync, spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ACTIVATE = path.join(__dirname, 'dev-rigor-activate.js');
const GROUND = path.join(__dirname, 'dev-rigor-ground.js');
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-rigor-lifecycle-oracle-'));
const home = path.join(temporaryRoot, 'codex-home');
const repository = path.join(temporaryRoot, 'repository');
const session = 'deterministic-lifecycle-oracle';
let toolSerial = 0;

fs.mkdirSync(home, { recursive: true });
fs.mkdirSync(repository, { recursive: true });
execFileSync('git', ['init', '--quiet'], { cwd: repository });
execFileSync('git', ['config', 'user.email', 'lifecycle@example.invalid'], { cwd: repository });
execFileSync('git', ['config', 'user.name', 'Lifecycle Oracle'], { cwd: repository });
execFileSync('git', ['config', 'core.autocrlf', 'false'], { cwd: repository });
fs.mkdirSync(path.join(repository, 'src'), { recursive: true });
fs.mkdirSync(path.join(repository, 'scripts'), { recursive: true });
fs.writeFileSync(path.join(repository, 'src', 'fixture.ts'), 'export const fixture = true;\n');
fs.writeFileSync(path.join(repository, 'scripts', 'proof.js'), "process.stdout.write('LIFECYCLE_PROOF_OK\\n');\n");
execFileSync('git', ['add', '.'], { cwd: repository });
execFileSync('git', ['commit', '--quiet', '-m', 'fixture'], { cwd: repository });

function runGround(input, mode) {
  return execFileSync(process.execPath, [GROUND, mode], {
    input: JSON.stringify(input),
    env: { ...process.env, CODEX_HOME: home },
    encoding: 'utf8',
    timeout: mode === 'snapshot' || mode === 'record' || mode === 'check' ? 15000 : 5000,
  });
}

function activateTask() {
  return execFileSync(process.execPath, [ACTIVATE], {
    input: JSON.stringify({ session_id: session, hook_event_name: 'SessionStart' }),
    env: { ...process.env, CODEX_HOME: home },
    encoding: 'utf8',
    timeout: 5000,
  });
}

function record(turn, toolName, toolInput, toolResponse = {}) {
  const toolUseId = `lifecycle-tool-${++toolSerial}`;
  if (!/^(?:apply_patch|Edit|Write|MultiEdit|NotebookEdit)$/i.test(toolName)) {
    runGround({
      session_id: session,
      turn_id: turn,
      hook_event_name: 'PreToolUse',
      tool_use_id: toolUseId,
      cwd: repository,
      tool_name: toolName,
      tool_input: toolInput,
    }, 'snapshot');
  }
  return runGround({
    session_id: session,
    turn_id: turn,
    hook_event_name: 'PostToolUse',
    tool_use_id: toolUseId,
    cwd: repository,
    tool_name: toolName,
    tool_input: toolInput,
    tool_response: toolResponse,
  }, 'record');
}

function recordWrappedShell(turn, command) {
  const toolUseId = `lifecycle-tool-${++toolSerial}`;
  const toolInput = { command };
  const preOutput = parseOutput(runGround({
    session_id: session,
    turn_id: turn,
    hook_event_name: 'PreToolUse',
    tool_use_id: toolUseId,
    cwd: repository,
    tool_name: 'Bash',
    tool_input: toolInput,
  }, 'snapshot'), 'nonce-bound PreToolUse wrapper');
  const updatedInput = preOutput.hookSpecificOutput && preOutput.hookSpecificOutput.updatedInput;
  assert.strictEqual(preOutput.hookSpecificOutput.permissionDecision, 'allow');
  assert.ok(updatedInput && typeof updatedInput.command === 'string', 'PreToolUse did not return updatedInput.command');
  assert.notStrictEqual(updatedInput.command, command, 'PreToolUse did not install the nonce-bound exit receipt wrapper');

  const execution = process.platform === 'win32'
    ? spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', updatedInput.command], {
      cwd: repository, encoding: 'utf8', timeout: 10000, windowsHide: true,
    })
    : spawnSync('bash', ['-lc', updatedInput.command], {
      cwd: repository, encoding: 'utf8', timeout: 10000,
    });
  assert.ifError(execution.error);
  assert.strictEqual(execution.signal, null, 'wrapped proof command was terminated by a signal');
  assert.strictEqual(execution.status, 0, `wrapped proof command failed: ${execution.stderr}`);
  assert.match(execution.stdout, /LIFECYCLE_PROOF_OK/);
  return runGround({
    session_id: session,
    turn_id: turn,
    hook_event_name: 'PostToolUse',
    tool_use_id: toolUseId,
    cwd: repository,
    tool_name: 'Bash',
    tool_input: toolInput,
    tool_response: execution.stdout,
  }, 'record');
}

function stop(turn, message, stopHookActive = false) {
  return runGround({
    session_id: session,
    turn_id: turn,
    hook_event_name: 'Stop',
    stop_hook_active: stopHookActive,
    last_assistant_message: message,
  }, 'check');
}

function parseOutput(output, label) {
  assert.notStrictEqual(output.trim(), '', `${label} unexpectedly returned no hook output`);
  return JSON.parse(output);
}

function stateDirectory() {
  return path.join(home, 'dev-rigor-stack', 'state');
}

function ledgerLines() {
  return fs.readdirSync(stateDirectory())
    .filter((name) => name.startsWith('ground-v4-'))
    .sort()
    .flatMap((name) => fs.readFileSync(path.join(stateDirectory(), name), 'utf8').split('\n').filter(Boolean));
}

function taskState() {
  const key = crypto.createHash('sha256').update(session).update('\0').digest('hex');
  return JSON.parse(fs.readFileSync(path.join(stateDirectory(), `task-v4-${key}.json`), 'utf8'));
}

function count(lines, prefix) {
  return lines.filter((line) => line.startsWith(`${prefix} `)).length;
}

try {
  const activation = parseOutput(activateTask(), 'SessionStart activation');
  assert.strictEqual(activation.hookSpecificOutput.hookEventName, 'SessionStart');

  // Contract 1: a long proved report with no optional receipt is warned, accepted,
  // checkpointed, and remains represented as the delivered assistant message.
  const reportTurn = 'turn-long-proved-report';
  record(reportTurn, 'apply_patch', { command: '*** Update File: src/fixture.ts' });
  recordWrappedShell(reportTurn, 'node scripts/proof.js');
  const longReport = [
    'Lifecycle report: the requested change and its verification are complete.',
    ...Array.from({ length: 320 }, (_, index) => `Evidence detail ${String(index + 1).padStart(3, '0')}: deterministic acceptance content remains visible.`),
  ].join('\n');
  const reportOutput = parseOutput(stop(reportTurn, longReport), 'long proved report');
  assert.notStrictEqual(reportOutput.decision, 'block', 'proved report without an optional receipt was blocked');
  assert.match(reportOutput.systemMessage, /optional evidence receipt was missing/i);
  const representedReport = reportOutput.decision === 'block' ? '' : longReport;
  assert.strictEqual(representedReport, longReport, 'accepted long proved report was not preserved in the delivery transcript');
  let lines = ledgerLines();
  assert.ok(lines.some((line) => line === 'W missing-receipt'), 'missing-receipt warning was not recorded');
  assert.ok(lines.some((line) => line.startsWith('C proof-accepted ')), 'accepted proof checkpoint was not recorded');

  // Contract 2: an unproved edit blocks once, releases once with durable debt,
  // then becomes silent instead of repeatedly replacing the response.
  const debtTurn = 'turn-unproved-edit';
  record(debtTurn, 'apply_patch', { command: '*** Update File: src/debt.ts' });
  const firstStop = parseOutput(stop(debtTurn, 'Unproved edit response.'), 'first unproved Stop');
  assert.strictEqual(firstStop.decision, 'block', 'first unproved Stop did not block');
  assert.match(firstStop.reason, /substantive proof gate/i);
  const secondStop = parseOutput(stop(debtTurn, 'Retry after the substantive block.', true), 'second unproved Stop');
  assert.match(secondStop.systemMessage, /released after one substantive block/i);
  assert.match(secondStop.systemMessage, /proof debt remains unresolved/i);
  assert.strictEqual(stop(debtTurn, 'Third attempt after released-unproved.', true).trim(), '', 'third Stop was not silent');
  lines = ledgerLines();
  assert.strictEqual(count(lines, 'K'), 1, 'lifecycle must record exactly one substantive block');
  assert.strictEqual(count(lines, 'U'), 1, 'lifecycle must record exactly one released-unproved transition');
  assert.ok(lines.some((line) => line === 'U released-unproved'), 'released-unproved transition was not durable');
  let task = taskState();
  assert.strictEqual(task.unresolved.length, 1, 'released turn did not preserve exactly one proof debt');
  const indebtedEdits = [...task.unresolved[0].edits].sort();
  assert.deepStrictEqual(indebtedEdits, [...task.dirtyEdits].sort(), 'proof debt was not bound to the exact indebted edit set');

  // Contract 3: a later unrelated conversation is never blocked by prior debt.
  assert.strictEqual(
    stop('turn-unrelated-conversation', 'Later unrelated conversation and status explanation.').trim(),
    '',
    'later unrelated conversation was blocked by stale coding state',
  );

  // Contract 4: qualifying proof in a later turn covers that exact edit set,
  // resolves its debt, and creates the second accepted checkpoint.
  const proofTurn = 'turn-later-exact-proof';
  recordWrappedShell(proofTurn, 'node scripts/proof.js');
  const receipt = 'proved: node scripts/proof.js - passed · blast: low · skipped: none';
  assert.strictEqual(stop(proofTurn, receipt).trim(), '', 'later qualifying proof was not silently accepted');
  task = taskState();
  assert.deepStrictEqual(task.dirtyEdits, [], 'later proof did not clear the exact indebted edit set');
  assert.deepStrictEqual(task.unresolved, [], 'later proof did not resolve proof debt');
  assert.strictEqual(task.checkpoint, 2, 'lifecycle did not retain exactly two accepted checkpoints');
  assert.strictEqual(task.blockCount, 1, 'lifecycle task did not retain exactly one block');
  assert.strictEqual(task.proofs.length, 2, 'lifecycle task did not retain exactly two qualifying proofs');
  assert.strictEqual((task.mechanical || []).filter((item) => item.status === 'unresolved').length, 0, 'successful wrappers left mechanical debt');
  assert.deepStrictEqual(task.delivery, { preToolUse: 2, postToolUse: 4, stop: 6 }, 'lifecycle delivery counts drifted');

  // Exact ledger oracle: weakening any transition changes one of these counts.
  lines = ledgerLines();
  assert.deepStrictEqual(
    Object.fromEntries(['E', 'T', 'W', 'C', 'K', 'U', 'G', 'I', 'F', 'R', 'B'].map((prefix) => [prefix, count(lines, prefix)])),
    { E: 2, T: 0, W: 1, C: 2, K: 1, U: 1, G: 0, I: 0, F: 0, R: 2, B: 0 },
    'lifecycle ledger exact counts drifted',
  );
  assert.strictEqual(lines.filter((line) => line.startsWith('C proof-accepted ')).length, 2, 'proof-accepted checkpoint count drifted');

  process.stdout.write('LIFECYCLE_ORACLE_PASS: real PreToolUse wrapper execution, deterministic report acceptance, one-block release, conversation isolation, exact debt resolution, and ledger counts verified\n');
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
