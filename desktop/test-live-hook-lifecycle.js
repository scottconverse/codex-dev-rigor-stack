#!/usr/bin/env node
'use strict';

// Authenticated, disposable-profile integration check. This is intentionally
// separate from CI's deterministic app-server trust test: it proves that the
// installed client actually emits PostToolUse and Stop for a real model turn.
const { spawn } = require('child_process');
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

const command = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'codex';
const args = process.platform === 'win32' ? ['/d', '/s', '/c', 'codex app-server'] : ['app-server'];
const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
let buffer = '';
let stderr = '';
let threadId = '';
let firstTurnId = '';
let retryTurnId = '';
let phase = 'initialize';
let completed = false;
let timeout;
const firstItems = new Set();
const retryItems = new Set();
let conversationMessage = '';

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
  const stateDir = path.join(codexHome, 'dev-rigor-stack', 'state');
  const ledgers = fs.readdirSync(stateDir).filter((name) => name.startsWith('ground-v3-'));
  if (ledgers.length !== 2) throw new Error(`expected two live coding-turn ledgers, found ${ledgers.length}`);
  const contents = ledgers.map((name) =>
    fs.readFileSync(path.join(stateDir, name), 'utf8').split('\n').filter(Boolean)
  );
  const happy = contents.find((lines) =>
    ['E ', 'X ', 'C '].every((prefix) => lines.some((line) => line.startsWith(prefix))) &&
    !lines.some((line) => line.startsWith('B '))
  );
  const retry = contents.find((lines) =>
    ['E ', 'X ', 'B ', 'C '].every((prefix) => lines.some((line) => line.startsWith(prefix)))
  );
  if (!happy) throw new Error(`missing happy-path E/X/C ledger: ${JSON.stringify(contents)}`);
  if (!retry) throw new Error(`missing one-block retry E/X/B/C ledger: ${JSON.stringify(contents)}`);
  if (retry.filter((line) => line.startsWith('B ')).length !== 1) {
    throw new Error(`retry turn blocked more than once: ${retry.join(' | ')}`);
  }
  if (!firstItems.has('fileChange') || !firstItems.has('commandExecution')) {
    throw new Error(`model turn did not exercise both edit and execution: ${[...firstItems].join(', ')}`);
  }
  if (!retryItems.has('fileChange') || !retryItems.has('commandExecution')) {
    throw new Error(`retry turn did not exercise both edit and execution: ${[...retryItems].join(', ')}`);
  }
  if (!conversationMessage.includes('CONVERSATION_OK')) {
    throw new Error(`later conversation did not complete normally: ${conversationMessage}`);
  }
  process.stdout.write(
    `Live Codex lifecycle: happy turn ${firstTurnId}; one-block retry ${retryTurnId}; later conversation passed\n`
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
        "This is a local hook integration test. Use apply_patch to create live-hook-test.js containing console.log('LIVE_HOOK_OK'). Then run node live-hook-test.js with the shell tool. End with the required proved, blast, and skipped evidence receipt."
      );
    } else if (message.id === 3) {
      firstTurnId = message.result.turn.id;
    } else if (message.id === 4) {
      retryTurnId = message.result.turn.id;
    } else if (message.id === 5) {
      // Wait for the final turn/completed.
    } else if (message.method === 'item/completed' && phase === 'first') {
      if (message.params && message.params.item && message.params.item.type) {
        firstItems.add(message.params.item.type);
      }
    } else if (message.method === 'item/completed' && phase === 'retry') {
      if (message.params && message.params.item && message.params.item.type) {
        retryItems.add(message.params.item.type);
      }
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
        phase = 'retry';
        startTurn(4,
          "This is the Stop-hook retry circuit-breaker test. Use apply_patch to create retry-live-hook-test.js containing console.log('RETRY_HOOK_OK'). Run node retry-live-hook-test.js with the shell tool. Return the required schema value; it deliberately omits the receipt so the real Stop hook can reject it once.",
          {
            type: 'object',
            properties: { answer: { type: 'string', enum: ['FIRST_ATTEMPT_NO_RECEIPT'] } },
            required: ['answer'],
            additionalProperties: false,
          }
        );
      } else if (phase === 'retry') {
        phase = 'conversation';
        startTurn(5, 'Do not use tools. Reply with exactly: CONVERSATION_OK');
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
  clientInfo: { name: 'dev_rigor_live_test', title: 'Dev Rigor Live Test', version: '1.6.3' },
} });
timeout = setTimeout(() => fail(new Error('Timed out waiting for live Codex lifecycle')), 180000);
