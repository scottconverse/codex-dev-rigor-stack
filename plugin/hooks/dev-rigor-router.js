#!/usr/bin/env node
// dev-rigor router — Claude Code UserPromptSubmit hook.
// Classifies the incoming prompt and injects ONLY the matching discipline
// (../disciplines/*.md) as context, at most once per discipline per session.
// No match, or already injected -> silence. Never blocks, never fails the prompt.
//
// Concept credit: fivetaku/fablize (MIT) proved per-task discipline routing
// transferable in a Fable-vs-Opus comparison. Clean-room implementation — no
// fablize code was read or used.

const fs = require('fs');
const os = require('os');
const path = require('path');

const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const stateDir = path.join(claudeDir, 'dev-rigor-plugin', 'state');
const disciplinesDir = path.join(__dirname, '..', 'disciplines');

// Priority order: first match wins. Release outranks everything (highest altitude);
// investigation outranks grounding (a broken UI is a bug first).
const ROUTES = [
  {
    name: 'release',
    file: 'release.md',
    match: (p) =>
      /\b(release|tag (a |the )?v?\d|tag (the |a )?(release|version|rc)|publish (the|a) (release|version|package)|cut (a |an |the )?(rc|release|version)|gauntletgate all|ship (it|the release|v?\d))\b/i.test(p),
  },
  {
    name: 'investigation',
    file: 'investigation.md',
    match: (p) =>
      /\b(bug|broken|fix(es|ing)? (the|this|a|an|it)|fails?\b|failing|crash(es|ed|ing)?|error|exception|regression|debug|repro(duce|duction)?|not working|doesn'?t work|why (is|does|isn'?t|doesn'?t|won'?t))\b/i.test(p),
  },
  {
    name: 'grounding',
    file: 'grounding.md',
    match: (p) =>
      /\b(ui|ux|page|button|css|styl(e|es|ing)|layout|render(s|ing)?|chart|graph|svg|html|landing|frontend|front-end|component|widget|screen|modal|form|dashboard|animation|responsive|dark mode)\b/i.test(p),
  },
  {
    name: 'decompose',
    file: 'decompose.md',
    match: (p) => {
      if (!/\b(implement|build|create|add|develop|write|feature|make)\b/i.test(p)) return false;
      // Line-start bullets/numbers OR inline enumerations ("1) csv 2) pdf 3) email").
      const listMarkers =
        (p.match(/(^|\n)\s*(\d+[.)]|[-*])\s+/g) || []).length >= 2 ||
        (p.match(/\b\d+[.)]\s/g) || []).length >= 2;
      const conjunctions = (p.match(/\b(and|then|plus|also)\b/gi) || []).length >= 3;
      return listMarkers || conjunctions || p.length > 600;
    },
  },
];

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch (e) {
    return '';
  }
}

function main() {
  let payload;
  try {
    payload = JSON.parse(readStdin());
  } catch (e) {
    return; // garbage stdin -> silence, never break the prompt
  }
  const prompt = typeof payload.prompt === 'string' ? payload.prompt : '';
  if (!prompt || prompt.length < 8) return; // too short to be a work request

  const route = ROUTES.find((r) => r.match(prompt));
  if (!route) return;

  // Dedupe: each discipline injects once per session.
  const session = String(payload.session_id || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '');
  const stateFile = path.join(stateDir, `router-${session}.json`);
  let seen = [];
  try {
    seen = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  } catch (e) { /* no state yet */ }
  if (seen.includes(route.name)) return;

  let text;
  try {
    text = fs.readFileSync(path.join(disciplinesDir, route.file), 'utf8').replace(/^﻿/, '');
  } catch (e) {
    return; // discipline file missing -> silence
  }

  try {
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify(seen.concat(route.name)), 'utf8');
    // Opportunistic prune: drop state files older than 7 days.
    for (const f of fs.readdirSync(stateDir)) {
      const full = path.join(stateDir, f);
      try {
        if (Date.now() - fs.statSync(full).mtimeMs > 7 * 24 * 3600 * 1000) fs.unlinkSync(full);
      } catch (e) { /* racing another hook is fine */ }
    }
  } catch (e) { /* state write failed -> still inject, worst case re-inject later */ }

  try {
    process.stdout.write(text); // UserPromptSubmit stdout is added to context
  } catch (e) { /* EPIPE must not surface as a hook failure */ }
}

main();
process.exit(0);
