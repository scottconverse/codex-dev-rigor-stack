#!/usr/bin/env node
// Codex UserPromptSubmit router: inject one matching discipline per session.

const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const path = require('path');

const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
const stateDir = path.join(codexHome, 'dev-rigor-stack', 'state');
const disciplinesDir = path.join(__dirname, '..', 'disciplines');

const SYMPTOM = /\b(bug|broken|fails?\b|failing|crash(es|ed|ing)?|error|exception|regression|deadlock|hang(s|ing)?|leak(s|ing)?|race condition|repro(duce|duction)?|not working|doesn'?t work|why (is|does|isn'?t|doesn'?t|won'?t))\b/i;
const WORK_VERB = /\b(fix(es|ing)?|debug|investigate|diagnose|resolve|patch|repro(duce)?|root.?cause)\b/i;
const ACTION_VERB = /\b(implement|build|create|add|develop|write|make|update|change|fix(es|ing)?|restyle|redesign|refactor|wire|adjust|tweak|improve|polish|animate|render|style|convert|migrate|debug)\b/i;
const CODE_HINT = /`|\.(m?[jt]sx?|py|rs|go|java|rb|php|cs?|cpp|html?|css|sh|ps1|sql|ya?ml|json)\b|stack.?trace|\bCI\b|test suite/i;

function safeSession(value) { return String(value || '').replace(/[^a-zA-Z0-9_-]/g, ''); }

function sessionIdentity(value) { return typeof value === 'string' && value.length > 0 ? value : ''; }
function taskPath(session) {
  const key = crypto.createHash('sha256').update(session).update('\0').digest('hex');
  return path.join(stateDir, `task-v4-${key}.json`);
}
function defaultTask() {
  return { version: 4, mode: 'ON', salt: crypto.randomBytes(32).toString('hex'), dirtyEdits: [], proofs: [], unresolved: [], warnings: {} };
}
function loadTask(session) {
  try {
    const parsed = JSON.parse(fs.readFileSync(taskPath(session), 'utf8'));
    if (parsed && parsed.version === 4 && /^(?:ON|WARN|OFF)$/.test(parsed.mode)) return parsed;
  } catch (_) { /* first task control */ }
  return defaultTask();
}
function saveTask(session, task) {
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const target = taskPath(session);
  const temporary = `${target}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(task) + '\n', { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, target);
  try { fs.chmodSync(target, 0o600); } catch (_) { /* Windows inherits profile ACLs. */ }
}
function controlOutput(task, changed) {
  const latest = task.proofs.length ? task.proofs[task.proofs.length - 1] : null;
  const text = [
    'DEV-RIGOR TASK STATUS',
    'version: 1.7.0',
    `mode: ${task.mode}`,
    `dirty edit: ${task.dirtyEdits.length ? 'yes' : 'no'}`,
    `unresolved proof: ${task.unresolved.length ? 'yes' : 'no'}`,
    `latest proof: ${latest ? `${latest.eventClass} / ${latest.token}` : 'none'}`,
    `hook delivery: ${task.warnings && task.warnings.mechanicalUnavailable ? 'unverified / missing turn_id' : 'verified'}`,
    changed ? 'Task control updated. This does not change global Codex configuration.' : 'Status is read-only.',
  ].join('\n');
  return JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: text } });
}

const ROUTES = [
  {
    name: 'release', file: 'release.md',
    match: (p) => /\b(cut|ship|prep(are)?|publish|finalize|start|run|do|make) (a |an |the |this )?(new )?release\b|\brelease (gate|process|checklist|candidate|notes|branch|build)\b|\btag (a |the )?v?\d|\btag (the |a )?(release|version|rc)\b|\bpublish (the|a) (release|version|package)\b|\bcut (a |an |the )?(rc|version)\b|\bgauntletgate all\b|\bship (it|v?\d)\b/i.test(p),
  },
  {
    name: 'decompose', file: 'decompose.md',
    match: (p) => {
      if (!/\b(implement|build|create|add|develop|write|feature|make|fix)\b/i.test(p)) return false;
      const listMarkers = (p.match(/(^|\n)\s*(\d+[.)]|[-*])\s+/g) || []).length >= 2 ||
        (p.match(/\b\d+[.)]\s/g) || []).length >= 2;
      const conjunctions = (p.match(/\b(and|then|plus|also)\b/gi) || []).length >= 3;
      return listMarkers || conjunctions || p.length > 600;
    },
  },
  { name: 'investigation', file: 'investigation.md', match: (p) => SYMPTOM.test(p) && (WORK_VERB.test(p) || CODE_HINT.test(p)) },
  {
    name: 'grounding', file: 'grounding.md',
    match: (p) => /\b(ui|ux|page|button|css|styl(e|es|ing)|layout|render(s|ing)?|chart|graph|svg|html|landing|frontend|front-end|component|widget|screen|modal|form|dashboard|animation|responsive|dark mode)\b/i.test(p) &&
      (ACTION_VERB.test(p) || CODE_HINT.test(p)),
  },
];

