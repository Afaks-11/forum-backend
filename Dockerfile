
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

COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=builder /app/dist ./dist

EXPOSE 3000

CMD ["node", "dist/main.js" ]