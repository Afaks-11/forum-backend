#!/bin/sh

set -e 

echo "Running Prisma database migrations..."

npm run db:deploy

echo "Starting API"

exec node dist/main.js

