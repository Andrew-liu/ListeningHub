# syntax=docker/dockerfile:1
# Listening Hub API - Node.js + SQLite
FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package.json ./
RUN npm install --production

# Copy source
COPY . .

# Create data directory for SQLite
RUN mkdir -p /app/data

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --spider -q http://localhost:3000/api/health || exit 1

CMD ["node", "index.js"]
