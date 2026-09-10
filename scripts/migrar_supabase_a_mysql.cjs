/**
 * MIGRACIÓN: Supabase → MySQL (Dinahosting)
 * ==========================================
 * IDs: BIGINT AUTO_INCREMENT secuencial (1, 2, 3...)
 * Los BC3/UUID originales se guardan en columnas _bc3 / id_bc3
 * Los FK se remapean usando tablas de lookup construidas en memoria.
 *
 * USO: node migrar_supabase_a_mysql.cjs
 */

const SUPABASE_URL = 'https://mspejiongrdsgbqomewj.supabase.co';
const SUPABASE_KEY = 'sb_publishable_-_DqtXu-GQ97LecbJgLgqw_ADU_ZMzG';
const PREFIX = 'ctcon_';
const fs = require('fs');

const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'count=exact'
};

// ─── Leer tabla completa con paginación ──────────────────────────────────────
async function fetchAll(table, select = '*') {
    const rows = [];
    let offset = 0;
    const limit = 1000;
    while (true) {
        const url = `${SUPABASE_URL}/rest/v1/${table}?select=${select}&limit=${limit}&offset=${offset}`;
        const res = await fetch(url, { headers });
        if (!res.ok) {
            const txt = await res.text().catch(() => res.status);
            console.log(`  ⚠ ${table}: ${res.status} — ${String(txt).slice(0, 80)}`);
            break;
        }
        const data = await res.json();
        if (!Array.isArray(data) || data.length === 0) break;
        rows.push(...data);
        process.stdout.write(`\r  ↓ ${table}: ${rows.length} filas...`);
        if (data.length < limit) break;
        offset += limit;
    }
    console.log(`\r  ✓ ${table}: ${rows.length} filas           `);
    return rows;
}

// ─── Escape seguro para MySQL ─────────────────────────────────────────────────
function esc(v) {
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'number') return isFinite(v) ? String(v) : 'NULL';
    if (typeof v === 'boolean') return v ? '1' : '0';
    if (typeof v === 'object') v = JSON.stringify(v);
    return "'" + String(v)
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/\0/g, '\\0')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/\x1a/g, '\\Z') + "'";
}

function dt(v) {
    if (!v) return 'NULL';
    const d = new Date(v);
    if (isNaN(d.getTime())) return 'NULL';
    return `'${d.toISOString().slice(0, 19).replace('T', ' ')}'`;
}

function dateOnly(v) {
    if (!v) return 'NULL';
    const s = String(v).slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? `'${s}'` : 'NULL';
}

function num(v, def = 'NULL') {
    if (v === null || v === undefined || v === '') return def;
    const n = parseFloat(v);
    return isFinite(n) ? String(n) : def;
}

// ─── Lookup maps (old_id → new numeric id) ──────────────────────────────────
// Se construyen en main() antes de generar los INSERTs
const MAP = {
    propuestas:  new Map(),  // Proyecto (BC3) → numeric id
    partidas:    new Map(),  // id (BC3 composite) → numeric id
    proveedores: new Map(),  // id (string random) → numeric id
    solicitudes: new Map(),  // id (UUID) → numeric id
    presupuestos: new Map(), // id (UUID) → numeric id
};

/** Devuelve el id numérico mapeado o NULL si no existe */
function remapId(map, oldId) {
    if (oldId === null || oldId === undefined || oldId === '') return 'NULL';
    const n = map.get(String(oldId));
    return n !== undefined ? String(n) : 'NULL';
}

// ─── Sanitizar JSONB de partidas ─────────────────────────────────────────────
function sanitizarPartidas(partidas) {
    if (!Array.isArray(partidas)) return partidas;
    return partidas.map(p => ({
        'Capítulo':              p['Capítulo'] || p.Capitulo || '',
        'Descripción':           p['Descripción'] || p.Descripcion || '',
        'Cantidad':              parseFloat(p.Cantidad) || 0,
        'Unidad IA':             p['Unidad IA'] || p.unidad || '',
        'precio_adjudicado':     parseFloat(p.precio_adjudicado ?? p['Precio Total (€)']) || 0,
        'precio_total_capitulo': parseFloat(p.precio_total_capitulo) || 0,
    }));
}

