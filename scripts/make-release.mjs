#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const releaseRoot = path.join(root, 'release', 'desktop');

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const eq = arg.indexOf('=');
    if (eq !== -1) {
      out[arg.slice(2, eq)] = arg.slice(eq + 1);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function hostPlatform() {
  switch (process.platform) {
    case 'win32':
      return 'win';
    case 'darwin':
      return 'mac';
    case 'linux':
      return 'linux';
    default:
      throw new Error(`Unsupported host platform: ${process.platform}`);
  }
}

function ensureBuilt() {
  const apiPath = path.join(root, 'dist', 'harness', 'api.js');
  if (!fs.existsSync(apiPath)) {
    throw new Error(`Missing ${apiPath}. Run \`npm run build\` first.`);
  }
  const webPath = path.join(root, 'web', 'index.html');
  if (!fs.existsSync(webPath)) {
    throw new Error(`Missing ${webPath}.`);
  }
  if (!fs.existsSync(path.join(root, 'desktop', 'main.cjs'))) {
    throw new Error('Missing desktop/main.cjs.');
  }
}

function electronBuilderCli() {
  const local = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder');
  if (fs.existsSync(local)) return local;
  return 'electron-builder';
}

function runElectronBuilder(platform, args = []) {
  fs.mkdirSync(releaseRoot, { recursive: true });
  const cli = electronBuilderCli();
  const cliArgs = ['--' + platform, '--publish', 'never', ...args];
  console.log(`> ${cli} ${cliArgs.join(' ')}`);
  execFileSync(cli, cliArgs, { cwd: root, stdio: 'inherit', env: process.env });
}

function listArtifacts() {
  if (!fs.existsSync(releaseRoot)) return [];
  return fs.readdirSync(releaseRoot).filter((name) => {
    if (name.endsWith('.yml') || name.endsWith('.json') || name.endsWith('.blockmap')) return false;
    return fs.statSync(path.join(releaseRoot, name)).isFile();
  });
}

function printSummary() {
  const artifacts = listArtifacts();
  if (artifacts.length === 0) {
    console.warn(`No artifacts found under ${releaseRoot}.`);
    return;
  }
  console.log(`\nMCP Harness desktop artifacts in ${releaseRoot}:`);
  for (const name of artifacts) {
    const full = path.join(releaseRoot, name);
    const size = fs.statSync(full).size;
    const sizeMb = (size / 1024 / 1024).toFixed(1);
    console.log(`  - ${name}  (${sizeMb} MB)`);
  }
}

const args = parseArgs(process.argv);
const platform = String(args.platform || hostPlatform());

ensureBuilt();

if (platform === 'win' || platform === 'all') {
  runElectronBuilder('win', ['--x64']);
}
if (platform === 'mac' || platform === 'all') {
  runElectronBuilder('mac');
}
if (platform === 'linux' || platform === 'all') {
  runElectronBuilder('linux', ['--x64']);
}

if (!['win', 'mac', 'linux', 'all'].includes(platform)) {
  throw new Error(`Unknown --platform value: ${platform}. Use win | mac | linux | all.`);
}

printSummary();

console.log(`\nDone. Artifacts written to: ${releaseRoot}`);
console.log(`\nMCP Harness ${pkg.version} packaged as a real desktop app:`);
console.log('  - Windows: NSIS installer + portable .exe (creates Desktop + Start Menu shortcuts)');
console.log('  - macOS:   .dmg (drag to Applications)');
console.log('  - Linux:   AppImage (chmod +x to run)');
if (process.platform === 'win32') {
  console.log('\nNext: run the NSIS installer to install, then double-click the "MCP Harness" shortcut on the Desktop.');
}
