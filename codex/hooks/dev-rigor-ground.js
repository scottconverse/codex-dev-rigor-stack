#!/usr/bin/env node
// Codex PostToolUse + Stop/SubagentStop substantive grounding gate.

const crypto = require('crypto');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
const stateDir = path.join(codexHome, 'dev-rigor-stack', 'state');
const EDIT_TOOLS = /^(apply_patch|Edit|Write|MultiEdit|NotebookEdit)$/i;
const SHELL_TOOLS = /^(?:Bash|PowerShell|shell_command|exec_command)$/i;
const INTERACTION_ACTIONS = new Set(['click', 'dblclick', 'double_click', 'navigate', 'goto', 'screenshot', 'snapshot', 'render', 'preview', 'run', 'execute', 'run_cell', 'keypress', 'type', 'fill', 'select_option', 'check', 'uncheck', 'drag', 'scroll']);
const INTERACTION_FAMILIES = new Set(['browser', 'chrome', 'computer', 'computer-use', 'playwright', 'jupyter', 'notebook', 'ide']);
const RECEIPT = /proved:\s*\S[\s\S]*blast:\s*\S[\s\S]*skipped:\s*\S/i;
const INSPECTION_COMMAND = /^\s*(?:git\s+(?:status|diff|log|show|rev-parse|branch|fetch)\b|rg\b|grep\b|Get-Content\b|Select-String\b|Get-ChildItem\b|cat\b|ls\b|dir\b|echo\b|pwd\b|Get-Date\b|Get-Location\b|Write-(?:Output|Host)\b|sleep\b|Start-Sleep\b)[^;&|><\r\n]*$/i;
const DIRECT_WRITE = /(?:^|[;|&]\s*)(?:Set-Content|Add-Content|Out-File)\b|(?:^|[^>])>{1,2}(?!>)/i;
const MUTATING_GENERATOR = /\b(?:generate|codegen|migration|migrate)\b|\bprettier\b[^\r\n]*--write\b|\beslint\b[^\r\n]*--fix\b|\bgofmt\b[^\r\n]*(?:-w\b|-w=)|\bdotnet\s+format\b(?![^\r\n]*--verify-no-changes)|\bcargo\s+fmt\b(?![^\r\n]*--check)|\brustfmt\b(?![^\r\n]*--check)/i;
const SNAPSHOT_BUDGET_MS = 8000;
const POST_OBSERVATION_BUDGET_MS = 5000;
const MAX_SUBMODULE_DEPTH = 8;
let pendingHookOutput = null;
const pendingSystemMessages = [];
const pendingNoticeDeliveries = [];

function setHookOutput(value) {
  if (!pendingHookOutput || (value && value.decision === 'block')) pendingHookOutput = value;
}

function queueHookSystemMessage(message, session = '', noticeId = '') {
  if (!message || pendingSystemMessages.includes(message)) return;
  pendingSystemMessages.push(message);
  if (session && noticeId) pendingNoticeDeliveries.push({ session, noticeId });
}

function flushHookOutput() {
  const messages = pendingSystemMessages.join('\n\n');
  let output = pendingHookOutput;
  if (messages) {
    if (!output) output = { systemMessage: messages };
    else if (output.decision === 'block') output.reason = `${output.reason}\n\n${messages}`;
    else output.systemMessage = [output.systemMessage, messages].filter(Boolean).join('\n\n');
  }
  if (!output) return;
  try { process.stdout.write(JSON.stringify(output)); } catch (_) { return; }

  const grouped = new Map();
  for (const delivery of pendingNoticeDeliveries) {
    if (!grouped.has(delivery.session)) grouped.set(delivery.session, new Set());
    grouped.get(delivery.session).add(delivery.noticeId);
  }
  for (const [session, ids] of grouped) {
    try {
      withTaskLock(session, () => {
        if (!fs.existsSync(taskPath(session))) return;
        const task = loadTask(session, false);
        let changed = false;
        for (const notice of task.notices) {
          if (ids.has(notice.id) && notice.delivered !== true) {
            notice.delivered = true;
            changed = true;
          }
        }
        if (changed) saveTask(session, task);
      });
    } catch (_) { /* an undelivered notice remains available to the router */ }
  }
}

function postObservationBudgetMs() {
  const requested = Number(process.env.DEV_RIGOR_TEST_OBSERVATION_BUDGET_MS);
  if (!Number.isFinite(requested) || requested < 0) return POST_OBSERVATION_BUDGET_MS;
  // The diagnostic override can only shorten observation and therefore can
  // only force the conservative fail-safe; it can never extend proof time.
  return Math.min(POST_OBSERVATION_BUDGET_MS, requested);
}

function hash(...values) {
  const digest = crypto.createHash('sha256');
  values.forEach((value) => digest.update(Buffer.isBuffer(value) ? value : String(value)).update('\0'));
  return digest.digest('hex');
}

function identity(value) {
  return typeof value === 'string' && value.length > 0 ? value : '';
}

function registerRepository(repoPath) {
  if (!repoPath) return '';
  const key = hash(repoPath);
  const registryPath = path.join(stateDir, 'repos-v4.json');
  let registry = {};
  try { registry = JSON.parse(fs.readFileSync(registryPath, 'utf8')); } catch (_) {}
  if (registry[key] !== repoPath) {
    registry[key] = repoPath;
    try {
      ensureStateDir();
      fs.writeFileSync(registryPath, JSON.stringify(registry) + '\n', { encoding: 'utf8', mode: 0o600 });
    } catch (_) {}
  }
  return key;
}

function resolveRepository(key) {
  if (!key) return '';
  const registryPath = path.join(stateDir, 'repos-v4.json');
  try {
    const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
    return registry[key] || '';
  } catch (_) {
    return '';
  }
}

function ensureStateDir() {
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(stateDir, 0o700); } catch (_) { /* Windows inherits profile ACLs. */ }
}

function ledgerPath(session, turn) {
  return path.join(stateDir, `ground-v4-${hash(session, turn)}.log`);
}

function taskPath(session) {
  return path.join(stateDir, `task-v4-${hash(session)}.json`);
}

function taskGenesisPathByKey(key) {
  return path.join(stateDir, `task-genesis-v4-${key}.json`);
}

function taskGenesisPath(session) {
  return taskGenesisPathByKey(hash(session));
}

function taskLockPath(session) {
  return path.join(stateDir, `task-lock-v4-${hash(session)}`);
}

function mechanicalPath(session) {
  return path.join(stateDir, `mechanical-v4-${hash(session)}.log`);
}

function snapshotPath(session, turn, toolUseId) {
  return path.join(stateDir, `pre-v4-${hash(session, turn, toolUseId)}.json`);
}

function executionReceiptPath(session, turn, toolUseId) {
  return path.join(stateDir, `exec-v4-${hash(session, turn, toolUseId)}.receipt`);
}

function evidencePath(token) {
  return path.join(stateDir, `evidence-v4-${token}.json`);
}

function defaultTask(session) {
  return normalizeTask({
    version: 4, taskKey: session ? hash(session) : '0'.repeat(64),
    mode: 'ON', salt: crypto.randomBytes(32).toString('hex'),
  });
}

function pause(milliseconds) {
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
    if (error.code === 'EEXIST') return null;
    if (!fs.existsSync(target)) throw error;
    return null;
  } finally {
    try { fs.unlinkSync(temporary); } catch (_) { /* linked target owns the complete record */ }
  }
}

function withTaskLock(session, callback) {
  ensureStateDir();
  const target = taskLockPath(session);
  const timeout = Math.max(250, Math.min(30000, Number(process.env.DEV_RIGOR_LOCK_TIMEOUT_MS) || 15000));
  const deadline = Date.now() + timeout;
  let lock = null;
  let lastReclaimCheck = 0;
  while (true) {
    try {
      lock = createTaskLock(target);
      if (lock) break;
    } catch (error) {
      if (!fs.existsSync(target)) throw error;
    }
    const now = Date.now();
    if (now - lastReclaimCheck >= 1000) {
      lastReclaimCheck = now;
      if (reclaimTaskLock(target)) continue;
    }
    if (now >= deadline) throw new Error('task-lock-timeout');
    pause(8);
  }
  try { return callback(); }
  finally {
    try {
      if (fs.readFileSync(lock.target, 'utf8') === lock.owner) fs.unlinkSync(lock.target);
    } catch (_) { /* a verified stale-lock takeover owns cleanup */ }
  }
}

function markMechanicalDebt(session, reason, task = null) {
  try {
    ensureStateDir();
    const code = /^(?:task-lock-timeout|task-state-corrupt|task-state-missing|task-state-write|snapshot-unavailable|edit-path-unavailable|ledger-write-failed|evidence-mismatch|execution-receipt-missing|execution-origin-changed)$/.test(reason) ? reason : 'task-state-write';
    const edits = task ? [...new Set(task.dirtyEdits)].sort() : [];
    const set = editSetHash(edits);
    const id = hash(session, code, set, Date.now(), process.pid, crypto.randomBytes(4)).slice(0, 16);
    fs.appendFileSync(mechanicalPath(session), `M ${id} reason:${code} edit-set:${set}\n`, { encoding: 'utf8', mode: 0o600 });
    if (task) {
      task.mechanical = Array.isArray(task.mechanical) ? task.mechanical : [];
      task.mechanical.push({ id, reason: code, editSetHash: set, edits, status: 'unresolved' });
      const unresolved = task.mechanical.filter((item) => item && item.status === 'unresolved');
      const history = task.mechanical.filter((item) => !item || item.status !== 'unresolved').slice(-64);
      task.mechanical = [...unresolved, ...history];
    }
    return id;
  } catch (_) { /* visible warning remains the final fail-open signal */ }
  return '';
}

function safeReason(reason) {
  const value = String(reason || 'snapshot-unavailable');
  return /^(?:snapshot-missing|snapshot-unavailable|snapshot-invalid|not-git|missing-cwd|root-changed|git-timeout|output-limit|path-limit|content-limit|object-unavailable|git-unavailable|git-command-failed|snapshot-error)$/.test(value)
    ? value : 'snapshot-unavailable';
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
  task.ledgerRefs = Array.isArray(task.ledgerRefs) ? task.ledgerRefs.filter((name) => /^ground-v4-[a-f0-9]{64}\.log$/.test(name)) : [];
  task.checkpointLedger = /^ground-v4-[a-f0-9]{64}\.log$/.test(String(task.checkpointLedger || '')) ? task.checkpointLedger : '';
  task.checkpoint = Number.isInteger(task.checkpoint) && task.checkpoint >= 0 ? task.checkpoint : 0;
  task.blockCount = Number.isInteger(task.blockCount) && task.blockCount >= 0 ? task.blockCount : 0;
  task.delivery = task.delivery && typeof task.delivery === 'object' ? task.delivery : {};
  for (const event of ['preToolUse', 'postToolUse', 'stop']) {
    task.delivery[event] = Number.isInteger(task.delivery[event]) && task.delivery[event] >= 0 ? task.delivery[event] : 0;
  }
  return task;
}

