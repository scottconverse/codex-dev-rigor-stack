#!/usr/bin/env node
// Codex UserPromptSubmit router: inject one matching discipline per session.

const fs = require('fs');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const os = require('os');
const path = require('path');

const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
const stateDir = path.join(codexHome, 'dev-rigor-stack', 'state');
const associationDir = path.join(stateDir, 'associations-v4');
const associationDebtDir = path.join(stateDir, 'association-debt-v4');
const associationResolutionDir = path.join(stateDir, 'association-resolutions-v4');
const disciplinesDir = path.join(__dirname, '..', 'disciplines');
const LOCK_WAIT_MS = 1800;
const ASSOCIATION_DEBT_CODES = new Set([
  'association-state-failed', 'association-parent-conflict',
  'association-edge-persist-failed', 'association-parent-state-failed',
  'missing-parent-state', 'missing-child-state',
  'parent-unavailable', 'task-lock-timeout', 'task-state-corrupt',
  'task-state-missing', 'task-state-save-failed',
]);

const SYMPTOM = /\b(bug|broken|fails?\b|failing|crash(es|ed|ing)?|error|exception|regression|deadlock|hang(s|ing)?|leak(s|ing)?|race condition|repro(duce|duction)?|not working|doesn'?t work|why (is|does|isn'?t|doesn'?t|won'?t))\b/i;
const WORK_VERB = /\b(fix(es|ing)?|debug|investigate|diagnose|resolve|patch|repro(duce)?|root.?cause)\b/i;
const ACTION_VERB = /\b(implement|build|create|add|develop|write|make|update|change|fix(es|ing)?|restyle|redesign|refactor|wire|adjust|tweak|improve|polish|animate|render|style|convert|migrate|debug)\b/i;
const CODE_HINT = /`|\.(m?[jt]sx?|py|rs|go|java|rb|php|cs?|cpp|html?|css|sh|ps1|sql|ya?ml|json)\b|stack.?trace|\bCI\b|test suite/i;

function sessionIdentity(value) { return typeof value === 'string' && value.length > 0 ? value : ''; }
function hash(value) { return crypto.createHash('sha256').update(String(value)).update('\0').digest('hex'); }
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
function taskKey(session) { return hash(session); }
function taskPathByKey(key) { return path.join(stateDir, `task-v4-${key}.json`); }
function taskPath(session) { return taskPathByKey(taskKey(session)); }
function taskGenesisPathByKey(key) { return path.join(stateDir, `task-genesis-v4-${key}.json`); }
function mechanicalPathByKey(key) { return path.join(stateDir, `mechanical-v4-${key}.log`); }
function associationPath(parentKey, childKey) { return path.join(associationDir, parentKey, `${childKey}.json`); }
function associationResolutionPath(markerParentKey, markerId) {
  return path.join(associationResolutionDir, markerParentKey, `${markerId}.json`);
}
function evidencePath(token) { return path.join(stateDir, `evidence-v4-${token}.json`); }

function ensureStateDir() {
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(stateDir, 0o700); } catch (_) { /* Windows inherits profile ACLs. */ }
}

function defaultTask(key) {
  return normalizeTask({
    version: 4, taskKey: /^[a-f0-9]{64}$/.test(key || '') ? key : '0'.repeat(64),
    mode: 'ON', salt: crypto.randomBytes(32).toString('hex'),
  });
}

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validTaskShape(task, expectedKey = '') {
  if (!plainObject(task) || task.version !== 4 || !/^(?:ON|WARN|OFF)$/.test(task.mode || '') ||
      !/^[a-f0-9]{64}$/.test(task.salt || '') || !/^[a-f0-9]{64}$/.test(task.taskKey || '') ||
      (expectedKey && task.taskKey !== expectedKey)) return false;
  for (const field of ['dirtyEdits', 'proofs', 'unresolved', 'notices', 'mechanical', 'children',
    'pendingObservations', 'ledgerRefs']) {
    if (task[field] !== undefined && !Array.isArray(task[field])) return false;
  }
  if (Array.isArray(task.dirtyEdits) && task.dirtyEdits.some((item) => !/^[a-f0-9]{16}$/.test(item || ''))) return false;
  if (Array.isArray(task.children) && task.children.some((item) => !/^[a-f0-9]{64}$/.test(item || ''))) return false;
  if (Array.isArray(task.proofs) && task.proofs.some((item) => !plainObject(item))) return false;
  if (Array.isArray(task.unresolved) && task.unresolved.some((item) => !plainObject(item) ||
      !/^[a-f0-9]{16}$/.test(item.id || '') || !Array.isArray(item.edits) ||
      item.edits.some((edit) => !/^[a-f0-9]{16}$/.test(edit || '')))) return false;
  if (Array.isArray(task.mechanical) && task.mechanical.some((item) => !plainObject(item) ||
      !/^[a-f0-9]{16}$/.test(item.id || '') || typeof item.reason !== 'string' ||
      (item.edits !== undefined && (!Array.isArray(item.edits) ||
        item.edits.some((edit) => !/^[a-f0-9]{16}$/.test(edit || '')))))) return false;
  if (Array.isArray(task.notices) && task.notices.some((item) => !plainObject(item) ||
      typeof item.id !== 'string' || typeof item.message !== 'string' || typeof item.delivered !== 'boolean')) return false;
  if (Array.isArray(task.pendingObservations) && task.pendingObservations.some((item) => !plainObject(item) ||
      typeof item.id !== 'string' || typeof item.turn !== 'string' || typeof item.eventClass !== 'string' ||
      typeof item.receipt !== 'string')) return false;
  if (Array.isArray(task.ledgerRefs) && task.ledgerRefs.some((name) => !/^ground-v4-[a-f0-9]{64}\.log$/.test(name || ''))) return false;
  if (task.checkpointLedger !== undefined && task.checkpointLedger !== '' &&
      !/^ground-v4-[a-f0-9]{64}\.log$/.test(task.checkpointLedger || '')) return false;
  if (task.warnings !== undefined && !plainObject(task.warnings)) return false;
  if (task.delivery !== undefined) {
    if (!plainObject(task.delivery)) return false;
    for (const event of ['preToolUse', 'postToolUse', 'stop']) {
      if (task.delivery[event] !== undefined && (!Number.isInteger(task.delivery[event]) || task.delivery[event] < 0)) return false;
    }
  }
  for (const field of ['checkpoint', 'blockCount']) {
    if (task[field] !== undefined && (!Number.isInteger(task[field]) || task[field] < 0)) return false;
  }
  if (task.parentKey !== undefined && !/^[a-f0-9]{64}$/.test(task.parentKey || '')) return false;
  if (task.unboundParent !== undefined && typeof task.unboundParent !== 'boolean') return false;
  return true;
}

function normalizeTask(task) {
  task.dirtyEdits = Array.isArray(task.dirtyEdits) ? task.dirtyEdits : [];
  task.proofs = Array.isArray(task.proofs) ? task.proofs : [];
  task.unresolved = Array.isArray(task.unresolved) ? task.unresolved : [];
  task.warnings = task.warnings && typeof task.warnings === 'object' ? task.warnings : {};
  task.notices = Array.isArray(task.notices) ? task.notices : [];
  task.mechanical = Array.isArray(task.mechanical) ? task.mechanical : [];
  task.children = Array.isArray(task.children) ? task.children : [];
  task.pendingObservations = Array.isArray(task.pendingObservations) ? task.pendingObservations : [];
  task.ledgerRefs = Array.isArray(task.ledgerRefs) ? task.ledgerRefs : [];
  task.checkpoint = Number.isInteger(task.checkpoint) && task.checkpoint >= 0 ? task.checkpoint : 0;
  task.blockCount = Number.isInteger(task.blockCount) && task.blockCount >= 0 ? task.blockCount : 0;
  task.delivery = task.delivery && typeof task.delivery === 'object' ? task.delivery : {};
  for (const event of ['preToolUse', 'postToolUse', 'stop']) {
    task.delivery[event] = Number.isInteger(task.delivery[event]) && task.delivery[event] >= 0 ? task.delivery[event] : 0;
  }
  if (task.recovery === undefined) task.recovery = { version: 4, transactions: [] };
  else if (!task.recovery || typeof task.recovery !== 'object' || Array.isArray(task.recovery) ||
      task.recovery.version !== 4 || !Array.isArray(task.recovery.transactions)) {
    task.recovery = { version: 4, transactions: [], corrupt: true };
  }
  return task;
}

function readTaskByKey(key) {
  const genesisTarget = taskGenesisPathByKey(key);
  try {
    const parsed = JSON.parse(fs.readFileSync(taskPathByKey(key), 'utf8'));
    let genesis;
    try { genesis = JSON.parse(fs.readFileSync(genesisTarget, 'utf8')); }
    catch (_) { return { status: 'corrupt', task: null }; }
    if (!validTaskShape(parsed, key) || !plainObject(genesis) || genesis.version !== 4 ||
        genesis.taskKey !== key || genesis.saltCommitment !== hash(parsed.salt) ||
        Object.keys(genesis).sort().join(',') !== 'saltCommitment,taskKey,version') {
      return { status: 'corrupt', task: null };
    }
    return { status: 'ok', task: normalizeTask(parsed) };
  } catch (error) {
    return { status: error && error.code === 'ENOENT'
      ? (fs.existsSync(genesisTarget) ? 'missing-known' : 'missing') : 'corrupt', task: null };
  }
}

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function currentProcessStartIdentity() {
  if (process.platform === 'linux') {
    try {
      const value = fs.readFileSync(`/proc/${process.pid}/stat`, 'utf8');
      const fields = value.slice(value.lastIndexOf(')') + 2).trim().split(/\s+/);
      if (/^\d+$/.test(fields[19] || '')) return `linux:${fields[19]}`;
    } catch (_) { /* conservative epoch fallback */ }
  }
  return `epoch:${Math.floor((Date.now() - process.uptime() * 1000) / 1000)}`;
}

function processStartIdentity(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return '';
  if (pid === process.pid) return currentProcessStartIdentity();
  if (process.platform === 'linux') {
    try {
      const value = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      const fields = value.slice(value.lastIndexOf(')') + 2).trim().split(/\s+/);
      return /^\d+$/.test(fields[19] || '') ? `linux:${fields[19]}` : '';
    } catch (_) { return ''; }
  }
  const command = process.platform === 'win32' ? 'powershell.exe' : 'ps';
  const args = process.platform === 'win32'
    ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
      `$p=Get-Process -Id ${pid} -ErrorAction Stop; [Console]::Out.Write(([DateTimeOffset]$p.StartTime).ToUnixTimeSeconds())`]
    : ['-o', 'lstart=', '-p', String(pid)];
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 1500, windowsHide: true });
  if (result.status !== 0 || !String(result.stdout || '').trim()) return '';
  if (process.platform === 'win32') return /^\d+$/.test(result.stdout.trim()) ? `epoch:${result.stdout.trim()}` : '';
  const milliseconds = Date.parse(result.stdout.trim());
  return Number.isFinite(milliseconds) ? `epoch:${Math.floor(milliseconds / 1000)}` : '';
}

function sameProcessStart(expected, observed) {
  const first = String(expected || '').match(/^epoch:(\d+)$/);
  const second = String(observed || '').match(/^epoch:(\d+)$/);
  if (first && second) return Math.abs(Number(first[1]) - Number(second[1])) <= 2;
  return Boolean(expected) && expected === observed;
}

function processAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return Boolean(error && error.code === 'EPERM'); }
}

function parseLockOwner(value) {
  try {
    const parsed = JSON.parse(value);
    if (plainObject(parsed) && parsed.version === 4 && Number.isInteger(parsed.pid) && parsed.pid > 0 &&
        typeof parsed.processStartIdentity === 'string' && parsed.processStartIdentity &&
        /^[a-f0-9]{24}$/.test(parsed.nonce || '') &&
        Object.keys(parsed).sort().join(',') === 'nonce,pid,processStartIdentity,version') return parsed;
  } catch (_) { /* legacy owner below */ }
  const legacy = String(value || '').trim().match(/^(\d+)-([a-f0-9]{24})$/);
  return legacy ? { version: 3, pid: Number(legacy[1]), processStartIdentity: '', nonce: legacy[2] } : null;
}

function lockSnapshot(target) {
  try {
    const stat = fs.lstatSync(target);
    const directory = stat.isDirectory();
    const value = directory ? fs.readFileSync(path.join(target, 'owner'), 'utf8') : fs.readFileSync(target, 'utf8');
    return { directory, value };
  } catch (error) {
    try {
      if (fs.lstatSync(target).isDirectory() && error && error.code === 'ENOENT') return { directory: true, value: '' };
    } catch (_) { /* disappeared concurrently */ }
    return null;
  }
}

function abandonedLock(snapshot) {
  if (!snapshot) return false;
  const owner = parseLockOwner(snapshot.value);
  if (!owner) return snapshot.directory && snapshot.value === '';
  if (!processAlive(owner.pid)) return true;
  if (!owner.processStartIdentity) return false;
  const observed = processStartIdentity(owner.pid);
  return Boolean(observed) && !sameProcessStart(owner.processStartIdentity, observed);
}

function reclaimTaskLock(target) {
  const before = lockSnapshot(target);
  if (!abandonedLock(before)) return false;
  const quarantine = `${target}.stale-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  try { fs.renameSync(target, quarantine); } catch (_) { return false; }
  const moved = lockSnapshot(quarantine);
  if (!moved || moved.directory !== before.directory || moved.value !== before.value) {
    try { if (!fs.existsSync(target)) fs.renameSync(quarantine, target); } catch (_) { /* fail closed on ownership race */ }
    return false;
  }
  try { fs.rmSync(quarantine, { recursive: true, force: true }); } catch (_) { return false; }
  return true;
}

