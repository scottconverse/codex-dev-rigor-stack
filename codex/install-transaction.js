#!/usr/bin/env node
'use strict';

// Cross-platform transactional installer/uninstaller for Dev Rigor Stack.
// This process is the only owner of active filesystem mutations. PowerShell
// and POSIX entrypoints are intentionally thin argument adapters.

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const VERSION = '1.7.0';
const OWNERSHIP_SCHEMA = 'dev-rigor-install-ownership-v2';
const JOURNAL_SCHEMA = 'dev-rigor-install-transaction-v1';
const BACKUP_MARKER_SCHEMA = 'dev-rigor-backup-owner-v1';
const BACKUP_MARKER = '.dev-rigor-backup-owner-v1.json';
const TRUST_OUTCOME_SCHEMA = 'dev-rigor-trust-revocation-outcome-v1';
const RELEASE_DIRECTORY = '.dev-rigor-stack-transaction-release-v1';
const TRANSACTION_ID = /^[0-9]{8}-[0-9]{6}-[0-9]+-[a-f0-9]{32}$/;
const HASH = /^[a-f0-9]{64}$/;
const SKILLS = Object.freeze([
  'dev-rigor-stack', 'dev-rigor-stack-continuity', 'dev-rigor-stack-plan',
  'dev-rigor-stack-build', 'dev-rigor-stack-proof-gate', 'dev-rigor-stack-audit-lite',
  'dev-rigor-stack-audit-team', 'dev-rigor-stack-walkthrough',
  'dev-rigor-stack-visitor-audit', 'dev-rigor-stack-gauntletgate',
  'dev-rigor-stack-merge-gate', 'dev-rigor-stack-docs-gate',
  'dev-rigor-stack-release', 'coder-tdd-qa', 'proof-gate', 'audit-lite',
  'audit-team', 'gauntletgate', 'visitor-audit',
]);
// Markerless releases are eligible for migration only when every shipped
// runtime and skill byte matches one immutable archived installation. These
// are aggregate, length-framed footprints of 1.6.1 e1e22a2, 1.6.2 89c5d0d,
// 1.6.3 91c8d7f, PR9 1941c2d4..., and PR11 4ba16f8f... respectively.
const LEGACY_INSTALL_FOOTPRINTS = new Set([
  '2f752d2300a77584bffb67404d4898d07144eeed53b306e190c92ea622bcd22f',
  '9887e8f49d330558abcdae3195041381b03d295b5aef52a7c20c297eeec71766',
  'd088906e1ad63f9dcb5c295c4189ecc2d65cecf52a4f64006791bce133964330',
  '346b7b7e7c4761e8b4ae2669795b2e583e803d94c6cfa8fd2170909f92f271c4',
  '1b9e2977e2d0731cb43cebb5c9052f1d9e6cfa59e8cc6405bc61902b934fcaeb',
]);
const CREATED_KEYS = Object.freeze([
  'homeBackupNamespace', 'homeBackupParent', 'hooksConfig',
  'skillsBackupNamespace', 'skillsBackupParent', 'skillsDirectory',
]);
const SCAFFOLD_KEYS = Object.freeze([
  'home', 'transactionsParent', 'transactionsNamespace', 'journalParent',
  'stageParent', 'stageNamespace', 'rollbackParent', 'rollbackNamespace',
]);
const GENESIS_PREFIX = 'task-genesis-v4-';
const GENESIS_FILE = /^task-genesis-v4-[a-f0-9]{64}\.json$/;
const TASK_PREFIX = 'task-v4-';
const TASK_FILE = /^task-v4-([a-f0-9]{64})\.json$/;
const EVIDENCE_PREFIX = 'evidence-v4-';
const EVIDENCE_FILE = /^evidence-v4-[a-f0-9]{16}\.json$/;
const STATE_FILE = /^(?:(?:task|pre)-v4-[a-f0-9]{64}\.json|task-genesis-v4-[a-f0-9]{64}\.json|evidence-v4-[a-f0-9]{16}\.json|(?:mechanical|ground|router)-v4-[a-f0-9]{64}\.log)$/;
const EXEC_RECEIPT = /^exec-v4-[a-f0-9]{64}\.receipt$/;
const STATE_DIRECTORIES = new Set([
  'associations-v4', 'association-debt-v4', 'association-resolutions-v4',
]);

class TransactionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TransactionError';
    this.code = code;
  }
}

