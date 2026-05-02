# FlowDesk worker — single Node service running cron-driven jobs.
#
# Build context MUST be the repo root (so prisma/schema.prisma is reachable).
# Configure Railway:
#   Root Directory   = /                    (repo root, NOT worker/)
#   Dockerfile Path  = worker/Dockerfile
#   Start Command    = (defer to Dockerfile CMD)
#   Watch Paths      = worker/**, prisma/**

FROM node:20-alpine

WORKDIR /app

# Prisma's native query engine on Alpine needs OpenSSL at runtime.
RUN apk add --no-cache openssl

# Install runtime deps first so the layer is cached when only source changes.
COPY worker/package.json worker/package-lock.json* ./
RUN npm install --omit=dev

# Copy the Prisma schema and generate the client into ./node_modules/@prisma/client.
COPY prisma ./prisma
RUN npx --no-install prisma generate --schema=./prisma/schema.prisma

# Copy worker source last so source-only edits don't bust the deps cache.
COPY worker/tsconfig.json ./tsconfig.json
COPY worker/src ./src

ENV NODE_ENV=production
ENV TZ=America/New_York

CMD ["npm", "start"]
