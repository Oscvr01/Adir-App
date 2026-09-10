/**
 * Formato numérico es-ES compartido. Antes estaba duplicado idéntico en
 * Borradores, JefesObra, BasePrecios, Comparativa y Portal.
 */

// Número con 2 decimales fijos (1234.5 → "1.234,50"). Sin símbolo de moneda.
export const formatDecimal = (val) =>
  (parseFloat(val) || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Parsea un string es-ES ("1.234,50") de vuelta a número.
export const parseDecimal = (str) =>
  parseFloat((str || '0').replace(/\./g, '').replace(',', '.')) || 0;

// Importe en euros con 2 decimales ("1.234,50 €").
export const fmtEuro = (n) => formatDecimal(n) + ' €';

// Aplica un % de beneficio a un coste: coste × (1 + pct/100).
// pct nulo/NaN → devuelve el coste sin tocar.
export const aplicarBeneficio = (coste, pct) => {
  const c = parseFloat(coste) || 0;
  const p = parseFloat(pct) || 0;
  return c * (1 + p / 100);
};
