# Universal Dockerfile for Ludo Online
FROM node:22-alpine

WORKDIR /app

# Copy application files
COPY package.json ./
COPY shared ./shared
COPY server ./server
COPY public ./public

# Set production environment
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Start server with native Node TypeScript support
CMD ["node", "--experimental-strip-types", "server/server.ts"]
