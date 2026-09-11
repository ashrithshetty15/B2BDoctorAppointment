#!/bin/sh
set -e

echo "Applying database migrations..."
npx prisma migrate deploy

case "$PROCESS" in
  api)
    exec node dist/server.js
    ;;
  worker)
    exec node dist/queue/worker.js
    ;;
  all|*)
    # MVP: one container, both processes. Worker in the background; API in the
    # foreground so the container exits if the API dies.
    node dist/queue/worker.js &
    WORKER_PID=$!
    trap 'kill -TERM $WORKER_PID 2>/dev/null' TERM INT
    exec node dist/server.js
    ;;
esac
