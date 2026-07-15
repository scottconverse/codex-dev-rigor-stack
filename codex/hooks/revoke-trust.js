#!/usr/bin/env node
'use strict';

// Revoke only the seven installed Dev Rigor hook hashes through Codex app-server.
// Run this before removing hooks.json definitions or the managed runtime.

const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { isDeepStrictEqual } = require('util');

const MAX_CAS_ATTEMPTS = 8;
const OUTCOME_SCHEMA = 'dev-rigor-trust-revocation-outcome-v1';

const specifications = {
  sessionStart: ['dev-rigor-activate.js', '', 'startup|resume|clear|compact', 'Loading active dev-rigor reflex'],
  subagentStart: ['dev-rigor-activate.js', ' subagent', '', 'Loading active dev-rigor reflex'],
  userPromptSubmit: ['dev-rigor-router.js', '', '', 'Routing dev-rigor protocol'],
  preToolUse: ['dev-rigor-ground.js', ' snapshot', '^(Bash|PowerShell|apply_patch|Edit|Write|MultiEdit|NotebookEdit|mcp__.*(preview|browser|chrome|computer|screenshot|navigate|snapshot|exec|run|test|shell|terminal|jupyter|notebook|ide|eval).*)$', 'Snapshotting dev-rigor worktree state'],
  postToolUse: ['dev-rigor-ground.js', ' record', '^(Bash|PowerShell|apply_patch|Edit|Write|MultiEdit|NotebookEdit|mcp__.*(preview|browser|chrome|computer|screenshot|navigate|snapshot|exec|run|test|shell|terminal|jupyter|notebook|ide|eval).*)$', ''],
  stop: ['dev-rigor-ground.js', ' check', '', 'Checking dev-rigor evidence'],
  subagentStop: ['dev-rigor-ground.js', ' check', '', 'Checking subagent evidence'],
};

function integrityCommand(scriptPath, suffix, hash) {
  const encodedPath = Buffer.from(scriptPath, 'utf8').toString('base64');
  const loader = `const f=Buffer.from('${encodedPath}','base64').toString(),b=require('fs').readFileSync(f);` +
    `if(require('crypto').createHash('sha256').update(b).digest('hex')!=='${hash}')` +
    `{console.error('Dev Rigor hook integrity check failed: '+f);process.exit(2)}` +
    `const M=require('module'),m=new M(f,module);m.filename=f;m.paths=M._nodeModulePaths(require('path').dirname(f));` +
    `process.argv.splice(1,0,f);m._compile(b.toString(),f)`;
  return `node -e "${loader}"${suffix}`;
}

function expectedHooks(codexHome) {
  const runtime = path.join(codexHome, 'dev-rigor-stack', 'hooks');
  return Object.fromEntries(Object.entries(specifications).map(([eventName, [script, suffix, matcher, statusMessage]]) => {
    const native = path.join(runtime, script);
    const portable = native.replace(/\\/g, '/');
    const hash = crypto.createHash('sha256').update(fs.readFileSync(native)).digest('hex');
    return [eventName, {
      commands: [...new Set([integrityCommand(native, suffix, hash), integrityCommand(portable, suffix, hash)])],
      matcher, statusMessage, timeoutSec: ['preToolUse', 'postToolUse', 'stop', 'subagentStop'].includes(eventName) ? 15 : 5,
    }];
  }));
}

function selectOwned(hooks, expectedSource, expected, platform = process.platform) {
  const sourceIdentity = comparablePath(expectedSource, platform);
  return (hooks || []).filter(hook => {
    const contract = expected[hook.eventName];
    return contract && comparablePath(hook.sourcePath || '', platform) === sourceIdentity &&
      hook.handlerType === 'command' && hook.source === 'user' && hook.enabled === true && hook.timeoutSec === contract.timeoutSec &&
      (hook.matcher || '') === contract.matcher && (hook.statusMessage || '') === contract.statusMessage &&
      contract.commands.includes(hook.command || '');
  });
}

function pruneState(state, ownedKeys) {
  const owned = new Set(ownedKeys);
  return Object.fromEntries(Object.entries(state || {}).filter(([key]) => !owned.has(key)));
}