// ─── Separar texto_partida "COD::Desc" ───────────────────────────────────────
function splitTextoPart(texto) {
    if (!texto) return { codigo: null, desc: null };
    if (texto.includes('::')) {
        const [cod, ...rest] = texto.split('::');
        return { codigo: cod.trim(), desc: rest.join('::').replace(/\|/g, ' ').trim() };
    }
    return { codigo: null, desc: texto.replace(/\|/g, ' ').trim() };
}

// ─── Generar bloque INSERT (idx base-1 → AUTO_INCREMENT) ─────────────────────
function genInserts(mysqlTable, rows, mapFn) {
    if (!rows.length) return `-- (sin datos en ${mysqlTable})\n\n`;
    const lines = [];
    lines.push(`-- ${'═'.repeat(50)}`);
    lines.push(`-- ${mysqlTable}  (${rows.length} filas)`);
    lines.push(`-- ${'═'.repeat(50)}`);

    let err = 0;
    rows.forEach((row, idx) => {
        try {
            const m = mapFn(row, idx + 1);   // idx+1 = nuevo id numérico (1-based)
            if (!m) return;
            const cols = Object.keys(m).map(c => `\`${c}\``).join(', ');
            const vals = Object.values(m).join(', ');
            lines.push(`INSERT IGNORE INTO \`${mysqlTable}\` (${cols}) VALUES (${vals});`);
        } catch (e) {
            err++;
            if (err <= 3) console.warn(`  ⚠ Error fila ${idx} en ${mysqlTable}:`, e.message);
        }
    });
    if (err) console.warn(`  ⚠ ${err} filas omitidas en ${mysqlTable}`);
    lines.push('');
    return lines.join('\n');
}

// ─── MAPEOS (con IDs numéricos secuenciales) ──────────────────────────────────

const mapPropuesta = (r, id) => ({
    id:              String(id),                  // BIGINT nuevo
    proyecto_bc3:    esc(r.Proyecto),             // BC3 original (PK vieja)
    cliente:         esc(r.cliente),
    direccion:       esc(r.direccion),
    jefe_obra:       esc(r.jefe_obra),
    estado:          esc(r.estado || 'Borrador'),
    fecha_recepcion: dt(r.fecha_recepcion) !== 'NULL' ? dt(r.fecha_recepcion) : 'CURRENT_TIMESTAMP',
    descripcion:     esc(r.descripcion),
});

const mapPartida = (r, id) => {
    const { codigo, desc } = splitTextoPart(r.texto_partida);
    const propuestaNuevoId = remapId(MAP.propuestas, r.propuesta_id);
    const proveedorNuevoId = remapId(MAP.proveedores, r.proveedor_adjudicado_id);
    return {
        id:                      String(id),             // BIGINT nuevo
        id_bc3:                  esc(r.id),              // BC3 original (PK vieja)
        propuesta_id:            propuestaNuevoId,        // FK numérica nueva
        propuesta_bc3:           esc(r.propuesta_id),    // BC3 original referencia
        capitulo_codigo:         esc(codigo),
        descripcion:             esc(desc),
        texto_partida:           esc(r.texto_partida),
        precio_base_estimado:    num(r.precio_base_estimado, '0'),
        precio_adjudicado:       num(r.precio_adjudicado),
        precio_ia:               num(r.precio_ia),
        cantidad:                num(r.cantidad, '0'),
        unidad:                  esc(r.unidad),
        oficio_asignado:         esc(r.oficio_asignado),
        proveedor_adjudicado_id: proveedorNuevoId,
        estado_adjudicacion:     esc(r.estado_adjudicacion),
        force_quote:             r.force_quote ? '1' : '0',
        created_at:              'CURRENT_TIMESTAMP',
    };
};

