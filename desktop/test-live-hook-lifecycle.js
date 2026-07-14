#!/usr/bin/env node
'use strict';

// Authenticated, exact-candidate release capstone. It uses a disposable profile,
// a workspace-write sandbox, real Codex app-server turns, and the installed hooks.
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  assertCandidateInstallation,
  assertLifecycleIsolation,
  boundedRedactedAppend,
  canonicalPath,
  processAlive,
  redactSensitive,
  resolveCodexBinary,
  spawnCodexAppServer,
  terminateProcessTree,
  waitForExit,
} = require('./live-hook-lifecycle-support');

if (!process.argv[2]) throw new Error('Pass an empty disposable work directory.');
const requestedCodexHome = process.env.CODEX_HOME;
const declaredActiveHome = process.env.DEV_RIGOR_ACTIVE_CODEX_HOME;
if (!requestedCodexHome || !fs.existsSync(path.join(requestedCodexHome, 'auth.json'))) {
  throw new Error('Use an authenticated disposable CODEX_HOME; never run this against the active profile.');
}
if (!declaredActiveHome) {
  throw new Error('Set DEV_RIGOR_ACTIVE_CODEX_HOME to the real active profile before running the capstone.');
}

const candidateRoot = path.resolve(__dirname, '..');
const requestedWork = path.resolve(process.argv[2]);
const defaultActiveHome = path.join(os.homedir(), '.codex');
const isolation = assertLifecycleIsolation({
  codexHome: requestedCodexHome,
  workDir: requestedWork,
  candidateRoot,
  activeHomes: [defaultActiveHome, declaredActiveHome],
});
const codexHome = isolation.codexHome;
const cwd = isolation.workDir;
if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory() || fs.readdirSync(cwd).length !== 0) {
  throw new Error('The live lifecycle work directory must exist and be empty.');
}
assertCandidateInstallation({ candidateRoot: isolation.candidateRoot, codexHome, expectedSkillCount: 19 });
execFileSync('git', ['init', '--quiet', cwd], { stdio: 'ignore', timeout: 5000, windowsHide: true });

const codexBinary = resolveCodexBinary();
const codexVersion = execFileSync(codexBinary, ['--version'], {
  encoding: 'utf8', timeout: 5000, windowsHide: true,
}).trim();
if (!/\b0\.144\.2\b/.test(codexVersion)) {
  throw new Error(`Authenticated lifecycle requires Codex 0.144.2; received ${redactSensitive(codexVersion)}`);
}
const child = spawnCodexAppServer(codexBinary, { ...process.env, CODEX_HOME: codexHome });

const EVENT_NAMES = {
  SessionStart: 'sessionStart',
  SubagentStart: 'subagentStart',
  UserPromptSubmit: 'userPromptSubmit',
  PreToolUse: 'preToolUse',
  PostToolUse: 'postToolUse',
  Stop: 'stop',
  SubagentStop: 'subagentStop',
};
const EVENT_SCRIPTS = {
  SessionStart: 'dev-rigor-activate.js',
  SubagentStart: 'dev-rigor-activate.js',
  UserPromptSubmit: 'dev-rigor-router.js',
  PreToolUse: 'dev-rigor-ground.js',
  PostToolUse: 'dev-rigor-ground.js',
  Stop: 'dev-rigor-ground.js',
  SubagentStop: 'dev-rigor-ground.js',
};
const LONG_REPORT = 'REPORT_STAYS_VISIBLE | ' + Array.from({ length: 24 }, (_, index) =>
  `Section ${index + 1}: verified lifecycle evidence remains visible without destructive receipt enforcement.`
).join(' | ');

let buffer = '';
let stderr = '';
let threadId = '';
let firstTurnId = '';
let reportTurnId = '';
let unprovedTurnId = '';
let statusTurnId = '';
let conversationTurnId = '';
let phase = 'initialize';
let shuttingDown = false;
let timeout;
let hookBinding = null;
const firstItems = [];
const reportItems = [];
const statusItems = [];
const conversationItems = [];
const reportMessages = [];
const unprovedMessages = [];
const statusMessages = [];
const conversationMessages = [];
const reportDeltaByItem = new Map();
let unprovedStopBaseline = -1;
let unprovedBlockBaseline = -1;
let unprovedCheckpointBaseline = -1;
let unprovedProofBaseline = -1;
let unprovedSeededEdit = '';
let unprovedDebtBaseline = new Set();
let unprovedState = null;
let statusProjection = null;

