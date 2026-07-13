#!/usr/bin/env node
'use strict';

// Authenticated, disposable-profile integration check. This is intentionally
// separate from CI's deterministic app-server trust test: it proves that the
// installed client actually emits PreToolUse, PostToolUse, and Stop for a real model turn.
const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

if (!process.argv[2]) throw new Error('Pass an empty disposable work directory.');
const cwd = path.resolve(process.argv[2]);
const codexHome = process.env.CODEX_HOME;
if (!codexHome || !fs.existsSync(path.join(codexHome, 'auth.json'))) {
  throw new Error('Use an authenticated disposable CODEX_HOME; never run this against the active profile.');
}
const activeHome = path.resolve(path.join(os.homedir(), '.codex'));
if (path.resolve(codexHome).toLowerCase() === activeHome.toLowerCase()) {
  throw new Error('Refusing to run the live lifecycle test against the active Codex profile.');
}
if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory() || fs.readdirSync(cwd).length !== 0) {
  throw new Error('The live lifecycle work directory must exist and be empty.');
}
execFileSync('git', ['init', '--quiet', cwd], { stdio: 'ignore' });

const command = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'codex';
const args = process.platform === 'win32' ? ['/d', '/s', '/c', 'codex app-server'] : ['app-server'];
const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
let buffer = '';
let stderr = '';
let threadId = '';
let firstTurnId = '';
let reportTurnId = '';
let unprovedTurnId = '';
let phase = 'initialize';
let completed = false;
let timeout;
const firstItems = new Set();
const reportItems = new Set();
const unprovedItems = new Set();
const reportMessages = [];
let reportDeltas = '';
let conversationMessage = '';
const LONG_REPORT = 'REPORT_STAYS_VISIBLE | ' + Array.from({ length: 24 }, (_, index) =>
  `Section ${index + 1}: verified lifecycle evidence remains visible without destructive receipt enforcement.`
).join(' | ');

