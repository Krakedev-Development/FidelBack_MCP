#!/bin/sh
# Arranque de la API (FidelBack_MCP): aplica migraciones pendientes y arranca el servidor.
# Finales de línea LF; el Dockerfile normaliza antes de dar permisos.
set -e

echo "=== FidelBack_MCP Entrypoint ==="
echo "NODE_ENV=${NODE_ENV:-production}"
echo "PORT=${PORT:-4000}"

# Esperar a la base de datos (máx 60 s)
echo "Esperando a PostgreSQL en db:5432..."
db_ready=0
for i in $(seq 1 30); do
  if pg_isready -h db -p 5432 -U "${POSTGRES_USER:-app_user}" -d "${POSTGRES_DB:-app_db}" -q; then
    echo "PostgreSQL listo."
    db_ready=1
    break
  fi
  echo "intento $i/30..."
  sleep 2
done

if [ "$db_ready" -ne 1 ]; then
  echo "ERROR: PostgreSQL no estuvo disponible después de 60 segundos." >&2
  exit 1
fi

# Aplicar migraciones Prisma.
# "prisma" es dependencia de producción (no se elimina con `pnpm prune --prod`),
# y se usa el binario local para respetar la versión fijada por el lockfile (7.10.1).
# Si el repositorio aún no incluye prisma/migrations, se omite sin romper el arranque.
migration_file=$(find prisma/migrations -name 'migration.sql' 2>/dev/null | head -n 1)
if [ -z "$migration_file" ]; then
  echo "Aviso: no hay migraciones en prisma/migrations; se omite 'migrate deploy'."
else
  echo "Ejecutando migraciones..."
  if [ -x ./node_modules/.bin/prisma ]; then
    ./node_modules/.bin/prisma migrate deploy
  elif [ -f ./node_modules/prisma/build/index.js ]; then
    node ./node_modules/prisma/build/index.js migrate deploy
  else
    echo "ERROR: CLI de Prisma no encontrado en node_modules (¿es devDependency y se podó en la imagen?)." >&2
    exit 1
  fi
fi

# Arrancar servidor
echo "Iniciando servidor en puerto ${PORT:-4000}..."
exec node dist/main.js
