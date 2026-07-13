#!/usr/bin/env node
// Codex SessionStart/SubagentStart activation hook.

const fs = require('fs');
const path = require('path');

function readPayload() {
  try { return JSON.parse(fs.readFileSync(0, 'utf8')); } catch (_) { return {}; }
}

let text;
try {
  text = fs.readFileSync(path.join(__dirname, '..', 'dev-rigor-reflex.md'), 'utf8').replace(/^\uFEFF/, '');
} catch (_) {
  process.exit(0);
}

const payload = readPayload();
const event = process.argv[2] === 'subagent' || payload.hook_event_name === 'SubagentStart'
  ? 'SubagentStart'
  : 'SessionStart';

try {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: event,
      additionalContext: text,
    },
  }));
} catch (_) {
  // A closed stdout must not turn activation into a session failure.
}

