import { describe, it, expect } from 'vitest';
import { parseBC3, resolveCod, extractBC3Coeficiente } from '../bc3Parser';
import { getTipoFila, calcularTotalPartidas } from '../partidas';

describe('bc3Parser.js - Parser FIEBDC-3', () => {
  describe('resolveCod', () => {
    const conceptos = {
      'DUPLEXANDREA##': {},
      '01#': {},
      '03.01#': {},
      '04.01': {},
    };

    it('resuelve coincidencia exacta', () => {
      expect(resolveCod('01#', conceptos)).toBe('01#');
      expect(resolveCod('04.01', conceptos)).toBe('04.01');
    });

    it('resuelve códigos sin # en ~D hacia conceptos con # o ## en ~C', () => {
      expect(resolveCod('01', conceptos)).toBe('01#');
      expect(resolveCod('03.01', conceptos)).toBe('03.01#');
      expect(resolveCod('DUPLEXANDREA', conceptos)).toBe('DUPLEXANDREA##');
      expect(resolveCod('DUPLEXANDREA#', conceptos)).toBe('DUPLEXANDREA##');
    });

    it('resuelve códigos con # hacia conceptos sin # si aplica', () => {
      expect(resolveCod('04.01#', conceptos)).toBe('04.01');
    });

    it('devuelve null cuando el código no existe en ninguna variante', () => {
      expect(resolveCod('99.99', conceptos)).toBeNull();
      expect(resolveCod('', conceptos)).toBeNull();
    });
  });

  describe('extractBC3Coeficiente (~K)', () => {
    it('extrae el porcentaje entero del registro ~K (ej. 30 en Presto)', () => {
      const bc3 = [
        '~V|SOFT S.A.|FIEBDC-3/2002|Presto 8.8||ANSI|',
        '~K|\\2\\2\\3\\2\\2\\2\\2\\EUR\\|30|',
      ].join('\n');
      expect(extractBC3Coeficiente(bc3)).toBe(30);
    });

    it('soporta decimales con coma en ~K', () => {
      const bc3 = '~K|\\2\\2\\3\\2\\2\\2\\2\\EUR\\|19,5|';
      expect(extractBC3Coeficiente(bc3)).toBe(19.5);
    });

    it('devuelve 0 cuando no hay registro ~K o el porcentaje es 0', () => {
      expect(extractBC3Coeficiente('~V|SOFT|')).toBe(0);
      expect(extractBC3Coeficiente('~K|\\2\\2\\EUR\\|0|')).toBe(0);
    });
  });

  describe('Tolerancia a # en jerarquía (~D vs ~C) y subcapítulos con unidad', () => {
    it('enlaza capítulos y subcapítulos aunque ~D omita el # final y el subcapítulo tenga unidad', () => {
      const bc3 = [
        '~K|\\2\\2\\3\\2\\2\\2\\2\\EUR\\|30|',
        '~C|DUPLEXANDREA##|||54513.63|170725|0|',
        '~D|DUPLEXANDREA##|01\\1\\1\\03\\1\\1\\|',
        '~C|01#||DEMOLICIÓN|10783.83|060226|0|',
        '~D|01#|01.01\\1\\1\\|',
        '~C|01.01|pa|Demolición en Cocina|720|130526|0|',
        '~C|03#||PARTICIONES|7260.49|080726|0|',
        '~D|03#|03.01\\1\\1\\03.02\\1\\1\\|',
        '~C|03.01#|m2|Entramados autoportantes|2204.48|080726|0|',
        '~D|03.01#|03.01.01\\1\\29.75\\|',
        '~C|03.01.01|M2|Tabique de placa de yeso laminado|57|080726|0|',
        '~C|03.02#|m2|Falsos techos|5056.01|080726|0|',
        '~D|03.02#|03.02.01\\1\\54.14\\03.02.02\\1\\14.29\\03.03.03\\1\\54.14\\|',
        '~C|03.02.01|M2|Falso techo continuo|31|080726|0|',
        '~C|03.02.02|M2|Falso techo registrable|60|080726|0|',
        '~C|03.03.03|m2|Foseado techos|25|080726|0|',
      ].join('\n');

      const items = parseBC3(bc3);

      // Expone el coeficiente de ~K en el array retornado sin perder Array.isArray
      expect(Array.isArray(items)).toBe(true);
      expect(items.coeficientePct).toBe(30);

      // No debe aparecer DUPLEXANDREA# como capítulo suelto ni 99_EXTRAS
      const codigos = items.map((i) => i.Capítulo);
      expect(codigos).not.toContain('DUPLEXANDREA#');
      expect(codigos).not.toContain('DUPLEXANDREA##');
      expect(codigos).not.toContain('99_EXTRAS#');

      // Debe contener los capítulos 01#, 03#, subcapítulos 03.01#, 03.02# y sus 4 partidas hoja de 03
      expect(codigos).toEqual([
        '01#',
        '01.01',
        '03#',
        '03.01#',
        '03.01.01',
        '03.02#',
        '03.02.01',
        '03.02.02',
        '03.03.03',
      ]);

      // Verificar total del capítulo 03:
      // 29.75*57 (1695.75) + 54.14*31 (1678.34) + 14.29*60 (857.40) + 54.14*25 (1353.50) = 5584.99 €
      // Con +30% = 7260.49 € (exacto a Presto)
      const partidas03 = items.filter((i) => getTipoFila(i) === 'partida' && i.Capítulo.startsWith('03.'));
      expect(partidas03).toHaveLength(4);
      const coste03 = calcularTotalPartidas(partidas03);
      expect(coste03).toBeCloseTo(5584.99, 2);
      expect(Math.round(coste03 * 1.3 * 100) / 100).toBe(7260.49);
    });
  });

  describe('Preservación del título corto de capítulos frente a ~T', () => {
    it('mantiene el Resumen de ~C en capítulos ("PINTURA") y aplica ~T solo a partidas hoja', () => {
      const bc3 = [
        '~C|04#||PINTURA|247.86|140726|0|',
        '~D|04#|04.01\\1\\10.3\\04.02\\1\\1\\|',
        '~C|04.01|m2|Barandilla|12.46|140726|0|',
        '~C|04.02|ud|Puerta semisótano|62.31|140726|0|',
        '~T|04#|Pintura plástica acrílica lisa mate lavable profesional sobre paramentos horizontales y verticales|',
        '~T|04.01|Barandilla esmaltada con dos manos de acabado.|',
      ].join('\n');

      const items = parseBC3(bc3);
      const cap04 = items.find((i) => i.Capítulo === '04#');
      const part0401 = items.find((i) => i.Capítulo === '04.01');
      const part0402 = items.find((i) => i.Capítulo === '04.02');

      expect(cap04.Descripción).toBe('PINTURA');
      expect(part0401.Descripción).toBe('Barandilla esmaltada con dos manos de acabado.');
      expect(part0402.Descripción).toBe('Puerta semisótano');
    });
  });

  describe('Cálculo de precio en partidas descompuestas (~D sobre partidas hoja)', () => {
    it('calcula el precio unitario de la partida sumando sus descompuestos cuando superan el valor estático de ~C', () => {
      const bc3 = [
        '~K|\\2\\2\\3\\2\\2\\2\\2\\EUR\\|30|',
        '~C|07#||SANITARIOS Y GRIFERIAS|3466.74|170725|0|',
        '~D|07#|07.01\\1\\3\\07.02\\1\\3\\07.03\\1\\3\\07.04\\1\\3\\07.05\\1\\3\\07.06\\1\\3\\|',
        '~C|07.01|ud|Suministro WC|240|170725|0|',
        '~D|07.01|HAHK\\1\\1\\HJKHSJK\\1\\1\\HKHSHJ\\1\\1\\JKAJJ\\1\\1\\|',
        '~C|07.02|ud|Suministro mueble de lavabo|250|180626|0|',
        '~D|07.02|FUIG\\1\\1\\WEYGF\\1\\1\\|',
        '~C|07.03|ud|Suministro grifería de ducha|112.45|120226|0|',
        '~C|07.04|ud|Suministro grifería de lavabo|47.45|030726|0|',
        '~C|07.05|ud|Suministro de espejo retroiluminado|129|030726|0|',
        '~C|07.06|ud|Suministro de lavabo|110|030726|0|',
        '~C|FUIG|ud|Mueble cristy 150*50|467.5|180626|0|',
        '~C|WEYGF|ud|Encimera pacífico 150*50|127.5|180626|0|',
        '~C|HAHK|Ud|hacer rozas 0.5 dia dos personas|400|210725|0|',
        '~C|HJKHSJK|Ud|tapar rozas un0.5 dia 2 persona|400|210725|0|',
        '~C|HKHSHJ|Ud|materiales|60|170725|0|',
        '~C|JKAJJ|Ud|maquinria|30|170725|0|',
      ].join('\n');

      const items = parseBC3(bc3);
      const partidas = items.filter((i) => getTipoFila(i) === 'partida');

      // Deben ser exactamente las 6 partidas del capítulo 07 (los descompuestos HAHK, FUIG, etc. no deben salir como filas)
      expect(partidas).toHaveLength(6);

      const p0701 = partidas.find((p) => p.Capítulo === '07.01');
      const p0702 = partidas.find((p) => p.Capítulo === '07.02');

      // 07.01 = 400 + 400 + 60 + 30 = 890 € (en vez de 240 €)
      expect(p0701['Precio Total (€)']).toBe(890);
      // 07.02 = 467.5 + 127.5 = 595 € (en vez de 250 €)
      expect(p0702['Precio Total (€)']).toBe(595);

      // Coste total cap 07 = 3 * (890 + 595 + 112.45 + 47.45 + 129 + 110) = 5651.70 €
      const totalCoste = calcularTotalPartidas(partidas);
      expect(totalCoste).toBeCloseTo(5651.7, 2);

      // Total con +30% (redondeo Presto por precio unitario) = 7347.24 €
      const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
      const totalPvpPresto = partidas.reduce((acc, p) => {
        const pvpUnit = round2(p['Precio Total (€)'] * 1.3);
        return round2(acc + round2(pvpUnit * p.Cantidad));
      }, 0);
      expect(totalPvpPresto).toBe(7347.24);
    });
  });

  describe('Presupuesto completo estilo duplexandrea (10 capítulos y cuadre exacto con Presto)', () => {
    it('cuadra al céntimo los 10 capítulos y el total de 58.394,13 € de Presto', () => {
      const bc3 = [
        '~V|SOFT S.A.|FIEBDC-3/2002|Presto 8.8||ANSI|',
        '~K|\\2\\2\\3\\2\\2\\2\\2\\EUR\\|30|',
        '~C|DUPLEXANDREA##|||54513.63|170725|0|',
        '~D|DUPLEXANDREA##|01\\1\\1\\02\\1\\1\\03\\1\\1\\04\\1\\1\\05\\1\\1\\06\\1\\1\\07\\1\\1\\08\\1\\1\\09\\1\\1\\10\\1\\1\\|',
        '~C|01#||DEMOLICIÓN|10783.83|060226|0|',
        '~D|01#|01.01\\1\\1\\01.02\\1\\1\\01.03\\1\\3\\01.04\\1\\3\\01.05\\1\\22.15\\01.06\\1\\3\\01.07\\1\\1\\01.08\\1\\2\\01.09\\1\\1\\01.10\\1\\1\\|',
        '~C|01.01|pa|Demolición en Cocina|720|130526|0|',
        '~C|01.02|ud|Contenedores ejecución de obra|330|060226|0|',
        '~C|01.03|ud|Contenedores desescombro mixto demolición|330|060226|0|',
        '~C|01.04|ud|Desmontaje de Sanitarios/Griferias|300|030726|0|',
        '~C|01.05|m2|Demolición de tabiques|35|080726|0|',
        '~C|01.06|ud|Demolicion de armarios|150|030726|0|',
        '~C|01.07|pa|Demolicion de falso techo (salón)|1260|070726|0|',
        '~C|01.08|ud|Desmontaje de puerta habitaciones-cocina|100|030726|0|',
        '~C|01.09|ud|Demolicion de solado escalera|2520|070726|0|',
        '~C|01.10|ud|Demolición de la barandilla planta ático|150|160726|0|',
        '~C|02#||ALBAÑÍLERIA|7187.05|080726|0|',
        '~D|02#|02.01\\1\\1\\02.02\\1\\1\\02.03\\1\\3\\|',
        '~C|02.01|pa|Ayuda albañilería electricidad|400|080726|0|',
        '~C|02.02|pa|Ayuda albañileria fontaneria|300|080726|0|',
        '~C|02.03|ud|OCA 20 PIES DE DUCHA|1609.5|140726|0|',
        '~C|03#||PARTICIONES|7260.49|080726|0|',
        '~D|03#|03.01\\1\\1\\03.02\\1\\1\\|',
        '~C|03.01#|m2|Entramados autoportantes|2204.48|080726|0|',
        '~D|03.01#|03.01.01\\1\\29.75\\|',
        '~C|03.01.01|M2|Tabique de placa de yeso laminado|57|080726|0|',
        '~C|03.02#|m2|Falsos techos|5056.01|080726|0|',
        '~D|03.02#|03.02.01\\1\\54.14\\03.02.02\\1\\14.29\\03.03.03\\1\\54.14\\|',
        '~C|03.02.01|M2|Falso techo continuo|31|080726|0|',
        '~C|03.02.02|M2|Falso techo registrable|60|080726|0|',
        '~C|03.03.03|m2|Foseado techos|25|080726|0|',
        '~C|04#||PINTURA|247.86|140726|0|',
        '~D|04#|04.01\\1\\10.3\\04.02\\1\\1\\|',
        '~C|04.01|m2|Barandilla|12.46|140726|0|',
        '~C|04.02|ud|Puerta semisótano|62.31|140726|0|',
        '~T|04#|Pintura plástica acrílica lisa mate lavable profesional|',
        '~C|05#||ALICATADOS Y SOLADOS|15934.66|140526|0|',
        '~D|05#|05.01\\1\\69.5\\05.02\\1\\77.4\\05.03\\1\\29\\|',
        '~C|05.01|m2|Revestimiento interior con azulejos|57.25|140526|0|',
        '~C|05.02|m2|Pavimento porcelánico interior|78.85|080726|0|',
        '~C|05.03|UD|Escalera|75|080726|0|',
        '~C|06#||ELECTRICIDAD|2353|080726|0|',
        '~D|06#|06.01\\1\\1\\06.02\\1\\20\\|',
        '~C|06.01||Trabajos de electricidad|1450|080726|0|',
        '~C|06.02|UD|Luminaria circular tipo Downlight|18|080726|0|',
        '~C|07#||SANITARIOS Y GRIFERIAS|3466.74|170725|0|',
        '~D|07#|07.01\\1\\3\\07.02\\1\\3\\07.03\\1\\3\\07.04\\1\\3\\07.05\\1\\3\\07.06\\1\\3\\|',
        '~C|07.01|ud|Suministro WC|240|170725|0|',
        '~D|07.01|HAHK\\1\\1\\HJKHSJK\\1\\1\\HKHSHJ\\1\\1\\JKAJJ\\1\\1\\|',
        '~C|07.02|ud|Suministro mueble de lavabo|250|180626|0|',
        '~D|07.02|FUIG\\1\\1\\WEYGF\\1\\1\\|',
        '~C|07.03|ud|Suministro grifería de ducha|112.45|120226|0|',
        '~C|07.04|ud|Suministro grifería de lavabo|47.45|030726|0|',
        '~C|07.05|ud|Suministro de espejo retroiluminado|129|030726|0|',
        '~C|07.06|ud|Suministro de lavabo|110|030726|0|',
        '~C|08#||FONTANERIA|3120|100726|0|',
        '~D|08#|08.01\\1\\3\\08.02\\1\\3\\|',
        '~C|08.01|ud|Anular tomas de agua|150|100726|0|',
        '~C|08.02|ud|Montaje de Sanitarios|650|100726|0|',
        '~C|09#||VARIOS|2210|080726|0|',
        '~D|09#|09.01\\1\\1\\09.02\\1\\1\\|',
        '~C|09.01|pa|Medios auxiliares|850|080726|0|',
        '~C|09.02|pa|Limpieza de obra|850|080726|0|',
        '~C|10#||SEGURIDAD Y SALUD|1950|080726|0|',
        '~D|10#|10.01\\1\\1\\|',
        '~C|10.01|UD|Seguridad y salud|1500|080726|0|',
        '~C|FUIG|ud|Mueble cristy 150*50|467.5|180626|0|',
        '~C|WEYGF|ud|Encimera pacífico 150*50|127.5|180626|0|',
        '~C|HAHK|Ud|hacer rozas 0.5 dia dos personas|400|210725|0|',
        '~C|HJKHSJK|Ud|tapar rozas un0.5 dia 2 persona|400|210725|0|',
        '~C|HKHSHJ|Ud|materiales|60|170725|0|',
        '~C|JKAJJ|Ud|maquinria|30|170725|0|',
      ].join('\n');

      const items = parseBC3(bc3);
      const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
      const factor = 1 + (items.coeficientePct || 0) / 100;

      const capitulos = items.filter((p) => getTipoFila(p) === 'capitulo');
      expect(capitulos).toHaveLength(10);

      const soloPartidas = items.filter((p) => getTipoFila(p) === 'partida');
      expect(soloPartidas).toHaveLength(35);

      const totalPvpPresto = soloPartidas.reduce((acc, p) => {
        const pvpUnit = round2(p['Precio Total (€)'] * factor);
        return round2(acc + round2(pvpUnit * p.Cantidad));
      }, 0);

      expect(totalPvpPresto).toBe(58394.13);
    });
  });
});
