# ============================================================================
# UNIVERSAL DECISION PLATFORM - Dockerfile
# ============================================================================
# Multi-stage build for minimal production image
# Uses Node 22 (LTS) with Alpine for small footprint
# ============================================================================

# ---------------------------------------------------------------------------
# Stage 1: Dependencies
# ---------------------------------------------------------------------------
FROM node:22-alpine AS deps

WORKDIR /app

# Update Alpine packages (SECURITY FIX)
RUN apk update && apk upgrade --no-cache

# Copy package files
COPY package*.json ./

# Install production dependencies only
# RUN npm ci --only=production && npm cache clean --force
RUN npm ci --omit=dev && npm cache clean --force

# ---------------------------------------------------------------------------
# Stage 2: Production image
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runner

# Update Alpine packages (SECURITY FIX)
RUN apk update && apk upgrade --no-cache \
    && apk add --no-cache curl

# Security: Run as non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 decision

WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy application code
COPY --chown=decision:nodejs package*.json ./
COPY --chown=decision:nodejs src ./src
COPY --chown=decision:nodejs config ./config

# Set environment defaults
ENV NODE_ENV=production
ENV PORT=3000
ENV ENGINE_VERSION=v1
ENV RULES_CONFIG_PATH=./config/rules.yaml
ENV AI_ENABLED=false

# Expose port
EXPOSE 3000

# Health check
# HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
#   CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -fs http://localhost:3000/health || exit 1


# Switch to non-root user
USER decision

# Start the application
CMD ["node", "src/server.js"]
