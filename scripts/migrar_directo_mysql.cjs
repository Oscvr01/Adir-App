/**
 * Migración DIRECTA Supabase → MySQL
 * ===================================
 * Sin phpMyAdmin. Conecta directamente a ambas BDs y sincroniza.
 * Usa TRUNCATE + INSERT para un estado limpio y consistente.
 *
 * USO: node migrar_directo_mysql.cjs
 */

const SUPABASE_URL = 'https://mspejiongrdsgbqomewj.supabase.co';
const SUPABASE_KEY = 'sb_publishable_-_DqtXu-GQ97LecbJgLgqw_ADU_ZMzG';
const mysql = require('mysql2/promise');

const DB_CONFIG = {
    host:     'hl1607.dinaserver.com',
    user:     'adirg_user_bd',
    password: 'I0qj7n![4.23',
    database: 'adirg_bbdd',
    charset:  'utf8mb4',
    connectTimeout: 30000,
    multipleStatements: false,
};

const SB_HEADERS = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Prefer': 'count=exact',
};

// ─── Fetch completo desde Supabase con paginación ────────────────────────────
async function fetchAll(table, select = '*') {
    const rows = [];
    let offset = 0;
    const limit = 1000;
    while (true) {
        const url = `${SUPABASE_URL}/rest/v1/${table}?select=${select}&limit=${limit}&offset=${offset}`;
        const res = await fetch(url, { headers: SB_HEADERS });
        if (!res.ok) { console.log(`  ⚠ ${table}: ${res.status}`); break; }
        const data = await res.json();
        if (!Array.isArray(data) || data.length === 0) break;
        rows.push(...data);
        process.stdout.write(`\r  ↓ ${table}: ${rows.length} filas...`);
        if (data.length < limit) break;
        offset += limit;
    }
    console.log(`\r  ✓ ${table}: ${rows.length} filas              `);
    return rows;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function num(v, def = null) {
    if (v === null || v === undefined || v === '') return def;
    const n = parseFloat(v);
    return isFinite(n) ? n : def;
}
function dt(v) {
    if (!v) return null;
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 19).replace('T', ' ');
}
function dateOnly(v) {
    if (!v) return null;
    const s = String(v).slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}
function splitTextoPart(texto) {
    if (!texto) return { codigo: null, desc: null };
    if (texto.includes('::')) {
        const [cod, ...rest] = texto.split('::');
        return { codigo: cod.trim(), desc: rest.join('::').replace(/\|/g, ' ').trim() };
    }
    return { codigo: null, desc: texto.replace(/\|/g, ' ').trim() };
}
function sanitizarPartidas(partidas) {
    if (!Array.isArray(partidas)) return partidas ? JSON.stringify(partidas) : null;
    return JSON.stringify(partidas.map(p => ({
        'Capítulo':              p['Capítulo'] || p.Capitulo || '',
        'Descripción':           p['Descripción'] || p.Descripcion || '',
        'Cantidad':              parseFloat(p.Cantidad) || 0,
        'Unidad IA':             p['Unidad IA'] || p.unidad || '',
        'precio_adjudicado':     parseFloat(p.precio_adjudicado ?? p['Precio Total (€)']) || 0,
        'precio_total_capitulo': parseFloat(p.precio_total_capitulo) || 0,
    })));
}

