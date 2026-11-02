#!/usr/bin/env bash
# Prueba de humo contra un servidor ya levantado (npm run dev, o la app en Docker) con el seed de demostración.
# Cubre lo que los tests unitarios no ven porque no pasan por Next: redirecciones, cookies y render por rol.
#
#   Uso: scripts/smoke.sh [URL_BASE]      (por defecto http://127.0.0.1:3100)
#   Credenciales: SMOKE_ADMIN_PASSWORD y SMOKE_EMPLOYEE_PASSWORD si no son las del seed de demostración.
set -u

BASE="${1:-http://127.0.0.1:3100}"
ADMIN_EMAIL="${SMOKE_ADMIN_EMAIL:-admin@deposito.local}"
ADMIN_PASSWORD="${SMOKE_ADMIN_PASSWORD:-Admin-demo-2026}"
EMPLOYEE_EMAIL="${SMOKE_EMPLOYEE_EMAIL:-empleado@deposito.local}"
EMPLOYEE_PASSWORD="${SMOKE_EMPLOYEE_PASSWORD:-Empleado-demo-2026}"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

failures=0
check() { # descripción, esperado, obtenido
  if [ "$2" = "$3" ]; then
    echo "  ok   $1"
  else
    echo "  FALLA $1"
    echo "         esperado: $2"
    echo "         obtenido: $3"
    failures=$((failures + 1))
  fi
}

status() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
header() { # nombre, curl args...  → valor del primer header con ese nombre
  local name="$1"; shift
  curl -s -D - -o /dev/null "$@" | grep -i "^${name}:" | head -1 | cut -d' ' -f2- | tr -d '\r'
}
sections() { grep -o '<h2[^>]*>[^<]*' | sed 's/<h2[^>]*>//' | paste -sd'|'; }
login_json() { printf '{"username":"%s","password":"%s"}' "$1" "$2"; }

echo "Prueba de humo contra $BASE"

echo "Sin sesión"
check "health responde 200" "200" "$(status "$BASE/api/health")"
check "una página protegida redirige (307)" "307" "$(status "$BASE/dashboard")"
location="$(header location "$BASE/dashboard")"
check "la redirección es una URL absoluta (Next rechaza las relativas)" "yes" \
  "$(echo "$location" | grep -qE '^https?://' && echo yes || echo no)"
check "vuelve al login recordando a dónde iba" "/login?redirect=%2Fdashboard" \
  "$(echo "$location" | sed -E 's#^https?://[^/]+##')"
check "detrás de un proxy usa el host y protocolo del usuario" \
  "https://deposito.miempresa.com/login?redirect=%2Fdashboard" \
  "$(header location -H 'X-Forwarded-Host: deposito.miempresa.com' -H 'X-Forwarded-Proto: https' "$BASE/dashboard")"
check "la API responde 401" "401" "$(status "$BASE/api/auth/me")"
check "el login es público" "200" "$(status "$BASE/login")"

echo "Login"
check "clave incorrecta: 401" "401" \
  "$(status -H 'content-type: application/json' -d "$(login_json "$ADMIN_EMAIL" 'clave-equivocada')" "$BASE/api/auth/login")"
check "desde otro origen: 403" "403" \
  "$(status -H 'content-type: application/json' -H 'origin: https://sitio-malicioso.example' \
    -d "$(login_json "$ADMIN_EMAIL" "$ADMIN_PASSWORD")" "$BASE/api/auth/login")"
curl -s -c "$WORK/admin.jar" -D "$WORK/login.headers" -o /dev/null -H 'content-type: application/json' \
  -d "$(login_json "$ADMIN_EMAIL" "$ADMIN_PASSWORD")" "$BASE/api/auth/login"
check "credenciales correctas: 200" "HTTP/1.1 200 OK" "$(head -1 "$WORK/login.headers" | tr -d '\r')"
cookie_line="$(grep -i '^set-cookie: hub_session=' "$WORK/login.headers" | tr -d '\r')"
check "la cookie es HttpOnly" "yes" "$(echo "$cookie_line" | grep -qi 'HttpOnly' && echo yes || echo no)"
check "la cookie es SameSite=Lax" "yes" "$(echo "$cookie_line" | grep -qi 'SameSite=lax' && echo yes || echo no)"

