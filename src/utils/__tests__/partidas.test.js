import { describe, it, expect } from 'vitest';
import {
  formatCapitulo,
  esTituloRaiz,
  getTipoFila,
  perteneceACapitulo,
  calcularTotalPartidas,
  calcularTotalesCapitulos,
  obtenerJerarquiaFila,
  sortPartidasFn,
  normalizarYOrdenarPartidas,
  filtrarPartidasHojaBD,
  mapearPartidasDesdeBD,
  actualizarCampoPartida,
} from '../partidas';
import { aplicarBeneficio, formatDecimal, parseDecimal, fmtEuro } from '../format';

describe('formatCapitulo', () => {
  it('mantiene códigos estándar de capítulos, subcapítulos y partidas', () => {
    expect(formatCapitulo('01#')).toBe('01#');
    expect(formatCapitulo('01.02#')).toBe('01.02#');
    expect(formatCapitulo('01.02.03')).toBe('01.02.03');
  });

  it('inserta el segundo punto en códigos Presto tipo 01.0211 (caso CARTAGENA CIEGO)', () => {
    expect(formatCapitulo('01.0211')).toBe('01.02.11');
    expect(formatCapitulo('01.0211#')).toBe('01.02.11#');
    expect(formatCapitulo('04.0105')).toBe('04.01.05');
  });

  it('convierte fechas ISO generadas por Excel de vuelta a código numérico mes.día', () => {
    expect(formatCapitulo('2026-01-02T00:00:00.000Z')).toBe('1.02');
  });

  it('devuelve cadena vacía ante valores nulos o indefinidos', () => {
    expect(formatCapitulo(null)).toBe('');
    expect(formatCapitulo(undefined)).toBe('');
    expect(formatCapitulo('')).toBe('');
  });
});

describe('esTituloRaiz', () => {
  it('detecta títulos raíz de proyecto terminados en # con doble guion bajo o texto largo', () => {
    expect(esTituloRaiz('PROYECTO__01#')).toBe(true);
    expect(esTituloRaiz('DUPLEXANDREA_REVISION_1#')).toBe(true);
    expect(esTituloRaiz('CARTAGENA CIEGO#')).toBe(true);
  });

  it('no confunde capítulos numéricos ni códigos cortos con el título raíz', () => {
    expect(esTituloRaiz('01#')).toBe(false);
    expect(esTituloRaiz('01.02#')).toBe(false);
    expect(esTituloRaiz('A01#')).toBe(false);
    expect(esTituloRaiz('01.01')).toBe(false);
  });
});

describe('getTipoFila', () => {
  it('clasifica códigos sin punto terminados en # y 99_EXTRAS# como capitulo', () => {
    expect(getTipoFila({ Capítulo: '01#' })).toBe('capitulo');
    expect(getTipoFila({ Capítulo: '99_EXTRAS#' })).toBe('capitulo');
  });

  it('clasifica códigos con punto terminados en # como subcapitulo', () => {
    expect(getTipoFila({ Capítulo: '01.01#' })).toBe('subcapitulo');
    expect(getTipoFila({ Capítulo: '03.02#' })).toBe('subcapitulo');
  });

  it('clasifica códigos que no terminan en # como partida hoja', () => {
    expect(getTipoFila({ Capítulo: '01.01' })).toBe('partida');
    expect(getTipoFila({ Capítulo: '01.02.01' })).toBe('partida');
    expect(getTipoFila({ Capítulo: '01.0211' })).toBe('partida');
  });
});

describe('perteneceACapitulo', () => {
  it('reconoce partidas hijas directas e indirectas con separación por puntos', () => {
    expect(perteneceACapitulo('01.01', '01#')).toBe(true);
    expect(perteneceACapitulo('01.02.01', '01.02#')).toBe(true);
    expect(perteneceACapitulo('01.02.01', '01#')).toBe(true);
  });

  it('reconoce partidas con segundo punto omitido (01.0211) como hijas de 01.02# y de 01#', () => {
    expect(perteneceACapitulo('01.0211', '01.02#')).toBe(true);
    expect(perteneceACapitulo('01.0211', '01#')).toBe(true);
  });

  it('rechaza capítulos distintos, colisiones de prefijo (01 vs 010) y el propio header', () => {
    expect(perteneceACapitulo('01.03.01', '01.02#')).toBe(false);
    expect(perteneceACapitulo('010.01', '01#')).toBe(false);
    expect(perteneceACapitulo('01.02#', '01.02#')).toBe(false);
    expect(perteneceACapitulo('01#', '01#')).toBe(false);
  });
});

