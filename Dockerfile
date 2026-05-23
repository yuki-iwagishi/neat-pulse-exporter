# syntax=docker/dockerfile:1

# ---- base ----
FROM node:22-alpine AS base
WORKDIR /app

# Install production dependencies only
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Copy application files
COPY src/  ./src/
COPY public/ ./public/

# Run as non-root
RUN addgroup -S neat && adduser -S neat -G neat
USER neat

# Default port — can be overridden with -e PORT=xxxx
EXPOSE 3000

# Healthcheck so orchestrators know when the server is ready
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health | grep '"ok":true' || exit 1

CMD ["node", "src/server.js"]
