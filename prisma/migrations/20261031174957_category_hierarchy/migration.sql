-- AlterTable
ALTER TABLE "InsumoCategory" ADD COLUMN     "parentId" TEXT;

-- CreateIndex
CREATE INDEX "InsumoCategory_parentId_idx" ON "InsumoCategory"("parentId");

-- AddForeignKey
ALTER TABLE "InsumoCategory" ADD CONSTRAINT "InsumoCategory_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "InsumoCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── Reglas de la jerarquía que Prisma no expresa ─────────────────────────────

-- El nombre es único entre hermanos (sin distinguir mayúsculas): los rubros de nivel superior entre sí, y los
-- subrubros dentro de su rubro. Así "Otros" puede existir en "Alimentos" y en "Madera". Reemplaza al índice
-- único global de la migración stock_foundation. Los rubros existentes son todos de nivel superior, así que
-- los datos que ya cumplían el índice viejo cumplen también el nuevo.
DROP INDEX "InsumoCategory_name_lower_key";
CREATE UNIQUE INDEX "InsumoCategory_siblings_name_lower_key" ON "InsumoCategory" (COALESCE("parentId", ''), lower("name"));

-- Máximo dos niveles (rubro y subrubro). Un CHECK no alcanza porque tiene que mirar otras filas.
CREATE FUNCTION "insumo_category_check_depth"() RETURNS trigger AS $$
DECLARE
  parent_parent text;
BEGIN
  IF NEW."parentId" IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW."parentId" = NEW."id" THEN
    RAISE EXCEPTION 'Un rubro no puede ser subrubro de sí mismo' USING ERRCODE = 'check_violation';
  END IF;

  -- El padre tiene que ser un rubro de nivel superior. Se lo bloquea en modo compartido para que no
  -- cambie de nivel mientras se confirma esta fila.
  SELECT "parentId" INTO parent_parent FROM "InsumoCategory" WHERE "id" = NEW."parentId" FOR SHARE;
  IF parent_parent IS NOT NULL THEN
    RAISE EXCEPTION 'Los rubros admiten solo dos niveles: rubro y subrubro' USING ERRCODE = 'check_violation';
  END IF;

  -- Un rubro que ya tiene subrubros no puede pasar a ser subrubro.
  IF EXISTS (SELECT 1 FROM "InsumoCategory" WHERE "parentId" = NEW."id") THEN
    RAISE EXCEPTION 'Un rubro con subrubros no puede ser subrubro de otro rubro' USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "InsumoCategory_depth"
  BEFORE INSERT OR UPDATE OF "parentId" ON "InsumoCategory"
  FOR EACH ROW EXECUTE FUNCTION "insumo_category_check_depth"();
