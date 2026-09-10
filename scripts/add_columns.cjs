// Script para añadir columnas faltantes via API REST de Supabase
// Ejecutar: node add_columns.cjs

const SUPABASE_URL = 'https://mspejiongrdsgbqomewj.supabase.co';
const SUPABASE_KEY = 'sb_publishable_-_DqtXu-GQ97LecbJgLgqw_ADU_ZMzG';

// Con la anon key no podemos hacer DDL, pero intentamos detectar si las columnas existen
// probando un update con valor nulo (si la columna no existe, Supabase devuelve error)

async function checkColumn(table, column) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?limit=1`, {
        headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json'
        }
    });
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
        const exists = column in data[0];
        console.log(`  ${table}.${column}: ${exists ? '✅ existe' : '❌ NO existe'}`);
        return exists;
    }
    console.log(`  ${table}: sin filas para comprobar`);
    return null;
}

async function main() {
    console.log('Comprobando columnas en Supabase...\n');
    await checkColumn('presupuestos_cliente', 'detalles_rechazo');
    await checkColumn('propuestas', 'descripcion');
    console.log('\nSi alguna columna NO existe, añádela manualmente en Supabase Studio:');
    console.log('  https://supabase.com/dashboard/project/mspejiongrdsgbqomewj/editor');
    console.log('\nSQL para ejecutar en el editor:');
    console.log('  ALTER TABLE presupuestos_cliente ADD COLUMN IF NOT EXISTS detalles_rechazo TEXT;');
    console.log('  ALTER TABLE propuestas ADD COLUMN IF NOT EXISTS descripcion TEXT;');
}

main().catch(console.error);
