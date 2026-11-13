# Node.js 20 on Debian 12 (not Alpine) for better Prisma compatibility.
# (Debian 11 "bullseye" is end-of-life and its package servers no longer have the files, so it cannot be built.)
FROM node:20-bookworm-slim

# Set working directory
WORKDIR /app

# Install system dependencies for Prisma and Canvas (minimal)
RUN apt-get update && apt-get install -y \
    openssl \
    ca-certificates \
    libcairo2 \
    libjpeg62-turbo \
    libpango-1.0-0 \
    libgif7 \
    librsvg2-2 \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./

# Copy public folder for assets (logo, seal)
COPY public ./public

# Install dependencies
RUN npm install --production

# Install wait-for-it for database dependency
ADD https://raw.githubusercontent.com/vishnubob/wait-for-it/master/wait-for-it.sh /wait-for-it.sh
RUN chmod +x /wait-for-it.sh

# Copy application files
COPY . .

# Expose port
EXPOSE 5000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:5000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start application with schema sync
CMD ["sh", "-c", "/wait-for-it.sh postgres:5432 --timeout=30 -- npx prisma generate && npm run db:migrate && npm start"]
