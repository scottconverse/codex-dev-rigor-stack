#!/usr/bin/env node
// dev-rigor reflex — Claude Code SessionStart / SubagentStart activation hook.
// Emits the always-on rigor reflex as hidden context. Mirrors ponytail's mechanism:
//   node dev-rigor-activate.js            -> SessionStart (native Claude reads raw stdout)
//   node dev-rigor-activate.js subagent   -> SubagentStart (needs hookSpecificOutput JSON)
// Reflex text lives in ../dev-rigor-reflex.md so it can be edited without touching this hook.

const fs = require('fs');
const path = require('path');

const reflexPath = path.join(__dirname, '..', 'dev-rigor-reflex.md');

let text = '';
try {
  // Strip a UTF-8 BOM if an editor added one — it would leak into the injected context.
  text = fs.readFileSync(reflexPath, 'utf8').replace(/^﻿/, '');
} catch (e) {
  // Reflex file missing -> emit nothing, never block the session.
  process.exit(0);
}

const isSubagent = process.argv[2] === 'subagent';
try {
  if (isSubagent) {
    process.stdout.write(JSON.stringify(
      { hookSpecificOutput: { hookEventName: 'SubagentStart', additionalContext: text } }));
  } else {
    process.stdout.write(text);
  }
} catch (e) {
  // EPIPE / closed stdout at hook exit must not surface as a hook failure.
}
process.exit(0);
