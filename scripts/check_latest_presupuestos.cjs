const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

let supabaseUrl, supabaseKey;
try {
  const envContent = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  const lines = envContent.split('\n');
  for (const line of lines) {
    const parts = line.split('=');
    if (parts.length >= 2) {
      const key = parts[0].trim();
      const val = parts.slice(1).join('=').trim().replace(/^['"]|['"]$/g, '');
      if (key === 'VITE_SUPABASE_URL') supabaseUrl = val;
      if (key === 'VITE_SUPABASE_ANON_KEY') supabaseKey = val;
    }
  }
} catch (e) {
  console.error("Error reading .env:", e);
}

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing env variables");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const { data, error } = await supabase.from('presupuestos_cliente')
    .select('*')
    .order('fecha_envio', { ascending: false })
    .limit(5);
    
  if (error) {
    console.error("Error:", error);
    return;
  }
  
  console.log(`Retrieved ${data.length} latest budgets:`);
  for (const row of data) {
    console.log(`\nID: ${row.id} | Token: ${row.token} | Cliente: ${row.cliente_nombre} | Envio: ${row.fecha_envio}`);
    const hasPartidasWithoutHash = row.partidas.some(p => {
      const cap = (p.Capítulo || p.Capitulo || '').trim();
      return !cap.endsWith('#');
    });
    console.log(`Partidas count: ${row.partidas.length} | Contains tasks without '#': ${hasPartidasWithoutHash}`);
    if (row.partidas && row.partidas.length > 0) {
      console.log("Sample items (first 5):");
      console.log(row.partidas.slice(0, 5).map(p => ({
        Cap: p.Capítulo || p.Capitulo,
        Desc: (p.Descripción || p.Descripcion || '').substring(0, 30),
        precio_total_capitulo: p.precio_total_capitulo,
        precio_total_eur: p['Precio Total (€)'],
        Cantidad: p.Cantidad
      })));
    }
  }
}

run();
