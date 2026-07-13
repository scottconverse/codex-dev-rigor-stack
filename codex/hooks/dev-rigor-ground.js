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
const EXECUTION_TOOLS = /^(Bash|PowerShell)$|(?:preview|browser|chrome|computer|screenshot|navigate|snapshot|exec|run|test|shell|terminal|jupyter|notebook|ide|eval)/i;
const IMPORTANT_EXT = /\.(?:html?|svg|m?[jt]sx?|cjs|py|ps1|sh|bash|css|scss|vue|svelte|rs|go|c|cc|cpp|h|hpp|java|rb|php|swift|kt|cs|json|ya?ml|toml|sql|lock|md|mdx|txt|xml|ini|cfg|conf)$/i;
const IMPORTANT_NAME = /(?:^|[\\/])(?:Dockerfile|Makefile|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock|Gemfile\.lock|requirements[^\\/]*\.txt)$/i;
const RECEIPT = /proved:\s*\S[\s\S]*blast:\s*\S[\s\S]*skipped:\s*\S/i;
const INSPECTION_COMMAND = /^\s*(?:git\s+(?:status|diff|log|show|rev-parse|branch|fetch)\b|rg\b|grep\b|Get-Content\b|Select-String\b|Get-ChildItem\b|cat\b|ls\b|dir\b|echo\b|pwd\b|Get-Date\b|Get-Location\b|Write-(?:Output|Host)\b|sleep\b|Start-Sleep\b)[^;&|><\r\n]*$/i;
const DIRECT_WRITE = /(?:^|[;|&]\s*)(?:Set-Content|Add-Content|Out-File)\b|(?:^|[^>])>{1,2}(?!>)/i;
const MUTATING_GENERATOR = /\b(?:generate|codegen|migration|migrate)\b|\bprettier\b[^\r\n]*--write\b|\beslint\b[^\r\n]*--fix\b|\bgofmt\b[^\r\n]*(?:-w\b|-w=)|\bdotnet\s+format\b(?![^\r\n]*--verify-no-changes)|\bcargo\s+fmt\b(?![^\r\n]*--check)|\brustfmt\b(?![^\r\n]*--check)/i;

function hash(...values) {
  const digest = crypto.createHash('sha256');
  values.forEach((value) => digest.update(String(value)).update('\0'));
  return digest.digest('hex');
}

function identity(value) {
  return typeof value === 'string' && value.length > 0 ? value : '';
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

function snapshotPath(session, turn, toolUseId) {
  return path.join(stateDir, `pre-v4-${hash(session, turn, toolUseId)}.json`);
}

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
  task.delivery = task.delivery && typeof task.delivery === 'object' ? task.delivery : {};
  for (const event of ['preToolUse', 'postToolUse', 'stop']) {
    task.delivery[event] = Number.isInteger(task.delivery[event]) && task.delivery[event] >= 0 ? task.delivery[event] : 0;
  }
  return task;
}

function loadTask(session, create = false) {
  try {
    const parsed = JSON.parse(fs.readFileSync(taskPath(session), 'utf8'));
    if (parsed && parsed.version === 4 && /^(?:ON|WARN|OFF)$/.test(parsed.mode)) {
      if (typeof parsed.parentKey === 'string') {
        try {
          const parent = JSON.parse(fs.readFileSync(path.join(stateDir, `task-v4-${parsed.parentKey}.json`), 'utf8'));
          parsed.mode = parent && /^(?:ON|WARN|OFF)$/.test(parent.mode) ? parent.mode : 'WARN';
        } catch (_) { parsed.mode = 'WARN'; }
      }
      return normalizeTask(parsed);
    }
  } catch (_) { /* absent or corrupt task state fails to the safe default */ }
  const task = defaultTask();
  if (create) saveTask(session, task);
  return task;
}

