import {
  PrismaClient,
  Prisma,
  type MeasureUnit,
  type UserRole,
  type WarehouseType,
} from '@prisma/client';
import { createInsumo } from '../src/lib/catalog/insumos';
import { hashPassword } from '../src/lib/password';
import { adjustStock } from '../src/lib/stock/operations';
import { isValidUsername } from '../src/lib/validation';
import { prisma as appPrisma } from '../src/lib/prisma';

// Es idempotente: se puede correr varias veces. No pisa contraseñas ni datos de lo que ya existe.
//
// Siempre crea (también en producción): el administrador. Los depósitos de Bajas y de Producción son uno por rubro,
// así que no hay uno que el sistema necesite de entrada: en producción se crean desde Depósitos una vez cargados
// los rubros (hasta entonces, una baja avisa que ese rubro todavía no tiene el suyo).
// Datos de demostración (un empleado, unidades, rubros, depósitos, insumos y stock): en desarrollo por defecto;
// en producción (NODE_ENV=production) solo con SEED_DEMO=true. En producción las contraseñas son
// obligatorias (SEED_ADMIN_PASSWORD, y SEED_EMPLOYEE_PASSWORD con SEED_DEMO), de al menos 12 caracteres.

const prisma = new PrismaClient();

const isProduction = process.env.NODE_ENV === 'production';
const withDemo = process.env.SEED_DEMO ? process.env.SEED_DEMO === 'true' : !isProduction;

const DEMO_ADMIN_PASSWORD = 'admin123456';
const DEMO_EMPLOYEE_PASSWORD = 'empleado123456';

function resolvePassword(envValue: string | undefined, demoDefault: string, label: string) {
  if (envValue) {
    if (isProduction && envValue.length < 12) {
      throw new Error(`${label} debe tener al menos 12 caracteres en producción`);
    }
    return { password: envValue, isDemoDefault: false };
  }
  if (isProduction) throw new Error(`Definí ${label} para correr el seed en producción`);
  return { password: demoDefault, isDemoDefault: true };
}

async function ensureUser(
  username: string,
  name: string,
  role: UserRole,
  password: string,
  announce?: string,
) {
  if (!isValidUsername(username)) {
    throw new Error(
      `"${username}" no es un usuario válido: tiene que ser un email o un nombre de usuario de 3 a 30 caracteres`,
    );
  }
  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    console.log(`= Usuario ya existente: ${username}`);
    return existing;
  }
  const user = await prisma.user.create({
    data: { username, name, role, passwordHash: await hashPassword(password) },
  });
  console.log(`+ Usuario creado: ${username} (${role})${announce ? ` — ${announce}` : ''}`);
  return user;
}

async function ensureUnit(code: string, name: string) {
  const existing = await prisma.businessUnit.findUnique({ where: { code } });
  if (existing) {
    console.log(`= Unidad de negocio ya existente: ${code}`);
    return existing;
  }
  const unit = await prisma.businessUnit.create({ data: { code, name } });
  console.log(`+ Unidad de negocio creada: ${code} (${name})`);
  return unit;
}

// Un rubro (sin padre) o un subrubro (con el id de su rubro). El nombre es único entre hermanos.
async function ensureCategory(name: string, parentId: string | null = null) {
  return (
    (await prisma.insumoCategory.findFirst({
      where: { name: { equals: name, mode: 'insensitive' }, parentId },
    })) ?? prisma.insumoCategory.create({ data: { name, parentId } })
  );
}

async function ensureWarehouse(data: {
  code: string;
  name: string;
  type: WarehouseType;
  businessUnitId?: string;
  categoryId?: string;
}) {
  const existing = await prisma.warehouse.findUnique({ where: { code: data.code } });
  if (existing) {
    console.log(`= Depósito ya existente: ${data.code}`);
    return existing;
  }
  const warehouse = await prisma.warehouse.create({ data });
  console.log(`+ Depósito creado: ${data.code} (${data.name})`);
  return warehouse;
}

const money = (pesos: number) => Math.round(pesos * 100);

