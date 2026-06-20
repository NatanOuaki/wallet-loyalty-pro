FROM node:22-alpine

WORKDIR /app
COPY package.json ./
COPY server.js ./
COPY index.html join.html styles.css app.js wallet-demo.html ./
COPY docs ./docs
COPY scripts ./scripts
RUN mkdir -p data tmp

ENV PORT=4173
EXPOSE 4173

CMD ["node", "server.js"]
