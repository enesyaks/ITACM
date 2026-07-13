FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production

RUN apk add --no-cache su-exec

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY public ./public
COPY scripts ./scripts
COPY server.js ./

COPY scripts/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh \
 && mkdir -p /app/data \
 && chown -R node:node /app

EXPOSE 8000

# Entrypoint runs as root briefly to chown the data volume, then drops to node.
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["node", "server.js"]