function createTaskLock(target) {
  const owner = JSON.stringify({
    version: 4, pid: process.pid, processStartIdentity: currentProcessStartIdentity(),
    nonce: crypto.randomBytes(12).toString('hex'),
  });
  const temporary = `${target}.acquire-${process.pid}-${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temporary, owner, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    fs.linkSync(temporary, target);
    return { target, owner };
  } catch (error) {
    if (!fs.existsSync(target)) throw error;
    return null;
  } finally {
    try { fs.unlinkSync(temporary); } catch (_) { /* linked target owns the complete record */ }
  }
}

function acquireTaskLock(key) {
  ensureStateDir();
  const target = path.join(stateDir, `task-lock-v4-${key}`);
  const deadline = Date.now() + LOCK_WAIT_MS;
  while (Date.now() <= deadline) {
    try {
      const lock = createTaskLock(target);
      if (lock) return lock;
    } catch (error) {
      if (!fs.existsSync(target)) return null;
    }
    if (reclaimTaskLock(target)) continue;
    sleep(7 + Math.floor(Math.random() * 11));
  }
  return null;
}

function releaseTaskLock(lock) {
  if (!lock) return;
  try {
    if (fs.readFileSync(lock.target, 'utf8') === lock.owner) fs.unlinkSync(lock.target);
  } catch (_) { /* a verified stale-lock takeover owns cleanup */ }
}

function saveTaskByKey(key, task) {
  ensureStateDir();
  let genesis;
  try { genesis = JSON.parse(fs.readFileSync(taskGenesisPathByKey(key), 'utf8')); }
  catch (_) { throw new Error('task-genesis-missing'); }
  if (!validTaskShape(task, key) || !plainObject(genesis) || genesis.version !== 4 ||
      genesis.taskKey !== key || genesis.saltCommitment !== hash(task.salt) ||
      Object.keys(genesis).sort().join(',') !== 'saltCommitment,taskKey,version') {
    throw new Error('task-identity-invalid');
  }
  const target = taskPathByKey(key);
  const temporary = `${target}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(task) + '\n', { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, target);
  try { fs.chmodSync(target, 0o600); } catch (_) { /* Windows inherits profile ACLs. */ }
}

function recordMechanicalDebt(key, code, correlation = '') {
  const occurrence = crypto.randomBytes(8).toString('hex');
  const correlationHash = hash(correlation).slice(0, 16);
  const id = hash(`${key}\0${code}\0router\0${correlationHash}\0${occurrence}`).slice(0, 16);
  try {
    ensureStateDir();
    fs.appendFileSync(mechanicalPathByKey(key),
      `M ${id} reason:${code} source:router correlation:${correlationHash} occurrence:${occurrence}\n`,
      { encoding: 'utf8', mode: 0o600 });
  } catch (_) { /* caller exposes WARN in-band */ }
  return id;
}

function recordMechanicalDebtOnce(key, code, correlation = '') {
  const correlationHash = hash(correlation).slice(0, 16);
  try {
    const lines = fs.readFileSync(mechanicalPathByKey(key), 'utf8').split('\n');
    const match = lines.map((line) => line.match(/^M\s+([a-f0-9]{16})\s+reason:(\S+)\s+source:router\s+correlation:(\S+)/))
      .find((candidate) => candidate && candidate[2] === code && candidate[3] === correlationHash);
    if (match) return match[1];
  } catch (_) { /* first occurrence */ }
  return recordMechanicalDebt(key, code, correlation);
}

function withTaskTransaction(session, mutate, create = false, recoveryOperation = '') {
  const key = taskKey(session);
  let lock = null;
  try { lock = acquireTaskLock(key); } catch (_) { /* recorded below */ }
  if (!lock) {
    const debtId = recordMechanicalDebt(key, 'task-lock-timeout', recoveryOperation || 'router');
    return { ok: false, key, code: 'task-lock-timeout', debtId };
  }
  try {
    const loaded = readTaskByKey(key);
    if (loaded.status === 'corrupt' || loaded.status === 'missing-known') {
      const code = loaded.status === 'corrupt' ? 'task-state-corrupt' : 'task-state-missing';
      const debtId = recordMechanicalDebt(key, code, recoveryOperation || 'router');
      return { ok: false, key, code, debtId };
    }
    if (loaded.status === 'missing') return { ok: false, key, code: 'task-state-missing' };
    const task = loaded.task;
    const result = mutate(task) || {};
    saveTaskByKey(key, task);
    return { ok: true, key, task, result };
  } catch (_) {
    const debtId = recordMechanicalDebt(key, 'task-state-save-failed', recoveryOperation || 'router');
    return { ok: false, key, code: 'task-state-save-failed', debtId };
  } finally {
    releaseTaskLock(lock);
  }
}

