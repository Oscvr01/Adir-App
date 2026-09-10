// Resetea a 'En Revisión' todos los proyectos en 'En Curso' o 'Finalizado'
// que ya no tienen registro en presupuestos_cliente.
// Ejecutar: node reset_proyectos_sin_presupuesto.cjs

const SUPABASE_URL = 'https://mspejiongrdsgbqomewj.supabase.co';
const SUPABASE_KEY = 'sb_publishable_-_DqtXu-GQ97LecbJgLgqw_ADU_ZMzG';

const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
};

async function get(table, params = '') {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${params}`, { headers });
    return res.json();
}

async function patch(table, params, body) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${params}`, {
        method: 'PATCH',
        headers: { ...headers, 'Prefer': 'return=representation' },
        body: JSON.stringify(body)
    });
    return res.json();
}

async function main() {
    console.log('🔍 Buscando proyectos "En Curso" o "Finalizado"...');

    // 1. Proyectos activos en propuestas
    const propuestas = await get('propuestas',
        '?estado=in.("En Curso","Finalizado")&select=Proyecto,cliente,estado'
    );
    if (!Array.isArray(propuestas) || propuestas.length === 0) {
        console.log('✅ No hay proyectos "En Curso" ni "Finalizado". Nada que resetear.');
        return;
    }
    console.log(`  → ${propuestas.length} proyecto(s) encontrados.`);

    // 2. IDs con presupuesto activo en presupuestos_cliente
    const presupuestos = await get('presupuestos_cliente', '?select=propuesta_id');
    const idsConPresupuesto = new Set(
        Array.isArray(presupuestos) ? presupuestos.map(p => p.propuesta_id) : []
    );
    console.log(`  → ${idsConPresupuesto.size} presupuesto(s) en BD.`);

    // 3. Filtrar los que YA NO tienen presupuesto
    const aResetear = propuestas.filter(p => !idsConPresupuesto.has(p.Proyecto));

    if (aResetear.length === 0) {
        console.log('✅ Todos los proyectos activos tienen presupuesto. Nada que resetear.');
        return;
    }

    console.log(`\n⚠️  ${aResetear.length} proyecto(s) sin presupuesto — se resetearán a "En Revisión":`);
    aResetear.forEach(p => console.log(`   • ${p.Proyecto} [${p.estado}] — ${p.cliente || 'sin cliente'}`));

    // 4. Resetear uno a uno
    let ok = 0, err = 0;
    for (const p of aResetear) {
        const result = await patch(
            'propuestas',
            `?Proyecto=eq.${encodeURIComponent(p.Proyecto)}`,
            { estado: 'En Revisión' }
        );
        if (Array.isArray(result) && result.length > 0) {
            console.log(`   ✅ Reseteado: ${p.Proyecto}`);
            ok++;
        } else {
            console.log(`   ❌ Error reseteando: ${p.Proyecto}`, result);
            err++;
        }
    }

    console.log(`\n🏁 Listo. ${ok} reseteados, ${err} errores.`);
}

main().catch(console.error);