function send(message) { child.stdin.write(JSON.stringify(message) + '\n'); }
function fail(error) {
  if (completed) return;
  completed = true;
  clearTimeout(timeout);
  process.stderr.write(String(error && error.stack || error) + '\n' + stderr);
  child.kill();
  process.exitCode = 1;
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
function verifyState() {
  if (!firstItems.has('fileChange') || !firstItems.has('commandExecution')) {
    throw new Error(`happy turn did not exercise both edit and execution: ${[...firstItems].join(', ')}`);
  }
  if (!reportItems.has('fileChange') || !reportItems.has('commandExecution')) {
    throw new Error(`report turn did not exercise both edit and execution: ${[...reportItems].join(', ')}`);
  }
  if (!unprovedItems.has('fileChange')) {
    throw new Error(`unproved turn did not exercise an edit: ${[...unprovedItems].join(', ')}`);
  }
  const stateDir = path.join(codexHome, 'dev-rigor-stack', 'state');
  const ledgers = fs.readdirSync(stateDir).filter((name) => name.startsWith('ground-v4-'));
  if (ledgers.length !== 3) throw new Error(`expected three live coding-turn ledgers, found ${ledgers.length}`);
  const contents = ledgers.map((name) =>
    fs.readFileSync(path.join(stateDir, name), 'utf8').split('\n').filter(Boolean)
  );
  const hasProof = (lines) => lines.some((line) => /^[RTB] /.test(line));
  const happy = contents.find((lines) => lines.some((line) => line.startsWith('E ')) && hasProof(lines) &&
    lines.some((line) => line.startsWith('C ')) && !lines.some((line) => line.startsWith('K ')));
  const report = contents.find((lines) => lines.some((line) => line.startsWith('E ')) && hasProof(lines) &&
    lines.some((line) => line.startsWith('W ') && line.includes('missing-receipt')) &&
    lines.some((line) => line.startsWith('C ')) && !lines.some((line) => /^[KU] /.test(line)));
  const unproved = contents.find((lines) => lines.some((line) => line.startsWith('E ')) &&
    lines.some((line) => line.startsWith('K ')) && !lines.some((line) => line.startsWith('C ')));
  if (!happy) throw new Error(`missing happy-path E/proof/C ledger: ${JSON.stringify(contents)}`);
  if (!report) throw new Error(`missing non-destructive report E/proof/W/C ledger: ${JSON.stringify(contents)}`);
  if (!unproved) throw new Error(`missing unresolved one-block E/K/no-C ledger: ${JSON.stringify(contents)}`);
  if (unproved.filter((line) => line.startsWith('K ')).length !== 1) {
    throw new Error(`unproved turn blocked more than once: ${unproved.join(' | ')}`);
  }
  const taskStates = fs.readdirSync(stateDir).filter((name) => name.startsWith('task-v4-')).map((name) =>
    JSON.parse(fs.readFileSync(path.join(stateDir, name), 'utf8'))
  );
  if (!taskStates.some((task) => Array.isArray(task.unresolved) && task.unresolved.length > 0)) {
    throw new Error('the substantive block was released or remediated without preserving unresolved proof debt');
  }
  if (!taskStates.some((task) => task.delivery && task.delivery.preToolUse >= 2 && task.delivery.postToolUse >= 2 && task.delivery.stop >= 3)) {
    throw new Error(`the authenticated lifecycle did not observe the PreToolUse/PostToolUse/Stop contract: ${JSON.stringify(taskStates)}`);
  }
  const completedReports = reportMessages.filter((message) => message.text.includes('REPORT_STAYS_VISIBLE'));
  const uniqueReportText = new Set(completedReports.map((message) => message.text));
  if (completedReports.length < 1 || uniqueReportText.size !== 1) {
    throw new Error(`long report was absent or replaced with conflicting content: ${JSON.stringify(reportMessages)}`);
  }
  if (reportMessages.some((message) => /proved:/i.test(message.text) && !message.text.includes('REPORT_STAYS_VISIBLE'))) {
    throw new Error(`a receipt-only response replaced the long report: ${JSON.stringify(reportMessages)}`);
  }
  if (reportDeltas && !reportDeltas.includes('REPORT_STAYS_VISIBLE')) {
    throw new Error('streamed report deltas did not preserve the report sentinel');
  }
  if (!conversationMessage.includes('CONVERSATION_OK')) {
    throw new Error(`later conversation did not complete normally: ${conversationMessage}`);
  }
  process.stdout.write(
    `Live Codex lifecycle: happy ${firstTurnId}; persistent report ${reportTurnId}; one-block unresolved ${unprovedTurnId}; later conversation passed\n`
  );
}

child.stderr.setEncoding('utf8');
child.stderr.on('data', (chunk) => { stderr += chunk; });
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
    if (message.error) { fail(new Error(JSON.stringify(message.error))); return; }

    // Approval requests should not occur under approvalPolicy=never, but answer
    // defensively so an unexpected client default cannot hang the integration.
    if (message.id != null && message.method) {
      send({ id: message.id, result: { decision: 'accept' } });
      continue;
    }
    if (message.id === 1) {
      send({ method: 'initialized', params: {} });
      phase = 'thread';
      send({ method: 'thread/start', id: 2, params: {
        cwd, approvalPolicy: 'never', sandbox: 'danger-full-access', ephemeral: true,
      } });
    } else if (message.id === 2) {
      threadId = message.result.thread.id;
      phase = 'first';
      startTurn(3,
        "This is a local hook integration test. Do not inspect the directory or run git status. Your first action must be apply_patch: create live-hook-test.js containing console.log('LIVE_HOOK_OK'). Then run node live-hook-test.js with the shell tool. End with the required proved, blast, and skipped evidence receipt."
      );
    } else if (message.id === 3) {
      firstTurnId = message.result.turn.id;
    } else if (message.id === 4) {
      reportTurnId = message.result.turn.id;
    } else if (message.id === 5) {
      unprovedTurnId = message.result.turn.id;
    } else if (message.id === 6) {
      // Wait for the final turn/completed.
    } else if (message.method === 'item/completed' && phase === 'first') {
      if (message.params && message.params.item && message.params.item.type) {
        firstItems.add(message.params.item.type);
      }
    } else if (message.method === 'item/completed' && phase === 'report') {
      if (message.params && message.params.item && message.params.item.type) {
        reportItems.add(message.params.item.type);
        if (message.params.item.type === 'agentMessage') reportMessages.push({
          id: message.params.item.id || '', text: message.params.item.text || '',
        });
      }
    } else if (message.method === 'item/agentMessage/delta' && phase === 'report') {
      reportDeltas += message.params && message.params.delta || '';
    } else if (message.method === 'item/completed' && phase === 'unproved') {
      if (message.params && message.params.item && message.params.item.type) unprovedItems.add(message.params.item.type);
    } else if (message.method === 'item/completed' && phase === 'conversation') {
      const item = message.params && message.params.item;
      if (item && item.type === 'agentMessage') conversationMessage += item.text || '';
    } else if (message.method === 'turn/completed') {
      const turn = message.params && message.params.turn;
      if (!turn || turn.status !== 'completed') {
        fail(new Error(`turn did not complete: ${JSON.stringify(turn)}`));
        return;
      }
      if (phase === 'first') {
        phase = 'report';
        startTurn(4,
          "This is the disappearing-report acceptance test. Do not inspect the directory or run git status. Your first action must be apply_patch: create report-live-hook-test.js containing console.log('REPORT_HOOK_OK'). Run node report-live-hook-test.js with the shell tool. Then return the required long schema value exactly. It deliberately omits receipt formatting; because substantive proof exists, the answer must stream once and remain visible.",
          {
            type: 'object',
            properties: { answer: { type: 'string', enum: [LONG_REPORT] } },
            required: ['answer'],
            additionalProperties: false,
          }
        );
      } else if (phase === 'report') {
        phase = 'unproved';
        startTurn(5,
          "This is the substantive one-block circuit-breaker test. Do not inspect the directory or run git status. Your first and only tool action must be apply_patch: create unproved-live-hook-test.js containing console.log('UNPROVED_HOOK'). Do not run, render, test, or build it. Return the required schema value so the real Stop hook intervenes once and then records unresolved proof debt.",
          {
            type: 'object',
            properties: { answer: { type: 'string', enum: ['UNPROVED_EDIT_RESPONSE'] } },
            required: ['answer'],
            additionalProperties: false,
          }
        );
      } else if (phase === 'unproved') {
        phase = 'conversation';
        startTurn(6, 'Do not use tools. Reply with exactly: CONVERSATION_OK');
      } else if (phase === 'conversation') {
        try { verifyState(); } catch (error) { fail(error); return; }
        completed = true;
        clearTimeout(timeout);
        child.kill();
      }
    }
  }
});

child.on('error', fail);
child.on('exit', (code) => {
  if (!completed) fail(new Error(`Codex app-server exited ${code}`));
});

send({ method: 'initialize', id: 1, params: {
  clientInfo: { name: 'dev_rigor_live_test', title: 'Dev Rigor Live Test', version: '1.7.0' },
} });
timeout = setTimeout(() => fail(new Error('Timed out waiting for live Codex lifecycle')), 180000);
