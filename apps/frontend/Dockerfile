FROM oven/bun:1 AS base
WORKDIR /app

# Copy workspace root files
COPY package.json bun.lock ./
COPY apps/frontend/package.json apps/frontend/package.json
COPY packages/shared/package.json packages/shared/package.json

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source
COPY packages/shared packages/shared
COPY apps/frontend apps/frontend

# Build
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

WORKDIR /app/apps/frontend
RUN bun run build

# Production image
FROM oven/bun:1 AS runner
WORKDIR /app

ENV NODE_ENV=production

COPY --from=base /app/apps/frontend/.next/standalone ./
COPY --from=base /app/apps/frontend/.next/static ./apps/frontend/.next/static
COPY --from=base /app/apps/frontend/public ./apps/frontend/public

ENV PORT=5173
EXPOSE 5173

CMD ["bun", "apps/frontend/server.js"]
