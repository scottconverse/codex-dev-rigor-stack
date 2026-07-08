#!/usr/bin/env node
// dev-rigor grounding — mechanical run-before-done check.
// Two modes, one ledger per session:
//   node dev-rigor-ground.js record   (PostToolUse) — note edits to runnable/viewable
//                                     files and any execution-tool call
//   node dev-rigor-ground.js check    (Stop) — if runnable artifacts were edited but
//                                     NOTHING was ever executed/rendered this session,
//                                     block the stop ONCE with a pointed reason
// Deliberate floor: it only catches the provable-theater case (zero executions ever).
// It does not demand a re-run after every trailing edit — that judgment stays with
// the model; the router's grounding discipline covers it.
//
// Concept credit: fivetaku/fablize (MIT) proved verification grounding transferable
// in a Fable-vs-Opus comparison. Clean-room implementation — no fablize code used.

const fs = require('fs');
const os = require('os');
const path = require('path');

const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const stateDir = path.join(claudeDir, 'dev-rigor-plugin', 'state');

const EDIT_TOOLS = /^(Edit|Write|MultiEdit|NotebookEdit)$/;
const RUNNABLE_EXT = /\.(html?|svg|m?[jt]sx?|cjs|py|ps1|sh|bash|css|scss|vue|svelte|rs|go|c|cc|cpp|h|hpp|java|rb|php|swift|kt|cs)$/i;
// Anything that executes code or observes a rendered artifact counts as grounding.
const EXEC_TOOLS = /^(Bash|PowerShell)$/;
const EXEC_TOOL_HINT = /preview|chrome|browser|computer|screenshot|navigate|eval|snapshot/i;

function ledgerPath(session) {
  const s = String(session || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '');
  return path.join(stateDir, `ground-${s}.json`);
}

function readLedger(session) {
  try {
    return JSON.parse(fs.readFileSync(ledgerPath(session), 'utf8'));
  } catch (e) {
    return { edits: [], execs: 0, blocked: false };
  }
}

function writeLedger(session, ledger) {
  try {
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(ledgerPath(session), JSON.stringify(ledger), 'utf8');
  } catch (e) { /* never fail the hook over state */ }
}

function main() {
  const mode = process.argv[2];
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(0, 'utf8'));
  } catch (e) {
    return; // garbage stdin -> silence
  }
  const session = payload.session_id;

  if (mode === 'record') {
    const tool = String(payload.tool_name || '');
    const ledger = readLedger(session);
    if (EDIT_TOOLS.test(tool)) {
      const file = String((payload.tool_input && payload.tool_input.file_path) || '');
      if (RUNNABLE_EXT.test(file)) {
        const ext = (file.match(/\.[^.]+$/) || ['?'])[0];
        if (!ledger.edits.includes(ext)) ledger.edits.push(ext);
        writeLedger(session, ledger);
      }
    } else if (EXEC_TOOLS.test(tool) || EXEC_TOOL_HINT.test(tool)) {
      ledger.execs += 1;
      writeLedger(session, ledger);
    }
    return;
  }

  if (mode === 'check') {
    if (payload.stop_hook_active) return; // already in a blocked continuation — let it end
    const ledger = readLedger(session);
    if (ledger.blocked || ledger.edits.length === 0 || ledger.execs > 0) return;
    ledger.blocked = true; // one block per session, ever
    writeLedger(session, ledger);
    try {
      process.stdout.write(JSON.stringify({
        decision: 'block',
        reason:
          'Grounding check: you edited runnable/viewable artifact(s) (' + ledger.edits.join(', ') +
          ') this session but never executed or rendered ANYTHING — no test, script, or preview ran. ' +
          'Run the narrowest real check that exercises your change and observe the result, ' +
          'or state in one line why it cannot be run here, then finish.',
      }));
    } catch (e) { /* EPIPE at hook exit is not a failure */ }
  }
}

main();
process.exit(0);
