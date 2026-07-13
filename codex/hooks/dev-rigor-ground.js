#!/usr/bin/env node
// Codex PostToolUse + Stop/SubagentStop substantive grounding gate.

const crypto = require('crypto');
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
const INSPECTION_COMMAND = /^\s*(?:git\s+(?:status|diff|log|show|rev-parse|branch)\b|rg\b|grep\b|Get-Content\b|Select-String\b|Get-ChildItem\b|cat\b|ls\b|dir\b)/i;
const DIRECT_WRITE = /(?:^|[;|&]\s*)(?:Set-Content|Add-Content|Out-File)\b|(?:^|[^>])>{1,2}(?!>)/i;
const GENERATOR = /\b(?:generate|codegen|formatter?|format\b|prettier|eslint\s+[^\r\n]*--fix|migration|migrate)\b/i;

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

function defaultTask() {
  return { version: 4, mode: 'ON', salt: crypto.randomBytes(32).toString('hex'), dirtyEdits: [], proofs: [], unresolved: [], warnings: {} };
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
      return parsed;
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
  if (!task.dirtyEdits.includes(item.id)) task.dirtyEdits.push(item.id);
  append(session, turn, `${kind} artifact:${item.type} ext:${item.extension} edit:${item.id}`);
}

function textValues(value, found = []) {
  if (typeof value === 'string') found.push(value);
  else if (value && typeof value === 'object') Object.values(value).forEach((child) => textValues(child, found));
  return found;
}

function explicitFailure(value) {
  if (!value || typeof value !== 'object') {
    return typeof value === 'string' && /\b(?:rejected|blocked)\s+(?:by|under)\s+(?:policy|the user)\b/i.test(value);
  }
  if (value.is_error === true || value.error === true || value.success === false || value.executed === false) return true;
  if (typeof value.status === 'string' && /^(?:rejected|declined|blocked|cancelled)$/i.test(value.status)) return true;
  return Object.values(value).some((child) => explicitFailure(child));
}

function structuredResult(value) {
  if (!value || typeof value !== 'object') return null;
  for (const [key, child] of Object.entries(value)) {
    if (/^(?:test_result|testResult|test_results|testResults|build_result|buildResult|build_results|buildResults)$/.test(key) && child && typeof child === 'object') {
      if (Number.isFinite(child.failed)) return child.failed > 0 ? false : true;
      if (typeof child.success === 'boolean') return child.success;
      if (typeof child.passed === 'boolean') return child.passed;
    }
    const nested = structuredResult(child);
    if (nested !== null) return nested;
  }
  return null;
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
  if (structured !== null) return structured;
  const process = processResult(response);
  if (process.nonzero) return false;
  if (process.zero) return true;
  const text = textValues(response).join('\n');
  if (/(?:exit(?:ed)?(?:\s+with)?(?:\s+code)?|status)\s*[:=]?\s*[1-9]\d*/i.test(text) ||
      /(?:^|\n)\s*(?:error|failure|failed|rejected|declined|cancelled)(?:\s*[:=]|\s*$)/im.test(text) ||
      /\b[1-9]\d*\s+(?:tests?\s+)?failed\b/i.test(text)) return false;
  return true;
}

function commandClass(tool, input) {
  const command = input && typeof input.command === 'string' ? input.command : '';
  if (INSPECTION_COMMAND.test(command)) return 'I';
  if (/\b(?:test|pytest|jest|vitest|playwright|cargo\s+test|go\s+test|dotnet\s+test|mvn\s+test|gradle[^\r\n]*test)\b/i.test(command)) return 'T';
  if (/\b(?:build|compile|tsc|cargo\s+build|dotnet\s+build|mvn\s+package)\b/i.test(command)) return 'B';
  if (/(?:preview|browser|chrome|computer|screenshot|navigate|snapshot|jupyter|notebook|ide|eval|render)/i.test(tool) ||
      /^\s*(?:node|python|python3|ruby|php|java|dotnet\s+run|cargo\s+run|go\s+run)\b/i.test(command)) return 'R';
  return /^(?:Bash|PowerShell)$/i.test(tool) ? 'R' : 'I';
}

function editSetHash(edits) {
  return hash(...[...new Set(edits)].sort()).slice(0, 16);
}

function proofToken(task, session, turn, eventClass, edits) {
  const canonical = JSON.stringify({ task: hash(session), turn: hash(turn), eventClass, edits: [...edits].sort(), result: 'pass' });
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
  task.unresolved = task.unresolved.filter((debt) => debt.editSetHash !== proof.editSetHash);
}

