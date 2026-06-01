#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { getAgentManifest } from '../dist/manifest.js';

writeFileSync('agent.manifest.json', JSON.stringify(getAgentManifest(), null, 2) + '\n');
console.log('generated agent.manifest.json');
