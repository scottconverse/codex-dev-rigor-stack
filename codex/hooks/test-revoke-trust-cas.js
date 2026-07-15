#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REVOKER = require('./revoke-trust.js');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function versionConflict() {
  const error = new Error('Configuration was modified since last read. Fetch latest version and retry.');
  error.rpcError = {
    code: -32600,
    data: { config_write_error_code: 'configVersionConflict' },
    message: error.message,
  };
  return error;
}

async function unitRaceTest() {
  const home = path.resolve('C:\\isolated-codex-home');
  const owned = Array.from({ length: 7 }, (_, index) => `owned-${index}`);
  let state = Object.fromEntries([
    ...owned.map((key, index) => [key, { trusted_hash: `sha256:owned-${index}` }]),
    ['foreign-before', { trusted_hash: 'sha256:foreign-before' }],
  ]);
  let version = 'sha256:v1';
  let writes = 0;

  async function request(method, params) {
    if (method === 'config/read') {
      assert.equal(params.includeLayers, true, 'revocation must read the versioned user layer');
      return {
        config: { hooks: { state: clone(state) } },
        origins: {},
        layers: [{
          name: { type: 'user', file: path.join(home, 'config.toml'), profile: null },
          version,
          config: { hooks: { state: clone(state) } },
        }],
      };
    }
    assert.equal(method, 'config/batchWrite');
    assert.notEqual(params.expectedVersion, null, 'revocation must never disable CAS');
    writes += 1;
    if (writes === 1) {
      state['foreign-during-race'] = { trusted_hash: 'sha256:foreign-during-race' };
      version = 'sha256:v2';
      throw versionConflict();
    }
    assert.equal(params.expectedVersion, 'sha256:v2');
    assert.equal(params.edits.length, 1);
    assert.equal(params.edits[0].keyPath, 'hooks.state');
    assert.equal(params.edits[0].mergeStrategy, 'replace');
    state = clone(params.edits[0].value);
    version = 'sha256:v3';
    return { status: 'ok', version, filePath: path.join(home, 'config.toml') };
  }

  const result = await REVOKER.revokeOwnedState(request, home, owned);
  assert.equal(writes, 2, 'one exact CAS conflict should cause one versioned retry');
  assert.equal(result.attempts, 2);
  assert.deepEqual(state, {
    'foreign-before': { trusted_hash: 'sha256:foreign-before' },
    'foreign-during-race': { trusted_hash: 'sha256:foreign-during-race' },
  });
}

async function failClosedTests() {
  const home = path.resolve('C:\\isolated-codex-home');
  const layer = {
    name: { type: 'user', file: path.join(home, 'config.toml'), profile: null },
    version: 'sha256:unchanged',
    config: { hooks: { state: { owned: { trusted_hash: 'sha256:owned' } } } },
  };
  let conflictWrites = 0;
  await assert.rejects(
    REVOKER.revokeOwnedState(async method => {
      if (method === 'config/read') return { config: {}, origins: {}, layers: [clone(layer)] };
      conflictWrites += 1;
      throw versionConflict();
    }, home, ['owned']),
    /all 8 trust-revocation attempts; no unversioned write was attempted/,
  );
  assert.equal(conflictWrites, 8, 'the bounded CAS retry count changed');

  const foreignFailure = Object.assign(new Error('permission denied'), {
    rpcError: { code: -32000, data: { config_write_error_code: 'permissionDenied' } },
  });
  let otherWrites = 0;
  await assert.rejects(
    REVOKER.revokeOwnedState(async method => {
      if (method === 'config/read') return { config: {}, origins: {}, layers: [clone(layer)] };
      otherWrites += 1;
      throw foreignFailure;
    }, home, ['owned']),
    error => error === foreignFailure,
  );
  assert.equal(otherWrites, 1, 'a non-conflict app-server failure was incorrectly retried');

  let missingLayerWrites = 0;
  await assert.rejects(
    REVOKER.revokeOwnedState(async method => {
      if (method === 'config/read') return { config: {}, origins: {}, layers: [] };
      missingLayerWrites += 1;
      throw new Error('write should not run');
    }, home, ['owned']),
    /did not return the versioned user configuration layer/,
  );
  assert.equal(missingLayerWrites, 0, 'missing target-layer identity reached a write');
}