async function seedDemoCatalog(adminId: string) {
  // Dos rubros de actividades muy distintas, cada uno con su propia clasificación.
  const alimentos = await ensureCategory('Alimentos');
  const madera = await ensureCategory('Madera');
  const [secos, lacteos, carnes, verduras, bebidas] = await Promise.all(
    ['Secos', 'Lácteos', 'Carnes', 'Verduras', 'Bebidas'].map((name) =>
      ensureCategory(name, alimentos.id),
    ),
  );
  const [tableros, macizas, herrajes] = await Promise.all(
    ['Tableros', 'Maderas macizas', 'Herrajes'].map((name) => ensureCategory(name, madera.id)),
  );
  // El mismo nombre en dos rubros distintos convive sin problema.
  await ensureCategory('Otros', alimentos.id);
  await ensureCategory('Otros', madera.id);

  const chill = await ensureUnit('CHILL', 'Chill');
  const clon = await ensureUnit('CHILL_CLON', 'Chill (clon)');

  // Bajas y Producción: uno de cada tipo por rubro.
  await ensureWarehouse({
    code: 'PROD-ALIM',
    name: 'Producción de Alimentos',
    type: 'PRODUCTION',
    categoryId: alimentos.id,
  });
  await ensureWarehouse({
    code: 'BAJAS-ALIM',
    name: 'Bajas de Alimentos',
    type: 'WASTE',
    categoryId: alimentos.id,
  });
  await ensureWarehouse({
    code: 'PROD-MADERA',
    name: 'Producción de Madera',
    type: 'PRODUCTION',
    categoryId: madera.id,
  });
  await ensureWarehouse({
    code: 'BAJAS-MADERA',
    name: 'Bajas de Madera',
    type: 'WASTE',
    categoryId: madera.id,
  });
  // Las tres formas de restricción: a un subrubro (solo ese), a un rubro entero (todos sus subrubros) y sin restricción.
  const dry = await ensureWarehouse({
    code: 'ALM-SECOS',
    name: 'Almacén de secos',
    type: 'STORAGE',
    categoryId: secos.id,
  });
  const cold = await ensureWarehouse({ code: 'ALM-FRIO', name: 'Cámara de frío', type: 'STORAGE' });
  const wood = await ensureWarehouse({
    code: 'DEP-MADERA',
    name: 'Depósito de madera',
    type: 'STORAGE',
    categoryId: madera.id,
  });
  await ensureWarehouse({
    code: 'CHILL-SUC1',
    name: 'Chill - Sucursal 1',
    type: 'BRANCH',
    businessUnitId: chill.id,
  });
  await ensureWarehouse({
    code: 'CLON-SUC1',
    name: 'Chill clon - Sucursal 1',
    type: 'BRANCH',
    businessUnitId: clon.id,
  });

  // [nombre, unidad, rubro o subrubro, mínimo, costo en pesos por unidad, depósito inicial, cantidad inicial]
  const catalog: Array<
    [string, MeasureUnit, { id: string }, number, number, { id: string; name: string }, number]
  > = [
    ['Harina 000', 'KG', secos, 50, 850, dry, 180],
    ['Azúcar', 'KG', secos, 30, 920, dry, 75],
    ['Aceite de girasol', 'LITER', secos, 20, 2100, dry, 35],
    ['Pan de hamburguesa', 'UNIT', secos, 100, 310, dry, 400],
    ['Leche entera', 'LITER', lacteos, 40, 1150, cold, 90],
    ['Queso mozzarella', 'KG', lacteos, 15, 7800, cold, 10], // por debajo del mínimo, a propósito
    ['Carne picada', 'KG', carnes, 25, 9200, cold, 60],
    ['Tomate', 'KG', verduras, 10, 1800, cold, 22],
    ['Gaseosa cola 500 ml', 'UNIT', bebidas, 48, 950, cold, 120],
    ['Tablero MDF 18 mm', 'UNIT', tableros, 20, 32000, wood, 60],
    ['Listón de pino 2x2', 'UNIT', macizas, 40, 4500, wood, 150],
    ['Bisagra cazoleta', 'UNIT', herrajes, 200, 350, wood, 500],
    ['Cola vinílica', 'LITER', madera, 10, 3800, wood, 25], // asignado al rubro Madera, sin subrubro
  ];

  for (const [name, unit, category, minStock, cost, warehouse, quantity] of catalog) {
    const existing = await prisma.insumo.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
    });
    if (existing) {
      console.log(`= Insumo ya existente: ${name}`);
      continue;
    }
    const insumo = await createInsumo(
      {
        name,
        unit,
        categoryId: category.id,
        minStock: new Prisma.Decimal(minStock),
        avgCostCents: money(cost),
        isActive: true,
      },
      { id: adminId },
    );
    // El stock inicial se carga como un ajuste, igual que lo haría un usuario: queda en el libro de movimientos.
    await adjustStock({
      warehouseId: warehouse.id,
      insumoId: insumo.id,
      mode: 'INCREASE',
      quantity: new Prisma.Decimal(quantity),
      reason: 'INITIAL_LOAD',
      note: 'Stock de demostración',
      userId: adminId,
    });
    console.log(`+ Insumo creado: ${insumo.code} ${name} (${quantity} en ${warehouse.name})`);
  }
}

async function main() {
  // SEED_ADMIN_EMAIL es el nombre anterior de esta variable: se sigue aceptando.
  const adminUsername = (process.env.SEED_ADMIN_USERNAME || process.env.SEED_ADMIN_EMAIL || 'admin')
    .trim()
    .toLowerCase();
  const admin = resolvePassword(
    process.env.SEED_ADMIN_PASSWORD,
    DEMO_ADMIN_PASSWORD,
    'SEED_ADMIN_PASSWORD',
  );
  const adminUser = await ensureUser(
    adminUsername,
    'Admin Seed',
    'ADMIN',
    admin.password,
    admin.isDemoDefault ? `contraseña de demostración: ${admin.password}` : undefined,
  );

  if (!withDemo) return;

  const employee = resolvePassword(
    process.env.SEED_EMPLOYEE_PASSWORD,
    DEMO_EMPLOYEE_PASSWORD,
    'SEED_EMPLOYEE_PASSWORD',
  );
  await ensureUser(
    'empleado',
    'Empleado Seed',
    'EMPLOYEE',
    employee.password,
    employee.isDemoDefault ? `contraseña de demostración: ${employee.password}` : undefined,
  );

  await seedDemoCatalog(adminUser.id);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await appPrisma.$disconnect();
  });
