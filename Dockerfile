FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production

RUN apk add --no-cache su-exec postgresql16-client unzip  || apk add --no-cache su-exec postgresql-client unzip

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
# FRONTEND_DIGEST must change whenever public/ changes so BuildKit does not
# reuse a stale `COPY public` layer (common on Docker Desktop + multiple clones).
ARG FRONTEND_DIGEST=unknown
RUN printf '%s\n' "$FRONTEND_DIGEST" > /tmp/itacm-frontend.digest
COPY public ./public
COPY scripts ./scripts
COPY server.js ./

COPY scripts/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh \
 && mkdir -p /app/data \
 && chown -R node:node /app

EXPOSE 8000

# Entrypoint runs as root briefly to chown the data volume, then drops to node.
# DO NOT set USER node here — the entrypoint must start as root to fix volume perms.
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["node", "server.js"]
