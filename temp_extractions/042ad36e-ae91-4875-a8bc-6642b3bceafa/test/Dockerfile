# ==========================================================
# STAGE 1: Builder
# ==========================================================
FROM node:18-alpine AS builder

WORKDIR /app

# Install dependencies in a separate layer for caching efficiency
COPY package*.json ./
RUN npm ci

# Copy source code and build production assets
COPY . .
RUN npm run build

# Remove development dependencies to keep image size small
RUN npm prune --production


# ==========================================================
# STAGE 2: Runner (Production)
# ==========================================================
FROM node:18-alpine AS runner

LABEL maintainer="Terratech Solutions <green-it@terratech.com>"
LABEL description="Optimized production image for EcoSphere Dashboard"

WORKDIR /app
ENV NODE_ENV=production

# Create a non-privileged user for security
RUN addgroup -g 1001 -S nodejs && adduser -S nextuser -u 1001

# Copy only the necessary runtime files from build stage
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/server ./server
COPY --from=builder /app/src ./src

# Set proper ownership
RUN chown -R nextuser:nodejs /app

USER nextuser

EXPOSE 3000

CMD ["node", "server/index.js"]
