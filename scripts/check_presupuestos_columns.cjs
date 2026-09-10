const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Parse .env manually
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
  console.error("Missing env variables VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in App_React/.env");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const { data, error } = await supabase.from('presupuestos_cliente').select('*').limit(1);
  if (error) {
    console.error("Error:", error);
  } else {
    console.log("Keys of a record in presupuestos_cliente table:", data[0] ? Object.keys(data[0]) : "No records found");
  }
}

run();
