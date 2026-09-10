const mockPartidas = [
  { Capítulo: '01#', Descripción: 'Demoliciones y acondicionamiento previo', Cantidad: 0, 'Precio Total (€)': 0 },
  { Capítulo: '01.01#', Descripción: 'Medios auxiliares y gestion de residuos', Cantidad: 0, 'Precio Total (€)': 0 },
  { Capítulo: '01.01.01', Descripción: 'Medios auxiliares, protecciones y limpieza final', Cantidad: 1, 'Precio Total (€)': 150.5 },
  { Capítulo: '01.01.02', Descripción: 'Contenedor de escombros 6 m3', Cantidad: 4, 'Precio Total (€)': 85.0 }
];

const getTipoFila = (p) => {
    const cap = (p.Capítulo || '').trim();
    if (!cap.endsWith('#')) return 'partida';
    const codLimpio = cap.replace(/#$/, '');
    if (codLimpio === '99_EXTRAS') return 'capitulo';
    if (codLimpio.includes('.')) return 'subcapitulo';
    return 'capitulo';
};

const getDescendantPartidas = (parentIdx, allPartidas) => {
    const parent = allPartidas[parentIdx];
    if (!parent) return [];
    const tipo = getTipoFila(parent);
    if (tipo === 'partida') return [];

    const parentClean = (parent.Capítulo || '').replace(/#+$/, '');
    const isExtras = parentClean === '99_EXTRAS';

    return allPartidas.filter((c, idx) => {
        if (getTipoFila(c) !== 'partida') return false;
        if (isExtras) {
            return idx > parentIdx;
        }
        const childCap = (c.Capítulo || '').trim();
        return childCap === parentClean || childCap.startsWith(parentClean + '.');
    });
};

const calcularTotalCapitulo = (parentIdx) => {
    const childs = getDescendantPartidas(parentIdx, mockPartidas);
    return childs.reduce((acc, c) => {
        const pUnit = parseFloat(c['Precio Total (€)'] || 0);
        const cant  = parseFloat(c.Cantidad) || 1;
        return acc + (pUnit * cant);
    }, 0);
};

const partidasParaCliente = mockPartidas.map((p, idx) => {
    const tipoFila = getTipoFila(p);
    if (tipoFila === 'capitulo' || tipoFila === 'subcapitulo') {
        const totalCap = calcularTotalCapitulo(idx);
        return {
            ...p,
            precio_total_capitulo: totalCap
        };
    }
    return p;
});

console.log("Calculated partidasParaCliente:", partidasParaCliente);