const mapPresupuesto = (r, id) => ({
    id:                   String(id),
    id_bc3:               esc(r.id),
    token:                esc(r.token),
    propuesta_id:         remapId(MAP.propuestas, r.propuesta_id),
    propuesta_bc3:        esc(r.propuesta_id),
    cliente_nombre:       esc(r.cliente_nombre),
    cliente_email:        esc(r.cliente_email),
    proyecto_descripcion: esc(r.proyecto_descripcion),
    partidas:             esc(sanitizarPartidas(r.partidas)),
    precio_total:         num(r.precio_total, '0'),
    fecha_envio:          dt(r.fecha_envio) !== 'NULL' ? dt(r.fecha_envio) : 'CURRENT_TIMESTAMP',
    estado:               esc(r.estado || 'pendiente'),
    firma_base64:         esc(r.firma_base64),
    firma_url:            'NULL',
    fecha_firma:          dt(r.fecha_firma),
    detalles_rechazo:     esc(r.detalles_rechazo),
});

const mapProveedor = (r, id) => ({
    id:               String(id),
    id_bc3:           esc(r.id),
    nombre_empresa:   esc(r.nombre_empresa),
    oficio_principal: esc(r.oficio_principal),
    email:            esc(r.email),
    telefono:         esc(r.telefono),
    valoracion:       num(r.valoracion),
    created_at:       'CURRENT_TIMESTAMP',
});

const mapSolicitud = (r, id) => ({
    id:                    String(id),
    id_bc3:                esc(r.id),
    propuesta_id:          remapId(MAP.propuestas, r.propuesta_id),
    propuesta_bc3:         esc(r.propuesta_id),
    oficio_solicitado:     esc(r.oficio_solicitado),
    fecha_envio:           dt(r.fecha_envio),
    estado_solicitud:      esc(r.estado_solicitud || 'Enviada'),
    token:                 esc(r.token),
    proveedor_nombre:      esc(r.proveedor_nombre),
    proveedor_email:       esc(r.proveedor_email),
    tareas:                esc(r.tareas),
    proveedor_id:          remapId(MAP.proveedores, r.proveedor_id),
    comentarios_generales: esc(r.comentarios_generales),
    anexo_url:             esc(r.anexo_url),
    created_at:            'CURRENT_TIMESTAMP',
});

const mapRespuesta = (r, id) => ({
    id:              String(id),
    id_bc3:          esc(r.id),
    solicitud_id:    remapId(MAP.solicitudes, r.solicitud_id),
    solicitud_bc3:   esc(r.solicitud_id),
    proveedor_id:    remapId(MAP.proveedores, r.proveedor_id),
    proveedor_bc3:   esc(r.proveedor_id),
    partida_id:      remapId(MAP.partidas, r.partida_id),
    partida_bc3:     esc(r.partida_id),
    precio_ofertado: num(r.precio_ofertado),
    comentarios:     esc(r.comentarios),
    created_at:      dt(r.created_at) !== 'NULL' ? dt(r.created_at) : 'CURRENT_TIMESTAMP',
});

const mapHistorial = (r /*, id */) => ({
    // id: AUTO_INCREMENT — no se inserta
    fecha_cambio:        dt(r.fecha_cambio) !== 'NULL' ? dt(r.fecha_cambio) : 'CURRENT_TIMESTAMP',
    usuario:             esc(r.usuario),
    origen_cambio:       esc(r.origen_cambio),
    tipo_entidad:        esc(r.tipo_entidad),
    entidad_id:          esc(r.entidad_id),
    proyecto_referencia: esc(r.proyecto_referencia),
    campo_modificado:    esc(r.campo_modificado),
    valor_anterior:      esc(r.valor_anterior),
    valor_nuevo:         esc(r.valor_nuevo),
    detalles:            esc(r.detalles),
    created_at:          'CURRENT_TIMESTAMP',
});

