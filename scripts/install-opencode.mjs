#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entry = path.join(root, 'dist', 'index.js');
console.log('OpenCode is now configured from the MCP Harness local UI.');
console.log('Opening MCP Harness...');
const result = spawnSync(process.execPath, [entry, 'harness'], { cwd: root, stdio: 'inherit' });
process.exit(result.status ?? 1);
