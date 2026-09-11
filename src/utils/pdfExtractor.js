/**
 * pdfExtractor.js
 * Extrae partidas de materiales/obra de un PDF de tarifa de precios.
 * Diseñado para ser lo más universal posible: funciona con diferentes
 * formatos de diferentes proveedores (BIGMAT, Leroy Merlin, Sodimac, etc.)
 *
 * Estrategia:
 *  1. Extraer texto del PDF agrupado por filas (misma posición Y).
 *  2. Para cada fila, detectar precio, unidad y descripción mediante heurísticas.
 *  3. Limpiar y descartar filas que no son partidas (cabeceras, totales, pies…).
 */

import * as pdfjsLib from 'pdfjs-dist';

// Worker — Vite resuelve la URL estática del worker de pdfjs
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).href;

// ── Constantes ────────────────────────────────────────────────────────────────

// Unidades de medida habituales en construcción / materiales
const UNIDADES_RE = /^(ud|u|unid|unidades?|m2|m²|m³|m3|ml|m\b|mt|kg|gr|g\b|tn|t\b|l\b|lt|litros?|h\b|hora|jornada|jorn|gl|pa|partida|rollo|caja|bote|saco|palé|palet|juego|set|pk|paq|pack|bl|bl\.|plac|pieza|pz|lamina|lam|bobina|bob)$/i;

// Precio: número con decimales (coma o punto), con o sin € delante/detrás
// Captura el número en grupo 1
const PRICE_RE = /(?:^|[\s;|€$£])([0-9]{1,8}[.,][0-9]{1,4})(?:\s*€|\s*EUR)?(?:\s|$|;|\|)/;

// Número sin decimales que podría ser precio redondo (ej: "15 €")
const PRICE_INTEGER_RE = /(?:^|[\s;|€$£])([0-9]{1,6})\s*€/;

// Líneas que son claramente NO partidas
const SKIP_PATTERNS = [
  /^pág(ina)?\.?\s*\d/i,
  /^página\s*\d/i,
  /^\d+\s*\/\s*\d+$/, // "1 / 24"
  /^(tarifa|lista\s*de\s*precios?|precios?\s*de\s*venta|pvp|iva|total|subtotal|descuento|dto\.?|precio\s*neto|precio\s*base)/i,
  /^(referencia|ref\.?|código|cod\.?|descripción|descripcion|unidad|precio)\s*$/i,
  /^\s*$/, // vacía
];

// ── Extracción de texto del PDF ───────────────────────────────────────────────

/**
 * Lee un File (PDF) y devuelve un array de objetos:
 *   { lineText: string, items: [{x, y, text}], pageNum }
 * Agrupados por fila (posición Y, tolerancia ±3px).
 */
export async function extraerLineasDePDF(file) {
  const buffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: buffer, verbosity: 0 });
  const pdf = await loadingTask.promise;

  const allLines = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent({ includeMarkedContent: false });

    // Agrupar items por Y (tolerancia 3px para items en la misma línea)
    const rows = {}; // yKey → [{x, text}]
    for (const item of content.items) {
      if (!item.str?.trim()) continue;
      const rawY = item.transform[5];
      // Redondear Y al múltiplo de 3 más cercano para agrupar
      const yKey = Math.round(rawY / 3) * 3;
      if (!rows[yKey]) rows[yKey] = [];
      rows[yKey].push({ x: item.transform[4], text: item.str.trim() });
    }

    // Ordenar por Y descendente (PDF: Y crece hacia arriba)
    const yKeys = Object.keys(rows).map(Number).sort((a, b) => b - a);
    for (const yKey of yKeys) {
      const items = rows[yKey].sort((a, b) => a.x - b.x);
      const lineText = items.map(i => i.text).join('  ').replace(/\s{3,}/g, '  ').trim();
      if (lineText) allLines.push({ lineText, items, pageNum: p, y: yKey });
    }
  }

  return allLines;
}

// ── Helpers de parsing de precio por item ────────────────────────────────────

/**
 * Intenta parsear un texto de item como precio numérico.
 * Soporta formatos: "4,75" "4.75" "1.250,00" "1,250.00" "15" (solo si hay € cerca).
 * Devuelve el número o null si no es un precio válido.
 */
