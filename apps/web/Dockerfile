# ==============================================================================
# Multi-stage Dockerfile for GeoTwin Web (Next.js)
# Build context: Repository root (.)
# ==============================================================================

# Build arguments for Next.js public environment variables
# These are baked into the build and cannot be changed at runtime
ARG NEXT_PUBLIC_API_URL=https://api.geotwin.es
ARG NEXT_PUBLIC_API_BASE_URL=https://api.geotwin.es
ARG NEXT_PUBLIC_CESIUM_ION_TOKEN

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
COPY apps/web/package.json ./apps/web/
COPY packages/types/package.json ./packages/types/

# Install all dependencies
RUN pnpm install --frozen-lockfile --shamefully-hoist

# ------------------------------------------------------------------------------
# Stage 2: Build application
# ------------------------------------------------------------------------------
FROM node:18-alpine AS builder

# Re-declare ARGs for this stage
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_CESIUM_ION_TOKEN

# Set as environment variables for Next.js build
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL \
    NEXT_PUBLIC_CESIUM_ION_TOKEN=$NEXT_PUBLIC_CESIUM_ION_TOKEN

# Install pnpm globally
RUN npm install -g pnpm@9

WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /app/packages/types/node_modules ./packages/types/node_modules

# Copy workspace configuration
COPY package.json pnpm-workspace.yaml tsconfig.json ./

# Copy source code
COPY packages/types ./packages/types
COPY apps/web ./apps/web

# Build shared types first (Web depends on it)
RUN pnpm --filter @geotwin/types build

# Build Next.js application
WORKDIR /app/apps/web
RUN pnpm build

# ------------------------------------------------------------------------------
# Stage 3: Production runtime
# ------------------------------------------------------------------------------
FROM node:18-alpine AS runner

# Install wget for healthcheck
RUN apk add --no-cache wget

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001

WORKDIR /app

# Copy standalone output
# Next.js standalone mode generates a self-contained server in .next/standalone
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
# Copy pnpm store to resolve symlinks
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/.pnpm /node_modules/.pnpm

# Copy static assets
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./public

# Switch to non-root user
USER nextjs

# Expose port
EXPOSE 3000

# Environment variables
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Start Next.js server
# The standalone build creates server.js at the workspace app location
CMD ["node", "server.js"]
