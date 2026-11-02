# Imágenes de la app, de las herramientas (migraciones, seed, worker) y de producción.
FROM node:24-slim AS base
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

# Migraciones (prisma migrate deploy), seed y worker: necesitan la CLI de Prisma y tsx.
FROM base AS tools
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json /app/tsconfig.json ./
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/src ./src
COPY --from=builder /app/scripts ./scripts
USER node
CMD ["npx", "prisma", "migrate", "deploy"]

# App web: salida standalone de Next, sin devDependencies.
FROM base AS runner
ENV NODE_ENV=production \
    PORT=3100 \
    HOSTNAME=0.0.0.0
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3100
CMD ["node", "server.js"]
