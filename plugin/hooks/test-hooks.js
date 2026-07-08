#!/usr/bin/env node
// Self-check for the dev-rigor plugin hooks (router, grounding, settings wiring).
// Zero-framework, assert-based, hermetic: runs every hook as a child process with a
// temp CLAUDE_CONFIG_DIR, exactly as Claude Code invokes it.
//   node test-hooks.js
// Exits 0 with "ALL PASS" or non-zero at the first failure.

const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOOKS = __dirname;
const ROUTER = path.join(HOOKS, 'dev-rigor-router.js');
const GROUND = path.join(HOOKS, 'dev-rigor-ground.js');
const WIRE = path.join(HOOKS, 'wire-settings.js');

let tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-rigor-test-'));
let n = 0;

function freshDir() {
  const d = path.join(tmpRoot, 'cfg' + ++n);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

// Run a hook script with `input` JSON on stdin and an isolated config dir; return stdout.
function runHook(script, input, cfgDir, args = []) {
  return execFileSync('node', [script, ...args], {
    input: JSON.stringify(input),
    env: { ...process.env, CLAUDE_CONFIG_DIR: cfgDir },
    encoding: 'utf8',
  });
}

function routerOut(prompt, cfgDir, session = 's1') {
  return runHook(ROUTER, { session_id: session, hook_event_name: 'UserPromptSubmit', prompt }, cfgDir);
}

const tests = [];
function test(name, fn) { tests.push([name, fn]); }

// ---------- router: classification ----------

test('router: bugfix prompt injects the investigation discipline', () => {
  const out = routerOut('The login page is broken, users get an error on submit. Fix it.', freshDir());
  assert.match(out, /INVESTIGATION/i, 'expected investigation payload');
  assert.doesNotMatch(out, /RELEASE DISCIPLINE/i);
});

test('router: UI/artifact prompt injects the grounding discipline', () => {
  const out = routerOut('Restyle the dashboard layout and update the chart component.', freshDir());
  assert.match(out, /GROUNDING/i, 'expected grounding payload');
});

test('router: multi-part feature prompt injects the decomposition discipline', () => {
  const out = routerOut(
    'Implement the export feature: 1) CSV download 2) PDF report 3) email delivery, and add settings for each.',
    freshDir());
  assert.match(out, /DECOMPOS/i, 'expected decomposition payload');
});

test('router: release prompt injects the release discipline', () => {
  const out = routerOut('Cut the release and tag v2.0.0 when the gauntlet is green.', freshDir());
  assert.match(out, /RELEASE/i, 'expected release payload');
});

test('router: release outranks other matches', () => {
  const out = routerOut('Fix the last bug and then tag the release.', freshDir());
  assert.match(out, /RELEASE/i);
  assert.doesNotMatch(out, /INVESTIGATION PROTOCOL/i, 'only one discipline should inject');
});

test('router: conversational prompt injects nothing', () => {
  const out = routerOut('What do you think about the article I sent you?', freshDir());
  assert.strictEqual(out.trim(), '', 'expected silence for non-code prompt');
});

test('router: short question injects nothing', () => {
  const out = routerOut('thanks!', freshDir());
  assert.strictEqual(out.trim(), '');
});

// ---------- router: dedupe ----------

test('router: same discipline injects once per session', () => {
  const cfg = freshDir();
  const first = routerOut('Fix the crash in the parser.', cfg, 'dedupe-1');
  const second = routerOut('Also fix the error in the lexer.', cfg, 'dedupe-1');
  assert.match(first, /INVESTIGATION/i);
  assert.strictEqual(second.trim(), '', 'second injection of same discipline should be silent');
});

test('router: different session re-injects', () => {
  const cfg = freshDir();
  routerOut('Fix the crash in the parser.', cfg, 'sess-a');
  const other = routerOut('Fix the crash in the parser.', cfg, 'sess-b');
  assert.match(other, /INVESTIGATION/i);
});

test('router: a different discipline still injects after the first', () => {
  const cfg = freshDir();
  routerOut('Fix the crash in the parser.', cfg, 'mix-1');
  const out = routerOut('Now restyle the settings page layout.', cfg, 'mix-1');
  assert.match(out, /GROUNDING/i);
});

// ---------- router: structure outranks topic (review finding) ----------

test('router: multi-part UI prompt routes to decompose, not grounding', () => {
  const out = routerOut(
    'Implement the settings page: 1) add a dark mode toggle 2) add a layout width control 3) add a font size selector, and wire them to the theme store.',
    freshDir());
  assert.match(out, /DECOMPOS/i, 'structural multi-part signal must outrank UI words');
});

test('router: multi-bug list prompt routes to decompose, not investigation', () => {
  const out = routerOut(
    'Fix these bugs: 1) login crash on submit 2) broken pagination 3) the export button error, and add regression tests for each.',
    freshDir());
  assert.match(out, /DECOMPOS/i, 'structural multi-part signal must outrank bug words');
});

test('router: single-bug prompt still routes to investigation', () => {
  const out = routerOut('Fix the crash in the parser, it fails on empty input.', freshDir());
  assert.match(out, /INVESTIGATION/i);
});

test('router: non-code prompt with "error" stays silent', () => {
  const out = routerOut('I made an error filling out the form for my taxes, any advice?', freshDir());
  assert.strictEqual(out.trim(), '', 'symptom word without work verb or code hint must not route');
});

test('router: missing session_id injects without persisting dedupe', () => {
  const cfg = freshDir();
  const input = { hook_event_name: 'UserPromptSubmit', prompt: 'Fix the crash in the parser, it keeps failing.' };
  const first = runHook(ROUTER, input, cfg);
  const second = runHook(ROUTER, input, cfg);
  assert.match(first, /INVESTIGATION/i);
  assert.match(second, /INVESTIGATION/i, 'no session_id means no shared dedupe bucket');
});

// ---------- router: robustness ----------

test('router: garbage stdin exits 0 and stays silent', () => {
  const out = execFileSync('node', [ROUTER], {
    input: 'not json at all',
    env: { ...process.env, CLAUDE_CONFIG_DIR: freshDir() },
    encoding: 'utf8',
  });
  assert.strictEqual(out.trim(), '');
});

// ---------- grounding: ledger + stop check ----------

function record(cfg, session, tool_name, tool_input) {
  return runHook(GROUND, { session_id: session, hook_event_name: 'PostToolUse', tool_name, tool_input }, cfg, ['record']);
}
function stopCheck(cfg, session, stopActive = false) {
  return runHook(GROUND, { session_id: session, hook_event_name: 'Stop', stop_hook_active: stopActive }, cfg, ['check']);
}

test('ground: runnable edit with no execution blocks the stop once', () => {
  const cfg = freshDir();
  record(cfg, 'g1', 'Edit', { file_path: 'C:/proj/app.py' });
  const out = stopCheck(cfg, 'g1');
  const j = JSON.parse(out);
  assert.strictEqual(j.decision, 'block');
  assert.match(j.reason, /never (executed|ran|rendered)/i);
});

test('ground: edit followed by execution passes the stop', () => {
  const cfg = freshDir();
  record(cfg, 'g2', 'Edit', { file_path: 'C:/proj/app.py' });
  record(cfg, 'g2', 'Bash', { command: 'pytest -q' });
  const out = stopCheck(cfg, 'g2');
  assert.strictEqual(out.trim(), '', 'no block expected when something ran');
});

test('ground: preview tools count as execution', () => {
  const cfg = freshDir();
  record(cfg, 'g3', 'Write', { file_path: '/proj/index.html' });
  record(cfg, 'g3', 'mcp__Claude_Preview__preview_screenshot', {});
  assert.strictEqual(stopCheck(cfg, 'g3').trim(), '');
});

test('ground: doc-only edits never block', () => {
  const cfg = freshDir();
  record(cfg, 'g4', 'Edit', { file_path: '/proj/README.md' });
  record(cfg, 'g4', 'Write', { file_path: '/proj/notes.txt' });
  assert.strictEqual(stopCheck(cfg, 'g4').trim(), '');
});

test('ground: stop_hook_active never double-blocks', () => {
  const cfg = freshDir();
  record(cfg, 'g5', 'Edit', { file_path: '/proj/main.ts' });
  assert.strictEqual(stopCheck(cfg, 'g5', true).trim(), '');
});

test('ground: blocks at most once per session even across stops', () => {
  const cfg = freshDir();
  record(cfg, 'g6', 'Edit', { file_path: '/proj/main.rs' });
  const first = stopCheck(cfg, 'g6');
  assert.strictEqual(JSON.parse(first).decision, 'block');
  const second = stopCheck(cfg, 'g6');
  assert.strictEqual(second.trim(), '', 'second stop must not block again');
});

test('ground: no edits at all never blocks', () => {
  assert.strictEqual(stopCheck(freshDir(), 'g7').trim(), '');
});

test('ground: unforeseen execution tools count as execution (no false block)', () => {
  const cfg = freshDir();
  record(cfg, 'g8', 'Edit', { file_path: '/proj/app.py' });
  record(cfg, 'g8', 'mcp__ide__executeCode', { code: 'pytest' });
  assert.strictEqual(stopCheck(cfg, 'g8').trim(), '', 'any non-edit tool reaching the hook is execution');
});

test('ground: missing session_id records nothing and never blocks', () => {
  const cfg = freshDir();
  runHook(GROUND, { hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: '/proj/a.py' } }, cfg, ['record']);
  const out = runHook(GROUND, { hook_event_name: 'Stop', stop_hook_active: false }, cfg, ['check']);
  assert.strictEqual(out.trim(), '');
});

