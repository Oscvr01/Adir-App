/**
 * Verificación: compara conteos Supabase vs MySQL (via api.php)
 * Uso: node verificar_mysql.cjs
 *
 * Si la API de Dinahosting aún no está desplegada,
 * muestra solo los conteos de Supabase como referencia.
 */

const SUPABASE_URL = 'https://mspejiongrdsgbqomewj.supabase.co';
const SUPABASE_KEY = 'sb_publishable_-_DqtXu-GQ97LecbJgLgqw_ADU_ZMzG';
const MYSQL_API    = process.env.MYSQL_API || '';   // ej: https://adirgestion.app/api/api.php
const MYSQL_KEY    = process.env.MYSQL_KEY || '';

const sbHeaders = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Prefer': 'count=exact',
    'Range': '0-0',
};

// Mapa: nombre Supabase → nombre tabla MySQL (sin prefijo)
const TABLES = [
    { sb: 'propuestas',          mysql: 'propuestas' },
    { sb: 'partidas',            mysql: 'partidas' },
    { sb: 'presupuestos_cliente',mysql: 'presupuestos_cliente' },
    { sb: 'proveedores',         mysql: 'proveedores' },
    { sb: 'solicitudes',         mysql: 'solicitudes' },
    { sb: 'respuestas',          mysql: 'respuestas' },
    { sb: 'historial_cambios',   mysql: 'historial_cambios' },
    { sb: 'base_precios_adir',   mysql: 'base_precios' },
    { sb: 'PreciosCype',         mysql: 'precios_cype' },
];

async function countSB(table) {
    const url = `${SUPABASE_URL}/rest/v1/${table}?select=*&limit=1`;
    try {
        const r = await fetch(url, { headers: sbHeaders });
        const cr = r.headers.get('content-range') || '';
        const n = cr.split('/')[1];
        return n ? parseInt(n) : '?';
    } catch (e) {
        return `ERR: ${e.message.slice(0, 40)}`;
    }
}

async function countMySQL(table) {
    if (!MYSQL_API || !MYSQL_KEY) return '(API no configurada)';
    const url = `${MYSQL_API}/ctcon_${table}?limit=1`;
    try {
        const r = await fetch(url, {
            headers: { 'X-Api-Key': MYSQL_KEY, 'Content-Type': 'application/json' }
        });
        if (!r.ok) return `HTTP ${r.status}`;
        // La API devuelve array; para contar necesitamos endpoint count
        // Por ahora devolvemos '?' — se implementará cuando esté desplegada
        return '(ver phpMyAdmin)';
    } catch (e) {
        return `ERR: ${e.message.slice(0, 40)}`;
    }
}

async function main() {
    console.log('\n🔍 Verificando importación Supabase → MySQL\n');
    console.log('Tabla Supabase'.padEnd(28) + 'Filas Supabase'.padEnd(18) + 'MySQL ctcon_*');
    console.log('─'.repeat(70));

    const results = await Promise.all(TABLES.map(async ({ sb, mysql }) => ({
        sb,
        mysql,
        sbCount:    await countSB(sb),
        mysqlCount: await countMySQL(mysql),
    })));

    for (const { sb, mysql, sbCount, mysqlCount } of results) {
        const match = sbCount === mysqlCount ? '✓' : (mysqlCount === '(ver phpMyAdmin)' ? '?' : '⚠');
        console.log(
            `${match} ${sb.padEnd(27)}${String(sbCount).padEnd(18)}ctcon_${mysql}`
        );
    }

    console.log('\n📊 Conteos Supabase (fuente de verdad):');
    const total = results.reduce((s, r) => s + (typeof r.sbCount === 'number' ? r.sbCount : 0), 0);
    console.log(`   Total filas de negocio (sin precios): ${
        results.filter(r => !['base_precios_adir','PreciosCype'].includes(r.sb))
               .reduce((s, r) => s + (typeof r.sbCount === 'number' ? r.sbCount : 0), 0)
    }`);
    console.log(`   Total con catálogos de precios: ${total.toLocaleString()}`);

    console.log(`\n📌 Para verificar MySQL manualmente en phpMyAdmin:`);
    console.log(`   https://phpadmin.gestiondecuenta.com/52/index.php?route=/database/structure&db=adirg_bbdd`);
    console.log(`   Ejecuta esta query:`);
    console.log(`\n   SELECT 'propuestas' t, COUNT(*) n FROM ctcon_propuestas`);
    console.log(`   UNION SELECT 'partidas',         COUNT(*) FROM ctcon_partidas`);
    console.log(`   UNION SELECT 'presupuestos',      COUNT(*) FROM ctcon_presupuestos_cliente`);
    console.log(`   UNION SELECT 'proveedores',       COUNT(*) FROM ctcon_proveedores`);
    console.log(`   UNION SELECT 'solicitudes',       COUNT(*) FROM ctcon_solicitudes`);
    console.log(`   UNION SELECT 'respuestas',        COUNT(*) FROM ctcon_respuestas`);
    console.log(`   UNION SELECT 'historial',         COUNT(*) FROM ctcon_historial_cambios`);
    console.log(`   UNION SELECT 'precios_adir',      COUNT(*) FROM ctcon_base_precios_adir`);
    console.log(`   UNION SELECT 'precios_cype',      COUNT(*) FROM ctcon_precios_cype;`);
}

main().catch(e => console.error('❌', e.message));