const mapBaseAdir = (r /*, id */) => ({
    // id: AUTO_INCREMENT — el natural key es `codigo`
    codigo:               esc(r.codigo),
    categoria:            esc(r.categoria),
    unidad:               esc(r.unidad),
    descripcion_corta:    esc(r.descripcion_corta),
    descripcion_detallada: esc(r.descripcion_detallada),
    mano_de_obra:         num(r.mano_de_obra),
    maquinaria:           num(r.maquinaria),
    materiales_y_otros:   num(r.materiales_y_otros),
    precio_total:         num(r.precio_total),
    tags:                 esc(r.tags),
    tipo:                 esc(r.tipo),
    fecha:                dateOnly(r.fecha),
    tipo_partida:         esc(r.tipo_partida),
    fuente:               esc(r.fuente),
    fecha_actualizacion:  dateOnly(r.fecha_actualizacion),
});

const mapCype = (r /*, id */) => ({
    // id: AUTO_INCREMENT — el natural key es `codigo`
    codigo:               esc(r.codigo),
    categoria:            esc(r.categoria),
    unidad:               esc(r.unidad),
    descripcion_corta:    esc(r.descripcion_corta),
    descripcion_detallada: esc(r.descripcion_detallada),
    mano_de_obra:         num(r.mano_de_obra),
    maquinaria:           num(r.maquinaria),
    materiales:           num(r.materiales),
    precio_total:         num(r.precio_total),
    tipo_partida:         esc(r.tipo_partida),
    fuente:               esc(r.fuente),
    fecha_actualizacion:  dateOnly(r.fecha_actualizacion),
});

