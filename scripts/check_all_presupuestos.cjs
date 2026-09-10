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
  const { data, error } = await supabase.from('presupuestos_cliente').select('*');
  if (error) {
    console.error("Error:", error);
    return;
  }
  
  console.log(`Found ${data.length} budgets in database:`);
  for (const row of data) {
    console.log(`\n--- Budget ID: ${row.id} | Token: ${row.token} | Propuesta: ${row.propuesta_id} ---`);
    console.log(`Cliente: ${row.cliente_nombre} | Email: ${row.cliente_email}`);
    console.log(`Total Price: ${row.precio_total}`);
    console.log(`Number of partidas: ${row.partidas ? row.partidas.length : 0}`);
    if (row.partidas && row.partidas.length > 0) {
      console.log("First 3 items in budget:");
      console.log(row.partidas.slice(0, 3).map(p => ({
        Capítulo: p.Capítulo || p.Capitulo,
        Descripción: p.Descripción || p.Descripcion,
        precio_total_capitulo: p.precio_total_capitulo,
        'Precio Total (€)': p['Precio Total (€)'],
        Cantidad: p.Cantidad
      })));
      
      const hasPartidasWithoutHash = row.partidas.some(p => {
        const cap = (p.Capítulo || p.Capitulo || '').trim();
        return !cap.endsWith('#');
      });
      console.log(`Contains items without '#' (meaning they are individual tasks): ${hasPartidasWithoutHash}`);
    }
  }
}

run();
