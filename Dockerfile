FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    COREPACK_HOME=/corepack

WORKDIR /app

RUN mkdir -p "$COREPACK_HOME" \
    && corepack enable \
    && corepack prepare pnpm@10.18.3 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

RUN pnpm exec playwright install --with-deps --only-shell chromium \
    && rm -rf /var/lib/apt/lists/*

COPY tsconfig.json ./
COPY src ./src
RUN pnpm build \
    && pnpm prune --prod \
    && pnpm store prune \
    && mkdir -p /app/capturas /app/var/chatbot-documents \
    && chown -R node:node /app/capturas /app/var

USER node

EXPOSE 3000

CMD ["node", "--enable-source-maps", "dist/server.js"]
