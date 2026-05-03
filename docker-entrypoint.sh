#!/bin/sh
set -e
mkdir -p /app/packages/api-server/data
chown appuser:appgroup /app/packages/api-server/data
exec gosu appuser "$@"