function send(message) {
  if (!shuttingDown && child.stdin.writable) child.stdin.write(JSON.stringify(message) + '\n');
}

function identityHash(...values) {
  const digest = crypto.createHash('sha256');
  values.forEach((value) => digest.update(String(value)).update('\0'));
  return digest.digest('hex');
}

function hashFile(target) {
  return crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
}

function directHookTimeout(script, args) {
  const mode = script === 'dev-rigor-ground.js' ? args[0] : '';
  return mode === 'snapshot' || mode === 'record' || mode === 'check' ? 15000 : 5000;
}

function runInstalledHook(script, args, payload) {
  const target = path.join(codexHome, 'dev-rigor-stack', 'hooks', script);
  if (!fs.existsSync(target)) throw new Error(`installed lifecycle hook is missing: ${script}`);
  return execFileSync(process.execPath, [target, ...args], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, CODEX_HOME: codexHome },
    timeout: directHookTimeout(script, args),
    windowsHide: true,
  }).trim();
}

function readTask(stateDir) {
  const target = path.join(stateDir, `task-v4-${identityHash(threadId)}.json`);
  if (!fs.existsSync(target)) throw new Error(`captured live session has no task state: ${threadId}`);
  return JSON.parse(fs.readFileSync(target, 'utf8'));
}

function redactedTaskProjection(task) {
  return {
    mode: task.mode,
    dirtyEdits: [...(task.dirtyEdits || [])],
    proofs: (task.proofs || []).map((proof) => ({ eventClass: proof.eventClass, checkpoint: proof.checkpoint })),
    unresolved: (task.unresolved || []).map((debt) => ({
      id: debt.id, status: debt.status, edits: [...(debt.edits || [])],
    })),
    mechanical: (task.mechanical || []).map((debt) => ({ id: debt.id, status: debt.status, reason: debt.reason })),
    children: [...(task.children || [])],
    checkpoint: task.checkpoint,
    blockCount: task.blockCount,
    delivery: { ...(task.delivery || {}) },
  };
}

function safeMessageProjection(messages) {
  return messages.map((message) => ({
    id: message.id,
    phase: message.phase,
    length: message.text.length,
    sha256: crypto.createHash('sha256').update(message.text).digest('hex'),
    hasReportSentinel: message.text.includes('REPORT_STAYS_VISIBLE'),
  }));
}

function exactLedger(stateDir, turnId) {
  const target = path.join(stateDir, `ground-v4-${identityHash(threadId, turnId)}.log`);
  return fs.existsSync(target) ? fs.readFileSync(target, 'utf8').split('\n').filter(Boolean) : [];
}

function ledgerClasses(lines) {
  return lines.map((line) => line.slice(0, 1)).join('/');
}

