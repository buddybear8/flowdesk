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
# until package.json/lock changes. `npm ci` (not `install`) so the install is
# deterministic against package-lock.json and node_modules is wiped first —
# avoids the failure mode where a stale Railway build cache served a partial
# node_modules tree that was missing prisma's bin symlink.
COPY worker/package.json worker/package-lock.json ./worker/
RUN cd worker && npm ci --omit=dev

# Copy the Prisma schema (parallel to worker/, matching dev layout) and
# generate the typed client. The schema's output path resolves to
# /app/worker/node_modules/.prisma/client.
#
# Prisma 5's "auto-install on generate" walks up from the schema dir looking
# for a package.json. With our split layout (schema at /app/prisma/, worker
# package.json at /app/worker/package.json) it stops at /app, and even with
# a stub there it then checks whether `prisma` itself is declared as a dep
# — if not, it tries to bootstrap an install which fails inside the
# read-only-ish builder. Two defenses:
#   1. Stub package.json declares prisma + @prisma/client in devDependencies,
#      satisfying the "is prisma already declared?" check.
#   2. CI=true makes Prisma's CI detection skip interactive install paths.
# Together these route Prisma to the binary already at /app/worker/node_modules.
COPY prisma ./prisma
RUN echo '{"name":"flowdesk-monorepo","private":true,"devDependencies":{"prisma":"5.22.0","@prisma/client":"5.22.0"}}' > /app/package.json
ENV CI=true
RUN cd worker && npx --no-install prisma generate --schema=../prisma/schema.prisma

# Copy worker source last so source-only edits don't bust the deps cache.
COPY worker/tsconfig.json ./worker/
COPY worker/src ./worker/src

# Subsequent commands (CMD, ENV) run from the worker package root.
WORKDIR /app/worker

ENV NODE_ENV=production
ENV TZ=America/New_York

CMD ["npm", "start"]