function object(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, keys) {
  return object(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function sha256Bytes(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hookHash(value) {
  return crypto.createHash('sha256').update(String(value)).update('\0').digest('hex');
}

function fileHash(file) {
  return sha256Bytes(fs.readFileSync(file));
}

function normalize(input) {
  let result = path.resolve(String(input));
  if (process.platform === 'win32') result = result.toLowerCase();
  return result;
}

function canonicalPath(input) {
  let cursor = path.resolve(String(input));
  const missing = [];
  while (!fs.existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    missing.unshift(path.basename(cursor));
    cursor = parent;
  }
  try { cursor = fs.realpathSync.native(cursor); } catch { cursor = path.resolve(cursor); }
  return normalize(path.join(cursor, ...missing));
}

function identity(input) {
  return sha256Bytes(Buffer.from(canonicalPath(input), 'utf8'));
}

function nearestExisting(input) {
  let cursor = path.resolve(input);
  while (!fs.existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) throw new TransactionError('PATH', `no existing ancestor for ${input}`);
    cursor = parent;
  }
  return cursor;
}

function sameDevice(first, second) {
  const left = fs.statSync(nearestExisting(first));
  const right = fs.statSync(nearestExisting(second));
  return String(left.dev) === String(right.dev);
}

function assertNotLink(target, label) {
  if (!fs.existsSync(target)) return;
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink()) throw new TransactionError('LINK', `${label} is a symbolic link or junction: ${target}`);
}

function ensureDirectory(directory, mode = 0o700) {
  fs.mkdirSync(directory, { recursive: true, mode });
}

function removeEmpty(directory) {
  try { fs.rmdirSync(directory); return true; }
  catch (error) {
    if (error && ['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) return false;
    throw error;
  }
}

function fsyncDirectory(directory) {
  if (process.platform === 'win32') return;
  let descriptor;
  try {
    descriptor = fs.openSync(directory, 'r');
    fs.fsyncSync(descriptor);
  } catch {}
  finally { if (descriptor !== undefined) try { fs.closeSync(descriptor); } catch {} }
}

function writeNewDurable(file, value) {
  ensureDirectory(path.dirname(file));
  const descriptor = fs.openSync(file, 'wx', 0o600);
  try {
    const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    let offset = 0;
    while (offset < bytes.length) offset += fs.writeSync(descriptor, bytes, offset, bytes.length - offset);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fsyncDirectory(path.dirname(file));
}

function writeAtomic(file, value) {
  ensureDirectory(path.dirname(file));
  const temporary = `${file}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  writeNewDurable(temporary, value);
  try {
    fs.renameSync(temporary, file);
    fsyncDirectory(path.dirname(file));
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch {}
    throw error;
  }
}

function copyFileNewDurable(source, destination) {
  ensureDirectory(path.dirname(destination));
  const bytes = fs.readFileSync(source);
  const descriptor = fs.openSync(destination, 'wx', 0o600);
  try {
    let offset = 0;
    while (offset < bytes.length) offset += fs.writeSync(descriptor, bytes, offset, bytes.length - offset);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fsyncDirectory(path.dirname(destination));
}

function readJson(file, label = file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
  catch (error) { throw new TransactionError('JSON', `${label} is not valid JSON: ${error.message}`); }
}

function timestampId() {
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  return `${stamp.slice(0, 8)}-${stamp.slice(8)}-${process.pid}-${crypto.randomBytes(16).toString('hex')}`;
}

function transactionPaths(home, id = null) {
  const transactionsParent = path.join(home, '.transactions');
  const transactionsNamespace = path.join(transactionsParent, 'dev-rigor-stack');
  const stageParent = path.join(home, '.staging');
  const stageNamespace = path.join(stageParent, 'dev-rigor-stack');
  const rollbackParent = path.join(home, '.rollback');
  const rollbackNamespace = path.join(rollbackParent, 'dev-rigor-stack');
  const result = {
    transactionsParent, transactionsNamespace,
    stageParent, stageNamespace,
    rollbackParent, rollbackNamespace,
    lock: path.join(transactionsNamespace, 'lock'),
    journalParent: path.join(transactionsNamespace, 'journals'),
  };
  if (id) {
    result.stage = path.join(stageNamespace, id);
    result.rollback = path.join(rollbackNamespace, id);
    result.journal = path.join(result.journalParent, id);
  }
  return result;
}

function activePaths(home, target) {
  return {
    home,
    target,
    runtime: path.join(home, 'dev-rigor-stack'),
    hooks: path.join(home, 'hooks.json'),
    trust: path.join(home, 'config.toml'),
    homeBackupParent: path.join(home, '.backup'),
    homeBackupNamespace: path.join(home, '.backup', 'codex-dev-rigor-stack'),
    skillsBackupParent: path.join(target, '.backup'),
    skillsBackupNamespace: path.join(target, '.backup', 'codex-dev-rigor-stack'),
  };
}

function snapshotExistence(paths) {
  return Object.fromEntries(Object.entries(paths).map(([key, value]) => [key, fs.existsSync(value)]));
}

function hookSnapshot(file) {
  return fs.existsSync(file) ? { exists: true, hash: fileHash(file) } : { exists: false, hash: null };
}

function hookSnapshotEqual(left, right) {
  return left.exists === right.exists && left.hash === right.hash;
}

function strictHooksEmpty(file) {
  const value = readJson(file, 'staged hooks.json');
  return exactKeys(value, ['hooks']) && exactKeys(value.hooks, []);
}

function walkTree(root, relative = '', entries = [], excludeMarker = false) {
  const current = relative ? path.join(root, relative) : root;
  const stat = fs.lstatSync(current);
  if (stat.isSymbolicLink()) throw new TransactionError('LINK', `managed tree contains a symbolic link: ${current}`);
  if (relative && excludeMarker && relative.replace(/\\/g, '/') === BACKUP_MARKER) return entries;
  if (stat.isDirectory()) {
    if (relative) entries.push({ type: 'D', relative: relative.replace(/\\/g, '/') });
    for (const name of fs.readdirSync(current).sort()) walkTree(root, path.join(relative, name), entries, excludeMarker);
  } else if (stat.isFile()) {
    entries.push({ type: 'F', relative: relative.replace(/\\/g, '/'), bytes: fs.readFileSync(current) });
  } else {
    throw new TransactionError('TYPE', `unsupported managed filesystem object: ${current}`);
  }
  return entries;
}

function digestField(digest, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
  const length = Buffer.alloc(8);
  length.writeBigUInt64BE(BigInt(bytes.length));
  digest.update(length);
  digest.update(bytes);
}

function digestRecord(digest, type, relative, bytes = null) {
  digestField(digest, type);
  digestField(digest, relative);
  if (type === 'F') digestField(digest, bytes);
}

function treeDigest(root, excludeMarker = false) {
  const digest = crypto.createHash('sha256');
  digestField(digest, 'dev-rigor-tree-digest-v2');
  for (const entry of walkTree(root, '', [], excludeMarker)) {
    digestRecord(digest, entry.type, entry.relative, entry.bytes);
  }
  return digest.digest('hex');
}

function managedRuntimeDigest(root) {
  const digest = crypto.createHash('sha256');
  digestField(digest, 'dev-rigor-managed-runtime-digest-v2');
  function visit(relative = '') {
    const current = relative ? path.join(root, relative) : root;
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) throw new TransactionError('LINK', `managed runtime contains a symbolic link: ${current}`);
    const portable = relative.replace(/\\/g, '/');
    if (portable && !portable.includes('/') && ['state', 'install-ownership-v2.json'].includes(portable)) return;
    if (stat.isDirectory()) {
      if (portable) digestRecord(digest, 'D', portable);
      for (const name of fs.readdirSync(current).sort()) visit(path.join(relative, name));
    } else if (stat.isFile()) {
      digestRecord(digest, 'F', portable, fs.readFileSync(current));
    } else {
      throw new TransactionError('TYPE', `unsupported managed runtime object: ${current}`);
    }
  }
  visit();
  return digest.digest('hex');
}

function legacyInstallFootprint(runtime, target) {
  if (!fs.existsSync(runtime) || !fs.lstatSync(runtime).isDirectory()) return null;
  const digest = crypto.createHash('sha256');
  digestField(digest, 'dev-rigor-legacy-install-footprint-v1');
  digestField(digest, managedRuntimeDigest(runtime));
  for (const name of SKILLS) {
    const skill = path.join(target, name);
    if (!fs.existsSync(skill) || !fs.lstatSync(skill).isDirectory()) return null;
    digestField(digest, name);
    digestField(digest, treeDigest(skill));
  }
  return digest.digest('hex');
}

function copyTree(source, destination) {
  assertNotLink(source, 'copy source');
  if (fs.existsSync(destination)) throw new TransactionError('EXISTS', `copy destination already exists: ${destination}`);
  ensureDirectory(path.dirname(destination));
  fs.cpSync(source, destination, { recursive: true, force: false, errorOnExist: true, dereference: false });
  treeDigest(destination);
}

function removeTree(target) {
  if (!fs.existsSync(target)) return;
  assertNotLink(target, 'remove target');
  fs.rmSync(target, { recursive: true, force: false });
}

function move(source, destination) {
  if (!fs.existsSync(source)) throw new TransactionError('MISSING', `move source is missing: ${source}`);
  if (fs.existsSync(destination)) throw new TransactionError('EXISTS', `move destination exists: ${destination}`);
  assertNotLink(source, 'move source');
  ensureDirectory(path.dirname(destination));
  fs.renameSync(source, destination);
  fsyncDirectory(path.dirname(source));
  fsyncDirectory(path.dirname(destination));
}

function parseArgs(argv) {
  const operation = argv.shift();
  if (!['install', 'uninstall', 'recover-only'].includes(operation)) {
    throw new TransactionError('USAGE', 'usage: install-transaction.js install|uninstall|recover-only --codex-home DIR [options]');
  }
  const values = { operation, backup: true, skipTrust: false };
  while (argv.length) {
    const flag = argv.shift();
    if (flag === '--no-backup') values.backup = false;
    else if (flag === '--skip-trust-revocation') values.skipTrust = true;
    else if (['--repo', '--codex-home', '--target'].includes(flag)) {
      if (!argv.length) throw new TransactionError('USAGE', `${flag} requires a value`);
      values[flag === '--repo' ? 'repo' : flag === '--codex-home' ? 'home' : 'target'] = path.resolve(argv.shift());
    } else throw new TransactionError('USAGE', `unknown option: ${flag}`);
  }
  if (!values.home) throw new TransactionError('USAGE', '--codex-home is required');
  values.target = values.target || path.join(values.home, 'skills');
  if (operation === 'install' && !values.repo) throw new TransactionError('USAGE', 'install requires --repo');
  if (values.skipTrust && !process.env.CI) throw new TransactionError('USAGE', '--skip-trust-revocation is restricted to CI');
  return values;
}

function containsPath(parent, child) {
  const left = canonicalPath(parent);
  const right = canonicalPath(child);
  const relative = path.relative(left, right);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function validateOptionPaths(options) {
  const home = canonicalPath(options.home);
  const target = canonicalPath(options.target);
  const defaultTarget = canonicalPath(path.join(options.home, 'skills'));
  if (home === target || containsPath(target, home)) {
    throw new TransactionError('PATH', 'skills target must not equal or contain the Codex home');
  }
  if (containsPath(home, target) && target !== defaultTarget) {
    throw new TransactionError('PATH', 'a skills target inside Codex home must be the exact skills directory');
  }
  if (options.operation === 'install') {
    const repo = canonicalPath(options.repo);
    if (containsPath(repo, home) || containsPath(home, repo)
        || containsPath(repo, target) || containsPath(target, repo)) {
      throw new TransactionError('PATH', 'repository, Codex home, and skills target must not overlap');
    }
  }
}

function barrier(operation, name) {
  if (!process.env.CI) return;
  const crash = process.env.DEV_RIGOR_TXN_CRASH_AT;
  const pause = process.env.DEV_RIGOR_TXN_PAUSE_AT;
  const matches = (value) => value === name || value === `${operation}:${name}`;
  if (matches(crash)) process.exit(86);
  if (!matches(pause)) return;
  const control = process.env.DEV_RIGOR_TXN_CONTROL_DIR;
  if (!control) throw new TransactionError('BARRIER', 'pause barrier requires DEV_RIGOR_TXN_CONTROL_DIR');
  ensureDirectory(control);
  const raw = String(pause).replace(/:/g, '_');
  const ready = [path.join(control, `${name}.ready`), path.join(control, `${raw}.ready`)];
  const proceed = [path.join(control, `${name}.continue`), path.join(control, `${raw}.continue`)];
  for (const file of new Set(ready)) fs.writeFileSync(file, 'ready\n');
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (proceed.some((file) => fs.existsSync(file))) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
  }
  throw new TransactionError('BARRIER', `pause barrier timed out: ${name}`);
}

function emptyCreated() {
  return Object.fromEntries(CREATED_KEYS.map((key) => [key, false]));
}

function validScope(scope) {
  return exactKeys(scope, ['present', 'digest'])
    && typeof scope.present === 'boolean'
    && (scope.present ? HASH.test(scope.digest) : scope.digest === null);
}

function validInstalled(value) {
  if (!exactKeys(value, ['runtime', 'skills']) || !HASH.test(value.runtime) || !object(value.skills)) return false;
  if (JSON.stringify(Object.keys(value.skills).sort()) !== JSON.stringify([...SKILLS].sort())) return false;
  return SKILLS.every((name) => HASH.test(value.skills[name]));
}

function validateOwnership(value, home, target) {
  if (!exactKeys(value, ['schema', 'lineage', 'codexHomeIdentity', 'targetIdentity', 'created', 'backups', 'installed'])) return false;
  if (value.schema !== OWNERSHIP_SCHEMA || !/^[a-f0-9]{32}$/.test(value.lineage)) return false;
  if (value.codexHomeIdentity !== identity(home) || value.targetIdentity !== identity(target)) return false;
  if (!exactKeys(value.created, CREATED_KEYS) || !CREATED_KEYS.every((key) => typeof value.created[key] === 'boolean')) return false;
  if (!Array.isArray(value.backups) || !validInstalled(value.installed)) return false;
  const seen = new Set();
  for (const backup of value.backups) {
    if (!exactKeys(backup, ['id', 'skills', 'home']) || !TRANSACTION_ID.test(backup.id) || seen.has(backup.id)) return false;
    if (!validScope(backup.skills) || !validScope(backup.home) || (!backup.skills.present && !backup.home.present)) return false;
    seen.add(backup.id);
  }
  return true;
}

function readOwnership(runtime, home, target, purpose = 'install') {
  const marker = path.join(runtime, 'install-ownership-v2.json');
  if (fs.existsSync(marker)) {
    const value = readJson(marker, 'install ownership metadata');
    if (!validateOwnership(value, home, target)) {
      throw new TransactionError('OWNERSHIP', 'install ownership metadata is invalid or belongs to a different home/target');
    }
    return value;
  }
  const legacy = path.join(runtime, 'install-ownership-v1.json');
  if (fs.existsSync(legacy)) {
    const value = readJson(legacy, 'legacy install ownership metadata');
    if (!object(value) || value.schema !== 'dev-rigor-install-ownership-v1'
        || value.codexHomeIdentity !== identity(home) || value.targetIdentity !== identity(target)
        || !object(value.created)) {
      throw new TransactionError('OWNERSHIP', 'legacy install ownership metadata is invalid or path-mismatched');
    }
    const created = emptyCreated();
    for (const key of CREATED_KEYS) if (typeof value.created[key] === 'boolean') created[key] = value.created[key];
    if (purpose === 'uninstall') {
      throw new TransactionError('OWNERSHIP', 'legacy ownership must be upgraded before uninstall');
    }
    return {
      schema: OWNERSHIP_SCHEMA,
      lineage: /^[a-f0-9]{32}$/.test(value.lineage || '') ? value.lineage : crypto.randomBytes(16).toString('hex'),
      codexHomeIdentity: identity(home), targetIdentity: identity(target), created, backups: [], installed: null,
    };
  }
  if (fs.existsSync(runtime)) {
    const footprint = legacyInstallFootprint(runtime, target);
    if (footprint && LEGACY_INSTALL_FOOTPRINTS.has(footprint)) {
      if (purpose === 'uninstall') {
        throw new TransactionError('OWNERSHIP',
          'markerless legacy ownership must be upgraded before uninstall');
      }
      return {
        schema: OWNERSHIP_SCHEMA,
        lineage: crypto.randomBytes(16).toString('hex'),
        codexHomeIdentity: identity(home), targetIdentity: identity(target),
        created: emptyCreated(), backups: [], installed: null,
      };
    }
    throw new TransactionError('OWNERSHIP',
      'existing managed runtime is missing exact v1/v2 ownership metadata; refusing to overwrite it');
  }
  if (purpose === 'uninstall') {
    throw new TransactionError('OWNERSHIP', 'installed ownership metadata is missing; refusing destructive uninstall');
  }
  return {
    schema: OWNERSHIP_SCHEMA,
    lineage: crypto.randomBytes(16).toString('hex'),
    codexHomeIdentity: identity(home), targetIdentity: identity(target),
    created: emptyCreated(), backups: [], installed: null,
  };
}

function writeOwnership(runtime, ownership, home, target) {
  if (!validateOwnership(ownership, home, target)) {
    throw new TransactionError('OWNERSHIP', 'refusing to write invalid install ownership metadata');
  }
  writeAtomic(path.join(runtime, 'install-ownership-v2.json'), ownership);
}

function backupMarker(lineage, id, scope, digest) {
  return { schema: BACKUP_MARKER_SCHEMA, lineage, id, scope, digest };
}

function validateBackupDirectory(directory, ownership, entry, scope) {
  const scopeRecord = entry[scope];
  if (!scopeRecord.present || !fs.existsSync(directory)) return false;
  const markerPath = path.join(directory, BACKUP_MARKER);
  if (!fs.existsSync(markerPath)) return false;
  const markerStat = fs.lstatSync(markerPath);
  if (!markerStat.isFile() || markerStat.isSymbolicLink()) return false;
  let marker;
  try { marker = readJson(markerPath, 'backup owner marker'); } catch { return false; }
  if (!exactKeys(marker, ['schema', 'lineage', 'id', 'scope', 'digest'])) return false;
  if (marker.schema !== BACKUP_MARKER_SCHEMA || marker.lineage !== ownership.lineage
      || marker.id !== entry.id || marker.scope !== scope || marker.digest !== scopeRecord.digest) return false;
  return treeDigest(directory, true) === scopeRecord.digest;
}

function pidAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error && error.code === 'EPERM'; }
}

function scaffoldBaseline(home) {
  const paths = transactionPaths(home);
  return {
    home: fs.existsSync(home),
    transactionsParent: fs.existsSync(paths.transactionsParent),
    transactionsNamespace: fs.existsSync(paths.transactionsNamespace),
    journalParent: fs.existsSync(paths.journalParent),
    stageParent: fs.existsSync(paths.stageParent),
    stageNamespace: fs.existsSync(paths.stageNamespace),
    rollbackParent: fs.existsSync(paths.rollbackParent),
    rollbackNamespace: fs.existsSync(paths.rollbackNamespace),
  };
}

function releasePath(home) {
  return path.join(home, RELEASE_DIRECTORY);
}

function releaseTombstonePath(home) {
  return `${home}.dev-rigor-stack-transaction-release-v1`;
}

function validScaffoldBaseline(value) {
  return exactKeys(value, SCAFFOLD_KEYS)
    && SCAFFOLD_KEYS.every((key) => typeof value[key] === 'boolean');
}

function readReleaseOwner(directory, home, target) {
  assertNotLink(directory, 'transaction release intent');
  if (!fs.lstatSync(directory).isDirectory()) {
    throw new TransactionError('RELEASE', `transaction release intent is not a directory: ${directory}`);
  }
  const entries = fs.readdirSync(directory).sort();
  if (JSON.stringify(entries) !== JSON.stringify(['owner.json'])) {
    throw new TransactionError('RELEASE', `transaction release intent contains unrecognized data: ${directory}`);
  }
  const owner = readJson(path.join(directory, 'owner.json'), 'transaction release owner');
  if (!exactKeys(owner, [
    'schema', 'pid', 'nonce', 'createdAt', 'homeIdentity', 'targetIdentity', 'baseline',
  ]) || owner.schema !== JOURNAL_SCHEMA || !Number.isSafeInteger(owner.pid) || owner.pid <= 0
      || !/^[a-f0-9]{32}$/.test(owner.nonce || '') || typeof owner.createdAt !== 'string'
      || owner.homeIdentity !== identity(home) || owner.targetIdentity !== identity(target)
      || !validScaffoldBaseline(owner.baseline)) {
    throw new TransactionError('RELEASE', 'transaction release owner is invalid or path-mismatched');
  }
  return owner;
}

function finishReleaseIntent(home, target, owner) {
  const intent = releasePath(home);
  const tombstone = releaseTombstonePath(home);
  cleanTransactionScaffolds(home, owner.baseline);
  const current = readReleaseOwner(intent, home, target);
  if (current.nonce !== owner.nonce) {
    throw new TransactionError('RELEASE', 'transaction release ownership changed during cleanup');
  }
  if (!owner.baseline.home) {
    const entries = fs.readdirSync(home).sort();
    if (JSON.stringify(entries) === JSON.stringify([RELEASE_DIRECTORY])) {
      if (fs.existsSync(tombstone)) {
        throw new TransactionError('RELEASE', `transaction release tombstone already exists: ${tombstone}`);
      }
      fs.renameSync(home, tombstone);
      fsyncDirectory(path.dirname(home));
      barrier('transaction', 'after-home-tombstone');
      const nested = path.join(tombstone, RELEASE_DIRECTORY);
      const movedOwner = readReleaseOwner(nested, home, target);
      if (movedOwner.nonce !== owner.nonce || movedOwner.baseline.home) {
        throw new TransactionError('RELEASE', 'transaction release tombstone identity changed');
      }
      removeTree(tombstone);
      fsyncDirectory(path.dirname(home));
      return;
    }
  }
  fs.unlinkSync(path.join(intent, 'owner.json'));
  removeEmpty(intent);
  fsyncDirectory(home);
  cleanTransactionScaffolds(home, owner.baseline);
}

function recoverReleaseIntent(home, target) {
  const intent = releasePath(home);
  const tombstone = releaseTombstonePath(home);
  if (fs.existsSync(tombstone)) {
    if (fs.existsSync(home)) {
      throw new TransactionError('RELEASE', 'both the profile and its transaction release tombstone exist');
    }
    assertNotLink(tombstone, 'transaction release tombstone');
    const entries = fs.readdirSync(tombstone).sort();
    if (JSON.stringify(entries) !== JSON.stringify([RELEASE_DIRECTORY])) {
      throw new TransactionError('RELEASE', 'transaction release tombstone contains unrecognized data');
    }
    const owner = readReleaseOwner(path.join(tombstone, RELEASE_DIRECTORY), home, target);
    if (owner.baseline.home || pidAlive(owner.pid)) {
      throw new TransactionError('LOCKED', 'transaction release tombstone is active or has an invalid origin');
    }
    removeTree(tombstone);
    fsyncDirectory(path.dirname(home));
  }
  if (!fs.existsSync(intent)) return;
  const owner = readReleaseOwner(intent, home, target);
  if (pidAlive(owner.pid)) {
    throw new TransactionError('LOCKED', `transaction release cleanup is held by process ${owner.pid}`);
  }
  finishReleaseIntent(home, target, owner);
}

function claimStaleLock(lockPath, nonce) {
  const claim = path.join(lockPath, 'recovery-claim');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fs.mkdirSync(claim);
      writeNewDurable(path.join(claim, 'owner.json'), { pid: process.pid, nonce, createdAt: new Date().toISOString() });
      return;
    } catch (error) {
      if (!error || error.code !== 'EEXIST') throw error;
      let owner = null;
      for (let probe = 0; probe < 4 && !owner; probe += 1) {
        try { owner = readJson(path.join(claim, 'owner.json'), 'recovery claim owner'); } catch {}
        if (!owner) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
      }
      if (owner && pidAlive(owner.pid)) {
        throw new TransactionError('LOCKED', `Dev Rigor transaction recovery is held by process ${owner.pid}`);
      }
      const entries = fs.readdirSync(claim);
      if (entries.some((name) => name !== 'owner.json')) {
        throw new TransactionError('LOCKED', 'stale recovery claim contains unrecognized data; refusing to erase it');
      }
      if (fs.existsSync(path.join(claim, 'owner.json'))) fs.unlinkSync(path.join(claim, 'owner.json'));
      removeEmpty(claim);
    }
  }
  throw new TransactionError('LOCKED', 'could not claim the stale Dev Rigor transaction lock');
}

function acquireLock(home, target) {
  recoverReleaseIntent(home, target);
  let baseline = scaffoldBaseline(home);
  const paths = transactionPaths(home);
  ensureDirectory(paths.transactionsNamespace);
  let recovered = false;
  const nonce = crypto.randomBytes(16).toString('hex');
  try {
    fs.mkdirSync(paths.lock);
    barrier('transaction', 'after-lock-directory');
  } catch (error) {
    if (!error || error.code !== 'EEXIST') throw error;
    const ownerPath = path.join(paths.lock, 'owner.json');
    let prior = null;
    try { prior = readJson(ownerPath, 'transaction lock owner'); } catch {}
    if (!prior) {
      const age = Date.now() - fs.statSync(paths.lock).mtimeMs;
      if (age < 30000) {
        throw new TransactionError('LOCKED', 'Dev Rigor transaction lock owner is still initializing');
      }
    }
    if (prior && pidAlive(prior.pid)) {
      throw new TransactionError('LOCKED', `Dev Rigor transaction lock is held by process ${prior.pid}`);
    }
    if (prior && object(prior.baseline)) baseline = prior.baseline;
    claimStaleLock(paths.lock, nonce);
    let observed = null;
    try { observed = readJson(ownerPath, 'transaction lock owner after recovery claim'); } catch {}
    if (observed && (observed.nonce !== (prior && prior.nonce) || pidAlive(observed.pid))) {
      const claim = path.join(paths.lock, 'recovery-claim');
      try { fs.unlinkSync(path.join(claim, 'owner.json')); } catch {}
      removeEmpty(claim);
      throw new TransactionError('LOCKED', 'transaction lock ownership changed during stale recovery');
    }
    recovered = true;
  }
  const owner = {
    schema: JOURNAL_SCHEMA,
    pid: process.pid,
    nonce,
    createdAt: new Date().toISOString(),
    homeIdentity: identity(home),
    targetIdentity: identity(target),
    baseline,
  };
  writeAtomic(path.join(paths.lock, 'owner.json'), owner);
  return { home, target, paths, nonce, baseline, recovered };
}

function cleanTransactionScaffolds(home, baseline, id = null) {
  const paths = transactionPaths(home, id);
  if (id) {
    if (fs.existsSync(paths.stage)) removeTree(paths.stage);
    if (fs.existsSync(paths.rollback)) removeTree(paths.rollback);
    if (fs.existsSync(paths.journal)) removeTree(paths.journal);
  }
  if (!baseline.stageNamespace) removeEmpty(paths.stageNamespace);
  if (!baseline.stageParent) removeEmpty(paths.stageParent);
  if (!baseline.rollbackNamespace) removeEmpty(paths.rollbackNamespace);
  if (!baseline.rollbackParent) removeEmpty(paths.rollbackParent);
  if (!baseline.journalParent) removeEmpty(paths.journalParent);
  if (!baseline.transactionsNamespace) removeEmpty(paths.transactionsNamespace);
  if (!baseline.transactionsParent) removeEmpty(paths.transactionsParent);
  if (!baseline.home) removeEmpty(home);
}

function releaseLock(lock, baselineOverride = null) {
  const cleanupBaseline = baselineOverride || lock.baseline;
  cleanTransactionScaffolds(lock.home, cleanupBaseline);
  const ownerPath = path.join(lock.paths.lock, 'owner.json');
  if (fs.existsSync(ownerPath)) {
    const owner = readJson(ownerPath, 'transaction lock owner');
    if (owner.nonce !== lock.nonce) throw new TransactionError('LOCKED', 'transaction lock ownership changed');
  }
  const claim = path.join(lock.paths.lock, 'recovery-claim');
  if (fs.existsSync(claim)) {
    const claimOwner = path.join(claim, 'owner.json');
    if (fs.existsSync(claimOwner)) fs.unlinkSync(claimOwner);
    removeEmpty(claim);
  }
  const intent = releasePath(lock.home);
  const tombstone = releaseTombstonePath(lock.home);
  if (fs.existsSync(intent) || fs.existsSync(tombstone)) {
    throw new TransactionError('RELEASE', 'transaction release destination already exists');
  }
  move(lock.paths.lock, intent);
  barrier('transaction', 'after-lock-removal');
  const owner = readReleaseOwner(intent, lock.home, lock.target);
  if (owner.nonce !== lock.nonce || JSON.stringify(owner.baseline) !== JSON.stringify(cleanupBaseline)) {
    throw new TransactionError('RELEASE', 'transaction release intent does not match the active lock');
  }
  finishReleaseIntent(lock.home, lock.target, owner);
}

function journalFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory)
    .filter((name) => /^\d{8}\.json$/.test(name))
    .sort().reverse();
}

function loadJournal(lock) {
  const parent = lock.paths.journalParent;
  if (!fs.existsSync(parent)) return null;
  const ids = fs.readdirSync(parent).filter((name) => TRANSACTION_ID.test(name) && fs.statSync(path.join(parent, name)).isDirectory());
  if (ids.length === 0) return null;
  if (ids.length !== 1) throw new TransactionError('JOURNAL', `multiple transaction journals require manual review: ${ids.join(', ')}`);
  const directory = path.join(parent, ids[0]);
  const files = journalFiles(directory);
  if (!files.length) throw new TransactionError('JOURNAL', `no durable journal snapshot exists for ${ids[0]}`);
  const name = files[0];
  const value = readJson(path.join(directory, name), 'latest transaction journal');
  const expectedSequence = Number.parseInt(path.basename(name, '.json'), 10);
  if (value.schema !== JOURNAL_SCHEMA || value.id !== ids[0] || value.homeIdentity !== identity(lock.home)
      || value.targetIdentity !== identity(lock.target) || value.sequence !== expectedSequence) {
    throw new TransactionError('JOURNAL', `latest durable journal snapshot is invalid for ${ids[0]}`);
  }
  return value;
}

function persistJournal(journal) {
  journal.sequence = (journal.sequence || 0) + 1;
  const paths = transactionPaths(journal.homePath, journal.id);
  ensureDirectory(paths.journal);
  const file = path.join(paths.journal, `${String(journal.sequence).padStart(8, '0')}.json`);
  writeNewDurable(file, journal);
}

function setPhase(journal, phase) {
  journal.phase = phase;
  persistJournal(journal);
}

function setStep(journal, name, state) {
  journal.steps[name] = state;
  persistJournal(journal);
}

function newJournal(operation, lock) {
  const id = timestampId();
  const paths = transactionPaths(lock.home, id);
  const active = activePaths(lock.home, lock.target);
  const journal = {
    schema: JOURNAL_SCHEMA,
    id,
    operation,
    phase: 'PREPARING',
    sequence: 0,
    homeIdentity: identity(lock.home),
    targetIdentity: identity(lock.target),
    homePath: lock.home,
    targetPath: lock.target,
    baselineScaffolds: lock.baseline,
    baselineActive: snapshotExistence(active),
    hooksBefore: hookSnapshot(active.hooks),
    trustBefore: hookSnapshot(active.trust),
    hookAction: 'none',
    hooksAfter: null,
    trustAfter: null,
    baselineDigests: { skills: {}, runtime: null },
    preparedDigests: { skills: {}, runtime: null },
    verifiedTools: { wire: null, revoker: null },
    backupPlan: null,
    movedBackups: [],
    created: [],
    steps: {},
    warnings: [],
  };
  persistJournal(journal);
  ensureDirectory(paths.stage);
  ensureDirectory(paths.rollback);
  return journal;
}

function runNode(script, args, label) {
  try {
    return execFileSync(process.execPath, [script, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
      windowsHide: true,
    });
  } catch (error) {
    const detail = String(error && error.stderr || '').trim().slice(0, 1000);
    throw new TransactionError('CHILD', `${label} failed${detail ? `: ${detail}` : ''}`);
  }
}

function selectedRuntimeState(source, discarded = new Set()) {
  return fs.readdirSync(source).filter((name) => !discarded.has(name)).sort();
}

function validTaskState(task, expectedKey, legacy = false) {
  if (!object(task) || task.version !== 4 || !/^(?:ON|WARN|OFF)$/.test(task.mode || '')
      || !HASH.test(task.salt || '')) return false;
  const hasTaskKey = Object.prototype.hasOwnProperty.call(task, 'taskKey');
  if (legacy ? hasTaskKey : (!hasTaskKey || task.taskKey !== expectedKey || !HASH.test(task.taskKey || ''))) return false;
  for (const field of ['dirtyEdits', 'proofs', 'unresolved', 'notices', 'mechanical', 'children',
    'pendingObservations', 'ledgerRefs']) {
    if (task[field] !== undefined && !Array.isArray(task[field])) return false;
  }
  if (Array.isArray(task.dirtyEdits) && task.dirtyEdits.some((item) => !/^[a-f0-9]{16}$/.test(item || ''))) return false;
  if (Array.isArray(task.children) && task.children.some((item) => !HASH.test(item || ''))) return false;
  if (Array.isArray(task.proofs) && task.proofs.some((item) => !object(item))) return false;
  if (Array.isArray(task.unresolved) && task.unresolved.some((item) => !object(item)
      || !/^[a-f0-9]{16}$/.test(item.id || '') || !Array.isArray(item.edits)
      || item.edits.some((edit) => !/^[a-f0-9]{16}$/.test(edit || '')))) return false;
  if (Array.isArray(task.mechanical) && task.mechanical.some((item) => !object(item)
      || !/^[a-f0-9]{16}$/.test(item.id || '') || typeof item.reason !== 'string'
      || (item.edits !== undefined && (!Array.isArray(item.edits)
        || item.edits.some((edit) => !/^[a-f0-9]{16}$/.test(edit || '')))))) return false;
  if (Array.isArray(task.notices) && task.notices.some((item) => !object(item)
      || typeof item.id !== 'string' || typeof item.message !== 'string' || typeof item.delivered !== 'boolean')) return false;
  if (Array.isArray(task.pendingObservations) && task.pendingObservations.some((item) => !object(item)
      || typeof item.id !== 'string' || typeof item.turn !== 'string' || typeof item.eventClass !== 'string'
      || typeof item.receipt !== 'string')) return false;
  if (Array.isArray(task.ledgerRefs) && task.ledgerRefs.some((name) => !/^ground-v4-[a-f0-9]{64}\.log$/.test(name || ''))) return false;
  if (task.checkpointLedger !== undefined && task.checkpointLedger !== ''
      && !/^ground-v4-[a-f0-9]{64}\.log$/.test(task.checkpointLedger || '')) return false;
  if (task.warnings !== undefined && !object(task.warnings)) return false;
  if (task.delivery !== undefined) {
    if (!object(task.delivery)) return false;
    for (const event of ['preToolUse', 'postToolUse', 'stop']) {
      if (task.delivery[event] !== undefined && (!Number.isInteger(task.delivery[event]) || task.delivery[event] < 0)) return false;
    }
  }
  for (const field of ['checkpoint', 'blockCount']) {
    if (task[field] !== undefined && (!Number.isInteger(task[field]) || task[field] < 0)) return false;
  }
  if (task.parentKey !== undefined && !HASH.test(task.parentKey || '')) return false;
  if (task.unboundParent !== undefined && typeof task.unboundParent !== 'boolean') return false;
  return true;
}

function validGenesis(value, key, salt) {
  return exactKeys(value, ['version', 'taskKey', 'saltCommitment'])
    && value.version === 4 && value.taskKey === key && value.saltCommitment === hookHash(salt);
}

function inspectPersistentState(runtime, purpose = 'install') {
  const state = path.join(runtime, 'state');
  if (!fs.existsSync(state)) return { state, migrations: new Map() };
  assertNotLink(state, 'runtime state');
  if (!fs.lstatSync(state).isDirectory()) {
    throw new TransactionError('STATE', `runtime state is not a directory: ${state}`);
  }
  const names = fs.readdirSync(state);
  const migrations = new Map();
  const taskKeys = new Set();
  const genesisKeys = new Set();
  const foreign = [];
  const discarded = new Set();
  for (const name of names) {
    const lowered = name.toLowerCase();
    let pattern = null;
    let label = '';
    if (lowered.startsWith(TASK_PREFIX)) {
      pattern = TASK_FILE;
      label = 'task-v4';
    } else if (lowered.startsWith(GENESIS_PREFIX)) {
      pattern = GENESIS_FILE;
      label = 'task-genesis';
    } else if (lowered.startsWith(EVIDENCE_PREFIX)) {
      pattern = EVIDENCE_FILE;
      label = 'evidence-v4';
    } else if (/^ground(?:-v[23])?-[a-f0-9]{64}\.log$/.test(name)) {
      discarded.add(name);
      continue;
    } else if (/^(?:mechanical|ground|router)-v4-/i.test(name)) {
      pattern = /^(?:mechanical|ground|router)-v4-[a-f0-9]{64}\.log$/;
      label = 'v4 ledger';
    } else if (/^pre-v4-/i.test(name)) {
      pattern = /^pre-v4-[a-f0-9]{64}\.json$/;
      label = 'pre-v4 snapshot';
    } else if (/^exec-v4-/i.test(name)) {
      pattern = EXEC_RECEIPT;
      label = 'exec-v4 receipt';
    } else if (/^task-lock-v4-/i.test(name)) {
      throw new TransactionError('STATE', `active or stale task lock prevents transactional state handling: ${path.join(state, name)}`);
    } else if ([...STATE_DIRECTORIES].some((directory) => lowered.startsWith(directory.toLowerCase()))) {
      const item = path.join(state, name);
      const stat = fs.lstatSync(item);
      if (!STATE_DIRECTORIES.has(name) || stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new TransactionError('STATE', `malformed v4 association state was preserved; refusing mutation: ${item}`);
      }
      continue;
    } else {
      const item = path.join(state, name);
      const stat = fs.lstatSync(item);
      if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) {
        throw new TransactionError('STATE', `unsupported foreign state object was preserved; refusing mutation: ${item}`);
      }
      foreign.push(name);
      continue;
    }
    const item = path.join(state, name);
    const stat = fs.lstatSync(item);
    if (!pattern.test(name) || stat.isSymbolicLink() || !stat.isFile()) {
      throw new TransactionError('STATE',
        `malformed or foreign ${label} state was preserved; refusing mutation: ${item}`);
    }
    if (pattern === TASK_FILE) taskKeys.add(name.match(TASK_FILE)[1]);
    if (pattern === GENESIS_FILE) genesisKeys.add(name.slice(GENESIS_PREFIX.length, -'.json'.length));
  }
  for (const key of taskKeys) {
    const taskName = `task-v4-${key}.json`;
    const genesisName = `task-genesis-v4-${key}.json`;
    const task = readJson(path.join(state, taskName), `persistent task ${key}`);
    const hasGenesis = genesisKeys.has(key);
    if (!Object.prototype.hasOwnProperty.call(task, 'taskKey')) {
      if (hasGenesis || !validTaskState(task, key, true)) {
        throw new TransactionError('STATE', `legacy task state is malformed or ambiguous: ${taskName}`);
      }
      migrations.set(taskName, { key, task, genesisName });
      continue;
    }
    if (!validTaskState(task, key, false) || !hasGenesis) {
      throw new TransactionError('STATE', `current task state or genesis is malformed or incomplete: ${taskName}`);
    }
    const genesis = readJson(path.join(state, genesisName), `persistent task genesis ${key}`);
    if (!validGenesis(genesis, key, task.salt)) {
      throw new TransactionError('STATE', `current task genesis does not bind the exact task salt: ${genesisName}`);
    }
  }
  for (const key of genesisKeys) {
    if (!taskKeys.has(key)) throw new TransactionError('STATE', `orphan task genesis has no exact task: task-genesis-v4-${key}.json`);
  }
  if (purpose === 'uninstall' && foreign.length) {
    throw new TransactionError('STATE',
      `unrecognized state is not owned by this installer and prevents destructive uninstall: ${foreign.sort().join(', ')}`);
  }
  return { state, migrations, foreign: foreign.sort(), discarded };
}

function assertPersistentStateSafe(runtime, purpose = 'install') {
  return inspectPersistentState(runtime, purpose);
}

function migratedLegacyTask(task, key) {
  const migrated = { ...task, taskKey: key };
  if (Array.isArray(task.proofs) && task.proofs.length) {
    const warningId = hookHash(`legacy-proof-unverifiable:${key}`).slice(0, 16);
    const edits = [...new Set(task.proofs.flatMap((proof) => Array.isArray(proof.edits) ? proof.edits : [])
      .filter((edit) => /^[a-f0-9]{16}$/.test(edit || '')))];
    migrated.dirtyEdits = [...new Set([
      ...(Array.isArray(task.dirtyEdits) ? task.dirtyEdits : []),
      ...edits,
    ])];
    const debt = {
      id: warningId,
      reason: 'legacy-proof-unverifiable',
      status: 'unresolved',
      ...(edits.length ? { edits } : {}),
    };
    migrated.mechanical = Array.isArray(task.mechanical) ? [...task.mechanical] : [];
    if (!migrated.mechanical.some((item) => item && item.id === warningId)) migrated.mechanical.push(debt);
    migrated.notices = Array.isArray(task.notices) ? [...task.notices] : [];
    const noticeId = `legacy-proof-unverifiable:${warningId}`;
    if (!migrated.notices.some((item) => item && item.id === noticeId)) {
      migrated.notices.push({
        id: noticeId,
        message: 'Dev Rigor warning: this task contains pre-canonical proof records that cannot be verified as current evidence. The original proof, debt, and checkpoint records were preserved, and release remains blocked until current evidence resolves this mechanical debt.',
        delivered: false,
      });
    }
  }
  return migrated;
}

function copyCurrentRuntimeState(sourceRuntime, destinationRuntime) {
  const inspection = assertPersistentStateSafe(sourceRuntime);
  const source = path.join(sourceRuntime, 'state');
  if (!fs.existsSync(source)) return;
  assertNotLink(source, 'runtime state');
  const selected = selectedRuntimeState(source, inspection.discarded);
  if (!selected.length) return;
  const destination = path.join(destinationRuntime, 'state');
  if (fs.existsSync(destination)) {
    throw new TransactionError('STATE', `staged source runtime unexpectedly contains state: ${destination}`);
  }
  ensureDirectory(destination);
  const expectedDestination = new Set(selected);
  for (const name of selected) {
    const sourceItem = path.join(source, name);
    const destinationItem = path.join(destination, name);
    const before = fs.lstatSync(sourceItem).isDirectory() ? treeDigest(sourceItem) : fileHash(sourceItem);
    const migration = inspection.migrations.get(name);
    if (migration) {
      writeNewDurable(destinationItem, migratedLegacyTask(migration.task, migration.key));
      const genesisItem = path.join(destination, migration.genesisName);
      writeNewDurable(genesisItem, {
        version: 4, taskKey: migration.key, saltCommitment: hookHash(migration.task.salt),
      });
      expectedDestination.add(migration.genesisName);
    } else if (fs.lstatSync(sourceItem).isDirectory()) copyTree(sourceItem, destinationItem);
    else fs.copyFileSync(sourceItem, destinationItem, fs.constants.COPYFILE_EXCL);
    const afterSource = fs.lstatSync(sourceItem).isDirectory() ? treeDigest(sourceItem) : fileHash(sourceItem);
    const afterDestination = migration ? null
      : fs.lstatSync(destinationItem).isDirectory() ? treeDigest(destinationItem) : fileHash(destinationItem);
    if (before !== afterSource || (!migration && before !== afterDestination)) {
      throw new TransactionError('STATE', `runtime state changed while being preserved: ${name}`);
    }
  }
  if (JSON.stringify(selectedRuntimeState(source, inspection.discarded)) !== JSON.stringify(selected)) {
    throw new TransactionError('STATE', 'current v4 runtime state set changed while being preserved');
  }
  if (JSON.stringify(selectedRuntimeState(destination)) !== JSON.stringify([...expectedDestination].sort())) {
    throw new TransactionError('STATE', 'staged current v4 state set does not match the validated migration plan');
  }
}

function verifyRepo(repo) {
  const skills = path.join(repo, 'skills');
  const runtime = path.join(repo, 'codex');
  const wire = path.join(runtime, 'hooks', 'wire-hooks.js');
  if (!fs.existsSync(skills) || !fs.existsSync(wire)) throw new TransactionError('SOURCE', `repository is incomplete: ${repo}`);
  for (const name of SKILLS) {
    if (!fs.existsSync(path.join(skills, name, 'SKILL.md'))) throw new TransactionError('SOURCE', `missing skill source: ${name}`);
  }
  return { skills, runtime, wire };
}

function repoSourceDigests(source) {
  return {
    runtime: treeDigest(source.runtime),
    skills: Object.fromEntries(SKILLS.map((name) => [name, treeDigest(path.join(source.skills, name))])),
  };
}

function sourceDigestsEqual(left, right) {
  return left.runtime === right.runtime
    && SKILLS.every((name) => left.skills[name] === right.skills[name]);
}

function freezeRepoSource(source) {
  const first = repoSourceDigests(source);
  const second = repoSourceDigests(source);
  if (!sourceDigestsEqual(first, second)) {
    throw new TransactionError('SOURCE', 'repository changed while its required source set was being frozen');
  }
  return first;
}

function copyFrozenRepoSource(source, frozen, stageSkills, stageRuntime) {
  for (const name of SKILLS) {
    const input = path.join(source.skills, name);
    const output = path.join(stageSkills, name);
    copyTree(input, output);
    if (treeDigest(input) !== frozen.skills[name] || treeDigest(output) !== frozen.skills[name]) {
      throw new TransactionError('SOURCE', `skill source changed while staging the frozen repository: ${name}`);
    }
  }
  copyTree(source.runtime, stageRuntime);
  if (treeDigest(source.runtime) !== frozen.runtime || treeDigest(stageRuntime) !== frozen.runtime) {
    throw new TransactionError('SOURCE', 'runtime source changed while staging the frozen repository');
  }
  if (!sourceDigestsEqual(repoSourceDigests(source), frozen)) {
    throw new TransactionError('SOURCE', 'repository changed after the frozen source set was staged');
  }
}

function runPinnedNode(script, expectedHash, args, label, runtime = null, expectedRuntime = null) {
  if (!HASH.test(expectedHash || '') || !fs.existsSync(script) || fileHash(script) !== expectedHash) {
    throw new TransactionError('CAS', `${label} helper bytes changed before execution`);
  }
  if (runtime && treeDigest(runtime) !== expectedRuntime) {
    throw new TransactionError('CAS', `${label} runtime changed before helper execution`);
  }
  const result = runNode(script, args, label);
  if (!fs.existsSync(script) || fileHash(script) !== expectedHash) {
    throw new TransactionError('CAS', `${label} helper bytes changed during execution`);
  }
  if (runtime && treeDigest(runtime) !== expectedRuntime) {
    throw new TransactionError('CAS', `${label} runtime changed during helper execution`);
  }
  return result;
}

function pinHelper(source, destination, label) {
  assertNotLink(source, `${label} source`);
  if (!fs.lstatSync(source).isFile()) throw new TransactionError('TYPE', `${label} source is not a regular file`);
  const before = fileHash(source);
  ensureDirectory(path.dirname(destination));
  fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
  const sourceAfter = fileHash(source);
  const destinationAfter = fileHash(destination);
  if (before !== sourceAfter || before !== destinationAfter) {
    throw new TransactionError('CAS', `${label} changed while its verified execution copy was pinned`);
  }
  return { path: destination, hash: before };
}

function verifiedTool(journal, name) {
  const record = journal.verifiedTools && journal.verifiedTools[name];
  if (!record || !fs.existsSync(record.path) || fileHash(record.path) !== record.hash) {
    throw new TransactionError('CONFLICT', `verified ${name} helper is unavailable or changed`);
  }
  return record;
}

function prepareBackupScope(sourcePaths, work, destination, lineage, id, scope) {
  if (fs.existsSync(destination)) throw new TransactionError('EXISTS', `backup destination already exists: ${destination}`);
  if (fs.existsSync(work)) throw new TransactionError('EXISTS', `backup staging path already exists: ${work}`);
  assertNotLink(path.dirname(destination), 'backup namespace');
  ensureDirectory(work);
  for (const [name, source] of sourcePaths) {
    if (!fs.existsSync(source)) continue;
    const target = path.join(work, name);
    if (fs.lstatSync(source).isDirectory()) {
      const before = treeDigest(source);
      copyTree(source, target);
      if (before !== treeDigest(source) || before !== treeDigest(target)) {
        throw new TransactionError('BACKUP', `source changed while backing up ${source}`);
      }
    } else {
      assertNotLink(source, 'backup source');
      const before = fileHash(source);
      fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
      if (before !== fileHash(source) || before !== fileHash(target)) {
        throw new TransactionError('BACKUP', `source changed while backing up ${source}`);
      }
    }
  }
  barrier('install', 'after-backup-copy');
  const digest = treeDigest(work, true);
  writeNewDurable(path.join(work, BACKUP_MARKER), backupMarker(lineage, id, scope, digest));
  move(work, destination);
  if (treeDigest(destination, true) !== digest) {
    throw new TransactionError('BACKUP', `completed ${scope} backup changed during publication`);
  }
  return { present: true, digest };
}

function absentScope() {
  return { present: false, digest: null };
}

function prepareInstallBackups(journal, ownership, active, enabled) {
  const skillsPresent = enabled && SKILLS.some((name) => fs.existsSync(path.join(active.target, name)));
  const homePresent = enabled && (fs.existsSync(active.runtime) || fs.existsSync(active.hooks));
  if (!skillsPresent && !homePresent) return null;
  const id = journal.id;
  const skillsDestination = path.join(active.skillsBackupNamespace, id);
  const homeDestination = path.join(active.homeBackupNamespace, id);
  const paths = transactionPaths(journal.homePath, id);
  const backupWork = path.join(paths.stage, 'backup-work');
  journal.backupPlan = {
    id,
    lineage: ownership.lineage,
    skillsPath: skillsPresent ? skillsDestination : null,
    homePath: homePresent ? homeDestination : null,
    skills: absentScope(),
    home: absentScope(),
  };
  persistJournal(journal);
  if (skillsPresent) {
    const sources = SKILLS.filter((name) => fs.existsSync(path.join(active.target, name)))
      .map((name) => [name, path.join(active.target, name)]);
    journal.backupPlan.skills = prepareBackupScope(
      sources, path.join(backupWork, 'skills'), skillsDestination, ownership.lineage, id, 'skills');
    persistJournal(journal);
  }
  if (homePresent) {
    const sources = [];
    if (fs.existsSync(active.runtime)) sources.push(['runtime', active.runtime]);
    if (fs.existsSync(active.hooks)) sources.push(['hooks.json', active.hooks]);
    journal.backupPlan.home = prepareBackupScope(
      sources, path.join(backupWork, 'home'), homeDestination, ownership.lineage, id, 'home');
    persistJournal(journal);
  }
  return {
    id,
    skills: journal.backupPlan.skills,
    home: journal.backupPlan.home,
  };
}

function prepareInstall(options, lock, journal) {
  const source = verifyRepo(options.repo);
  const active = activePaths(options.home, options.target);
  for (const [label, managed] of Object.entries({
    runtime: active.runtime, hooks: active.hooks, target: active.target,
    homeBackupParent: active.homeBackupParent, homeBackupNamespace: active.homeBackupNamespace,
    skillsBackupParent: active.skillsBackupParent, skillsBackupNamespace: active.skillsBackupNamespace,
  })) {
    assertNotLink(managed, label);
  }
  if (!sameDevice(options.home, options.target)) {
    throw new TransactionError('DEVICE', 'Codex home and skills target must be on the same filesystem');
  }
  for (const name of SKILLS) {
    journal.baselineDigests.skills[name] = digestIfDirectory(path.join(active.target, name));
  }
  journal.baselineDigests.runtime = digestIfDirectory(active.runtime);
  persistJournal(journal);

  const paths = transactionPaths(options.home, journal.id);
  const stageSkills = path.join(paths.stage, 'skills');
  const stageRuntime = path.join(paths.stage, 'runtime');
  const stageConfig = path.join(paths.stage, 'config');
  ensureDirectory(stageSkills);
  ensureDirectory(stageConfig);
  const frozenSource = freezeRepoSource(source);
  barrier('install', 'after-source-baseline');
  copyFrozenRepoSource(source, frozenSource, stageSkills, stageRuntime);
  if (fs.existsSync(path.join(stageRuntime, 'state'))) {
    throw new TransactionError('STATE', 'source runtime must not contain installed state');
  }
  const stagedWire = path.join(stageRuntime, 'hooks', 'wire-hooks.js');
  const stagedWireHash = fileHash(stagedWire);
  runPinnedNode(stagedWire, stagedWireHash, ['--check', options.home, stageRuntime], 'hook preflight');
  if (fs.existsSync(active.runtime)) copyCurrentRuntimeState(active.runtime, stageRuntime);
  barrier('install', 'after-state-stage');

  if (journal.hooksBefore.exists) fs.copyFileSync(active.hooks, path.join(stageConfig, 'hooks.json'), fs.constants.COPYFILE_EXCL);
  runPinnedNode(stagedWire, stagedWireHash, [stageConfig, active.runtime, stageRuntime], 'staged hook wiring');
  const stagedHooks = path.join(stageConfig, 'hooks.json');
  if (!fs.existsSync(stagedHooks)) throw new TransactionError('HOOKS', 'staged hook wiring did not produce hooks.json');
  journal.hooksAfter = hookSnapshot(stagedHooks);
  journal.hookAction = 'replace';

  const prior = fs.existsSync(active.runtime)
    ? readOwnership(active.runtime, options.home, options.target)
    : readOwnership(path.join(paths.stage, 'missing-runtime'), options.home, options.target);
  const backup = prepareInstallBackups(journal, prior, active, options.backup);
  const created = { ...prior.created };
  created.skillsDirectory ||= !journal.baselineActive.target;
  created.hooksConfig ||= !journal.hooksBefore.exists;
  if (backup && backup.skills.present) {
    created.skillsBackupNamespace ||= !journal.baselineActive.skillsBackupNamespace;
    created.skillsBackupParent ||= !journal.baselineActive.skillsBackupParent;
  }
  if (backup && backup.home.present) {
    created.homeBackupNamespace ||= !journal.baselineActive.homeBackupNamespace;
    created.homeBackupParent ||= !journal.baselineActive.homeBackupParent;
  }
  const ownership = {
    ...prior,
    schema: OWNERSHIP_SCHEMA,
    created,
    backups: backup ? [...prior.backups, backup] : [...prior.backups],
    installed: {
      runtime: managedRuntimeDigest(stageRuntime),
      skills: Object.fromEntries(SKILLS.map((name) => [name, treeDigest(path.join(stageSkills, name))])),
    },
  };
  writeOwnership(stageRuntime, ownership, options.home, options.target);

  for (const name of SKILLS) {
    if (digestIfDirectory(path.join(active.target, name)) !== journal.baselineDigests.skills[name]) {
      throw new TransactionError('CAS', `skill changed during install preparation: ${name}`);
    }
  }
  if (digestIfDirectory(active.runtime) !== journal.baselineDigests.runtime) {
    throw new TransactionError('CAS', 'runtime or current v4 state changed during install preparation');
  }
  for (const name of SKILLS) journal.preparedDigests.skills[name] = treeDigest(path.join(stageSkills, name));
  journal.preparedDigests.runtime = treeDigest(stageRuntime);
  setPhase(journal, 'PREPARED');
  barrier('install', 'prepared');
  return { active, paths, stageSkills, stageRuntime, stageConfig, stagedHooks, ownership };
}

function digestIfDirectory(target) {
  return fs.existsSync(target) ? treeDigest(target) : null;
}

function removeExpectedDirectory(target, expected, label) {
  if (!fs.existsSync(target)) return;
  const actual = treeDigest(target);
  if (!expected || actual !== expected) {
    throw new TransactionError('CONFLICT', `${label} changed during the transaction; preserved at ${target}`);
  }
  removeTree(target);
}

function restoreDirectory(saved, active, expectedActive, expectedSaved, label) {
  if (!fs.existsSync(saved)) return false;
  if (treeDigest(saved) !== expectedSaved) {
    throw new TransactionError('CONFLICT', `${label} rollback copy changed; preserving recovery data`);
  }
  if (fs.existsSync(active)) removeExpectedDirectory(active, expectedActive, label);
  move(saved, active);
  return true;
}

function restoreHooks(journal, active, rollback) {
  const saved = path.join(rollback, 'hooks.json');
  if (fs.existsSync(saved)) {
    if (!journal.hooksBefore.exists || fileHash(saved) !== journal.hooksBefore.hash) {
      throw new TransactionError('CONFLICT', 'saved hooks.json no longer matches the pre-transaction bytes');
    }
    if (fs.existsSync(active.hooks)) {
      if (!journal.hooksAfter || fileHash(active.hooks) !== journal.hooksAfter.hash) {
        throw new TransactionError('CONFLICT', 'hooks.json changed after transaction exposure; preserving both copies');
      }
      fs.unlinkSync(active.hooks);
    }
    move(saved, active.hooks);
    return;
  }
  if (!journal.hooksBefore.exists && fs.existsSync(active.hooks)) {
    if (!journal.hooksAfter || fileHash(active.hooks) !== journal.hooksAfter.hash) {
      throw new TransactionError('CONFLICT', 'new hooks.json was replaced concurrently; preserving it');
    }
    fs.unlinkSync(active.hooks);
  }
}

function removePlannedBackups(journal, active) {
  const plan = journal.backupPlan;
  if (!plan) return;
  for (const [scope, destination] of [['skills', plan.skillsPath], ['home', plan.homePath]]) {
    if (!destination || !fs.existsSync(destination)) continue;
    const record = plan[scope];
    const markerPath = path.join(destination, BACKUP_MARKER);
    let marker = null;
    try {
      if (fs.existsSync(markerPath) && fs.lstatSync(markerPath).isFile()
          && !fs.lstatSync(markerPath).isSymbolicLink()) marker = readJson(markerPath, 'new backup owner marker');
    } catch { marker = null; }
    const expectedDigest = record.present ? record.digest : marker && marker.digest;
    if (!marker || !HASH.test(expectedDigest || '')
        || !exactKeys(marker, ['schema', 'lineage', 'id', 'scope', 'digest'])
        || marker.schema !== BACKUP_MARKER_SCHEMA || marker.lineage !== plan.lineage
        || marker.id !== plan.id || marker.scope !== scope || marker.digest !== expectedDigest
        || treeDigest(destination, true) !== expectedDigest) {
      throw new TransactionError('CONFLICT', `new ${scope} backup changed during rollback; preserving it`);
    }
    removeTree(destination);
  }
  if (!journal.baselineActive.skillsBackupNamespace) removeEmpty(active.skillsBackupNamespace);
  if (!journal.baselineActive.skillsBackupParent) removeEmpty(active.skillsBackupParent);
  if (!journal.baselineActive.homeBackupNamespace) removeEmpty(active.homeBackupNamespace);
  if (!journal.baselineActive.homeBackupParent) removeEmpty(active.homeBackupParent);
}

function applyInstall(options, journal, prepared) {
  const { active, paths, stageSkills, stageRuntime, stagedHooks } = prepared;
  const rollbackSkills = path.join(paths.rollback, 'skills');
  ensureDirectory(rollbackSkills);
  setPhase(journal, 'APPLYING');
  ensureDirectory(active.target);
  let count = 0;
  for (const name of SKILLS) {
    const current = path.join(active.target, name);
    const saved = path.join(rollbackSkills, name);
    const staged = path.join(stageSkills, name);
    const before = journal.baselineDigests.skills[name];
    setStep(journal, `skill:${name}`, 'intent');
    if (before) {
      if (digestIfDirectory(current) !== before) throw new TransactionError('CAS', `skill changed after preparation: ${name}`);
      move(current, saved);
      if (treeDigest(saved) !== before) throw new TransactionError('CONFLICT', `skill changed during move: ${name}`);
    }
    move(staged, current);
    if (treeDigest(current) !== journal.preparedDigests.skills[name]) throw new TransactionError('CONFLICT', `staged skill changed during move: ${name}`);
    setStep(journal, `skill:${name}`, 'done');
    count += 1;
    if (process.env.CI && process.env.DEV_RIGOR_INSTALL_TEST_FAIL_AT === 'mid-commit' && count === 5) {
      throw new TransactionError('INJECTED', 'Injected CI mid-commit failure');
    }
  }
  barrier('install', 'after-skills');

  const savedRuntime = path.join(paths.rollback, 'runtime');
  setStep(journal, 'runtime', 'intent');
  if (journal.baselineDigests.runtime) {
    if (digestIfDirectory(active.runtime) !== journal.baselineDigests.runtime) {
      throw new TransactionError('CAS', 'runtime changed after preparation');
    }
    move(active.runtime, savedRuntime);
    if (treeDigest(savedRuntime) !== journal.baselineDigests.runtime) throw new TransactionError('CONFLICT', 'runtime changed during move');
  }
  move(stageRuntime, active.runtime);
  if (treeDigest(active.runtime) !== journal.preparedDigests.runtime) throw new TransactionError('CONFLICT', 'staged runtime changed during move');
  setStep(journal, 'runtime', 'done');
  barrier('install', 'after-runtime');

  if (process.env.CI && process.env.DEV_RIGOR_INSTALL_TEST_FAIL_AT === 'backup-finalization') {
    throw new TransactionError('INJECTED', 'Injected CI backup-finalization failure');
  }

  barrier('install', 'before-hooks-cas');
  if (!hookSnapshotEqual(hookSnapshot(active.hooks), journal.hooksBefore)) {
    throw new TransactionError('CAS', 'hooks.json changed concurrently before commit');
  }
  const savedHooks = path.join(paths.rollback, 'hooks.json');
  setStep(journal, 'hooks', 'intent');
  if (journal.hooksBefore.exists) {
    move(active.hooks, savedHooks);
    if (fileHash(savedHooks) !== journal.hooksBefore.hash) throw new TransactionError('CAS', 'hooks.json changed during save');
  }
  barrier('install', 'after-hooks-save');
  if (fs.existsSync(active.hooks)) throw new TransactionError('CAS', 'hooks.json reappeared during commit; refusing to overwrite it');
  move(stagedHooks, active.hooks);
  if (!hookSnapshotEqual(hookSnapshot(active.hooks), journal.hooksAfter)) throw new TransactionError('CAS', 'staged hooks.json changed during commit');
  setStep(journal, 'hooks', 'done');
  barrier('install', 'after-hooks-apply');
  barrier('install', 'before-commit');
  setPhase(journal, 'COMMITTED');
  barrier('install', 'after-commit');
}

function restoreTrust(journal, active, rollback) {
  const saved = path.join(rollback, 'config.toml');
  const candidate = path.join(rollback, 'config.restore-candidate.toml');
  const displaced = path.join(rollback, 'config.trust-after.toml');
  if (!journal.steps.trust) return;
  let current = hookSnapshot(active.trust);
  if (hookSnapshotEqual(current, journal.trustBefore)
      && !fs.existsSync(candidate) && !fs.existsSync(displaced)) return;
  if (!journal.trustAfter) {
    const outcomePath = path.join(rollback, 'trust-outcome.json');
    if (!fs.existsSync(outcomePath)) {
      const revoker = verifiedTool(journal, 'revoker');
      runPinnedNode(revoker.path, revoker.hash,
        [journal.homePath, process.cwd(), '--outcome-file', outcomePath], 'recoverable hook trust revocation',
        active.runtime, journal.baselineDigests.runtime);
    }
    const outcome = readJson(outcomePath, 'trust revocation outcome');
    const expectedHome = sha256Bytes(Buffer.from(normalize(journal.homePath), 'utf8'));
    if (!exactKeys(outcome, ['schema', 'codexHomeIdentity', 'after', 'ownedKeys', 'version'])
        || outcome.schema !== TRUST_OUTCOME_SCHEMA || outcome.codexHomeIdentity !== expectedHome
        || !exactKeys(outcome.after, ['exists', 'hash']) || typeof outcome.after.exists !== 'boolean'
        || (outcome.after.exists ? !HASH.test(outcome.after.hash) : outcome.after.hash !== null)
        || !Array.isArray(outcome.ownedKeys) || outcome.ownedKeys.length !== 7
        || outcome.ownedKeys.some((key) => typeof key !== 'string' || !key)) {
      throw new TransactionError('CONFLICT', 'trust revocation outcome is invalid or path-mismatched');
    }
    journal.trustAfter = outcome.after;
    persistJournal(journal);
    current = hookSnapshot(active.trust);
  }

  function exactArtifact(file, snapshot, label) {
    const actual = hookSnapshot(file);
    if (!hookSnapshotEqual(actual, snapshot)) {
      throw new TransactionError('CONFLICT', `${label} no longer matches its journal-bound bytes`);
    }
  }

  function cleanCompletedArtifacts() {
    if (fs.existsSync(candidate)) {
      exactArtifact(candidate, journal.trustBefore, 'trust restore candidate');
      fs.unlinkSync(candidate);
    }
    if (fs.existsSync(displaced)) {
      exactArtifact(displaced, journal.trustAfter, 'displaced trust-after configuration');
      fs.unlinkSync(displaced);
    }
    fsyncDirectory(rollback);
  }

  if (hookSnapshotEqual(current, journal.trustBefore)) {
    cleanCompletedArtifacts();
    return;
  }
  if (journal.trustBefore.exists) {
    if (!fs.existsSync(saved) || fileHash(saved) !== journal.trustBefore.hash) {
      throw new TransactionError('CONFLICT', 'saved config.toml does not match transaction baseline');
    }
    if (!fs.existsSync(candidate)) copyFileNewDurable(saved, candidate);
    exactArtifact(candidate, journal.trustBefore, 'trust restore candidate');
  } else if (fs.existsSync(candidate)) {
    throw new TransactionError('CONFLICT', 'unexpected trust restore candidate exists for an absent baseline');
  }

  if (fs.existsSync(displaced)) {
    exactArtifact(displaced, journal.trustAfter, 'displaced trust-after configuration');
    if (fs.existsSync(active.trust)) {
      throw new TransactionError('CONFLICT', 'config.toml reappeared after trust rollback displacement; preserving both copies');
    }
  } else {
    if (!hookSnapshotEqual(hookSnapshot(active.trust), journal.trustAfter)) {
      throw new TransactionError('CONFLICT', 'config.toml changed concurrently before trust rollback displacement');
    }
    barrier('uninstall', 'before-trust-displacement');
    if (!hookSnapshotEqual(hookSnapshot(active.trust), journal.trustAfter)) {
      throw new TransactionError('CONFLICT', 'config.toml changed at the trust rollback displacement boundary');
    }
    if (journal.trustAfter.exists) move(active.trust, displaced);
    if (journal.trustAfter.exists) exactArtifact(displaced, journal.trustAfter, 'displaced trust-after configuration');
    barrier('uninstall', 'after-trust-displacement');
  }

  if (fs.existsSync(active.trust)) {
    throw new TransactionError('CONFLICT', 'config.toml was recreated during trust rollback; preserving the concurrent file');
  }
  barrier('uninstall', 'before-trust-restore-publish');
  if (fs.existsSync(active.trust)) {
    throw new TransactionError('CONFLICT', 'config.toml was recreated before trust rollback publication');
  }
  if (journal.trustBefore.exists) move(candidate, active.trust);
  if (!hookSnapshotEqual(hookSnapshot(active.trust), journal.trustBefore)) {
    throw new TransactionError('CONFLICT', 'atomic trust rollback did not publish the exact baseline bytes');
  }
  barrier('uninstall', 'after-trust-restore-publish');
  cleanCompletedArtifacts();
  barrier('uninstall', 'after-trust-restore');
}

function rollbackInstall(journal) {
  const paths = transactionPaths(journal.homePath, journal.id);
  const active = activePaths(journal.homePath, journal.targetPath);
  if (journal.phase !== 'ROLLING_BACK') setPhase(journal, 'ROLLING_BACK');
  restoreHooks(journal, active, paths.rollback);
  restoreTrust(journal, active, paths.rollback);
  const savedRuntime = path.join(paths.rollback, 'runtime');
  if (!restoreDirectory(savedRuntime, active.runtime, journal.preparedDigests.runtime,
    journal.baselineDigests.runtime, 'runtime')
      && !journal.baselineActive.runtime && fs.existsSync(active.runtime)) {
    removeExpectedDirectory(active.runtime, journal.preparedDigests.runtime, 'new runtime');
  }
  const rollbackSkills = path.join(paths.rollback, 'skills');
  for (const name of [...SKILLS].reverse()) {
    const saved = path.join(rollbackSkills, name);
    const current = path.join(active.target, name);
    if (!restoreDirectory(saved, current, journal.preparedDigests.skills[name],
      journal.baselineDigests.skills[name], `skill ${name}`)
        && !journal.baselineActive.target && fs.existsSync(current)) {
      removeExpectedDirectory(current, journal.preparedDigests.skills[name], `new skill ${name}`);
    } else if (!journal.baselineDigests.skills[name] && fs.existsSync(current)
        && journal.steps[`skill:${name}`]) {
      removeExpectedDirectory(current, journal.preparedDigests.skills[name], `new skill ${name}`);
    }
  }
  removePlannedBackups(journal, active);
  if (!journal.baselineActive.target) removeEmpty(active.target);
}

function prepareUninstall(options, lock, journal) {
  const active = activePaths(options.home, options.target);
  const wire = path.join(active.runtime, 'hooks', 'wire-hooks.js');
  const revoker = path.join(active.runtime, 'hooks', 'revoke-trust.js');
  if (!fs.existsSync(wire) || !fs.existsSync(revoker)) {
    throw new TransactionError('UNINSTALL', `installed runtime is incomplete: ${active.runtime}`);
  }
  for (const [label, managed] of Object.entries({
    runtime: active.runtime, hooks: active.hooks, target: active.target,
    homeBackupParent: active.homeBackupParent, homeBackupNamespace: active.homeBackupNamespace,
    skillsBackupParent: active.skillsBackupParent, skillsBackupNamespace: active.skillsBackupNamespace,
  })) assertNotLink(managed, label);
  if (!sameDevice(options.home, options.target)) {
    throw new TransactionError('DEVICE', 'Codex home and skills target must be on the same filesystem');
  }
  assertPersistentStateSafe(active.runtime, 'uninstall');
  const ownership = readOwnership(active.runtime, options.home, options.target, 'uninstall');
  for (const name of SKILLS) {
    const current = path.join(active.target, name);
    if (!fs.existsSync(current) || treeDigest(current) !== ownership.installed.skills[name]) {
      throw new TransactionError('OWNERSHIP', `managed skill ${name} changed or contains foreign content; refusing destructive uninstall`);
    }
  }
  if (managedRuntimeDigest(active.runtime) !== ownership.installed.runtime) {
    throw new TransactionError('OWNERSHIP', 'managed runtime changed or contains foreign content; refusing destructive uninstall');
  }
  journal.ownership = ownership;
  const paths = transactionPaths(options.home, journal.id);
  for (const name of SKILLS) journal.baselineDigests.skills[name] = digestIfDirectory(path.join(active.target, name));
  journal.baselineDigests.runtime = digestIfDirectory(active.runtime);
  persistJournal(journal);

  const toolRoot = path.join(paths.stage, 'verified-tools');
  journal.verifiedTools.wire = pinHelper(wire, path.join(toolRoot, 'wire-hooks.js'), 'hook removal helper');
  journal.verifiedTools.revoker = pinHelper(revoker, path.join(toolRoot, 'revoke-trust.js'), 'trust revocation helper');
  persistJournal(journal);
  if (digestIfDirectory(active.runtime) !== journal.baselineDigests.runtime) {
    throw new TransactionError('CAS', 'runtime changed while uninstall helpers were pinned');
  }

  const stageConfig = path.join(paths.stage, 'config');
  ensureDirectory(stageConfig);
  let stagedHooks = null;
  if (journal.hooksBefore.exists) {
    stagedHooks = path.join(stageConfig, 'hooks.json');
    fs.copyFileSync(active.hooks, stagedHooks, fs.constants.COPYFILE_EXCL);
    barrier('uninstall', 'before-wire-helper');
    const pinnedWire = verifiedTool(journal, 'wire');
    runPinnedNode(pinnedWire.path, pinnedWire.hash,
      ['--remove', stageConfig, active.runtime, active.runtime], 'staged hook removal',
      active.runtime, journal.baselineDigests.runtime);
    if (!fs.existsSync(stagedHooks)) throw new TransactionError('HOOKS', 'hook removal did not produce staged hooks.json');
    journal.stagedHookHash = fileHash(stagedHooks);
    if (ownership.created.hooksConfig && strictHooksEmpty(stagedHooks)) {
      journal.hookAction = 'delete';
      journal.hooksAfter = { exists: false, hash: null };
    } else {
      journal.hookAction = 'replace';
      journal.hooksAfter = hookSnapshot(stagedHooks);
    }
  } else {
    journal.hookAction = 'none';
    journal.hooksAfter = { exists: false, hash: null };
  }
  setPhase(journal, 'PREPARED');
  barrier('uninstall', 'prepared');
  return { active, paths, ownership, stagedHooks };
}

function applyTrustRevocation(options, journal, prepared) {
  if (options.skipTrust) return;
  const { active, paths } = prepared;
  const revoker = verifiedTool(journal, 'revoker');
  const saved = path.join(paths.rollback, 'config.toml');
  setStep(journal, 'trust', 'intent');
  if (journal.trustBefore.exists) {
    fs.copyFileSync(active.trust, saved, fs.constants.COPYFILE_EXCL);
    if (fileHash(saved) !== journal.trustBefore.hash) throw new TransactionError('CAS', 'config.toml changed while saving rollback bytes');
  }
  const outcomePath = path.join(paths.rollback, 'trust-outcome.json');
  runPinnedNode(revoker.path, revoker.hash,
    [options.home, process.cwd(), '--outcome-file', outcomePath], 'hook trust revocation',
    active.runtime, journal.baselineDigests.runtime);
  barrier('uninstall', 'after-trust-child');
  const outcome = readJson(outcomePath, 'trust revocation outcome');
  const expectedHome = sha256Bytes(Buffer.from(normalize(options.home), 'utf8'));
  if (!exactKeys(outcome, ['schema', 'codexHomeIdentity', 'after', 'ownedKeys', 'version'])
      || outcome.schema !== TRUST_OUTCOME_SCHEMA || outcome.codexHomeIdentity !== expectedHome
      || !exactKeys(outcome.after, ['exists', 'hash']) || typeof outcome.after.exists !== 'boolean'
      || (outcome.after.exists ? !HASH.test(outcome.after.hash) : outcome.after.hash !== null)
      || !Array.isArray(outcome.ownedKeys) || outcome.ownedKeys.length !== 7) {
    throw new TransactionError('CHILD', 'trust revocation did not produce a valid durable outcome');
  }
  journal.trustAfter = outcome.after;
  if (!hookSnapshotEqual(hookSnapshot(active.trust), journal.trustAfter)) {
    throw new TransactionError('CAS', 'config.toml changed after durable trust revocation outcome');
  }
  setStep(journal, 'trust', 'done');
}

function moveOwnedBackups(journal, prepared) {
  const { active, paths, ownership } = prepared;
  for (const entry of ownership.backups) {
    for (const scope of ['skills', 'home']) {
      if (!entry[scope].present) continue;
      const source = path.join(scope === 'skills' ? active.skillsBackupNamespace : active.homeBackupNamespace, entry.id);
      if (!fs.existsSync(source)) {
        journal.warnings.push(`owned ${scope} backup is missing: ${entry.id}`);
        persistJournal(journal);
        continue;
      }
      if (!validateBackupDirectory(source, ownership, entry, scope)) {
        journal.warnings.push(`modified or unverified ${scope} backup was preserved: ${entry.id}`);
        persistJournal(journal);
        continue;
      }
      const destination = path.join(paths.rollback, 'backups', scope, entry.id);
      const moved = { scope, id: entry.id, digest: entry[scope].digest, state: 'intent' };
      journal.movedBackups.push(moved);
      setStep(journal, `backup:${scope}:${entry.id}`, 'intent');
      move(source, destination);
      barrier('uninstall', 'after-backup-move');
      if (!validateBackupDirectory(destination, ownership, entry, scope)) {
        throw new TransactionError('CONFLICT', `owned ${scope} backup changed during move: ${entry.id}`);
      }
      moved.state = 'done';
      setStep(journal, `backup:${scope}:${entry.id}`, 'done');
    }
  }
}

function applyUninstall(options, journal, prepared) {
  const { active, paths, stagedHooks } = prepared;
  const rollbackSkills = path.join(paths.rollback, 'skills');
  ensureDirectory(rollbackSkills);
  setPhase(journal, 'APPLYING');
  applyTrustRevocation(options, journal, prepared);

  let count = 0;
  for (const name of SKILLS) {
    const current = path.join(active.target, name);
    const before = journal.baselineDigests.skills[name];
    if (before) {
      if (digestIfDirectory(current) !== before) throw new TransactionError('CAS', `skill changed after uninstall preparation: ${name}`);
      setStep(journal, `skill:${name}`, 'intent');
      move(current, path.join(rollbackSkills, name));
      if (treeDigest(path.join(rollbackSkills, name)) !== before) throw new TransactionError('CONFLICT', `skill changed during uninstall move: ${name}`);
      setStep(journal, `skill:${name}`, 'done');
    }
    count += 1;
    if (process.env.CI && process.env.DEV_RIGOR_UNINSTALL_TEST_FAIL_AT === 'mid-remove' && count === 5) {
      throw new TransactionError('INJECTED', 'Injected CI mid-remove uninstall failure');
    }
  }
  barrier('uninstall', 'after-skills');

  if (digestIfDirectory(active.runtime) !== journal.baselineDigests.runtime) {
    throw new TransactionError('CAS', 'runtime changed after uninstall preparation');
  }
  setStep(journal, 'runtime', 'intent');
  move(active.runtime, path.join(paths.rollback, 'runtime'));
  if (treeDigest(path.join(paths.rollback, 'runtime')) !== journal.baselineDigests.runtime) {
    throw new TransactionError('CONFLICT', 'runtime changed during uninstall move');
  }
  setStep(journal, 'runtime', 'done');
  moveOwnedBackups(journal, prepared);
  barrier('uninstall', 'after-runtime');

  if (journal.hooksBefore.exists) {
    barrier('uninstall', 'before-hooks-cas');
    if (!hookSnapshotEqual(hookSnapshot(active.hooks), journal.hooksBefore)) {
      throw new TransactionError('CAS', 'hooks.json changed concurrently before uninstall commit');
    }
    const savedHooks = path.join(paths.rollback, 'hooks.json');
    setStep(journal, 'hooks', 'intent');
    move(active.hooks, savedHooks);
    if (fileHash(savedHooks) !== journal.hooksBefore.hash) throw new TransactionError('CAS', 'hooks.json changed during uninstall save');
    barrier('uninstall', 'after-hooks-save');
    if (fs.existsSync(active.hooks)) throw new TransactionError('CAS', 'hooks.json reappeared during uninstall');
    if (journal.hookAction === 'replace') {
      move(stagedHooks, active.hooks);
      if (!hookSnapshotEqual(hookSnapshot(active.hooks), journal.hooksAfter)) throw new TransactionError('CAS', 'staged uninstall hooks changed');
    }
    setStep(journal, 'hooks', 'done');
  }
  barrier('uninstall', 'after-hooks-apply');
  if (process.env.CI && process.env.DEV_RIGOR_UNINSTALL_TEST_FAIL_AT === 'config-commit') {
    throw new TransactionError('INJECTED', 'Injected CI config-commit uninstall failure');
  }
  barrier('uninstall', 'before-commit');
  setPhase(journal, 'COMMITTED');
  barrier('uninstall', 'after-commit');
}

function rollbackUninstall(journal) {
  const paths = transactionPaths(journal.homePath, journal.id);
  const active = activePaths(journal.homePath, journal.targetPath);
  if (journal.phase !== 'ROLLING_BACK') setPhase(journal, 'ROLLING_BACK');
  restoreHooks(journal, active, paths.rollback);
  const savedRuntime = path.join(paths.rollback, 'runtime');
  if (fs.existsSync(savedRuntime)) {
    if (fs.existsSync(active.runtime)) throw new TransactionError('CONFLICT', 'runtime path was recreated during uninstall rollback');
    if (treeDigest(savedRuntime) !== journal.baselineDigests.runtime) throw new TransactionError('CONFLICT', 'saved runtime changed during rollback');
    move(savedRuntime, active.runtime);
  }
  restoreTrust(journal, active, paths.rollback);
  for (const moved of [...journal.movedBackups].reverse()) {
    const saved = path.join(paths.rollback, 'backups', moved.scope, moved.id);
    const destination = path.join(moved.scope === 'skills' ? active.skillsBackupNamespace : active.homeBackupNamespace, moved.id);
    const ownershipEntry = journal.ownership && journal.ownership.backups.find((entry) => entry.id === moved.id);
    if (!ownershipEntry || ownershipEntry[moved.scope].digest !== moved.digest) {
      throw new TransactionError('CONFLICT', `backup rollback ownership is missing or changed: ${moved.scope}:${moved.id}`);
    }
    const savedExists = fs.existsSync(saved);
    const destinationExists = fs.existsSync(destination);
    if (savedExists && destinationExists) {
      throw new TransactionError('CONFLICT', `backup exists at both active and rollback paths: ${moved.scope}:${moved.id}`);
    }
    if (savedExists) {
      if (!validateBackupDirectory(saved, journal.ownership, ownershipEntry, moved.scope)) {
        throw new TransactionError('CONFLICT', `saved backup changed during rollback: ${moved.scope}:${moved.id}`);
      }
      move(saved, destination);
    } else if (!destinationExists || !validateBackupDirectory(destination, journal.ownership, ownershipEntry, moved.scope)) {
      throw new TransactionError('CONFLICT', `backup is missing or changed during rollback: ${moved.scope}:${moved.id}`);
    }
  }
  const rollbackSkills = path.join(paths.rollback, 'skills');
  for (const name of [...SKILLS].reverse()) {
    const saved = path.join(rollbackSkills, name);
    if (!fs.existsSync(saved)) continue;
    const destination = path.join(active.target, name);
    if (fs.existsSync(destination)) throw new TransactionError('CONFLICT', `skill path was recreated during rollback: ${name}`);
    if (treeDigest(saved) !== journal.baselineDigests.skills[name]) throw new TransactionError('CONFLICT', `saved skill changed during rollback: ${name}`);
    move(saved, destination);
  }
}

function cleanupUninstallOrigins(journal) {
  const active = activePaths(journal.homePath, journal.targetPath);
  const ownership = journal.ownership;
  if (!ownership || !object(ownership.created)) return;
  if (ownership.created.skillsBackupNamespace) removeEmpty(active.skillsBackupNamespace);
  if (ownership.created.skillsBackupParent) removeEmpty(active.skillsBackupParent);
  if (ownership.created.homeBackupNamespace) removeEmpty(active.homeBackupNamespace);
  if (ownership.created.homeBackupParent) removeEmpty(active.homeBackupParent);
  if (ownership.created.skillsDirectory) removeEmpty(active.target);
}

function cleanupJournalArtifacts(journal) {
  cleanTransactionScaffolds(journal.homePath, journal.baselineScaffolds, journal.id);
}

function rollbackJournal(journal) {
  if (journal.operation === 'install') rollbackInstall(journal);
  else if (journal.operation === 'uninstall') rollbackUninstall(journal);
  else throw new TransactionError('JOURNAL', `unknown journal operation: ${journal.operation}`);
  cleanupJournalArtifacts(journal);
}

function completeCommitted(journal) {
  if (journal.phase !== 'COMMITTED') throw new TransactionError('JOURNAL', 'refusing committed cleanup for an uncommitted transaction');
  if (journal.operation === 'uninstall') {
    barrier('uninstall', 'before-origin-cleanup');
    cleanupUninstallOrigins(journal);
  }
  cleanupJournalArtifacts(journal);
}

function validateLoadedJournal(journal, lock) {
  if (!exactKeys(journal, [
    'schema', 'id', 'operation', 'phase', 'sequence', 'homeIdentity', 'targetIdentity',
    'homePath', 'targetPath', 'baselineScaffolds', 'baselineActive', 'hooksBefore',
    'trustBefore', 'hookAction', 'hooksAfter', 'trustAfter', 'baselineDigests',
    'preparedDigests', 'verifiedTools', 'backupPlan', 'movedBackups', 'created', 'steps', 'warnings',
    ...(Object.prototype.hasOwnProperty.call(journal, 'ownership') ? ['ownership'] : []),
    ...(Object.prototype.hasOwnProperty.call(journal, 'stagedHookHash') ? ['stagedHookHash'] : []),
  ])) {
    throw new TransactionError('JOURNAL', 'journal has an unexpected shape');
  }
  if (!TRANSACTION_ID.test(journal.id) || !Number.isSafeInteger(journal.sequence) || journal.sequence < 1
      || !['install', 'uninstall'].includes(journal.operation)
      || !['PREPARING', 'PREPARED', 'APPLYING', 'ROLLING_BACK', 'COMMITTED'].includes(journal.phase)) {
    throw new TransactionError('JOURNAL', 'journal identity, operation, or phase is invalid');
  }
  if (journal.homeIdentity !== identity(lock.home) || journal.targetIdentity !== identity(lock.target)
      || normalize(journal.homePath) !== normalize(lock.home) || normalize(journal.targetPath) !== normalize(lock.target)) {
    throw new TransactionError('JOURNAL', 'journal path identity does not match this recovery request');
  }
  const booleanRecord = (value, keys) => exactKeys(value, keys)
    && Object.values(value).every((item) => typeof item === 'boolean');
  const snapshotRecord = (value) => exactKeys(value, ['exists', 'hash'])
    && typeof value.exists === 'boolean' && (value.exists ? HASH.test(value.hash) : value.hash === null);
  if (!booleanRecord(journal.baselineScaffolds, [
    'home', 'transactionsParent', 'transactionsNamespace', 'journalParent',
    'stageParent', 'stageNamespace', 'rollbackParent', 'rollbackNamespace',
  ]) || !booleanRecord(journal.baselineActive, [
    'home', 'target', 'runtime', 'hooks', 'trust', 'homeBackupParent',
    'homeBackupNamespace', 'skillsBackupParent', 'skillsBackupNamespace',
  ])
      || !snapshotRecord(journal.hooksBefore) || !snapshotRecord(journal.trustBefore)
      || (journal.hooksAfter !== null && !snapshotRecord(journal.hooksAfter))
      || (journal.trustAfter !== null && !snapshotRecord(journal.trustAfter))) {
    throw new TransactionError('JOURNAL', 'journal baseline or file snapshot is invalid');
  }
  if (!['none', 'replace', 'delete'].includes(journal.hookAction)
      || !object(journal.steps) || !Array.isArray(journal.movedBackups)
      || !Array.isArray(journal.created) || !Array.isArray(journal.warnings)
      || journal.warnings.some((warning) => typeof warning !== 'string')) {
    throw new TransactionError('JOURNAL', 'journal operation state is invalid');
  }
  if (!exactKeys(journal.verifiedTools, ['wire', 'revoker'])) {
    throw new TransactionError('JOURNAL', 'journal verified-helper record is invalid');
  }
  const expectedToolRoot = path.join(transactionPaths(lock.home, journal.id).stage, 'verified-tools');
  for (const [name, filename] of [['wire', 'wire-hooks.js'], ['revoker', 'revoke-trust.js']]) {
    const record = journal.verifiedTools[name];
    if (record === null) continue;
    if (!exactKeys(record, ['path', 'hash']) || !HASH.test(record.hash || '')
        || normalize(record.path) !== normalize(path.join(expectedToolRoot, filename))) {
      throw new TransactionError('JOURNAL', `journal verified ${name} helper is invalid or path-unbound`);
    }
  }
  for (const [step, state] of Object.entries(journal.steps)) {
    const known = step === 'runtime' || step === 'hooks' || step === 'trust'
      || (step.startsWith('skill:') && SKILLS.includes(step.slice('skill:'.length)))
      || /^backup:(?:skills|home):\d{8}-\d{6}-\d+-[a-f0-9]{32}$/.test(step);
    if (!known || !['intent', 'done'].includes(state)) {
      throw new TransactionError('JOURNAL', 'journal step record is invalid');
    }
  }
  for (const collection of [journal.baselineDigests, journal.preparedDigests]) {
    if (!exactKeys(collection, ['skills', 'runtime']) || !object(collection.skills)
        || !(collection.runtime === null || HASH.test(collection.runtime))) {
      throw new TransactionError('JOURNAL', 'journal digest collection is invalid');
    }
    for (const [name, digest] of Object.entries(collection.skills)) {
      if (!SKILLS.includes(name) || !(digest === null || HASH.test(digest))) {
        throw new TransactionError('JOURNAL', 'journal skill digest is invalid');
      }
    }
  }
  if (journal.phase !== 'PREPARING') {
    const baselineComplete = JSON.stringify(Object.keys(journal.baselineDigests.skills).sort()) === JSON.stringify([...SKILLS].sort());
    const preparedComplete = JSON.stringify(Object.keys(journal.preparedDigests.skills).sort()) === JSON.stringify([...SKILLS].sort());
    if (!baselineComplete || (journal.operation === 'install'
      && (!preparedComplete || !SKILLS.every((name) => HASH.test(journal.preparedDigests.skills[name] || ''))
        || !HASH.test(journal.preparedDigests.runtime || '')))
      || (journal.operation === 'uninstall'
        && (!SKILLS.every((name) => HASH.test(journal.baselineDigests.skills[name] || ''))
          || !HASH.test(journal.baselineDigests.runtime || '')))) {
      throw new TransactionError('JOURNAL', 'prepared journal lacks complete managed-tree digests');
    }
    if (journal.operation === 'uninstall' && !journal.ownership) {
      throw new TransactionError('JOURNAL', 'prepared uninstall journal lacks ownership metadata');
    }
    if (journal.operation === 'uninstall'
        && (!journal.verifiedTools.wire || !journal.verifiedTools.revoker)) {
      throw new TransactionError('JOURNAL', 'prepared uninstall journal lacks pinned helper identities');
    }
  }
  if (journal.backupPlan !== null) {
    if (!exactKeys(journal.backupPlan, ['id', 'lineage', 'skillsPath', 'homePath', 'skills', 'home'])
        || journal.backupPlan.id !== journal.id || !/^[a-f0-9]{32}$/.test(journal.backupPlan.lineage)
        || !validScope(journal.backupPlan.skills) || !validScope(journal.backupPlan.home)) {
      throw new TransactionError('JOURNAL', 'journal backup plan is invalid');
    }
    const active = activePaths(lock.home, lock.target);
    const expectedSkills = journal.backupPlan.skillsPath !== null ? path.join(active.skillsBackupNamespace, journal.id) : null;
    const expectedHome = journal.backupPlan.homePath !== null ? path.join(active.homeBackupNamespace, journal.id) : null;
    if ((journal.backupPlan.skillsPath === null ? null : normalize(journal.backupPlan.skillsPath)) !== (expectedSkills && normalize(expectedSkills))
        || (journal.backupPlan.homePath === null ? null : normalize(journal.backupPlan.homePath)) !== (expectedHome && normalize(expectedHome))) {
      throw new TransactionError('JOURNAL', 'journal backup plan path is not derived from the bound home/target');
    }
  }
  for (const moved of journal.movedBackups) {
    if (!exactKeys(moved, ['scope', 'id', 'digest', 'state']) || !['skills', 'home'].includes(moved.scope)
        || !TRANSACTION_ID.test(moved.id) || !HASH.test(moved.digest) || !['intent', 'done'].includes(moved.state)) {
      throw new TransactionError('JOURNAL', 'journal moved-backup record is invalid');
    }
  }
  if (journal.ownership && !validateOwnership(journal.ownership, lock.home, lock.target)) {
    throw new TransactionError('JOURNAL', 'journal ownership record is invalid');
  }
  if (journal.stagedHookHash && !HASH.test(journal.stagedHookHash)) {
    throw new TransactionError('JOURNAL', 'journal staged hook hash is invalid');
  }
}

function recoverExisting(lock) {
  const journal = loadJournal(lock);
  if (!journal) return null;
  validateLoadedJournal(journal, lock);
  // The stale transaction's origin record, not the recovery process's view of
  // its leftover scaffolding, decides which empty parents recovery may remove.
  lock.baseline = journal.baselineScaffolds;
  if (journal.phase === 'COMMITTED') {
    completeCommitted(journal);
    return { status: 'completed-committed', operation: journal.operation, id: journal.id, warnings: journal.warnings };
  }
  rollbackJournal(journal);
  return { status: 'rolled-back', operation: journal.operation, id: journal.id, warnings: journal.warnings };
}

function operationResult(status, journal = null, extra = {}) {
  return {
    status,
    version: VERSION,
    ...(journal ? { operation: journal.operation, transactionId: journal.id, warnings: journal.warnings } : {}),
    ...extra,
  };
}

function execute(options) {
  options = {
    ...options,
    home: canonicalPath(options.home),
    target: canonicalPath(options.target),
    ...(options.repo ? { repo: canonicalPath(options.repo) } : {}),
  };
  validateOptionPaths(options);
  const lock = acquireLock(options.home, options.target);
  let journal = null;
  try {
    const recovered = recoverExisting(lock);
    if (options.operation === 'recover-only') {
      releaseLock(lock, recovered && recovered.baselineScaffolds || null);
      return operationResult('recovered', null, { recovery: recovered });
    }
    journal = newJournal(options.operation, lock);
    if (options.operation === 'install') {
      const prepared = prepareInstall(options, lock, journal);
      applyInstall(options, journal, prepared);
    } else {
      const prepared = prepareUninstall(options, lock, journal);
      applyUninstall(options, journal, prepared);
    }
    completeCommitted(journal);
    releaseLock(lock, journal.baselineScaffolds);
    return operationResult('committed', journal, { recovered });
  } catch (error) {
    if (journal && journal.phase !== 'COMMITTED') {
      try {
        rollbackJournal(journal);
        releaseLock(lock, journal.baselineScaffolds);
      } catch (rollbackError) {
        const combined = new TransactionError('ROLLBACK', `${error.message}; rollback requires recovery: ${rollbackError.message}`);
        combined.cause = error;
        throw combined;
      }
    } else if (!journal) {
      try { releaseLock(lock); } catch {}
    }
    throw error;
  }
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = execute(options);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const code = error && error.code || 'FAILED';
    process.stderr.write(`Dev Rigor transaction ${code}: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  SKILLS, parseArgs, identity, treeDigest, managedRuntimeDigest, legacyInstallFootprint,
  validateOwnership, strictHooksEmpty,
  execute, recoverExisting,
};
