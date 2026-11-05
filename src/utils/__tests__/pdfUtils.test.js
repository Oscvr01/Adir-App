import { describe, it, expect } from 'vitest';
import { generarPresupuestoPDF } from '../pdfUtils';

describe('generarPresupuestoPDF - Mediciones en PDF', () => {
  const samplePartidas = [
    {
      Capítulo: '01#',
      Descripción: 'DEMOLICIONES',
    },
    {
      Capítulo: '01.01',
      Descripción: 'Demolición de tabique',
      Cantidad: 10,
      unidad: 'm2',
      'Precio Total (€)': 15,
      mediciones: [
        { comentario: 'Salón', uds: 1, largo: 4, ancho: 2.5, alto: 1, parcial: 10 },
      ],
    },
    {
      Capítulo: '01.02',
      Descripción: 'Retirada de escombros',
      Cantidad: 5,
      unidad: 'm3',
      'Precio Total (€)': 30,
      mediciones: [
        { comentario: 'Baño 1', uds: 1, largo: 2, ancho: 1, alto: 1, parcial: 2 },
        { comentario: 'Baño 2', uds: 1, largo: 3, ancho: 1, alto: 1, parcial: 3 },
      ],
    },
  ];

  it('genera el PDF sin desglose de mediciones cuando medicionesVisibles no se proporciona', () => {
    const doc = generarPresupuestoPDF({
      cliente: 'Cliente Test',
      propuesta_id: 'PR-001',
      partidas: samplePartidas,
      precio_total: 300,
      esBorrador: true,
    });
    expect(doc).toBeDefined();
    // Accedemos a la tabla generada
    const table = doc.lastAutoTable;
    expect(table).toBeDefined();
    // Solo debe tener: 1 fila cap + 2 filas partidas = 3 filas
    expect(table.body.length).toBe(3);
  });

  it('genera el PDF en modo Borrador con desglose de mediciones si medicionesVisibles está activo para todas', () => {
    const doc = generarPresupuestoPDF({
      cliente: 'Cliente Test',
      propuesta_id: 'PR-001',
      partidas: samplePartidas,
      precio_total: 300,
      esBorrador: true,
      medicionesVisibles: new Set([1, 2]), // partidas en índice 1 y 2
    });
    const table = doc.lastAutoTable;
    expect(table).toBeDefined();

    // Partida 1 (idx 1): tiene 1 línea de medición -> cabecera + 1 línea + subtotal = +3 filas
    // Partida 2 (idx 2): tiene 2 líneas de medición -> cabecera + 2 líneas + subtotal = +4 filas
    // Total filas esperadas: 3 base + 3 + 4 = 10 filas
    expect(table.body.length).toBe(10);

    // Comprobar contenido de la cabecera de medición
    const medHeader = table.body[2].raw;
    expect(medHeader[1].content).toContain('Desglose de medición');
    expect(medHeader[2].content).toBe('Uds.');
    expect(medHeader[3].content).toBe('Long.');
    expect(medHeader[4].content).toBe('Anch.');
    expect(medHeader[5].content).toBe('Alt.');
    expect(medHeader[6].content).toBe('Parcial');

    // Comprobar contenido de la primera línea de medición
    const medRow = table.body[3].raw;
    expect(medRow[1].content).toContain('Salón');
    expect(medRow[2].content).toBe('1,00');
    expect(medRow[3].content).toBe('4,00');
    expect(medRow[4].content).toBe('2,50');
    expect(medRow[5].content).toBe('1,00');
    expect(medRow[6].content).toBe('10,00');
  });

  it('genera el PDF en modo Cliente con desglose de mediciones adaptado a 6 columnas', () => {
    const doc = generarPresupuestoPDF({
      cliente: 'Cliente Test',
      propuesta_id: 'PR-001',
      partidas: samplePartidas,
      precio_total: 300,
      esBorrador: false,
      medicionesVisibles: new Set([1]), // solo primera partida expandida
    });
    const table = doc.lastAutoTable;
    expect(table).toBeDefined();

    // 3 base + (1 cabecera + 1 línea + 1 subtotal para idx 1) = 6 filas
    expect(table.body.length).toBe(6);

    // Cabecera en 6 columnas
    const medHeader = table.body[2].raw;
    expect(medHeader[1].content).toContain('Desglose de medición');
    expect(medHeader[2].content).toBe('Uds.');
    expect(medHeader[3].content).toBe('Long. × Anch. × Alt.');
    expect(medHeader[3].colSpan).toBe(2);
    expect(medHeader[4].content).toBe('Parcial');

    // Fila de medición en modo cliente
    const medRow = table.body[3].raw;
    expect(medRow[1].content).toContain('Salón');
    expect(medRow[2].content).toBe('1,00');
    expect(medRow[3].content).toBe('4,00 × 2,50 × 1,00');
    expect(medRow[3].colSpan).toBe(2);
    expect(medRow[4].content).toBe('10,00');
  });

  it('soporta medicionesVisibles como boolean true para desglosar todas las partidas con mediciones', () => {
    const doc = generarPresupuestoPDF({
      cliente: 'Cliente Test',
      propuesta_id: 'PR-001',
      partidas: samplePartidas,
      precio_total: 300,
      esBorrador: true,
      medicionesVisibles: true,
    });
    const table = doc.lastAutoTable;
    expect(table.body.length).toBe(10);
  });
});
