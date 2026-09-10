const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const envContent = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
let url, key;
envContent.split('\n').forEach(line => {
  const p = line.split('=');
  if(p[0]?.trim() === 'VITE_SUPABASE_URL') url = p.slice(1).join('=').trim().replace(/^['"]|['"]$/g, '');
  if(p[0]?.trim() === 'VITE_SUPABASE_ANON_KEY') key = p.slice(1).join('=').trim().replace(/^['"]|['"]$/g, '');
});

const client = createClient(url, key);
client.from('presupuestos_cliente').select('id, cliente_nombre, partidas').then(({data}) => {
  data.forEach(row => {
    console.log('Client:', row.cliente_nombre, 'Partidas count:', row.partidas.length);
  });
}).catch(console.error);