function saveTask(session, task) {
  try {
    ensureStateDir();
    const target = taskPath(session);
    const temporary = `${target}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(task) + '\n', { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporary, target);
    try { fs.chmodSync(target, 0o600); } catch (_) { /* Windows inherits profile ACLs. */ }
    return true;
  } catch (_) { return false; }
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

function pruneState(preserve = new Set()) {
  let entries;
  try { entries = fs.readdirSync(stateDir).map((name) => ({ name, file: path.join(stateDir, name), stat: fs.statSync(path.join(stateDir, name)) })); }
  catch (_) { return; }
  const now = Date.now();
  const retentionMs = 7 * 24 * 3600 * 1000;
  for (const entry of entries) {
    if (!preserve.has(entry.name) && entry.stat.isFile() && now - entry.stat.mtimeMs > retentionMs) {
      try { fs.unlinkSync(entry.file); } catch (_) { /* concurrent cleanup */ }
    }
  }
  try { entries = fs.readdirSync(stateDir).map((name) => ({ name, file: path.join(stateDir, name), stat: fs.statSync(path.join(stateDir, name)) })); }
  catch (_) { return; }
  let total = entries.reduce((sum, entry) => sum + (entry.stat.isFile() ? entry.stat.size : 0), 0);
  const maximum = 5 * 1024 * 1024;
  for (const entry of entries.filter((item) => item.stat.isFile() && !preserve.has(item.name)).sort((a, b) => a.stat.mtimeMs - b.stat.mtimeMs)) {
    if (total <= maximum) break;
    try { fs.unlinkSync(entry.file); total -= entry.stat.size; } catch (_) { /* concurrent cleanup */ }
  }
}

function editedPaths(input) {
  const paths = new Set();
  if (input && typeof input === 'object') {
    for (const key of ['file_path', 'path']) if (typeof input[key] === 'string') paths.add(input[key]);
    if (typeof input.command === 'string') {
      const pattern = /^\*{0,3}\s*(?:Add|Update|Delete) File:\s*(.+?)\s*$/gim;
      for (const match of input.command.matchAll(pattern)) paths.add(match[1]);
    }
  }
  return [...paths];
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

function artifact(pathValue) {
  const normalized = String(pathValue).replace(/\\/g, '/');
  const extension = path.extname(normalized).toLowerCase() || 'none';
  const type = /\.mdx?$|\.txt$/i.test(normalized) ? 'docs' :
    /\.(?:json|ya?ml|toml|xml|ini|cfg|conf|lock)$/i.test(normalized) ? 'config' :
    /\.sql$/i.test(normalized) ? 'migration' :
    /\.(?:html?|css|scss|svg|vue|svelte)$/i.test(normalized) ? 'ui' : 'source';
  return { id: hash(normalized).slice(0, 16), extension, type };
}

function recordEdit(session, turn, task, kind, value) {
  const item = artifact(value);
  recordArtifact(session, turn, task, kind, item);
}

function recordArtifact(session, turn, task, kind, item) {
  if (!task.dirtyEdits.includes(item.id)) task.dirtyEdits.push(item.id);
  append(session, turn, `${kind} artifact:${item.type} ext:${item.extension} edit:${item.id}`);
}

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'buffer', timeout: 3500, windowsHide: true });
  if (result.error || result.status !== 0) return null;
  return result.stdout;
}

function worktreeSnapshot(cwd) {
  try {
    const rootOutput = git(cwd, ['rev-parse', '--show-toplevel']);
    if (!rootOutput) return { available: false, reason: 'not-git' };
    const root = rootOutput.toString('utf8').trim();
    const statusOutput = git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
    if (!statusOutput) return { available: false, reason: 'status-unavailable' };
    const tokens = statusOutput.toString('utf8').split('\0').filter(Boolean);
    const entries = {};
    let count = 0;
    for (let index = 0; index < tokens.length; index++) {
      const token = tokens[index];
      if (token.length < 4) continue;
      const status = token.slice(0, 2);
      const names = [token.slice(3)];
      if (/[RC]/.test(status) && index + 1 < tokens.length) names.push(tokens[++index]);
      for (const name of names) {
        if (!IMPORTANT_EXT.test(name) && !IMPORTANT_NAME.test(name)) continue;
        if (++count > 2000) return { available: false, reason: 'path-limit' };
        const item = artifact(name);
        const absolute = path.resolve(root, name);
        let contentHash = 'missing';
        try {
          const stat = fs.statSync(absolute);
          if (stat.isFile()) {
            if (stat.size > 64 * 1024 * 1024) return { available: false, reason: 'file-size-limit' };
            contentHash = crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex');
          }
        } catch (_) { /* deletion is a meaningful worktree state */ }
        entries[item.id] = { id: item.id, extension: item.extension, type: item.type, contentHash };
      }
    }
    return { available: true, root: hash(root), entries };
  } catch (_) {
    return { available: false, reason: 'snapshot-error' };
  }
}

function saveSnapshot(session, turn, toolUseId, snapshot) {
  try {
    ensureStateDir();
    const target = snapshotPath(session, turn, toolUseId);
    fs.writeFileSync(target, JSON.stringify(snapshot) + '\n', { encoding: 'utf8', mode: 0o600 });
    try { fs.chmodSync(target, 0o600); } catch (_) { /* Windows inherits profile ACLs. */ }
    return true;
  } catch (_) { return false; }
}

function takeSnapshot(session, turn, toolUseId, cwd) {
  if (!toolUseId || !cwd) return false;
  return saveSnapshot(session, turn, toolUseId, worktreeSnapshot(cwd));
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

function worktreeChanges(before, after) {
  if (!before || !after || !before.available || !after.available || before.root !== after.root) return null;
  const changes = [];
  const ids = new Set([...Object.keys(before.entries || {}), ...Object.keys(after.entries || {})]);
  for (const id of ids) {
    const prior = before.entries[id];
    const next = after.entries[id];
    if (!prior || !next || prior.contentHash !== next.contentHash) changes.push(next || prior);
  }
  return changes;
}

function textValues(value, found = []) {
  if (typeof value === 'string') found.push(value);
  else if (value && typeof value === 'object') Object.values(value).forEach((child) => textValues(child, found));
  return found;
}

function explicitFailure(value) {
  if (!value || typeof value !== 'object') return false;
  if (value.is_error === true || value.error === true || value.success === false || value.executed === false) return true;
  if (typeof value.status === 'string' && /^(?:rejected|declined|blocked|cancelled)$/i.test(value.status)) return true;
  return Object.values(value).some((child) => explicitFailure(child));
}

function structuredResult(value, seen = { found: false, failed: false }) {
  if (!value || typeof value !== 'object') return seen;
  for (const [key, child] of Object.entries(value)) {
    if (/^(?:test_result|testResult|test_results|testResults|build_result|buildResult|build_results|buildResults)$/.test(key) && child && typeof child === 'object') {
      if (Number.isFinite(child.failed)) { seen.found = true; if (child.failed > 0) seen.failed = true; }
      else if (typeof child.success === 'boolean') { seen.found = true; if (!child.success) seen.failed = true; }
      else if (typeof child.passed === 'boolean') { seen.found = true; if (!child.passed) seen.failed = true; }
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

function executionPassed(response) {
  if (explicitFailure(response)) return false;
  const structured = structuredResult(response);
  if (structured.found) return !structured.failed;
  const process = processResult(response);
  if (process.nonzero) return false;
  if (process.zero) return true;
  const text = textValues(response).join('\n');
  if (/(?:exit(?:ed)?(?:\s+with)?(?:\s+code)?|status)\s*[:=]?\s*[1-9]\d*/i.test(text) ||
      /(?:^|\n)\s*(?:error|failure|failed|rejected|declined|cancelled)(?:\s*[:=]|\s*$)/im.test(text) ||
      /(?:^|\n)\s*(?:(?:execution|command|tool call)\s+)?(?:was\s+)?(?:rejected|blocked)\s+by\s+(?:policy|the user)\b/im.test(text) ||
      /(?:^|\n)[^\r\n]{0,240}\brejected:\s*blocked by policy\b/im.test(text) ||
      /\b[1-9]\d*\s+(?:tests?\s+)?failed\b/i.test(text)) return false;
  return true;
}

function executionFingerprint(payload) {
  return hash(
    payload.tool_name || '',
    payload.tool_use_id || '',
    JSON.stringify(payload.tool_input || {}),
    JSON.stringify(payload.tool_response || {})
  ).slice(0, 16);
}

function commandClass(tool, input) {
  const command = input && typeof input.command === 'string' ? input.command : '';
  if (INSPECTION_COMMAND.test(command)) return 'I';
  if (/\b(?:test|pytest|jest|vitest|playwright|cargo\s+test|go\s+test|dotnet\s+test|mvn\s+test|gradle[^\r\n]*test)\b/i.test(command)) return 'T';
  if (/\b(?:build|compile|tsc|cargo\s+build|dotnet\s+build|mvn\s+package)\b/i.test(command)) return 'B';
  if (/(?:preview|browser|chrome|computer|screenshot|navigate|snapshot|jupyter|notebook|ide|eval|render)/i.test(tool) ||
      /^\s*(?:node|python|python3|ruby|php|java|dotnet\s+run|cargo\s+run|go\s+run)\b/i.test(command)) return 'R';
  return 'U';
}

function editSetHash(edits) {
  return hash(...[...new Set(edits)].sort()).slice(0, 16);
}

function proofToken(task, session, turn, eventClass, edits, executionHash, checkpoint) {
  const canonical = JSON.stringify({
    task: hash(session), turn: hash(turn), eventClass, edits: [...edits].sort(),
    executionHash, checkpoint, result: 'pass',
  });
  return crypto.createHmac('sha256', task.salt).update(canonical).digest('hex').slice(0, 16);
}

function addDebt(task, session, turn) {
  const set = editSetHash(task.dirtyEdits);
  if (!task.unresolved.some((item) => item.editSetHash === set)) {
    task.unresolved.push({ id: hash(session, turn, set).slice(0, 16), editSetHash: set, edits: [...task.dirtyEdits], status: 'unresolved' });
  }
}

function acceptProof(task, proof) {
  const accepted = new Set(proof.edits);
  task.dirtyEdits = task.dirtyEdits.filter((edit) => !accepted.has(edit));
  task.unresolved = task.unresolved.filter((debt) =>
    !Array.isArray(debt.edits) || !debt.edits.every((edit) => accepted.has(edit))
  );
  task.checkpoint = Math.max(task.checkpoint, proof.checkpoint || task.checkpoint + 1);
}

function block(reason) {
  try { process.stdout.write(JSON.stringify({ decision: 'block', reason })); } catch (_) { /* closed stdout */ }
}

function queueNotice(task, id, message) {
  if (!task.notices.some((notice) => notice.id === id)) task.notices.push({ id, message, delivered: false });
  task.notices = task.notices.slice(-32);
}

function surfaceWarning(session, task, id, message) {
  queueNotice(task, id, message);
  saveTask(session, task);
  try {
    process.stdout.write(JSON.stringify({ systemMessage: message }));
    const notice = task.notices.find((item) => item.id === id);
    if (notice) notice.delivered = true;
    saveTask(session, task);
  } catch (_) { /* router will surface the undelivered notice on the next prompt */ }
}

function main() {
  const hookMode = process.argv[2];
  let payload;
  try { payload = JSON.parse(fs.readFileSync(0, 'utf8')); } catch (_) { return; }
  const session = identity(payload.session_id);
  const turn = identity(payload.turn_id);
  if (!session) return;
  if (!turn) {
    const task = loadTask(session, true);
    task.warnings = task.warnings || {};
    task.warnings.mechanicalUnavailable = { reason: 'missing-turn-id', delivered: false };
    saveTask(session, task);
    pruneState(new Set([path.basename(taskPath(session))]));
    return;
  }

  const task = loadTask(session, true);

  if (hookMode === 'snapshot') task.delivery.preToolUse++;
  if (hookMode === 'record') task.delivery.postToolUse++;
  if (hookMode === 'check') task.delivery.stop++;
  saveTask(session, task);

  if (task.mode === 'OFF') return;

  if (hookMode === 'snapshot') {
    if (!EDIT_TOOLS.test(String(payload.tool_name || ''))) {
      takeSnapshot(session, turn, identity(payload.tool_use_id), identity(payload.cwd));
      pruneState(new Set([
        path.basename(taskPath(session)),
        path.basename(snapshotPath(session, turn, identity(payload.tool_use_id))),
      ]));
    }
    return;
  }

  if (hookMode === 'record') {
    const tool = String(payload.tool_name || '');
    const command = payload.tool_input && typeof payload.tool_input.command === 'string' ? payload.tool_input.command : '';
    let changed = false;
    if (EDIT_TOOLS.test(tool)) {
      for (const file of editedPaths(payload.tool_input)) {
        if (IMPORTANT_EXT.test(file) || IMPORTANT_NAME.test(file)) { recordEdit(session, turn, task, 'E', file); changed = true; }
      }
    } else if (EXECUTION_TOOLS.test(tool)) {
      const eventClass = commandClass(tool, payload.tool_input);
      if (!executionPassed(payload.tool_response)) {
        append(session, turn, `F class:${eventClass}`);
      } else if (eventClass === 'I' || eventClass === 'U') {
        append(session, turn, 'I result:pass');
      } else {
        const edits = [...task.dirtyEdits];
        const set = editSetHash(edits);
        const executionHash = executionFingerprint(payload);
        const checkpoint = task.checkpoint + 1;
        const token = proofToken(task, session, turn, eventClass, edits, executionHash, checkpoint);
        const proof = { token, turn: hash(turn), eventClass, edits, editSetHash: set, executionHash, checkpoint };
        task.proofs.push(proof);
        task.proofs = task.proofs.slice(-32);
        append(session, turn, `${eventClass} proof-id:${token} edit-set:${set} exec:${executionHash} checkpoint:${checkpoint} result:pass`);
      }
      const before = consumeSnapshot(session, turn, identity(payload.tool_use_id));
      const after = payload.cwd ? worktreeSnapshot(payload.cwd) : { available: false, reason: 'missing-cwd' };
      const observed = worktreeChanges(before, after);
      const generated = changedPaths(payload.tool_response);
      if (observed && observed.length) {
        observed.forEach((item) => recordArtifact(session, turn, task, 'G', item));
        changed = true;
      }
      if (generated.length) {
        generated.forEach((file) => recordEdit(session, turn, task, 'G', file));
        changed = true;
      }
      if ((!observed && eventClass !== 'I') || MUTATING_GENERATOR.test(command) || DIRECT_WRITE.test(command)) {
        if (!changed) recordEdit(session, turn, task, 'G', `unobserved:${hash(command)}`);
        changed = true;
      }
    }
    saveTask(session, task);
    pruneState(new Set([path.basename(taskPath(session)), path.basename(ledgerPath(session, turn))]));
    return;
  }

  if (hookMode !== 'check') return;
  const ledger = readLedger(session, turn);
  let scopeStart = -1;
  ledger.forEach((line, index) => { if (line.startsWith('C ')) scopeStart = index; });
  let lastEdit = -1;
  let lastProof = -1;
  let lastBlock = -1;
  let lastRelease = -1;
  let proofId = '';
  ledger.forEach((line, index) => {
    if (index <= scopeStart) return;
    if (/^[EG] /.test(line)) lastEdit = index;
    if (/^[RTB] /.test(line)) {
      lastProof = index;
      const match = line.match(/proof-id:([a-f0-9]{16})/);
      proofId = match ? match[1] : '';
    }
    if (line.startsWith('K ')) lastBlock = index;
    if (line.startsWith('U ')) lastRelease = index;
  });

  if (lastBlock >= 0 && lastProof < lastEdit) {
    if (lastRelease >= lastBlock) return;
    if (!append(session, turn, 'U released-unproved')) return;
    addDebt(task, session, turn);
    const debt = task.unresolved[task.unresolved.length - 1];
    surfaceWarning(
      session, task, `released-unproved:${debt ? debt.id : hash(session, turn).slice(0, 16)}`,
      `Dev Rigor warning: this turn was released after one substantive block, but proof debt remains unresolved${debt ? ` (${debt.id})` : ''}. It cannot pass a release gate.`
    );
    return;
  }
  if (payload.stop_hook_active && lastBlock < 0) return;
  if (lastEdit < 0) return;

  if (lastProof < lastEdit) {
    addDebt(task, session, turn);
    if (task.mode === 'WARN') {
      append(session, turn, 'W unproved-edit');
      const debt = task.unresolved[task.unresolved.length - 1];
      surfaceWarning(
        session, task, `warn-unproved:${debt ? debt.id : hash(session, turn).slice(0, 16)}`,
        `Dev Rigor WARN: an unproved edit was released without blocking${debt ? `; proof debt ${debt.id} remains unresolved` : ''}.`
      );
      return;
    }
    if (!append(session, turn, 'K substantive-proof')) return;
    task.blockCount++;
    saveTask(session, task);
    block('Dev-rigor substantive proof gate: an important artifact changed without a qualifying run, render, test, or build after the latest runnable edit or important artifact edit. Run the narrowest check that exercises the changed behavior.');
    return;
  }

  const proof = task.proofs.find((item) => item.token === proofId);
  if (!proof) return;
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
  append(session, turn, `C proof-accepted proof-id:${proof.token} checkpoint:${proof.checkpoint}`);
  acceptProof(task, proof);
  saveTask(session, task);
  if (warning) surfaceWarning(session, task, warningId, warning);
}

main();