test('ground: concurrent records lose no writes (append-only ledger)', async () => {
  const cfg = freshDir();
  const { execFile } = require('child_process');
  const runs = [];
  for (let i = 0; i < 12; i++) {
    runs.push(new Promise((resolve, reject) => {
      const child = execFile('node', [GROUND, 'record'],
        { env: { ...process.env, CLAUDE_CONFIG_DIR: cfg } },
        (err) => (err ? reject(err) : resolve()));
      child.stdin.end(JSON.stringify({ session_id: 'race1', hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'true' } }));
    }));
  }
  await Promise.all(runs);
  const lines = fs.readFileSync(path.join(cfg, 'dev-rigor-plugin', 'state', 'ground-race1.log'), 'utf8')
    .split('\n').filter(Boolean);
  assert.strictEqual(lines.length, 12, `expected 12 exec lines, got ${lines.length}`);
});

test('ground: garbage stdin exits 0 silently', () => {
  const out = execFileSync('node', [GROUND, 'check'], {
    input: '{{{',
    env: { ...process.env, CLAUDE_CONFIG_DIR: freshDir() },
    encoding: 'utf8',
  });
  assert.strictEqual(out.trim(), '');
});

// ---------- wire-settings: idempotence + new hooks ----------

test('wire-settings: wires all hook events and is idempotent', () => {
  const cfg = freshDir();
  execFileSync('node', [WIRE, cfg], { encoding: 'utf8' });
  const s1 = JSON.parse(fs.readFileSync(path.join(cfg, 'settings.json'), 'utf8'));
  for (const ev of ['SessionStart', 'SubagentStart', 'UserPromptSubmit', 'PostToolUse', 'Stop']) {
    assert.ok(Array.isArray(s1.hooks[ev]) && s1.hooks[ev].length > 0, `missing hooks.${ev}`);
  }
  assert.match(JSON.stringify(s1.hooks.UserPromptSubmit), /dev-rigor-router/);
  assert.match(JSON.stringify(s1.hooks.PostToolUse), /dev-rigor-ground/);
  assert.match(JSON.stringify(s1.hooks.Stop), /dev-rigor-ground/);
  execFileSync('node', [WIRE, cfg], { encoding: 'utf8' });
  const s2 = JSON.parse(fs.readFileSync(path.join(cfg, 'settings.json'), 'utf8'));
  assert.deepStrictEqual(s2, s1, 'second run must not duplicate entries');
});

