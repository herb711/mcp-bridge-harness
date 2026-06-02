#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

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

const args = parseArgs(process.argv);
const version = args.version;
const repo = args.repo;
const tag = args.tag || (version ? `v${version}` : '');
const inputDir = path.resolve(String(args.input || '.'));
const outputFile = path.resolve(String(args.output || path.join(inputDir, 'latest.json')));
const notes = typeof args.notes === 'string' ? args.notes : '';

if (!version) throw new Error('--version is required');
if (!repo) throw new Error('--repo is required (e.g. owner/name)');

const sumsFile = path.join(inputDir, 'SHA256SUMS');
if (!fs.existsSync(sumsFile)) {
  throw new Error(`SHA256SUMS not found in ${inputDir}`);
}

const sumsContent = fs.readFileSync(sumsFile, 'utf8');
const checksums = Object.create(null);
for (const line of sumsContent.split(/\r?\n/)) {
  const match = line.replace(/^\uFEFF/, '').match(/^([a-f0-9]{64})\s+(.+)$/);
  if (match) checksums[match[2]] = match[1];
}

const platformAliases = {
  'win-x64': 'windows-x64',
  'win-arm64': 'windows-arm64',
  'windows-x64': 'windows-x64',
  'windows-x64-setup': 'windows-x64',
  'windows-x64-portable': 'windows-x64',
  'windows-arm64': 'windows-arm64',
  'windows-arm64-setup': 'windows-arm64',
  'windows-arm64-portable': 'windows-arm64',
  'linux-x64': 'linux-x64',
  'linux-arm64': 'linux-arm64',
  'macos-x64': 'macos-x64',
  'macos-arm64': 'macos-arm64',
};

const archFromToken = {
  x64: 'x64',
  arm64: 'arm64',
};

const platformByOs = {
  win: 'windows',
  windows: 'windows',
  linux: 'linux',
  macos: 'macos',
  mac: 'macos',
  darwin: 'macos',
};

function platformKeyFor(file) {
  const m = file.match(/^mcp-harness-\d+\.\d+\.\d+-(.+?)(\.[a-z0-9.]+)?$/i);
  if (!m) return null;
  const lower = file.toLowerCase();
  const tokens = m[1].split('-');
  let osName = null;
  let arch = null;
  for (const token of tokens) {
    if (platformByOs[token.toLowerCase()]) osName = platformByOs[token.toLowerCase()];
    else if (archFromToken[token.toLowerCase()]) arch = archFromToken[token.toLowerCase()];
  }
  if (!osName) {
    if (lower.endsWith('.exe')) osName = 'windows';
    else if (lower.endsWith('.dmg') || lower.endsWith('.zip')) osName = 'macos';
    else if (lower.endsWith('.appimage')) osName = 'linux';
  }
  if (!osName && tokens.length === 1 && archFromToken[tokens[0].toLowerCase()]) {
    return null;
  }
  if (osName && arch) return `${osName}-${arch}`;
  return tokens.join('-');
}

function aliasFor(platformKey) {
  if (platformAliases[platformKey]) return platformAliases[platformKey];
  return platformKey;
}

const platforms = {};
const entries = fs.readdirSync(inputDir, { withFileTypes: true });
for (const entry of entries) {
  if (!entry.isFile()) continue;
  const file = entry.name;
  const lowerFile = file.toLowerCase();
  if (file === 'SHA256SUMS' || lowerFile === 'latest.json' || lowerFile.endsWith('.json') || lowerFile.endsWith('.blockmap') || lowerFile.endsWith('.yml')) continue;
  const platformKey = platformKeyFor(file);
  if (!platformKey) continue;
  const alias = aliasFor(platformKey);
  const sha = checksums[file];
  if (!sha) {
    console.warn(`warning: no SHA256 recorded for ${file}, skipping`);
    continue;
  }
  const stats = fs.statSync(path.join(inputDir, file));
  if (!platforms[alias]) platforms[alias] = [];
  platforms[alias].push({
    upstreamPlatform: platformKey,
    asset: file,
    url: `https://github.com/${repo}/releases/download/${tag}/${file}`,
    sha256: sha,
    size: stats.size,
  });
}

for (const [alias, list] of Object.entries(platforms)) {
  list.sort((a, b) => a.asset.localeCompare(b.asset));
}

const manifest = {
  schemaVersion: 'mcp-harness.update/v1',
  name: 'mcp-harness',
  version,
  tag,
  releaseDate: new Date().toISOString(),
  notes,
  platforms,
};

fs.mkdirSync(path.dirname(outputFile), { recursive: true });
fs.writeFileSync(outputFile, JSON.stringify(manifest, null, 2) + '\n');
console.log(`Wrote ${outputFile}`);
console.log(`  platforms: ${Object.keys(platforms).map((alias) => `${alias}(${platforms[alias].length})`).join(', ') || '(none)'}`);
