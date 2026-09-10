/**
 * Test rápido de la API MySQL en Dinahosting
 * ==========================================
 * USO:
 *   node test_api_mysql.cjs https://TU_DOMINIO/api/api.php
 *
 * Ejemplo:
 *   node test_api_mysql.cjs https://adirgestion.com/api/api.php
 */

const API_URL = process.argv[2];
const API_KEY = '28e9c0b26fbee3225088ab2bd1d889aba39fe2caeee1257700f0ec91184dfa75';

if (!API_URL) {
    console.error('❌ Debes pasar la URL como argumento:');
    console.error('   node test_api_mysql.cjs https://TU_DOMINIO/api/api.php');
    process.exit(1);
}

const h = { 'Content-Type': 'application/json', 'X-Api-Key': API_KEY };

async function get(tabla, params = '') {
    const url = `${API_URL}/${tabla}${params}`;
    const r = await fetch(url, { headers: h });
    const data = await r.json().catch(() => null);
    return { ok: r.ok, status: r.status, data };
}

async function main() {
    console.log(`\n🔍 Testeando API: ${API_URL}\n`);

    // ── 1. Sin clave → debe dar 401 ──────────────────────────────────────────
    const sinClave = await fetch(`${API_URL}/propuestas`, {
        headers: { 'Content-Type': 'application/json' }
    });
    console.log(`[Auth]   Sin X-Api-Key → ${sinClave.status === 401 ? '✅ 401 Unauthorized' : '⚠ ' + sinClave.status}`);

    // ── 2. Tabla inexistente → 404 ───────────────────────────────────────────
    const notFound = await get('tabla_inexistente');
    console.log(`[Router] Tabla inválida  → ${notFound.status === 404 ? '✅ 404 Not found' : '⚠ ' + notFound.status}`);

    // ── 3. Conteos ───────────────────────────────────────────────────────────
    console.log('\n📊 Conteos de tablas:');
    const tablas = [
        { sb: 'propuestas',           esperado: 39 },
        { sb: 'partidas',             esperado: 2916 },
        { sb: 'presupuestos_cliente', esperado: 5 },
        { sb: 'proveedores',          esperado: 11 },
        { sb: 'solicitudes',          esperado: 77 },
        { sb: 'respuestas',           esperado: 10 },
        { sb: 'historial_cambios',    esperado: 2072 },
        { sb: 'PreciosCype',          esperado: 3669 },
    ];

    for (const { sb, esperado } of tablas) {
        const r = await get(sb, '?limit=5000');
        if (!r.ok) {
            console.log(`  ⚠ ${sb.padEnd(25)} ERROR ${r.status}: ${r.data?.error}`);
        } else {
            const n = Array.isArray(r.data) ? r.data.length : '?';
            const ok = n === esperado;
            console.log(`  ${ok ? '✅' : '⚠'} ${sb.padEnd(25)} ${String(n).padEnd(6)} ${ok ? '' : `(esperado: ${esperado})`}`);
        }
    }

    // ── 4. Columnas de propuestas ────────────────────────────────────────────
    console.log('\n🔎 Columnas devueltas por propuestas:');
    const r = await get('propuestas', '?limit=1');
    if (r.ok && Array.isArray(r.data) && r.data.length > 0) {
        const cols = Object.keys(r.data[0]);
        console.log('  ' + cols.join(', '));
        const tieneProyecto = cols.includes('Proyecto');
        const tieneNoId     = !cols.includes('id');  // id numérico oculto
        console.log(`  "Proyecto" presente: ${tieneProyecto ? '✅' : '⚠ FALTA'}`);
        console.log(`  id numérico oculto:  ${tieneNoId ? '✅' : '⚠ visible (revisar api.php)'}`);
    } else {
        console.log('  ⚠ Sin datos o error:', r.data);
    }

    // ── 5. Filtro eq ─────────────────────────────────────────────────────────
    console.log('\n🔎 Test filtro eq (propuestas con estado=En Revisión):');
    const rf = await get('propuestas', '?estado=eq.En Revisión');
    if (rf.ok) {
        console.log(`  ✅ ${Array.isArray(rf.data) ? rf.data.length : 0} proyectos en revisión`);
    } else {
        console.log('  ⚠ Error:', rf.data);
    }

    console.log('\n🎯 Test completo. Si todos los checks son ✅ la API está lista.');
    console.log('\n📌 Próximo paso — Vercel (Settings → Environment Variables):');
    console.log(`   VITE_API_URL = ${API_URL}`);
    console.log(`   VITE_API_KEY = ${API_KEY}`);
}

main().catch(e => console.error('❌ Error fatal:', e.message));
