/**
 * Parser FIEBDC-3 (BC3) - Versión iterativa con detección de ciclos.
 * Reescrito para evitar stack overflows con archivos grandes o referencias circulares.
 */
export const parseBC3 = (text) => {
    const lines = text.split(/\r?\n/);
    const conceptos = {};   // codigo -> { Capítulo, Unidad, Descripción, precio }
    const childrenMap = {}; // codigo -> [{ cod, cantidad }]

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

            conceptos[codigo]   = { Capítulo: codigo, Unidad: unidad, Descripción: desc, precio };
            childrenMap[codigo] = childrenMap[codigo] || [];

        } else if (tag === '~D') {
            const padre = parts[1]?.trim();
            if (!padre) continue;
            let raw = (parts[2] || '').trim();
            if (raw.endsWith('\\')) raw = raw.slice(0, -1);

            childrenMap[padre] = childrenMap[padre] || [];
            const items = raw.split('\\');
            for (let i = 0; i < items.length; i += 3) {
                const hijoCod = items[i]?.trim();
                if (!hijoCod) continue;
                const factor = parseFloat((items[i + 1] || '1').replace(',', '.')) || 1;
                const rend   = parseFloat((items[i + 2] || '0').replace(',', '.')) || 0;
                childrenMap[padre].push({ cod: hijoCod, cantidad: factor * rend });
            }

        } else if (tag === '~T') {
            const codigo = parts[1]?.trim();
            const texto  = parts.slice(2).join(' ').replace(/\s{2,}/g, ' ').trim();
            if (conceptos[codigo] && texto) conceptos[codigo].Descripción = texto;
        }
    }

    // ── Fase 2: Detectar nodos raíz ───────────────────────────────────────────
    const isChild = new Set();
    for (const cod in childrenMap) {
        for (const c of childrenMap[cod]) isChild.add(c.cod);
    }
    
    let roots = Object.keys(conceptos).filter(cod => !isChild.has(cod));

    // ── Fase 2.1: Limpieza de Títulos y Partidas Sueltas ──────────────────────
    
    // 1. Si hay una única raíz con hijos, probablemente sea el título del proyecto (e.g. 25007__REFORM#)
    // Saltamos ese nivel y promovemos sus hijos para evitar ruido en la interfaz.
    if (roots.length === 1) {
        const rootCod = roots[0];
        const children = (childrenMap[rootCod] || []).filter(c => conceptos[c.cod]);
        if (children.length > 0) {
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
        conceptos[extrasCod] = { Capítulo: extrasCod, Unidad: '', Descripción: 'PARTIDAS ADICIONALES / EXTRAS', precio: 0 };
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
        // Un nodo es capítulo/subcapítulo solo si tiene hijos estructurales Y no tiene unidad propia
        const hasChildren = myChildren.length > 0 && !concepto.Unidad && !allResourceChildren;

        const numCap    = hasChildren ? (cod.endsWith('#') ? cod : cod + '#') : cod.replace(/#+$/, '');
        const precioBase = concepto.precio || 0;
        const cant       = cantidad || 1;

        let tipoNivel = 'partida';
        if (hasChildren) {
            tipoNivel = (nivel === 0) ? 'capitulo' : 'subcapitulo';
        }

        filas.push({
            Capítulo:              numCap,
            Descripción:           concepto.Descripción || '',
            Unidad:                concepto.Unidad || '',
            Cantidad:              cant,
            'Precio Total (€)':    precioBase,
            'Precio Unitario base': precioBase,
            'Oficio Asignado':     'Sin asignar',
            nivel:                 tipoNivel
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

    return filas;
};
