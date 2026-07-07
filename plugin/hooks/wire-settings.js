#!/usr/bin/env node
// dev-rigor reflex — wire the SessionStart + SubagentStart hooks into the user's settings.json.
// Idempotent, BOM-less, preserves existing hooks. Called by install.sh / install.ps1 (or by hand).
//   node wire-settings.js [claude-config-dir]
// claude-config-dir defaults to $CLAUDE_CONFIG_DIR or ~/.claude.

const fs = require('fs');
const path = require('path');
const os = require('os');

const claudeDir = process.argv[2] || process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const settingsPath = path.join(claudeDir, 'settings.json');
const activate = path.join(claudeDir, 'dev-rigor-plugin', 'hooks', 'dev-rigor-activate.js').replace(/\\/g, '/');

let s = {};
try {
  s = JSON.parse(fs.readFileSync(settingsPath, 'utf8').replace(/^﻿/, ''));
} catch (e) {
  s = {}; // no settings yet, or unreadable -> start a fresh object
}
s.hooks = s.hooks || {};
s.hooks.SessionStart = s.hooks.SessionStart || [];
s.hooks.SubagentStart = s.hooks.SubagentStart || [];

const SS_CMD = `node "${activate}"; exit 0`;
const SA_CMD = `node "${activate}" subagent; exit 0`;
const present = (arr) => JSON.stringify(arr).includes('dev-rigor-activate');

let changed = false;
if (!present(s.hooks.SessionStart)) {
  s.hooks.SessionStart.push({
    matcher: 'startup|resume|clear|compact',
    hooks: [{ type: 'command', command: SS_CMD, timeout: 5, statusMessage: 'Loading dev-rigor reflex...' }],
  });
  changed = true;
}
if (!present(s.hooks.SubagentStart)) {
  s.hooks.SubagentStart.push({
    hooks: [{ type: 'command', command: SA_CMD, timeout: 5, statusMessage: 'Loading dev-rigor reflex...' }],
  });
  changed = true;
}

fs.mkdirSync(claudeDir, { recursive: true });
if (changed) {
  fs.writeFileSync(settingsPath, JSON.stringify(s, null, 2), { encoding: 'utf8' }); // no BOM
  console.log('  ok    wired dev-rigor reflex hooks into ' + settingsPath);
} else {
  console.log('  ok    dev-rigor reflex hooks already present in ' + settingsPath);
}
