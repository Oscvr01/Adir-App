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
  const { data, error } = await supabase
    .from('presupuestos_cliente')
    .select('partidas')
    .eq('token', 'e54c4c88-50c5-48ef-a813-3b162e3888f0')
    .single();

  if (error) {
    console.error("Error:", error);
    return;
  }

  console.log("Total items saved in 'partidas' column:", data.partidas.length);
  console.log("First 15 items:");
  console.log(data.partidas.slice(0, 15).map(p => ({
    Capítulo: p.Capítulo || p.Capitulo,
    Descripción: (p.Descripción || p.Descripcion || '').substring(0, 40),
    precio_total_capitulo: p.precio_total_capitulo,
    precio_total_eur: p['Precio Total (€)'],
    Cantidad: p.Cantidad
  })));
}

run();
