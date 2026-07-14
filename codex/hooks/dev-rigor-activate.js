#!/usr/bin/env node
// Codex SessionStart/SubagentStart compact activation and state restoration.

const crypto = require('crypto');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
const stateDir = path.join(codexHome, 'dev-rigor-stack', 'state');
const associationDir = path.join(stateDir, 'associations-v4');
const associationDebtDir = path.join(stateDir, 'association-debt-v4');
const disciplinesDir = path.join(__dirname, '..', 'disciplines');
const LOCK_WAIT_MS = 3500;

function readPayload() {
  try { return JSON.parse(fs.readFileSync(0, 'utf8')); } catch (_) { return {}; }
}
function hash(value) { return crypto.createHash('sha256').update(String(value)).update('\0').digest('hex'); }
function taskKey(session) { return hash(session); }
function taskPathByKey(key) { return path.join(stateDir, `task-v4-${key}.json`); }
function taskPath(session) { return taskPathByKey(taskKey(session)); }
function taskGenesisPathByKey(key) { return path.join(stateDir, `task-genesis-v4-${key}.json`); }
function mechanicalPathByKey(key) { return path.join(stateDir, `mechanical-v4-${key}.log`); }
function associationPath(parentKey, childKey) { return path.join(associationDir, parentKey, `${childKey}.json`); }
function associationDebtPath(parentKey, childKey, code, occurrence) {
  return path.join(associationDebtDir, parentKey,
    `${childKey}-${hash(code).slice(0, 16)}-${occurrence}.json`);
}

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
  return task;
}

function knownTaskEvidence(key) {
  if (fs.existsSync(taskGenesisPathByKey(key)) || fs.existsSync(mechanicalPathByKey(key)) ||
      fs.existsSync(path.join(stateDir, `router-v4-${key}.log`)) ||
      fs.existsSync(path.join(associationDir, key)) || fs.existsSync(path.join(associationDebtDir, key))) return true;
  try {
    if (fs.readdirSync(stateDir).some((name) => new RegExp(`^task-v4-${key}\\.json\\.[a-z0-9.-]+\\.tmp$`, 'i').test(name))) return true;
  } catch (_) { /* no pending task write */ }
  try {
    for (const parent of fs.readdirSync(associationDir, { withFileTypes: true })) {
      if (parent.isDirectory() && fs.existsSync(path.join(associationDir, parent.name, `${key}.json`))) return true;
    }
  } catch (_) { /* absent/corrupt association namespaces are handled elsewhere */ }
  return false;
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
    if (error && error.code === 'ENOENT') {
      return { status: knownTaskEvidence(key) ? 'missing-known' : 'missing', task: null };
    }
    return { status: 'corrupt', task: null };
  }
}

