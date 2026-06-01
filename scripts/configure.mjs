#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entry = path.join(root, 'dist', 'index.js');
const args = process.argv.slice(2);

const mode = args.includes('--write-opencode') ? ['harness'] : ['harness'];
const result = spawnSync(process.execPath, [entry, ...mode], { cwd: root, stdio: 'inherit' });
process.exit(result.status ?? 1);
