FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json server.js ./
COPY public ./public
RUN mkdir -p /var/data && chown -R node:node /app /var/data
USER node
ENV DATA_DIR=/var/data
EXPOSE 3000
CMD ["npm", "start"]
