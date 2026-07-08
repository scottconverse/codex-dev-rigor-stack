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
try {
  s = JSON.parse(fs.readFileSync(settingsPath, 'utf8').replace(/^﻿/, ''));
} catch (e) {
  s = {}; // no settings yet, or unreadable -> start a fresh object
}
s.hooks = s.hooks || {};
for (const ev of ['SessionStart', 'SubagentStart', 'UserPromptSubmit', 'PostToolUse', 'Stop']) {
  s.hooks[ev] = s.hooks[ev] || [];
}

const present = (arr, marker) => JSON.stringify(arr).includes(marker);

let changed = false;
function wire(event, marker, entry) {
  if (!present(s.hooks[event], marker)) {
    s.hooks[event].push(entry);
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
  // Only the tools the ledger cares about: edits to files, and execution/observation tools.
  matcher: 'Edit|Write|MultiEdit|NotebookEdit|Bash|PowerShell|.*preview.*|.*chrome.*|.*computer.*',
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