describe('calcularTotalPartidas y aplicarBeneficio', () => {
  it('suma únicamente las filas que son partidas hoja e ignora cabeceras con #', () => {
    const filas = [
      { Capítulo: '01#', 'Precio Total (€)': 9999, Cantidad: 1 },
      { Capítulo: '01.01#', 'Precio Total (€)': 5000, Cantidad: 1 },
      { Capítulo: '01.01.01', 'Precio Total (€)': 100, Cantidad: 2.5 }, // 250
      { Capítulo: '01.01.02', 'Precio Total (€)': 50, Cantidad: 3 },    // 150
    ];

    const costeTotal = calcularTotalPartidas(filas);
    expect(costeTotal).toBe(400);
    expect(aplicarBeneficio(costeTotal, 25)).toBe(500);
  });

  it('formatea y parsea importes en formato español correctamente', () => {
    expect(formatDecimal(1234.5)).toBe('1234,50');
    expect(formatDecimal(12345.6)).toBe('12.345,60');
    expect(fmtEuro(12345.6)).toBe('12.345,60 €');
    expect(parseDecimal('1.234,50')).toBe(1234.5);
    expect(parseDecimal('12.345,60')).toBe(12345.6);
    expect(aplicarBeneficio(1000, 0)).toBe(1000);
    expect(aplicarBeneficio(1000, null)).toBe(1000);
  });
});

describe('calcularTotalesCapitulos', () => {
  it('acumula costes en subcapítulos y capítulos padre incluyendo códigos 01.0211 y 99_EXTRAS#', () => {
    const partidas = [
      { Capítulo: '01#', Descripción: 'Actuaciones previas' },
      { Capítulo: '01.01#', Descripción: 'Andamios' },
      { Capítulo: '01.01.01', 'Precio Total (€)': 200, Cantidad: 2 }, // 400
      { Capítulo: '01.02#', Descripción: 'Demoliciones' },
      { Capítulo: '01.02.01', 'Precio Total (€)': 100, Cantidad: 1 }, // 100
      { Capítulo: '01.0211', 'Precio Total (€)': 50, Cantidad: 4 },   // 200 (sin segundo punto)
      { Capítulo: '99_EXTRAS#', Descripción: 'PARTIDAS ADICIONALES / EXTRAS' },
      { Capítulo: 'EXTRA_1', 'Precio Total (€)': 75, Cantidad: 2 },   // 150
    ];

    const totales = calcularTotalesCapitulos(partidas);

    expect(totales['01.01#']).toBe(400);
    expect(totales['01.02#']).toBe(300); // 100 + 200 (de 01.0211)
    expect(totales['01#']).toBe(700);    // 400 + 300
    expect(totales['99_EXTRAS#']).toBe(150);
  });

  it('permite usar un selector de precio personalizado getPriceFn (ej. precio_adjudicado para PDF/Cliente N-02)', () => {
    const partidasCliente = [
      { Capítulo: '01#', Descripción: 'Capítulo 1' },
      { Capítulo: '01.01', precio_adjudicado: 125, cantidad: 2 }, // 250
      { Capítulo: '01.02', precio_adjudicado: 300, cantidad: 1 }, // 300
    ];

    const totales = calcularTotalesCapitulos(
      partidasCliente,
      (item) => item.precio_adjudicado
    );

    expect(totales['01#']).toBe(550);
  });
});

describe('obtenerJerarquiaFila', () => {
  const subcapsValidos = new Set(['01.01', '01.02']);

  it('asigna capRoot y subcapParent correctamente para capítulos, subcapítulos y partidas nietas', () => {
    expect(obtenerJerarquiaFila({ Capítulo: '01#' }, subcapsValidos)).toEqual({
      capRoot: '01',
      subcapParent: null,
    });
    expect(obtenerJerarquiaFila({ Capítulo: '01.02#' }, subcapsValidos)).toEqual({
      capRoot: '01',
      subcapParent: '01.02',
    });
    expect(obtenerJerarquiaFila({ Capítulo: '01.02.01' }, subcapsValidos)).toEqual({
      capRoot: '01',
      subcapParent: '01.02',
    });
    expect(obtenerJerarquiaFila({ Capítulo: '01.0211' }, subcapsValidos)).toEqual({
      capRoot: '01',
      subcapParent: '01.02',
    });
  });

  it('no asigna subcapParent a partidas hijas directas de capítulo (ej. 03.01 en capítulo 03 sin subcapítulos)', () => {
    expect(obtenerJerarquiaFila({ Capítulo: '03.01' }, subcapsValidos)).toEqual({
      capRoot: '03',
      subcapParent: null,
    });
  });

  it('asigna capRoot 99_EXTRAS a las partidas situadas tras la cabecera de extras', () => {
    expect(obtenerJerarquiaFila({ Capítulo: 'SIN_CAP' }, subcapsValidos, true)).toEqual({
      capRoot: '99_EXTRAS',
      subcapParent: null,
    });
  });
});

