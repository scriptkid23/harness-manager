# Single image used by all three harness services (api / web / mcp); each picks
# a different command in docker-compose. Node 20 so the better-sqlite3 native
# addon is built for the runtime that actually runs it (no host ABI concerns).
FROM node:20-bookworm-slim

# Build toolchain for better-sqlite3's native compile fallback + ca-certs.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable

WORKDIR /app

# Baked into the Next build; server-side fetches hit the api service by name.
ENV HARNESS_API_BASE=http://harness-api:4000

COPY . .

# Installs deps + runs postinstall (prisma generate + builds the MCP bundles).
RUN pnpm install

# Pre-build the read-only dashboard so `next start` boots fast.
RUN pnpm --filter @harness/web build

EXPOSE 3000 4000 8765