function writeTaskGenesis(key, task) {
  const target = taskGenesisPathByKey(key);
  const value = { version: 4, taskKey: key, saltCommitment: hash(task.salt) };
  try {
    fs.writeFileSync(target, JSON.stringify(value) + '\n', { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    return true;
  } catch (error) {
    if (!error || error.code !== 'EEXIST') return false;
    try {
      const current = JSON.parse(fs.readFileSync(target, 'utf8'));
      return Object.keys(current).sort().join(',') === 'saltCommitment,taskKey,version' &&
        current.version === 4 && current.taskKey === key && current.saltCommitment === value.saltCommitment;
    } catch (_) { return false; }
  }
}

function pendingTaskWrite(key) {
  let names = [];
  try {
    const pattern = new RegExp(`^task-v4-${key}\\.json\\.[a-z0-9.-]+\\.tmp$`, 'i');
    names = fs.readdirSync(stateDir).filter((name) => pattern.test(name));
  } catch (_) { return { status: 'none' }; }
  if (!names.length) return { status: 'none' };
  const candidates = [];
  for (const name of names) {
    try {
      const file = path.join(stateDir, name);
      const raw = fs.readFileSync(file, 'utf8');
      const task = JSON.parse(raw);
      if (!validTaskShape(task, key)) return { status: 'invalid' };
      candidates.push({ file, raw, task: normalizeTask(task) });
    } catch (_) { return { status: 'invalid' }; }
  }
  if (candidates.some((candidate) => candidate.raw !== candidates[0].raw)) return { status: 'invalid' };
  return { status: 'ready', candidates, task: candidates[0].task };
}

function recoverPendingTaskWrite(key) {
  if (fs.existsSync(taskPathByKey(key))) return { status: 'none' };
  const pending = pendingTaskWrite(key);
  if (pending.status !== 'ready') return pending;
  if (!writeTaskGenesis(key, pending.task)) return { status: 'invalid' };
  try {
    fs.renameSync(pending.candidates[0].file, taskPathByKey(key));
    try { fs.chmodSync(taskPathByKey(key), 0o600); } catch (_) { /* Windows inherits profile ACLs. */ }
    for (const duplicate of pending.candidates.slice(1)) {
      try { fs.unlinkSync(duplicate.file); } catch (_) { /* identical orphan cleanup */ }
    }
    return readTaskByKey(key).status === 'ok' ? { status: 'recovered' } : { status: 'invalid' };
  } catch (_) { return { status: 'invalid' }; }
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
  if (!validTaskShape(task, key)) throw new Error('task-identity-invalid');
  const target = taskPathByKey(key);
  const temporary = `${target}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(task) + '\n', { encoding: 'utf8', mode: 0o600 });
  if (!writeTaskGenesis(key, task)) throw new Error('task-identity-invalid');
  fs.renameSync(temporary, target);
  try { fs.chmodSync(target, 0o600); } catch (_) { /* Windows inherits profile ACLs. */ }
}

function recordMechanicalDebt(key, code, correlation = '') {
  const occurrence = crypto.randomBytes(8).toString('hex');
  const correlationHash = hash(correlation).slice(0, 16);
  const id = hash(`${key}\0${code}\0activate\0${correlationHash}\0${occurrence}`).slice(0, 16);
  try {
    ensureStateDir();
    fs.appendFileSync(mechanicalPathByKey(key),
      `M ${id} reason:${code} source:activate correlation:${correlationHash} occurrence:${occurrence}\n`,
      { encoding: 'utf8', mode: 0o600 });
  } catch (_) { /* visible hook warning remains the final fallback */ }
  return id;
}

function recordMechanicalDebtOnce(key, code, correlation = '') {
  const correlationHash = hash(correlation).slice(0, 16);
  try {
    const match = fs.readFileSync(mechanicalPathByKey(key), 'utf8').split('\n')
      .map((line) => line.match(/^M\s+([a-f0-9]{16})\s+reason:(\S+)\s+source:activate\s+correlation:(\S+)/))
      .find((candidate) => candidate && candidate[2] === code && candidate[3] === correlationHash);
    if (match) return match[1];
  } catch (_) { /* first occurrence */ }
  return recordMechanicalDebt(key, code, correlation);
}

function withTaskTransaction(session, mutate, create = false) {
  const key = taskKey(session);
  let lock = null;
  try { lock = acquireTaskLock(key); } catch (_) { /* recorded below */ }
  if (!lock) {
    const debtId = recordMechanicalDebt(key, 'task-lock-timeout', 'activate');
    return { ok: false, key, code: 'task-lock-timeout', debtId };
  }
  try {
    const recovered = recoverPendingTaskWrite(key);
    if (recovered.status === 'invalid') {
      const debtId = recordMechanicalDebtOnce(key, 'task-state-corrupt', 'activate');
      return { ok: false, key, code: 'task-state-corrupt', debtId };
    }
    const loaded = readTaskByKey(key);
    if (loaded.status === 'corrupt' || loaded.status === 'missing-known') {
      const code = loaded.status === 'corrupt' ? 'task-state-corrupt' : 'task-state-missing';
      const debtId = recordMechanicalDebtOnce(key, code, 'activate');
      return { ok: false, key, code, debtId };
    }
    if (loaded.status === 'missing' && !create) return { ok: false, key, code: 'task-state-missing' };
    const task = loaded.status === 'ok' ? loaded.task : defaultTask(key);
    const result = mutate(task) || {};
    saveTaskByKey(key, task);
    return { ok: true, key, task, result };
  } catch (_) {
    if (!fs.existsSync(taskPathByKey(key)) && pendingTaskWrite(key).status === 'ready') {
      return { ok: false, key, code: 'task-state-save-failed', debtId: 'pending-exact-recovery' };
    }
    const debtId = recordMechanicalDebt(key, 'task-state-save-failed', 'activate');
    return { ok: false, key, code: 'task-state-save-failed', debtId };
  } finally {
    releaseTaskLock(lock);
  }
}

function writeImmutableJson(target, value) {
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.writeFileSync(target, JSON.stringify(value) + '\n', { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    return true;
  } catch (error) {
    if (!error || error.code !== 'EEXIST') return false;
    try {
      const current = JSON.parse(fs.readFileSync(target, 'utf8'));
      return current && current.parentKey === value.parentKey && current.childKey === value.childKey;
    } catch (_) { return false; }
  }
}

function writeAssociationDebt(parentKey, childKey, code) {
  try {
    const directory = path.join(associationDebtDir, parentKey);
    for (const name of fs.readdirSync(directory)) {
      try {
        const current = JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
        if (current && current.version === 4 && current.parentKey === parentKey && current.childKey === childKey &&
            current.code === code && current.status === 'unresolved' && /^[a-f0-9]{16}$/.test(current.id || '')) return current.id;
      } catch (_) { /* malformed markers remain visible structural debt */ }
    }
  } catch (_) { /* first marker in this namespace */ }
  const occurrence = crypto.randomBytes(8).toString('hex');
  const id = hash(`${parentKey}\0${childKey}\0${code}\0${occurrence}`).slice(0, 16);
  const target = associationDebtPath(parentKey, childKey, code, occurrence);
  const ok = writeImmutableJson(target, {
    version: 4, id, parentKey, childKey, code, occurrence, status: 'unresolved',
  });
  if (!ok) recordMechanicalDebt(parentKey, 'association-debt-persist-failed', id);
  return id;
}

function writeAssociationEdge(parentKey, childKey) {
  return writeImmutableJson(associationPath(parentKey, childKey), {
    version: 4, parentKey, childKey,
  });
}

function exactAssociation(parentKey, childKey) {
  try {
    const edge = JSON.parse(fs.readFileSync(associationPath(parentKey, childKey), 'utf8'));
    const parent = readTaskByKey(parentKey);
    return edge && edge.version === 4 && edge.parentKey === parentKey && edge.childKey === childKey &&
      Object.keys(edge).sort().join(',') === 'childKey,parentKey,version' && parent.status === 'ok' &&
      parent.task.children.includes(childKey);
  } catch (_) { return false; }
}

function effectiveModeByKey(startKey) {
  const visited = new Set();
  let key = startKey;
  let mode = 'ON';
  while (key) {
    if (visited.has(key)) return mode === 'OFF'
      ? { mode: 'OFF', warning: 'Task ancestry contains a cycle; explicit OFF remains authoritative.' }
      : { mode: 'WARN', warning: 'Task ancestry contains a cycle; inheritance fails open in mode: WARN.' };
    visited.add(key);
    const loaded = readTaskByKey(key);
    if (loaded.status !== 'ok') {
      return mode === 'OFF'
        ? { mode: 'OFF', warning: `Task ancestry is ${loaded.status}; explicit OFF remains authoritative.` }
        : { mode: 'WARN', warning: `Task ancestry is ${loaded.status}; inheritance fails open in mode: WARN.` };
    }
    if (loaded.task.mode === 'OFF') mode = 'OFF';
    else if (loaded.task.mode === 'WARN' && mode !== 'OFF') mode = 'WARN';
    if (typeof loaded.task.parentKey !== 'string' || !loaded.task.parentKey) return { mode, warning: '' };
    key = loaded.task.parentKey;
  }
  return { mode: 'WARN', warning: 'Task ancestry is unavailable; inheritance fails open in mode: WARN.' };
}

function parentSession(payload) {
  for (const key of ['parent_session_id', 'parentSessionId', 'parent_thread_id', 'parentThreadId']) {
    if (typeof payload[key] === 'string' && payload[key]) return payload[key];
  }
  return '';
}

function routeContext(session) {
  if (typeof session !== 'string' || !session) return '';
  let routes = [];
  try { routes = fs.readFileSync(path.join(stateDir, `router-v4-${hash(session)}.log`), 'utf8').split('\n').filter(Boolean); }
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
let key = session ? taskKey(session) : '';
let task = defaultTask(key);
task.mode = 'WARN';
let warning = '';

if (session) {
  if (subagent) {
    const parent = parentSession(payload);
    if (parent) {
      const parentKey = taskKey(parent);
      const parentState = readTaskByKey(parentKey);
      const transaction = withTaskTransaction(session, (current) => {
        if (current.parentKey && current.parentKey !== parentKey) {
          return { conflict: true, existingParentKey: current.parentKey };
        }
        current.parentKey = parentKey;
        delete current.unboundParent;
        if (parentState.status !== 'ok' && current.mode !== 'OFF') current.mode = 'WARN';
        return { conflict: false };
      }, true);
      key = transaction.key;
      if (!transaction.ok) {
        const code = transaction.code === 'task-state-missing' ? 'missing-child-state' :
          transaction.code || 'association-state-failed';
        const debtId = writeAssociationDebt(parentKey, key, code);
        task = defaultTask(key);
        task.mode = 'WARN';
        warning = `Association state could not be persisted; debt ${debtId} remains release-blocking and this subagent fails open in mode: WARN.`;
      } else if (transaction.result.conflict) {
        const debtId = writeAssociationDebt(parentKey, key, 'association-parent-conflict');
        task = transaction.task;
        warning = `Subagent association conflict: this task is already bound to a different parent. The original parent is immutable; association debt ${debtId} remains release-blocking.`;
      } else {
        task = transaction.task;
        if (!writeAssociationEdge(parentKey, key)) {
          const debtId = writeAssociationDebt(parentKey, key, 'association-edge-persist-failed');
          const persisted = withTaskTransaction(session, (current) => { if (current.mode !== 'OFF') current.mode = 'WARN'; });
          if (persisted.ok) task = persisted.task;
          warning = `Subagent association could not be completed; debt ${debtId} remains release-blocking and this subagent fails open in mode: WARN.`;
        }
        if (parentState.status !== 'ok') {
          const debtId = writeAssociationDebt(parentKey, key, 'missing-parent-state');
          const persisted = withTaskTransaction(session, (current) => { if (current.mode !== 'OFF') current.mode = 'WARN'; });
          if (persisted.ok) task = persisted.task;
          warning = [warning, `The authoritative parent task state is ${parentState.status}; it was not synthesized. Association debt ${debtId} remains release-blocking and this subagent fails open in mode: WARN.`].filter(Boolean).join(' ');
        } else {
          // Immutable edges are authoritative. Keep parent.children as a locked,
          // backwards-compatible projection for older status/reviewer consumers.
          const projection = withTaskTransaction(parent, (parentTask) => {
            if (!parentTask.children.includes(key)) parentTask.children.push(key);
          }, false);
          if (!projection.ok) {
            const debtId = writeAssociationDebt(parentKey, key, projection.code || 'association-parent-state-failed');
            const persisted = withTaskTransaction(session, (current) => { if (current.mode !== 'OFF') current.mode = 'WARN'; });
            if (persisted.ok) task = persisted.task;
            warning = [warning, `Parent association projection could not be persisted; debt ${debtId} remains release-blocking and this subagent fails open in mode: WARN.`].filter(Boolean).join(' ');
          }
        }
      }
    } else {
      const existing = readTaskByKey(key);
      if (existing.status === 'ok' && existing.task.parentKey && exactAssociation(existing.task.parentKey, key)) {
        // Compaction/resume may omit the parent id. Restore only the exact,
        // persisted child binding + immutable edge + locked parent projection.
        task = existing.task;
      } else {
        const transaction = withTaskTransaction(session, (current) => {
          if (!current.parentKey) {
            if (current.mode !== 'OFF') current.mode = 'WARN';
            current.unboundParent = true;
          } else if (current.mode !== 'OFF') current.mode = 'WARN';
        }, true);
        key = transaction.key;
        task = transaction.ok ? transaction.task : defaultTask(key);
        if (task.mode !== 'OFF') task.mode = 'WARN';
        const unboundDebt = transaction.ok ? writeAssociationDebt(
          task.parentKey || key, key, existing.status === 'missing-known' ? 'missing-child-state' : 'parent-unavailable'
        ) : '';
        warning = transaction.ok
          ? `Parent task identity is unavailable and no complete persisted association could be verified; this subagent visibly fails open in mode: WARN, does not infer inheritance, and association debt ${unboundDebt} remains release-blocking.`
          : `Parent task identity and task state are unavailable; mechanical debt ${transaction.debtId || 'unknown'} remains release-blocking.`;
      }
    }
  } else {
    const transaction = withTaskTransaction(session, () => {}, true);
    key = transaction.key;
    task = transaction.ok ? transaction.task : defaultTask(key);
    if (!transaction.ok) {
      task.mode = 'WARN';
      warning = `Task state is unavailable; mechanical debt ${transaction.debtId || 'unknown'} remains release-blocking and activation fails open in mode: WARN.`;
    }
  }
}

if (session && key) {
  const effective = effectiveModeByKey(key);
  task.mode = effective.mode;
  if (effective.warning) warning = [warning, effective.warning].filter(Boolean).join(' ');
}

let core;
try { core = fs.readFileSync(path.join(__dirname, '..', 'dev-rigor-core.md'), 'utf8').replace(/^\uFEFF/, ''); }
catch (_) { process.exit(0); }
const routed = session ? routeContext(session) : '';
const context = [core, `Current task mode: ${task.mode}`, warning, routed].filter(Boolean).join('\n\n');

try {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: context } }));
} catch (_) { /* closed stdout */ }