describe('normalizarYOrdenarPartidas', () => {
  it('convierte subcapítulos # sin hijos pero con precio o unidad (caso 03.01# y 03.02# en duplexandrea) en partidas hoja', () => {
    const raw = [
      { Capítulo: 'DUPLEXANDREA_REVISION_1#', Descripción: 'PROYECTO RAÍZ' },
      { Capítulo: '03#', Descripción: 'PARTICIONES', 'Precio Total (€)': 0, Cantidad: 1 },
      {
        Capítulo: '03.01#',
        Descripción: 'Entramados autoportantes',
        'Unidad IA': 'm2',
        'Precio Total (€)': 2204.48,
        Cantidad: 1,
      },
      {
        Capítulo: '03.02#',
        Descripción: 'Falsos techos',
        'Unidad IA': 'm2',
        'Precio Total (€)': 5056.01,
        Cantidad: 1,
      },
      { Capítulo: '99_EXTRAS#', Descripción: 'PARTIDAS ADICIONALES / EXTRAS', 'Precio Total (€)': 0 },
    ];

    const norm = normalizarYOrdenarPartidas(raw);

    // Elimina título raíz y 99_EXTRAS# vacío; mantiene 03# y convierte 03.01 y 03.02 en partidas hoja
    expect(norm.map((p) => p.Capítulo)).toEqual(['03#', '03.01', '03.02']);
    expect(getTipoFila(norm[1])).toBe('partida');
    expect(getTipoFila(norm[2])).toBe('partida');

    // Ahora el total del capítulo 03# y del presupuesto suma ambas partidas
    const totales = calcularTotalesCapitulos(norm);
    expect(totales['03#']).toBeCloseTo(7260.49, 2);
    expect(calcularTotalPartidas(norm)).toBeCloseTo(7260.49, 2);
  });

  it('mantiene subcapítulos # con precio 0 cuando sí tienen partidas hijas (incluyendo códigos tipo 01.0211)', () => {
    const raw = [
      { Capítulo: '01#', Descripción: 'Actuaciones previas', 'Precio Total (€)': 0 },
      { Capítulo: '01.02#', Descripción: 'Demoliciones', 'Precio Total (€)': 0 },
      { Capítulo: '01.0211', Descripción: 'Desmontaje falso techo', 'Precio Total (€)': 120, Cantidad: 1 },
      { Capítulo: '01.02.01', Descripción: 'Levantado carpintería', 'Precio Total (€)': 200, Cantidad: 1 },
    ];

    const norm = normalizarYOrdenarPartidas(raw);

    // 01.02# se conserva como subcapítulo y 01.02.01 va antes que 01.0211 (01.02.11)
    expect(norm.map((p) => p.Capítulo)).toEqual(['01#', '01.02#', '01.02.01', '01.0211']);
    expect(getTipoFila(norm[1])).toBe('subcapitulo');
  });

  it('agrupa partidas huérfanas bajo una cabecera sintética 99_EXTRAS# al final', () => {
    const raw = [
      { Capítulo: '01#', Descripción: 'Capítulo 1' },
      { Capítulo: '01.01', Descripción: 'Partida normal', 'Precio Total (€)': 100, Cantidad: 1 },
      { Capítulo: '99.01', Descripción: 'Partida extra sin capítulo 99#', 'Precio Total (€)': 50, Cantidad: 2 },
    ];

    const norm = normalizarYOrdenarPartidas(raw, { aprobado: false });

    expect(norm.map((p) => p.Capítulo)).toEqual(['01#', '01.01', '99_EXTRAS#', '99.01']);
    expect(norm[2]._synthetic).toBe(true);
    expect(norm[2].aprobado).toBe(false);
  });

  it('limpia también el # de texto_partida y codigo al convertir un subcapítulo hoja en partida (N-01)', () => {
    const raw = [
      { Capítulo: '03#', texto_partida: '03#::PARTICIONES', 'Precio Total (€)': 0 },
      {
        Capítulo: '03.01#',
        texto_partida: '03.01#::Entramados autoportantes',
        codigo: '03.01#',
        'Unidad IA': 'm2',
        'Precio Total (€)': 2204.48,
        Cantidad: 1,
      },
    ];

    const norm = normalizarYOrdenarPartidas(raw);

    expect(norm[0].texto_partida).toBe('03#::PARTICIONES');
    expect(norm[1].Capítulo).toBe('03.01');
    expect(norm[1].texto_partida).toBe('03.01::Entramados autoportantes');
    expect(norm[1].codigo).toBe('03.01');
  });
});

