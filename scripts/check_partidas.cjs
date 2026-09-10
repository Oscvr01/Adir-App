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

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const { data, error } = await supabase
    .from('partidas')
    .select('*')
    .eq('propuesta_id', 'REFORMA_OFICINA_CARTAGENA_1779434917')
    .limit(10);
  if (error) {
    console.error("Error:", error);
  } else {
    console.log("Raw partidas in DB (first 10):");
    data.forEach((p, idx) => {
      console.log(`Row ${idx}: ID: ${p.id}, texto_partida: ${p.texto_partida}, precio_base_estimado: ${p.precio_base_estimado}, precio_adjudicado: ${p.precio_adjudicado}, cantidad: ${p.cantidad}`);
    });
  }
}

run();
