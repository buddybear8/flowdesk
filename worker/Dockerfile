# FlowDesk worker — single Node service running cron-driven jobs.
#
# Build context MUST be the repo root (so prisma/schema.prisma is reachable).
# The image preserves the dev tree layout — /app/worker/ and /app/prisma/
# side-by-side — so the schema's `output = "../worker/node_modules/.prisma/client"`
# resolves identically in dev and prod.
#
# Configure Railway:
#   Root Directory   = /                    (repo root, NOT worker/)
#   Dockerfile Path  = worker/Dockerfile
#   Start Command    = (defer to Dockerfile CMD)
#   Watch Paths      = worker/**, prisma/**

FROM node:20-alpine

WORKDIR /app

# Prisma's native query engine on Alpine needs OpenSSL at runtime.
RUN apk add --no-cache openssl

# Install runtime deps inside /app/worker/node_modules/. This layer is cached
# until package.json/lock changes.
COPY worker/package.json worker/package-lock.json* ./worker/
RUN cd worker && npm install --omit=dev

# Copy the Prisma schema (parallel to worker/, matching dev layout) and
# generate the typed client. The schema's output path resolves to
# /app/worker/node_modules/.prisma/client.
COPY prisma ./prisma
RUN cd worker && npx --no-install prisma generate --schema=../prisma/schema.prisma

# Copy worker source last so source-only edits don't bust the deps cache.
COPY worker/tsconfig.json ./worker/
COPY worker/src ./worker/src

# Subsequent commands (CMD, ENV) run from the worker package root.
WORKDIR /app/worker

ENV NODE_ENV=production
ENV TZ=America/New_York

CMD ["npm", "start"]