function loadTask(session) {
  const key = taskKey(session);
  const loaded = readTaskByKey(key);
  if (loaded.status === 'ok') return loaded.task;
  const task = defaultTask(key);
  task.mode = 'WARN';
  const reason = loaded.status === 'corrupt' ? 'task-state-corrupt' : 'task-state-missing';
  const debtId = recordMechanicalDebtOnce(key, reason, 'load-task');
  task.warnings.rootStateFailure = { reason, debtId };
  return task;
}

function effectiveModeByKey(startKey, missingRootMode = null) {
  const visited = new Set();
  let key = startKey;
  let mode = 'ON';
  while (key) {
    if (visited.has(key)) return { mode: mode === 'OFF' ? 'OFF' : 'WARN', code: 'parent-cycle' };
    visited.add(key);
    const loaded = readTaskByKey(key);
    if (loaded.status !== 'ok') {
      if (key === startKey && loaded.status === 'missing' && /^(?:ON|WARN|OFF)$/.test(missingRootMode || '')) {
        return { mode: missingRootMode, code: '' };
      }
      return { mode: mode === 'OFF' ? 'OFF' : 'WARN', code: `parent-${loaded.status}` };
    }
    if (loaded.task.mode === 'OFF') mode = 'OFF';
    else if (loaded.task.mode === 'WARN' && mode !== 'OFF') mode = 'WARN';
    if (typeof loaded.task.parentKey !== 'string' || !loaded.task.parentKey) return { mode, code: '' };
    key = loaded.task.parentKey;
  }
  return { mode: 'WARN', code: 'parent-unavailable' };
}

const CONTROL_REPAIR_REASONS = new Set([
  'task-lock-timeout', 'task-state-corrupt', 'task-state-save-failed',
]);
const CONTROL_RECOVERY_OPERATIONS = new Map([
  ['control-on', 'ON'], ['control-warn', 'WARN'], ['control-off', 'OFF'],
]);

function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function canonicalMechanicalBinding(value) {
  const keys = ['id', 'ledgerId', 'occurrence', 'reason', 'source', 'correlation'];
  if (!exactKeys(value, keys) || !/^[a-f0-9]{16}$/.test(value.id || '') ||
      !/^[a-f0-9]{16}$/.test(value.ledgerId || '') || !/^[a-f0-9]{16}$/.test(value.occurrence || '') ||
      !/^[a-z0-9_-]+$/.test(value.reason || '') || !/^(?:router|activate)$/.test(value.source || '') ||
      !/^[a-f0-9]{16}$/.test(value.correlation || '')) return null;
  return Object.fromEntries(keys.map((key) => [key, value[key]]));
}

function canonicalAssociationBinding(value) {
  const keys = ['id', 'digest', 'parentKey', 'childKey', 'code', 'occurrence'];
  if (!exactKeys(value, keys) || !/^[a-f0-9]{16}$/.test(value.id || '') ||
      !/^[a-f0-9]{64}$/.test(value.digest || '') || !/^[a-f0-9]{64}$/.test(value.parentKey || '') ||
      !/^[a-f0-9]{64}$/.test(value.childKey || '') || !/^[a-z0-9_-]+$/.test(value.code || '') ||
      !/^[a-f0-9]{16}$/.test(value.occurrence || '')) return null;
  return Object.fromEntries(keys.map((key) => [key, value[key]]));
}

function canonicalRecoveryTransaction(value, expectedTaskKey = '') {
  const keys = ['version', 'operation', 'taskKey', 'checkpoint', 'mechanical', 'associations', 'id', 'digest'];
  if (!exactKeys(value, keys) || value.version !== 4 || value.operation !== 'exact-task-repair-v4' ||
      !/^[a-f0-9]{64}$/.test(value.taskKey || '') || (expectedTaskKey && value.taskKey !== expectedTaskKey) ||
      !Number.isInteger(value.checkpoint) || value.checkpoint < 0 || !Array.isArray(value.mechanical) ||
      !Array.isArray(value.associations) || !/^[a-f0-9]{16}$/.test(value.id || '') ||
      !/^[a-f0-9]{64}$/.test(value.digest || '')) return null;
  const mechanical = value.mechanical.map(canonicalMechanicalBinding);
  const associations = value.associations.map(canonicalAssociationBinding);
  if (mechanical.some((item) => !item) || associations.some((item) => !item)) return null;
  mechanical.sort((a, b) => a.id.localeCompare(b.id));
  associations.sort((a, b) => a.id.localeCompare(b.id));
  if (new Set(mechanical.map((item) => item.id)).size !== mechanical.length ||
      new Set(associations.map((item) => item.id)).size !== associations.length ||
      JSON.stringify(mechanical) !== JSON.stringify(value.mechanical) ||
      JSON.stringify(associations) !== JSON.stringify(value.associations)) return null;
  const payload = {
    version: 4, operation: 'exact-task-repair-v4', taskKey: value.taskKey,
    checkpoint: value.checkpoint, mechanical, associations,
  };
  const digest = hash(JSON.stringify(payload));
  if (value.digest !== digest || value.id !== digest.slice(0, 16)) return null;
  return { ...payload, id: value.id, digest };
}

function recoveryTransaction(task, key, id, digest) {
  const transactions = task && task.recovery && task.recovery.version === 4 &&
    Array.isArray(task.recovery.transactions) ? task.recovery.transactions : [];
  for (const candidate of transactions) {
    const valid = canonicalRecoveryTransaction(candidate, key);
    if (valid && valid.id === id && valid.digest === digest) return valid;
  }
  return null;
}

function createRecoveryTransaction(task, key, mechanical, associations) {
  const payload = {
    version: 4, operation: 'exact-task-repair-v4', taskKey: key,
    checkpoint: task.checkpoint,
    mechanical: mechanical.map((record) => canonicalMechanicalBinding({
      id: record.id, ledgerId: record.ledgerId, occurrence: record.occurrence,
      reason: record.reason, source: record.source, correlation: record.correlation,
    })).sort((a, b) => a.id.localeCompare(b.id)),
    associations: associations.map((marker) => canonicalAssociationBinding({
      id: marker.id, digest: marker.digest, parentKey: marker.parentKey,
      childKey: marker.childKey, code: marker.code, occurrence: marker.occurrence,
    })).sort((a, b) => a.id.localeCompare(b.id)),
  };
  const digest = hash(JSON.stringify(payload));
  return { ...payload, id: digest.slice(0, 16), digest };
}

function knownMechanicalRecord(key, id, reason, source = '', correlation = '', occurrence = '') {
  if (source === 'router' && CONTROL_REPAIR_REASONS.has(reason) &&
      /^[a-f0-9]{16}$/.test(correlation) && /^[a-f0-9]{16}$/.test(occurrence)) {
    for (const operation of CONTROL_RECOVERY_OPERATIONS.keys()) {
      if (correlation !== hash(operation).slice(0, 16)) continue;
      const expected = hash(`${key}\0${reason}\0router\0${correlation}\0${occurrence}`).slice(0, 16);
      if (id === expected) return { source, correlation, occurrence, operation, repairable: true };
    }
  }
  // Pre-1.7.0 candidate records did not bind the failed operation or intended
  // postcondition. They remain visible but cannot be acknowledged away.
  const candidates = [
    ['router', 'task-lock-timeout', 'router'],
    ['router', 'task-state-corrupt', 'router'],
    ['router', 'task-state-corrupt', 'router-read'],
    ['router', 'task-state-save-failed', 'router'],
    ['activate', 'task-lock-timeout', 'activate'],
    ['activate', 'task-state-corrupt', 'activate'],
    ['activate', 'task-state-save-failed', 'activate'],
  ];
  for (const [knownSource, knownReason, rawCorrelation] of candidates) {
    if (reason !== knownReason) continue;
    if (id !== hash(`${key}\0${knownReason}\0${rawCorrelation}`).slice(0, 16)) continue;
    if (source && source !== knownSource) continue;
    if (correlation && correlation !== hash(rawCorrelation).slice(0, 16)) continue;
    return { source: knownSource, correlation: hash(rawCorrelation).slice(0, 16), occurrence, repairable: false };
  }
  return { source, correlation, occurrence, repairable: false };
}

function mechanicalRepairToken(task, key, record, transaction) {
  if (!task || typeof task.salt !== 'string' || !task.salt) return '';
  const canonical = JSON.stringify({
    task: key,
    debt: {
      id: record.id, ledgerId: record.ledgerId, occurrence: record.occurrence,
      reason: record.reason, source: record.source, correlation: record.correlation,
    },
    repair: transaction.id, transaction: transaction.digest,
  });
  return crypto.createHmac('sha256', task.salt).update(canonical).digest('hex').slice(0, 16);
}