function assertExactTrustedHooks(message) {
  const entry = message.result && message.result.data && message.result.data[0];
  if (!entry || (entry.errors || []).length) throw new Error('hooks/list did not return an error-free candidate binding.');
  const listed = (entry.hooks || []).filter((hook) =>
    (hook.command || '').includes('Dev Rigor hook integrity check failed') &&
    (hook.command || '').includes('m._compile(b.toString(),f)')
  );
  if (listed.length !== 7) throw new Error(`Expected exactly seven owned hooks; received ${listed.length}.`);
  if (new Set(listed.map((hook) => hook.key)).size !== 7) throw new Error('Owned hooks/list keys are not unique.');

  const configuration = JSON.parse(fs.readFileSync(path.join(codexHome, 'hooks.json'), 'utf8'));
  const ownedConfiguration = [];
  for (const event of Object.keys(EVENT_NAMES)) {
    for (const group of configuration.hooks && configuration.hooks[event] || []) {
      for (const hook of group.hooks || []) {
        const configuredCommands = [hook.command, hook.commandWindows].filter((command) => typeof command === 'string');
        if (configuredCommands.some((command) => command.includes('Dev Rigor hook integrity check failed'))) {
          ownedConfiguration.push({ event, matcher: group.matcher || '', hook, configuredCommands });
        }
      }
    }
  }
  if (ownedConfiguration.length !== 7) throw new Error('hooks.json does not contain exactly seven owned candidate commands.');

  const hashes = {};
  for (const expected of ownedConfiguration) {
    const matches = listed.filter((hook) => hook.eventName === EVENT_NAMES[expected.event]);
    if (matches.length !== 1) throw new Error(`hooks/list did not return one ${expected.event} hook.`);
    const actual = matches[0];
    const expectedTimeout = ['PreToolUse', 'PostToolUse', 'Stop', 'SubagentStop'].includes(expected.event) ? 15 : 5;
    if (expected.hook.timeout !== expectedTimeout || actual.timeoutSec !== expectedTimeout) {
      throw new Error(`${expected.event} timeout is not bound to the ${expectedTimeout}-second production contract.`);
    }
    if (!expected.configuredCommands.includes(actual.command) || String(actual.matcher || '') !== String(expected.matcher || '') ||
        String(actual.statusMessage || '') !== String(expected.hook.statusMessage || '')) {
      throw new Error(`${expected.event} hooks/list command, matcher, or status differs from hooks.json.`);
    }
    if (actual.handlerType !== 'command' || actual.source !== 'user' || !actual.enabled || actual.trustStatus !== 'trusted') {
      throw new Error(`${expected.event} is not an enabled trusted user command hook.`);
    }
    if (!/^[a-f0-9]{64}$/.test(actual.currentHash || '') || !actual.key) {
      throw new Error(`${expected.event} is missing its current trusted hash identity.`);
    }
    const binding = actual.command.match(/Buffer\.from\('([^']+)','base64'\).*digest\('hex'\)!=='([a-f0-9]{64})'/);
    if (!binding) throw new Error(`${expected.event} command is missing its path/hash integrity binding.`);
    const installedPath = canonicalPath(Buffer.from(binding[1], 'base64').toString());
    const expectedPath = canonicalPath(path.join(codexHome, 'dev-rigor-stack', 'hooks', EVENT_SCRIPTS[expected.event]));
    if (installedPath !== expectedPath || hashFile(installedPath) !== binding[2]) {
      throw new Error(`${expected.event} command is not bound to the reviewed installed source.`);
    }
    hashes[expected.event] = actual.currentHash;
  }
  return hashes;
}

async function shutdownAppServer(reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  clearTimeout(timeout);
  try { child.stdin.end(); } catch (_) { /* already closed */ }
  try {
    if (reason === 'success') {
      if (!(await waitForExit(child, 2000))) await terminateProcessTree(child, { graceMs: 2000 });
    } else {
      await terminateProcessTree(child, { graceMs: 2000 });
    }
    if (processAlive(child.pid)) throw new Error(`Codex app-server survived ${reason} cleanup.`);
  } catch (error) {
    process.stderr.write(`Lifecycle cleanup failed: ${redactSensitive(error && error.message || error)}\n`);
    process.exitCode = 1;
  }
}

function fail(error, reason = 'failure') {
  if (shuttingDown) return;
  const diagnostic = redactSensitive(String(error && error.stack || error));
  process.stderr.write(`${diagnostic}\n${stderr}`);
  process.exitCode = 1;
  if (reason === 'timeout') void shutdownAppServer('timeout');
  else void shutdownAppServer('failure');
}

function startTurn(id, text, outputSchema) {
  const params = {
    threadId,
    input: [{ type: 'text', text }],
    cwd,
    approvalPolicy: 'never',
  };
  if (outputSchema) params.outputSchema = outputSchema;
  send({ method: 'turn/start', id, params });
}

