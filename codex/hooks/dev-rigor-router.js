#!/usr/bin/env node
// Codex UserPromptSubmit router: inject one matching discipline per session.

const fs = require('fs');
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
  const prompt = typeof payload.prompt === 'string' ? payload.prompt : '';
  if (prompt.length < 8) return;
  const route = ROUTES.find((candidate) => candidate.match(prompt));
  if (!route) return;

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
        additionalContext: text,
      },
    }));
  } catch (_) { /* closed stdout */ }
}

main();