function mechanicalStateForKey(key, task = null) {
  const active = new Map();
  const resolved = new Map();
  if (task && task.recovery) {
    const transactions = Array.isArray(task.recovery.transactions) ? task.recovery.transactions : [];
    if (task.recovery.corrupt === true) {
      const id = hash(`${key}\0corrupt-recovery-container`).slice(0, 16);
      active.set(id, {
        id, ledgerId: id, occurrence: id, reason: 'corrupt-recovery-transaction',
        source: 'router', correlation: '', repairable: false, plainClearable: false,
      });
    }
    transactions.forEach((candidate, index) => {
      if (canonicalRecoveryTransaction(candidate, key)) return;
      const id = hash(`${key}\0corrupt-recovery-transaction\0${index}`).slice(0, 16);
      active.set(id, {
        id, ledgerId: id, occurrence: id, reason: 'corrupt-recovery-transaction',
        source: 'router', correlation: '', repairable: false, plainClearable: false,
      });
    });
  }
  if (task && Array.isArray(task.mechanical)) {
    for (const debt of task.mechanical) {
      if (debt && debt.status === 'unresolved' && typeof debt.id === 'string') {
        active.set(debt.id, {
          id: debt.id, ledgerId: debt.id,
          occurrence: hash(`${key}\0task-mechanical\0${debt.id}`).slice(0, 16),
          reason: debt.reason || 'mechanical-unavailable', source: 'ground',
          correlation: '', repairable: false, plainClearable: true,
        });
      }
    }
  }
  try {
    const lines = fs.readFileSync(mechanicalPathByKey(key), 'utf8').split('\n');
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      let match = line.match(/^M\s+([a-z0-9_-]{1,64})\s+reason:([a-z0-9_-]+)(?:\s+source:(\S+)\s+correlation:(\S+))?(?:\s+occurrence:([a-f0-9]{16}))?/i);
      if (match) {
        const occurrence = match[5] || hash(`${key}\0ledger-cursor\0${index}\0${line}`).slice(0, 16);
        const known = knownMechanicalRecord(key, match[1], match[2], match[3] || '', match[4] || '', occurrence);
        const recordId = match[5] ? match[1]
          : (known.repairable ? hash(`${match[1]}\0${occurrence}`).slice(0, 16) : match[1]);
        if (!known.repairable && match[3] && [...active.values()].some((record) =>
          record.reason === match[2] && record.source === match[3] && record.correlation === (match[4] || ''))) {
          continue;
        }
        active.set(recordId, {
          id: recordId, ledgerId: match[1], occurrence, reason: match[2], ...known,
          sequence: index,
          plainClearable: !match[3] && /\sedit-set:\S+/.test(line),
        });
        resolved.delete(recordId);
        continue;
      }
      match = line.match(/^C\s+(\S+)$/);
      if (match) {
        const record = [...active.values()].reverse()
          .find((candidate) => candidate.ledgerId === match[1] && candidate.plainClearable);
        // Grounding's edit-bound records use a plain C. Router/activator
        // failures require an exact occurrence and persisted repair transaction.
        if (record) {
          resolved.set(record.id, { ...record, resolution: 'ground-correlated' });
          active.delete(record.id);
        }
        continue;
      }
      match = line.match(/^C\s+([a-f0-9]{16})\s+source:repair\s+repair:([a-f0-9]{16})\s+transaction:([a-f0-9]{64})\s+occurrence:([a-f0-9]{16})\s+token:([a-f0-9]{16})$/);
      if (match) {
        const record = [...active.values()].find((candidate) =>
          candidate.ledgerId === match[1] && candidate.occurrence === match[4] && candidate.repairable);
        const transaction = recoveryTransaction(task, key, match[2], match[3]);
        const bound = record && transaction && transaction.mechanical.some((item) =>
          item.id === record.id && item.ledgerId === record.ledgerId && item.occurrence === record.occurrence &&
          item.reason === record.reason && item.source === record.source && item.correlation === record.correlation);
        const expected = bound ? mechanicalRepairToken(task, key, record, transaction) : '';
        if (record && expected && match[5].length === expected.length &&
            crypto.timingSafeEqual(Buffer.from(match[5]), Buffer.from(expected))) {
          resolved.set(record.id, { ...record, resolution: transaction.id });
          active.delete(record.id);
        } else {
          const invalidId = hash(`${key}\0${line}\0corrupt-mechanical-resolution`).slice(0, 16);
          active.set(invalidId, {
            id: invalidId, ledgerId: invalidId, occurrence: hash(line).slice(0, 16),
            reason: 'corrupt-mechanical-resolution', source: 'router',
            correlation: '', repairable: false, plainClearable: false,
          });
        }
        continue;
      }
      if (/^C\s+\S+\s+source:repair\b/.test(line)) {
        const invalidId = hash(`${key}\0${line}\0corrupt-mechanical-resolution`).slice(0, 16);
        active.set(invalidId, {
          id: invalidId, ledgerId: invalidId, occurrence: hash(line).slice(0, 16),
          reason: 'corrupt-mechanical-resolution', source: 'router',
          correlation: '', repairable: false, plainClearable: false,
        });
        continue;
      }
      if (line.trim()) {
        const invalidId = hash(`${key}\0${index}\0${line}\0corrupt-mechanical-record`).slice(0, 16);
        active.set(invalidId, {
          id: invalidId, ledgerId: invalidId, occurrence: hash(`${index}\0${line}`).slice(0, 16),
          reason: 'corrupt-mechanical-record', source: 'router',
          correlation: '', repairable: false, plainClearable: false,
        });
      }
    }
  } catch (_) { /* no mechanical ledger */ }
  if (task && task.warnings && task.warnings.mechanicalUnavailable) {
    const reason = String(task.warnings.mechanicalUnavailable.reason || 'mechanical-unavailable').replace(/[^a-z0-9_-]/gi, '-');
    const id = hash(`${key}\0${reason}`).slice(0, 16);
    active.set(id, { id, reason, source: 'ground', correlation: '', repairable: false });
  }
  if (task && task.warnings && task.warnings.rootStateFailure) {
    const reason = String(task.warnings.rootStateFailure.reason || 'task-state-missing')
      .replace(/[^a-z0-9_-]/gi, '-');
    if (![...active.values()].some((record) => record.reason === reason)) {
      const id = hash(`${key}\0${reason}\0root-state`).slice(0, 16);
      active.set(id, {
        id, ledgerId: id, occurrence: id, reason, source: 'router',
        correlation: '', repairable: false, plainClearable: false,
      });
    }
  }
  return { active, resolved };
}

function mechanicalDebtsForKey(key, task = null) {
  return new Map([...mechanicalStateForKey(key, task).active].map(([id, record]) => [id, record.reason]));
}

function readTaskIndex() {
  const tasks = new Map();
  let names = [];
  try { names = fs.readdirSync(stateDir); } catch (_) { return tasks; }
  for (const name of names) {
    const match = name.match(/^task-v4-([a-f0-9]{64})\.json$/);
    if (!match) continue;
    tasks.set(match[1], readTaskByKey(match[1]));
  }
  return tasks;
}

function relationMapAdd(relations, parentKey, childKey, source) {
  if (!/^[a-f0-9]{64}$/.test(parentKey || '') || !/^[a-f0-9]{64}$/.test(childKey || '')) return;
  if (!relations.has(parentKey)) relations.set(parentKey, new Map());
  const children = relations.get(parentKey);
  if (!children.has(childKey)) children.set(childKey, new Set());
  children.get(childKey).add(source);
}

function scopedDebtAdd(debts, parentKey, id, code) {
  if (!debts.has(parentKey)) debts.set(parentKey, new Map());
  debts.get(parentKey).set(id, code);
}

function readAssociationEdges(relations, structuralDebts, rootKey = '') {
  let parents = [];
  try { parents = fs.readdirSync(associationDir, { withFileTypes: true }); } catch (_) {
    if (rootKey && fs.existsSync(associationDir)) {
      scopedDebtAdd(structuralDebts, rootKey,
        hash(`${rootKey}\0corrupt-association-edge-namespace`).slice(0, 16),
        'corrupt-association-edge-namespace');
    }
    return;
  }
  for (const parent of parents) {
    if (!parent.isDirectory()) {
      if (/^[a-f0-9]{64}$/.test(parent.name)) {
        scopedDebtAdd(structuralDebts, parent.name,
          hash(`${parent.name}\0non-directory-edge-scope`).slice(0, 16),
          'corrupt-association-edge-namespace');
      }
      continue;
    }
    if (!/^[a-f0-9]{64}$/.test(parent.name)) continue;
    let children = [];
    try { children = fs.readdirSync(path.join(associationDir, parent.name), { withFileTypes: true }); }
    catch (_) {
      scopedDebtAdd(structuralDebts, parent.name, hash(`${parent.name}\0edge-directory-unreadable`).slice(0, 16), 'edge-directory-unreadable');
      continue;
    }
    for (const child of children) {
      const match = child.isFile() && child.name.match(/^([a-f0-9]{64})\.json$/);
      if (!match) {
        scopedDebtAdd(structuralDebts, parent.name, hash(`${parent.name}\0invalid-edge-name\0${child.name}`).slice(0, 16), 'invalid-edge-name');
        continue;
      }
      const childKey = match[1];
      try {
        const edge = JSON.parse(fs.readFileSync(path.join(associationDir, parent.name, child.name), 'utf8'));
        if (!edge || edge.version !== 4 || edge.parentKey !== parent.name || edge.childKey !== childKey ||
            Object.keys(edge).sort().join(',') !== 'childKey,parentKey,version') throw new Error('mismatch');
        relationMapAdd(relations, parent.name, childKey, 'edge');
      } catch (_) {
        relationMapAdd(relations, parent.name, childKey, 'edge-corrupt');
        scopedDebtAdd(structuralDebts, parent.name, hash(`${parent.name}\0${childKey}\0corrupt-edge`).slice(0, 16), 'corrupt-edge');
      }
    }
  }
}