// ─── Insertar batch de filas ──────────────────────────────────────────────────
async function insertBatch(conn, table, rows, mapFn, batchSize = 200) {
    if (!rows.length) return;
    let ok = 0, err = 0;

    // Lookup maps disponibles en scope global (ver main)
    for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);
        for (const [idx, row] of batch.entries()) {
            try {
                const mapped = mapFn(row, i + idx + 1);
                if (!mapped) continue;
                const cols = Object.keys(mapped).map(c => `\`${c}\``).join(', ');
                const phs  = Object.keys(mapped).map(() => '?').join(', ');
                const vals = Object.values(mapped);
                await conn.execute(
                    `INSERT IGNORE INTO \`${table}\` (${cols}) VALUES (${phs})`,
                    vals
                );
                ok++;
            } catch (e) {
                err++;
                if (err <= 3) console.warn(`  ⚠ Fila ${i+idx} en ${table}:`, e.message.slice(0, 80));
            }
        }
        process.stdout.write(`\r  → ${table}: ${Math.min(i + batchSize, rows.length)}/${rows.length} insertadas...`);
    }
    console.log(`\r  ✅ ${table}: ${ok} insertadas, ${err} errores              `);
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
const MAP = {
    propuestas:  new Map(),
    partidas:    new Map(),
    proveedores: new Map(),
    solicitudes: new Map(),
};

