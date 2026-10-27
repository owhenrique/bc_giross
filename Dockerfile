FROM node:24-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npm ci
COPY . .
EXPOSE 3000
CMD ["npm", "run", "start:container"]
