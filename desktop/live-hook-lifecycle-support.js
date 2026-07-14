'use strict';

const { execFileSync, spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function comparable(value) {
  const normalized = path.normalize(value);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function canonicalPath(value) {
  const absolute = path.resolve(value);
  const tail = [];
  let cursor = absolute;
  while (!fs.existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) throw new Error(`Cannot canonicalize path: ${absolute}`);
    tail.unshift(path.basename(cursor));
    cursor = parent;
  }
  return path.join(fs.realpathSync.native(cursor), ...tail);
}

function pathContains(parent, child) {
  const relative = path.relative(comparable(parent), comparable(child));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function pathsOverlap(left, right) {
  return pathContains(left, right) || pathContains(right, left);
}

function assertNoActiveOverlap(label, target, activeHomes) {
  for (const active of activeHomes) {
    if (pathsOverlap(target, active)) {
      throw new Error(`${label} overlaps the active Codex profile: ${target}`);
    }
  }
}

function assertTreeContained(root, allowedRoot, activeHomes, label) {
  if (!fs.existsSync(root)) return;
  const allowed = canonicalPath(allowedRoot);
  const pending = [path.resolve(root)];
  const visited = new Set();
  while (pending.length) {
    const lexical = pending.pop();
    const resolved = canonicalPath(lexical);
    const key = comparable(resolved);
    if (!pathContains(allowed, resolved)) {
      throw new Error(`${label} escapes its disposable profile: ${lexical}`);
    }
    assertNoActiveOverlap(label, resolved, activeHomes);
    if (visited.has(key)) continue;
    visited.add(key);
    const stat = fs.statSync(lexical);
    if (!stat.isDirectory()) continue;
    for (const entry of fs.readdirSync(lexical, { withFileTypes: true })) {
      pending.push(path.join(lexical, entry.name));
    }
  }
}

function assertLifecycleIsolation({ codexHome, workDir, candidateRoot, activeHomes }) {
  if (!Array.isArray(activeHomes) || activeHomes.length === 0) {
    throw new Error('An explicit active Codex profile is required for lifecycle isolation.');
  }
  const active = [...new Set(activeHomes.filter(Boolean).map(canonicalPath).map(comparable))];
  const resolved = {
    codexHome: canonicalPath(codexHome),
    workDir: canonicalPath(workDir),
    candidateRoot: canonicalPath(candidateRoot),
  };
  assertNoActiveOverlap('Disposable CODEX_HOME', resolved.codexHome, active);
  assertNoActiveOverlap('Lifecycle work directory', resolved.workDir, active);
  assertNoActiveOverlap('Reviewed candidate', resolved.candidateRoot, active);

  const runtimeRoot = path.join(resolved.codexHome, 'dev-rigor-stack');
  const stateRoot = path.join(runtimeRoot, 'state');
  const skillsRoot = path.join(resolved.codexHome, 'skills');
  assertTreeContained(runtimeRoot, resolved.codexHome, active, 'Installed runtime');
  assertTreeContained(stateRoot, resolved.codexHome, active, 'Installed state');
  assertTreeContained(skillsRoot, resolved.codexHome, active, 'Installed skills');
  return { ...resolved, activeHomes: active, runtimeRoot: canonicalPath(runtimeRoot), stateRoot: canonicalPath(stateRoot) };
}

function hashFile(target) {
  return crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
}

function fileInventory(root, { skipTopLevel = new Set() } = {}) {
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`Candidate tree is missing: ${root}`);
  }
  const inventory = new Map();
  const pending = [{ lexical: root, relative: '' }];
  while (pending.length) {
    const { lexical, relative } = pending.pop();
    for (const entry of fs.readdirSync(lexical, { withFileTypes: true })) {
      const nextRelative = relative ? path.join(relative, entry.name) : entry.name;
      if (!relative && skipTopLevel.has(entry.name)) continue;
      const target = path.join(lexical, entry.name);
      const lstat = fs.lstatSync(target);
      if (lstat.isSymbolicLink()) throw new Error(`Candidate binding refuses symbolic source: ${target}`);
      if (entry.isDirectory()) pending.push({ lexical: target, relative: nextRelative });
      else if (entry.isFile()) inventory.set(nextRelative.replaceAll(path.sep, '/'), hashFile(target));
      else throw new Error(`Candidate binding refuses non-file source: ${target}`);
    }
  }
  return inventory;
}

function assertInventory(label, expected, actual) {
  const expectedNames = [...expected.keys()].sort();
  const actualNames = [...actual.keys()].sort();
  if (JSON.stringify(expectedNames) !== JSON.stringify(actualNames)) {
    throw new Error(`${label} candidate file set mismatch`);
  }
  for (const name of expectedNames) {
    if (expected.get(name) !== actual.get(name)) {
      throw new Error(`${label} candidate hash mismatch: ${name}`);
    }
  }
}