const mapConfig = (r /*, id */) => ({
    clave: esc(r.clave),
    valor: esc(r.valor),
});

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
    console.log('🚀 Exportando Supabase → MySQL (prefijo: ' + PREFIX + ')\n');

    // Tablas de transacciones (en paralelo)
    const [propuestas, presupuestos, proveedores, solicitudes, respuestas, configuracion] =
        await Promise.all([
            fetchAll('propuestas'),
            fetchAll('presupuestos_cliente'),
            fetchAll('proveedores'),
            fetchAll('solicitudes'),
            fetchAll('respuestas'),
            fetchAll('configuracion'),
        ]);

    // partidas e historial (potencialmente grandes — en serie)
    const partidas  = await fetchAll('partidas');
    const historial = await fetchAll('historial_cambios');

    // Tablas de precios (grandes — en serie)
    console.log('\n📚 Exportando catálogos de precios (puede tardar ~30s)...');
    const baseAdir = await fetchAll('base_precios_adir');
    const cype     = await fetchAll('PreciosCype');

    // ─── Construir lookup maps (old_id → nuevo id numérico 1-based) ───────────
    console.log('\n🔗 Construyendo mapas de IDs...');

    propuestas.forEach((r, i)  => MAP.propuestas.set(String(r.Proyecto), i + 1));
    partidas.forEach((r, i)    => MAP.partidas.set(String(r.id), i + 1));
    proveedores.forEach((r, i) => MAP.proveedores.set(String(r.id), i + 1));
    solicitudes.forEach((r, i) => MAP.solicitudes.set(String(r.id), i + 1));
    presupuestos.forEach((r, i)=> MAP.presupuestos.set(String(r.id), i + 1));

    // Verificar cobertura de FKs
    let fkWarnPartidas = 0, fkWarnSolicitudes = 0, fkWarnRespSol = 0, fkWarnRespPart = 0;
    partidas.forEach(r => { if (r.propuesta_id && !MAP.propuestas.has(String(r.propuesta_id))) fkWarnPartidas++; });
    solicitudes.forEach(r => { if (r.propuesta_id && !MAP.propuestas.has(String(r.propuesta_id))) fkWarnSolicitudes++; });
    respuestas.forEach(r => { if (r.solicitud_id && !MAP.solicitudes.has(String(r.solicitud_id))) fkWarnRespSol++; });
    respuestas.forEach(r => { if (r.partida_id   && !MAP.partidas.has(String(r.partida_id)))     fkWarnRespPart++; });

    if (fkWarnPartidas)    console.log(`  ⚠ ${fkWarnPartidas} partidas con propuesta_id no encontrada en propuestas`);
    if (fkWarnSolicitudes) console.log(`  ⚠ ${fkWarnSolicitudes} solicitudes con propuesta_id no encontrada`);
    if (fkWarnRespSol)     console.log(`  ⚠ ${fkWarnRespSol} respuestas con solicitud_id no encontrada`);
    if (fkWarnRespPart)    console.log(`  ⚠ ${fkWarnRespPart} respuestas con partida_id no encontrada`);
    if (!fkWarnPartidas && !fkWarnSolicitudes && !fkWarnRespSol && !fkWarnRespPart) {
        console.log('  ✓ Todos los FK resueltos correctamente');
    }

    // Totales
    const total = [propuestas, partidas, presupuestos, proveedores, solicitudes,
                   respuestas, historial, baseAdir, cype, configuracion]
                  .reduce((s, t) => s + t.length, 0);

    console.log(`\n📊 Total: ${total.toLocaleString()} filas`);
    console.log(`   propuestas:          ${propuestas.length}`);
    console.log(`   partidas:            ${partidas.length}`);
    console.log(`   presupuestos:        ${presupuestos.length}`);
    console.log(`   proveedores:         ${proveedores.length}`);
    console.log(`   solicitudes:         ${solicitudes.length}`);
    console.log(`   respuestas:          ${respuestas.length}`);
    console.log(`   historial_cambios:   ${historial.length}`);
    console.log(`   base_precios_adir:   ${baseAdir.length}`);
    console.log(`   precios_cype:        ${cype.length}`);

    const fecha = new Date().toISOString().split('T')[0];
    const pie = [
        ``,
        `SET FOREIGN_KEY_CHECKS = 1;`,
        ``,
        `-- ${'='.repeat(60)}`,
        `--  FIN`,
        `-- ${'='.repeat(60)}`,
    ].join('\n');

    function makeCabecera(titulo, tablas) {
        return [
            `-- ${'='.repeat(60)}`,
            `--  ADIR — ${titulo}`,
            `--  Prefijo: ${PREFIX}   BD: adirg_bbdd (Dinahosting)`,
            `--  IDs: BIGINT AUTO_INCREMENT | INSERT IGNORE (reimportable)`,
            `--  Generado: ${new Date().toISOString()}`,
            `--  Tablas: ${tablas}`,
            `-- ${'='.repeat(60)}`,
            ``,
            `SET NAMES utf8mb4;`,
            `SET FOREIGN_KEY_CHECKS = 0;`,
            ``,
        ].join('\n');
    }

    // ── PARTE 1: datos de transacciones (~pequeño) ────────────────────────────
    const outFile1 = `migracion_parte1_datos_${fecha}.sql`;
    console.log('\n✍  Generando PARTE 1 (datos de obra)...');

    const cab1 = makeCabecera(
        'Parte 1 — Datos de obra (propuestas, partidas, solicitudes...)',
        'propuestas, proveedores, partidas, presupuestos, solicitudes, respuestas, historial, config'
    ) + [
        `-- Limpiar tablas de obra (hijos primero)`,
        `TRUNCATE TABLE \`${PREFIX}respuestas\`;`,
        `TRUNCATE TABLE \`${PREFIX}solicitudes\`;`,
        `TRUNCATE TABLE \`${PREFIX}partidas\`;`,
        `TRUNCATE TABLE \`${PREFIX}presupuestos_cliente\`;`,
        `TRUNCATE TABLE \`${PREFIX}propuestas\`;`,
        `TRUNCATE TABLE \`${PREFIX}proveedores\`;`,
        `TRUNCATE TABLE \`${PREFIX}historial_cambios\`;`,
        `TRUNCATE TABLE \`${PREFIX}configuracion\`;`,
        ``,
    ].join('\n');

    const ws1 = fs.createWriteStream(outFile1, { encoding: 'utf8' });
    ws1.write(cab1);
    for (const b of [
        genInserts(`${PREFIX}propuestas`,           propuestas,   mapPropuesta),
        genInserts(`${PREFIX}proveedores`,          proveedores,  mapProveedor),
        genInserts(`${PREFIX}partidas`,             partidas,     mapPartida),
        genInserts(`${PREFIX}presupuestos_cliente`, presupuestos, mapPresupuesto),
        genInserts(`${PREFIX}solicitudes`,          solicitudes,  mapSolicitud),
        genInserts(`${PREFIX}respuestas`,           respuestas,   mapRespuesta),
        genInserts(`${PREFIX}historial_cambios`,    historial,    mapHistorial),
        genInserts(`${PREFIX}configuracion`,        configuracion,mapConfig),
    ]) ws1.write(b);
    ws1.write(pie);
    ws1.end();
    await new Promise(r => ws1.on('finish', r));

    // ── PARTE 2a: precios ADIR (~grande) ─────────────────────────────────────
    const outFile2 = `migracion_parte2_precios_adir_${fecha}.sql`;
    console.log('✍  Generando PARTE 2 (precios ADIR)...');

    const cab2 = makeCabecera(
        'Parte 2 — Catálogo precios ADIR (54.490 filas)',
        'base_precios_adir'
    ) + `TRUNCATE TABLE \`${PREFIX}base_precios_adir\`;\n\n`;

    const ws2 = fs.createWriteStream(outFile2, { encoding: 'utf8' });
    ws2.write(cab2);
    ws2.write(genInserts(`${PREFIX}base_precios_adir`, baseAdir, mapBaseAdir));
    ws2.write(pie);
    ws2.end();
    await new Promise(r => ws2.on('finish', r));

    // ── PARTE 3: precios CYPE (~pequeño) ─────────────────────────────────────
    const outFile3 = `migracion_parte3_precios_cype_${fecha}.sql`;
    console.log('✍  Generando PARTE 3 (precios CYPE)...');

    const cab3 = makeCabecera(
        'Parte 3 — Catálogo precios CYPE (3.669 filas)',
        'precios_cype'
    ) + `TRUNCATE TABLE \`${PREFIX}precios_cype\`;\n\n`;

    const ws3 = fs.createWriteStream(outFile3, { encoding: 'utf8' });
    ws3.write(cab3);
    ws3.write(genInserts(`${PREFIX}precios_cype`, cype, mapCype));
    ws3.write(pie);
    ws3.end();
    await new Promise(r => ws3.on('finish', r));

    // ── Resumen ───────────────────────────────────────────────────────────────
    function fmtSize(f) {
        const s = fs.statSync(f).size;
        return `${Math.round(s/1024)} KB / ${(s/1024/1024).toFixed(1)} MB`;
    }
    console.log(`\n✅ Ficheros generados:`);
    console.log(`   [1] ${outFile1}  (${fmtSize(outFile1)})`);
    console.log(`   [2] ${outFile2}  (${fmtSize(outFile2)})`);
    console.log(`   [3] ${outFile3}  (${fmtSize(outFile3)})`);

    console.log(`\n📌 Orden de importación en phpMyAdmin:`);
    console.log(`   https://phpadmin.gestiondecuenta.com/52/`);
    console.log(`   1. mysql_schema_dinahosting.sql   (estructura)`);
    console.log(`   2. ${outFile1}  (propuestas, partidas, solicitudes...)`);
    console.log(`   3. ${outFile2}  (precios ADIR)`);
    console.log(`   4. ${outFile3}  (precios CYPE)`);

    console.log(`\n📋 Mapas de IDs generados:`);
    console.log(`   propuestas:  ${MAP.propuestas.size} entradas`);
    console.log(`   partidas:    ${MAP.partidas.size} entradas`);
    console.log(`   proveedores: ${MAP.proveedores.size} entradas`);
    console.log(`   solicitudes: ${MAP.solicitudes.size} entradas`);
    console.log(`   presupuestos: ${MAP.presupuestos.size} entradas`);
}

main().catch(err => { console.error('\n❌', err.message); process.exit(1); });
