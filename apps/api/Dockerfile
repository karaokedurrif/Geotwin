# ==============================================================================
# Multi-stage Dockerfile for GeoTwin API (Fastify/Node.js)
# Build context: Repository root (.)
# ==============================================================================

# ------------------------------------------------------------------------------
# Stage 1: Install dependencies
# ------------------------------------------------------------------------------
FROM node:18-alpine AS deps

# Install pnpm globally
RUN npm install -g pnpm@9

WORKDIR /app

# Copy workspace configuration
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./

# Copy package.json files from all workspaces
COPY apps/api/package.json ./apps/api/
COPY packages/types/package.json ./packages/types/

# Install all dependencies
RUN pnpm install --frozen-lockfile --shamefully-hoist

# ------------------------------------------------------------------------------
# Stage 2: Build application
# ------------------------------------------------------------------------------
FROM node:18-alpine AS builder

# Install pnpm globally
RUN npm install -g pnpm@9

WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /app/packages/types/node_modules ./packages/types/node_modules

# Copy workspace configuration
COPY package.json pnpm-workspace.yaml tsconfig.json ./

# Copy source code
COPY packages/types ./packages/types
COPY apps/api ./apps/api

# Build shared types first (API depends on it)
RUN pnpm --filter @geotwin/types build

# Build API
RUN pnpm --filter @geotwin/api build

# ------------------------------------------------------------------------------
# Stage 3: Production runtime
# ------------------------------------------------------------------------------
FROM node:18-alpine AS runner

# Install wget for healthcheck
RUN apk add --no-cache wget

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S geotwin -u 1001

WORKDIR /app

# Install Node.js production only
# Copy node_modules with actual packages (not symlinks)
COPY --from=deps /app/node_modules/.pnpm ./node_modules/.pnpm
COPY --from=deps /app/apps/api/node_modules ./node_modules
COPY --from=deps /app/node_modules ./node_modules

# Copy built application
COPY --from=builder --chown=geotwin:nodejs /app/apps/api/dist ./dist
COPY --from=builder --chown=geotwin:nodejs /app/apps/api/package.json ./package.json

# Copy shared types
COPY --from=builder --chown=geotwin:nodejs /app/packages/types/dist ./node_modules/@geotwin/types/dist
COPY --from=builder --chown=geotwin:nodejs /app/packages/types/package.json ./node_modules/@geotwin/types/package.json

# Create data directory for twin datasets
RUN mkdir -p /app/data && chown -R geotwin:nodejs /app/data

# Switch to non-root user
USER geotwin

# Expose port
EXPOSE 3001

# Environment variables
ENV NODE_ENV=production \
    PORT=3001 \
    HOST=0.0.0.0

# Start server
CMD ["node", "dist/server.js"]