function comparablePath(value, platform = process.platform) {
  const resolved = platform === 'win32' ? path.win32.resolve(value) : path.posix.resolve(value);
  return platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function fileSnapshot(file) {
  if (!fs.existsSync(file)) return { exists: false, hash: null };
  return { exists: true, hash: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') };
}

function writeOutcome(file, codexHome, result, ownedKeys) {
  const destination = path.resolve(file);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  const outcome = {
    schema: OUTCOME_SCHEMA,
    codexHomeIdentity: crypto.createHash('sha256').update(comparablePath(codexHome), 'utf8').digest('hex'),
    after: fileSnapshot(path.join(path.resolve(codexHome), 'config.toml')),
    ownedKeys: [...new Set(ownedKeys)].sort(),
    version: result.version,
  };
  const descriptor = fs.openSync(temporary, 'wx', 0o600);
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(outcome, null, 2)}\n`, 'utf8');
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fs.renameSync(temporary, destination);
  if (process.platform !== 'win32') {
    let directory;
    try { directory = fs.openSync(path.dirname(destination), 'r'); fs.fsyncSync(directory); } catch {}
    finally { if (directory !== undefined) try { fs.closeSync(directory); } catch {} }
  }
}

function targetUserLayer(read, codexHome) {
  const target = comparablePath(path.join(codexHome, 'config.toml'));
  const layer = (read && read.layers || []).find(candidate => {
    const name = candidate && candidate.name;
    return name && name.type === 'user' && !name.profile && typeof name.file === 'string' &&
      comparablePath(name.file) === target;
  });
  if (!layer || typeof layer.version !== 'string' || !layer.version) {
    throw new Error(`Codex did not return the versioned user configuration layer for ${path.join(codexHome, 'config.toml')}.`);
  }
  return layer;
}

function layerTrustState(layer) {
  const state = layer && layer.config && layer.config.hooks && layer.config.hooks.state || {};
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new Error('Codex returned hooks.state with an unsafe non-object shape; refusing trust revocation.');
  }
  return state;
}

function isConfigVersionConflict(error) {
  return !!(error && error.rpcError && error.rpcError.data &&
    error.rpcError.data.config_write_error_code === 'configVersionConflict');
}

async function revokeOwnedState(request, codexHome, ownedKeys) {
  const target = path.join(path.resolve(codexHome), 'config.toml');
  const keys = [...new Set(ownedKeys)];
  if (!keys.length) throw new Error('No exact owned trust keys were supplied for revocation.');

  for (let attempt = 1; attempt <= MAX_CAS_ATTEMPTS; attempt += 1) {
    const read = await request('config/read', { cwd: null, includeLayers: true });
    const layer = targetUserLayer(read, codexHome);
    const version = layer.version;
    const remaining = pruneState(layerTrustState(layer), keys);
    let write;
    try {
      write = await request('config/batchWrite', {
        edits: [{ keyPath: 'hooks.state', value: remaining, mergeStrategy: 'replace' }],
        filePath: target,
        expectedVersion: version,
        reloadUserConfig: true,
      });
    } catch (error) {
      if (isConfigVersionConflict(error) && attempt < MAX_CAS_ATTEMPTS) continue;
      if (isConfigVersionConflict(error)) {
        throw new Error(`Codex user configuration changed during all ${MAX_CAS_ATTEMPTS} trust-revocation attempts; no unversioned write was attempted.`);
      }
      throw error;
    }
    if (!write || !['ok', 'okOverridden'].includes(write.status) || typeof write.version !== 'string') {
      throw new Error('Codex did not confirm the versioned trust revocation.');
    }

    const verified = await request('config/read', { cwd: null, includeLayers: true });
    const verifiedLayer = targetUserLayer(verified, codexHome);
    if (verifiedLayer.version !== write.version) {
      if (attempt < MAX_CAS_ATTEMPTS) continue;
      throw new Error(`Codex user configuration changed during all ${MAX_CAS_ATTEMPTS} trust-verification attempts; exact preservation could not be verified.`);
    }
    const verifiedState = layerTrustState(verifiedLayer);
    if (keys.some(key => Object.prototype.hasOwnProperty.call(verifiedState, key))) {
      throw new Error('At least one Dev Rigor trusted hash remained after revocation.');
    }
    for (const [key, value] of Object.entries(remaining)) {
      if (!isDeepStrictEqual(verifiedState[key], value)) throw new Error(`Foreign trust state changed: ${key}`);
    }
    if (Object.keys(verifiedState).length !== Object.keys(remaining).length) {
      throw new Error('Foreign trust state changed: the stable user-layer key set did not match the versioned write.');
    }
    return { attempts: attempt, preserved: Object.keys(verifiedState).length, version: write.version };
  }
  throw new Error('Trust revocation exhausted its versioned retries.');
}

function selfTest() {
  const state = { ownedA: { trusted_hash: 'sha256:a' }, foreign: { trusted_hash: 'sha256:f' }, ownedB: { trusted_hash: 'sha256:b' } };
  const result = pruneState(state, ['ownedA', 'ownedB']);
  if (JSON.stringify(result) !== JSON.stringify({ foreign: { trusted_hash: 'sha256:f' } })) {
    throw new Error('foreign trust state was not preserved exactly');
  }
  const expected = Object.fromEntries(Object.keys(specifications).map(name => [name, {
    commands: [`exact-${name}`], matcher: specifications[name][2], statusMessage: specifications[name][3],
    timeoutSec: ['preToolUse', 'postToolUse', 'stop', 'subagentStop'].includes(name) ? 15 : 5,
  }]));
  const hooksSource = path.resolve('profile', 'hooks.json');
  const hooks = Object.entries(expected).map(([eventName, contract], index) => ({
    key: `owned${index}`, eventName, sourcePath: hooksSource, handlerType: 'command', source: 'user',
    enabled: true, timeoutSec: contract.timeoutSec, matcher: contract.matcher, statusMessage: contract.statusMessage, command: contract.commands[0],
  }));
  hooks.push({ ...hooks[0], key: 'foreign-lookalike', eventName: 'unknownEvent', command: "node -e \"Dev Rigor hook integrity check failed m._compile(b.toString(),f)\"" });
  const selected = selectOwned(hooks, hooksSource, expected);
  if (selected.length !== Object.keys(specifications).length || selected.some(hook => hook.key === 'foreign-lookalike')) throw new Error('exact ownership selection accepted a foreign lookalike');
  process.stdout.write('revoke-trust self-test: owned state removed and foreign state preserved\n');
}

function locateDesktopCodex() {
  if (process.platform !== 'win32' || !process.env.LOCALAPPDATA) return null;
  const root = path.join(process.env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin');
  const found = [];
  function visit(directory) {
    let entries;
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch (error) { return; }
    for (const entry of entries) {
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(candidate);
      else if (entry.isFile() && entry.name.toLowerCase() === 'codex.exe') {
        try { found.push({ candidate, modified: fs.statSync(candidate).mtimeMs }); } catch (error) { }
      }
    }
  }
  visit(root);
  found.sort((left, right) => right.modified - left.modified);
  return found.length ? found[0].candidate : null;
}

function codexEnvironment(codexHome, base = process.env) {
  return { ...base, CODEX_HOME: path.resolve(codexHome) };
}

function launchCodex(codexHome) {
  const forced = process.env.DEV_RIGOR_CODEX_EXE;
  const executable = forced || locateDesktopCodex();
  const env = codexEnvironment(codexHome);
  if (executable && path.extname(executable).toLowerCase() === '.exe') {
    return spawn(executable, ['app-server', '--listen', 'stdio://'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env });
  }
  if (process.platform === 'win32') {
    const commandLine = executable
      ? `""${executable.replace(/"/g, '""')}" app-server --listen stdio://"`
      : 'codex app-server --listen stdio://';
    return spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', commandLine], {
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env,
    });
  }
  return spawn(executable || 'codex', ['app-server', '--listen', 'stdio://'], { stdio: ['pipe', 'pipe', 'pipe'], env });
}