echo "Dashboard por rol"
curl -s -b "$WORK/admin.jar" "$BASE/dashboard" > "$WORK/admin.html"
check "ADMIN ve las 5 secciones en orden" "Compras|Stock|Remitos|Unidades de negocio|Gestión" "$(sections < "$WORK/admin.html")"
curl -s -c "$WORK/employee.jar" -o /dev/null -H 'content-type: application/json' \
  -d "$(login_json "$EMPLOYEE_EMAIL" "$EMPLOYEE_PASSWORD")" "$BASE/api/auth/login"
curl -s -b "$WORK/employee.jar" "$BASE/dashboard" > "$WORK/employee.html"
check "EMPLEADO ve solo Compras, Stock y Remitos" "Compras|Stock|Remitos" "$(sections < "$WORK/employee.html")"
check "EMPLEADO no ve la gestión de usuarios" "no" "$(grep -q 'Gestionar usuarios' "$WORK/employee.html" && echo yes || echo no)"

echo "Pantallas y permisos (fase 1)"
for page in /admin/stock/supplies /admin/stock/levels /admin/stock/movements /admin/stock/adjustments /admin/warehouses /admin/units /admin/users /admin/audit; do
  check "ADMIN abre $page" "200" "$(status -b "$WORK/admin.jar" "$BASE$page")"
done
check "sin sesión, una pantalla de gestión redirige al login" "307" "$(status "$BASE/admin/users")"
for page in /admin/stock/supplies /admin/stock/levels /admin/stock/movements /admin/stock/adjustments; do
  check "EMPLEADO abre $page" "no" "$(curl -s -b "$WORK/employee.jar" "$BASE$page" | grep -q 'Acceso Denegado' && echo yes || echo no)"
done
for page in /admin/warehouses /admin/units /admin/users /admin/audit; do
  check "EMPLEADO ve 'Acceso Denegado' en $page" "yes" "$(curl -s -b "$WORK/employee.jar" "$BASE$page" | grep -q 'Acceso Denegado' && echo yes || echo no)"
done
check "EMPLEADO puede listar insumos por la API" "200" "$(status -b "$WORK/employee.jar" "$BASE/api/insumos")"
check "EMPLEADO no puede crear insumos (403)" "403" \
  "$(status -b "$WORK/employee.jar" -X POST -H 'content-type: application/json' -d '{"name":"Intruso","unit":"KG"}' "$BASE/api/insumos")"
check "EMPLEADO no puede ver usuarios ni auditoría (403)" "403 403" \
  "$(status -b "$WORK/employee.jar" "$BASE/api/users") $(status -b "$WORK/employee.jar" "$BASE/api/audit")"
check "sin sesión, la API de stock responde 401" "401" "$(status "$BASE/api/stock/levels")"
check "los usuarios no exponen contraseñas" "no" \
  "$(curl -s -b "$WORK/admin.jar" "$BASE/api/users" | grep -qE 'passwordHash|\$2[aby]\$' && echo yes || echo no)"

echo "Sesión"
check "con sesión, /api/auth/me responde 200" "200" "$(status -b "$WORK/admin.jar" "$BASE/api/auth/me")"
check "con sesión, /login vuelve al dashboard" "/dashboard" \
  "$(header location -b "$WORK/admin.jar" "$BASE/login" | sed -E 's#^https?://[^/]+##')"
real_token="$(grep hub_session "$WORK/admin.jar" | awk '{print $7}')"
forged_token="${real_token%.*}.firma-falsa"
check "una cookie manipulada es rechazada (307)" "307" "$(status -H "cookie: hub_session=$forged_token" "$BASE/dashboard")"
check "una cookie manipulada no abre la API (401)" "401" "$(status -H "cookie: hub_session=$forged_token" "$BASE/api/auth/me")"
legacy_token="$(printf 'cualquiera:%s' "$(date +%s)000" | base64 | tr -d '=\n')"
check "el viejo token sin firma (base64) no sirve (307)" "307" "$(status -H "cookie: hub_session=$legacy_token" "$BASE/dashboard")"
check "cerrar sesión: 200" "200" "$(status -b "$WORK/admin.jar" -X POST "$BASE/api/auth/logout")"
check "cerrar sesión borra la cookie" "yes" \
  "$(curl -s -D - -o /dev/null -b "$WORK/admin.jar" -X POST "$BASE/api/auth/logout" | grep -i '^set-cookie: hub_session=;' | grep -qi 'Max-Age=0' && echo yes || echo no)"

echo
if [ "$failures" -eq 0 ]; then
  echo "Todo en orden."
else
  echo "$failures comprobación(es) fallaron."
  exit 1
fi
