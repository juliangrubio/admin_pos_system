-- Bajas y Producción pasan de "uno solo en el grupo" a "uno de cada uno POR RUBRO", y siempre son de un rubro:
-- no existe un depósito general. Ninguna columna nueva: se reutiliza "Warehouse"."categoryId".

-- ─── 1. Los depósitos generales (sin rubro) dejan de existir ──────────────────
-- Si nunca se usaron (sin movimientos ni stock) se eliminan. Si alguno tuvo uso se frena la migración ANTES de
-- tocar nada: no se puede adivinar a qué rubro pertenece lo que ya pasó por ahí.
DO $$
DECLARE
  used text;
BEGIN
  SELECT string_agg(w."code", ', ' ORDER BY w."code") INTO used
  FROM "Warehouse" w
  WHERE w."businessUnitId" IS NULL AND w."categoryId" IS NULL AND w."type" IN ('PRODUCTION', 'WASTE')
    AND (
      EXISTS (SELECT 1 FROM "StockMovement" m WHERE m."fromWarehouseId" = w."id" OR m."toWarehouseId" = w."id")
      OR EXISTS (SELECT 1 FROM "StockLevel" l WHERE l."warehouseId" = w."id" AND l."quantity" > 0)
    );
  IF used IS NOT NULL THEN
    RAISE EXCEPTION 'No se puede migrar: los depósitos % (Bajas o Producción sin rubro) ya tienen movimientos o stock. Con la regla nueva cada uno tiene que pertenecer a un rubro: asignalo a mano antes de migrar.', used;
  END IF;

  DELETE FROM "StockLevel" WHERE "warehouseId" IN (
    SELECT "id" FROM "Warehouse" WHERE "businessUnitId" IS NULL AND "categoryId" IS NULL AND "type" IN ('PRODUCTION', 'WASTE')
  );
  DELETE FROM "Warehouse" WHERE "businessUnitId" IS NULL AND "categoryId" IS NULL AND "type" IN ('PRODUCTION', 'WASTE');
END $$;

-- ─── 2. Reglas nuevas ─────────────────────────────────────────────────────────

-- Un depósito de una unidad de negocio nunca se restringe por rubro. (Antes la regla también excluía a Bajas.)
ALTER TABLE "Warehouse" DROP CONSTRAINT "Warehouse_category_scope_chk";
ALTER TABLE "Warehouse" ADD CONSTRAINT "Warehouse_category_scope_chk" CHECK ("categoryId" IS NULL OR "businessUnitId" IS NULL);

-- Un depósito central de Bajas o de Producción tiene que ser de un rubro.
ALTER TABLE "Warehouse" ADD CONSTRAINT "Warehouse_rubro_required_chk" CHECK (
  "businessUnitId" IS NOT NULL OR "type" NOT IN ('PRODUCTION', 'WASTE') OR "categoryId" IS NOT NULL
);

-- Un depósito de Producción y uno de Bajas por rubro. Reemplazan a los índices únicos globales.
DROP INDEX "Warehouse_single_production";
DROP INDEX "Warehouse_single_waste";
CREATE UNIQUE INDEX "Warehouse_single_production_per_rubro" ON "Warehouse" ("categoryId") WHERE "type" = 'PRODUCTION';
CREATE UNIQUE INDEX "Warehouse_single_waste_per_rubro" ON "Warehouse" ("categoryId") WHERE "type" = 'WASTE';

-- El rubro de Bajas y de Producción es de nivel superior (Alimentos, no Alimentos › Lácteos): los subrubros
-- comparten el depósito de su rubro. Un CHECK no puede mirar otra tabla, de ahí el trigger. Se comprueba al
-- guardar el depósito; el servicio de rubros no deja que un rubro pase a ser subrubro (ni al revés).
CREATE FUNCTION "warehouse_check_rubro_level"() RETURNS trigger AS $$
DECLARE
  category_parent text;
BEGIN
  IF NEW."type" NOT IN ('PRODUCTION', 'WASTE') OR NEW."categoryId" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT "parentId" INTO category_parent FROM "InsumoCategory" WHERE "id" = NEW."categoryId" FOR SHARE;
  IF category_parent IS NOT NULL THEN
    RAISE EXCEPTION 'Los depósitos de Bajas y de Producción son por rubro, no por subrubro' USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Warehouse_rubro_level"
  BEFORE INSERT OR UPDATE OF "categoryId", "type" ON "Warehouse"
  FOR EACH ROW EXECUTE FUNCTION "warehouse_check_rubro_level"();
