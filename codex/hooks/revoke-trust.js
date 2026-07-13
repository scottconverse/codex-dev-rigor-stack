#!/usr/bin/env node
'use strict';

// Revoke only the six installed Dev Rigor hook hashes through Codex app-server.
// Run this before removing hooks.json definitions or the managed runtime.

const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const specifications = {
  sessionStart: ['dev-rigor-activate.js', '', 'startup|resume|clear|compact', 'Loading active dev-rigor reflex'],
  subagentStart: ['dev-rigor-activate.js', ' subagent', '', 'Loading active dev-rigor reflex'],
  userPromptSubmit: ['dev-rigor-router.js', '', '', 'Routing dev-rigor protocol'],
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
      commands: [integrityCommand(native, suffix, hash), integrityCommand(portable, suffix, hash)].map(value => value.toLowerCase()),
      matcher, statusMessage,
    }];
  }));
}

function selectOwned(hooks, expectedSource, expected) {
  return (hooks || []).filter(hook => {
    const contract = expected[hook.eventName];
    return contract && path.resolve(hook.sourcePath || '').toLowerCase() === expectedSource &&
      hook.handlerType === 'command' && hook.source === 'user' && hook.enabled === true && hook.timeoutSec === 5 &&
      (hook.matcher || '') === contract.matcher && (hook.statusMessage || '') === contract.statusMessage &&
      contract.commands.includes((hook.command || '').toLowerCase());
  });
}

function pruneState(state, ownedKeys) {
  const owned = new Set(ownedKeys);
  return Object.fromEntries(Object.entries(state || {}).filter(([key]) => !owned.has(key)));
}

function selfTest() {
  const state = { ownedA: { trusted_hash: 'sha256:a' }, foreign: { trusted_hash: 'sha256:f' }, ownedB: { trusted_hash: 'sha256:b' } };
  const result = pruneState(state, ['ownedA', 'ownedB']);
  if (JSON.stringify(result) !== JSON.stringify({ foreign: { trusted_hash: 'sha256:f' } })) {
    throw new Error('foreign trust state was not preserved exactly');
  }
  const expected = Object.fromEntries(Object.keys(specifications).map(name => [name, { commands: [`exact-${name}`.toLowerCase()], matcher: specifications[name][2], statusMessage: specifications[name][3] }]));
  const hooks = Object.entries(expected).map(([eventName, contract], index) => ({
    key: `owned${index}`, eventName, sourcePath: 'C:\\profile\\hooks.json', handlerType: 'command', source: 'user',
    enabled: true, timeoutSec: 5, matcher: contract.matcher, statusMessage: contract.statusMessage, command: contract.commands[0],
  }));
  hooks.push({ ...hooks[0], key: 'foreign-lookalike', eventName: 'unknownEvent', command: "node -e \"Dev Rigor hook integrity check failed m._compile(b.toString(),f)\"" });
  const selected = selectOwned(hooks, path.resolve('C:\\profile\\hooks.json').toLowerCase(), expected);
  if (selected.length !== 6 || selected.some(hook => hook.key === 'foreign-lookalike')) throw new Error('exact ownership selection accepted a foreign lookalike');
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

function launchCodex() {
  const forced = process.env.DEV_RIGOR_CODEX_EXE;
  const executable = forced || locateDesktopCodex();
  if (executable && path.extname(executable).toLowerCase() === '.exe') {
    return spawn(executable, ['app-server', '--listen', 'stdio://'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  }
  if (process.platform === 'win32') {
    const commandLine = executable
      ? `""${executable.replace(/"/g, '""')}" app-server --listen stdio://"`
      : 'codex app-server --listen stdio://';
    return spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', commandLine], {
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    });
  }
  return spawn(executable || 'codex', ['app-server', '--listen', 'stdio://'], { stdio: ['pipe', 'pipe', 'pipe'] });
}

async function main() {
  if (process.argv[2] === '--self-test') return selfTest();
  const codexHome = path.resolve(process.argv[2] || process.env.CODEX_HOME || path.join(require('os').homedir(), '.codex'));
  const cwd = path.resolve(process.argv[3] || process.cwd());
  const expectedSource = path.resolve(codexHome, 'hooks.json').toLowerCase();
  const expected = expectedHooks(codexHome);
  const child = launchCodex();
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
      if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
      else entry.resolve(message.result);
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
    await request('initialize', { clientInfo: { name: 'dev_rigor_trust_revoker', title: 'Dev Rigor Trust Revoker', version: '1.6.2' } });
    child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
    const listed = await request('hooks/list', { cwds: [cwd] });
    const entry = listed && listed.data && listed.data[0];
    if (!entry || (entry.errors || []).length) throw new Error(`Codex could not list hooks: ${JSON.stringify(entry && entry.errors)}`);
    const owned = selectOwned(entry.hooks, expectedSource, expected);
    if (owned.length !== 6 || Object.keys(specifications).some(eventName => owned.filter(hook => hook.eventName === eventName).length !== 1)) {
      throw new Error(`Expected one exact installed Dev Rigor hook for each lifecycle event before revocation; found ${owned.length}.`);
    }

    const read = await request('config/read', { cwd: null, includeLayers: false });
    const state = read && read.config && read.config.hooks && read.config.hooks.state || {};
    const remaining = pruneState(state, owned.map(hook => hook.key));
    const write = await request('config/batchWrite', {
      edits: [{ keyPath: 'hooks.state', value: remaining, mergeStrategy: 'replace' }],
      filePath: null,
      expectedVersion: null,
      reloadUserConfig: true,
    });
    if (!write || !['ok', 'okOverridden'].includes(write.status)) throw new Error('Codex did not confirm the trust revocation.');
    const verified = await request('config/read', { cwd: null, includeLayers: false });
    const verifiedState = verified && verified.config && verified.config.hooks && verified.config.hooks.state || {};
    if (owned.some(hook => Object.prototype.hasOwnProperty.call(verifiedState, hook.key))) {
      throw new Error('At least one Dev Rigor trusted hash remained after revocation.');
    }
    for (const [key, value] of Object.entries(remaining)) {
      if (JSON.stringify(verifiedState[key]) !== JSON.stringify(value)) throw new Error(`Foreign trust state changed: ${key}`);
    }
    process.stdout.write(`Revoked ${owned.length}/6 Dev Rigor trusted hashes; preserved ${Object.keys(remaining).length} unrelated trust entries.\n`);
  } finally {
    child.kill();
  }
}

if (require.main === module) {
  main().catch(error => { process.stderr.write(`Trust revocation failed: ${error.message}\n`); process.exitCode = 1; });
}

module.exports = { pruneState, selectOwned, locateDesktopCodex, launchCodex };
