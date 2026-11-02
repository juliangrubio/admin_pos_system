# Central de Depósitos

App administradora central de un grupo de unidades de negocio (Chill, Bodegón, Quinchos, etc.): catálogo de insumos, depósitos centrales con stock, compras, remitos hacia las unidades y reportes consolidados.

Tiene su propia base de datos y **nunca accede a las bases de las unidades**: toda la comunicación es por API HTTP.

## Requisitos

- Node.js 22.9 o superior (se probó con 24)
- Docker y Docker Compose (para Postgres, y para correr todo junto)

## Arranque local

```bash
cp .env.example .env
# Generá la clave de sesión y pegala en SESSION_SECRET dentro de .env:
openssl rand -base64 48

npm install
docker compose up -d db       # Postgres en el puerto 5433
npm run db:deploy             # aplica las migraciones
npm run db:seed               # usuarios y datos de demostración
npm run dev                   # http://localhost:3100
```

Usuarios de demostración (solo desarrollo):

| Rol | Usuario | Contraseña |
|---|---|---|
| Administrador | `admin` | `admin123456` |
| Empleado | `empleado` | `empleado123456` |

Se inicia sesión con el **usuario** (`admin`), no con un email. Si definís `SEED_ADMIN_USERNAME`, `SEED_ADMIN_PASSWORD` o `SEED_EMPLOYEE_PASSWORD` en `.env`, el seed usa esos valores en lugar de los de arriba. Al crear cada usuario, el seed imprime su contraseña solo si es la de demostración.

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo en el puerto 3100 |
| `npm run check` | Typecheck + lint + tests (lo que tiene que pasar antes de dar un cambio por terminado) |
| `npm run typecheck` / `npm run lint` / `npm test` | Cada uno por separado |
| `npm run db:migrate` | Crea una migración nueva a partir de cambios en `schema.prisma` (desarrollo) |
| `npm run db:deploy` | Aplica las migraciones existentes (es lo que corre en producción) |
| `npm run db:seed` | Crea el administrador y, si corresponde, los datos de demostración (ver *Datos de demostración*) |
| `npm run worker` | Proceso en segundo plano (hoy solo verifica la conexión y late) |
| `scripts/smoke.sh [URL]` | Prueba de humo contra un servidor ya levantado |

### Tests

Los tests crean una base `<tu base>_test` en la misma instancia de Postgres, le aplican las migraciones y la vacían entre pruebas. Hay una guarda que impide que corran contra cualquier base cuyo nombre no termine en `_test`. Necesitan el Postgres levantado (`docker compose up -d db`).

Los tests de concurrencia ejecutan operaciones realmente en paralelo contra Postgres (restas simultáneas sobre el mismo saldo, transferencias cruzadas, cambios de rubro en medio de un movimiento) y comprueban que el saldo coincide con la suma de los movimientos. Los de carrera se repiten en muchas rondas porque la ventana es muy corta.

Los tests llaman a las funciones y rutas directamente, sin pasar por Next. Por eso existe `scripts/smoke.sh`, que valida lo que solo se ve en el servidor real (redirecciones, cookies, qué ve cada rol en cada pantalla y en la API). Corrélo después de cambiar el middleware o el login:

```bash
npm run build && node .next/standalone/server.js   # o npm run dev, o docker compose up
scripts/smoke.sh http://127.0.0.1:3100
```
