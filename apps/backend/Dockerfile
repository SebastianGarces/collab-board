FROM oven/bun:1 AS base
WORKDIR /app

# Copy all workspace package.json files so bun.lock stays consistent
COPY package.json bun.lock tsconfig.base.json ./
COPY apps/backend/package.json apps/backend/package.json
COPY apps/frontend/package.json apps/frontend/package.json
COPY packages/shared/package.json packages/shared/package.json

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source
COPY packages/shared packages/shared
COPY apps/backend apps/backend

WORKDIR /app/apps/backend

EXPOSE 3000

# Run migrations then start server
CMD ["sh", "-c", "bunx drizzle-kit migrate && bun src/index.ts"]