function seedUnprovedTurn(stateDir) {
  if (!threadId || !unprovedTurnId) {
    throw new Error('the real app-server did not provide the unproved turn identity before seeding');
  }
  const before = readTask(stateDir);
  if ((before.dirtyEdits || []).length || (before.unresolved || []).length) {
    throw new Error(`the capstone was not clean before its isolated seed: ${JSON.stringify(redactedTaskProjection(before))}`);
  }
  const beforeEdits = new Set(before.dirtyEdits || []);
  unprovedDebtBaseline = new Set((before.unresolved || []).map((item) => item.id));
  unprovedStopBaseline = before.delivery && before.delivery.stop || 0;
  unprovedBlockBaseline = before.blockCount || 0;
  unprovedCheckpointBaseline = before.checkpoint || 0;
  unprovedProofBaseline = (before.proofs || []).length;
  const seededFile = 'unproved-live-hook-test.js';
  fs.writeFileSync(path.join(cwd, seededFile), "console.log('UNPROVED_HOOK');\n", 'utf8');
  const output = runInstalledHook('dev-rigor-ground.js', ['record'], {
    session_id: threadId,
    turn_id: unprovedTurnId,
    hook_event_name: 'PostToolUse',
    tool_use_id: 'seeded-unproved-edit',
    cwd,
    tool_name: 'apply_patch',
    tool_input: { command: `*** Add File: ${seededFile}` },
    tool_response: {},
  });
  if (output) throw new Error(`the deterministic edit seed unexpectedly emitted hook output: ${redactSensitive(output)}`);
  const after = readTask(stateDir);
  const seeded = (after.dirtyEdits || []).filter((edit) => !beforeEdits.has(edit));
  if (seeded.length !== 1 || after.dirtyEdits.length !== 1) {
    throw new Error(`the exact unproved edit state was not seeded once: ${JSON.stringify(redactedTaskProjection(after))}`);
  }
  unprovedSeededEdit = seeded[0];
}

function captureUnprovedState(stateDir) {
  const task = readTask(stateDir);
  const newDebts = (task.unresolved || []).filter((item) => !unprovedDebtBaseline.has(item.id));
  const newDebt = newDebts[0];
  const exactDirtyEdits = (task.dirtyEdits || []).length === 1 && task.dirtyEdits[0] === unprovedSeededEdit;
  if (newDebts.length !== 1 || newDebt.status !== 'unresolved' ||
      JSON.stringify([...(newDebt.edits || [])].sort()) !== JSON.stringify([unprovedSeededEdit])) {
    throw new Error(`the real app-server did not preserve one exact unresolved seeded debt: ${JSON.stringify(redactedTaskProjection(task))}`);
  }
  if (!exactDirtyEdits) {
    throw new Error(`exactDirtyEdits invariant failed: ${JSON.stringify(redactedTaskProjection(task))}`);
  }
  if (task.checkpoint !== unprovedCheckpointBaseline || task.proofs.length !== unprovedProofBaseline) {
    throw new Error(`unproved state changed checkpoint or proof count: ${JSON.stringify(redactedTaskProjection(task))}`);
  }
  if (task.blockCount !== unprovedBlockBaseline + 1) {
    throw new Error(`real app-server Stop/retry changed block count by other than one: ${JSON.stringify(redactedTaskProjection(task))}`);
  }
  if (!task.delivery || task.delivery.stop !== unprovedStopBaseline + 2) {
    throw new Error(`app-server Stop hooks did not deliver exactly K/U: ${JSON.stringify(redactedTaskProjection(task))}`);
  }
  if (task.delivery.preToolUse !== 4 || task.delivery.postToolUse !== 5) {
    throw new Error(`authenticated PreToolUse/PostToolUse delivery drifted: ${JSON.stringify(redactedTaskProjection(task))}`);
  }
  const ledger = exactLedger(stateDir, unprovedTurnId);
  if (ledger.length !== 3 || !ledger[0].startsWith('E ') || ledger[1] !== 'K substantive-proof' || ledger[2] !== 'U released-unproved') {
    throw new Error(`model one-block ledger is not E/K/U/no-C: ${ledger.join(' | ')}`);
  }
  unprovedState = redactedTaskProjection(task);
  return { task, debt: newDebt };
}

