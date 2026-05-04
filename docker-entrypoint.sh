#!/bin/sh
set -e
mkdir -p /app/packages/api-server/data
chown appuser:appgroup /app/packages/api-server/data
if [ -d /home/appuser/.claude ]; then
  chown -R appuser:appgroup /home/appuser/.claude || true
fi
exec gosu appuser "$@"
