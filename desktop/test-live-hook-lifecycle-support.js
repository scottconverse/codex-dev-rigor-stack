#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  assertCandidateInstallation,
  assertLifecycleIsolation,
  boundedRedactedAppend,
  processAlive,
  redactSensitive,
  terminateProcessTree,
} = require('./live-hook-lifecycle-support');

function copyTree(source, target) {
  fs.cpSync(source, target, { recursive: true });
}

function expectRefusal(action, pattern) {
  assert.throws(action, pattern);
}

function waitForLine(stream) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timeout = setTimeout(() => reject(new Error('timed out waiting for process-tree fixture')), 5000);
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      clearTimeout(timeout);
      resolve(buffer.slice(0, newline).trim());
    });
    stream.on('error', reject);
  });
}

async function verifyTreeCleanup(label) {
  const childScript = "setInterval(() => {}, 1000)";
  const parentScript = [
    "const {spawn}=require('child_process')",
    `const c=spawn(process.execPath,['-e',${JSON.stringify(childScript)}],{stdio:'ignore'})`,
    "process.stdout.write(String(c.pid)+'\\n')",
    "setInterval(() => {}, 1000)",
  ].join(';');
  const parent = spawn(process.execPath, ['-e', parentScript], {
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
    windowsHide: true,
  });
  const descendantPid = Number(await waitForLine(parent.stdout));
  assert.ok(processAlive(parent.pid), `${label}: parent fixture never started`);
  assert.ok(processAlive(descendantPid), `${label}: descendant fixture never started`);
  await terminateProcessTree(parent, { graceMs: 1000 });
  assert.ok(!processAlive(parent.pid), `${label}: parent survived cleanup`);
  assert.ok(!processAlive(descendantPid), `${label}: descendant survived cleanup`);
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-rigor-live-support-'));
  try {
    const active = path.join(root, 'active-profile');
    const disposable = path.join(root, 'disposable-profile');
    const work = path.join(root, 'work');
    const candidate = path.join(root, 'candidate');
    for (const directory of [active, disposable, work, candidate]) fs.mkdirSync(directory, { recursive: true });
    fs.mkdirSync(path.join(disposable, 'dev-rigor-stack', 'state'), { recursive: true });

    assertLifecycleIsolation({ codexHome: disposable, workDir: work, candidateRoot: candidate, activeHomes: [active] });
    expectRefusal(
      () => assertLifecycleIsolation({ codexHome: active, workDir: work, candidateRoot: candidate, activeHomes: [active] }),
      /active Codex profile/i,
    );
    expectRefusal(
      () => assertLifecycleIsolation({ codexHome: root, workDir: work, candidateRoot: candidate, activeHomes: [active] }),
      /overlaps.*active Codex profile/i,
    );
    expectRefusal(
      () => assertLifecycleIsolation({ codexHome: disposable, workDir: path.join(active, 'work'), candidateRoot: candidate, activeHomes: [active] }),
      /work directory.*active Codex profile/i,
    );
    expectRefusal(
      () => assertLifecycleIsolation({ codexHome: disposable, workDir: work, candidateRoot: path.join(active, 'candidate'), activeHomes: [active] }),
      /candidate.*active Codex profile/i,
    );

    const alias = path.join(root, 'active-alias');
    fs.symlinkSync(active, alias, process.platform === 'win32' ? 'junction' : 'dir');
    expectRefusal(
      () => assertLifecycleIsolation({ codexHome: alias, workDir: work, candidateRoot: candidate, activeHomes: [active] }),
      /active Codex profile/i,
    );

    const unsafeRuntimeHome = path.join(root, 'runtime-junction-profile');
    fs.mkdirSync(unsafeRuntimeHome);
    fs.symlinkSync(active, path.join(unsafeRuntimeHome, 'dev-rigor-stack'), process.platform === 'win32' ? 'junction' : 'dir');
    expectRefusal(
      () => assertLifecycleIsolation({ codexHome: unsafeRuntimeHome, workDir: work, candidateRoot: candidate, activeHomes: [active] }),
      /runtime.*active Codex profile|escapes.*profile/i,
    );

    const unsafeStateHome = path.join(root, 'state-junction-profile');
    fs.mkdirSync(path.join(unsafeStateHome, 'dev-rigor-stack'), { recursive: true });
    fs.symlinkSync(active, path.join(unsafeStateHome, 'dev-rigor-stack', 'state'), process.platform === 'win32' ? 'junction' : 'dir');
    expectRefusal(
      () => assertLifecycleIsolation({ codexHome: unsafeStateHome, workDir: work, candidateRoot: candidate, activeHomes: [active] }),
      /state.*active Codex profile|escapes.*profile/i,
    );

    const candidateCodex = path.join(candidate, 'codex');
    const candidateSkill = path.join(candidate, 'skills', 'fixture-skill');
    fs.mkdirSync(path.join(candidateCodex, 'hooks'), { recursive: true });
    fs.mkdirSync(candidateSkill, { recursive: true });
    fs.writeFileSync(path.join(candidate, 'manifest.json'), JSON.stringify({ skills: [{ name: 'fixture-skill' }] }));
    fs.writeFileSync(path.join(candidateCodex, 'hooks', 'fixture.js'), "console.log('fixture');\n");
    fs.writeFileSync(path.join(candidateSkill, 'SKILL.md'), '# Fixture\n');
    const installed = path.join(root, 'installed-profile');
    copyTree(candidateCodex, path.join(installed, 'dev-rigor-stack'));
    copyTree(candidateSkill, path.join(installed, 'skills', 'fixture-skill'));
    fs.mkdirSync(path.join(installed, 'dev-rigor-stack', 'state'));
    assertCandidateInstallation({ candidateRoot: candidate, codexHome: installed });
    fs.appendFileSync(path.join(installed, 'dev-rigor-stack', 'hooks', 'fixture.js'), '// drift\n');
    expectRefusal(
      () => assertCandidateInstallation({ candidateRoot: candidate, codexHome: installed }),
      /candidate hash mismatch/i,
    );
    copyTree(candidateCodex, path.join(installed, 'dev-rigor-stack'));
    fs.appendFileSync(path.join(installed, 'skills', 'fixture-skill', 'SKILL.md'), 'drift\n');
    expectRefusal(
      () => assertCandidateInstallation({ candidateRoot: candidate, codexHome: installed }),
      /candidate hash mismatch/i,
    );
    copyTree(candidateSkill, path.join(installed, 'skills', 'fixture-skill'));
    fs.writeFileSync(path.join(installed, 'dev-rigor-stack', 'hooks', 'foreign.js'), '// unexpected owned file\n');
    expectRefusal(
      () => assertCandidateInstallation({ candidateRoot: candidate, codexHome: installed }),
      /candidate file set mismatch/i,
    );

    const secret = 'salt-secret-value';
    const redacted = redactSensitive(`{"salt":"${secret}","access_token":"token-value"} Authorization: Bearer bearer-value sk-secretvalue`);
    assert.ok(!redacted.includes(secret));
    assert.ok(!redacted.includes('token-value'));
    assert.ok(!redacted.includes('bearer-value'));
    assert.ok(!redacted.includes('sk-secretvalue'));
    const bounded = boundedRedactedAppend('', `${secret}${'x'.repeat(12000)}`, 4096);
    assert.ok(bounded.length <= 4096);
    assert.ok(!bounded.includes(secret));

    for (const label of ['success', 'failure', 'timeout']) await verifyTreeCleanup(label);
    process.stdout.write('LIFECYCLE_SUPPORT_PASS: profile containment, candidate binding, redaction, and process-tree cleanup verified\n');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(String(error && error.stack || error) + '\n');
  process.exitCode = 1;
});