function parseFinalJson(messages, label) {
  const finals = messages.filter((message) => message.phase === 'final_answer');
  if (finals.length !== 1) throw new Error(`${label} did not have exactly one final answer: ${JSON.stringify(safeMessageProjection(messages))}`);
  try { return { final: finals[0], value: JSON.parse(finals[0].text) }; }
  catch (_) { throw new Error(`${label} final answer was not valid structured JSON: ${JSON.stringify(safeMessageProjection(messages))}`); }
}

function verifyState() {
  const stateDir = path.join(codexHome, 'dev-rigor-stack', 'state');
  const commandProjection = (items) => items.filter((item) => item.type === 'commandExecution')
    .map((item) => ({ status: item.status, exitCode: item.exitCode }));
  const firstCommands = commandProjection(firstItems);
  const reportCommands = commandProjection(reportItems);
  if (firstCommands.length !== 1 || firstCommands[0].status !== 'completed' || firstCommands[0].exitCode !== 0) {
    throw new Error(`happy turn shell status was not exactly completed/0: ${JSON.stringify(firstCommands)}`);
  }
  if (reportCommands.length !== 1 || reportCommands[0].status !== 'completed' || reportCommands[0].exitCode !== 0) {
    throw new Error(`report turn shell status was not exactly completed/0: ${JSON.stringify(reportCommands)}`);
  }
  if (!firstItems.some((item) => item.type === 'fileChange') || !reportItems.some((item) => item.type === 'fileChange')) {
    throw new Error('happy/report turns did not each exercise one real file change.');
  }

  const happy = exactLedger(stateDir, firstTurnId);
  const report = exactLedger(stateDir, reportTurnId);
  const unproved = exactLedger(stateDir, unprovedTurnId);
  if (happy.length !== 3 || !happy[0].startsWith('E ') || !/^[RTB] /.test(happy[1]) || !happy[2].startsWith('C ')) {
    throw new Error(`happy ledger is not exact E/proof/C: ${happy.join(' | ')}`);
  }
  if (report.length !== 4 || !report[0].startsWith('E ') || !/^[RTB] /.test(report[1]) ||
      report[2] !== 'W missing-receipt' || !report[3].startsWith('C ')) {
    throw new Error(`report ledger is not exact E/proof/W/C: ${report.join(' | ')}`);
  }
  if (ledgerClasses(unproved) !== 'E/K/U') throw new Error(`unproved ledger drifted: ${unproved.join(' | ')}`);

  const finalReports = reportMessages.filter((message) => message.phase === 'final_answer');
  if (finalReports.length !== 1) {
    throw new Error(`exactly one completed final persistent report was required: ${JSON.stringify(safeMessageProjection(reportMessages))}`);
  }
  const finalReport = finalReports[0];
  if (finalReport.phase !== 'final_answer') throw new Error('final report phase was not final_answer.');
  let parsedReport;
  try { parsedReport = JSON.parse(finalReport.text); } catch (_) {
    throw new Error(`final report was not structured JSON: ${JSON.stringify(safeMessageProjection(reportMessages))}`);
  }
  if (JSON.stringify(parsedReport) !== JSON.stringify({ answer: LONG_REPORT })) {
    throw new Error(`completed final report did not equal the exact schema value: ${JSON.stringify(safeMessageProjection(reportMessages))}`);
  }
  const finalDeltas = reportDeltaByItem.get(finalReport.id) || '';
  if (!finalDeltas || finalDeltas.split('REPORT_STAYS_VISIBLE').length - 1 !== 1) {
    throw new Error('the exact final report did not stream one and only one report sentinel');
  }
  const totalStreamedReportCount = [...reportDeltaByItem.values()].join('').split('REPORT_STAYS_VISIBLE').length - 1;
  if (totalStreamedReportCount !== 1) {
    throw new Error(`reportDeltaByItem observed ${totalStreamedReportCount} streamed report sentinels instead of exactly one`);
  }
  if (reportMessages.some((message) => message.phase === 'final_answer' && /proved:/i.test(message.text))) {
    throw new Error(`a receipt-only final replaced the long report: ${JSON.stringify(safeMessageProjection(reportMessages))}`);
  }

  const unprovedFinals = unprovedMessages.filter((message) => message.phase === 'final_answer');
  if (!unprovedFinals.length || !unprovedFinals[unprovedFinals.length - 1].text.includes('UNPROVED_EDIT_RESPONSE')) {
    throw new Error(`one-block turn did not finish with its required response: ${JSON.stringify(safeMessageProjection(unprovedMessages))}`);
  }
  if (!statusProjection || !unprovedState) throw new Error('DevRigorSTATUS or unproved state projection was not captured.');

  const statusToolItems = statusItems.filter((item) => ['commandExecution', 'fileChange', 'mcpToolCall', 'dynamicToolCall'].includes(item.type));
  if (statusToolItems.length) throw new Error(`DevRigorSTATUS used tools: ${statusToolItems.map((item) => item.type).join(', ')}`);
  const conversationToolItems = conversationItems.filter((item) => ['commandExecution', 'fileChange', 'mcpToolCall', 'dynamicToolCall'].includes(item.type));
  if (conversationToolItems.length) throw new Error(`later conversation used tools: ${conversationToolItems.map((item) => item.type).join(', ')}`);
  const conversationFinals = conversationMessages.filter((message) => message.phase === 'final_answer');
  if (conversationFinals.length !== 1 || conversationFinals[0].text.trim() !== 'CONVERSATION_OK') {
    throw new Error(`later conversation did not complete exactly: ${JSON.stringify(safeMessageProjection(conversationMessages))}`);
  }
  const conversationLedger = exactLedger(stateDir, conversationTurnId);
  if (conversationLedger.some((line) => /^[KU] /.test(line))) {
    throw new Error(`conversation ledger recorded K/U: ${conversationLedger.join(' | ')}`);
  }
  const statusLedger = exactLedger(stateDir, statusTurnId);
  if (statusLedger.some((line) => /^[KU] /.test(line))) {
    throw new Error(`DevRigorSTATUS ledger recorded K/U: ${statusLedger.join(' | ')}`);
  }

  const finalTask = redactedTaskProjection(readTask(stateDir));
  const stable = (task) => ({
    dirtyEdits: task.dirtyEdits,
    proofs: task.proofs,
    unresolved: task.unresolved,
    mechanical: task.mechanical,
    children: task.children,
    checkpoint: task.checkpoint,
    blockCount: task.blockCount,
  });
  if (JSON.stringify(stable(finalTask)) !== JSON.stringify(stable(unprovedState))) {
    throw new Error(`STATUS/conversation changed unresolved substantive state: ${JSON.stringify(finalTask)}`);
  }
  if (finalTask.delivery.stop !== unprovedState.delivery.stop + 2) {
    throw new Error(`STATUS and conversation did not each deliver exactly one Stop: ${JSON.stringify(finalTask.delivery)}`);
  }

  const expectedStatus = {
    mode: 'ON',
    dirtyEdit: 'yes',
    proofDebt: 'yes',
    debtId: unprovedState.unresolved[0].id,
    debtStatus: 'unresolved',
    mechanicalDebt: 'no',
    associationDebt: 'no',
    subagentProofDebt: 0,
    subagentMechanicalDebt: 0,
    checkpoint: unprovedState.checkpoint,
    substantiveBlocks: unprovedState.blockCount,
    deliveryStop: unprovedState.delivery.stop,
  };
  const statusKeys = Object.keys(expectedStatus);
  if (Object.keys(statusProjection).length !== statusKeys.length ||
      statusKeys.some((key) => statusProjection[key] !== expectedStatus[key])) {
    throw new Error(`DevRigorSTATUS did not expose exact canonical state: ${JSON.stringify(statusProjection)}`);
  }

  process.stdout.write(
    `LIVE_LIFECYCLE_PASS: Codex ${codexVersion}; hooks 7/7 trusted and candidate-bound; ` +
    `statuses happy=${JSON.stringify(firstCommands)} report=${JSON.stringify(reportCommands)}; ` +
    `ledgers happy=${ledgerClasses(happy)} report=${ledgerClasses(report)} unproved=${ledgerClasses(unproved)}; ` +
    `STATUS debt=${expectedStatus.debtId} checkpoint=${expectedStatus.checkpoint} blocks=${expectedStatus.substantiveBlocks}; ` +
    'streamed final report persisted; later conversation passed\n'
  );
}

