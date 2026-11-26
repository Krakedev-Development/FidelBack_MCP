#!/usr/bin/env bash
# Despliegue de FidelBack_MCP en el VPS, invocado por el workflow de GitHub Actions.
# Uso: bash vps-deploy.sh /tmp/fidelback-mcp.tgz <release-id>
#
# Estructura esperada: /srv/docker/fidelback-mcp/{compose.yml,.env,api/}
# La primera vez hay que crear el stack a mano (ver docs/DESPLIEGUE-VPS.md).

set -Eeuo pipefail

TARBALL="${1:?falta tarball}"
RELEASE_ID="${2:-$(date +%Y%m%d%H%M%S)}"
STACK_DIR="/srv/docker/${VPS_STACK_NAME:-fidelback-mcp}"
COMPOSE_FILE="${STACK_DIR}/compose.yml"
API_DIR="${STACK_DIR}/api"
NEW_DIR="${STACK_DIR}/api.new"
OLD_DIR="${STACK_DIR}/api.old"
IMAGE="fidelback-api:latest"
# No existe /health HTTP: se comprueba que la API responda en el puerto publicado (4001).
HEALTH_URL="http://127.0.0.1:4001/api"   # respuesta esperada: 404 o 200 (ruta raíz sin endpoint)
HEALTH_EXPECT="${HEALTH_EXPECT:-404}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-90}"
HEALTH_INTERVAL=5
STAGE="inicio"

compose() {
  docker compose -f "$COMPOSE_FILE" --env-file "$STACK_DIR/.env" "$@"
}

rollback_image() {
  local rollback_tag="fidelback-api:back-${RELEASE_ID}"
  if docker image inspect "$rollback_tag" >/dev/null 2>&1; then
    docker tag "$rollback_tag" "$IMAGE"
  fi
}

on_error() {
  local exit_code=$?
  printf '[deploy-api] ERROR stage=%s line=%s exit=%s\n' "$STAGE" "$1" "$exit_code" >&2
  exit "$exit_code"
}
trap 'on_error "$LINENO"' ERR

STAGE="validaciones previas"
[ -f "$TARBALL" ] || { echo "No existe el tarball: $TARBALL" >&2; exit 2; }
[ -f "$COMPOSE_FILE" ] || { echo "No existe el compose: $COMPOSE_FILE" >&2; exit 3; }
[ -f "$STACK_DIR/.env" ] || { echo "No existe $STACK_DIR/.env (POSTGRES_PASSWORD)" >&2; exit 3; }
docker info >/dev/null 2>&1 || { echo "Docker no responde" >&2; exit 3; }
command -v curl >/dev/null 2>&1 || { echo "curl no instalado" >&2; exit 3; }

STAGE="preparar rollback de imagen"
if docker image inspect "$IMAGE" >/dev/null 2>&1; then
  docker tag "$IMAGE" "fidelback-api:back-${RELEASE_ID}" || true
fi

STAGE="extraer release en api.new"
rm -rf "$NEW_DIR"
mkdir -p "$NEW_DIR"
tar -xzf "$TARBALL" -C "$NEW_DIR"

STAGE="conservar configuracion local"
if [ -f "$API_DIR/.env" ]; then cp -a "$API_DIR/.env" "$NEW_DIR/.env"; fi

STAGE="intercambiar version API"
if [ -d "$API_DIR" ]; then rm -rf "$OLD_DIR"; mv "$API_DIR" "$OLD_DIR"; fi
mv "$NEW_DIR" "$API_DIR"

STAGE="construir y arrancar API"
if ! compose up -d --build api; then
  echo "Fallo build/arranque API" >&2
  if [ -d "$OLD_DIR" ]; then rm -rf "$API_DIR"; mv "$OLD_DIR" "$API_DIR"; fi
  rollback_image || true
  compose up -d --force-recreate api || true
  exit 1
fi

STAGE="healthcheck API"
deadline=$(( $(date +%s) + HEALTH_TIMEOUT ))
healthy=0
last_code="000"
while [ "$(date +%s)" -lt "$deadline" ]; do
  last_code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$HEALTH_URL" || true)
  if [ "$last_code" = "$HEALTH_EXPECT" ] || [ "$last_code" = "200" ]; then
    healthy=1
    break
  fi
  sleep "$HEALTH_INTERVAL"
done
if [ "$healthy" -ne 1 ]; then
  echo "Healthcheck fallo API: $HEALTH_URL (ultimo codigo: $last_code, esperado: $HEALTH_EXPECT)" >&2
  compose ps api || true
  curl -i --max-time 5 "$HEALTH_URL" || true
  compose logs --tail=100 api || true
  if [ -d "$OLD_DIR" ]; then rm -rf "$API_DIR"; mv "$OLD_DIR" "$API_DIR"; fi
  rollback_image || true
  compose up -d --force-recreate api || true
  exit 1
fi

STAGE="limpieza posterior al despliegue"
# Mantener solo la imagen actual (latest) y la anterior en prod (back-${RELEASE_ID}).
# Se borran contenedores parados, imagenes antiguas del proyecto, volumenes huorfanos,
# tarballs/scripts de /tmp y la build cache no usada.
if command -v docker >/dev/null 2>&1; then
  while IFS= read -r img; do
    [ -z "$img" ] && continue
    if [ "$img" != "fidelback-api:latest" ] && [ "$img" != "fidelback-api:back-${RELEASE_ID}" ]; then
      docker rmi -f "$img" >/dev/null 2>&1 || true
    fi
  done < <(docker images --format '{{.Repository}}:{{.Tag}}' | grep '^fidelback-api:' || true)

  rm -f "$TARBALL" /tmp/fidelback-mcp-deploy.sh
fi

STAGE="limpiar version anterior"
rm -rf "$OLD_DIR"
echo "API desplegada: $RELEASE_ID"
echo "Comprobacion: curl -s -o /dev/null -w '%{http_code}' $HEALTH_URL  -> $HEALTH_EXPECT"