function associationMarkerDigest(marker) {
  return hash(JSON.stringify({
    version: 4, id: marker.id, parentKey: marker.parentKey, childKey: marker.childKey,
    code: marker.code, occurrence: marker.occurrence, status: 'unresolved',
  }));
}

function readAssociationDebtMarkers(markers, structuralDebts, rootKey = '') {
  let parents = [];
  try { parents = fs.readdirSync(associationDebtDir, { withFileTypes: true }); } catch (_) {
    if (rootKey && fs.existsSync(associationDebtDir)) {
      scopedDebtAdd(structuralDebts, rootKey,
        hash(`${rootKey}\0corrupt-association-debt-namespace`).slice(0, 16),
        'corrupt-association-debt-namespace');
    }
    return;
  }
  for (const parent of parents) {
    if (!parent.isDirectory()) {
      if (/^[a-f0-9]{64}$/.test(parent.name)) {
        scopedDebtAdd(structuralDebts, parent.name,
          hash(`${parent.name}\0non-directory-debt-scope`).slice(0, 16),
          'corrupt-association-debt');
      }
      continue;
    }
    if (!/^[a-f0-9]{64}$/.test(parent.name)) continue;
    let files = [];
    try { files = fs.readdirSync(path.join(associationDebtDir, parent.name), { withFileTypes: true }); }
    catch (_) {
      scopedDebtAdd(structuralDebts, parent.name,
        hash(`${parent.name}\0debt-directory-unreadable`).slice(0, 16),
        'debt-directory-unreadable');
      continue;
    }
    for (const file of files) {
      if (!file.isFile()) {
        scopedDebtAdd(structuralDebts, parent.name,
          hash(`${parent.name}\0${file.name}\0corrupt-association-debt`).slice(0, 16),
          'corrupt-association-debt');
        continue;
      }
      let debtCode = 'corrupt-association-debt';
      try {
        const marker = JSON.parse(fs.readFileSync(path.join(associationDebtDir, parent.name, file.name), 'utf8'));
        const currentOccurrence = marker && /^[a-f0-9]{16}$/.test(marker.occurrence || '')
          ? marker.occurrence : '';
        const expectedId = marker && typeof marker.childKey === 'string' && typeof marker.code === 'string'
          ? hash(currentOccurrence
            ? `${parent.name}\0${marker.childKey}\0${marker.code}\0${currentOccurrence}`
            : `${parent.name}\0${marker.childKey}\0${marker.code}`).slice(0, 16) : '';
        const expectedName = marker && typeof marker.childKey === 'string' && typeof marker.code === 'string'
          ? `${marker.childKey}-${hash(marker.code).slice(0, 16)}${currentOccurrence ? `-${currentOccurrence}` : ''}.json` : '';
        if (!marker || marker.version !== 4 || marker.status !== 'unresolved' ||
            marker.parentKey !== parent.name || !/^[a-f0-9]{64}$/.test(marker.childKey || '') ||
            marker.id !== expectedId || file.name !== expectedName ||
            typeof marker.code !== 'string' || !/^[a-z0-9_-]+$/.test(marker.code)) throw new Error('mismatch');
        if (!ASSOCIATION_DEBT_CODES.has(marker.code)) {
          debtCode = 'unknown-association-code';
          throw new Error('unknown-code');
        }
        marker.occurrence = currentOccurrence || hash(`${parent.name}\0legacy-marker\0${file.name}`).slice(0, 16);
        marker.digest = associationMarkerDigest(marker);
        if (!markers.has(parent.name)) markers.set(parent.name, new Map());
        markers.get(parent.name).set(marker.id, marker);
      } catch (_) {
        scopedDebtAdd(structuralDebts, parent.name,
          hash(`${parent.name}\0${file.name}\0${debtCode}`).slice(0, 16),
          debtCode);
      }
    }
  }
}

function exactAssociationEdge(parentKey, childKey) {
  try {
    const edge = JSON.parse(fs.readFileSync(associationPath(parentKey, childKey), 'utf8'));
    if (!edge || edge.version !== 4 || edge.parentKey !== parentKey || edge.childKey !== childKey ||
        Object.keys(edge).sort().join(',') !== 'childKey,parentKey,version') return null;
    return edge;
  } catch (_) { return null; }
}

function associationInvariants(marker, tasks) {
  const child = tasks.get(marker.childKey);
  if (!child || child.status !== 'ok') return { ok: false, code: 'resolution-invariant-mismatch' };
  const authoritativeParentKey = marker.code === 'parent-unavailable' && marker.parentKey === marker.childKey
    ? child.task.parentKey : marker.parentKey;
  if (!/^[a-f0-9]{64}$/.test(authoritativeParentKey || '') || child.task.parentKey !== authoritativeParentKey) {
    return { ok: false, code: 'resolution-invariant-mismatch' };
  }
  const parent = tasks.get(authoritativeParentKey);
  if (!parent || parent.status !== 'ok' || !parent.task.children.includes(marker.childKey)) {
    return { ok: false, code: 'resolution-invariant-mismatch' };
  }
  const edge = exactAssociationEdge(authoritativeParentKey, marker.childKey);
  if (!edge) return { ok: false, code: 'resolution-invariant-mismatch' };
  return {
    ok: true, authoritativeParentKey,
    edgeDigest: hash(JSON.stringify(edge)),
  };
}

function associationResolutionRecord(marker, invariant, repairTaskKey, transaction) {
  const record = {
    version: 4,
    kind: 'association-resolution',
    markerId: marker.id,
    markerDigest: marker.digest,
    markerParentKey: marker.parentKey,
    childKey: marker.childKey,
    code: marker.code,
    authoritativeParentKey: invariant.authoritativeParentKey,
    repairTaskKey,
    repairTransactionId: transaction.id,
    repairTransactionDigest: transaction.digest,
    childParentKey: invariant.authoritativeParentKey,
    edgeDigest: invariant.edgeDigest,
    parentProjection: true,
  };
  return { ...record, id: hash(JSON.stringify(record)).slice(0, 16) };
}

function sameResolutionRecord(actual, expected) {
  if (!actual || typeof actual !== 'object' || Array.isArray(actual)) return false;
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = Object.keys(expected).sort();
  if (actualKeys.length !== expectedKeys.length || actualKeys.some((key, index) => key !== expectedKeys[index])) return false;
  return expectedKeys.every((key) => actual[key] === expected[key]);
}

function readAssociationResolutions(markers, tasks, resolutions, structuralDebts, rootKey = '') {
  let parents = [];
  try { parents = fs.readdirSync(associationResolutionDir, { withFileTypes: true }); } catch (_) {
    if (rootKey && fs.existsSync(associationResolutionDir)) {
      scopedDebtAdd(structuralDebts, rootKey,
        hash(`${rootKey}\0corrupt-association-resolution-namespace`).slice(0, 16),
        'corrupt-association-resolution-namespace');
    }
    return;
  }
  for (const parent of parents) {
    if (!parent.isDirectory()) {
      if (/^[a-f0-9]{64}$/.test(parent.name)) {
        scopedDebtAdd(structuralDebts, parent.name,
          hash(`${parent.name}\0non-directory-resolution-scope`).slice(0, 16),
          'corrupt-association-resolution-namespace');
      }
      continue;
    }
    if (!/^[a-f0-9]{64}$/.test(parent.name)) continue;
    let files = [];
    try { files = fs.readdirSync(path.join(associationResolutionDir, parent.name), { withFileTypes: true }); }
    catch (_) {
      scopedDebtAdd(structuralDebts, parent.name,
        hash(`${parent.name}\0resolution-directory-unreadable`).slice(0, 16),
        'corrupt-association-resolution');
      continue;
    }
    for (const file of files) {
      const match = file.isFile() && file.name.match(/^([a-f0-9]{16})\.json$/);
      const markerId = match ? match[1] : '';
      const marker = markerId && markers.get(parent.name) ? markers.get(parent.name).get(markerId) : null;
      let code = 'corrupt-association-resolution';
      try {
        if (!match || !marker) throw new Error('orphan-or-invalid-name');
        const actual = JSON.parse(fs.readFileSync(path.join(associationResolutionDir, parent.name, file.name), 'utf8'));
        if (actual.repairTaskKey !== marker.parentKey) throw new Error('wrong-task');
        const repairTask = tasks.get(actual.repairTaskKey);
        if (!repairTask || repairTask.status !== 'ok') throw new Error('missing-repair-task');
        const transaction = recoveryTransaction(repairTask.task, actual.repairTaskKey,
          actual.repairTransactionId, actual.repairTransactionDigest);
        if (!transaction || !transaction.associations.some((item) =>
          item.id === marker.id && item.digest === marker.digest && item.parentKey === marker.parentKey &&
          item.childKey === marker.childKey && item.code === marker.code && item.occurrence === marker.occurrence)) {
          throw new Error('missing-repair-transaction');
        }
        const invariant = associationInvariants(marker, tasks);
        if (!invariant.ok) {
          code = invariant.code;
          throw new Error('invariant');
        }
        const expected = associationResolutionRecord(marker, invariant, actual.repairTaskKey, transaction);
        if (!sameResolutionRecord(actual, expected)) throw new Error('mismatch');
        if (!resolutions.has(parent.name)) resolutions.set(parent.name, new Map());
        resolutions.get(parent.name).set(marker.id, actual);
        continue;
      } catch (_) {
        scopedDebtAdd(structuralDebts, parent.name,
          hash(`${parent.name}\0${file.name}\0${code}`).slice(0, 16), code);
      }
    }
  }
}

