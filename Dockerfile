# ---------- Build (incluye devDependencies) ----------
# Esta etapa también se usa para tareas puntuales en el VPS (p. ej. el seed):
#   docker build --target build -t fidelback-api:tools ./api
FROM node:22-alpine AS build
WORKDIR /app

RUN apk add --no-cache openssl
RUN corepack enable && corepack prepare pnpm@12.23.0 --activate

COPY package.json pnpm-lock.yaml ./
COPY pnpm-workspace.yaml ./
COPY prisma ./prisma
COPY prisma.config.ts ./

# prisma generate no requiere una DB real durante el build
ENV DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build"

RUN pnpm install --frozen-lockfile

COPY . .

# Normalizar finales de línea del entrypoint y dar permisos
RUN sed -i 's/\r$//' docker-entrypoint.sh && chmod +x docker-entrypoint.sh

RUN pnpm build

# ---------- Dependencias de producción ----------
FROM build AS pruned
RUN pnpm prune --prod --ignore-scripts

# El cliente generado por `prisma generate` debe sobrevivir al prune;
# si falta, el contenedor fallaría en el primer request.
RUN node -e "require('@prisma/client'); console.log('Prisma Client OK')"

# ---------- Runtime ----------
FROM node:22-alpine AS production
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000

RUN apk add --no-cache postgresql-client openssl

COPY --from=pruned --chown=node:node /app/node_modules ./node_modules
COPY --from=pruned --chown=node:node /app/dist ./dist
COPY --from=pruned --chown=node:node /app/package.json ./package.json
COPY --from=pruned --chown=node:node /app/prisma ./prisma
COPY --from=pruned --chown=node:node /app/prisma.config.ts ./prisma.config.ts
COPY --from=pruned --chown=node:node /app/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x docker-entrypoint.sh

# El entrypoint aplica migraciones: el CLI de Prisma debe estar en la imagen final.
RUN [ -x node_modules/.bin/prisma ] || [ -f node_modules/prisma/build/index.js ]

USER node
EXPOSE 4000

# Healthcheck TCP: la API no expone /health HTTP, se comprueba que acepte conexiones en el puerto 4000.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "const s=require('net').connect(4000,'127.0.0.1');s.on('connect',()=>{s.end();process.exit(0)});s.on('error',()=>process.exit(1));"

ENTRYPOINT ["./docker-entrypoint.sh"]
