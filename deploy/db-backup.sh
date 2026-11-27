#!/usr/bin/env bash
# Backup consistente de una base de datos PostgreSQL que corre en un contenedor Docker.
#
# Uso: db-backup.sh <prefijo> <contenedor> <usuario_bd> <nombre_bd> [retencion_dias]
#
#   db-backup.sh fidelback   fidelback-mcp-db  app_user    app_db     14
#   db-backup.sh chatcontrol chatcontrol-db    chatcontrol chatcontrol 14
#
# Decisiones:
# - Formato custom (-Fc): comprime, permite restauración selectiva y es portable.
# - Temporal + mv atómico: un volcado truncado nunca parece un backup válido.
# - Verificación con `pg_restore -l`: valida el archivo sin tocar la base.
# - flock: cron y una ejecución manual no se pisan.
# - Sin contraseñas: pg_dump entra por el socket local del contenedor.
# - Destino /srv/backups: fuera de los releases, sobrevive a los despliegues.

set -Eeuo pipefail

PREFIX="${1:?uso: db-backup.sh <prefijo> <contenedor> <usuario> <base> [retencion]}"
CONTAINER="${2:?falta contenedor}"
DB_USER="${3:?falta usuario}"
DB_NAME="${4:?falta nombre de la base}"
RETENTION_DAYS="${5:-14}"
DEST="${BACKUP_DIR:-/srv/backups}"
LOCK_DIR="${LOCK_DIR:-/tmp/lock}"
LOG_TAG="$(date -Is)"

log() { printf '%s [%s] %s\n' "$LOG_TAG" "$PREFIX" "$*"; }
die() { log "ERROR: $*"; exit 1; }

umask 077
STAMP="$(date +%Y%m%d_%H%M%S)"
TARGET="${DEST}/${PREFIX}_${STAMP}.dump"

mkdir -p "$DEST" "$LOCK_DIR"

# Bloqueo: si cron y una ejecución manual coinciden, la segunda se va sin error.
if command -v flock >/dev/null 2>&1; then
  exec 9>"${LOCK_DIR}/db-backup-${PREFIX}.lock"
  flock -n 9 || { log "AVISO: otra ejecución en curso, se omite"; exit 0; }
else
  log "AVISO: flock no disponible; se ejecuta sin bloqueo"
fi

command -v docker >/dev/null 2>&1 || die "docker no está en el PATH"
docker inspect "$CONTAINER" >/dev/null 2>&1 || die "el contenedor $CONTAINER no existe"
[ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null)" = "true" ] \
  || die "el contenedor $CONTAINER no está corriendo"

log "inicio: ${CONTAINER}/${DB_NAME} -> ${TARGET}"

TMP="$(mktemp "${DEST}/.${PREFIX}_${STAMP}.partial.XXXXXX")"
trap 'rm -f "$TMP"' EXIT

docker exec -i "$CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc > "$TMP" \
  || die "pg_dump devolvió error"
[ -s "$TMP" ] || die "el volcado está vacío"

MIN_BYTES="${MIN_BYTES:-2048}"
[ "$(stat -c%s "$TMP")" -ge "$MIN_BYTES" ] \
  || die "el volcado mide menos de ${MIN_BYTES} bytes: base vacía o volcado incompleto"

# Integridad: leer el catálogo TOC no abre la base, solo interpreta el archivo.
if docker image inspect postgres:17-alpine >/dev/null 2>&1; then
  docker run --rm -i postgres:17-alpine pg_restore -l < "$TMP" >/dev/null 2>&1 \
    || die "pg_restore no puede leer el archivo: corrupto o versión incompatible"
else
  log "AVISO: imagen postgres:17-alpine ausente; verificación de integridad omitida"
fi

mv -f "$TMP" "$TARGET"
trap - EXIT
chmod 600 "$TARGET"

DELETED="$(find "$DEST" -maxdepth 1 -type f -name "${PREFIX}_*.dump" -mtime +"${RETENTION_DAYS}" -print -delete | wc -l)"
FREE_KB="$(df -Pk "$DEST" | awk 'NR==2 {print $4}')"

log "ok: ${TARGET} ($(stat -c%s "$TARGET") bytes)"
log "retencion: ${DELETED} archivo(s) de mas de ${RETENTION_DAYS} dias eliminados"
log "espacio libre en ${DEST}: $((FREE_KB / 1024)) MB"
log "fin"