function main() {
  let payload;
  try { payload = JSON.parse(fs.readFileSync(0, 'utf8')); } catch (_) { return; }
  const session = safeSession(payload.session_id);
  const exactSession = sessionIdentity(payload.session_id);
  const prompt = typeof payload.prompt === 'string' ? payload.prompt : '';
  const currentTask = exactSession ? loadTask(exactSession) : null;
  const missingTurnWarning = currentTask && currentTask.warnings && currentTask.warnings.mechanicalUnavailable &&
    currentTask.warnings.mechanicalUnavailable.delivered !== true
    ? 'Dev-rigor mechanical enforcement is unavailable: this client did not provide turn_id. Skill guidance remains active; Stop enforcement is not verified.'
    : '';
  const control = /^(?:DevRigorON|DevRigorWARN|DevRigorOFF|DevRigorSTATUS)$/.test(prompt) ? prompt : '';
  if (control && exactSession) {
    const task = currentTask;
    if (control !== 'DevRigorSTATUS') {
      task.mode = control.slice('DevRigor'.length);
      try { saveTask(exactSession, task); } catch (_) {
        // A control that cannot be persisted must fail open and report WARN.
        task.mode = 'WARN';
      }
    }
    if (task.warnings && task.warnings.mechanicalUnavailable) task.warnings.mechanicalUnavailable.delivered = true;
    try { saveTask(exactSession, task); } catch (_) { /* status remains fail-open */ }
    try { process.stdout.write(controlOutput(task, control !== 'DevRigorSTATUS')); } catch (_) { /* closed stdout */ }
    return;
  }
  if (prompt.length < 8) return;
  const route = ROUTES.find((candidate) => candidate.match(prompt));
  if (!route && !missingTurnWarning) return;

  if (!route && missingTurnWarning) {
    currentTask.warnings.mechanicalUnavailable.delivered = true;
    try { saveTask(exactSession, currentTask); } catch (_) { /* warning may repeat rather than disappear */ }
    try { process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: missingTurnWarning } })); } catch (_) { /* closed stdout */ }
    return;
  }

  const stateFile = session ? path.join(stateDir, `router-${session}.log`) : null;
  if (stateFile) {
    let seen = '';
    try { seen = fs.readFileSync(stateFile, 'utf8'); } catch (_) { /* first route */ }
    if (seen.split('\n').includes(route.name)) return;
  }

  let text;
  try { text = fs.readFileSync(path.join(disciplinesDir, route.file), 'utf8').replace(/^\uFEFF/, ''); } catch (_) { return; }

  if (stateFile) {
    try {
      fs.mkdirSync(stateDir, { recursive: true });
      fs.appendFileSync(stateFile, route.name + '\n', 'utf8');
      for (const name of fs.readdirSync(stateDir)) {
        const candidate = path.join(stateDir, name);
        try {
          if (Date.now() - fs.statSync(candidate).mtimeMs > 7 * 24 * 3600 * 1000) fs.unlinkSync(candidate);
        } catch (_) { /* another hook may be pruning */ }
      }
    } catch (_) { /* reinjection is safer than losing the prompt */ }
  }

  try {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: [missingTurnWarning, text].filter(Boolean).join('\n\n'),
      },
    }));
    if (missingTurnWarning) {
      currentTask.warnings.mechanicalUnavailable.delivered = true;
      try { saveTask(exactSession, currentTask); } catch (_) { /* warning may repeat rather than disappear */ }
    }
  } catch (_) { /* closed stdout */ }
}

main();
