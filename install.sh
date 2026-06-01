#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20+ is required. Please install Node.js first." >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required. Please install Node.js with npm first." >&2
  exit 1
fi
npm install
npm run build
npm run harness:install:open