function associationSummary(rootKey, rootTask) {
  const tasks = readTaskIndex();
  if (!tasks.has(rootKey)) tasks.set(rootKey, { status: 'ok', task: rootTask });
  const relations = new Map();
  const structuralDebts = new Map();
  const markers = new Map();
  const resolutions = new Map();

  for (const [key, loaded] of tasks) {
    if (loaded.status !== 'ok') continue;
    const task = loaded.task;
    if (typeof task.parentKey === 'string' && task.parentKey) relationMapAdd(relations, task.parentKey, key, 'declared');
    for (const childKey of task.children) relationMapAdd(relations, key, childKey, 'legacy');
  }
  readAssociationEdges(relations, structuralDebts, rootKey);
  readAssociationDebtMarkers(markers, structuralDebts, rootKey);
  readAssociationResolutions(markers, tasks, resolutions, structuralDebts, rootKey);

  const summary = {
    count: 0, unresolved: new Set(), blocks: 0, mechanical: new Map(), association: new Map(),
    associationResolved: new Map(), dirty: new Map(), pending: new Map(), invalidEvidence: new Map(),
  };
  const counted = new Set();
  const owner = new Map();

  // Debt created while an authoritative parent is unavailable must also be
  // visible from the affected child's own STATUS, not only from the missing
  // parent's namespace.
  for (const [markerParent, group] of markers) {
    for (const [id, marker] of group) {
      if (marker.childKey !== rootKey) continue;
      const resolution = resolutions.get(markerParent) && resolutions.get(markerParent).get(id);
      if (resolution) summary.associationResolved.set(id, resolution);
      else summary.association.set(id, marker.code);
    }
  }

  function addAssociationDebt(parentKey, childKey, code) {
    const id = hash(`${parentKey}\0${childKey}\0${code}`).slice(0, 16);
    summary.association.set(id, code);
  }

  function walk(parentKey, ancestors) {
    const structural = structuralDebts.get(parentKey);
    if (structural) for (const [id, code] of structural) summary.association.set(id, code);
    const persisted = markers.get(parentKey);
    if (persisted) for (const [id, marker] of persisted) {
      const resolution = resolutions.get(parentKey) && resolutions.get(parentKey).get(id);
      if (resolution) summary.associationResolved.set(id, resolution);
      else summary.association.set(id, marker.code);
    }
    const children = relations.get(parentKey) || new Map();
    for (const [childKey, sources] of children) {
      if (ancestors.has(childKey)) {
        addAssociationDebt(parentKey, childKey, 'association-cycle');
        continue;
      }
      if (owner.has(childKey) && owner.get(childKey) !== parentKey) {
        addAssociationDebt(parentKey, childKey, 'multiple-parent-association');
        continue;
      }
      owner.set(childKey, parentKey);
      if (!counted.has(childKey)) { counted.add(childKey); summary.count++; }

      const loaded = tasks.get(childKey) || { status: 'missing', task: null };
      if (loaded.status === 'missing' || loaded.status === 'missing-known') {
        addAssociationDebt(parentKey, childKey, 'missing-child-state');
        continue;
      }
      if (loaded.status === 'corrupt') {
        addAssociationDebt(parentKey, childKey, 'corrupt-child-state');
        continue;
      }
      const child = loaded.task;
      if (!sources.has('edge') && !sources.has('edge-corrupt')) {
        addAssociationDebt(parentKey, childKey, 'missing-association-edge');
      }
      if (!sources.has('legacy')) {
        addAssociationDebt(parentKey, childKey, 'missing-parent-projection');
      }
      if ((!child.parentKey || typeof child.parentKey !== 'string') &&
          (sources.has('edge') || sources.has('edge-corrupt') || sources.has('legacy'))) {
        addAssociationDebt(parentKey, childKey, 'missing-parent-binding');
      }
      if (typeof child.parentKey === 'string' && child.parentKey && child.parentKey !== parentKey) {
        addAssociationDebt(parentKey, childKey, 'parent-binding-mismatch');
      }
      if (sources.has('declared') && !sources.has('edge') && !sources.has('legacy')) {
        addAssociationDebt(parentKey, childKey, 'orphan-association');
      }
      if (sources.has('edge-corrupt')) addAssociationDebt(parentKey, childKey, 'corrupt-edge');
      for (const debt of child.unresolved) if (debt && typeof debt.id === 'string') summary.unresolved.add(debt.id);
      if (child.dirtyEdits.length) summary.dirty.set(childKey, child.dirtyEdits.length);
      if (child.pendingObservations.length) summary.pending.set(childKey, child.pendingObservations.length);
      const accepted = child.proofs.filter((proof) => proof && proof.checkpoint === child.checkpoint);
      const latest = accepted.length ? accepted[accepted.length - 1] : null;
      if (child.checkpoint > 0 && (!latest || !canonicalEvidenceForProof(child, childKey, latest))) {
        summary.invalidEvidence.set(childKey, latest && latest.token || 'missing');
      }
      summary.blocks += child.blockCount;
      for (const [id, reason] of mechanicalDebtsForKey(childKey, child)) summary.mechanical.set(id, reason);
      walk(childKey, new Set([...ancestors, childKey]));
    }
  }

  walk(rootKey, new Set([rootKey]));
  return summary;
}