function parsePrecioItem(text) {
  const t = text.trim();
  // Ignorar textos no numéricos o demasiado cortos
  if (!t || !/[0-9]/.test(t)) return null;

  // Formato español con miles: "1.250,00" o "12.345,6"
  if (/^[0-9]{1,3}(\.[0-9]{3})+,[0-9]{1,2}$/.test(t)) {
    return parseFloat(t.replace(/\./g, '').replace(',', '.'));
  }
  // Formato inglés con miles: "1,250.00"
  if (/^[0-9]{1,3}(,[0-9]{3})+\.[0-9]{1,2}$/.test(t)) {
    return parseFloat(t.replace(/,/g, ''));
  }
  // Decimal simple: "4,75" o "4.75" (sin separador de miles)
  if (/^[0-9]{1,8}[,.][0-9]{1,4}$/.test(t)) {
    return parseFloat(t.replace(',', '.'));
  }
  // Entero puro: solo si va acompañado de € en el propio texto
  if (/^[0-9]{1,6}€$/.test(t)) {
    return parseFloat(t.replace('€', ''));
  }
  // Entero con € separado por espacio — se maneja en el bucle del caller
  if (/^[0-9]{1,6}$/.test(t)) {
    return null; // enteros solos no son precios sin confirmación de €
  }
  return null;
}

// ── Parser universal de partidas ──────────────────────────────────────────────

/**
 * A partir de las líneas del PDF, extrae partidas {descripcion, unidad, precio, pagina}.
 *
 * Estrategia columnar mejorada:
 *  1. Para cada fila, escanear solo los N items más a la DERECHA (zona numérica).
 *     No se rompe ante texto descriptivo — así la descripción larga no bloquea el precio.
 *  2. Recoger hasta 3 candidatos de precio (números con decimales).
 *  3. Si hay 2+ candidatos (posible columna "Precio/ud" + "Total"):
 *     - Si entre ellos existe un entero (cantidad), el segundo más a la derecha es precio/ud.
 *     - De lo contrario usar el más a la derecha.
 *  4. Fallback al regex sobre lineText → se usa el ÚLTIMO match (no el primero),
 *     ya que los precios suelen estar en la parte derecha de la línea.
 */
