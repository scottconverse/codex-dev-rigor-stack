#!/usr/bin/env node
// Codex SessionStart/SubagentStart compact activation and state restoration.

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
const stateDir = path.join(codexHome, 'dev-rigor-stack', 'state');
const disciplinesDir = path.join(__dirname, '..', 'disciplines');

function readPayload() {
  try { return JSON.parse(fs.readFileSync(0, 'utf8')); } catch (_) { return {}; }
}
function hash(value) { return crypto.createHash('sha256').update(String(value)).update('\0').digest('hex'); }
function taskPath(session) { return path.join(stateDir, `task-v4-${hash(session)}.json`); }
function defaultTask() {
  return normalizeTask({ version: 4, mode: 'ON', salt: crypto.randomBytes(32).toString('hex') });
}
function normalizeTask(task) {
  task.dirtyEdits = Array.isArray(task.dirtyEdits) ? task.dirtyEdits : [];
  task.proofs = Array.isArray(task.proofs) ? task.proofs : [];
  task.unresolved = Array.isArray(task.unresolved) ? task.unresolved : [];
  task.warnings = task.warnings && typeof task.warnings === 'object' ? task.warnings : {};
  task.notices = Array.isArray(task.notices) ? task.notices : [];
  task.children = Array.isArray(task.children) ? task.children : [];
  task.checkpoint = Number.isInteger(task.checkpoint) && task.checkpoint >= 0 ? task.checkpoint : 0;
  task.blockCount = Number.isInteger(task.blockCount) && task.blockCount >= 0 ? task.blockCount : 0;
  task.delivery = task.delivery && typeof task.delivery === 'object' ? task.delivery : { preToolUse: 0, postToolUse: 0, stop: 0 };
  return task;
}
function loadTask(session) {
  try {
    const parsed = JSON.parse(fs.readFileSync(taskPath(session), 'utf8'));
    if (parsed && parsed.version === 4) return normalizeTask(parsed);
  } catch (_) { /* first activation */ }
  return defaultTask();
}
function loadTaskByKey(key) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(stateDir, `task-v4-${key}.json`), 'utf8'));
    return parsed && parsed.version === 4 ? normalizeTask(parsed) : null;
  } catch (_) { return null; }
}
function saveTask(session, task) {
  try {
    fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    const target = taskPath(session);
    const temporary = `${target}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(task) + '\n', { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporary, target);
    try { fs.chmodSync(target, 0o600); } catch (_) { /* Windows inherits profile ACLs. */ }
  } catch (_) { /* activation must fail open */ }
}
function parentSession(payload) {
  for (const key of ['parent_session_id', 'parentSessionId', 'parent_thread_id', 'parentThreadId']) {
    if (typeof payload[key] === 'string' && payload[key]) return payload[key];
  }
  return '';
}
function routeContext(session) {
  const safe = String(session).replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe) return '';
  let routes = [];
  try { routes = fs.readFileSync(path.join(stateDir, `router-${safe}.log`), 'utf8').split('\n').filter(Boolean); }
  catch (_) { return ''; }
  return [...new Set(routes)].map((route) => {
    try { return fs.readFileSync(path.join(disciplinesDir, `${route}.md`), 'utf8').replace(/^\uFEFF/, ''); }
    catch (_) { return ''; }
  }).filter(Boolean).join('\n');
}

const payload = readPayload();
const session = typeof payload.session_id === 'string' ? payload.session_id : '';
const subagent = process.argv[2] === 'subagent' || payload.hook_event_name === 'SubagentStart';
const event = subagent ? 'SubagentStart' : 'SessionStart';
let task = session ? loadTask(session) : defaultTask();
let warning = '';

if (subagent && session) {
  const parent = parentSession(payload);
  if (parent) {
    task.parentKey = hash(parent);
    const parentTask = loadTask(parent);
    const childKey = hash(session);
    if (!parentTask.children.includes(childKey)) parentTask.children.push(childKey);
    saveTask(parent, parentTask);
    task.mode = parentTask.mode;
  } else if (!task.parentKey) {
    task.mode = 'WARN';
    task.unboundParent = true;
    warning = 'Parent task identity is unavailable; this subagent visibly fails open in mode: WARN and does not infer inheritance.';
  }
  saveTask(session, task);
} else if (session) {
  saveTask(session, task);
}

if (task.parentKey) {
  const parentTask = loadTaskByKey(task.parentKey);
  task.mode = parentTask ? parentTask.mode : 'WARN';
  if (!parentTask) warning = 'Parent task state is unavailable; this subagent visibly fails open in mode: WARN.';
}

let core;
try { core = fs.readFileSync(path.join(__dirname, '..', 'dev-rigor-core.md'), 'utf8').replace(/^\uFEFF/, ''); }
catch (_) { process.exit(0); }
const routed = session ? routeContext(session) : '';
const context = [core, `Current task mode: ${task.mode}`, warning, routed].filter(Boolean).join('\n\n');

try {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: context } }));
} catch (_) { /* closed stdout */ }
