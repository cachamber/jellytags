FROM node:20-alpine AS build

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build

# Production stage using Node runtime
FROM node:20-alpine

WORKDIR /app

# Patch OS packages in runtime image
RUN apk upgrade --no-cache

# Install only runtime dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy built frontend and server proxy
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/backend/server.mjs ./src/backend/server.mjs

# Expose port 80
EXPOSE 80

CMD ["node", "src/backend/server.mjs"]
