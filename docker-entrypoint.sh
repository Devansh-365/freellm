#!/bin/sh
set -e
chown -R appuser:appgroup /home/appuser/.claude /app/packages/api-server/data 2>/dev/null || true
exec /usr/sbin/gosu appuser "$@"