function durableOutcomeTest() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-rigor-revoke-outcome-'));
  try {
    fs.writeFileSync(path.join(home, 'config.toml'), '[foreign]\nkeep = true\n');
    const destination = path.join(home, 'rollback', 'trust-outcome.json');
    const keys = Array.from({ length: 7 }, (_, index) => `owned-${index}`);
    REVOKER.writeOutcome(destination, home, { version: 'sha256:verified' }, keys);
    const outcome = JSON.parse(fs.readFileSync(destination, 'utf8'));
    assert.equal(outcome.schema, 'dev-rigor-trust-revocation-outcome-v1');
    assert.equal(outcome.version, 'sha256:verified');
    assert.deepEqual(outcome.ownedKeys, keys);
    assert.equal(outcome.after.exists, true);
    assert.match(outcome.after.hash, /^[a-f0-9]{64}$/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

function ownershipIdentityTest() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-rigor-revoke-identity-'));
  try {
    const hooksDir = path.join(home, 'dev-rigor-stack', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    for (const name of ['dev-rigor-activate.js', 'dev-rigor-router.js', 'dev-rigor-ground.js']) {
      fs.writeFileSync(path.join(hooksDir, name), `'use strict';\n// ${name}\n`, 'utf8');
    }

    const expected = REVOKER.expectedHooks(home);
    const contract = expected.sessionStart;
    const canonicalCommand = contract.commands[0];
    assert.notEqual(canonicalCommand, canonicalCommand.toLowerCase(),
      'the expected integrity command must retain case-sensitive Base64 and JavaScript bytes');

    const base = {
      eventName: 'sessionStart',
      handlerType: 'command',
      source: 'user',
      enabled: true,
      timeoutSec: contract.timeoutSec,
      matcher: contract.matcher,
      statusMessage: contract.statusMessage,
    };
    const expectedSource = path.join(home, 'hooks.json');
    const exact = { ...base, key: 'exact', sourcePath: expectedSource, command: canonicalCommand };
    const mutatedCommand = { ...exact, key: 'case-mutated-command', command: canonicalCommand.toLowerCase() };
    const closeLookalike = { ...exact, key: 'trailing-byte-command', command: `${canonicalCommand} ` };
    assert.deepEqual(
      REVOKER.selectOwned([exact, mutatedCommand, closeLookalike], expectedSource, expected).map(hook => hook.key),
      ['exact'],
      'case-mutating or appending to a Base64/JavaScript integrity command must make it foreign',
    );

    const posixExpected = '/home/Scott/.codex/hooks.json';
    const posixExact = { ...base, key: 'posix-exact', sourcePath: posixExpected, command: canonicalCommand };
    const posixCaseDistinct = {
      ...posixExact,
      key: 'posix-case-distinct',
      sourcePath: '/home/scott/.codex/hooks.json',
    };
    assert.deepEqual(
      REVOKER.selectOwned([posixExact, posixCaseDistinct], posixExpected, expected, 'linux').map(hook => hook.key),
      ['posix-exact'],
      'POSIX source identity must be case-sensitive',
    );

    const winExpected = 'C:\\Users\\Scott\\.codex\\hooks.json';
    const winCaseVariant = {
      ...base,
      key: 'windows-case-variant',
      sourcePath: 'c:\\users\\scott\\.codex\\hooks.json',
      command: canonicalCommand,
    };
    assert.deepEqual(
      REVOKER.selectOwned([winCaseVariant], winExpected, expected, 'win32').map(hook => hook.key),
      ['windows-case-variant'],
      'Windows source identity must remain case-insensitive',
    );
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

function wireContractParityTest() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-rigor-revoke-wire-parity-'));
  try {
    const runtime = path.join(home, 'dev-rigor-stack');
    const hooksDir = path.join(runtime, 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    for (const name of ['dev-rigor-activate.js', 'dev-rigor-router.js', 'dev-rigor-ground.js']) {
      fs.copyFileSync(path.join(__dirname, name), path.join(hooksDir, name));
    }
    execFileSync(process.execPath, [path.join(__dirname, 'wire-hooks.js'), home, runtime, runtime], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    const config = JSON.parse(fs.readFileSync(path.join(home, 'hooks.json'), 'utf8'));
    const expected = REVOKER.expectedHooks(home);
    const events = {
      SessionStart: 'sessionStart', SubagentStart: 'subagentStart', UserPromptSubmit: 'userPromptSubmit',
      PreToolUse: 'preToolUse', PostToolUse: 'postToolUse', Stop: 'stop', SubagentStop: 'subagentStop',
    };
    for (const [configuredEvent, listedEvent] of Object.entries(events)) {
      const hook = config.hooks[configuredEvent][0].hooks[0];
      const commands = expected[listedEvent].commands;
      assert.ok(commands.includes(hook.command), `${configuredEvent} portable command drifted from exact revoker contract`);
      assert.ok(commands.includes(hook.commandWindows), `${configuredEvent} native command drifted from exact revoker contract`);
    }
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

function createClient(child) {
  let buffer = '';
  let stderr = '';
  let nextId = 1;
  const pending = new Map();
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    buffer += chunk;
    while (buffer.includes('\n')) {
      const newline = buffer.indexOf('\n');
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch (error) { continue; }
      const entry = pending.get(message.id);
      if (!entry) continue;
      pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) {
        const failure = new Error(message.error.message || JSON.stringify(message.error));
        failure.rpcError = message.error;
        entry.reject(failure);
      } else {
        entry.resolve(message.result);
      }
    }
  });
  return {
    stderr: () => stderr,
    request(method, params) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Codex did not answer ${method}. ${stderr}`));
        }, 20000);
        pending.set(id, { resolve, reject, timer });
        child.stdin.write(JSON.stringify({ method, id, params }) + '\n');
      });
    },
  };
}

async function appServerRaceTest() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-rigor-revoke-cas-'));
  const child = REVOKER.launchCodex(home);
  const client = createClient(child);
  try {
    await client.request('initialize', {
      clientInfo: { name: 'dev_rigor_revoke_cas_test', title: 'Dev Rigor Revoke CAS Test', version: '1.7.0' },
    });
    child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
    const initial = await client.request('config/read', { cwd: null, includeLayers: true });
    const owned = Array.from({ length: 7 }, (_, index) => `owned-${index}`);
    const seeded = Object.fromEntries([
      ...owned.map((key, index) => [key, { trusted_hash: `sha256:owned-${index}` }]),
      ['foreign-before', { trusted_hash: 'sha256:foreign-before' }],
    ]);
    const seed = await client.request('config/batchWrite', {
      edits: [{ keyPath: 'hooks.state', value: seeded, mergeStrategy: 'replace' }],
      filePath: null,
      expectedVersion: REVOKER.targetUserLayer(initial, home).version,
      reloadUserConfig: true,
    });
    assert.equal(seed.status, 'ok');

    let injected = false;
    async function racedRequest(method, params) {
      if (method === 'config/batchWrite' && !injected) {
        injected = true;
        const foreignWrite = await client.request('config/batchWrite', {
          edits: [{
            keyPath: 'hooks.state',
            value: { 'foreign-during-race': { trusted_hash: 'sha256:foreign-during-race' } },
            mergeStrategy: 'upsert',
          }],
          filePath: null,
          expectedVersion: params.expectedVersion,
          reloadUserConfig: true,
        });
        assert.equal(foreignWrite.status, 'ok');
      }
      return client.request(method, params);
    }

    const result = await REVOKER.revokeOwnedState(racedRequest, home, owned);
    assert.equal(result.attempts, 2, 'the actual stale app-server write was not retried exactly once');
    const finalRead = await client.request('config/read', { cwd: null, includeLayers: true });
    assert.deepEqual(REVOKER.targetUserLayer(finalRead, home).config.hooks.state, {
      'foreign-before': { trusted_hash: 'sha256:foreign-before' },
      'foreign-during-race': { trusted_hash: 'sha256:foreign-during-race' },
    });
    process.stdout.write('actual app-server CAS race: 7 owned removed; 2/2 foreign entries preserved\n');
  } finally {
    child.kill();
    await new Promise(resolve => child.once('exit', resolve));
    fs.rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

(async () => {
  await unitRaceTest();
  await failClosedTests();
  durableOutcomeTest();
  ownershipIdentityTest();
  wireContractParityTest();
  process.stdout.write('revoke CAS unit race: PASS\n');
  if (process.argv.includes('--app-server')) await appServerRaceTest();
})().catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
