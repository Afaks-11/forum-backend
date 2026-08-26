
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

RUN DATABASE_URL="postgresql://build:build@localhost:5432/build"  npx prisma generate
RUN npm run build

# Production
FROM node:24.18.0-alpine AS production

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./

RUN npm ci --omit=dev --ignore-scripts
RUN chown -R node:node /app/node_modules

COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/src/generated/prisma ./src/generated/prisma
COPY --from=builder --chown=node:node /app/prisma ./prisma
COPY --from=builder --chown=node:node /app/prisma.config.ts ./prisma.config.ts
# Copy startup script.
COPY --chown=node:node docker-entrypoint.sh ./docker-entrypoint.sh 

RUN chmod +x ./docker-entrypoint.sh 

USER node

EXPOSE 3000

CMD ["./docker-entrypoint.sh"]