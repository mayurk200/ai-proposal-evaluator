# ---------- Build stage ----------
FROM node:18-alpine AS builder

WORKDIR /app

# Install ALL dependencies (incl. devDeps like typescript) — needed to build.
COPY package*.json ./
RUN npm ci

# Copy source and compile TypeScript -> dist/
COPY . .
RUN npm run build

# ---------- Production stage ----------
FROM node:18-alpine

WORKDIR /app

ENV NODE_ENV=production

# Install production dependencies only.
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Compiled app.
COPY --from=builder /app/dist ./dist

# Runtime upload dir (local-provider fallback) + non-root user.
RUN mkdir -p /app/uploads && \
    addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

USER nodejs

EXPOSE 3001

CMD ["node", "dist/server.js"]