describe('filtrarPartidasHojaBD', () => {
  it('devuelve únicamente partidas hoja desde filas de BD e incluye 03.01# y 03.02# sin hijos (caso Comparativa N-01)', () => {
    const dbRows = [
      { id: 'r0', texto_partida: 'DUPLEXANDREA_REVISION_1#::PROYECTO RAÍZ', precio_base_estimado: 0 },
      { id: 'r1', texto_partida: '01#::ACTUACIONES PREVIAS', precio_base_estimado: 0 },
      { id: 'r2', texto_partida: '01.01#::DEMOLICIONES', precio_base_estimado: 0 },
      { id: 'r3', texto_partida: '01.01.01::Demolición tabiquería', unidad: 'm2', precio_base_estimado: 150, cantidad: 10 },
      { id: 'r4', texto_partida: '03#::PARTICIONES', precio_base_estimado: 0 },
      { id: 'r5', texto_partida: '03.01#::Entramados autoportantes', unidad: 'm2', precio_base_estimado: 2204.48, cantidad: 1 },
      { id: 'r6', texto_partida: '03.02#::Falsos techos', unidad: 'm2', precio_base_estimado: 5056.01, cantidad: 1 },
    ];

    const hojas = filtrarPartidasHojaBD(dbRows);

    expect(hojas.map((p) => p.id)).toEqual(['r3', 'r5', 'r6']);
    expect(hojas.map((p) => p.Capítulo)).toEqual(['01.01.01', '03.01', '03.02']);
    expect(hojas[1].texto_partida).toBe('03.01::Entramados autoportantes');
    expect(hojas[2].texto_partida).toBe('03.02::Falsos techos');
  });
});

describe('mapearPartidasDesdeBD', () => {
  it('separa el código de capítulo de texto_partida, prioriza precio_adjudicado y aplica extraFieldsFn', () => {
    const dbRows = [
      {
        id: 'p1',
        texto_partida: '01.01::Demolición completa',
        oficio_asignado: 'Albañilería',
        precio_base_estimado: 100,
        precio_adjudicado: 150,
        cantidad: 3,
        precio_ia: 110,
        unidad: 'm2',
      },
      {
        id: 'p2',
        texto_partida: '01.02::Retirada escombros',
        oficio_asignado: null,
        precio_base_estimado: 80,
        precio_adjudicado: 0,
        cantidad: 1,
        precio_ia: null,
        unidad: 'ud',
      },
    ];

    const mapped = mapearPartidasDesdeBD(dbRows, (row, finalPrice) => ({
      valor_anterior_precio: finalPrice,
      aprobado: false,
    }));

    expect(mapped[0]).toMatchObject({
      Capítulo: '01.01',
      Descripción: 'Demolición completa',
      'Oficio Asignado': 'Albañilería',
      'Precio Total (€)': 150,
      Cantidad: 3,
      'Precio IA': 110,
      'Unidad IA': 'm2',
      valor_anterior_precio: 150,
      aprobado: false,
    });

    expect(mapped[1]).toMatchObject({
      Capítulo: '01.02',
      Descripción: 'Retirada escombros',
      'Oficio Asignado': 'Sin asignar',
      'Precio Total (€)': 80,
      valor_anterior_precio: 80,
    });
  });
});

describe('actualizarCampoPartida', () => {
  it('actualiza de forma inmutable el campo indicado, normaliza precios a número y marca isModified', () => {
    const inicial = [
      { id: 1, Capítulo: '01.01', 'Precio Total (€)': 100, Cantidad: 1, isModified: false },
      { id: 2, Capítulo: '01.02', 'Precio Total (€)': 200, Cantidad: 2, isModified: false },
    ];

    const actualizado = actualizarCampoPartida(
      inicial,
      0,
      'Precio Total (€)',
      '350.75',
      { origen_modificacion: 'Manual' }
    );

    // No muta el array ni el objeto original
    expect(actualizado).not.toBe(inicial);
    expect(inicial[0]['Precio Total (€)']).toBe(100);
    expect(inicial[0].isModified).toBe(false);

    // Nuevo estado actualizado
    expect(actualizado[0]['Precio Total (€)']).toBe(350.75);
    expect(actualizado[0].isModified).toBe(true);
    expect(actualizado[0].origen_modificacion).toBe('Manual');
    expect(actualizado[1]).toBe(inicial[1]);
  });
});

describe('sortPartidasFn', () => {
  it('ordena jerárquicamente capítulos, subcapítulos y partidas con o sin segundo punto', () => {
    const desordenadas = [
      { Capítulo: '02.01' },
      { Capítulo: '01.0211' },
      { Capítulo: '01#' },
      { Capítulo: '01.02#' },
      { Capítulo: '01.02.02' },
      { Capítulo: '02#' },
    ];

    const ordenadas = [...desordenadas].sort(sortPartidasFn);
    expect(ordenadas.map((p) => p.Capítulo)).toEqual([
      '01#',
      '01.02#',
      '01.02.02',
      '01.0211',
      '02#',
      '02.01',
    ]);
  });
});
