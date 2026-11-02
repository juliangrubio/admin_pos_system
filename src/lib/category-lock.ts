import type { Tx } from '@/lib/db'

// Candado de "estructura de rubros". Protege una regla que mira varias tablas a la vez: que el stock de un
// insumo esté siempre en depósitos que lo admiten, según de qué rubro cuelga su subrubro.
//
//  - COMPARTIDO: lo toma todo lo que DECIDE leyendo la jerarquía de rubros (el motor de stock al mover stock,
//    y la edición de insumos y de depósitos al comprobar conflictos). Muchos lo tienen a la vez sin molestarse.
//  - EXCLUSIVO: lo toma solo quien CAMBIA la jerarquía (mover un subrubro a otro rubro). Espera a que terminen
//    todas las operaciones en curso y frena a las nuevas hasta confirmar, así nadie decide con una jerarquía vieja.
//
// Se toma SIEMPRE PRIMERO en la transacción, antes de cualquier bloqueo de filas. Por eso no puede haber ciclos:
// quien lo espera no tiene nada más bloqueado. Orden global de bloqueos del sistema:
//   estructura de rubros → insumos → depósitos → saldos.
// Mientras se lo tiene, la jerarquía no puede cambiar: leer un rubro o su padre con un SELECT común es seguro.
//
// El candado dura hasta el fin de la transacción (xact) y es por base de datos: la clave es una constante propia.
const CATEGORY_STRUCTURE_KEY = 7_260_001

export async function lockCategoryStructureShared(tx: Tx): Promise<void> {
  await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock_shared(${CATEGORY_STRUCTURE_KEY})`)
}

export async function lockCategoryStructureExclusive(tx: Tx): Promise<void> {
  await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${CATEGORY_STRUCTURE_KEY})`)
}