function writeExactImmutableJson(target, value) {
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.writeFileSync(target, JSON.stringify(value) + '\n', { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    return true;
  } catch (error) {
    if (!error || error.code !== 'EEXIST') return false;
    try {
      const existing = JSON.parse(fs.readFileSync(target, 'utf8'));
      return sameResolutionRecord(existing, value);
    } catch (_) { return false; }
  }
}

function repairableAssociationState(exactKey) {
  const tasks = readTaskIndex();
  const markers = new Map();
  const structuralDebts = new Map();
  const resolutions = new Map();
  readAssociationDebtMarkers(markers, structuralDebts, exactKey);
  readAssociationResolutions(markers, tasks, resolutions, structuralDebts, exactKey);
  const candidates = [];
  for (const [markerParentKey, scopedMarkers] of markers) {
    for (const marker of scopedMarkers.values()) {
      // A marker belongs only to its directory/task owner. A historical
      // parent-unavailable marker is already self-scoped to the child key.
      if (marker.parentKey !== exactKey) continue;
      if (resolutions.get(markerParentKey) && resolutions.get(markerParentKey).has(marker.id)) continue;
      const invariant = associationInvariants(marker, tasks);
      if (!invariant.ok) continue;
      candidates.push({ marker, invariant });
    }
  }
  candidates.sort((a, b) => a.marker.id.localeCompare(b.marker.id));
  return candidates;
}

function appendExactLine(target, line) {
  try {
    let existing = '';
    try { existing = fs.readFileSync(target, 'utf8'); } catch (error) {
      if (!error || error.code !== 'ENOENT') throw error;
    }
    if (existing.split('\n').includes(line)) return true;
    fs.appendFileSync(target, `${line}\n`, { encoding: 'utf8', mode: 0o600 });
    return true;
  } catch (_) { return false; }
}

function repairExactTask(session, key) {
  let lock = null;
  try { lock = acquireTaskLock(key); } catch (_) { /* visible failure below */ }
  if (!lock) {
    const debtId = recordMechanicalDebt(key, 'task-lock-timeout', 'router');
    return {
      ok: false, attempted: false, task: loadTask(session),
      warning: `Repair transaction failed; mechanical debt ${debtId} remains release-blocking.`,
      mechanicalResolved: [], associationResolved: [],
    };
  }

  let task = null;
  let mechanicalResolved = [];
  let associationResolved = [];
  const failed = [];
  let attempted = false;
  try {
    const loaded = readTaskByKey(key);
    if (loaded.status !== 'ok') {
      const debtId = recordMechanicalDebt(key,
        loaded.status === 'corrupt' ? 'task-state-corrupt' : 'task-state-save-failed', 'router');
      return {
        ok: false, attempted: false, task: loadTask(session),
        warning: `Repair transaction failed; mechanical debt ${debtId} remains release-blocking.`,
        mechanicalResolved: [], associationResolved: [],
      };
    }
    task = loaded.task;
    const before = mechanicalStateForKey(key, task);
    const repairable = [...before.active.values()].filter((record) => record.repairable);
    const latestControl = repairable.filter((record) => CONTROL_RECOVERY_OPERATIONS.has(record.operation))
      .sort((a, b) => (a.sequence || 0) - (b.sequence || 0)).at(-1);
    if (latestControl) task.mode = CONTROL_RECOVERY_OPERATIONS.get(latestControl.operation);
    repairable.sort((a, b) => a.id.localeCompare(b.id));
    const associations = repairableAssociationState(key);
    attempted = repairable.length + associations.length > 0;
    if (!attempted) {
      return {
        ok: true, attempted: false, task,
        warning: '', mechanicalResolved: [], associationResolved: [],
      };
    }

    const repairTransaction = createRecoveryTransaction(task, key, repairable,
      associations.map((candidate) => candidate.marker));
    const currentTransactions = task.recovery.transactions
      .map((candidate) => canonicalRecoveryTransaction(candidate, key)).filter(Boolean);
    if (!currentTransactions.some((candidate) => candidate.id === repairTransaction.id &&
        candidate.digest === repairTransaction.digest)) {
      task.recovery.transactions.push(repairTransaction);
      try { saveTaskByKey(key, task); }
      catch (_) {
        const debtId = recordMechanicalDebt(key, 'task-state-save-failed', 'router');
        return {
          ok: false, attempted: true, task: loadTask(session),
          warning: `Repair transaction could not be persisted; mechanical debt ${debtId} remains release-blocking.`,
          mechanicalResolved: [], associationResolved: [],
        };
      }
    }

    for (const record of repairable) {
      const token = mechanicalRepairToken(task, key, record, repairTransaction);
      const line = `C ${record.ledgerId} source:repair repair:${repairTransaction.id} ` +
        `transaction:${repairTransaction.digest} occurrence:${record.occurrence} token:${token}`;
      if (appendExactLine(mechanicalPathByKey(key), line)) mechanicalResolved.push(record.id);
      else {
        failed.push(record.id);
        recordMechanicalDebt(key, 'mechanical-resolution-persist-failed', record.id);
      }
    }
    for (const candidate of associations) {
      const record = associationResolutionRecord(candidate.marker, candidate.invariant, key, repairTransaction);
      if (writeExactImmutableJson(associationResolutionPath(candidate.marker.parentKey, candidate.marker.id), record)) {
        associationResolved.push(candidate.marker.id);
      } else {
        failed.push(candidate.marker.id);
        recordMechanicalDebt(key, 'association-resolution-persist-failed', candidate.marker.id);
      }
    }
  } finally {
    releaseTaskLock(lock);
  }

  const current = readTaskByKey(key);
  return {
    ok: failed.length === 0, attempted,
    task: current.status === 'ok' ? current.task : task,
    warning: failed.length
      ? `Repair persistence failed for ${failed.join(', ')}; debt remains release-blocking.` : '',
    mechanicalResolved, associationResolved,
  };
}

function canonicalEvidenceForProof(task, key, proof) {
  if (!proof || !/^[a-f0-9]{16}$/.test(proof.token || '') || !Array.isArray(proof.edits) ||
      proof.evidence !== `evidence-v4-${proof.token}.json` || !/^[a-f0-9]{16}$/.test(proof.descriptorHash || '')) return null;
  let record;
  try { record = JSON.parse(fs.readFileSync(evidencePath(proof.token), 'utf8')); }
  catch (_) { return null; }
  const descriptorKeys = ['commandHash', 'executable', 'operation', 'originHash', 'receiptHash',
    'responseHash', 'resultSource', 'targetExtension', 'targetHash', 'toolFamily'];
  const recordKeys = ['checkpoint', 'descriptor', 'descriptorHash', 'editSetHash', 'edits', 'eventClass',
    'executionHash', 'proofId', 'result', 'taskKey', 'turnHash', 'version'];
  if (!plainObject(record) || !plainObject(record.descriptor) || record.version !== 4 || record.taskKey !== key ||
      record.turnHash !== proof.turn || record.proofId !== proof.token || record.eventClass !== proof.eventClass ||
      record.editSetHash !== proof.editSetHash || record.executionHash !== proof.executionHash ||
      record.descriptorHash !== proof.descriptorHash || record.checkpoint !== proof.checkpoint || record.result !== 'pass' ||
      stableStringify(record.edits) !== stableStringify([...proof.edits].sort()) ||
      Object.keys(record).sort().join(',') !== recordKeys.sort().join(',') ||
      Object.keys(record.descriptor).sort().join(',') !== descriptorKeys.sort().join(',') ||
      hash(stableStringify(record.descriptor)).slice(0, 16) !== proof.descriptorHash) return null;
  const canonical = JSON.stringify({
    task: key, turn: proof.turn, eventClass: proof.eventClass, edits: [...proof.edits].sort(),
    executionHash: proof.executionHash, descriptorHash: proof.descriptorHash,
    checkpoint: proof.checkpoint, result: 'pass',
  });
  const expected = crypto.createHmac('sha256', task.salt).update(canonical).digest('hex').slice(0, 16);
  if (expected !== proof.token) return null;
  return record;
}

function controlOutput(task, key, changed, stateWarning = '', repair = null) {
  const acceptedCandidates = task.proofs.filter((proof) => proof && proof.checkpoint === task.checkpoint);
  const latest = acceptedCandidates.length ? acceptedCandidates[acceptedCandidates.length - 1] : null;
  const latestEvidence = latest ? canonicalEvidenceForProof(task, key, latest) : null;
  const awaiting = task.proofs.filter((proof) => proof && proof.checkpoint > task.checkpoint).length;
  const children = associationSummary(key, task);
  const ownMechanicalState = mechanicalStateForKey(key, task);
  const ownMechanical = new Map([...ownMechanicalState.active].map(([id, record]) => [id, record.reason]));
  const debtIds = task.unresolved.map((debt) => debt.id);
  const associationDetails = [...children.association].map(([id, code]) => `${code}:${id}`);
  const mechanicalDetails = [...ownMechanical].map(([id, reason]) => `${reason}:${id}`);
  const mechanicalResolutionDetails = [...ownMechanicalState.resolved.keys()];
  const associationResolutionDetails = [...children.associationResolved.keys()];
  const childMechanicalDetails = [...children.mechanical.keys()];
  const childDirtyDetails = [...children.dirty].map(([child, count]) => `${child.slice(0, 12)}:${count}`);
  const childPendingDetails = [...children.pending].map(([child, count]) => `${child.slice(0, 12)}:${count}`);
  const childInvalidEvidenceDetails = [...children.invalidEvidence].map(([child, proof]) => `${child.slice(0, 12)}:${proof}`);
  const repairLines = repair ? [
    `repair transaction: ${repair.ok ? (repair.attempted ? 'completed' : 'no eligible records') : 'incomplete'}`,
    `mechanical resolved: ${repair.mechanicalResolved.length}${repair.mechanicalResolved.length ? ` (${repair.mechanicalResolved.join(', ')})` : ''}`,
    `mechanical unresolved: ${ownMechanical.size}${ownMechanical.size ? ` (${mechanicalDetails.join(', ')})` : ''}`,
    `association resolved: ${repair.associationResolved.length}${repair.associationResolved.length ? ` (${repair.associationResolved.join(', ')})` : ''}`,
    `association unresolved: ${children.association.size}${children.association.size ? ` (${associationDetails.join(', ')})` : ''}`,
  ] : [];
  const text = [
    'DEV-RIGOR TASK STATUS',
    'version: 1.7.0',
    `mode: ${task.mode}`,
    `dirty edit: ${task.dirtyEdits.length ? 'yes' : 'no'}`,
    `pending tool observations: ${task.pendingObservations.length}${task.pendingObservations.length ? ' (release-blocking until reconciled)' : ''}`,
    `unresolved proof: ${task.unresolved.length ? `yes (${debtIds.join(', ')})` : 'no'}`,
    `mechanical debt: ${ownMechanical.size ? `yes (${ownMechanical.size}) ${mechanicalDetails.join(', ')}` : 'no'}`,
    `mechanical resolutions: ${ownMechanicalState.resolved.size}${ownMechanicalState.resolved.size ? ` (${mechanicalResolutionDetails.join(', ')})` : ''}`,
    `association debt: ${children.association.size ? `yes (${children.association.size}) ${associationDetails.join(', ')}` : 'no'}`,
    `association resolutions: ${children.associationResolved.size}${children.associationResolved.size ? ` (${associationResolutionDetails.join(', ')})` : ''}`,
    `latest accepted proof: ${latest && latestEvidence ? `${latest.eventClass} / ${latest.token} / ${latestEvidence.descriptor.executable}:${latestEvidence.descriptor.operation}` : latest ? 'invalid canonical evidence' : 'none'}`,
    `proof candidates awaiting Stop: ${awaiting}`,
    `checkpoint: ${task.checkpoint}`,
    `substantive blocks: ${task.blockCount}`,
    `associated subagents: ${children.count}`,
    `subagent dirty edits: ${children.dirty.size}${children.dirty.size ? ` (${childDirtyDetails.join(', ')})` : ''}`,
    `subagent pending observations: ${children.pending.size}${children.pending.size ? ` (${childPendingDetails.join(', ')})` : ''}`,
    `subagent unresolved proof: ${children.unresolved.size}${children.unresolved.size ? ` (${[...children.unresolved].join(', ')})` : ''}`,
    `subagent invalid canonical evidence: ${children.invalidEvidence.size}${children.invalidEvidence.size ? ` (${childInvalidEvidenceDetails.join(', ')})` : ''}`,
    `subagent mechanical debt: ${children.mechanical.size}${children.mechanical.size ? ` (${childMechanicalDetails.join(', ')})` : ''}`,
    `subagent substantive blocks: ${children.blocks}`,
    `delivery observed: PreToolUse ${task.delivery.preToolUse}, PostToolUse ${task.delivery.postToolUse}, Stop ${task.delivery.stop}`,
    'trust: not established by task ledger; use Codex hook review for configuration trust',
    ...repairLines,
    stateWarning,
    repair ? 'Repair is exact-task, append-only, and does not infer or change parentage.' :
      changed ? 'Task control updated. This does not change global Codex configuration.' : 'Status is read-only.',
  ].filter(Boolean).join('\n');
  return JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: text } });
}

