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
  const match = line.match(/^([a-f0-9]{64})\s+(.+)$/);
  if (match) checksums[match[2]] = match[1];
}

const platformAliases = {
  'win-x64': 'windows-x64',
  'win-arm64': 'windows-arm64',
  'linux-x64': 'linux-x64',
  'linux-arm64': 'linux-arm64',
  'macos-x64': 'macos-x64',
  'macos-arm64': 'macos-arm64',
};

const platforms = {};
const entries = fs.readdirSync(inputDir, { withFileTypes: true });
for (const entry of entries) {
  if (!entry.isFile()) continue;
  const file = entry.name;
  if (file === 'SHA256SUMS' || file === 'latest.json' || file.endsWith('.json')) continue;
  const m = file.match(/^mcp-harness-\d+\.\d+\.\d+-(.+?)(\.exe)?$/);
  if (!m) continue;
  const platformKey = m[1];
  const alias = platformAliases[platformKey] || platformKey;
  const sha = checksums[file];
  if (!sha) {
    console.warn(`warning: no SHA256 recorded for ${file}, skipping`);
    continue;
  }
  const stats = fs.statSync(path.join(inputDir, file));
  platforms[alias] = {
    upstreamPlatform: platformKey,
    asset: file,
    url: `https://github.com/${repo}/releases/download/${tag}/${file}`,
    sha256: sha,
    size: stats.size,
  };
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
console.log(`  platforms: ${Object.keys(platforms).join(', ') || '(none)'}`);
