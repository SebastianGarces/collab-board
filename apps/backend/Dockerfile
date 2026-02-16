FROM oven/bun:1 AS base
WORKDIR /app

# Copy workspace root files
COPY package.json bun.lock ./
COPY apps/backend/package.json apps/backend/package.json
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
