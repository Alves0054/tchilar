# Imagem da Tchilar em duas fases: a primeira compila o frontend; a segunda só leva o necessário
# para correr (sem ESLint, Vitest nem TypeScript) e não corre como root.
FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app /app
# A pasta das fotos e vídeos pertence ao utilizador "node" (um volume novo herda este dono).
RUN mkdir -p /app/uploads && chown node:node /app/uploads
USER node
EXPOSE 4000
CMD ["node", "server/index.js"]