const ROUTES = [
  {
    name: 'release', file: 'release.md',
    match: (p) => /\b(cut|ship|prep(are)?|publish|finalize|start|run|do|make) (a |an |the |this )?(new )?release\b|\brelease (gate|process|checklist|candidate|notes|branch|build)\b|\btag (a |the )?v?\d|\btag (the |a )?(release|version|rc)\b|\bpublish (the|a) (release|version|package)\b|\bcut (a |an |the )?(rc|version)\b|\bgauntletgate all\b|\bship (it|v?\d)\b/i.test(p),
  },
  {
    name: 'decompose', file: 'decompose.md',
    match: (p) => {
      if (!/\b(implement|build|create|add|develop|write|feature|make|fix)\b/i.test(p)) return false;
      const listMarkers = (p.match(/(^|\n)\s*(\d+[.)]|[-*])\s+/g) || []).length >= 2 ||
        (p.match(/\b\d+[.)]\s/g) || []).length >= 2;
      const conjunctions = (p.match(/\b(and|then|plus|also)\b/gi) || []).length >= 3;
      return listMarkers || conjunctions || p.length > 600;
    },
  },
  { name: 'investigation', file: 'investigation.md', match: (p) => SYMPTOM.test(p) && (WORK_VERB.test(p) || CODE_HINT.test(p)) },
  {
    name: 'grounding', file: 'grounding.md',
    match: (p) => /\b(ui|ux|page|button|css|styl(e|es|ing)|layout|render(s|ing)?|chart|graph|svg|html|landing|frontend|front-end|component|widget|screen|modal|form|dashboard|animation|responsive|dark mode)\b/i.test(p) &&
      (ACTION_VERB.test(p) || CODE_HINT.test(p)),
  },
];

function markDelivered(session, warning, noticeIds) {
  if (!session) return;
  withTaskTransaction(session, (task) => {
    if (warning && task.warnings && task.warnings.mechanicalUnavailable) task.warnings.mechanicalUnavailable.delivered = true;
    const ids = new Set(noticeIds);
    task.notices.forEach((notice) => { if (ids.has(notice.id)) notice.delivered = true; });
  });
}

function main() {
  let payload;
  try { payload = JSON.parse(fs.readFileSync(0, 'utf8')); } catch (_) { return; }
  const exactSession = sessionIdentity(payload.session_id);
  const prompt = typeof payload.prompt === 'string' ? payload.prompt : '';
  const key = exactSession ? taskKey(exactSession) : '';
  let currentTask = exactSession ? loadTask(exactSession) : null;
  if (currentTask && key) currentTask.mode = effectiveModeByKey(key, currentTask.mode).mode;
  const missingTurnWarning = currentTask && currentTask.warnings && currentTask.warnings.mechanicalUnavailable &&
    currentTask.warnings.mechanicalUnavailable.delivered !== true
    ? 'Dev-rigor mechanical enforcement is unavailable: this client did not provide turn_id. Skill guidance remains active; Stop enforcement is not verified.'
    : '';
  const control = /^(?:DevRigorON|DevRigorWARN|DevRigorOFF|DevRigorSTATUS|DevRigorREPAIR)$/.test(prompt) ? prompt : '';
  if (control && exactSession) {
    let changed = false;
    let stateWarning = currentTask.warnings && currentTask.warnings.rootStateFailure
      ? `Exact task state is unavailable (${currentTask.warnings.rootStateFailure.reason}); mechanical debt ${currentTask.warnings.rootStateFailure.debtId || 'unknown'} remains release-blocking.`
      : '';
    let repair = null;
    if (control === 'DevRigorREPAIR') {
      repair = repairExactTask(exactSession, key);
      currentTask = repair.task;
      stateWarning = repair.warning;
    } else if (control !== 'DevRigorSTATUS') {
      const mode = control.slice('DevRigor'.length);
      const transaction = withTaskTransaction(exactSession, (task) => { task.mode = mode; }, false,
        `control-${mode.toLowerCase()}`);
      if (transaction.ok) {
        currentTask = transaction.task;
        changed = true;
      } else {
        currentTask = loadTask(exactSession);
        currentTask.mode = 'WARN';
        stateWarning = `Task control could not be persisted; mechanical debt ${transaction.debtId || 'unknown'} remains release-blocking.`;
      }
    }
    const effective = effectiveModeByKey(key, currentTask.mode);
    currentTask.mode = effective.mode;
    if (effective.code) {
      const ancestryMessage = effective.mode === 'OFF'
        ? `Task ancestry is ${effective.code}; explicit OFF remains authoritative.`
        : `Task ancestry is ${effective.code}; effective mode fails open to WARN.`;
      stateWarning = [stateWarning, ancestryMessage].filter(Boolean).join(' ');
    }
    if (currentTask.warnings && currentTask.warnings.mechanicalUnavailable) {
      markDelivered(exactSession, true, []);
      currentTask.warnings.mechanicalUnavailable.delivered = true;
    }
    try { process.stdout.write(controlOutput(currentTask, key, changed, stateWarning, repair)); } catch (_) { /* closed stdout */ }
    return;
  }

  const route = prompt.length >= 8 ? ROUTES.find((candidate) => candidate.match(prompt)) : null;
  const pendingNotices = currentTask ? currentTask.notices.filter((notice) => notice.delivered !== true) : [];
  const graph = currentTask && key ? associationSummary(key, currentTask) : null;
  const ownMechanical = currentTask && key ? mechanicalDebtsForKey(key, currentTask) : new Map();
  const codingPrompt = Boolean(route || (ACTION_VERB.test(prompt) &&
    (CODE_HINT.test(prompt) || SYMPTOM.test(prompt) ||
      (currentTask && (currentTask.dirtyEdits.length || currentTask.unresolved.length)))));
  const debtParts = [];
  if (currentTask && currentTask.dirtyEdits.length) debtParts.push(`${currentTask.dirtyEdits.length} dirty edit(s) awaiting proof`);
  if (currentTask && currentTask.unresolved.length) debtParts.push(`${currentTask.unresolved.length} unresolved edit set(s) (${currentTask.unresolved.map((debt) => debt.id).join(', ')})`);
  if (currentTask && currentTask.pendingObservations.length) debtParts.push(`${currentTask.pendingObservations.length} pending tool observation(s)`);
  if (ownMechanical.size) debtParts.push(`${ownMechanical.size} mechanical debt record(s)`);
  if (graph && graph.unresolved.size) {
    debtParts.push(`${graph.unresolved.size} associated-subagent unresolved edit set(s) (${[...graph.unresolved].join(', ')})`);
  }
  if (graph && graph.dirty.size) debtParts.push(`${graph.dirty.size} associated-subagent task(s) with dirty edits`);
  if (graph && graph.pending.size) debtParts.push(`${graph.pending.size} associated-subagent task(s) with pending tool observations`);
  if (graph && graph.invalidEvidence.size) {
    debtParts.push(`${graph.invalidEvidence.size} associated-subagent invalid canonical evidence record(s)`);
  }
  if (graph && graph.mechanical.size) {
    debtParts.push(`${graph.mechanical.size} associated-subagent mechanical debt record(s) (${[...graph.mechanical.keys()].join(', ')})`);
  }
  if (graph && graph.association.size) debtParts.push(`${graph.association.size} association debt record(s)`);
  const debtReminder = currentTask && codingPrompt && debtParts.length
    ? `DEV-RIGOR PROOF DEBT: ${debtParts.join('; ')} remain. Resolve debt only with evidence bound to the same affected edit set or a verified superseding set; mechanical and association failures require explicit correlated repair. Release gates remain blocked.`
    : '';
  const noticeText = pendingNotices.map((notice) => notice.message).join('\n');
  if (!route && !missingTurnWarning && !noticeText && !debtReminder) return;

  if (!route && (missingTurnWarning || noticeText || debtReminder)) {
    markDelivered(exactSession, Boolean(missingTurnWarning), pendingNotices.map((notice) => notice.id));
    try { process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: [missingTurnWarning, noticeText, debtReminder].filter(Boolean).join('\n\n') } })); } catch (_) { /* closed stdout */ }
    return;
  }

  const stateFile = exactSession ? path.join(stateDir, `router-v4-${hash(exactSession)}.log`) : null;
  if (stateFile) {
    let seen = '';
    try { seen = fs.readFileSync(stateFile, 'utf8'); } catch (_) { /* first route */ }
    if (seen.split('\n').includes(route.name) && !missingTurnWarning && !noticeText && !debtReminder) return;
  }

  let text;
  try { text = fs.readFileSync(path.join(disciplinesDir, route.file), 'utf8').replace(/^\uFEFF/, ''); } catch (_) { text = ''; }

  if (stateFile) {
    try {
      ensureStateDir();
      fs.appendFileSync(stateFile, route.name + '\n', 'utf8');
      // Durable task, proof, mechanical, and association state is never pruned by routing.
      // Grounding owns cleanup of disposable per-turn evidence under its debt-aware policy.
    } catch (_) { /* reinjection is safer than losing the prompt */ }
  }

  try {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: [missingTurnWarning, noticeText, debtReminder, text].filter(Boolean).join('\n\n'),
      },
    }));
    markDelivered(exactSession, Boolean(missingTurnWarning), pendingNotices.map((notice) => notice.id));
  } catch (_) { /* closed stdout */ }
}

main();