function startStatusTurn() {
  startTurn(7, 'DevRigorSTATUS', {
    type: 'object',
    properties: {
      mode: { type: 'string', description: 'Exact mode from injected DEV-RIGOR TASK STATUS.' },
      dirtyEdit: { type: 'string', description: 'yes or no from dirty edit.' },
      proofDebt: { type: 'string', description: 'yes or no from unresolved proof.' },
      debtId: { type: 'string', description: 'The exact unresolved proof debt identifier.' },
      debtStatus: { type: 'string', description: 'Status of that exact debt.' },
      mechanicalDebt: { type: 'string', description: 'yes or no from mechanical debt.' },
      associationDebt: { type: 'string', description: 'yes or no from association debt.' },
      subagentProofDebt: { type: 'integer', description: 'Subagent unresolved proof count.' },
      subagentMechanicalDebt: { type: 'integer', description: 'Subagent mechanical debt count.' },
      checkpoint: { type: 'integer', description: 'Exact checkpoint.' },
      substantiveBlocks: { type: 'integer', description: 'Exact substantive block count.' },
      deliveryStop: { type: 'integer', description: 'Exact observed Stop delivery count.' },
    },
    required: [
      'mode', 'dirtyEdit', 'proofDebt', 'debtId', 'debtStatus', 'mechanicalDebt', 'associationDebt',
      'subagentProofDebt', 'subagentMechanicalDebt', 'checkpoint', 'substantiveBlocks', 'deliveryStop',
    ],
    additionalProperties: false,
  });
}