function assertCandidateInstallation({ candidateRoot, codexHome, expectedSkillCount = null }) {
  const candidate = canonicalPath(candidateRoot);
  const installed = canonicalPath(codexHome);
  const manifestPath = path.join(candidate, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const skills = (manifest.skills || []).map((entry) => entry && entry.name);
  if (!skills.length || skills.some((name) => typeof name !== 'string' || !/^[a-z0-9-]+$/.test(name))) {
    throw new Error('Candidate manifest does not contain an exact owned skill set.');
  }
  if (new Set(skills).size !== skills.length ||
      (expectedSkillCount !== null && skills.length !== expectedSkillCount)) {
    throw new Error(`Candidate manifest skill count/identity mismatch: ${skills.length}`);
  }

  assertInventory(
    'Installed runtime',
    fileInventory(path.join(candidate, 'codex')),
    fileInventory(path.join(installed, 'dev-rigor-stack'), { skipTopLevel: new Set(['state', 'install-ownership-v2.json']) }),
  );
  for (const skill of skills) {
    assertInventory(
      `Installed skill ${skill}`,
      fileInventory(path.join(candidate, 'skills', skill)),
      fileInventory(path.join(installed, 'skills', skill)),
    );
  }
  return { candidateRoot: candidate, codexHome: installed, skills: [...skills].sort() };
}

function redactSensitive(value) {
  return String(value)
    .replace(/("(?:salt|access_token|refresh_token|id_token|api_key|secret)"\s*:\s*")[^"]*(")/gi, '$1[REDACTED]$2')
    .replace(/(\bAuthorization\s*:\s*Bearer\s+)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, 'sk-[REDACTED]');
}

function boundedRedactedAppend(current, chunk, limit = 8192) {
  const combined = `${current}${redactSensitive(chunk)}`;
  return combined.length <= limit ? combined : combined.slice(combined.length - limit);
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return Boolean(error && error.code === 'EPERM');
  }
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    let timer;
    const finish = (value) => {
      if (timer) clearTimeout(timer);
      child.removeListener('exit', exited);
      resolve(value);
    };
    const exited = () => finish(true);
    child.once('exit', exited);
    timer = setTimeout(() => finish(false), timeoutMs);
  });
}

async function terminateProcessTree(child, { graceMs = 2000 } = {}) {
  if (!child || !Number.isInteger(child.pid) || child.pid <= 0) return;
  if (!processAlive(child.pid)) {
    await waitForExit(child, graceMs);
    return;
  }
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore', timeout: Math.max(graceMs, 1000), windowsHide: true,
      });
    } catch (_) {
      try { child.kill('SIGTERM'); } catch (_) { /* already gone */ }
    }
  } else {
    try { process.kill(-child.pid, 'SIGTERM'); } catch (_) {
      try { child.kill('SIGTERM'); } catch (_) { /* already gone */ }
    }
    if (!(await waitForExit(child, graceMs))) {
      try { process.kill(-child.pid, 'SIGKILL'); } catch (_) {
        try { child.kill('SIGKILL'); } catch (_) { /* already gone */ }
      }
    }
  }
  await waitForExit(child, graceMs);
  if (processAlive(child.pid)) throw new Error(`Process tree did not terminate: ${child.pid}`);
}

const PLATFORM_TARGET = {
  'win32:x64': ['@openai/codex-win32-x64', 'x86_64-pc-windows-msvc', 'codex.exe'],
  'win32:arm64': ['@openai/codex-win32-arm64', 'aarch64-pc-windows-msvc', 'codex.exe'],
  'linux:x64': ['@openai/codex-linux-x64', 'x86_64-unknown-linux-musl', 'codex'],
  'linux:arm64': ['@openai/codex-linux-arm64', 'aarch64-unknown-linux-musl', 'codex'],
  'darwin:x64': ['@openai/codex-darwin-x64', 'x86_64-apple-darwin', 'codex'],
  'darwin:arm64': ['@openai/codex-darwin-arm64', 'aarch64-apple-darwin', 'codex'],
};

function resolveCodexBinary() {
  if (process.env.DEV_RIGOR_CODEX_BINARY) {
    const explicit = canonicalPath(process.env.DEV_RIGOR_CODEX_BINARY);
    if (!fs.existsSync(explicit) || !fs.statSync(explicit).isFile()) throw new Error('DEV_RIGOR_CODEX_BINARY is not an executable file.');
    return explicit;
  }
  const platform = PLATFORM_TARGET[`${process.platform}:${process.arch}`];
  if (!platform) throw new Error(`Unsupported Codex lifecycle platform: ${process.platform}/${process.arch}`);
  const [packageName, triple, executable] = platform;
  const packageRoots = [];
  if (process.env.CODEX_MANAGED_PACKAGE_ROOT) packageRoots.push(process.env.CODEX_MANAGED_PACKAGE_ROOT);
  try {
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const globalRoot = execFileSync(npm, ['root', '-g'], { encoding: 'utf8', timeout: 5000, windowsHide: true }).trim();
    if (globalRoot) packageRoots.push(path.join(globalRoot, '@openai', 'codex'));
  } catch (_) { /* explicit path remains available */ }
  for (const packageRoot of packageRoots) {
    for (const vendorRoot of [
      path.join(packageRoot, 'node_modules', packageName, 'vendor'),
      path.join(packageRoot, 'vendor'),
    ]) {
      const target = path.join(vendorRoot, triple, 'bin', executable);
      if (fs.existsSync(target) && fs.statSync(target).isFile()) return canonicalPath(target);
    }
  }
  throw new Error('Could not resolve the native Codex executable; set DEV_RIGOR_CODEX_BINARY explicitly.');
}

function spawnCodexAppServer(binary, env) {
  return spawn(binary, ['app-server'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env,
    detached: process.platform !== 'win32',
    windowsHide: true,
  });
}

module.exports = {
  assertCandidateInstallation,
  assertLifecycleIsolation,
  boundedRedactedAppend,
  canonicalPath,
  pathContains,
  pathsOverlap,
  processAlive,
  redactSensitive,
  resolveCodexBinary,
  spawnCodexAppServer,
  terminateProcessTree,
  waitForExit,
};