function taskByKey(key) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(stateDir, `task-v4-${key}.json`), 'utf8'));
    const genesis = JSON.parse(fs.readFileSync(taskGenesisPathByKey(key), 'utf8'));
    return validTaskShape(parsed, key) && plainObject(genesis) && genesis.version === 4 &&
      genesis.taskKey === key && genesis.saltCommitment === hash(parsed.salt) &&
      Object.keys(genesis).sort().join(',') === 'saltCommitment,taskKey,version'
      ? normalizeTask(parsed) : null;
  } catch (_) { return null; }
}

function effectiveMode(task, visited = new Set()) {
  if (!task || !/^(?:ON|WARN|OFF)$/.test(task.mode)) return 'WARN';
  const local = task.mode;
  if (typeof task.parentKey !== 'string') return local;
  if (visited.has(task.parentKey)) return 'WARN';
  visited.add(task.parentKey);
  const inherited = effectiveMode(taskByKey(task.parentKey), visited);
  if (local === 'OFF' || inherited === 'OFF') return 'OFF';
  if (local === 'WARN' || inherited === 'WARN') return 'WARN';
  return 'ON';
}

function loadTask(session) {
  const key = hash(session);
  try {
    const parsed = JSON.parse(fs.readFileSync(taskPath(session), 'utf8'));
    const genesis = JSON.parse(fs.readFileSync(taskGenesisPath(session), 'utf8'));
    if (validTaskShape(parsed, key) && plainObject(genesis) && genesis.version === 4 &&
        genesis.taskKey === key && genesis.saltCommitment === hash(parsed.salt) &&
        Object.keys(genesis).sort().join(',') === 'saltCommitment,taskKey,version') {
      return normalizeTask(parsed);
    }
  } catch (error) {
    if (fs.existsSync(taskPath(session)) || fs.existsSync(taskGenesisPath(session))) throw new Error(
      fs.existsSync(taskPath(session)) ? 'task-state-corrupt' : 'task-state-missing'
    );
  }
  throw new Error('task-state-missing');
}

function loadGroundTask(session) {
  return loadTask(session);
}