test('wire-settings: refuses to clobber a corrupt settings.json', () => {
  const cfg = freshDir();
  const corrupt = '{ "permissions": { "allow": ["Bash"] }, }'; // trailing comma -> invalid
  fs.writeFileSync(path.join(cfg, 'settings.json'), corrupt);
  let failed = false;
  try {
    execFileSync('node', [WIRE, cfg], { encoding: 'utf8', stdio: 'pipe' });
  } catch (e) {
    failed = true;
    assert.notStrictEqual(e.status, 0);
  }
  assert.ok(failed, 'must exit non-zero on unparseable settings');
  assert.strictEqual(fs.readFileSync(path.join(cfg, 'settings.json'), 'utf8'), corrupt,
    'the corrupt file must be left byte-identical, never overwritten');
});

test('wire-settings: updates a stale dev-rigor entry in place', () => {
  const cfg = freshDir();
  fs.writeFileSync(path.join(cfg, 'settings.json'), JSON.stringify({
    hooks: {
      PostToolUse: [
        { matcher: 'OLD|NARROW', hooks: [{ type: 'command', command: 'node "x/dev-rigor-ground.js" record; exit 0' }] },
        { matcher: 'Foreign', hooks: [{ type: 'command', command: 'node my-other-hook.js' }] },
      ],
    },
  }));
  execFileSync('node', [WIRE, cfg], { encoding: 'utf8' });
  const s = JSON.parse(fs.readFileSync(path.join(cfg, 'settings.json'), 'utf8'));
  const ours = s.hooks.PostToolUse.filter((e) => JSON.stringify(e).includes('dev-rigor-ground'));
  assert.strictEqual(ours.length, 1, 'stale entry must be replaced, not duplicated');
  assert.notStrictEqual(ours[0].matcher, 'OLD|NARROW', 'matcher must be updated');
  assert.match(ours[0].matcher, /jupyter/, 'current matcher expected');
  assert.match(JSON.stringify(s.hooks.PostToolUse), /my-other-hook/, 'foreign entry must survive');
});

test('wire-settings: preserves pre-existing foreign hooks', () => {
  const cfg = freshDir();
  fs.writeFileSync(path.join(cfg, 'settings.json'), JSON.stringify({
    hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node my-antistall.js' }] }] },
  }));
  execFileSync('node', [WIRE, cfg], { encoding: 'utf8' });
  const s = JSON.parse(fs.readFileSync(path.join(cfg, 'settings.json'), 'utf8'));
  assert.match(JSON.stringify(s.hooks.Stop), /my-antistall/, 'foreign Stop hook must survive');
  assert.match(JSON.stringify(s.hooks.Stop), /dev-rigor-ground/);
});

// ---------- run ----------

(async () => {
  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn(); // sync tests return undefined; the concurrency test returns a promise
      console.log('  ok    ' + name);
    } catch (e) {
      failed++;
      console.error('  FAIL  ' + name + '\n        ' + String(e.message).split('\n')[0]);
    }
  }
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  if (failed) {
    console.error(`\n${failed}/${tests.length} FAILED`);
    process.exit(1);
  }
  console.log(`\nALL PASS (${tests.length} tests)`);
})();
