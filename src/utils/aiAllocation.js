import { supabase } from './supabaseClient';

export const TODOS_LOS_OFICIOS = [
    "Albañilería",
    "Carpintero",
    "Climatización",
    "Cristalería",
    "Electricista",
    "Fontanería",
    "Movimiento de Tierras",
    "Pintor",
];

export const getCleanProjectName = (proyectoId) => {
    if (!proyectoId) return '';
    return proyectoId
        .replace(/_\d{8,}.*$/, '') // removes timestamps (8+ digits)
        .replace(/_\d+$/, '')      // removes trailing _1, _2
        .replace(/_/g, ' ')        // replaces underscores with spaces
        .trim();
};

const BATCH_SIZE = 15;
// Reducimos a 1 para evitar rate limits en la capa gratuita de Mistral
const PARALLEL_BATCHES = 1;
const delay = ms => new Promise(res => setTimeout(res, ms));

/**
 * Búsqueda en históricos adjudicados. Devuelve { context, unidad }.
 */
const getHistoricalContext = async (descripcion) => {
    try {
        if (!descripcion || descripcion.length < 5) return { context: "", unidad: null };
        const cleanDesc = descripcion.substring(0, 20);
        const { data } = await supabase
            .from('partidas')
            .select('texto_partida, precio_adjudicado, unidad')
            .ilike('texto_partida', `%${cleanDesc}%`)
            .gt('precio_adjudicado', 0)
            .limit(2);

        if (!data || data.length === 0) return { context: "", unidad: null };
        const unidad = data.find(r => r.unidad)?.unidad || null;
        const context = data.map(r =>
            `- [HISTÓRICO REAL]: ${r.texto_partida} (Adjudicado por ${r.precio_adjudicado}€)`
        ).join('\n');
        return { context, unidad };
    } catch (e) { return { context: "", unidad: null }; }
};

/**
 * Búsqueda avanzada en CYPE con categoría y unidad.
 */
const getCypeContext = async (descripcion) => {
    try {
        if (!descripcion || descripcion.length < 4) return "";
        const cleanDesc = descripcion.split('::').pop().split(' ').filter(w => w.length > 3).slice(0, 3).join('%');
        
        const { data } = await supabase
            .from('PreciosCype')
            .select('codigo, categoria, unidad, descripcion_corta, precio_total, mano_de_obra, materiales, maquinaria')
            .or(`descripcion_corta.ilike.%${cleanDesc}%,descripcion_detallada.ilike.%${cleanDesc}%`)
            .limit(3);

        if (!data || data.length === 0) return "Sin referencias exactas.";
        
        return data.map(r => 
            `- [CYPE ${r.codigo}] (${r.categoria}): ${r.descripcion_corta}. PVP:${r.precio_total}€/${r.unidad}. (MO:${r.mano_de_obra}€, Mat:${r.materiales}€, Maq:${r.maquinaria}€)`
        ).join('\n');
    } catch (e) { return "Error de consulta."; }
};

/**
 * Búsqueda en la Base de Precios OFICIAL de ADIR (Máxima Prioridad)
 */
const getAdirContext = async (descripcion) => {
    try {
        if (!descripcion || descripcion.length < 4) return "";
        const codigo = descripcion.split('::')[0].trim();
        const texto = descripcion.split('::').pop().trim();
        
        // Buscamos por código exacto o descripción corta
        const { data } = await supabase
            .from('base_precios_adir')
            .select('codigo, descripcion_corta, precio_total, unidad, mano_de_obra, materiales_y_otros')
            .or(`codigo.eq.${codigo},descripcion_corta.ilike.%${texto.substring(0, 20)}%`)
            .limit(2);

        if (!data || data.length === 0) return "";
        return data.map(r => 
            `- [ADIR OFICIAL]: ${r.descripcion_corta} (${r.codigo}). Precio: ${r.precio_total}€/${r.unidad}. (MO: ${r.mano_de_obra}€, Otros: ${r.materiales_y_otros}€)`
        ).join('\n');
    } catch (e) { return ""; }
};

