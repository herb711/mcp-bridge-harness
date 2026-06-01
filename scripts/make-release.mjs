#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import postjectModule from 'postject';

const SEA_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';
const root = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const releaseRoot = path.join(root, 'release');
const stagingRoot = path.join(releaseRoot, 'staging');

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
  const arch = os.arch();
  if (!['x64', 'arm64'].includes(arch)) {
    throw new Error(`Unsupported architecture for executable build: ${arch}`);
  }

  switch (process.platform) {
    case 'win32':
      return `win-${arch}`;
    case 'linux':
      return `linux-${arch}`;
    case 'darwin':
      return `macos-${arch}`;
    default:
      throw new Error(`Unsupported platform for executable build: ${process.platform}`);
  }
}

function expectedHost(platform) {
  const [osName, arch] = platform.split('-');
  const platformName = osName === 'win' ? 'win32' : osName === 'macos' ? 'darwin' : osName;
  return { platformName, arch };
}

function assertNativeBuild(platform) {
  const expected = expectedHost(platform);
  if (process.platform !== expected.platformName || os.arch() !== expected.arch) {
    throw new Error(
      `SEA builds are native-only. Requested ${platform}, but this runner is ${process.platform}-${os.arch()}.`,
    );
  }
}


function copyDirRecursive(src, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirRecursive(from, to);
    else fs.copyFileSync(from, to);
  }
}

function outputName(platform) {
  const extension = platform.startsWith('win-') ? '.exe' : '';
  return `${pkg.name}-${pkg.version}-${platform}${extension}`;
}

function runNode(args) {
  execFileSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
}

function findWindowsSignTool() {
  const candidates = [];
  if (process.env.SIGNTOOL_PATH) candidates.push(process.env.SIGNTOOL_PATH);

  for (const base of [
    'C:\\Program Files (x86)\\Windows Kits\\10\\bin',
    'C:\\Program Files\\Windows Kits\\10\\bin',
  ]) {
    if (!fs.existsSync(base)) continue;
    for (const version of fs.readdirSync(base).sort().reverse()) {
      candidates.push(path.join(base, version, os.arch() === 'arm64' ? 'arm64' : 'x64', 'signtool.exe'));
    }
  }

  return candidates.find((candidate) => candidate && fs.existsSync(candidate));
}

function removeWindowsSignature(executableFile) {
  const signtool = findWindowsSignTool();
  if (!signtool) {
    console.warn('signtool.exe was not found; continuing with SEA injection without removing the Node signature first.');
    return;
  }
  execFileSync(signtool, ['remove', '/s', executableFile], { stdio: 'inherit' });
}

async function makeExecutable(platform) {
  assertNativeBuild(platform);

  const buildDir = path.join(stagingRoot, platform);
  const bundleFile = path.join(buildDir, 'index.cjs');
  const seaConfigFile = path.join(buildDir, 'sea-config.json');
  const seaBlobFile = path.join(buildDir, 'sea-prep.blob');
  const executableFile = path.join(releaseRoot, outputName(platform));

  fs.rmSync(buildDir, { recursive: true, force: true });
  fs.mkdirSync(buildDir, { recursive: true });
  fs.mkdirSync(releaseRoot, { recursive: true });
  fs.rmSync(executableFile, { force: true });

  await build({
    entryPoints: [path.join(root, 'src', 'index.ts')],
    outfile: bundleFile,
    bundle: true,
    platform: 'node',
    target: `node${process.versions.node.split('.')[0]}`,
    format: 'cjs',
    sourcemap: false,
    minify: false,
    logLevel: 'info',
  });

  fs.writeFileSync(
    seaConfigFile,
    JSON.stringify({
      main: bundleFile,
      output: seaBlobFile,
      disableExperimentalSEAWarning: true,
      useCodeCache: false,
      useSnapshot: false,
    }, null, 2),
  );

  runNode(['--experimental-sea-config', seaConfigFile]);
  fs.copyFileSync(process.execPath, executableFile);
  if (process.platform !== 'win32') fs.chmodSync(executableFile, 0o755);

  if (process.platform === 'darwin') {
    execFileSync('codesign', ['--remove-signature', executableFile], { stdio: 'ignore' });
  } else if (process.platform === 'win32') {
    removeWindowsSignature(executableFile);
  }

  const { inject } = postjectModule;
  await inject(executableFile, 'NODE_SEA_BLOB', fs.readFileSync(seaBlobFile), {
    machoSegmentName: process.platform === 'darwin' ? 'NODE_SEA' : undefined,
    sentinelFuse: SEA_FUSE,
  });

  if (process.platform === 'darwin') {
    execFileSync('codesign', ['--force', '--sign', '-', executableFile], { stdio: 'inherit' });
  }

  execFileSync(executableFile, ['--tools'], { stdio: 'ignore' });
  copyDirRecursive(path.join(root, 'web'), path.join(releaseRoot, 'web'));
  console.log(`Executable written to ${executableFile}`);
  console.log(`Web UI assets copied to ${path.join(releaseRoot, 'web')}`);
}

const args = parseArgs(process.argv);
const platform = String(args.platform || hostPlatform());

if (platform === 'macos-universal') {
  throw new Error('Build macos-x64 and macos-arm64 first, then combine them with lipo in GitHub Actions.');
}

await makeExecutable(platform);
