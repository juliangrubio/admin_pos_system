-- CreateEnum
CREATE TYPE "MeasureUnit" AS ENUM ('KG', 'LITER', 'UNIT');

-- CreateEnum
CREATE TYPE "WarehouseType" AS ENUM ('PRODUCTION', 'STORAGE', 'BRANCH', 'WASTE');

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('PURCHASE_IN', 'REMITO_OUT', 'REMITO_CANCEL_IN', 'ADJUSTMENT', 'WASTE_OUT', 'TRANSFER');

-- CreateTable
CREATE TABLE "InsumoCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InsumoCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Insumo" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" "MeasureUnit" NOT NULL,
    "categoryId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "minStock" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "avgCostCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Insumo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Warehouse" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "WarehouseType" NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "businessUnitId" TEXT,
    "categoryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Warehouse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockLevel" (
    "id" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "insumoId" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockLevel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "insumoId" TEXT NOT NULL,
    "fromWarehouseId" TEXT,
    "toWarehouseId" TEXT,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unitCostCents" INTEGER,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "reason" TEXT,
    "note" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Insumo_code_key" ON "Insumo"("code");

-- CreateIndex
CREATE INDEX "Insumo_categoryId_idx" ON "Insumo"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "Warehouse_code_key" ON "Warehouse"("code");

-- CreateIndex
CREATE INDEX "Warehouse_businessUnitId_idx" ON "Warehouse"("businessUnitId");

-- CreateIndex
CREATE INDEX "StockLevel_insumoId_idx" ON "StockLevel"("insumoId");

-- CreateIndex
CREATE UNIQUE INDEX "StockLevel_warehouseId_insumoId_key" ON "StockLevel"("warehouseId", "insumoId");

-- CreateIndex
CREATE INDEX "StockMovement_insumoId_createdAt_idx" ON "StockMovement"("insumoId", "createdAt");

-- CreateIndex
CREATE INDEX "StockMovement_fromWarehouseId_createdAt_idx" ON "StockMovement"("fromWarehouseId", "createdAt");

-- CreateIndex
CREATE INDEX "StockMovement_toWarehouseId_createdAt_idx" ON "StockMovement"("toWarehouseId", "createdAt");

-- CreateIndex
CREATE INDEX "StockMovement_createdAt_idx" ON "StockMovement"("createdAt");

-- CreateIndex
CREATE INDEX "StockMovement_referenceType_referenceId_idx" ON "StockMovement"("referenceType", "referenceId");

-- AddForeignKey
ALTER TABLE "Insumo" ADD CONSTRAINT "Insumo_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "InsumoCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Warehouse" ADD CONSTRAINT "Warehouse_businessUnitId_fkey" FOREIGN KEY ("businessUnitId") REFERENCES "BusinessUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Warehouse" ADD CONSTRAINT "Warehouse_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "InsumoCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLevel" ADD CONSTRAINT "StockLevel_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLevel" ADD CONSTRAINT "StockLevel_insumoId_fkey" FOREIGN KEY ("insumoId") REFERENCES "Insumo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_insumoId_fkey" FOREIGN KEY ("insumoId") REFERENCES "Insumo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_fromWarehouseId_fkey" FOREIGN KEY ("fromWarehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_toWarehouseId_fkey" FOREIGN KEY ("toWarehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── Reglas de integridad que Prisma no expresa ───────────────────────────────

-- Nombres únicos sin distinguir mayúsculas.
CREATE UNIQUE INDEX "InsumoCategory_name_lower_key" ON "InsumoCategory" (lower("name"));
CREATE UNIQUE INDEX "Insumo_name_lower_key" ON "Insumo" (lower("name"));

-- Código automático de insumos (INS-000123). Puede tener saltos: no importa.
CREATE SEQUENCE "insumo_code_seq" START 1;

-- Códigos estables y con formato controlado (son la clave compartida con las unidades).
ALTER TABLE "Insumo" ADD CONSTRAINT "Insumo_code_format_chk" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9_-]{1,29}$');
ALTER TABLE "Warehouse" ADD CONSTRAINT "Warehouse_code_format_chk" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9_-]{1,29}$');
ALTER TABLE "BusinessUnit" ADD CONSTRAINT "BusinessUnit_code_format_chk" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9_]{1,29}$');