async function main() {
  if (process.argv[2] === '--self-test') return selfTest();
  const codexHome = path.resolve(process.argv[2] || process.env.CODEX_HOME || path.join(require('os').homedir(), '.codex'));
  const cwd = path.resolve(process.argv[3] || process.cwd());
  const outcomeIndex = process.argv.indexOf('--outcome-file');
  const outcomeFile = outcomeIndex >= 0 ? process.argv[outcomeIndex + 1] : '';
  if (outcomeIndex >= 0 && !outcomeFile) throw new Error('--outcome-file requires a path.');
  const expectedSource = path.resolve(codexHome, 'hooks.json');
  const expected = expectedHooks(codexHome);
  const child = launchCodex(codexHome);
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
      } else entry.resolve(message.result);
    }
  });

  function request(method, params) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Codex did not answer ${method}. ${stderr}`));
      }, 20000);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ method, id, params }) + '\n');
    });
  }

  try {
    await request('initialize', { clientInfo: { name: 'dev_rigor_trust_revoker', title: 'Dev Rigor Trust Revoker', version: '1.7.0' } });
    child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
    const listed = await request('hooks/list', { cwds: [cwd] });
    const entry = listed && listed.data && listed.data[0];
    if (!entry || (entry.errors || []).length) throw new Error(`Codex could not list hooks: ${JSON.stringify(entry && entry.errors)}`);
    const owned = selectOwned(entry.hooks, expectedSource, expected);
    if (owned.length !== Object.keys(specifications).length || Object.keys(specifications).some(eventName => owned.filter(hook => hook.eventName === eventName).length !== 1)) {
      throw new Error(`Expected one exact installed Dev Rigor hook for each lifecycle event before revocation; found ${owned.length}.`);
    }

    const ownedKeys = owned.map(hook => hook.key);
    const result = await revokeOwnedState(request, codexHome, ownedKeys);
    if (outcomeFile) writeOutcome(outcomeFile, codexHome, result, ownedKeys);
    process.stdout.write(`Revoked ${owned.length}/${Object.keys(specifications).length} Dev Rigor trusted hashes with versioned compare-and-swap after ${result.attempts} attempt(s); preserved ${result.preserved} unrelated trust entries.\n`);
  } finally {
    child.kill();
  }
}

if (require.main === module) {
  main().catch(error => { process.stderr.write(`Trust revocation failed: ${error.message}\n`); process.exitCode = 1; });
}

module.exports = {
  expectedHooks, pruneState, selectOwned, locateDesktopCodex, codexEnvironment, launchCodex,
  targetUserLayer, isConfigVersionConflict, revokeOwnedState, fileSnapshot, writeOutcome,
};
