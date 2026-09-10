/**
 * Lógica compartida de normalización y ordenado de partidas.
 * Usado por Borradores.jsx y JefesObra.jsx para evitar duplicación.
 */

export function formatCapitulo(cap) {
  if (!cap) return '';
  const s = cap.toString().trim();
  if (s.includes('T') && s.includes('-')) {
    const date = new Date(s);
    if (!isNaN(date)) {
      const month = date.getMonth() + 1;
      const day = String(date.getDate()).padStart(2, '0');
      return `${month}.${day}`;
    }
  }
  return s;
}

// Detecta filas que el parser BC3 marca como título raíz del proyecto entero
// (códigos con __ o nombres alfanuméricos largos terminados en #).
export function esTituloRaiz(cap) {
  const base = (cap || '').replace(/#$/, '');
  if (!cap || !cap.endsWith('#')) return false;
  if (/^\d+(\.\d+)*$/.test(base)) return false;
  if (/^[A-Z0-9]+$/.test(base) && base.length <= 4) return false;
  return base.includes('__') || (/[A-Za-z]/.test(base) && base.length > 6);
}

// Clasifica fila como capítulo / subcapítulo / partida según marca '#' del parser
export function getTipoFila(p) {
  const cap = (p.Capítulo || '').trim();
  if (!cap.endsWith('#')) return 'partida';
  const codLimpio = cap.replace(/#$/, '');
  if (codLimpio === '99_EXTRAS') return 'capitulo';
  if (codLimpio.includes('.')) return 'subcapitulo';
  return 'capitulo';
}

/**
 * Suma el total de un presupuesto: precio × cantidad SOLO de las filas que son
 * partidas hoja (excluye capítulos/subcapítulos y el header sintético de EXTRAS).
 * Fuente de verdad única compartida por el preview de NuevoProyecto y Borradores
 * para que el total mostrado sea idéntico en ambos sitios.
 */
export function calcularTotalPartidas(items) {
  return (items || []).reduce((acc, p) => {
    if (getTipoFila(p) !== 'partida') return acc;
    return acc + (parseFloat(p['Precio Total (€)'] || 0) * parseFloat(p.Cantidad || 1));
  }, 0);
}

// Comparador numérico para ordenar capítulos (01, 01.01, 01.02, 02, …)
export function sortPartidasFn(a, b) {
  const capA = formatCapitulo(a.Capítulo);
  const capB = formatCapitulo(b.Capítulo);
  const isRootA = capA.endsWith('##');
  const isRootB = capB.endsWith('##');
  if (isRootA && !isRootB) return -1;
  if (!isRootA && isRootB) return 1;
  const partsA = capA.split('.').map(x => parseInt(x.replace(/\D/g, '')) || 0);
  const partsB = capB.split('.').map(x => parseInt(x.replace(/\D/g, '')) || 0);
  const hasNumA = /\d/.test(capA);
  const hasNumB = /\d/.test(capB);
  if (!hasNumA && hasNumB) return 1;
  if (hasNumA && !hasNumB) return -1;
  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const valA = i < partsA.length ? partsA[i] : -1;
    const valB = i < partsB.length ? partsB[i] : -1;
    if (valA !== valB) return valA - valB;
  }
  if (capA.endsWith('#') && !capB.endsWith('#')) return -1;
  if (!capA.endsWith('#') && capB.endsWith('#')) return 1;
  return 0;
}

const EXTRAS_HEADER_BASE = {
  id: '__extras_header__',
  Capítulo: '99_EXTRAS#',
  Descripción: 'PARTIDAS ADICIONALES / EXTRAS',
  'Oficio Asignado': 'Sin asignar',
  'Precio Total (€)': 0,
  Cantidad: 0,
  'Precio IA': 0,
  'Unidad IA': '',
  _synthetic: true,
};

/**
 * Normaliza un array de partidas crudas (ya mapeadas con Capítulo / Descripción):
 *   1. Elimina la fila de título raíz del proyecto.
 *   2. Detecta partidas sueltas sin capítulo padre y las agrupa bajo "99_EXTRAS".
 *   3. Ordena por código de capítulo.
 *
 * `extraFields` permite añadir campos al header de EXTRAS (ej. aprobado:false).
 */
export function normalizarYOrdenarPartidas(mappedPartidas, extraFields = {}) {
  const filtered = mappedPartidas.filter(p => !esTituloRaiz(p.Capítulo));

  const capitulosValidos = new Set(
    filtered
      .filter(p => (p.Capítulo || '').endsWith('#'))
      .map(p => p.Capítulo.replace(/#$/, ''))
  );

  const esPartidaSuelta = (p) => {
    const cap = (p.Capítulo || '').trim();
    if (cap.endsWith('#')) return false;
    const segmentos = cap.split('.');
    if (capitulosValidos.has(segmentos[0])) return false;
    return true;
  };

  const sueltas = filtered.filter(esPartidaSuelta);
  const normales = filtered.filter(p => !esPartidaSuelta(p));
  const normalesSorted = [...normales].sort(sortPartidasFn);

  if (sueltas.length === 0) return normalesSorted;

  const extrasHeader = { ...EXTRAS_HEADER_BASE, ...extraFields };
  return [...normalesSorted, extrasHeader, ...sueltas];
}
