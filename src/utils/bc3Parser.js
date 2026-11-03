/**
 * Resuelve un código referenciado en ~D, ~T o ~M contra el mapa de conceptos (~C),
 * tolerando diferencias en la presencia de almohadillas finales ('#' o '##').
 */
export const resolveCod = (cod, conceptos) => {
    if (!cod || !conceptos) return null;
    const trimmed = cod.trim();
    if (!trimmed) return null;
    if (conceptos[trimmed]) return trimmed;
    const base = trimmed.replace(/#+$/, '');
    if (conceptos[base]) return base;
    if (conceptos[base + '#']) return base + '#';
    if (conceptos[base + '##']) return base + '##';
    return null;
};

/**
 * Divide el contenido de un archivo BC3 en registros lógicos (~C, ~D, ~T, ~M, ~K, etc.),
 * uniendo líneas de continuación que no empiezan por '~'.
 */
export const splitBC3Records = (text) => {
    if (!text) return [];
    const physicalLines = text.split(/\r?\n/);
    const records = [];
    let current = '';

    for (const rawLine of physicalLines) {
        const line = rawLine.trimEnd();
        if (!line.trim()) continue;
        if (line.startsWith('~')) {
            if (current) records.push(current);
            current = line;
        } else if (current) {
            // En registros ~T conservamos un espacio entre líneas de texto;
            // en el resto de registros (~D, ~M, ~C) concatenamos directamente.
            const sep = current.startsWith('~T|') ? ' ' : '';
            current += sep + line.trim();
        }
    }
    if (current) records.push(current);
    return records;
};

/**
 * Parsea un número opcional de FIEBDC-3 (devuelve null si está vacío).
 */
const parseOptionalNum = (val) => {
    if (val === undefined || val === null) return null;
    const s = String(val).trim().replace(',', '.');
    if (s === '') return null;
    const n = parseFloat(s);
    return isNaN(n) ? null : n;
};

/**
 * Parsea el campo DETALLE_LINEAS (parts[4]) de un registro ~M (Mediciones).
 * Cada línea de medición en FIEBDC-3 consta de 6 subcampos separados por '\':
 *   tipo \ comentario \ unidades \ longitud \ anchura \ altura
 *
 * Devuelve un array de líneas de desglose reales. Si el registro ~M solo contiene
 * una línea trivial sin comentario ni dimensiones (solo repite el total en unidades),
 * devuelve [] para no mostrar un desglose vacío.
 */
export const parseMedicionLineas = (rawDetalle) => {
    if (!rawDetalle || typeof rawDetalle !== 'string') return [];
    let clean = rawDetalle.trim();
    if (!clean) return [];
    if (clean.endsWith('\\')) clean = clean.slice(0, -1);

    const tokens = clean.split('\\');
    const lineas = [];

    for (let i = 0; i < tokens.length; i += 6) {
        const tipo = (tokens[i] || '').trim();
        const comentario = (tokens[i + 1] || '').trim();
        const uds = parseOptionalNum(tokens[i + 2]);
        const largo = parseOptionalNum(tokens[i + 3]);
        const ancho = parseOptionalNum(tokens[i + 4]);
        const alto = parseOptionalNum(tokens[i + 5]);

        const hasDims = uds !== null || largo !== null || ancho !== null || alto !== null;
        if (!comentario && !hasDims) continue;

        let parcial = null;
        // En FIEBDC-3: tipo '1' o '2' son subtotales parcial/acumulado sin dimensiones propias
        if (hasDims && tipo !== '1' && tipo !== '2') {
            const prod = (uds ?? 1) * (largo ?? 1) * (ancho ?? 1) * (alto ?? 1);
            parcial = Math.round((prod + Number.EPSILON) * 1000) / 1000;
        }

        lineas.push({
            tipo,
            comentario,
            uds,
            largo,
            ancho,
            alto,
            parcial
        });
    }

    // Si hay una única línea sin comentario ni dimensiones (largo/ancho/alto),
    // es simplemente la cantidad total repetida y no constituye un desglose de medición.
    if (
        lineas.length === 1 &&
        !lineas[0].comentario &&
        lineas[0].largo === null &&
        lineas[0].ancho === null &&
        lineas[0].alto === null
    ) {
        return [];
    }

    return lineas;
};

/**
 * Extrae el porcentaje de coeficiente/beneficio del registro ~K de un archivo BC3.
 * Ejemplo: `~K|\2\2\3\2\2\2\2\EUR\|30|` -> devuelve 30.
 */
export const extractBC3Coeficiente = (text) => {
    if (!text) return 0;
    const records = splitBC3Records(text);
    for (const line of records) {
        if (!line.startsWith('~K|')) continue;
        const parts = line.split('|');
        const rawK = (parts[2] || '').trim();
        if (!rawK) continue;
        const firstVal = rawK.split('\\').find(v => v.trim() !== '')?.trim();
        const pct = parseFloat((firstVal || '').replace(',', '.'));
        if (!isNaN(pct) && pct > 0 && pct <= 100) {
            return pct;
        }
    }
    return 0;
};

/**
 * Combina el Resumen (~C) y el TextoLargo (~T) de una partida hoja sin perder nunca
 * el título corto de ~C.
 */
const buildPartidaDescripcion = (resumen, textoLargo) => {
    const r = (resumen || '').trim();
    const t = (textoLargo || '').trim();
    if (r && t) {
        if (t.toLowerCase().startsWith(r.toLowerCase())) {
            return t;
        }
        return `${r} — ${t}`;
    }
    return r || t || '';
};

/**
 * Parser FIEBDC-3 (BC3) - Versión iterativa con detección de ciclos.
 * Reescrito para evitar stack overflows con archivos grandes o referencias circulares.
 */
export const parseBC3 = (text) => {
    const records = splitBC3Records(text);
    const conceptos = {};      // codigo -> { Capítulo, Unidad, Resumen, Descripción, TextoLargo, precio }
    const rawChildrenMap = {}; // padreRaw -> [{ cod, cantidad }]
    const rawTextos = [];      // [{ codigo, texto }]
    const rawMediciones = [];  // [{ padreRaw, hijoRaw, total, lineas }]
    const coeficientePct = extractBC3Coeficiente(text);

    // ── Fase 1: Leer todos los registros ──────────────────────────────────────
    for (const line of records) {
        if (!line.trim()) continue;
        const parts = line.split('|');
        const tag = parts[0];

        if (tag === '~C') {
            const codigo = parts[1]?.trim();
            if (!codigo) continue;
            const unidad = (parts[2] || '').trim();
            const cleanDesc = (d) => (d || '').replace(/\|/g, ' ').replace(/\s{2,}/g, ' ').trim();
            const desc = cleanDesc(parts[3]);
            let precio   = parseFloat((parts[4] || '0').replace(',', '.'));
            if (isNaN(precio)) precio = 0;

            conceptos[codigo] = {
                Capítulo: codigo,
                Unidad: unidad,
                Resumen: desc,
                Descripción: desc,
                TextoLargo: '',
                precio
            };

        } else if (tag === '~D') {
            const padre = parts[1]?.trim();
            if (!padre) continue;
            let raw = (parts[2] || '').trim();
            if (raw.endsWith('\\')) raw = raw.slice(0, -1);

            rawChildrenMap[padre] = rawChildrenMap[padre] || [];
            const items = raw.split('\\');
            for (let i = 0; i < items.length; i += 3) {
                const hijoCod = items[i]?.trim();
                if (!hijoCod) continue;
                const factor = parseFloat((items[i + 1] || '1').replace(',', '.')) || 1;
                const rend   = parseFloat((items[i + 2] || '0').replace(',', '.')) || 0;
                rawChildrenMap[padre].push({ cod: hijoCod, cantidad: factor * rend });
            }

        } else if (tag === '~T') {
            const codigo = parts[1]?.trim();
            const texto  = parts.slice(2).join(' ').replace(/\|/g, ' ').replace(/\s{2,}/g, ' ').trim();
            if (codigo && texto) {
                rawTextos.push({ codigo, texto });
            }

        } else if (tag === '~M') {
            const rel = (parts[1] || '').trim();
            if (!rel) continue;
            let padreRaw = '';
            let hijoRaw = rel;
            if (rel.includes('\\')) {
                const relParts = rel.split('\\').filter(Boolean);
                if (relParts.length >= 2) {
                    padreRaw = relParts[0].trim();
                    hijoRaw = relParts[relParts.length - 1].trim();
                } else if (relParts.length === 1) {
                    hijoRaw = relParts[0].trim();
                }
            }
            const totalMed = parseOptionalNum(parts[3]);
            const lineas = parseMedicionLineas(parts[4] || '');
            rawMediciones.push({
                padreRaw,
                hijoRaw,
                total: totalMed,
                lineas
            });
        }
    }

    // ── Fase 1.1: Resolver referencias con tolerancia a '#' ───────────────────
    const childrenMap = {};
    for (const cod in conceptos) {
        childrenMap[cod] = [];
    }

    for (const rawPadre in rawChildrenMap) {
        const resolvedPadre = resolveCod(rawPadre, conceptos) || rawPadre;
        childrenMap[resolvedPadre] = childrenMap[resolvedPadre] || [];
        for (const item of rawChildrenMap[rawPadre]) {
            const resolvedHijo = resolveCod(item.cod, conceptos) || item.cod;
            childrenMap[resolvedPadre].push({ cod: resolvedHijo, cantidad: item.cantidad });
        }
    }

    for (const { codigo, texto } of rawTextos) {
        const resolved = resolveCod(codigo, conceptos);
        if (resolved && conceptos[resolved]) {
            conceptos[resolved].TextoLargo = texto;
        }
    }

    const medicionesMap = {};
    for (const m of rawMediciones) {
        const resolvedPadre = m.padreRaw ? (resolveCod(m.padreRaw, conceptos) || m.padreRaw) : '';
        const resolvedHijo = resolveCod(m.hijoRaw, conceptos) || m.hijoRaw;
        const entry = { total: m.total, lineas: m.lineas };
        if (resolvedPadre) {
            medicionesMap[`${resolvedPadre}\\${resolvedHijo}`] = entry;
        }
        // Fallback por código de hijo si aún no tenía o si la entrada nueva tiene desglose
        if (!medicionesMap[resolvedHijo] || (entry.lineas.length > 0 && medicionesMap[resolvedHijo].lineas.length === 0)) {
            medicionesMap[resolvedHijo] = entry;
        }
    }

    // ── Fase 2: Detectar nodos raíz ───────────────────────────────────────────
    const isChild = new Set();
    for (const cod in childrenMap) {
        for (const c of childrenMap[cod]) isChild.add(c.cod);
    }
    
    let roots = Object.keys(conceptos).filter(cod => !isChild.has(cod));

    // ── Fase 2.1: Limpieza de Títulos y Partidas Sueltas ──────────────────────
    
    // 1. Si hay una única raíz que actúa como nodo contenedor del presupuesto (termina en '##'
    // o sus hijos son capítulos estructurales), saltamos ese nivel y promovemos sus hijos.
    if (roots.length === 1) {
        const rootCod = roots[0];
        const children = (childrenMap[rootCod] || []).filter(c => conceptos[c.cod]);
        const childrenAreChapters = children.some(c => {
            const sub = (childrenMap[c.cod] || []).filter(x => conceptos[x.cod]);
            const allRes = sub.length > 0 && sub.every(x => /^(MO|MQ|MAT|AU)/i.test(x.cod));
            return sub.length > 0 && !allRes && (c.cod.endsWith('#') || !conceptos[c.cod]?.Unidad);
        });
        if (children.length > 0 && (rootCod.endsWith('##') || childrenAreChapters)) {
            roots = children.map(c => c.cod);
        }
    }

    // 2. Agrupar partidas que no cuelgan de nada (loose items) en un capítulo de EXTRAS
    // Esto evita que partidas sueltas aparezcan al mismo nivel que los capítulos principales.
    const loosePartidas = roots.filter(cod => {
        const hasChildren = (childrenMap[cod] || []).filter(c => conceptos[c.cod]).length > 0;
        return !hasChildren;
    });

    if (loosePartidas.length > 0) {
        // Agrupar partidas sueltas siempre para asegurar que el preview las contabilice bajo un capítulo
        roots = roots.filter(cod => !loosePartidas.includes(cod));
        
        const extrasCod = '99_EXTRAS';
        conceptos[extrasCod] = {
            Capítulo: extrasCod,
            Unidad: '',
            Resumen: 'PARTIDAS ADICIONALES / EXTRAS',
            Descripción: 'PARTIDAS ADICIONALES / EXTRAS',
            TextoLargo: '',
            precio: 0
        };
        childrenMap[extrasCod] = loosePartidas.map(cod => ({ cod, cantidad: 1 }));
        roots.push(extrasCod);
    }

    // ── Fase 3: DFS iterativo con detección de ciclos ─────────────────────────
    const filas  = [];
    // Cada entrada del stack: { cod, cantidad, ancestros, nivel, parentCod, parentHeaderCap }
    const stack = roots
        .slice()
        .reverse()
        .map(cod => ({ cod, cantidad: 1, ancestros: new Set(), nivel: 0, parentCod: '', parentHeaderCap: '' }));
    const LIMITE = 20000; // límite de seguridad para no colgar el navegador
    let contador = 0;

    while (stack.length > 0) {
        if (contador++ > LIMITE) {
            console.warn('[BC3] Límite de seguridad alcanzado — archivo muy grande o circular.');
            break;
        }

        const { cod, cantidad, ancestros, nivel, parentCod, parentHeaderCap } = stack.pop();

        // Ciclo detectado: este código ya es un ancestro de sí mismo
        if (ancestros.has(cod)) continue;

        const concepto = conceptos[cod];
        if (!concepto) continue;

        // Solo hijos que existen en conceptos
        const myChildren = (childrenMap[cod] || []).filter(c => conceptos[c.cod]);
        // Si todos los hijos son códigos de recurso (MO/MQ/MAT/AU) son desgloses de precio, no estructura
        const allResourceChildren = myChildren.length > 0 && myChildren.every(c => /^(MO|MQ|MAT|AU)/i.test(c.cod));
        // Un nodo es capítulo/subcapítulo si tiene hijos estructurales Y (termina en '#' en ~C o no tiene unidad propia)
        const hasChildren = myChildren.length > 0 && !allResourceChildren && (cod.endsWith('#') || !concepto.Unidad);

        const numCap = hasChildren ? (cod.endsWith('#') ? cod : cod + '#') : cod.replace(/#+$/, '');
        let precioBase = concepto.precio || 0;

        // Si es partida hoja pero tiene descompuestos en ~D (ej. 07.01 -> HAHK, HJKHSJK...),
        // usar la suma de los descompuestos cuando sea mayor que el precio estático de ~C.
        if (!hasChildren && myChildren.length > 0) {
            const sumaDescompuestos = myChildren.reduce((acc, c) => {
                const childConcepto = conceptos[c.cod];
                const childPrecio = childConcepto ? (childConcepto.precio || 0) : 0;
                return acc + childPrecio * (c.cantidad || 0);
            }, 0);
            const sumaRedondeada = Math.round((sumaDescompuestos + Number.EPSILON) * 100) / 100;
            if (sumaRedondeada > precioBase) {
                precioBase = sumaRedondeada;
            }
        }

        // Buscar medición (~M) asociada a (parentCod \ cod) o al código
        const medEntry = (!hasChildren && ((parentCod && medicionesMap[`${parentCod}\\${cod}`]) || medicionesMap[cod])) || null;
        let cant = cantidad;
        if ((!cant || cant === 0) && medEntry && medEntry.total !== null && medEntry.total > 0) {
            cant = medEntry.total;
        }
        if (!cant) cant = 1;

        let tipoNivel = 'partida';
        if (hasChildren) {
            tipoNivel = (nivel === 0) ? 'capitulo' : 'subcapitulo';
        }

        // En capítulos y subcapítulos conservar el título corto (~C Resumen);
        // en partidas hoja conservar el Resumen (~C) junto con el TextoLargo (~T).
        const descripcionFinal = hasChildren
            ? (concepto.Resumen || concepto.TextoLargo || '')
            : buildPartidaDescripcion(concepto.Resumen, concepto.TextoLargo);

        const fila = {
            Capítulo:               numCap,
            capitulo_codigo:        parentHeaderCap || '',
            Resumen:                concepto.Resumen || '',
            TextoLargo:             concepto.TextoLargo || '',
            Descripción:            descripcionFinal,
            Unidad:                 concepto.Unidad || '',
            Cantidad:               cant,
            'Precio Total (€)':     precioBase,
            'Precio Unitario base': precioBase,
            'Oficio Asignado':      'Sin asignar',
            nivel:                  tipoNivel,
            mediciones:             medEntry?.lineas || []
        };

        filas.push(fila);

        if (hasChildren) {
            const nuevosAncestros = new Set(ancestros);
            nuevosAncestros.add(cod);
            // Invertir para que salgan en el orden correcto al hacer pop()
            for (let i = myChildren.length - 1; i >= 0; i--) {
                const child = myChildren[i];
                stack.push({
                    cod: child.cod,
                    cantidad: child.cantidad,
                    ancestros: nuevosAncestros,
                    nivel: nivel + 1,
                    parentCod: cod,
                    parentHeaderCap: numCap
                });
            }
        }
    }

    Object.defineProperty(filas, 'coeficientePct', {
        value: coeficientePct,
        enumerable: false,
        writable: true,
        configurable: true
    });

    return filas;
};
