FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV DATA_DIR=/app/data
EXPOSE 5174 8787

CMD ["npm", "run", "dev"]
