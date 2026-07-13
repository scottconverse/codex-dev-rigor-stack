#!/usr/bin/env node
// Codex PostToolUse + Stop/SubagentStop grounding gate.

const fs = require('fs');
const os = require('os');
const path = require('path');

const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
const stateDir = path.join(codexHome, 'dev-rigor-stack', 'state');
const EDIT_TOOLS = /^(apply_patch|Edit|Write|MultiEdit|NotebookEdit)$/i;
const EXECUTION_TOOLS = /^(Bash|PowerShell)$|(?:preview|browser|chrome|computer|screenshot|navigate|snapshot|exec|run|test|shell|terminal|jupyter|notebook|ide|eval)/i;
const RUNNABLE_EXT = /\.(html?|svg|m?[jt]sx?|cjs|py|ps1|sh|bash|css|scss|vue|svelte|rs|go|c|cc|cpp|h|hpp|java|rb|php|swift|kt|cs)$/i;
const RECEIPT = /proved:\s*\S[\s\S]*blast:\s*\S[\s\S]*skipped:\s*\S/i;

function safeSession(value) { return String(value || '').replace(/[^a-zA-Z0-9_-]/g, ''); }
function ledgerPath(session) { return path.join(stateDir, `ground-${safeSession(session)}.log`); }

function append(session, line) {
  try {
    fs.mkdirSync(stateDir, { recursive: true });
    fs.appendFileSync(ledgerPath(session), line.replace(/[\r\n\t]/g, ' ') + '\n', 'utf8');
  } catch (_) { /* hook state must never corrupt user work */ }
}

function readLedger(session) {
  try { return fs.readFileSync(ledgerPath(session), 'utf8').split('\n').filter(Boolean); }
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
    return /(?:exit(?:ed)?(?:\s+with)?(?:\s+code)?|status)\s*[:=]?\s*[1-9]\d*/i.test(response);
  }
  if (typeof response !== 'object') return false;
  if (response.is_error === true || response.error === true) return true;
  for (const key of ['exit_code', 'exitCode', 'status']) {
    if (Number.isInteger(response[key]) && response[key] !== 0) return true;
  }
  return Object.values(response).some((value) =>
    value && typeof value === 'object' && executionFailed(value)
  );
}

function block(reason) {
  try { process.stdout.write(JSON.stringify({ decision: 'block', reason })); } catch (_) { /* closed stdout */ }
}

function main() {
  const mode = process.argv[2];
  let payload;
  try { payload = JSON.parse(fs.readFileSync(0, 'utf8')); } catch (_) { return; }
  const session = safeSession(payload.session_id);
  if (!session) return;

  if (mode === 'record') {
    const tool = String(payload.tool_name || '');
    if (EDIT_TOOLS.test(tool)) {
      for (const file of editedPaths(payload.tool_input)) {
        if (RUNNABLE_EXT.test(file)) append(session, `E\t${file}`);
      }
    } else if (EXECUTION_TOOLS.test(tool)) {
      append(session, `${executionFailed(payload.tool_response) ? 'F' : 'X'}\t${tool}`);
    }
    return;
  }

  if (mode !== 'check' || payload.stop_hook_active) return;
  const ledger = readLedger(session);
  let lastEdit = -1;
  let lastExecution = -1;
  const edited = new Set();
  ledger.forEach((line, index) => {
    if (line.startsWith('E ')) { lastEdit = index; edited.add(path.extname(line.slice(2)) || '?'); }
    if (line.startsWith('X ')) lastExecution = index;
  });
  if (lastEdit < 0) return;

  if (lastExecution < lastEdit) {
    block(
      'Dev-rigor grounding gate: runnable/viewable artifacts (' + [...edited].join(', ') +
      ') changed without a real execution or render after the latest runnable edit. Run the narrowest check that exercises the latest edit, observe its result, and then finish with the evidence receipt.'
    );
    return;
  }

  if (!RECEIPT.test(String(payload.last_assistant_message || ''))) {
    block(
      'Dev-rigor evidence gate: a real execution followed the latest runnable edit, but the required evidence receipt is missing. End with: proved: <exact check + result> · blast: <level> · skipped: <gate + reason or none>.'
    );
  }
}

main();
