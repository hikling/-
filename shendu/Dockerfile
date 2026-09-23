FROM node:24-alpine
RUN apk add --no-cache tini tzdata su-exec
WORKDIR /app
COPY package.json server.mjs ./
COPY scripts ./scripts
COPY public ./public
RUN mkdir -p /app/data /app/tmp \
  && chmod +x /app/scripts/docker-entrypoint.sh \
  && chown -R node:node /app
ENV NODE_ENV=production SHENDU_PORT=3000 SHENDU_DATA_DIR=/app/data SHENDU_TMP_DIR=/app/tmp
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
ENTRYPOINT ["/sbin/tini", "--", "/app/scripts/docker-entrypoint.sh"]
CMD ["node", "server.mjs"]