export const asignarProveedoresIA = async (partidas, proveedores, onProgress) => {
    // Usamos TODOS_LOS_OFICIOS para asegurar una clasificación técnica precisa de cada partida
    const oficiosDisponibles = TODOS_LOS_OFICIOS.join(', ');

    // Fast path: localStorage cache
    let apiKey = localStorage.getItem('groq_api_key');
    if (!apiKey || apiKey.length < 10) {
        // Fallback: read from Supabase configuracion table (cloud storage)
        try {
            const { data } = await supabase
                .from('configuracion')
                .select('valor')
                .eq('clave', 'groq_api_key')
                .maybeSingle();
            if (data?.valor && data.valor.length > 10) {
                apiKey = data.valor;
                localStorage.setItem('groq_api_key', apiKey);
            }
        } catch (_) {}
    }
    if (!apiKey || apiKey.length < 10) throw new Error("API Key no configurada. Ve a Ajustes para añadirla.");
    
    const itemsParaIA = partidas
        .filter(p => !((p.Capítulo || p.Capitulo || "").endsWith('#')))
        .map(p => ({
            id: p.id || Math.random().toString(36),
            cap: p.Capítulo || p.Capitulo || "S/C",
            desc: (p.Descripción || p.Descripcion || p.texto_partida || "").toString().trim(),
            unidad: p["Unidad IA"] || p.unidad || ""
        }));

    if (itemsParaIA.length === 0) return { asignaciones: {}, sinProveedor: [] };

    const asignacionesFinales = {};

    // Construir los batches por adelantado para procesarlos en paralelo (con concurrencia limitada).
    const batches = [];
    for (let i = 0; i < itemsParaIA.length; i += BATCH_SIZE) {
        batches.push(itemsParaIA.slice(i, i + BATCH_SIZE));
    }

    // Procesa un único batch (idéntico al cuerpo del bucle original).
    const procesarBatch = async (batch) => {
        const contextPromises = batch.map(async (item) => {
            const [adirContext, histResult, cypeContext] = await Promise.all([
                getAdirContext(item.desc),
                getHistoricalContext(item.desc),
                getCypeContext(item.desc),
            ]);

            // Unidad: prioridad BC3/manual → histórico → Mistral la decide si sigue vacía
            const unidadPrevia = item.unidad || histResult.unidad || null;
            const tieneUnidadPrevia = !!unidadPrevia;

            let combinedContext = "";
            if (adirContext) combinedContext += `\nBASE DE PRECIOS ADIR (PRIORIDAD ALTA):\n${adirContext}`;
            if (histResult.context) combinedContext += `\nDATOS HISTÓRICOS ADJUDICADOS:\n${histResult.context}`;
            combinedContext += `\nDATOS CYPE MURCIA:\n${cypeContext}`;

            const unidadInfo = unidadPrevia ? `\nUNIDAD: ${unidadPrevia}` : '';

            return {
                contextStr: `TAREA ID: ${item.id}\nDESCRIPCIÓN: ${item.desc}${unidadInfo}\n${combinedContext}`,
                unidad: unidadPrevia,
                tieneUnidadPrevia,
            };
        });

        const bloquesContexto = await Promise.all(contextPromises);

        const prompt = `Eres Auditor de Costos de Construcción 2026. Valora estas TAREAS de obra.

REGLAS PARA ASIGNAR PRECIO (ORDEN DE PRIORIDAD):
1. BASE ADIR OFICIAL: Si existe dato "BASE DE PRECIOS ADIR", úsalo como PRECIO BASE. Es la referencia interna prioritaria.
2. HISTÓRICO REAL: Si no hay base ADIR pero hay "HISTÓRICOS ADJUDICADOS", úsalos como precio.
3. CYPE MURCIA: Solo como referencia de mercado si no hay datos internos.
4. Si ninguna fuente tiene dato, estima el precio razonable para Murcia 2026.

REGLAS PARA ASIGNAR OFICIO (lista OFICIOS POSIBLES):
1. Elige SIEMPRE uno de los oficios listados en "OFICIOS POSIBLES" (que son los únicos que tienen proveedores disponibles actualmente). Reparte las partidas mapeándolas al oficio disponible más compatible.
2. Albañilería: albañil, tabique, ladrillo, mortero, enlucido, revoco, yeso, escayola, falso techo, pladur, demolición, derribar, desmontaje, desescombro, limpieza de obra, solados, alicatados, pavimentos, azulejos, baldosas, gres, cerámica, porcelánico.
3. Carpintero: carpintero, puertas, cercos, muebles, armarios, marcos, ventanas de madera o aluminio/PVC, persianas, tarima, parquet, cerrajería, rejas, barandillas, trabajos en metal/acero/aluminio.
4. Electricista: electricista, cable, cableado, cuadro eléctrico, enchufe, interruptor, luminaria, luces, tira led, instalación eléctrica, telecomunicaciones.
5. Fontanería: fontanero, fontanería, tubería, desagüe, PVC, grifo, sanitario, lavabo, inodoro, plato de ducha, bañera, grifería, termos, calentadores.
6. Climatización: climatización, aire acondicionado, conductos, rejillas, split, calefacción, caldera, radiador, bomba de calor, ventilación.
7. Pintor: pintor, pintura, pintar, alisado, masilla, gotelé, lijado, imprimación, barniz, lacado, esmalte.
8. Movimiento de Tierras: excavación, desbroce, vaciado, zanja, desmonte, desescombro con maquinaria, movimiento de tierras, relleno, nivelación, compactación.
9. Cristalería: cristalero, vidrios, cristales, acristalamiento, mamparas de baño, espejos, lunas.

OFICIOS POSIBLES: ${oficiosDisponibles}

REGLAS PARA ASIGNAR UNIDAD DE MEDIDA:
- Si la tarea YA tiene campo "UNIDAD:" → devuelve unidad: null (no la toques).
- Si la tarea NO tiene campo "UNIDAD:" → elige la unidad más apropiada según la descripción:
  m2 = superficies (pintura, alicatado, solado, falso techo, trasdosado...)
  ml = longitudes lineales (rodapié, canalón, tira led, conducto...)
  m3 = volúmenes (excavación, hormigón, relleno...)
  ud = unidades completas (sanitario, puerta, luminaria, cuadro, split...)
  pa = partida alzada (instalación completa, medios auxiliares, gestión...)
  h  = horas de trabajo (trabajos extra, jornadas...)
  kg = peso (acero, ferralla...)

Responde ÚNICAMENTE con la estructura JSON exacta (sin bloques de código markdown ni texto adicional):
{
  "asignaciones": {
    "ID_EJEMPLO": {
      "oficio": "Albañilería",
      "precio": 25.50,
      "unidad": "m2",
      "justificacion": "Estimación de mercado"
    }
  }
}

PAQUETE DE EVALUACIÓN:
${bloquesContexto.map(b => b.contextStr).join('\n\n---\n\n')}`;

        let response;
        let maxRetries = 5;
        let attempt = 0;

        while (attempt <= maxRetries) {
            response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                body: JSON.stringify({
                    model: 'groq/compound-mini',
                    messages: [
                        { role: 'system', content: 'You are a JSON generator. You MUST respond ONLY with a raw, valid JSON object without markdown formatting or introductory text.' },
                        { role: 'user', content: prompt }
                    ],
                    temperature: 0.1,
                    response_format: { type: 'json_object' }
                })
            });

            if (response.status === 429) {
                attempt++;
                if (attempt > maxRetries) break;
                // Exponencial backoff: 3s, 6s, 12s, 24s, 30s
                const backoffMs = Math.min(30000, 3000 * Math.pow(2, attempt - 1));
                console.warn(`[Groq AI] Rate limit (429) alcanzado. Reintentando en ${backoffMs / 1000}s (Intento ${attempt}/${maxRetries})...`);
                await delay(backoffMs);
            } else {
                break;
            }
        }

        if (response.ok) {
            const data = await response.json();
            const content = JSON.parse(data.choices?.[0]?.message?.content || '{}');
            const lote = content.asignaciones || {};

            batch.forEach((item, batchIdx) => {
                let info = lote[item.id];
                
                // Fallback in case Mistral altered the key slightly
                if (!info) {
                    const matchedKey = Object.keys(lote).find(k => k.includes(item.id) || item.id.includes(k));
                    if (matchedKey) info = lote[matchedKey];
                }

                if (info && info.oficio && info.oficio !== "Sin asignar") {
                    const ctx = bloquesContexto[batchIdx];
                    // Si ya había unidad previa (BC3/manual/histórico), respetarla siempre.
                    // Si no había, usar la que propone Mistral (puede ser null si no sabe).
                    const unidadFinal = ctx.tieneUnidadPrevia
                        ? ctx.unidad
                        : (info.unidad && info.unidad !== 'null' ? info.unidad : null);
                    const unidad_por_ia = !ctx.tieneUnidadPrevia && !!unidadFinal;

                    asignacionesFinales[item.id] = {
                        oficio: info.oficio,
                        precio: info.precio || 0,
                        unidad: unidadFinal,
                        unidad_por_ia,
                        justificacion: info.justificacion || "S/Ref",
                        needsQuote: (info.precio === 0)
                    };
                }
            });
        } else {
            const errText = await response.text();
            if (response.status === 429) {
                throw new Error("Límite de peticiones de Groq alcanzado (Rate Limit 429). La cuota gratuita requiere esperar unos segundos. Vuelve a intentarlo en 1 minuto.");
            }
            throw new Error(`Groq API Error (${response.status}): ${errText}`);
        }
    };

    // Ejecuta los batches en grupos de PARALLEL_BATCHES (ventana deslizante).
    let procesados = 0;
    for (let i = 0; i < batches.length; i += PARALLEL_BATCHES) {
        const slice = batches.slice(i, i + PARALLEL_BATCHES);
        await Promise.all(slice.map(procesarBatch));
        procesados += slice.reduce((s, b) => s + b.length, 0);
        onProgress?.({ status: 'progress', progress: Math.round((procesados / itemsParaIA.length) * 100) });
        if (i + PARALLEL_BATCHES < batches.length) {
            await delay(2500); // Esperar 2.5 segundos entre lotes para respetar el rate limit de Mistral
        }
    }

    return { asignaciones: asignacionesFinales, sinProveedor: [] };
};
