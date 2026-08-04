
# Install dependencies
FROM node:24.18.0-alpine AS dependencies

WORKDIR /app

COPY package*.json ./

RUN npm ci 

# Build the application
FROM node:24.18.0-alpine AS builder 

WORKDIR /app

COPY --from=dependencies /app/node_modules ./node_modules
COPY . .

RUN DATABASE_URL="postgresql://mock_user:mock_password@localhost:5432/mock_db" ./node_modules/.bin/prisma generate

RUN npm run build

# Production
FROM node:24.18.0-alpine AS production

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./

RUN npm ci --omit=dev --ignore-scripts

# --chown keeps the runtime files owned by the unprivileged user below, so the
# process can read them without being able to overwrite its own code.
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/src/generated/prisma ./dist/generated/prisma
COPY --from=builder --chown=node:node /app/src/generated/prisma ./src/generated/prisma

# The node image ships a non-root `node` user (uid 1000). Running as root inside
# the container means a container escape starts with host-root-equivalent uid.
USER node

EXPOSE 3000

# Lets any orchestrator (compose, ECS, Kubernetes via a probe translation) read
# readiness from the image itself instead of duplicating the command per env.
# /health/ready verifies Postgres, Redis, BullMQ and Socket.IO, not just liveness.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
	CMD node -e "fetch('http://127.0.0.1:3000/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js"]