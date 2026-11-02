/**
 * Resuelve un código referenciado en ~D o ~T contra el mapa de conceptos (~C),
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
 * Extrae el porcentaje de coeficiente/beneficio del registro ~K de un archivo BC3.
 * Ejemplo: `~K|\2\2\3\2\2\2\2\EUR\|30|` -> devuelve 30.
 */
export const extractBC3Coeficiente = (text) => {
    if (!text) return 0;
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
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
 * Parser FIEBDC-3 (BC3) - Versión iterativa con detección de ciclos.
 * Reescrito para evitar stack overflows con archivos grandes o referencias circulares.
 */
export const parseBC3 = (text) => {
    const lines = (text || '').split(/\r?\n/);
    const conceptos = {};      // codigo -> { Capítulo, Unidad, Resumen, Descripción, TextoLargo, precio }
    const rawChildrenMap = {}; // padreRaw -> [{ cod, cantidad }]
    const rawTextos = [];      // [{ codigo, texto }]
    const coeficientePct = extractBC3Coeficiente(text);

    // ── Fase 1: Leer todos los registros ──────────────────────────────────────
    for (const line of lines) {
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
            const texto  = parts.slice(2).join(' ').replace(/\s{2,}/g, ' ').trim();
            if (codigo && texto) {
                rawTextos.push({ codigo, texto });
            }
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
    // Cada entrada del stack: { cod, cantidad, ancestros (Set de códigos padre), nivel }
    const stack = roots
        .slice()
        .reverse()
        .map(cod => ({ cod, cantidad: 1, ancestros: new Set(), nivel: 0 }));
    const LIMITE = 20000; // límite de seguridad para no colgar el navegador
    let contador = 0;

    while (stack.length > 0) {
        if (contador++ > LIMITE) {
            console.warn('[BC3] Límite de seguridad alcanzado — archivo muy grande o circular.');
            break;
        }

        const { cod, cantidad, ancestros, nivel } = stack.pop();

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

        const cant = cantidad || 1;

        let tipoNivel = 'partida';
        if (hasChildren) {
            tipoNivel = (nivel === 0) ? 'capitulo' : 'subcapitulo';
        }

        // Preservar el título corto (~C Resumen) en capítulos y subcapítulos;
        // en partidas hoja priorizar el texto largo (~T) si existe.
        const descripcionFinal = hasChildren
            ? (concepto.Resumen || concepto.TextoLargo || '')
            : (concepto.TextoLargo || concepto.Resumen || '');

        filas.push({
            Capítulo:               numCap,
            Descripción:            descripcionFinal,
            Unidad:                 concepto.Unidad || '',
            Cantidad:               cant,
            'Precio Total (€)':     precioBase,
            'Precio Unitario base': precioBase,
            'Oficio Asignado':      'Sin asignar',
            nivel:                  tipoNivel
        });

        if (hasChildren) {
            const nuevosAncestros = new Set(ancestros);
            nuevosAncestros.add(cod);
            // Invertir para que salgan en el orden correcto al hacer pop()
            for (let i = myChildren.length - 1; i >= 0; i--) {
                const child = myChildren[i];
                stack.push({ cod: child.cod, cantidad: child.cantidad, ancestros: nuevosAncestros, nivel: nivel + 1 });
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