ALTER TABLE "Insumo" ADD CONSTRAINT "Insumo_minStock_chk" CHECK ("minStock" >= 0);
ALTER TABLE "Insumo" ADD CONSTRAINT "Insumo_avgCostCents_chk" CHECK ("avgCostCents" >= 0);

-- Depósito central (sin unidad): producción, almacén o bajas. Depósito de una unidad: almacén o sucursal.
ALTER TABLE "Warehouse" ADD CONSTRAINT "Warehouse_scope_type_chk" CHECK (
  ("businessUnitId" IS NULL AND "type" IN ('PRODUCTION', 'STORAGE', 'WASTE'))
  OR ("businessUnitId" IS NOT NULL AND "type" IN ('STORAGE', 'BRANCH'))
);

-- La restricción por rubro solo tiene sentido en depósitos centrales que no son Bajas.
ALTER TABLE "Warehouse" ADD CONSTRAINT "Warehouse_category_scope_chk" CHECK (
  "categoryId" IS NULL OR ("businessUnitId" IS NULL AND "type" <> 'WASTE')
);

-- Un solo depósito de producción y uno solo de bajas en todo el grupo.
CREATE UNIQUE INDEX "Warehouse_single_production" ON "Warehouse" ("type") WHERE "type" = 'PRODUCTION';
CREATE UNIQUE INDEX "Warehouse_single_waste" ON "Warehouse" ("type") WHERE "type" = 'WASTE';

-- El saldo nunca puede ser negativo (red de seguridad: el servicio ya lo valida antes de escribir).
ALTER TABLE "StockLevel" ADD CONSTRAINT "StockLevel_quantity_chk" CHECK ("quantity" >= 0);

-- Solo los depósitos centrales tienen saldos acá.
CREATE FUNCTION "stock_level_central_only"() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Warehouse" WHERE "id" = NEW."warehouseId" AND "businessUnitId" IS NOT NULL) THEN
    RAISE EXCEPTION 'Un depósito de una unidad de negocio no puede tener saldos en esta base'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "StockLevel_central_only"
  BEFORE INSERT ON "StockLevel"
  FOR EACH ROW EXECUTE FUNCTION "stock_level_central_only"();

-- Libro de movimientos.
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_quantity_chk" CHECK ("quantity" > 0);
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_origin_destination_chk"
  CHECK ("fromWarehouseId" IS DISTINCT FROM "toWarehouseId");
-- Cada tipo de movimiento tiene su forma: qué lado queda fuera de los depósitos centrales.
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_type_direction_chk" CHECK (
  ("type" IN ('PURCHASE_IN', 'REMITO_CANCEL_IN') AND "fromWarehouseId" IS NULL AND "toWarehouseId" IS NOT NULL)
  OR ("type" = 'REMITO_OUT' AND "fromWarehouseId" IS NOT NULL AND "toWarehouseId" IS NULL)
  OR ("type" IN ('TRANSFER', 'WASTE_OUT') AND "fromWarehouseId" IS NOT NULL AND "toWarehouseId" IS NOT NULL)
  OR ("type" = 'ADJUSTMENT' AND ("fromWarehouseId" IS NULL) <> ("toWarehouseId" IS NULL))
);
-- Ajustes y bajas siempre llevan motivo.
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_reason_chk" CHECK (
  "type" NOT IN ('ADJUSTMENT', 'WASTE_OUT') OR length(btrim(coalesce("reason", ''))) > 0
);

-- Solo se agrega: nadie modifica ni borra movimientos (TRUNCATE queda para los tests).
CREATE FUNCTION "block_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% es de solo escritura (% no permitido)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "StockMovement_immutable"
  BEFORE UPDATE OR DELETE ON "StockMovement"
  FOR EACH ROW EXECUTE FUNCTION "block_mutation"();