function saveTask(session, task) {
  ensureStateDir();
  const key = hash(session);
  let genesis;
  try { genesis = JSON.parse(fs.readFileSync(taskGenesisPath(session), 'utf8')); }
  catch (_) { throw new Error('task-state-missing'); }
  if (!validTaskShape(task, key) || !plainObject(genesis) || genesis.version !== 4 ||
      genesis.taskKey !== key || genesis.saltCommitment !== hash(task.salt) ||
      Object.keys(genesis).sort().join(',') !== 'saltCommitment,taskKey,version') {
    throw new Error('task-state-corrupt');
  }
  const target = taskPath(session);
  const temporary = `${target}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(task) + '\n', { encoding: 'utf8', mode: 0o600 });
  let retries = 10;
  while (true) {
    try {
      fs.renameSync(temporary, target);
      break;
    } catch (e) {
      if (['EPERM', 'EBUSY', 'EACCES'].includes(e.code) && retries-- > 0) {
        const start = Date.now();
        while (Date.now() - start < 15) {}
        continue;
      }
      throw e;
    }
  }
  try { fs.chmodSync(target, 0o600); } catch (_) { /* Windows inherits profile ACLs. */ }
  return true;
}

function append(session, turn, line) {
  try {
    ensureStateDir();
    const target = ledgerPath(session, turn);
    fs.appendFileSync(target, line.replace(/[\r\n\t]/g, ' ') + '\n', { encoding: 'utf8', mode: 0o600 });
    try { fs.chmodSync(target, 0o600); } catch (_) { /* Windows inherits profile ACLs. */ }
    return true;
  } catch (_) {
    // A gate unable to persist its retry state must never trap the conversation.
    return false;
  }
}

function readLedger(session, turn) {
  try { return fs.readFileSync(ledgerPath(session, turn), 'utf8').split('\n').filter(Boolean); }
  catch (_) { return []; }
}

function rememberLedger(task, session, turn) {
  const name = path.basename(ledgerPath(session, turn));
  if (!task.ledgerRefs.includes(name)) task.ledgerRefs.push(name);
  return name;
}

function protectedLedgerNames(entries) {
  const names = new Set();
  let preserveEveryLedger = false;
  for (const entry of entries) {
    if (!entry.stat.isFile() || !/^task-v4-[a-f0-9]{64}\.json$/.test(entry.name)) continue;
    try {
      const task = JSON.parse(fs.readFileSync(entry.file, 'utf8'));
      if (!task || task.version !== 4) throw new Error('invalid-task-state');
      const candidates = [
        ...(Array.isArray(task.ledgerRefs) ? task.ledgerRefs : []),
        task.checkpointLedger,
        ...(Array.isArray(task.proofs) ? task.proofs.map((item) => item && item.ledger) : []),
        ...(Array.isArray(task.unresolved) ? task.unresolved.map((item) => item && item.ledger) : []),
      ];
      for (const name of candidates) if (/^ground-v4-[a-f0-9]{64}\.log$/.test(String(name || ''))) names.add(name);
    } catch (_) {
      // A corrupt task cannot prove which ledger it still references. Preserve
      // every evidence ledger until an explicit repair resolves that ambiguity.
      preserveEveryLedger = true;
    }
  }
  if (preserveEveryLedger) {
    for (const entry of entries) if (/^ground-v4-[a-f0-9]{64}\.log$/.test(entry.name)) names.add(entry.name);
  }
  return names;
}

function protectedPendingNames(entries) {
  const names = new Set();
  let preserveEveryPendingArtifact = false;
  for (const entry of entries) {
    if (!entry.stat.isFile() || !/^task-v4-[a-f0-9]{64}\.json$/.test(entry.name)) continue;
    try {
      const task = JSON.parse(fs.readFileSync(entry.file, 'utf8'));
      if (!task || task.version !== 4 || !Array.isArray(task.pendingObservations)) throw new Error('invalid-task-state');
      for (const pending of task.pendingObservations) {
        if (!plainObject(pending) || !/^pre-v4-[a-f0-9]{64}\.json$/.test(String(pending.id || '')) ||
            (pending.receipt && !/^exec-v4-[a-f0-9]{64}\.receipt$/.test(String(pending.receipt)))) {
          throw new Error('invalid-pending-observation');
        }
        names.add(pending.id);
        if (pending.receipt) names.add(pending.receipt);
      }
    } catch (_) {
      // A corrupt task cannot prove which pending snapshot or correlated
      // receipt is still required. Preserve all of them until exact repair.
      preserveEveryPendingArtifact = true;
    }
  }
  if (preserveEveryPendingArtifact) {
    for (const entry of entries) {
      if (/^(?:pre-v4-[a-f0-9]{64}\.json|exec-v4-[a-f0-9]{64}\.receipt)$/.test(entry.name)) names.add(entry.name);
    }
  }
  return names;
}

function pruneState(preserve = new Set()) {
  let entries;
  try { entries = fs.readdirSync(stateDir).map((name) => ({ name, file: path.join(stateDir, name), stat: fs.statSync(path.join(stateDir, name)) })); }
  catch (_) { return; }
  const now = Date.now();
  const retentionMs = 7 * 24 * 3600 * 1000;
  const ledgerReferences = protectedLedgerNames(entries);
  const pendingReferences = protectedPendingNames(entries);
  const protectedState = /^(?:task(?:-genesis)?|association|association-debt|mechanical|evidence)-v4-/;
  const activeSnapshot = (entry) => entry.name.startsWith('pre-v4-') && now - entry.stat.mtimeMs < 3600 * 1000;
  const activeReceipt = (entry) => entry.name.startsWith('exec-v4-') && now - entry.stat.mtimeMs < 3600 * 1000;
  for (const entry of entries) {
    if (!preserve.has(entry.name) && !ledgerReferences.has(entry.name) && !pendingReferences.has(entry.name) &&
        !protectedState.test(entry.name) && !activeSnapshot(entry) && !activeReceipt(entry) &&
        entry.stat.isFile() && now - entry.stat.mtimeMs > retentionMs) {
      try { fs.unlinkSync(entry.file); } catch (_) { /* concurrent cleanup */ }
    }
  }
  try { entries = fs.readdirSync(stateDir).map((name) => ({ name, file: path.join(stateDir, name), stat: fs.statSync(path.join(stateDir, name)) })); }
  catch (_) { return; }
  const budgetLedgerReferences = protectedLedgerNames(entries);
  const budgetPendingReferences = protectedPendingNames(entries);
  let total = entries.reduce((sum, entry) => sum + (entry.stat.isFile() ? entry.stat.size : 0), 0);
  const maximum = 5 * 1024 * 1024;
  for (const entry of entries.filter((item) => item.stat.isFile() && !preserve.has(item.name) &&
      !budgetLedgerReferences.has(item.name) && !budgetPendingReferences.has(item.name) && !protectedState.test(item.name) &&
      !activeSnapshot(item) && !activeReceipt(item)).sort((a, b) => a.stat.mtimeMs - b.stat.mtimeMs)) {
    if (total <= maximum) break;
    try { fs.unlinkSync(entry.file); total -= entry.stat.size; } catch (_) { /* concurrent cleanup */ }
  }
}

function editedPaths(input, found = new Set()) {
  if (!input || typeof input !== 'object') return [...found];
  for (const [key, child] of Object.entries(input)) {
    if (/^(?:file_path|path|notebook_path|notebookPath)$/.test(key) && typeof child === 'string') found.add(child);
    if (key === 'command' && typeof child === 'string') {
      const pattern = /^\*{0,3}\s*(?:Add|Update|Delete) File:\s*(.+?)\s*$/gim;
      for (const match of child.matchAll(pattern)) found.add(match[1]);
    } else if (child && typeof child === 'object') editedPaths(child, found);
  }
  return [...found];
}

function changedPaths(value, found = new Set()) {
  if (!value || typeof value !== 'object') return [...found];
  for (const [key, child] of Object.entries(value)) {
    if (/^(?:changed_files|changedFiles|generated_files|generatedFiles|files_written|filesWritten)$/.test(key) && Array.isArray(child)) {
      child.forEach((item) => { if (typeof item === 'string') found.add(item); });
    } else if (child && typeof child === 'object') changedPaths(child, found);
  }
  return [...found];
}

function canonicalPath(pathValue, cwd = '') {
  let normalized = String(pathValue).replace(/\\/g, '/');
  if (cwd) normalized = path.resolve(cwd, normalized).replace(/\\/g, '/');
  normalized = path.posix.normalize(normalized);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function artifact(pathValue, cwd = '') {
  const normalized = canonicalPath(pathValue, cwd);
  const suffix = path.posix.extname(normalized).toLowerCase();
  const extension = /\.(?:png|jpe?g|gif|webp|avif|ico|bmp|tiff?)$/.test(suffix) ? 'image' :
    /\.(?:svg)$/.test(suffix) ? 'vector' :
    /\.(?:woff2?|ttf|otf|eot)$/.test(suffix) ? 'font' :
    /\.(?:pdf|docx?|xlsx?|pptx?|odt|ods|odp)$/.test(suffix) ? 'document' :
    /\.(?:zip|tar|gz|tgz|bz2|xz|7z)$/.test(suffix) ? 'archive' :
    /\.(?:exe|dll|so|dylib|wasm|bin)$/.test(suffix) ? 'binary' :
    /\.(?:md|mdx|txt|rst)$/.test(suffix) ? 'docs' :
    /\.(?:json|ya?ml|toml|xml|ini|cfg|conf|lock)$/.test(suffix) ? 'config' :
    /\.(?:html?|css|scss|vue|svelte)$/.test(suffix) ? 'ui' :
    /\.(?:js|jsx|mjs|cjs|ts|tsx|py|ps1|sh|bash|rs|go|c|cc|cpp|h|hpp|java|rb|php|swift|kt|cs|sql)$/.test(suffix) ? 'source' :
    suffix ? 'other' : 'none';
  const type = ['image', 'vector', 'font', 'document', 'archive', 'binary', 'docs', 'config', 'ui', 'source'].includes(extension) ? extension : 'other';
  return { id: hash(normalized).slice(0, 16), extension, type };
}

function recordEdit(session, turn, task, kind, value, cwd = '') {
  const item = artifact(value, cwd);
  return recordArtifact(session, turn, task, kind, item);
}

function recordArtifact(session, turn, task, kind, item) {
  if (!task.dirtyEdits.includes(item.id)) task.dirtyEdits.push(item.id);
  const written = append(session, turn, `${kind} artifact:${item.type} ext:${item.extension} edit:${item.id}`);
  if (written) rememberLedger(task, session, turn);
  return written;
}

function gitResult(cwd, args, deadline = Date.now() + 8000) {
  const remaining = deadline - Date.now();
  if (remaining < 50) return { ok: false, reason: 'git-timeout' };
  const result = spawnSync('git', ['-c', 'core.fsmonitor=false', ...args], {
    cwd, encoding: 'buffer', timeout: Math.min(2500, remaining), maxBuffer: 8 * 1024 * 1024, windowsHide: true,
  });
  if (result.error) {
    const reason = result.error.code === 'ETIMEDOUT' ? 'git-timeout' :
      result.error.code === 'ENOBUFS' ? 'output-limit' : 'git-unavailable';
    return { ok: false, reason, status: result.status };
  }
  return { ok: result.status === 0, reason: result.status === 0 ? '' : 'git-command-failed', status: result.status, stdout: result.stdout };
}

function tailAfterSpaces(value, count) {
  let offset = -1;
  for (let found = 0; found < count; found++) {
    offset = value.indexOf(' ', offset + 1);
    if (offset < 0) return '';
  }
  return value.slice(offset + 1);
}

function statusPaths(output, deadline = Number.POSITIVE_INFINITY) {
  const records = output.toString('utf8').split('\0');
  const paths = [];
  for (let index = 0; index < records.length; index++) {
    if ((index & 255) === 0 && Date.now() >= deadline) throw snapshotError('git-timeout');
    const record = records[index];
    if (!record) continue;
    if (record.startsWith('? ')) paths.push({ name: record.slice(2), status: '?' });
    else if (record.startsWith('1 ')) paths.push({ name: tailAfterSpaces(record, 8), status: record.slice(2, 4) });
    else if (record.startsWith('2 ')) {
      paths.push({ name: tailAfterSpaces(record, 9), status: record.slice(2, 4) });
      if (records[index + 1]) paths.push({ name: records[++index], status: 'renamed-from' });
    } else if (record.startsWith('u ')) paths.push({ name: tailAfterSpaces(record, 10), status: 'unmerged' });
  }
  return paths.filter((item) => item.name);
}

function indexPaths(output, deadline = Number.POSITIVE_INFINITY) {
  const paths = new Map();
  let index = 0;
  for (const record of output.toString('utf8').split('\0')) {
    if ((index++ & 255) === 0 && Date.now() >= deadline) throw snapshotError('git-timeout');
    if (!record) continue;
    const separator = record.indexOf('\t');
    if (separator < 0) continue;
    const fields = record.slice(0, separator).split(' ');
    if (fields.length < 4) continue;
    const [tag, mode, , stage] = fields;
    const name = record.slice(separator + 1);
    if (!name) continue;
    const existing = paths.get(name) || { hidden: false, gitlink: false };
    const assumeUnchanged = /^[a-z]$/.test(tag);
    existing.hidden = existing.hidden || tag === 'S' || assumeUnchanged;
    existing.gitlink = existing.gitlink || mode === '160000';
    if (stage === '0' || !paths.has(name)) paths.set(name, existing);
  }
  return paths;
}

function snapshotError(reason) {
  const error = new Error('repository-observation-failed');
  error.snapshotReason = safeReason(reason);
  return error;
}

function fingerprintPath(root, item, budget, deadline, depth) {
  const artifactItem = artifact(item.name, root);
  const absolute = path.resolve(root, item.name);
  let kind = 'missing';
  let mode = 0;
  let contentHash = 'missing';
  try {
    if (Date.now() >= deadline) throw snapshotError('git-timeout');
    const stat = fs.lstatSync(absolute);
    mode = stat.mode & 0o7777;
    if (stat.isSymbolicLink()) {
      kind = 'symlink';
      contentHash = hash(fs.readlinkSync(absolute));
    } else if (stat.isFile()) {
      if (item.status === 'tracked' || item.status === 'hidden-index' || item.tracked === true) {
        // Clean filters can hide real worktree-byte changes from Git's status and
        // index. Persist privacy-bounded metadata for every clean tracked path so
        // ordinary filter-normalized writes still change the paired snapshot.
        kind = 'tracked-file';
        contentHash = hash(stat.size, stat.mtimeMs, stat.ctimeMs);
      } else {
        kind = 'file';
        if (stat.size > 16 * 1024 * 1024 || budget.total + stat.size > 64 * 1024 * 1024) throw new Error('content-limit');
        budget.total += stat.size;
        contentHash = crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex');
      }
    } else if (item.gitlink && stat.isDirectory()) {
      if (depth >= MAX_SUBMODULE_DEPTH) throw snapshotError('path-limit');
      const nested = worktreeSnapshot(absolute, deadline, budget, depth + 1);
      if (!nested.available) throw snapshotError(nested.reason);
      kind = 'submodule';
      contentHash = hash(JSON.stringify(nested));
    } else if (stat.isDirectory()) {
      kind = 'directory';
      contentHash = 'directory';
    } else {
      kind = 'special';
      contentHash = hash(stat.size, stat.mtimeMs);
    }
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      kind = 'missing';
    } else {
      throw error;
    }
  }
  if (Date.now() >= deadline) throw snapshotError('git-timeout');
  return {
    id: artifactItem.id, extension: artifactItem.extension, type: artifactItem.type,
    stateHash: hash(item.status, kind, mode, contentHash).slice(0, 32),
  };
}

function worktreeSnapshot(cwd, deadline = Date.now() + SNAPSHOT_BUDGET_MS, budget = { total: 0 }, depth = 0) {
  try {
    const rootResult = gitResult(cwd, ['rev-parse', '--show-toplevel'], deadline);
    if (!rootResult.ok) return { available: false, reason: 'not-git' };
    const root = rootResult.stdout.toString('utf8').trim();
    const symbolic = gitResult(root, ['symbolic-ref', '-q', 'HEAD'], deadline);
    const headResult = gitResult(root, ['rev-parse', '--verify', 'HEAD'], deadline);
    let headState;
    let head = '';
    let headTree = '';
    let refKind;
    let refHash;
    if (headResult.ok) {
      headState = 'born';
      head = headResult.stdout.toString('ascii').trim();
      const treeResult = gitResult(root, ['rev-parse', '--verify', 'HEAD^{tree}'], deadline);
      if (!treeResult.ok) return { available: false, reason: treeResult.reason || 'object-unavailable' };
      headTree = treeResult.stdout.toString('ascii').trim();
      refKind = symbolic.ok ? 'symbolic' : 'detached';
      refHash = hash(symbolic.ok ? symbolic.stdout.toString('utf8').trim() : 'detached');
    } else if (symbolic.ok) {
      headState = 'unborn';
      refKind = 'unborn';
      refHash = hash(symbolic.stdout.toString('utf8').trim());
    } else {
      return { available: false, reason: headResult.reason || 'object-unavailable' };
    }

    const indexTreeResult = gitResult(root, ['write-tree'], deadline);
    const indexResult = gitResult(root, ['ls-files', '--stage', '-v', '-z'], deadline);
    const statusResult = gitResult(root, ['status', '--porcelain=v2', '-z', '--untracked-files=all'], deadline);
    for (const result of [indexTreeResult, indexResult, statusResult]) {
      if (!result.ok) return { available: false, reason: result.reason || 'snapshot-unavailable' };
    }
    if (Date.now() >= deadline) return { available: false, reason: 'git-timeout' };
    const indexed = indexPaths(indexResult.stdout, deadline);
    const observedPaths = new Map();
    for (const item of statusPaths(statusResult.stdout, deadline)) {
      item.tracked = indexed.has(item.name);
      observedPaths.set(item.name, item);
    }
    for (const [name, metadata] of indexed) {
      if (Date.now() >= deadline) return { available: false, reason: 'git-timeout' };
      if (!observedPaths.has(name)) observedPaths.set(name, { name, status: metadata.hidden ? 'hidden-index' : 'tracked' });
    }
    if (observedPaths.size > 20000) {
      for (const [name, item] of observedPaths.entries()) {
        if (item.status === 'tracked' || item.status === 'hidden-index' || (typeof item.status === 'string' && item.status.includes('D'))) {
          observedPaths.delete(name);
        }
      }
      if (observedPaths.size > 20000) return { available: false, reason: 'path-limit' };
    }
    const entries = {};
    for (const item of observedPaths.values()) {
      item.gitlink = Boolean(indexed.get(item.name) && indexed.get(item.name).gitlink);
      const fingerprint = fingerprintPath(root, item, budget, deadline, depth);
      entries[fingerprint.id] = fingerprint;
    }
    if (Date.now() >= deadline) return { available: false, reason: 'git-timeout' };
    return {
      available: true,
      root: hash(canonicalPath(root)),
      headState, head, headTree, refKind, refHash,
      indexTree: indexTreeResult.stdout.toString('ascii').trim(),
      indexHash: hash(indexResult.stdout),
      statusHash: hash(statusResult.stdout),
      entries,
    };
  } catch (error) {
    const reason = error && error.snapshotReason || (error && error.message === 'content-limit' ? 'content-limit' : 'snapshot-error');
    return { available: false, reason: safeReason(reason) };
  }
}

function saveSnapshot(session, turn, toolUseId, snapshot) {
  try {
    ensureStateDir();
    const target = snapshotPath(session, turn, toolUseId);
    try {
      fs.writeFileSync(target, JSON.stringify(snapshot) + '\n', { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      try { fs.chmodSync(target, 0o600); } catch (_) { /* Windows inherits profile ACLs. */ }
      return true;
    } catch (error) {
      if (error && error.code === 'EEXIST') {
        try {
          JSON.parse(fs.readFileSync(target, 'utf8'));
          return true;
        } catch (_) {}
      }
      return false;
    }
  } catch (_) { return false; }
}

function takeSnapshot(session, turn, toolUseId, cwd, execution = null) {
  if (!toolUseId || !cwd) return false;
  const snapshot = worktreeSnapshot(cwd);
  if (snapshot.available) {
    snapshot.repoRootHash = registerRepository(repositoryBoundary(cwd));
  }
  if (execution && execution.nonce) {
    snapshot.executionNonce = execution.nonce;
    snapshot.executionClass = execution.eventClass;
    snapshot.executionOrigin = execution.originHash || '';
    snapshot.mutatingCommand = execution.mutatingCommand === true;
  }
  return saveSnapshot(session, turn, toolUseId, snapshot);
}

function consumeSnapshot(session, turn, toolUseId) {
  if (!toolUseId) return null;
  const target = snapshotPath(session, turn, toolUseId);
  try {
    const snapshot = JSON.parse(fs.readFileSync(target, 'utf8'));
    try { fs.unlinkSync(target); } catch (_) { /* cleanup is best effort */ }
    return snapshot;
  } catch (_) { return null; }
}

function pendingObservationId(session, turn, toolUseId) {
  return path.basename(snapshotPath(session, turn, toolUseId));
}

function consumeSnapshotByName(name) {
  if (!/^pre-v4-[a-f0-9]{64}\.json$/.test(String(name || ''))) return null;
  const target = path.join(stateDir, name);
  try {
    const snapshot = JSON.parse(fs.readFileSync(target, 'utf8'));
    try { fs.unlinkSync(target); } catch (_) { /* cleanup is best effort */ }
    return snapshot;
  } catch (_) { return null; }
}

function reconcilePending(session, turn, cwd) {
  const pending = taskTransaction(session, () => {
    const task = loadGroundTask(session);
    // A missing PostToolUse can span retry, compaction, or resume. Restricting
    // recovery to the current turn silently strands the original observation.
    // Reconcile every pending snapshot; a different repository root fails safe
    // through worktreeChanges(root-changed) and becomes generated-change debt.
    return task.pendingObservations.filter(Boolean).map((item) => ({ ...item }));
  });
  if (pending === undefined || pending.length === 0) return pending;
  const deadline = Date.now() + postObservationBudgetMs();
  return pending.map((item) => {
    const before = consumeSnapshotByName(item.id);
    if (/^exec-v4-[a-f0-9]{64}\.receipt$/.test(String(item.receipt || ''))) {
      try { fs.unlinkSync(path.join(stateDir, item.receipt)); } catch (_) { /* absent receipt is expected after failed tools */ }
    }
    const targetCwd = before && (before.repoRootHash ? resolveRepository(before.repoRootHash) : before.repoRoot) || cwd;
    const after = targetCwd ? worktreeSnapshot(targetCwd, deadline) : { available: false, reason: 'missing-cwd' };
    return {
      id: item.id,
      eventClass: /^[RTB]$/.test(item.eventClass) ? item.eventClass : 'U',
      observed: worktreeChanges(before, after, targetCwd, deadline),
      root: after && after.root || hash(targetCwd),
    };
  });
}

function shellLiteral(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function powershellLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function wrapCommandWithReceipt(command, target, nonce) {
  if (process.platform !== 'win32') {
    return `(
${command}
)
__dev_rigor_code=$?
printf '%s:%s\\n' ${shellLiteral(nonce)} "$__dev_rigor_code" > ${shellLiteral(target)}
exit "$__dev_rigor_code"`;
  }
  return `$__devRigorCode = 1
try {
  $global:LASTEXITCODE = $null
  & {
${command}
  }
  $__devRigorOk = $?
  $__devRigorCode = if ($null -ne $LASTEXITCODE) { [int]$LASTEXITCODE } elseif ($__devRigorOk) { 0 } else { 1 }
} finally {
  [System.IO.File]::WriteAllText(${powershellLiteral(target)}, ${powershellLiteral(`${nonce}:`)} + [string]$__devRigorCode, [System.Text.UTF8Encoding]::new($false))
}
if ($__devRigorCode -ne 0) { exit $__devRigorCode }`;
}

function consumeExecutionReceipt(session, turn, toolUseId, expectedNonce) {
  if (!toolUseId || !expectedNonce) return null;
  const target = executionReceiptPath(session, turn, toolUseId);
  try {
    const value = fs.readFileSync(target, 'utf8').trim();
    try { fs.unlinkSync(target); } catch (_) { /* cleanup is best effort */ }
    const match = value.match(/^([a-f0-9]{32}):(-?\d{1,10})$/);
    if (!match || match[1] !== expectedNonce) return { expected: true, valid: false };
    const code = Number(match[2]);
    if (!Number.isSafeInteger(code)) return { expected: true, valid: false };
    return { expected: true, valid: true, code, fingerprint: hash(expectedNonce, code).slice(0, 16) };
  } catch (_) {
    return { expected: true, valid: false };
  }
}

function syntheticRepositoryArtifact(root, event) {
  return { id: hash('repository', root, event).slice(0, 16), extension: 'repository', type: 'repository' };
}

function diffTreePaths(cwd, beforeTree, afterTree, deadline) {
  if (beforeTree === afterTree) return { available: true, paths: [] };
  if (!/^[a-f0-9]{40,64}$/i.test(beforeTree) || !/^[a-f0-9]{40,64}$/i.test(afterTree)) {
    return { available: false, reason: 'object-unavailable' };
  }
  const result = gitResult(cwd, ['diff', '--no-renames', '--no-ext-diff', '--no-textconv', '--name-only', '-z', beforeTree, afterTree, '--'], deadline);
  if (!result.ok) return { available: false, reason: result.reason || 'object-unavailable' };
  if (Date.now() >= deadline) return { available: false, reason: 'git-timeout' };
  const paths = result.stdout.toString('utf8').split('\0').filter(Boolean);
  if (paths.length > 4000) return { available: false, reason: 'path-limit' };
  return { available: true, paths };
}

function validatePriorHead(cwd, snapshot, deadline) {
  if (snapshot.headState !== 'born') return { available: true };
  if (!/^[a-f0-9]{40,64}$/i.test(snapshot.head) || !/^[a-f0-9]{40,64}$/i.test(snapshot.headTree)) {
    return { available: false, reason: 'object-unavailable' };
  }
  const result = gitResult(cwd, ['rev-parse', '--verify', `${snapshot.head}^{tree}`], deadline);
  if (!result.ok || result.stdout.toString('ascii').trim() !== snapshot.headTree) {
    return { available: false, reason: 'object-unavailable' };
  }
  return { available: true };
}

function worktreeChanges(before, after, cwd, deadline = Date.now() + SNAPSHOT_BUDGET_MS) {
  if (!before) return { available: false, reason: 'snapshot-missing' };
  if (!before.available) return { available: false, reason: safeReason(before.reason) };
  if (!after || !after.available) return { available: false, reason: safeReason(after && after.reason) };
  if (before.root !== after.root) return { available: false, reason: 'root-changed' };
  const required = ['headState', 'refKind', 'refHash', 'indexTree', 'indexHash', 'statusHash'];
  if (required.some((key) => typeof before[key] !== 'string' || typeof after[key] !== 'string')) {
    return { available: false, reason: 'snapshot-invalid' };
  }
  const validation = validatePriorHead(cwd, before, deadline);
  if (!validation.available) return validation;

  const items = new Map();
  const ids = new Set([...Object.keys(before.entries || {}), ...Object.keys(after.entries || {})]);
  for (const id of ids) {
    if (Date.now() >= deadline) return { available: false, reason: 'git-timeout' };
    const prior = before.entries[id];
    const next = after.entries[id];
    if (!prior || !next || prior.stateHash !== next.stateHash) items.set(id, next || prior);
  }

  for (const [priorTree, nextTree] of [[before.headTree, after.headTree], [before.indexTree, after.indexTree]]) {
    if (!priorTree || !nextTree || priorTree === nextTree) continue;
    const diff = diffTreePaths(cwd, priorTree, nextTree, deadline);
    if (!diff.available) return diff;
    for (const changedPath of diff.paths) {
      if (Date.now() >= deadline) return { available: false, reason: 'git-timeout' };
      const item = artifact(changedPath, cwd);
      items.set(item.id, item);
    }
  }

  const repositoryChanged = ['headState', 'head', 'headTree', 'refKind', 'refHash', 'indexTree', 'indexHash']
    .some((key) => before[key] !== after[key]);
  const unexplainedStatusChange = before.statusHash !== after.statusHash && items.size === 0;
  if (repositoryChanged || unexplainedStatusChange) {
    const event = repositoryChanged ? 'identity' : 'worktree-state';
    const item = syntheticRepositoryArtifact(after.root, event);
    items.set(item.id, item);
  }
  return { available: true, items: [...items.values()], repositoryChanged };
}

function textValues(value, found = []) {
  if (typeof value === 'string') found.push(value);
  else if (value && typeof value === 'object') Object.values(value).forEach((child) => textValues(child, found));
  return found;
}

function explicitFailure(value) {
  if (!value || typeof value !== 'object') return false;
  if (value.is_error === true || value.error === true || value.failed === true ||
      value.success === false || value.ok === false || value.passed === false || value.executed === false) return true;
  if ((typeof value.error === 'string' && value.error.trim()) ||
      (value.error && typeof value.error === 'object')) return true;
  if (typeof value.status === 'string' &&
      /^(?:rejected|declined|blocked|cancelled|canceled|failed|failure|error|errored|aborted|timed[_ -]?out|timeout)$/i.test(value.status.trim())) return true;
  return Object.values(value).some((child) => explicitFailure(child));
}

function structuredResult(value, seen = { found: false, failed: false, passed: false }) {
  if (!value || typeof value !== 'object') return seen;
  for (const [key, child] of Object.entries(value)) {
    const isTest = /^(?:test_result|testResult|test_results|testResults)$/.test(key);
    const isBuild = /^(?:build_result|buildResult|build_results|buildResults)$/.test(key);
    if ((isTest || isBuild) && child && typeof child === 'object') {
      const numericPassed = Number.isFinite(child.passed) ? child.passed : null;
      if (Number.isFinite(child.failed)) {
        seen.found = true;
        if (child.failed > 0) seen.failed = true;
        else if (isBuild) seen.passed = true;
      }
      if (numericPassed !== null) {
        seen.found = true;
        if (numericPassed > 0) seen.passed = true;
      }
      if (typeof child.success === 'boolean') {
        seen.found = true;
        if (!child.success) seen.failed = true;
        else if (!isTest || numericPassed === null) seen.passed = true;
      }
      if (typeof child.passed === 'boolean') {
        seen.found = true;
        if (!child.passed) seen.failed = true;
        else seen.passed = true;
      }
    }
    structuredResult(child, seen);
  }
  return seen;
}

function processResult(value, seen = { zero: false }) {
  if (!value || typeof value !== 'object') return seen;
  for (const [key, child] of Object.entries(value)) {
    if (/^(?:exit_code|exitCode)$/.test(key) && Number.isInteger(child)) {
      if (child !== 0) seen.nonzero = true;
      else seen.zero = true;
    } else if (child && typeof child === 'object') processResult(child, seen);
  }
  return seen;
}

function explicitSuccess(value) {
  if (!value || typeof value !== 'object') return false;
  if (value.success === true || value.ok === true || value.passed === true) return true;
  return typeof value.status === 'string' && /^(?:ok|passed|success|succeeded|successful)$/i.test(value.status.trim());
}

function zeroTestsExecuted(text) {
  return /1\.\.0|\btests\s+0\b|\b0\s+tests\b|\b0\s+passed\b|\bcollected\s+0\s+items\b|\bno\s+tests\s+ran\b|\b0\s+spec(?:s|ifications)?\b/i.test(text);
}

function executionPassed(response, receipt = null, eventClass = '') {
  if (receipt && receipt.expected && !receipt.valid) return false;
  if (explicitFailure(response)) return false;
  const structured = structuredResult(response);
  if (structured.found) return structured.passed && !structured.failed;
  const text = textValues(response).join('\n');
  if (eventClass === 'T' && zeroTestsExecuted(text)) return false;
  const process = processResult(response);
  if (process.nonzero || (receipt && receipt.valid && receipt.code !== 0)) return false;
  if (process.zero || (receipt && receipt.valid && receipt.code === 0)) {
    if (eventClass === 'T' && (
      /\b0\s+(?:tests?\s+)?passed\b/i.test(text) ||
      /\b[1-9]\d*\s+(?:tests?\s+)?failed\b/i.test(text)
    )) {
      return false;
    }
    return true;
  }
  if (explicitSuccess(response)) return true;
  if (/(?:exit(?:ed)?(?:\s+with)?(?:\s+code)?|status)\s*[:=]?\s*[1-9]\d*/i.test(text) ||
      /(?:^|\n)\s*(?:error|failure|failed|rejected|declined|cancelled)(?:\s*[:=]|\s*$)/im.test(text) ||
      /(?:^|\n)\s*(?:(?:execution|command|tool call)\s+)?(?:was\s+)?(?:rejected|blocked)\s+by\s+(?:policy|the user)\b/im.test(text) ||
      /(?:^|\n)[^\r\n]{0,240}\brejected:\s*blocked by policy\b/im.test(text) ||
      /\b0\s+(?:tests?\s+)?passed\b/i.test(text) ||
      /\b[1-9]\d*\s+(?:tests?\s+)?failed\b/i.test(text)) return false;
  return /(?:exit(?:ed)?(?:\s+with)?(?:\s+code)?|status)\s*[:=]?\s*0\b/i.test(text) ||
    /\b[1-9]\d*\s+(?:tests?\s+)?passed\b/i.test(text) ||
    /\b(?:all\s+pass|build\s+successful|tests?\s+(?:passed|succeeded|successful))\b/i.test(text);
}

function executionFingerprint(payload, receipt = null, executionOrigin = '') {
  return hash(
    payload.tool_name || '',
    payload.tool_use_id || '',
    JSON.stringify(payload.tool_input || {}),
    JSON.stringify(payload.tool_response || {}),
    receipt && receipt.valid ? receipt.fingerprint : '',
    executionOrigin
  ).slice(0, 16);
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function semanticOperation(executable, args, eventClass) {
  const lowered = args.map((value) => String(value).toLowerCase());
  if (['npm', 'pnpm', 'yarn'].includes(executable)) return `package-${eventClass === 'T' ? 'test' : eventClass === 'B' ? 'build' : 'run'}`;
  if (executable === 'node') return lowered[0] === '--test' ? 'node-test' : 'node-script';
  if (['python', 'python3', 'py'].includes(executable)) return lowered[0] === '-m' && lowered[1] === 'pytest' ? 'pytest' : 'python-script';
  if (['pytest', 'jest', 'vitest'].includes(executable)) return `${executable}-test`;
  if (executable === 'playwright') return 'playwright-test';
  if (['cargo', 'go', 'dotnet', 'mvn', 'mvnw', 'gradle', 'gradlew'].includes(executable)) {
    return `${executable}-${lowered[0] || (eventClass === 'T' ? 'test' : eventClass === 'B' ? 'build' : 'run')}`;
  }
  if (executable === 'tsc') return 'typescript-build';
  return eventClass === 'T' ? 'test' : eventClass === 'B' ? 'build' : 'run';
}

function resultSource(response, receipt) {
  const structured = structuredResult(response);
  if (structured.found) return 'structured-result';
  const process = processResult(response);
  if (receipt && receipt.valid) return process.zero || process.nonzero ? 'process-and-receipt' : 'correlated-receipt';
  if (process.zero || process.nonzero) return 'process-status';
  if (explicitSuccess(response)) return 'explicit-tool-result';
  return 'bounded-text-result';
}

function executionDescriptor(payload, eventClass, receipt, executionOrigin) {
  const tool = String(payload.tool_name || '');
  const input = payload.tool_input && typeof payload.tool_input === 'object' ? payload.tool_input : {};
  const command = typeof input.command === 'string' ? input.command : '';
  const tokens = parseSimpleCommand(command) || [];
  const executable = tokens.length ? executableName(tokens[0]) : 'interaction';
  const args = tokens.slice(1);
  const target = args.find((value) => !String(value).startsWith('-')) || '';
  const action = interactionAction(tool, input)
    ? [String(input.action || input.operation || '').toLowerCase(), ...tool.toLowerCase().split(/__|[.:/]/)].find((value) => INTERACTION_ACTIONS.has(value)) || 'interaction'
    : '';
  return {
    toolFamily: SHELL_TOOLS.test(tool) ? 'shell' : 'interaction',
    executable: SHELL_TOOLS.test(tool) ? executable : 'interaction',
    operation: SHELL_TOOLS.test(tool) ? semanticOperation(executable, args, eventClass) : `ui-${action}`,
    targetHash: target ? hash(target).slice(0, 16) : '',
    targetExtension: target ? path.extname(target).toLowerCase().replace(/[^a-z0-9.]/g, '').slice(0, 12) : '',
    commandHash: hash(command).slice(0, 16),
    originHash: executionOrigin || '',
    resultSource: resultSource(payload.tool_response, receipt),
    receiptHash: receipt && receipt.valid ? receipt.fingerprint : '',
    responseHash: hash(stableStringify(payload.tool_response || null)).slice(0, 16),
  };
}

function writeEvidenceRecord(record) {
  const target = evidencePath(record.proofId);
  const encoded = stableStringify(record) + '\n';
  try {
    fs.writeFileSync(target, encoded, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    try { fs.chmodSync(target, 0o600); } catch (_) { /* Windows inherits profile ACLs. */ }
    return true;
  } catch (error) {
    if (!error || error.code !== 'EEXIST') return false;
    try { return stableStringify(JSON.parse(fs.readFileSync(target, 'utf8'))) + '\n' === encoded; }
    catch (_) { return false; }
  }
}

function parseSimpleCommand(command) {
  if (typeof command !== 'string' || !command.trim()) return null;
  if (/[;&|><`\r\n]/.test(command) || /\$\(|\$\{|%[^%\r\n]+%/.test(command)) return null;
  const tokens = [];
  let token = '';
  let quote = '';
  for (let index = 0; index < command.length; index++) {
    const character = command[index];
    if (quote) {
      if (character === quote) quote = '';
      else if (character === '\\' && quote === '"' && command[index + 1] === '"') token += command[++index];
      else token += character;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (/\s/.test(character)) {
      if (token) { tokens.push(token); token = ''; }
    } else {
      token += character;
    }
  }
  if (quote) return null;
  if (token) tokens.push(token);
  return tokens.length ? tokens : null;
}

function executableName(value) {
  const normalized = String(value).replace(/\\/g, '/');
  return normalized.slice(normalized.lastIndexOf('/') + 1).replace(/\.(?:exe|cmd|bat|com)$/i, '').toLowerCase();
}

function repositoryBoundary(cwd) {
  let current = path.resolve(cwd || process.cwd());
  while (true) {
    if (fs.existsSync(path.join(current, '.git'))) break;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(cwd || process.cwd());
    current = parent;
  }
  try { return fs.realpathSync.native(current); } catch (_) { return current; }
}

function pathInside(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function resolveExecutablePath(token, cwd) {
  if (!token || /[\\/]/.test(token) || /^[a-z]:/i.test(token)) return '';
  const pathEntries = String(process.env.PATH || '').split(path.delimiter);
  const hasExtension = process.platform === 'win32' && /\.[a-z0-9]+$/i.test(token);
  const extensions = process.platform === 'win32'
    ? (hasExtension ? [''] : String(process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';'))
    : [''];
  for (const rawEntry of pathEntries) {
    const entry = rawEntry.replace(/^"|"$/g, '') || cwd;
    for (const extension of extensions) {
      const candidate = path.resolve(entry, `${token}${extension}`);
      try {
        if (!fs.statSync(candidate).isFile()) continue;
        if (process.platform !== 'win32') fs.accessSync(candidate, fs.constants.X_OK);
        return fs.realpathSync.native(candidate);
      } catch (_) { /* try the next PATH candidate */ }
    }
  }
  return '';
}

function executableOriginHash(command, cwd) {
  const tokens = parseSimpleCommand(command);
  if (!tokens || !cwd) return '';
  const resolved = resolveExecutablePath(tokens[0], cwd);
  if (!resolved || pathInside(resolved, repositoryBoundary(cwd))) return '';
  try {
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) return '';
    const fd = fs.openSync(resolved, 'r');
    const buffer = Buffer.alloc(Math.min(65536, stat.size));
    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
    fs.closeSync(fd);
    return hash(canonicalPath(resolved), stat.size, buffer.subarray(0, bytesRead)).slice(0, 16);
  } catch (_) {
    return '';
  }
}

function informationOnly(executable, args) {
  const lowered = args.map((value) => value.toLowerCase());
  const universal = new Set([
    '--help', '-h', '--version', '--list', '--list-tests', '--listtests', '--collect-only', '--co',
    '--setup-only', '--setup-show', '--fixtures', '--fixtures-per-test', '--markers', '--trace-config',
    '--showconfig', '--dry-run', '--no-run', '--passwithnotests', '--if-present', '--ifpresent',
  ]);
  if (lowered.some((value) => universal.has(value))) return true;
  if (['node', 'python', 'python3', 'py', 'ruby', 'php', 'java', 'tsc'].includes(executable) &&
      lowered.some((value) => value === '-v' || value === '-version')) return true;
  if (executable === 'node' && lowered.some((value) => ['-e', '--eval', '-p', '--print', '-c', '--check'].includes(value))) return true;
  if (['python', 'python3', 'py'].includes(executable) && lowered.includes('-c')) return true;
  return false;
}

function packageScriptClass(args) {
  const first = String(args[0] || '').toLowerCase();
  const script = first === 'run' || first === 'run-script' ? String(args[1] || '').toLowerCase() : first;
  if (/^test(?::[a-z0-9_.-]+)?$/.test(script)) return 'T';
  if (/^build(?::[a-z0-9_.-]+)?$/.test(script)) return 'B';
  if (/^(?:start|dev|preview|render|smoke|e2e)(?::[a-z0-9_.-]+)?$/.test(script)) return 'R';
  return 'U';
}

function isNativeBinary(filePath) {
  if (/\.(?:cmd|bat|ps1|lnk|vbs|js|wsf|sh|bash)$/i.test(filePath)) return false;
  try {
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(4);
    const bytesRead = fs.readSync(fd, buffer, 0, 4, 0);
    fs.closeSync(fd);
    if (bytesRead < 2) return false;
    if (buffer[0] === 0x4d && buffer[1] === 0x5a) return true;
    if (bytesRead >= 4 && buffer[0] === 0x7f && buffer[1] === 0x45 && buffer[2] === 0x4c && buffer[3] === 0x46) return true;
    if (bytesRead >= 4 && (
      (buffer[0] === 0xca && buffer[1] === 0xfe && buffer[2] === 0xba && buffer[3] === 0xbe) ||
      (buffer[0] === 0xfe && buffer[1] === 0xed && buffer[2] === 0xfa && buffer[3] === 0xce) ||
      (buffer[0] === 0xfe && buffer[1] === 0xed && buffer[2] === 0xfa && buffer[3] === 0xcf) ||
      (buffer[0] === 0xcf && buffer[1] === 0xfa && buffer[2] === 0xed && buffer[3] === 0xfe)
    )) return true;
    return false;
  } catch (_) {
    return false;
  }
}

function shellCommandClass(command, cwd = '') {
  if (INSPECTION_COMMAND.test(command)) return 'I';
  const tokens = parseSimpleCommand(command);
  if (!tokens) return 'U';
  if (/[\\/]/.test(tokens[0]) || /^[a-z]:/i.test(tokens[0])) return 'U';
  if (!executableOriginHash(command, cwd)) return 'U';
  const executable = executableName(tokens[0]);
  if (['node', 'python', 'python3', 'py'].includes(executable)) {
    const resolved = resolveExecutablePath(tokens[0], cwd);
    if (!resolved || !isNativeBinary(resolved)) return 'U';
  }
  const args = tokens.slice(1);
  const lowered = args.map((value) => value.toLowerCase());
  if (informationOnly(executable, args)) return 'U';

  if (['npm', 'pnpm', 'yarn'].includes(executable)) return packageScriptClass(args);
  if (executable === 'node') {
    if (lowered[0] === '--test') return 'T';
    return /\.(?:c?js|mjs|ts)$/i.test(args[0] || '') ? 'R' : 'U';
  }
  if (['python', 'python3', 'py'].includes(executable)) {
    if (lowered[0] === '-m' && lowered[1] === 'pytest') return 'T';
    return /\.py$/i.test(args[0] || '') ? 'R' : 'U';
  }
  if (['pytest', 'jest', 'vitest'].includes(executable)) return 'T';
  if (executable === 'playwright') return lowered[0] === 'test' ? 'T' : 'U';
  if (executable === 'cargo') return lowered[0] === 'test' ? 'T' :
    ['build', 'check'].includes(lowered[0]) ? 'B' : lowered[0] === 'run' ? 'R' : 'U';
  if (executable === 'go') return lowered[0] === 'test' ? 'T' :
    lowered[0] === 'build' ? 'B' : lowered[0] === 'run' ? 'R' : 'U';
  if (executable === 'dotnet') return lowered[0] === 'test' ? 'T' :
    lowered[0] === 'build' ? 'B' : lowered[0] === 'run' ? 'R' : 'U';
  if (['mvn', 'mvnw'].includes(executable)) return lowered.includes('test') ? 'T' :
    lowered.some((value) => value === 'package' || value === 'verify') ? 'B' : 'U';
  if (['gradle', 'gradlew'].includes(executable)) return lowered.some((value) => value === 'test' || value.endsWith(':test')) ? 'T' :
    lowered.some((value) => value === 'build' || value.endsWith(':build')) ? 'B' : 'U';
  if (executable === 'tsc') return 'B';
  return 'U';
}

function interactionAction(tool, input) {
  const toolSegments = String(tool).toLowerCase().split(/__|[.:/]/).filter(Boolean);
  if (!toolSegments.some((segment) => INTERACTION_FAMILIES.has(segment))) return false;
  const candidates = [toolSegments[toolSegments.length - 1]];
  if (input && typeof input === 'object') {
    for (const key of ['action', 'operation']) if (typeof input[key] === 'string') candidates.push(input[key].toLowerCase());
  }
  return candidates.some((candidate) => INTERACTION_ACTIONS.has(candidate));
}

function commandClass(tool, input, cwd = '') {
  const command = input && typeof input.command === 'string' ? input.command : '';
  if (SHELL_TOOLS.test(tool)) return shellCommandClass(command, cwd);
  return interactionAction(tool, input) ? 'R' : 'U';
}

function editSetHash(edits) {
  return hash(...[...new Set(edits)].sort()).slice(0, 16);
}

function proofToken(task, session, turn, eventClass, edits, executionHash, descriptorHash, checkpoint) {
  const canonical = JSON.stringify({
    task: hash(session), turn: hash(turn), eventClass, edits: [...edits].sort(),
    executionHash, descriptorHash, checkpoint, result: 'pass',
  });
  return crypto.createHmac('sha256', task.salt).update(canonical).digest('hex').slice(0, 16);
}

function parseProofEvent(line) {
  const match = String(line || '').match(/^([RTB]) proof-id:([a-f0-9]{16}) edit-set:([a-f0-9]{16}) exec:([a-f0-9]{16}) descriptor:([a-f0-9]{16}) checkpoint:([1-9]\d*) result:pass$/);
  if (!match) return null;
  return {
    eventClass: match[1], token: match[2], editSetHash: match[3], executionHash: match[4],
    descriptorHash: match[5], checkpoint: Number(match[6]),
  };
}

function validEvidenceRecord(proof, session, turn) {
  if (!proof || !/^[a-f0-9]{16}$/.test(proof.descriptorHash || '') ||
      proof.evidence !== `evidence-v4-${proof.token}.json`) return false;
  let record;
  try { record = JSON.parse(fs.readFileSync(evidencePath(proof.token), 'utf8')); }
  catch (_) { return false; }
  if (!plainObject(record) || !plainObject(record.descriptor) || record.version !== 4 ||
      record.taskKey !== hash(session) || record.turnHash !== hash(turn) || record.proofId !== proof.token ||
      record.eventClass !== proof.eventClass || record.editSetHash !== proof.editSetHash ||
      record.executionHash !== proof.executionHash || record.descriptorHash !== proof.descriptorHash ||
      record.checkpoint !== proof.checkpoint || record.result !== 'pass' ||
      !Array.isArray(record.edits) || stableStringify(record.edits) !== stableStringify([...proof.edits].sort()) ||
      hash(stableStringify(record.descriptor)).slice(0, 16) !== proof.descriptorHash) return false;
  const expectedKeys = ['checkpoint', 'descriptor', 'descriptorHash', 'editSetHash', 'edits', 'eventClass',
    'executionHash', 'proofId', 'result', 'taskKey', 'turnHash', 'version'];
  const descriptorKeys = ['commandHash', 'executable', 'operation', 'originHash', 'receiptHash',
    'responseHash', 'resultSource', 'targetExtension', 'targetHash', 'toolFamily'];
  return Object.keys(record).sort().join(',') === expectedKeys.sort().join(',') &&
    Object.keys(record.descriptor).sort().join(',') === descriptorKeys.sort().join(',');
}

function validProofEvent(task, proof, line, session, turn) {
  const event = parseProofEvent(line);
  if (!event || !proof || !Array.isArray(proof.edits) || proof.edits.length === 0) return false;
  if (proof.turn !== hash(turn) || proof.eventClass !== event.eventClass || proof.token !== event.token) return false;
  if (proof.editSetHash !== event.editSetHash || proof.executionHash !== event.executionHash ||
      proof.descriptorHash !== event.descriptorHash || proof.checkpoint !== event.checkpoint) return false;
  if (proof.editSetHash !== editSetHash(proof.edits) || proof.checkpoint !== task.checkpoint + 1) return false;
  if (proof.ledger !== path.basename(ledgerPath(session, turn))) return false;
  if (!task.dirtyEdits.every((edit) => proof.edits.includes(edit))) return false;
  return validEvidenceRecord(proof, session, turn) && proof.token === proofToken(
    task, session, turn, proof.eventClass, proof.edits, proof.executionHash, proof.descriptorHash, proof.checkpoint
  );
}

function addDebt(task, session, turn) {
  const set = editSetHash(task.dirtyEdits);
  const ledger = rememberLedger(task, session, turn);
  if (!task.unresolved.some((item) => item.editSetHash === set)) {
    task.unresolved.push({ id: hash(session, turn, set).slice(0, 16), editSetHash: set, edits: [...task.dirtyEdits], ledger, status: 'unresolved' });
  }
}

function acceptProof(task, proof, session) {
  const accepted = new Set(proof.edits);
  task.dirtyEdits = task.dirtyEdits.filter((edit) => !accepted.has(edit));
  task.unresolved = task.unresolved.filter((debt) =>
    !Array.isArray(debt.edits) || !debt.edits.every((edit) => accepted.has(edit))
  );
  task.checkpoint = Math.max(task.checkpoint, proof.checkpoint || task.checkpoint + 1);
  task.checkpointLedger = proof.ledger || '';
  task.ledgerRefs = [...new Set([
    task.checkpointLedger,
    ...task.unresolved.map((debt) => debt && debt.ledger),
  ].filter((name) => /^ground-v4-[a-f0-9]{64}\.log$/.test(String(name || ''))))];
  for (const debt of task.mechanical) {
    if (debt.status !== 'unresolved' || !Array.isArray(debt.edits) || !debt.edits.every((edit) => accepted.has(edit))) continue;
    debt.status = 'resolved';
    try { fs.appendFileSync(mechanicalPath(session), `C ${debt.id}\n`, { encoding: 'utf8', mode: 0o600 }); } catch (_) { /* task state still records resolution */ }
  }
}

function block(reason) {
  setHookOutput({ decision: 'block', reason });
}

function queueNotice(task, id, message) {
  const existing = task.notices.find((notice) => notice.id === id);
  if (!existing) task.notices.push({ id, message, delivered: false });
  const pending = task.notices.filter((notice) => notice && notice.delivered !== true);
  const delivered = task.notices.filter((notice) => notice && notice.delivered === true).slice(-32);
  task.notices = [...pending, ...delivered];
  return !existing || existing.delivered !== true;
}

function surfaceWarning(session, task, id, message) {
  const shouldSurface = queueNotice(task, id, message);
  saveTask(session, task);
  if (shouldSurface) queueHookSystemMessage(message, session, id);
}

function surfaceLedgerFailure(session, turn, task, stage) {
  addDebt(task, session, turn);
  const debtId = markMechanicalDebt(session, 'ledger-write-failed', task);
  const label = stage === 'K' ? 'substantive block' : stage === 'U' ? 'circuit release' : 'proof checkpoint';
  surfaceWarning(
    session, task, `ledger-${stage.toLowerCase()}-failed:${debtId || hash(session, turn, stage).slice(0, 16)}`,
    `Dev Rigor warning: the ${label} could not persist to the evidence ledger. The conversation remains usable, but proof and mechanical debt${debtId ? ` ${debtId}` : ''} remain release-blocking.`
  );
}

function surfaceEvidenceMismatch(session, turn, task) {
  addDebt(task, session, turn);
  const debtId = markMechanicalDebt(session, 'evidence-mismatch', task);
  surfaceWarning(
    session, task, `evidence-mismatch:${debtId || hash(session, turn, 'evidence-mismatch').slice(0, 16)}`,
    `Dev Rigor warning: the proof event does not match this exact task turn, edit set, execution, or checkpoint. It was not accepted; proof and mechanical debt${debtId ? ` ${debtId}` : ''} remain release-blocking.`
  );
}

function failOpenWarning(session, reason) {
  markMechanicalDebt(session, reason);
  const code = /^(?:task-lock-timeout|task-state-corrupt|task-state-missing|snapshot-unavailable)$/.test(reason) ? reason : 'task-state-write';
  queueHookSystemMessage(`Dev Rigor warning: mechanical enforcement failed open (${code}). The conversation remains usable, but release-blocking mechanical debt was recorded.`);
}

function taskTransaction(session, callback) {
  try { return withTaskLock(session, callback); }
  catch (error) {
    failOpenWarning(session, error && error.message || 'task-state-write');
    return undefined;
  }
}

function main() {
  const hookMode = process.argv[2];
  let payload;
  try { payload = JSON.parse(fs.readFileSync(0, 'utf8')); } catch (_) { return; }
  const session = identity(payload.session_id);
  const turn = identity(payload.turn_id);
  if (!session) return;
  if (!turn) {
    taskTransaction(session, () => {
      const task = loadGroundTask(session);
      task.warnings = task.warnings || {};
      task.warnings.mechanicalUnavailable = { reason: 'missing-turn-id', delivered: false };
      saveTask(session, task);
    });
    pruneState(new Set([path.basename(taskPath(session))]));
    return;
  }

  if (hookMode === 'snapshot') {
    const mode = taskTransaction(session, () => {
      const task = loadGroundTask(session);
      task.delivery.preToolUse++;
      saveTask(session, task);
      return effectiveMode(task);
    });
    if (mode === undefined || mode === 'OFF' || EDIT_TOOLS.test(String(payload.tool_name || ''))) return;
    const toolUseId = identity(payload.tool_use_id);
    const cwd = identity(payload.cwd);
    const tool = String(payload.tool_name || '');
    const input = payload.tool_input && typeof payload.tool_input === 'object' ? payload.tool_input : {};
    const command = typeof input.command === 'string' ? input.command : '';
    const eventClass = commandClass(tool, input, cwd);
    const needsReceipt = SHELL_TOOLS.test(tool) && /^[RTB]$/.test(eventClass) && Boolean(command);
    const executionNonce = needsReceipt ? crypto.randomBytes(16).toString('hex') : '';
    const saved = toolUseId && cwd && takeSnapshot(session, turn, toolUseId, cwd, executionNonce ? {
      nonce: executionNonce,
      eventClass,
      originHash: executableOriginHash(command, cwd),
      mutatingCommand: MUTATING_GENERATOR.test(command) || DIRECT_WRITE.test(command),
    } : null);
    if (!saved) failOpenWarning(session, 'snapshot-unavailable');
    const pendingRegistered = saved && taskTransaction(session, () => {
      const task = loadGroundTask(session);
      const id = pendingObservationId(session, turn, toolUseId);
      if (!task.pendingObservations.some((item) => item && item.id === id)) {
        task.pendingObservations.push({
          id,
          turn: hash(turn),
          eventClass,
          receipt: executionNonce ? path.basename(executionReceiptPath(session, turn, toolUseId)) : '',
        });
      }
      saveTask(session, task);
      return true;
    });
    if (pendingRegistered && executionNonce) {
      const updatedInput = { ...input, command: wrapCommandWithReceipt(command, executionReceiptPath(session, turn, toolUseId), executionNonce) };
      setHookOutput({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse', permissionDecision: 'allow', updatedInput,
        },
      });
    }
    pruneState(new Set([
      path.basename(taskPath(session)),
      path.basename(snapshotPath(session, turn, toolUseId)),
    ]));
    return;
  }

  if (hookMode === 'record') {
    const tool = String(payload.tool_name || '');
    const command = payload.tool_input && typeof payload.tool_input.command === 'string' ? payload.tool_input.command : '';
    const cwd = identity(payload.cwd);
    const isEdit = EDIT_TOOLS.test(tool);
    const observationDeadline = Date.now() + postObservationBudgetMs();
    const before = isEdit ? null : consumeSnapshot(session, turn, identity(payload.tool_use_id));
    const executionReceipt = !isEdit && before && before.executionNonce
      ? consumeExecutionReceipt(session, turn, identity(payload.tool_use_id), before.executionNonce)
      : null;
    const receiptUnavailable = executionReceipt && !executionReceipt.valid;
    const executionOriginChanged = Boolean(before && before.executionOrigin &&
      executableOriginHash(command, cwd) !== before.executionOrigin);
    const proofReceipt = executionOriginChanged ? { expected: true, valid: false } : executionReceipt;
    const after = isEdit ? null : cwd ? worktreeSnapshot(cwd, observationDeadline) : { available: false, reason: 'missing-cwd' };
    const observed = isEdit ? null : worktreeChanges(before, after, cwd, observationDeadline);
    taskTransaction(session, () => {
      const task = loadGroundTask(session);
      const observationId = pendingObservationId(session, turn, identity(payload.tool_use_id));
      task.pendingObservations = task.pendingObservations.filter((item) => !item || item.id !== observationId);
      let ledgerFailed = false;
      const noteWrite = (written) => { if (!written) ledgerFailed = true; };
      task.delivery.postToolUse++;
      if (effectiveMode(task) === 'OFF') { saveTask(session, task); return; }
      let changed = false;
      if (isEdit) {
        const reported = new Set(changedPaths(payload.tool_response));
        if (explicitFailure(payload.tool_response)) {
          noteWrite(append(session, turn, 'F class:E'));
          for (const file of reported) {
            noteWrite(recordEdit(session, turn, task, 'E', file, cwd));
            changed = true;
          }
        } else {
          const paths = new Set([...editedPaths(payload.tool_input), ...changedPaths(payload.tool_response)]);
          if (paths.size === 0) {
            noteWrite(recordEdit(session, turn, task, 'E', `unobserved-edit:${hash(tool, payload.tool_use_id || '')}`));
            changed = true;
            markMechanicalDebt(session, 'edit-path-unavailable', task);
            surfaceWarning(
              session, task, `unobserved-edit:${hash(session, turn, payload.tool_use_id || '').slice(0, 16)}`,
              'Dev Rigor warning: an edit tool reported no authoritative changed path. A conservative synthetic edit and release-blocking mechanical debt were recorded.'
            );
          } else {
            for (const file of paths) { noteWrite(recordEdit(session, turn, task, 'E', file, cwd)); changed = true; }
          }
        }
      } else {
        const eventClass = before && /^[RTB]$/.test(before.executionClass) ? before.executionClass : commandClass(tool, payload.tool_input, cwd);
        const observationAvailable = observed && observed.available;
        if (!observationAvailable) {
          const reason = safeReason(observed && observed.reason);
          noteWrite(recordArtifact(session, turn, task, 'G', syntheticRepositoryArtifact(after && after.root || hash(cwd), reason)));
          changed = true;
          markMechanicalDebt(session, 'snapshot-unavailable', task);
          surfaceWarning(
            session, task, `snapshot-unavailable:${hash(session, turn, payload.tool_use_id || '', reason).slice(0, 16)}`,
            `Dev Rigor warning: repository comparison was unavailable (${reason}). No substantive proof was accepted; a conservative generated-change and release-blocking mechanical debt were recorded.`
          );
        }

        if (receiptUnavailable) {
          const debtId = markMechanicalDebt(session, 'execution-receipt-missing', task);
          surfaceWarning(
            session, task, `execution-receipt-missing:${debtId || hash(session, turn, payload.tool_use_id || '').slice(0, 16)}`,
            `Dev Rigor warning: the correlated shell exit receipt was missing or invalid. No substantive proof was accepted; mechanical debt${debtId ? ` ${debtId}` : ''} remains release-blocking.`
          );
        }

        if (executionOriginChanged) {
          const debtId = markMechanicalDebt(session, 'execution-origin-changed', task);
          surfaceWarning(
            session, task, `execution-origin-changed:${debtId || hash(session, turn, payload.tool_use_id || '').slice(0, 16)}`,
            `Dev Rigor warning: the qualifying executable origin changed between PreToolUse and PostToolUse. No substantive proof was accepted; mechanical debt${debtId ? ` ${debtId}` : ''} remains release-blocking.`
          );
        }

        const isDirectWrite = DIRECT_WRITE.test(command);
        if (!executionPassed(payload.tool_response, proofReceipt, eventClass)) {
          noteWrite(append(session, turn, `F class:${eventClass}`));
        } else {
          if (isDirectWrite) {
            const rootHash = (after && after.root) || (before && before.root) || hash(cwd);
            noteWrite(recordArtifact(session, turn, task, 'G', syntheticRepositoryArtifact(rootHash, 'mutating-command')));
          }
          if (!observationAvailable || eventClass === 'I' || eventClass === 'U') {
            noteWrite(append(session, turn, 'I result:pass'));
          } else if (task.dirtyEdits.length === 0) {
          noteWrite(append(session, turn, `${eventClass} observation-only result:pass`));
        } else {
          const edits = [...task.dirtyEdits];
          const set = editSetHash(edits);
          const executionHash = executionFingerprint(payload, proofReceipt, before && before.executionOrigin);
          const descriptor = executionDescriptor(payload, eventClass, proofReceipt, before && before.executionOrigin || '');
          const descriptorHash = hash(stableStringify(descriptor)).slice(0, 16);
          const checkpoint = task.checkpoint + 1;
          const token = proofToken(task, session, turn, eventClass, edits, executionHash, descriptorHash, checkpoint);
          const proof = {
            token, turn: hash(turn), eventClass, edits, editSetHash: set, executionHash, descriptorHash, checkpoint,
            ledger: path.basename(ledgerPath(session, turn)),
            evidence: path.basename(evidencePath(token)),
          };
          const evidence = {
            version: 4, taskKey: hash(session), turnHash: hash(turn), proofId: token, eventClass,
            edits: [...edits].sort(), editSetHash: set, executionHash, descriptorHash, descriptor,
            checkpoint, result: 'pass',
          };
          if (writeEvidenceRecord(evidence) && append(session, turn,
            `${eventClass} proof-id:${token} edit-set:${set} exec:${executionHash} descriptor:${descriptorHash} checkpoint:${checkpoint} result:pass`)) {
            rememberLedger(task, session, turn);
            task.proofs.push(proof);
            task.proofs = task.proofs.slice(-32);
          } else {
            ledgerFailed = true;
          }
        }
      }

        if (observationAvailable && observed.items.length) {
          observed.items.forEach((item) => noteWrite(recordArtifact(session, turn, task, 'G', item)));
          changed = true;
        }
        const generated = changedPaths(payload.tool_response);
        if (generated.length) {
          generated.forEach((file) => noteWrite(recordEdit(session, turn, task, 'G', file, cwd)));
          changed = true;
        }
      }
      if (ledgerFailed) {
        if (task.dirtyEdits.length) addDebt(task, session, turn);
        const debtId = markMechanicalDebt(session, 'ledger-write-failed', task);
        surfaceWarning(
          session, task, `ledger-write-failed:${debtId || hash(session, turn).slice(0, 16)}`,
          `Dev Rigor warning: exact-turn evidence could not be persisted. The conversation remains usable, but proof and mechanical debt${debtId ? ` ${debtId}` : ''} remain release-blocking.`
        );
      } else {
        saveTask(session, task);
      }
    });
    pruneState(new Set([path.basename(taskPath(session)), path.basename(ledgerPath(session, turn))]));
    return;
  }

  if (hookMode !== 'check') return;
  const pendingResults = reconcilePending(session, turn, identity(payload.cwd));
  if (pendingResults === undefined) return;
  taskTransaction(session, () => {
    const task = loadGroundTask(session);
    const mode = effectiveMode(task);
    const activePending = new Set(task.pendingObservations.map((item) => item && item.id).filter(Boolean));
    let pendingLedgerFailed = false;
    for (const result of pendingResults || []) {
      if (!activePending.has(result.id)) continue;
      task.pendingObservations = task.pendingObservations.filter((item) => !item || item.id !== result.id);
      if (mode === 'OFF') continue;
      if (!append(session, turn, `F class:${result.eventClass}`)) pendingLedgerFailed = true;
      if (result.observed && result.observed.available) {
        for (const item of result.observed.items) {
          if (!recordArtifact(session, turn, task, 'G', item)) pendingLedgerFailed = true;
        }
      } else {
        const reason = safeReason(result.observed && result.observed.reason);
        if (!recordArtifact(session, turn, task, 'G', syntheticRepositoryArtifact(result.root, reason))) pendingLedgerFailed = true;
        const debtId = markMechanicalDebt(session, 'snapshot-unavailable', task);
        queueNotice(
          task, `pending-snapshot-unavailable:${debtId || hash(session, turn, result.id).slice(0, 16)}`,
          `Dev Rigor warning: a tool produced no PostToolUse event and its pending repository comparison was unavailable (${reason}). A conservative generated-change and release-blocking mechanical debt${debtId ? ` ${debtId}` : ''} were recorded.`
        );
      }
    }
    if (pendingLedgerFailed) {
      if (task.dirtyEdits.length) addDebt(task, session, turn);
      const debtId = markMechanicalDebt(session, 'ledger-write-failed', task);
      queueNotice(
        task, `pending-ledger-write-failed:${debtId || hash(session, turn).slice(0, 16)}`,
        `Dev Rigor warning: recovered pending-tool evidence could not be persisted completely. Proof and mechanical debt${debtId ? ` ${debtId}` : ''} remain release-blocking.`
      );
    }
    task.delivery.stop++;
    saveTask(session, task);
    if (mode === 'OFF') return;
    const ledger = readLedger(session, turn);
    let scopeStart = -1;
    ledger.forEach((line, index) => { if (line.startsWith('C ')) scopeStart = index; });
    let lastEdit = -1;
    let lastProof = -1;
    let lastBlock = -1;
    let lastRelease = -1;
    let proofId = '';
    let proofLine = '';
    ledger.forEach((line, index) => {
      if (index <= scopeStart) return;
      if (/^[EG] /.test(line)) lastEdit = index;
      if (parseProofEvent(line)) {
        lastProof = index;
        proofLine = line;
        const match = line.match(/proof-id:([a-f0-9]{16})/);
        proofId = match ? match[1] : '';
      }
      if (line.startsWith('K ')) lastBlock = index;
      if (line.startsWith('U ')) lastRelease = index;
    });

    if (lastBlock >= 0 && lastProof < lastEdit) {
      if (lastRelease >= lastBlock) return;
      if (!append(session, turn, 'U released-unproved')) {
        surfaceLedgerFailure(session, turn, task, 'U');
        return;
      }
      rememberLedger(task, session, turn);
      addDebt(task, session, turn);
      const debt = task.unresolved[task.unresolved.length - 1];
      surfaceWarning(
        session, task, `released-unproved:${debt ? debt.id : hash(session, turn).slice(0, 16)}`,
        `Dev Rigor warning: this turn was released after one substantive block, but proof debt remains unresolved${debt ? ` (${debt.id})` : ''}. It cannot pass a release gate.`
      );
      return;
    }
    if (lastEdit < 0 && lastProof < 0) return;

    if (lastProof < lastEdit) {
      addDebt(task, session, turn);
      if (payload.stop_hook_active && lastBlock < 0) {
        if (lastRelease >= lastEdit) return;
        if (!append(session, turn, 'U external-stop-active-released-unproved')) {
          surfaceLedgerFailure(session, turn, task, 'U');
          return;
        }
        rememberLedger(task, session, turn);
        const debt = task.unresolved[task.unresolved.length - 1];
        surfaceWarning(
          session, task, `external-stop-active:${debt ? debt.id : hash(session, turn).slice(0, 16)}`,
          `Dev Rigor warning: this unproved turn was released because another Stop continuation was already active, but proof debt remains unresolved${debt ? ` (${debt.id})` : ''} and release-blocking.`
        );
        return;
      }
      if (mode === 'WARN') {
        append(session, turn, 'W unproved-edit');
        const debt = task.unresolved[task.unresolved.length - 1];
        surfaceWarning(
          session, task, `warn-unproved:${debt ? debt.id : hash(session, turn).slice(0, 16)}`,
          `Dev Rigor WARN: an unproved edit was released without blocking${debt ? `; proof debt ${debt.id} remains unresolved` : ''}.`
        );
        return;
      }
      if (!append(session, turn, 'K substantive-proof')) {
        surfaceLedgerFailure(session, turn, task, 'K');
        return;
      }
      rememberLedger(task, session, turn);
      task.blockCount++;
      saveTask(session, task);
      block('Dev-rigor substantive proof gate: an artifact changed without a qualifying run, render, test, or build after the latest runnable edit or artifact edit. Run the narrowest check that exercises the changed behavior.');
      return;
    }

    const proof = task.proofs.find((item) => item.token === proofId);
    if (!validProofEvent(task, proof, proofLine, session, turn)) {
      surfaceEvidenceMismatch(session, turn, task);
      return;
    }
    const message = String(payload.last_assistant_message || '');
    const stated = message.match(/proof-id:([a-f0-9]{16})/i);
    let warning = '';
    let warningId = '';
    if (!RECEIPT.test(message)) {
      append(session, turn, 'W missing-receipt');
      warning = 'Dev Rigor warning: substantive proof was accepted, but the optional evidence receipt was missing.';
      warningId = `missing-receipt:${proof.token}`;
    } else if (stated && stated[1].toLowerCase() !== proof.token) {
      append(session, turn, 'W invalid-proof-id');
      warning = 'Dev Rigor warning: substantive proof was accepted, but the optional proof-id did not match this execution.';
      warningId = `invalid-proof-id:${proof.token}`;
    }
    if (!append(session, turn, `C proof-accepted proof-id:${proof.token} checkpoint:${proof.checkpoint}`)) {
      surfaceLedgerFailure(session, turn, task, 'C');
      return;
    }
    rememberLedger(task, session, turn);
    acceptProof(task, proof, session);
    saveTask(session, task);
    if (warning) surfaceWarning(session, task, warningId, warning);
  });
}

main();
flushHookOutput();