child.stderr.setEncoding('utf8');
child.stderr.on('data', (chunk) => { stderr = boundedRedactedAppend(stderr, chunk, 8192); });
child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  buffer += chunk;
  while (buffer.includes('\n')) {
    const newline = buffer.indexOf('\n');
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    let message;
    try { message = JSON.parse(line); } catch (error) { fail(error); return; }
    if (message.error) { fail(new Error(redactSensitive(JSON.stringify(message.error)))); return; }

    if (message.id != null && message.method) {
      if (/requestApproval|applyPatchApproval|execCommandApproval/i.test(message.method)) {
        send({ id: message.id, result: { decision: 'decline' } });
        fail(new Error(`Unexpected app-server approval request: ${message.method}`));
      } else {
        fail(new Error(`Unexpected app-server request: ${message.method}`));
      }
      return;
    }

    if (message.id === 1) {
      send({ method: 'initialized', params: {} });
      phase = 'hooks';
      send({ method: 'hooks/list', id: 2, params: { cwds: [cwd] } });
    } else if (message.id === 2) {
      try { hookBinding = assertExactTrustedHooks(message); } catch (error) { fail(error); return; }
      phase = 'thread';
      send({ method: 'thread/start', id: 3, params: {
        cwd, approvalPolicy: 'never', sandbox: 'workspace-write', ephemeral: true,
      } });
    } else if (message.id === 3) {
      threadId = message.result.thread.id;
      phase = 'first';
      startTurn(4,
        "This is a local hook integration test. Do not inspect the directory or run git status. Your first action must be apply_patch: create live-hook-test.js containing console.log('LIVE_HOOK_OK'). Then run node live-hook-test.js with the shell tool. End with the required proved, blast, and skipped evidence receipt."
      );
    } else if (message.id === 4) {
      firstTurnId = message.result.turn.id;
    } else if (message.id === 5) {
      reportTurnId = message.result.turn.id;
    } else if (message.id === 6) {
      unprovedTurnId = message.result.turn.id;
      try { seedUnprovedTurn(path.join(codexHome, 'dev-rigor-stack', 'state')); }
      catch (error) { fail(error); return; }
    } else if (message.id === 7) {
      statusTurnId = message.result.turn.id;
    } else if (message.id === 8) {
      conversationTurnId = message.result.turn.id;
    } else if (message.method === 'item/completed') {
      const params = message.params || {};
      const item = params.item;
      if (!item || !item.type) continue;
      if (params.turnId === firstTurnId) firstItems.push(item);
      else if (params.turnId === reportTurnId) {
        reportItems.push(item);
        if (item.type === 'agentMessage') reportMessages.push({
          id: item.id || '', text: item.text || '', phase: item.phase || '',
        });
      } else if (params.turnId === unprovedTurnId && item.type === 'agentMessage') {
        unprovedMessages.push({ id: item.id || '', text: item.text || '', phase: item.phase || '' });
      } else if (params.turnId === statusTurnId) {
        statusItems.push(item);
        if (item.type === 'agentMessage') statusMessages.push({
          id: item.id || '', text: item.text || '', phase: item.phase || '',
        });
      } else if (params.turnId === conversationTurnId) {
        conversationItems.push(item);
        if (item.type === 'agentMessage') conversationMessages.push({
          id: item.id || '', text: item.text || '', phase: item.phase || '',
        });
      }
    } else if (message.method === 'item/agentMessage/delta') {
      const params = message.params || {};
      if (params.turnId === reportTurnId && params.itemId) {
        reportDeltaByItem.set(params.itemId, `${reportDeltaByItem.get(params.itemId) || ''}${params.delta || ''}`);
      }
    } else if (message.method === 'turn/completed') {
      const turn = message.params && message.params.turn;
      if (!turn || turn.status !== 'completed') {
        fail(new Error(`turn did not complete: ${redactSensitive(JSON.stringify(turn && { id: turn.id, status: turn.status, error: turn.error }))}`));
        return;
      }
      if (phase === 'first' && turn.id === firstTurnId) {
        phase = 'report';
        startTurn(5,
          "This is the disappearing-report acceptance test. Do not inspect the directory or run git status. Your first action must be apply_patch: create report-live-hook-test.js containing console.log('REPORT_HOOK_OK'). Run node report-live-hook-test.js with the shell tool. Then return the required long schema value exactly. It deliberately omits receipt formatting; because substantive proof exists, the answer must stream once and remain visible.",
          {
            type: 'object',
            properties: { answer: { type: 'string', enum: [LONG_REPORT] } },
            required: ['answer'],
            additionalProperties: false,
          }
        );
      } else if (phase === 'report' && turn.id === reportTurnId) {
        phase = 'unproved';
        startTurn(6,
          "This is the substantive one-block circuit-breaker test. The harness will seed one exact edit immediately after this real turn id is assigned. Do not inspect the directory and do not use any tools. Return the required schema value so the real app-server Stop/retry path must emit one block, one released-unproved transition, and no extra block.",
          {
            type: 'object',
            properties: { answer: { type: 'string', enum: ['UNPROVED_EDIT_RESPONSE'] } },
            required: ['answer'],
            additionalProperties: false,
          }
        );
      } else if (phase === 'unproved' && turn.id === unprovedTurnId) {
        try { captureUnprovedState(path.join(codexHome, 'dev-rigor-stack', 'state')); }
        catch (error) { fail(error); return; }
        phase = 'status';
        startStatusTurn();
      } else if (phase === 'status' && turn.id === statusTurnId) {
        try { statusProjection = parseFinalJson(statusMessages, 'DevRigorSTATUS').value; }
        catch (error) { fail(error); return; }
        phase = 'conversation';
        startTurn(8, 'Do not use tools. Reply with exactly: CONVERSATION_OK');
      } else if (phase === 'conversation' && turn.id === conversationTurnId) {
        try { verifyState(); } catch (error) { fail(error); return; }
        void shutdownAppServer('success');
      }
    }
  }
});

child.on('error', (error) => fail(new Error(`Could not start Codex app-server: ${redactSensitive(error.message)}`)));
child.on('exit', (code, signal) => {
  if (!shuttingDown) fail(new Error(`Codex app-server exited unexpectedly: code=${code} signal=${signal || 'none'}`));
});

send({ method: 'initialize', id: 1, params: {
  clientInfo: { name: 'dev_rigor_live_test', title: 'Dev Rigor Live Test', version: '1.7.0' },
} });
timeout = setTimeout(() => fail(new Error('Timed out waiting for live Codex lifecycle'), 'timeout'), 180000);