async function main() {
    console.log('🚀 Migración DIRECTA Supabase → MySQL\n');

    // ── Conectar MySQL ────────────────────────────────────────────────────────
    const conn = await mysql.createConnection(DB_CONFIG);
    console.log('✅ Conexión MySQL establecida\n');

    // ── Descargar Supabase (en paralelo para tablas pequeñas) ─────────────────
    console.log('⬇  Descargando datos de Supabase...');
    const [propuestas, presupuestos, proveedores, solicitudes, respuestas, configuracion] =
        await Promise.all([
            fetchAll('propuestas'),
            fetchAll('presupuestos_cliente'),
            fetchAll('proveedores'),
            fetchAll('solicitudes'),
            fetchAll('respuestas'),
            fetchAll('configuracion'),
        ]);
    const partidas  = await fetchAll('partidas');
    const historial = await fetchAll('historial_cambios');

    console.log('\n📚 Descargando catálogos de precios...');
    const baseAdir = await fetchAll('base_precios_adir');
    const cype     = await fetchAll('PreciosCype');

    // ── Construir lookup maps ─────────────────────────────────────────────────
    console.log('\n🔗 Construyendo mapas de IDs...');
    propuestas.forEach((r, i)  => MAP.propuestas.set(String(r.Proyecto), i + 1));
    partidas.forEach((r, i)    => MAP.partidas.set(String(r.id), i + 1));
    proveedores.forEach((r, i) => MAP.proveedores.set(String(r.id), i + 1));
    solicitudes.forEach((r, i) => MAP.solicitudes.set(String(r.id), i + 1));

    function remap(map, oldId) {
        if (!oldId) return null;
        return map.get(String(oldId)) ?? null;
    }

    // ── TRUNCATE (orden: hijos primero) ───────────────────────────────────────
    console.log('\n🗑  Limpiando tablas (TRUNCATE)...');
    await conn.execute('SET FOREIGN_KEY_CHECKS = 0');
    for (const t of [
        'ctcon_respuestas','ctcon_solicitudes','ctcon_partidas',
        'ctcon_presupuestos_cliente','ctcon_propuestas','ctcon_proveedores',
        'ctcon_historial_cambios','ctcon_configuracion',
        'ctcon_base_precios_adir','ctcon_precios_cype',
    ]) {
        await conn.execute(`TRUNCATE TABLE \`${t}\``);
        process.stdout.write(`  ✓ ${t}\n`);
    }
    await conn.execute('SET FOREIGN_KEY_CHECKS = 1');

    // ── INSERTAR ──────────────────────────────────────────────────────────────
    console.log('\n📥 Insertando datos...');

    // propuestas
    await insertBatch(conn, 'ctcon_propuestas', propuestas, (r, id) => ({
        id,
        proyecto_bc3:    r.Proyecto || null,
        cliente:         r.cliente  || null,
        direccion:       r.direccion || null,
        jefe_obra:       r.jefe_obra || null,
        estado:          r.estado || 'Borrador',
        fecha_recepcion: dt(r.fecha_recepcion),
        descripcion:     r.descripcion || null,
    }));

    // proveedores
    await insertBatch(conn, 'ctcon_proveedores', proveedores, (r, id) => ({
        id,
        id_bc3:           r.id || null,
        nombre_empresa:   r.nombre_empresa || '',
        oficio_principal: r.oficio_principal || null,
        email:            r.email || null,
        telefono:         r.telefono || null,
        valoracion:       num(r.valoracion),
    }));

    // partidas
    await insertBatch(conn, 'ctcon_partidas', partidas, (r, id) => {
        const { codigo, desc } = splitTextoPart(r.texto_partida);
        return {
            id,
            id_bc3:                  r.id || null,
            propuesta_id:            remap(MAP.propuestas, r.propuesta_id),
            propuesta_bc3:           r.propuesta_id || null,
            capitulo_codigo:         codigo,
            descripcion:             desc,
            texto_partida:           r.texto_partida || null,
            precio_base_estimado:    num(r.precio_base_estimado, 0),
            precio_adjudicado:       num(r.precio_adjudicado),
            precio_ia:               num(r.precio_ia),
            cantidad:                num(r.cantidad, 0),
            unidad:                  r.unidad || null,
            oficio_asignado:         r.oficio_asignado || null,
            proveedor_adjudicado_id: remap(MAP.proveedores, r.proveedor_adjudicado_id),
            estado_adjudicacion:     r.estado_adjudicacion || null,
            force_quote:             r.force_quote ? 1 : 0,
        };
    });

    // presupuestos_cliente
    await insertBatch(conn, 'ctcon_presupuestos_cliente', presupuestos, (r, id) => ({
        id,
        id_bc3:               r.id || null,
        token:                r.token || null,
        propuesta_id:         remap(MAP.propuestas, r.propuesta_id),
        propuesta_bc3:        r.propuesta_id || null,
        cliente_nombre:       r.cliente_nombre || null,
        cliente_email:        r.cliente_email || null,
        proyecto_descripcion: r.proyecto_descripcion || null,
        partidas:             sanitizarPartidas(r.partidas),
        precio_total:         num(r.precio_total, 0),
        fecha_envio:          dt(r.fecha_envio),
        estado:               r.estado || 'pendiente',
        firma_base64:         r.firma_base64 || null,
        firma_url:            null,
        fecha_firma:          dt(r.fecha_firma),
        detalles_rechazo:     r.detalles_rechazo || null,
    }));

    // solicitudes
    await insertBatch(conn, 'ctcon_solicitudes', solicitudes, (r, id) => ({
        id,
        id_bc3:                r.id || null,
        propuesta_id:          remap(MAP.propuestas, r.propuesta_id),
        propuesta_bc3:         r.propuesta_id || null,
        oficio_solicitado:     r.oficio_solicitado || null,
        fecha_envio:           dt(r.fecha_envio),
        estado_solicitud:      r.estado_solicitud || 'Enviada',
        token:                 r.token || null,
        proveedor_nombre:      r.proveedor_nombre || null,
        proveedor_email:       r.proveedor_email || null,
        tareas:                r.tareas ? JSON.stringify(r.tareas) : null,
        proveedor_id:          remap(MAP.proveedores, r.proveedor_id),
        comentarios_generales: r.comentarios_generales || null,
        anexo_url:             r.anexo_url || null,
    }));

    // respuestas
    await insertBatch(conn, 'ctcon_respuestas', respuestas, (r, id) => ({
        id,
        id_bc3:          r.id || null,
        solicitud_id:    remap(MAP.solicitudes, r.solicitud_id),
        solicitud_bc3:   r.solicitud_id || null,
        proveedor_id:    remap(MAP.proveedores, r.proveedor_id),
        proveedor_bc3:   r.proveedor_id || null,
        partida_id:      remap(MAP.partidas, r.partida_id),
        partida_bc3:     r.partida_id || null,
        precio_ofertado: num(r.precio_ofertado),
        comentarios:     r.comentarios || null,
        created_at:      dt(r.created_at),
    }));

    // historial
    await insertBatch(conn, 'ctcon_historial_cambios', historial, (r) => ({
        fecha_cambio:        dt(r.fecha_cambio),
        usuario:             r.usuario || null,
        origen_cambio:       r.origen_cambio || null,
        tipo_entidad:        r.tipo_entidad || null,
        entidad_id:          r.entidad_id ? String(r.entidad_id).slice(0, 200) : null,
        proyecto_referencia: r.proyecto_referencia ? String(r.proyecto_referencia).slice(0, 200) : null,
        campo_modificado:    r.campo_modificado || null,
        valor_anterior:      r.valor_anterior ? String(r.valor_anterior).slice(0, 65535) : null,
        valor_nuevo:         r.valor_nuevo ? String(r.valor_nuevo).slice(0, 65535) : null,
        detalles:            r.detalles || null,
    }));

    // base_precios_adir (grande — batch pequeño)
    await insertBatch(conn, 'ctcon_base_precios_adir', baseAdir, (r) => ({
        codigo:               r.codigo || null,
        categoria:            r.categoria ? String(r.categoria).slice(0, 500) : null,
        unidad:               r.unidad || null,
        descripcion_corta:    r.descripcion_corta ? String(r.descripcion_corta).slice(0, 500) : null,
        descripcion_detallada: r.descripcion_detallada || null,
        mano_de_obra:         num(r.mano_de_obra),
        maquinaria:           num(r.maquinaria),
        materiales_y_otros:   num(r.materiales_y_otros),
        precio_total:         num(r.precio_total),
        tags:                 r.tags || null,
        tipo:                 r.tipo || null,
        fecha:                dateOnly(r.fecha),
        tipo_partida:         r.tipo_partida || null,
        fuente:               r.fuente || null,
        fecha_actualizacion:  dateOnly(r.fecha_actualizacion),
    }), 100);

    // precios_cype
    await insertBatch(conn, 'ctcon_precios_cype', cype, (r) => ({
        codigo:               r.codigo || null,
        categoria:            r.categoria ? String(r.categoria).slice(0, 500) : null,
        unidad:               r.unidad || null,
        descripcion_corta:    r.descripcion_corta ? String(r.descripcion_corta).slice(0, 500) : null,
        descripcion_detallada: r.descripcion_detallada || null,
        mano_de_obra:         num(r.mano_de_obra),
        maquinaria:           num(r.maquinaria),
        materiales:           num(r.materiales),
        precio_total:         num(r.precio_total),
        tipo_partida:         r.tipo_partida || null,
        fuente:               r.fuente || null,
        fecha_actualizacion:  dateOnly(r.fecha_actualizacion),
    }));

    // configuracion
    await insertBatch(conn, 'ctcon_configuracion', configuracion, (r) => ({
        clave: r.clave,
        valor: r.valor || null,
    }));

    // ── Verificación final ────────────────────────────────────────────────────
    console.log('\n📊 Verificación final:');
    const checks = [
        ['ctcon_propuestas', propuestas.length],
        ['ctcon_partidas', partidas.length],
        ['ctcon_presupuestos_cliente', presupuestos.length],
        ['ctcon_proveedores', proveedores.length],
        ['ctcon_solicitudes', solicitudes.length],
        ['ctcon_respuestas', respuestas.length],
        ['ctcon_historial_cambios', historial.length],
        ['ctcon_base_precios_adir', baseAdir.length],
        ['ctcon_precios_cype', cype.length],
    ];
    let allOk = true;
    for (const [tabla, esperado] of checks) {
        const [r] = await conn.execute(`SELECT COUNT(*) as n FROM \`${tabla}\``);
        const n = Number(r[0].n);
        const ok = n === esperado;
        if (!ok) allOk = false;
        console.log(`  ${ok ? '✅' : '⚠'} ${tabla.padEnd(35)} ${n}/${esperado}`);
    }

    await conn.end();
    console.log(allOk
        ? '\n🎉 Migración completa y verificada. La BD está lista.'
        : '\n⚠  Hay diferencias. Revisa los errores arriba.');
}

main().catch(e => { console.error('\n❌', e.message); process.exit(1); });
