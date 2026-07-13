#!/usr/bin/env node
// Codex PostToolUse + Stop/SubagentStop grounding gate.

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
const stateDir = path.join(codexHome, 'dev-rigor-stack', 'state');
const EDIT_TOOLS = /^(apply_patch|Edit|Write|MultiEdit|NotebookEdit)$/i;
const EXECUTION_TOOLS = /^(Bash|PowerShell)$|(?:preview|browser|chrome|computer|screenshot|navigate|snapshot|exec|run|test|shell|terminal|jupyter|notebook|ide|eval)/i;
const RUNNABLE_EXT = /\.(html?|svg|m?[jt]sx?|cjs|py|ps1|sh|bash|css|scss|vue|svelte|rs|go|c|cc|cpp|h|hpp|java|rb|php|swift|kt|cs)$/i;
const RECEIPT = /proved:\s*\S[\s\S]*blast:\s*\S[\s\S]*skipped:\s*\S/i;

function identity(value) {
  return typeof value === 'string' && value.length > 0 ? value : '';
}

// Codex provides both identifiers on PostToolUse and Stop/SubagentStop. State
// belongs to that exact pair; UserPromptSubmit is not a reliable turn boundary.
// Hashing prevents path traversal and avoids collisions from sanitizing IDs.
function ledgerPath(session, turn) {
  const key = crypto.createHash('sha256').update(session).update('\0').update(turn).digest('hex');
  return path.join(stateDir, `ground-v3-${key}.log`);
}

function append(session, turn, line) {
  try {
    fs.mkdirSync(stateDir, { recursive: true });
    fs.appendFileSync(ledgerPath(session, turn), line.replace(/[\r\n\t]/g, ' ') + '\n', 'utf8');
    return true;
  } catch (_) {
    // A gate that cannot persist its own retry state must fail open. Blocking
    // without a durable B event can trap every subsequent Stop forever.
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
    for (const key of ['file_path', 'path']) {
      if (typeof input[key] === 'string') paths.add(input[key]);
    }
    if (typeof input.command === 'string') {
      const pattern = /^\*{0,3}\s*(?:Add|Update|Delete) File:\s*(.+?)\s*$/gim;
      for (const match of input.command.matchAll(pattern)) paths.add(match[1]);
    }
  }
  return [...paths];
}

function executionFailed(response) {
  if (response == null) return false;
  if (typeof response === 'string') {
    return /(?:exit(?:ed)?(?:\s+with)?(?:\s+code)?|status)\s*[:=]?\s*[1-9]\d*/i.test(response) ||
      /\b(?:rejected|blocked)\s+(?:by|under)\s+(?:policy|the user)\b/i.test(response) ||
      /(?:^|\n)\s*(?:error|failure|failed|rejected|declined|cancelled)(?:\s*[:=]|\s*$)/im.test(response) ||
      /\b[1-9]\d*\s+(?:tests?\s+)?failed\b/i.test(response);
  }
  if (typeof response !== 'object') return false;
  if (response.is_error === true || response.error === true || response.success === false || response.executed === false) return true;
  for (const key of ['exit_code', 'exitCode', 'status']) {
    if (Number.isInteger(response[key]) && response[key] !== 0) return true;
  }
  if (typeof response.status === 'string' && /^(?:error|failed|rejected|declined|blocked|cancelled)$/i.test(response.status)) return true;
  return Object.values(response).some((value) => executionFailed(value));
}

function block(reason) {
  try { process.stdout.write(JSON.stringify({ decision: 'block', reason })); } catch (_) { /* closed stdout */ }
}

function main() {
  const mode = process.argv[2];
  let payload;
  try { payload = JSON.parse(fs.readFileSync(0, 'utf8')); } catch (_) { return; }
  const session = identity(payload.session_id);
  const turn = identity(payload.turn_id);
  // Unsupported or malformed payloads must never activate a global blocker.
  if (!session || !turn) return;

  if (mode === 'record') {
    const tool = String(payload.tool_name || '');
    if (EDIT_TOOLS.test(tool)) {
      for (const file of editedPaths(payload.tool_input)) {
        if (RUNNABLE_EXT.test(file)) append(session, turn, `E\t${file}`);
      }
    } else if (EXECUTION_TOOLS.test(tool)) {
      append(session, turn, `${executionFailed(payload.tool_response) ? 'F' : 'X'}\t${tool}`);
    }
    return;
  }

  if (mode !== 'check') return;
  const ledger = readLedger(session, turn);
  let scopeStart = -1;
  ledger.forEach((line, index) => {
    if (line.startsWith('C ')) scopeStart = index;
  });
  let lastEdit = -1;
  let lastExecution = -1;
  let lastBlock = -1;
  let lastToolEvent = -1;
  const edited = new Set();
  ledger.forEach((line, index) => {
    if (index <= scopeStart) return;
    if (/^[EXF] /.test(line)) lastToolEvent = index;
    if (line.startsWith('E ')) { lastEdit = index; edited.add(path.extname(line.slice(2)) || '?'); }
    if (line.startsWith('X ')) lastExecution = index;
    if (line.startsWith('B ')) lastBlock = index;
  });

  // Stop-hook feedback is not a new deliverable. Release a previously blocked
  // turn when no new tool event followed it. This hard circuit breaker also
  // protects clients that omit or misreport stop_hook_active.
  if (lastBlock >= 0 && lastToolEvent < lastBlock) {
    append(session, turn, `C\t${payload.stop_hook_active ? 'platform-retry-released' : 'retry-circuit-released'}`);
    return;
  }
  if (payload.stop_hook_active) return;
  if (lastEdit < 0) return;

  if (lastExecution < lastEdit) {
    if (!append(session, turn, 'B\tgrounding')) return;
    block(
      'Dev-rigor grounding gate: runnable/viewable artifacts (' + [...edited].join(', ') +
      ') changed without a real execution or render after the latest runnable edit. Run the narrowest check that exercises the latest edit, observe its result, and then finish with the evidence receipt.'
    );
    return;
  }

  if (!RECEIPT.test(String(payload.last_assistant_message || ''))) {
    if (!append(session, turn, 'B\tevidence')) return;
    block(
      'Dev-rigor evidence gate: a real execution followed the latest runnable edit, but the required evidence receipt is missing. End with: proved: <exact check + result> · blast: <level> · skipped: <gate + reason or none>.'
    );
    return;
  }

  append(session, turn, 'C\treceipt-accepted');
}

main();
