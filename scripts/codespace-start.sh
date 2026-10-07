#!/usr/bin/env bash
# Runs every time the Codespace starts: fetch the latest code on the current branch,
# install, rebuild the web app, re-create an outdated database and start FinBridge on port 4000.
set -u
cd "$(dirname "$0")/.."
LOG=/tmp/finbridge.log
echo "=== FinBridge start $(date) ===" > "$LOG"

# 1. latest code (fast-forward only, never overwrites local changes)
git pull --ff-only >> "$LOG" 2>&1 || echo "git pull skipped (local changes or offline)" >> "$LOG"

# 2. dependencies and web build
npm install --no-audit --no-fund >> "$LOG" 2>&1
npm run build >> "$LOG" 2>&1

# 3. database: create if missing, re-create if it was made by an older version
DB=server/data/finbridge.db
if [ ! -f "$DB" ] || node -e "
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(process.argv[1]);
  const t = db.prepare(\"SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'\").get();
  const old = !t || db.prepare(\"SELECT 1 FROM schema_migrations WHERE version = '001_init.sql'\").get();
  process.exit(old ? 0 : 1);
" "$DB" 2>> "$LOG"; then
  echo "database missing or outdated → reset + demo data" >> "$LOG"
  npm run db:reset >> "$LOG" 2>&1
fi

# 4. stop a previous FinBridge server (only the one on port 4000) and start the new one
OLD=$(lsof -ti tcp:4000 2>/dev/null || fuser 4000/tcp 2>/dev/null || true)
[ -n "$OLD" ] && kill $OLD 2>/dev/null
nohup npm start >> "$LOG" 2>&1 &
echo "FinBridge started — log: $LOG"