export function parsearPartidasDePDF(lineas) {
  const partidas = [];
  // Versiones globales de los regex de precio para usar con matchAll
  const PRICE_RE_G       = new RegExp(PRICE_RE.source, 'g');
  const PRICE_INT_RE_G   = new RegExp(PRICE_INTEGER_RE.source, 'g');

  for (const { lineText, items, pageNum } of lineas) {
    // Descartar líneas de relleno
    if (SKIP_PATTERNS.some(re => re.test(lineText.trim()))) continue;
    if (lineText.length < 5) continue;
    if (!items || items.length === 0) continue;

    // ── Estrategia 1: columnar — solo los N items más a la derecha ───────────
    // Limitando la búsqueda a la "zona numérica" (columnas de precio/cantidad/unidad)
    // evitamos que texto largo de descripción interrumpa la detección.
    const SCAN_LIMIT = Math.min(items.length, 8);
    const candidates = []; // [{precio, idx}], ordenados de derecha a izquierda

    for (let i = items.length - 1; i >= items.length - SCAN_LIMIT; i--) {
      const t = items[i].text.trim();
      if (/^[€$£]$|^EUR$/i.test(t)) continue; // saltar símbolo de moneda

      const candidato = parsePrecioItem(t);
      if (candidato !== null && candidato > 0 && candidato <= 50000) {
        candidates.push({ precio: candidato, idx: i });
        if (candidates.length >= 3) break; // recoger máximo 3 candidatos
      } else if (/^[0-9]{1,6}$/.test(t)) {
        // Entero solo: válido como precio si va acompañado de € en items adyacentes
        const siguientes = items.slice(i + 1).map(x => x.text.trim());
        const tieneEuro  = siguientes.some(s => /^[€$£]$|^EUR$/i.test(s));
        if (tieneEuro) {
          candidates.push({ precio: parseFloat(t), idx: i });
          if (candidates.length >= 3) break;
        }
      }
    }

    let precio = null;
    let precioItemIdx = -1;

    if (candidates.length === 1) {
      precio        = candidates[0].precio;
      precioItemIdx = candidates[0].idx;
    } else if (candidates.length >= 2) {
      const rightmost = candidates[0]; // más a la derecha (posible total)
      const second    = candidates[1]; // segundo (posible precio/ud)

      // Detectar si hay un entero (cantidad) entre los dos candidatos
      const itemsBetween = items.slice(second.idx + 1, rightmost.idx);
      const hasQty = itemsBetween.some(it => {
        const t2 = it.text.trim();
        return /^[0-9]{1,4}$/.test(t2) && !UNIDADES_RE.test(t2) && parseFloat(t2) > 0;
      });

      if (hasQty) {
        // Hay cantidad → el más a la derecha es total, el segundo es precio/ud
        precio        = second.precio;
        precioItemIdx = second.idx;
      } else {
        // Sin cantidad visible → usar el más a la derecha (columna de precio directa)
        precio        = rightmost.precio;
        precioItemIdx = rightmost.idx;
      }
    }

    // ── Estrategia 2 (fallback): regex → ÚLTIMO match en el texto ────────────
    // Tomar el último (más a la derecha) para evitar coger cantidades del inicio.
    if (precio === null) {
      const allDec = [...lineText.matchAll(PRICE_RE_G)];
      if (allDec.length > 0) {
        const last = allDec[allDec.length - 1];
        precio = parseFloat(last[1].replace(',', '.'));
      } else {
        const allInt = [...lineText.matchAll(PRICE_INT_RE_G)];
        if (allInt.length > 0) {
          const last = allInt[allInt.length - 1];
          precio = parseFloat(last[1]);
        }
      }
    }

    // Sin precio válido → descartar línea
    if (precio === null || precio <= 0 || precio > 50000) continue;

    // ── Construir descripción con los items a la izquierda del precio ─────────
    const descItems = precioItemIdx >= 0
      ? items.slice(0, precioItemIdx).filter(it => !/^[€$£]$|^EUR$/i.test(it.text.trim()))
      : items;

    let resto = descItems.map(it => it.text).join(' ').replace(/€|EUR/gi, '').replace(/\s{2,}/g, ' ').trim();

    // ── Detectar unidad ───────────────────────────────────────────────────────
    let unidad = 'ud';
    const tokens = resto.split(/\s+/);
    const unidadIdx = tokens.findIndex(t => UNIDADES_RE.test(t));
    if (unidadIdx !== -1) {
      unidad = tokens[unidadIdx].toLowerCase().replace('²', '2').replace('³', '3');
      tokens.splice(unidadIdx, 1);
    }

    // Eliminar tokens que sean cantidades puras (entero 1-4 dígitos) para que
    // no aparezcan incrustados en la descripción (ej: "m2  1  Descripción")
    const cleanTokens = tokens.filter(t => !/^\d{1,4}$/.test(t));

    // ── Descripción = lo que queda ────────────────────────────────────────────
    let descripcion = cleanTokens.join(' ').replace(/\s{2,}/g, ' ').trim();

    // Limpiar referencias/códigos al inicio (ej: "12345 Cemento..." → "Cemento...")
    descripcion = descripcion.replace(/^[A-Z0-9.-]{3,15}\s+/i, '').trim();

    // Descartar si la descripción es demasiado corta o solo números
    if (descripcion.length < 4 || /^\d+$/.test(descripcion)) continue;

    // Normalizar unidad
    unidad = normalizarUnidad(unidad);

    partidas.push({
      descripcion_corta: descripcion.substring(0, 250),
      unidad,
      precio_total: Math.round(precio * 100) / 100,
      pagina: pageNum,
    });
  }

  return partidas;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizarUnidad(u) {
  const map = {
    'u': 'ud', 'unid': 'ud', 'unidades': 'ud', 'unidad': 'ud',
    'm2': 'm²', 'm3': 'm³', 'mt': 'ml',
    'gr': 'g', 'tn': 'Tn', 'lt': 'L', 'litro': 'L', 'litros': 'L',
    'hora': 'h', 'jornada': 'jorn', 'jorn': 'jorn',
    'palé': 'palet', 'bobina': 'bob', 'lam': 'lám', 'lamina': 'lám',
    'paq': 'pack', 'pk': 'pack', 'bl': 'bl',
  };
  return map[u.toLowerCase()] || u.toLowerCase();
}

/**
 * Función principal (heurística): recibe un File PDF y devuelve partidas parseadas.
 */
export async function extraerPartidasDePDF(file) {
  const lineas = await extraerLineasDePDF(file);
  return parsearPartidasDePDF(lineas);
}

// ── Extractor IA con Groq ──────────────────────────────────────────────────

const GROQ_CHUNK_LINES = 55; // líneas por llamada a Groq (~2 000 tokens)
const PARALLEL_CHUNKS     = 3;  // chunks que se envían en paralelo (rate-limit seguro)

const PROMPT_SISTEMA = `Eres un experto en bases de precios de construcción española.
Analiza el fragmento de texto extraído de un PDF de tarifa de precios.
Extrae TODAS las partidas/artículos que encuentres e identifica para cada uno:
- descripcion: nombre completo del artículo (sin código de referencia ni precio)
- unidad: unidad de medida (ud, m2, m², ml, m3, kg, L, h, jorn, pa, etc.)
- precio: precio UNITARIO en euros (si hay columna "precio" e "importe/total", el unitario es el de precio por unidad, NO el total)

REGLAS:
- Ignora cabeceras, pies de página, totales, descuentos, IVA, referencias internas.
- Solo incluye ítems con precio numérico válido > 0 y ≤ 50000.
- Si no puedes identificar el precio unitario con seguridad, omite el ítem.
- Los decimales pueden ir con coma (12,50) o punto (12.50) — conviértelos siempre a número.

Responde ÚNICAMENTE con JSON válido (sin texto extra):
{"partidas": [{"descripcion": "...", "unidad": "ud", "precio": 12.50}]}
Si no hay partidas en este fragmento: {"partidas": []}`;

/**
 * Extrae partidas de un PDF usando Groq como motor de comprensión.
 * @param {File}     file       — archivo PDF
 * @param {string}   apiKey     — Groq API key
 * @param {function} onProgress — callback(pct: 0-100)
 * @returns {Promise<Array>}    — [{descripcion_corta, unidad, precio_total, pagina}]
 */
export async function extraerPartidasDePDFConIA(file, apiKey, onProgress) {
  const lineas = await extraerLineasDePDF(file);

  // Filtrar líneas vacías o de relleno obvio
  const textoLineas = lineas
    .map(l => l.lineText)
    .filter(t => t.length >= 5 && !SKIP_PATTERNS.some(re => re.test(t.trim())));

  const totalChunks = Math.ceil(textoLineas.length / GROQ_CHUNK_LINES);
  const partidas = [];

  // Procesa un chunk individual y devuelve el array de partidas extraídas.
  const procesarChunk = async (ci) => {
    const chunk = textoLineas
      .slice(ci * GROQ_CHUNK_LINES, (ci + 1) * GROQ_CHUNK_LINES)
      .join('\n');

    const resultado = [];
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'llama-3.1-70b-versatile',
          messages: [
            { role: 'system', content: PROMPT_SISTEMA },
            { role: 'user',   content: `TEXTO DEL PDF (fragmento ${ci + 1}/${totalChunks}):\n${chunk}` },
          ],
          temperature: 0.1,
          response_format: { type: 'json_object' },
        }),
      });

      if (res.ok) {
        const json = await res.json();
        let content;
        try { content = JSON.parse(json.choices?.[0]?.message?.content || '{"partidas":[]}'); }
        catch { content = { partidas: [] }; }

        if (Array.isArray(content.partidas)) {
          content.partidas.forEach(p => {
            const precio = parseFloat(String(p.precio).replace(',', '.'));
            if (!p.descripcion || !precio || precio <= 0 || precio > 50000) return;
            resultado.push({
              descripcion_corta: String(p.descripcion).substring(0, 250).trim(),
              unidad:            normalizarUnidad(String(p.unidad || 'ud').trim()),
              precio_total:      Math.round(precio * 100) / 100,
              pagina:            ci + 1,
            });
          });
        }
      }
    } catch (e) {
      console.warn(`[pdfIA] chunk ${ci + 1} error:`, e);
    }
    return resultado;
  };

  // Envía los chunks en ventanas de PARALLEL_CHUNKS para acelerar PDFs largos.
  let completados = 0;
  for (let i = 0; i < totalChunks; i += PARALLEL_CHUNKS) {
    const indices = [];
    for (let j = i; j < Math.min(i + PARALLEL_CHUNKS, totalChunks); j++) indices.push(j);

    const resultados = await Promise.all(indices.map(procesarChunk));
    resultados.forEach(arr => partidas.push(...arr));

    completados += indices.length;
    onProgress?.(Math.round((completados / totalChunks) * 100));
  }

  return partidas;
}
