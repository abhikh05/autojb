# Backend deploy image (Render web service).
# Bundles Chromium so Puppeteer works out of the box.
FROM node:20-slim

# Chromium + fonts + libs Puppeteer needs on Debian-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    ca-certificates fonts-liberation libnss3 libxss1 libasound2 libgbm1 libatk-bridge2.0-0 \
    libgtk-3-0 libxkbcommon0 libpangocairo-1.0-0 libxdamage1 libxfixes3 libxrandr2 \
    libcups2 libx11-xcb1 dumb-init \
  && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production

WORKDIR /app

# Install prod deps only (root package.json — Next.js app in web/ is deployed elsewhere)
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund || npm install --omit=dev --no-audit --no-fund

# App source
COPY src ./src
COPY state.json ./state.json
COPY uploads ./uploads

EXPOSE 3000
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "src/server.js"]
