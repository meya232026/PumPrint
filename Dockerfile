# Pumprint: the site and its six tools in one container.
FROM node:22-alpine
WORKDIR /app
COPY . .
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/app/data
EXPOSE 8080
VOLUME ["/app/data"]
CMD ["node", "server/index.js"]
