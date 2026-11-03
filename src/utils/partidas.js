/**
 * Lógica compartida de normalización, mapeo, edición, jerarquía y ordenado de partidas.
 * Usado por Borradores.jsx, JefesObra.jsx, NuevoProyecto.jsx y PartidasTable.jsx.
 */
import { cleanText } from './escape';

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
  // Corrige códigos donde falta el segundo punto (ej. "01.0211" → "01.02.11")
  const sinHash = s.replace(/#+$/, '');
  const matchSinPunto = sinHash.match(/^(\d+\.\d{2})(\d{2,})$/);
  if (matchSinPunto) {
    const sufijo = s.endsWith('#') ? '#' : '';
    return `${matchSinPunto[1]}.${matchSinPunto[2]}${sufijo}`;
  }
  return s;
}

// Detecta filas que el parser BC3 marca como título raíz del proyecto entero
// (códigos con __ o nombres alfanuméricos largos terminados en #).
export function esTituloRaiz(cap) {
  const base = (cap || '').replace(/#+$/, '');
  if (!cap || !cap.endsWith('#')) return false;
  if (/^\d+(\.\d+)*$/.test(base)) return false;
  if (/^[A-Z0-9]+$/.test(base) && base.length <= 4) return false;
  return base.includes('__') || (/[A-Za-z]/.test(base) && base.length > 6);
}

// Clasifica fila como capítulo / subcapítulo / partida según marca '#' del parser
export function getTipoFila(p) {
  const cap = (p?.Capítulo || p?.Capitulo || '').trim();
  if (!cap.endsWith('#')) return 'partida';
  const codLimpio = cap.replace(/#+$/, '');
  if (codLimpio === '99_EXTRAS') return 'capitulo';
  if (codLimpio.includes('.')) return 'subcapitulo';
  return 'capitulo';
}

/**
 * Determina si el código o fila `itemOrCode` pertenece jerárquicamente al capítulo o
 * subcapítulo `headerCodeRaw`.
 * - Respeta `capitulo_codigo` explícito (del árbol ~D del BC3, ej. "03.03.03" bajo "03.02#").
 * - Soporta códigos con punto ("01.02.01" bajo "01.02") y códigos con segundo punto
 *   omitido en Presto ("01.0211" bajo "01.02").
 */
export function perteneceACapitulo(itemOrCode, headerCodeRaw, itemParentCodeRaw) {
  const isObj = itemOrCode && typeof itemOrCode === 'object';
  const itemCodeRaw = isObj ? (itemOrCode.Capítulo || itemOrCode.Capitulo || '') : itemOrCode;
  const parentRaw = isObj
    ? (itemOrCode.capitulo_codigo || itemOrCode.capitulo_padre || itemParentCodeRaw || '')
    : (itemParentCodeRaw || '');

  const hCode = (headerCodeRaw || '').replace(/#+$/, '').trim();
  const iCode = (itemCodeRaw || '').replace(/#+$/, '').trim();
  const pCode = (parentRaw || '').replace(/#+$/, '').trim();
  if (!hCode || !iCode || iCode === hCode) return false;

  // 1. Si tiene capitulo_codigo explícito (del árbol ~D del BC3):
  if (pCode) {
    if (pCode === hCode) return true;
    if (pCode.startsWith(hCode + '.')) return true;
  }

  // Si tiene un subcapítulo padre explícito distinto dentro del mismo capítulo,
  // no asociarlo por error a otro subcapítulo:
  if (pCode && hCode.includes('.') && pCode !== hCode && !pCode.startsWith(hCode + '.')) {
    return false;
  }

  // 2. Comprobación por prefijo del código:
  if (iCode.startsWith(hCode + '.')) return true;
  if (
    hCode.includes('.') &&
    iCode.startsWith(hCode) &&
    /^\d+$/.test(iCode.slice(hCode.length))
  ) {
    return true;
  }
  return false;
}

/**
 * Infiere `capitulo_codigo` para partidas cargadas de proyectos antiguos en BD donde
 * `capitulo_codigo` aún era null pero la partida fue emitida secuencialmente bajo un
 * subcapítulo cuyo prefijo no coincide (ej. `03.03.03` bajo `03.02#` cuando `03.03#` no existe).
 */
export function inferirCapituloPadre(partidas) {
  const lista = partidas || [];
  const subcapsExistentes = new Set();
  for (const p of lista) {
    if (getTipoFila(p) === 'subcapitulo') {
      subcapsExistentes.add((p.Capítulo || p.Capitulo || '').replace(/#+$/, '').trim());
    }
  }
  if (subcapsExistentes.size === 0) return lista;

  let currentCap = '';
  let currentSubcap = '';
  return lista.map((p) => {
    const tipo = getTipoFila(p);
    const raw = (p.Capítulo || p.Capitulo || '').replace(/#+$/, '').trim();
    if (tipo === 'capitulo') {
      currentCap = raw;
      currentSubcap = '';
      return p;
    }
    if (tipo === 'subcapitulo') {
      currentSubcap = raw;
      if (!currentCap) currentCap = raw.split('.')[0] || '';
      return p;
    }
    if (p.capitulo_codigo || p.capitulo_padre) return p;

    const normalized = formatCapitulo(raw).replace(/#+$/, '');
    const parts = normalized.split('.');
    // Criterio conservador: solo se infiere para códigos con 3 o más segmentos (NN.NN.NN),
    // que son "nietos" huérfanos. Un código de 2 segmentos (NN.NN) es hijo directo del
    // capítulo y nunca se reasigna al subcapítulo anterior.
    if (parts.length >= 3 && currentSubcap) {
      const rootPart = parts[0];
      const subcapRoot = currentSubcap.split('.')[0];
      const ownSubcapCandidate = `${parts[0]}.${parts[1]}`;
      if (
        rootPart === subcapRoot &&
        ownSubcapCandidate !== currentSubcap &&
        !subcapsExistentes.has(ownSubcapCandidate)
      ) {
        return { ...p, capitulo_codigo: currentSubcap + '#' };
      }
    }
    return p;
  });
}

/**
 * Suma el total de un presupuesto: precio × cantidad SOLO de las filas que son
 * partidas hoja (excluye capítulos/subcapítulos y el header sintético de EXTRAS).
 */
export function calcularTotalPartidas(items) {
  return (items || []).reduce((acc, p) => {
    if (getTipoFila(p) !== 'partida') return acc;
    return acc + (parseFloat(p['Precio Total (€)'] || 0) * parseFloat(p.Cantidad || 1));
  }, 0);
}

const defaultGetPrice = (item) => parseFloat(item['Precio Total (€)']) || 0;

/**
 * Calcula el total acumulado de cada capítulo y subcapítulo sumando todas
 * sus partidas hoja descendientes. Devuelve un mapa `{ [header.Capítulo]: total }`.
 * Permite especificar un selector de precio unitario personalizado (`getPriceFn`).
 */
export function calcularTotalesCapitulos(todasPartidas, getPriceFn = defaultGetPrice) {
  const lista = inferirCapituloPadre(todasPartidas || []);
  const totales = {};
  const headers = lista.filter((p) => getTipoFila(p) !== 'partida');
  const items = lista.filter((p) => getTipoFila(p) === 'partida');
  const indexMap = new Map(lista.map((p, idx) => [p, idx]));

  for (const header of headers) {
    const hKey = header.Capítulo || header.Capitulo || '';
    const hCode = hKey.replace(/#+$/, '').trim();
    const isExtras = hCode === '99_EXTRAS';
    const hIdx = isExtras ? indexMap.get(header) : -1;

    totales[hKey] = items.reduce((acc, item) => {
      const match = isExtras
        ? indexMap.get(item) > hIdx
        : perteneceACapitulo(item, hKey);
      if (!match) return acc;
      const precio = parseFloat(getPriceFn(item)) || 0;
      const cant = parseFloat(item.Cantidad ?? item.cantidad ?? 1) || 1;
      return acc + precio * cant;
    }, 0);
  }
  return totales;
}

/**
 * Devuelve para una fila su `capRoot` (código de capítulo principal, ej. "01" o "99_EXTRAS")
 * y su `subcapParent` (código de subcapítulo padre si es una partida dentro de un subcapítulo, ej. "01.02").
 */
export function obtenerJerarquiaFila(p, subcapitulosValidos, enExtras = false) {
  const raw = (p?.Capítulo || '').replace(/#+$/, '').trim();
  const tipo = getTipoFila(p);
  if (tipo === 'capitulo') {
    return { capRoot: raw, subcapParent: null };
  }
  const parentRaw = (p?.capitulo_codigo || p?.capitulo_padre || '').replace(/#+$/, '').trim();
  if (tipo === 'subcapitulo') {
    const capRoot = parentRaw ? (parentRaw.split('.')[0] || parentRaw) : (raw.split('.')[0] || raw);
    return { capRoot, subcapParent: raw };
  }
  if (enExtras) {
    return { capRoot: '99_EXTRAS', subcapParent: null };
  }
  if (parentRaw) {
    const parentParts = parentRaw.split('.');
    const capRoot = parentParts[0] || parentRaw;
    const subcapParent =
      parentParts.length >= 2 && (!subcapitulosValidos || subcapitulosValidos.has(parentRaw))
        ? parentRaw
        : null;
    return { capRoot, subcapParent };
  }
  const normalized = formatCapitulo(raw).replace(/#+$/, '');
  const parts = normalized.split('.');
  const capRoot = parts[0] || raw;
  let subcapParent = null;
  if (parts.length >= 2) {
    const candidate = `${parts[0]}.${parts[1]}`;
    if (subcapitulosValidos && subcapitulosValidos.has(candidate)) {
      subcapParent = candidate;
    }
  }
  return { capRoot, subcapParent };
}

// Obtiene la clave efectiva de ordenación jerárquica respetando capitulo_codigo si existe
function getSortKey(p) {
  const cap = formatCapitulo(p?.Capítulo || '');
  const parent = (p?.capitulo_codigo || p?.capitulo_padre || '').replace(/#+$/, '').trim();
  if (!parent || cap.endsWith('#')) return cap;
  const capClean = cap.replace(/#+$/, '').trim();
  if (capClean.startsWith(parent + '.')) return cap;
  return `${parent}.${capClean}`;
}

// Comparador numérico para ordenar capítulos (01, 01.01, 01.02, 02, …)
export function sortPartidasFn(a, b) {
  const capA = getSortKey(a);
  const capB = getSortKey(b);
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
 *   1. Elimina la fila de título raíz del proyecto y cabeceras `99_EXTRAS#` previas vacías.
 *   2. Detecta subcapítulos terminados en '#' que NO tienen partidas hijas:
 *      - Si tienen precio > 0 o unidad definida (ej. 03.01# con m2 y 746,13€), los convierte
 *        en partidas hoja reales quitando el '#' final para que sumen en su capítulo y sean editables.
 *      - Si están vacíos y sin precio, los descarta para evitar filas fantasma.
 *   3. Detecta partidas sueltas sin capítulo padre y las agrupa bajo "99_EXTRAS".
 *   4. Ordena por código de capítulo (respetando capitulo_codigo cuando existe).
 */
export function normalizarYOrdenarPartidas(mappedPartidas, extraFields = {}) {
  const sinRaizNiExtrasVacio = inferirCapituloPadre(
    (mappedPartidas || []).filter((p) => {
      const cap = (p.Capítulo || '').trim();
      if (esTituloRaiz(cap)) return false;
      if (cap.replace(/#+$/, '') === '99_EXTRAS') return false;
      return true;
    })
  );

  // Paso 2: Verificar qué filas con '#' tienen realmente descendientes en el proyecto
  const normalizadas = [];
  for (const p of sinRaizNiExtrasVacio) {
    const cap = (p.Capítulo || '').trim();
    if (cap.endsWith('#')) {
      const codLimpio = cap.replace(/#+$/, '');
      const tieneHijos = sinRaizNiExtrasVacio.some(
        (other) => other !== p && perteneceACapitulo(other, cap)
      );

      if (!tieneHijos) {
        const precio =
          parseFloat(p['Precio Total (€)']) ||
          parseFloat(p.precio_adjudicado) ||
          parseFloat(p.precio_base_estimado) ||
          0;
        const unidad = (p['Unidad IA'] || p.unidad || p.Unidad || '').trim();

        // Si un supuesto subcapítulo/capítulo no tiene hijos pero tiene unidad o precio propio,
        // en realidad es una partida hoja exportada con '#' desde Presto.
        if (codLimpio.includes('.') && (precio > 0 || unidad !== '')) {
          const textoPartidaLimpio =
            typeof p.texto_partida === 'string' && p.texto_partida.includes('::')
              ? `${codLimpio}::${p.texto_partida.split('::').slice(1).join('::')}`
              : typeof p.texto_partida === 'string'
                ? p.texto_partida.replace(/#+$/, '')
                : p.texto_partida;
          normalizadas.push({
            ...p,
            Capítulo: codLimpio,
            ...(textoPartidaLimpio !== undefined ? { texto_partida: textoPartidaLimpio } : {}),
            ...(typeof p.codigo === 'string' ? { codigo: p.codigo.replace(/#+$/, '') } : {}),
          });
        }
        // Si no tiene hijos ni precio/unidad (cabecera vacía), se omite para no dejar filas vacías
        continue;
      }
    }
    normalizadas.push(p);
  }

  // Asegurar que si hay subcapítulos huérfanos cuyo capítulo raíz no existe explícitamente,
  // sus prefijos raíz se consideren capítulos válidos para no mandarlos a 99_EXTRAS
  const capitulosValidos = new Set();
  normalizadas.forEach((p) => {
    const cap = (p.Capítulo || '').trim();
    if (cap.endsWith('#')) {
      const limpio = cap.replace(/#+$/, '');
      capitulosValidos.add(limpio);
      const raiz = limpio.split('.')[0];
      if (raiz) capitulosValidos.add(raiz);
    }
  });

  const esPartidaSuelta = (p) => {
    const cap = (p.Capítulo || '').trim();
    if (cap.endsWith('#')) return false;
    const parentClean = (p.capitulo_codigo || p.capitulo_padre || '').replace(/#+$/, '').trim();
    if (parentClean) {
      const parentRoot = parentClean.split('.')[0];
      if (capitulosValidos.has(parentClean) || capitulosValidos.has(parentRoot)) return false;
    }
    const segmentos = formatCapitulo(cap).split('.');
    if (capitulosValidos.has(segmentos[0])) return false;
    return true;
  };

  const sueltas = normalizadas.filter(esPartidaSuelta);
  const normales = normalizadas.filter((p) => !esPartidaSuelta(p));
  const normalesSorted = [...normales].sort(sortPartidasFn);

  if (sueltas.length === 0) return normalesSorted;

  const extrasHeader = { ...EXTRAS_HEADER_BASE, ...extraFields };
  return [...normalesSorted, extrasHeader, ...sueltas];
}

/**
 * Recibe un array de filas de BD de un mismo proyecto y devuelve únicamente las
 * partidas hoja reales (excluyendo capítulos/subcapítulos con hijos, título raíz y
 * cabeceras vacías, pero conservando los subcapítulos '#' sin hijos que tienen
 * precio o unidad propia, como 03.01#).
 */
export function filtrarPartidasHojaBD(partidasProyecto) {
  const conCapitulo = (partidasProyecto || []).map((p) => ({
    ...p,
    Capítulo:
      p.Capítulo !== undefined
        ? p.Capítulo
        : p.codigo || (p.texto_partida ? p.texto_partida.split('::')[0] : '') || '',
  }));
  return normalizarYOrdenarPartidas(conCapitulo).filter(
    (p) => !p._synthetic && getTipoFila(p) === 'partida'
  );
}

/**
 * Extrae el array de mediciones de una partida (ya sea en memoria `p.mediciones`
 * o serializado en JSON dentro de la columna `descripcion` de BD).
 */
export function parseMedicionesGuardadas(p) {
  if (!p) return [];
  if (Array.isArray(p.mediciones)) return p.mediciones;
  if (typeof p.descripcion === 'string' && p.descripcion.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(p.descripcion);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Ignorar si descripcion no es un JSON válido
    }
  }
  return [];
}

/**
 * Mapea filas de la tabla `partidas` de BD al formato común de UI usado en
 * Borradores y Jefes de Obra. Permite inyectar campos específicos por vista
 * mediante `extraFieldsFn(row, finalPrice)`.
 */
export function mapearPartidasDesdeBD(partidasData, extraFieldsFn) {
  return (partidasData || []).map((p) => {
    const capCode = p.texto_partida ? p.texto_partida.split('::')[0] : '';
    const descClean = cleanText(p.texto_partida);
    const finalPrice =
      p.precio_adjudicado && parseFloat(p.precio_adjudicado) > 0
        ? parseFloat(p.precio_adjudicado)
        : p.precio_base_estimado || 0;

    const baseRow = {
      ...p,
      Capítulo: capCode,
      capitulo_codigo: p.capitulo_codigo || p.capitulo_padre || '',
      Descripción: descClean,
      'Oficio Asignado': p.oficio_asignado || 'Sin asignar',
      'Precio Total (€)': finalPrice,
      Cantidad: p.cantidad !== undefined && p.cantidad !== null ? p.cantidad : 0,
      'Precio IA': p.precio_ia || 0,
      'Unidad IA': p.unidad || '',
      mediciones: parseMedicionesGuardadas(p),
    };

    return typeof extraFieldsFn === 'function'
      ? { ...baseRow, ...extraFieldsFn(p, finalPrice) }
      : baseRow;
  });
}

/**
 * Devuelve una copia inmutable del array `partidas` actualizando `campo` en la
 * fila `idx` y marcándola como `isModified: true`.
 */
export function actualizarCampoPartida(partidas, idx, campo, valor, extraProps = {}) {
  const copy = [...partidas];
  const valNormalizado = campo === 'Precio Total (€)' ? (parseFloat(valor) || 0) : valor;
  copy[idx] = {
    ...copy[idx],
    [campo]: valNormalizado,
    isModified: true,
    ...extraProps,
  };
  return copy;
}
