const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Manually parse .env
const envPath = path.join(__dirname, '.env');
const envContent = fs.readFileSync(envPath, 'utf-8');
const env = {};
envContent.split('\n').forEach(line => {
  const parts = line.split('=');
  if (parts.length >= 2) {
    const key = parts[0].trim();
    const val = parts.slice(1).join('=').trim().replace(/^['"]|['"]$/g, '');
    env[key] = val;
  }
});

const supabaseUrl = env.VITE_SUPABASE_URL;
const supabaseKey = env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing env variables VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const { data, error } = await supabase.from('presupuestos_cliente').select('*').order('fecha_envio', { ascending: false }).limit(1);
  if (error) {
    console.error("Error:", error);
  } else {
    const d = data[0];
    console.log("ID:", d.id);
    console.log("Cliente:", d.cliente_nombre);
    console.log("Precio Total:", d.precio_total);
    console.log("Partidas count:", d.partidas ? d.partidas.length : 0);
    if (d.partidas) {
      const tasks = d.partidas.filter(p => !p.Capítulo?.endsWith('#'));
      console.log("Number of tasks:", tasks.length);
      console.log("Sample tasks (first 5):");
      tasks.slice(0, 5).forEach((t, idx) => {
        console.log(`Task ${idx}: Capítulo: ${t.Capítulo}, Desc: ${t.Descripción || t.texto_partida}, Cantidad: ${t.Cantidad}, Precio: ${t["Precio Total (€)"]}`);
      });
    }
  }
}

run();
