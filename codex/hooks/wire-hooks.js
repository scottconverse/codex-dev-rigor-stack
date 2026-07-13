#!/usr/bin/env node
// Merge/remove the active dev-rigor entries in CODEX_HOME/hooks.json.

const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const path = require('path');

let args = process.argv.slice(2);
const remove = args[0] === '--remove';
const checkOnly = args[0] === '--check';
if (remove || checkOnly) args = args.slice(1);
const codexHome = path.resolve(args[0] || process.env.CODEX_HOME || path.join(os.homedir(), '.codex'));
const runtimeRoot = path.resolve(args[1] || path.join(codexHome, 'dev-rigor-stack'));
const contentRoot = path.resolve(args[2] || runtimeRoot);
const hooksPath = path.join(codexHome, 'hooks.json');
const events = ['SessionStart', 'SubagentStart', 'UserPromptSubmit', 'PostToolUse', 'Stop', 'SubagentStop'];

let config = {};
let original = '';
if (fs.existsSync(hooksPath)) {
  original = fs.readFileSync(hooksPath, 'utf8');
  try { config = JSON.parse(original.replace(/^\uFEFF/, '')); }
  catch (error) {
    console.error(`FAIL  ${hooksPath} is not valid JSON (${error.message}). Refusing to overwrite it.`);
    process.exit(1);
  }
}

function refuse(message) {
  console.error(`FAIL  ${hooksPath} has an unexpected shape (${message}). Refusing to overwrite it.`);
  process.exit(1);
}

if (!config || typeof config !== 'object' || Array.isArray(config)) refuse('root is not an object');
if ('hooks' in config && (!config.hooks || typeof config.hooks !== 'object' || Array.isArray(config.hooks))) refuse('hooks is not an object');
config.hooks = config.hooks || {};
for (const event of events) {
  if (event in config.hooks && !Array.isArray(config.hooks[event])) refuse(`hooks.${event} is not an array`);
  config.hooks[event] = config.hooks[event] || [];
}

if (checkOnly) {
  console.log(`ok    Codex hook configuration preflight passed: ${hooksPath}`);
  process.exit(0);
}

function command(script, suffix = '') {
  const native = path.join(runtimeRoot, 'hooks', script);
  const portable = native.replace(/\\/g, '/');
  const content = path.join(contentRoot, 'hooks', script);
  const expectedHash = crypto.createHash('sha256').update(fs.readFileSync(content)).digest('hex');
  return {
    command: integrityCommand(portable, suffix, expectedHash),
    commandWindows: integrityCommand(native, suffix, expectedHash),
  };
}

function integrityCommand(scriptPath, suffix = '', expectedHash) {
  const hash = expectedHash || crypto.createHash('sha256').update(fs.readFileSync(scriptPath)).digest('hex');
  const encodedPath = Buffer.from(scriptPath, 'utf8').toString('base64');
  const loader = `const f=Buffer.from('${encodedPath}','base64').toString(),b=require('fs').readFileSync(f);` +
    `if(require('crypto').createHash('sha256').update(b).digest('hex')!=='${hash}')` +
    `{console.error('Dev Rigor hook integrity check failed: '+f);process.exit(2)}` +
    `const M=require('module'),m=new M(f,module);m.filename=f;m.paths=M._nodeModulePaths(require('path').dirname(f));` +
    `process.argv.splice(1,0,f);m._compile(b.toString(),f)`;
  return `node -e "${loader}"${suffix}`;
}