function block(reason) {
  try { process.stdout.write(JSON.stringify({ decision: 'block', reason })); } catch (_) { /* closed stdout */ }
}

function main() {
  const hookMode = process.argv[2];
  let payload;
  try { payload = JSON.parse(fs.readFileSync(0, 'utf8')); } catch (_) { return; }
  const session = identity(payload.session_id);
  const turn = identity(payload.turn_id);
  if (!session || !turn) return;

  const task = loadTask(session, hookMode === 'record');
  if (task.mode === 'OFF') return;

  if (hookMode === 'record') {
    const tool = String(payload.tool_name || '');
    const command = payload.tool_input && typeof payload.tool_input.command === 'string' ? payload.tool_input.command : '';
    let changed = false;
    if (EDIT_TOOLS.test(tool)) {
      for (const file of editedPaths(payload.tool_input)) {
        if (IMPORTANT_EXT.test(file) || IMPORTANT_NAME.test(file)) { recordEdit(session, turn, task, 'E', file); changed = true; }
      }
    } else if (/^(?:Bash|PowerShell)$/i.test(tool) && DIRECT_WRITE.test(command)) {
      recordEdit(session, turn, task, 'E', `shell:${hash(command)}`);
      changed = true;
    } else if (EXECUTION_TOOLS.test(tool)) {
      const eventClass = commandClass(tool, payload.tool_input);
      if (!executionPassed(payload.tool_response)) {
        append(session, turn, `F class:${eventClass}`);
      } else if (eventClass === 'I') {
        append(session, turn, 'I result:pass');
      } else {
        const edits = [...task.dirtyEdits];
        const set = editSetHash(edits);
        const token = proofToken(task, session, turn, eventClass, edits);
        const proof = { token, turn: hash(turn), eventClass, edits, editSetHash: set };
        task.proofs.push(proof);
        task.proofs = task.proofs.slice(-32);
        append(session, turn, `${eventClass} proof-id:${token} edit-set:${set} result:pass`);
      }
      const generated = changedPaths(payload.tool_response);
      if (generated.length || GENERATOR.test(command)) {
        const candidates = generated.length ? generated : [`generated:${hash(command)}`];
        candidates.forEach((file) => recordEdit(session, turn, task, 'G', file));
        changed = true;
      }
    }
    saveTask(session, task);
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
  let lastTool = -1;
  let proofId = '';
  ledger.forEach((line, index) => {
    if (index <= scopeStart) return;
    if (/^[EIGRTBF] /.test(line)) lastTool = index;
    if (/^[EG] /.test(line)) lastEdit = index;
    if (/^[RTB] /.test(line)) {
      lastProof = index;
      const match = line.match(/proof-id:([a-f0-9]{16})/);
      proofId = match ? match[1] : '';
    }
    if (line.startsWith('K ')) lastBlock = index;
    if (line.startsWith('U ')) lastRelease = index;
  });

  if (lastRelease > lastBlock && lastTool < lastBlock) return;
  if (lastBlock >= 0 && lastTool < lastBlock) {
    if (!append(session, turn, 'U released-unproved')) return;
    addDebt(task, session, turn);
    saveTask(session, task);
    return;
  }
  if (payload.stop_hook_active) return;
  if (lastEdit < 0) return;

  if (lastProof < lastEdit) {
    addDebt(task, session, turn);
    if (task.mode === 'WARN') {
      append(session, turn, 'W unproved-edit');
      saveTask(session, task);
      return;
    }
    if (!append(session, turn, 'K substantive-proof')) return;
    saveTask(session, task);
    block('Dev-rigor substantive proof gate: an important artifact changed without a qualifying run, render, test, or build after the latest runnable edit or important artifact edit. Run the narrowest check that exercises the changed behavior.');
    return;
  }

  const proof = task.proofs.find((item) => item.token === proofId);
  if (!proof) return;
  const message = String(payload.last_assistant_message || '');
  const stated = message.match(/proof-id:([a-f0-9]{16})/i);
  if (!RECEIPT.test(message)) append(session, turn, 'W missing-receipt');
  else if (stated && stated[1].toLowerCase() !== proof.token) append(session, turn, 'W invalid-proof-id');
  append(session, turn, `C proof-accepted proof-id:${proof.token}`);
  acceptProof(task, proof);
  saveTask(session, task);
}

main();
