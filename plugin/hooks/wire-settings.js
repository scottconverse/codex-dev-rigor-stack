#!/usr/bin/env node
// dev-rigor plugin — wire all hooks into the user's settings.json:
//   SessionStart + SubagentStart -> reflex (dev-rigor-activate.js)
//   UserPromptSubmit             -> rigor router (dev-rigor-router.js)
//   PostToolUse + Stop           -> grounding check (dev-rigor-ground.js)
// Idempotent, BOM-less, preserves existing hooks. Called by install.sh / install.ps1 (or by hand).
//   node wire-settings.js [claude-config-dir]
// claude-config-dir defaults to $CLAUDE_CONFIG_DIR or ~/.claude.

const fs = require('fs');
const path = require('path');
const os = require('os');

const claudeDir = process.argv[2] || process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const settingsPath = path.join(claudeDir, 'settings.json');
const hookPath = (name) =>
  path.join(claudeDir, 'dev-rigor-plugin', 'hooks', name).replace(/\\/g, '/');
const activate = hookPath('dev-rigor-activate.js');
const router = hookPath('dev-rigor-router.js');
const ground = hookPath('dev-rigor-ground.js');

let s = {};
if (fs.existsSync(settingsPath)) {
  // An existing-but-unparseable settings.json must ABORT, not be silently replaced —
  // overwriting it would destroy the user's permissions, env, and foreign hooks.
  try {
    s = JSON.parse(fs.readFileSync(settingsPath, 'utf8').replace(/^﻿/, ''));
  } catch (e) {
    console.error('  FAIL  ' + settingsPath + ' exists but is not valid JSON (' + e.message + ').');
    console.error('        Refusing to touch it — fix the file (or remove it) and re-run.');
    process.exit(1);
  }
}
s.hooks = s.hooks || {};
for (const ev of ['SessionStart', 'SubagentStart', 'UserPromptSubmit', 'PostToolUse', 'Stop']) {
  s.hooks[ev] = s.hooks[ev] || [];
}

// Replace-own-then-add: drop any existing entry that carries our marker and push the
// current one, so a re-run UPDATES stale dev-rigor wiring (e.g. a changed matcher)
// instead of silently keeping it. Foreign entries are never touched.
let changed = false;
function wire(event, marker, entry) {
  const kept = s.hooks[event].filter((e) => !JSON.stringify(e).includes(marker));
  const next = kept.concat([entry]);
  if (JSON.stringify(next) !== JSON.stringify(s.hooks[event])) {
    s.hooks[event] = next;
    changed = true;
  }
}

wire('SessionStart', 'dev-rigor-activate', {
  matcher: 'startup|resume|clear|compact',
  hooks: [{ type: 'command', command: `node "${activate}"; exit 0`, timeout: 5, statusMessage: 'Loading dev-rigor reflex...' }],
});
wire('SubagentStart', 'dev-rigor-activate', {
  hooks: [{ type: 'command', command: `node "${activate}" subagent; exit 0`, timeout: 5, statusMessage: 'Loading dev-rigor reflex...' }],
});
wire('UserPromptSubmit', 'dev-rigor-router', {
  hooks: [{ type: 'command', command: `node "${router}"; exit 0`, timeout: 5, statusMessage: 'Routing rigor...' }],
});
wire('PostToolUse', 'dev-rigor-ground', {
  // Only the tools the ledger cares about: edits to files, and execution/observation
  // tools. The exec side is deliberately broad (exec/run/test/shell/terminal/jupyter/
  // notebook/ide/eval) — a legitimate execution the matcher misses would make the Stop
  // check block falsely, so unknown exec-ish tools must be let through.
  matcher: 'Edit|Write|MultiEdit|NotebookEdit|Bash|PowerShell|.*(preview|chrome|browser|computer|screenshot|navigate|snapshot|exec|run|test|shell|terminal|jupyter|notebook|ide|eval).*',
  hooks: [{ type: 'command', command: `node "${ground}" record; exit 0`, timeout: 5 }],
});
wire('Stop', 'dev-rigor-ground', {
  hooks: [{ type: 'command', command: `node "${ground}" check; exit 0`, timeout: 5, statusMessage: 'Grounding check...' }],
});

fs.mkdirSync(claudeDir, { recursive: true });
if (changed) {
  fs.writeFileSync(settingsPath, JSON.stringify(s, null, 2), { encoding: 'utf8' }); // no BOM
  console.log('  ok    wired dev-rigor hooks (reflex + router + grounding) into ' + settingsPath);
} else {
  console.log('  ok    dev-rigor hooks already present in ' + settingsPath);
}
