#!/usr/bin/env node
'use strict';

// Real Codex integration check: isolated hooks/list -> batchWrite -> hooks/list.
const { spawn } = require('child_process');

const cwd = process.argv[2] || process.cwd();
const expectedEvents = new Set([
  'sessionStart', 'subagentStart', 'userPromptSubmit',
  'preToolUse', 'postToolUse', 'stop', 'subagentStop',
]);

const command = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'codex';
const args = process.platform === 'win32'
  ? ['/d', '/s', '/c', 'codex app-server']
  : ['app-server'];
const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
let buffer = '';
let stderr = '';
let completed = false;
let timeout;

function send(message) {
  child.stdin.write(JSON.stringify(message) + '\n');
}

function hooksFrom(message) {
  const entry = message.result && message.result.data && message.result.data[0];
  if (!entry) throw new Error('hooks/list returned no entry');
  if ((entry.errors || []).length) throw new Error(`hooks/list errors: ${entry.errors.join('; ')}`);
  return (entry.hooks || []).filter((hook) =>
    (hook.command || '').includes('Dev Rigor hook integrity check failed') &&
    (hook.command || '').includes('m._compile(b.toString(),f)')
  );
}

function assertExact(hooks) {
  if (hooks.length !== 7) throw new Error(`expected 7 owned hooks, received ${hooks.length}`);
  for (const event of expectedEvents) {
    if (hooks.filter((hook) => hook.eventName === event).length !== 1) {
      throw new Error(`expected exactly one ${event} hook`);
    }
  }
  if (hooks.some((hook) => !hook.key || !hook.currentHash)) throw new Error('hook key/hash missing');
  if (hooks.some((hook) => hook.handlerType !== 'command' || hook.source !== 'user' || !hook.enabled || hook.timeoutSec !== 5)) {
    throw new Error('hook metadata does not match the enabled command contract');
  }
  if (hooks.some((hook) => !/[a-f0-9]{64}/.test(hook.command || ''))) {
    throw new Error('hook command is missing its runtime SHA-256 binding');
  }
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
    const message = JSON.parse(line);
    if (message.error) throw new Error(JSON.stringify(message.error));
    if (message.id === 1) {
      send({ method: 'initialized', params: {} });
      send({ method: 'hooks/list', id: 2, params: { cwds: [cwd] } });
    } else if (message.id === 2) {
      const hooks = hooksFrom(message);
      assertExact(hooks);
      if (hooks.some((hook) => hook.trustStatus === 'trusted')) {
        throw new Error('isolated profile unexpectedly began trusted');
      }
      const state = Object.fromEntries(hooks.map((hook) => [
        hook.key, { trusted_hash: hook.currentHash },
      ]));
      send({
        method: 'config/batchWrite', id: 3,
        params: {
          edits: [{ keyPath: 'hooks.state', value: state, mergeStrategy: 'upsert' }],
          filePath: null, expectedVersion: null, reloadUserConfig: true,
        },
      });
    } else if (message.id === 3) {
      send({ method: 'hooks/list', id: 4, params: { cwds: [cwd] } });
    } else if (message.id === 4) {
      const hooks = hooksFrom(message);
      assertExact(hooks);
      if (hooks.some((hook) => hook.trustStatus !== 'trusted')) {
        throw new Error('Codex did not verify every owned hook as trusted');
      }
      completed = true;
      clearTimeout(timeout);
      process.stdout.write('Codex app-server trust round trip: 7/7 verified\n');
      child.kill();
    }
  }
});

child.on('error', (error) => {
  process.stderr.write(`Could not start Codex app server: ${error.message}\n`);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  if (!completed) {
    process.stderr.write(stderr || `Codex app server exited ${code}\n`);
    process.exitCode = 1;
  }
});

send({
  method: 'initialize', id: 1,
  params: { clientInfo: { name: 'dev_rigor_ci', title: 'Dev Rigor CI', version: '1.7.0' } },
});

timeout = setTimeout(() => {
  if (!completed) {
    process.stderr.write('Timed out waiting for Codex app-server trust round trip\n' + stderr);
    child.kill();
    process.exitCode = 1;
  }
}, 20000);