const definitions = {
  SessionStart: {
    matcher: 'startup|resume|clear|compact',
    hooks: [{ type: 'command', ...command('dev-rigor-activate.js'), timeout: 5, statusMessage: 'Loading active dev-rigor reflex' }],
  },
  SubagentStart: {
    hooks: [{ type: 'command', ...command('dev-rigor-activate.js', ' subagent'), timeout: 5, statusMessage: 'Loading active dev-rigor reflex' }],
  },
  UserPromptSubmit: {
    hooks: [{ type: 'command', ...command('dev-rigor-router.js'), timeout: 5, statusMessage: 'Routing dev-rigor protocol' }],
  },
  PostToolUse: {
    matcher: '^(Bash|PowerShell|apply_patch|Edit|Write|MultiEdit|NotebookEdit|mcp__.*(preview|browser|chrome|computer|screenshot|navigate|snapshot|exec|run|test|shell|terminal|jupyter|notebook|ide|eval).*)$',
    hooks: [{ type: 'command', ...command('dev-rigor-ground.js', ' record'), timeout: 5 }],
  },
  Stop: {
    hooks: [{ type: 'command', ...command('dev-rigor-ground.js', ' check'), timeout: 5, statusMessage: 'Checking dev-rigor evidence' }],
  },
  SubagentStop: {
    hooks: [{ type: 'command', ...command('dev-rigor-ground.js', ' check'), timeout: 5, statusMessage: 'Checking subagent evidence' }],
  },
};

function isOwned(event, entry) {
  const expected = definitions[event];
  if (!entry || !Array.isArray(entry.hooks) || entry.hooks.length !== 1 || !expected) return false;
  const actualHook = entry.hooks[0];
  const expectedHook = expected.hooks[0];
  if (!actualHook || actualHook.type !== 'command') return false;
  if (actualHook.command === expectedHook.command ||
    actualHook.command === expectedHook.commandWindows ||
    actualHook.commandWindows === expectedHook.command ||
    actualHook.commandWindows === expectedHook.commandWindows) return true;

  const specs = {
    SessionStart: ['dev-rigor-activate.js', ''],
    SubagentStart: ['dev-rigor-activate.js', ' subagent'],
    UserPromptSubmit: ['dev-rigor-router.js', ''],
    PostToolUse: ['dev-rigor-ground.js', ' record'],
    Stop: ['dev-rigor-ground.js', ' check'],
    SubagentStop: ['dev-rigor-ground.js', ' check'],
  };
  const [script, suffix] = specs[event];
  const native = path.join(runtimeRoot, 'hooks', script);
  const portable = native.replace(/\\/g, '/');
  const candidates = [actualHook.command, actualHook.commandWindows].filter(Boolean);
  return candidates.some((actual) =>
    actual === `node "${native}"${suffix}` ||
    actual === `node "${portable}"${suffix}` ||
    matchesIntegrityCommand(actual, native, suffix) ||
    matchesIntegrityCommand(actual, portable, suffix)
  );
}

function matchesIntegrityCommand(actual, scriptPath, suffix) {
  const marker = 'HASH_PLACEHOLDER';
  const template = integrityCommand(scriptPath, suffix, marker);
  const escaped = template.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped.replace(marker, '[a-f0-9]{64}')}$`).test(actual);
}

for (const event of events) {
  config.hooks[event] = config.hooks[event].filter((entry) => !isOwned(event, entry));
  if (!remove) config.hooks[event].push(definitions[event]);
  if (remove && config.hooks[event].length === 0) delete config.hooks[event];
}

const next = JSON.stringify(config, null, 2) + '\n';
if (next === original) {
  console.log(remove ? `ok    active dev-rigor hooks already absent from ${hooksPath}` : `ok    active dev-rigor hooks already present in ${hooksPath}`);
  process.exit(0);
}

fs.mkdirSync(codexHome, { recursive: true });
if (original) {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 17);
  const backupDir = path.join(codexHome, '.backup', 'codex-dev-rigor-stack-hooks', stamp);
  fs.mkdirSync(backupDir, { recursive: true });
  fs.writeFileSync(path.join(backupDir, 'hooks.json'), original, 'utf8');
}
fs.writeFileSync(hooksPath, next, 'utf8');
console.log(remove ? `ok    removed active dev-rigor hooks from ${hooksPath}` : `ok    wired active dev-rigor hooks into ${hooksPath}`);
