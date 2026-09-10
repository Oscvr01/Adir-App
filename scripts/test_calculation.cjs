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

const supabase = createClient(supabaseUrl, supabaseKey);

const getTipoFila = (p) => {
    const cap = (p.Capítulo || p.Capitulo || '').trim();
    if (!cap.endsWith('#')) return 'partida';
    const codLimpio = cap.replace(/#$/, '');
    if (codLimpio === '99_EXTRAS') return 'capitulo';
    if (codLimpio.includes('.')) return 'subcapitulo';
    return 'capitulo';
};

const getDescendantPartidas = (parentIdx, allPartidas) => {
    const parent = allPartidas[parentIdx];
    if (!parent) return [];
    const tipo = getTipoFila(parent);
    if (tipo === 'partida') return [];

    const parentClean = (parent.Capítulo || parent.Capitulo || '').replace(/#+$/, '');
    const isExtras = parentClean === '99_EXTRAS';

    return allPartidas.filter((c, idx) => {
        if (getTipoFila(c) !== 'partida') return false;
        if (isExtras) {
            return idx > parentIdx;
        }
        const childCap = (c.Capítulo || c.Capitulo || '').trim();
        return childCap === parentClean || childCap.startsWith(parentClean + '.');
    });
};

async function run() {
  const { data, error } = await supabase.from('presupuestos_cliente')
    .select('*')
    .eq('token', 'e54c4c88-50c5-48ef-a813-3b162e3888f0')
    .single();
    
  if (error) {
    console.error("Error:", error);
    return;
  }
  
  const partidas = data.partidas;
  console.log("Original Partidas length:", partidas.length);

  const testPartidas = partidas.map((p, idx) => {
      const tipoFila = getTipoFila(p);
      if (tipoFila === 'capitulo' || tipoFila === 'subcapitulo') {
          const childs = getDescendantPartidas(idx, partidas);
          const totalCap = childs.reduce((acc, c) => {
              const pUnit = parseFloat(c['Precio Total (€)'] || c.precio || 0);
              const cant  = parseFloat(c.Cantidad || c.cantidad || 0) || 1;
              return acc + (pUnit * cant);
          }, 0);
          return {
              cap: p.Capítulo || p.Capitulo,
              desc: p.Descripción || p.Descripcion,
              tipoFila,
              childsCount: childs.length,
              totalCap
          };
      }
      return null;
  }).filter(Boolean);

  console.log("Calculated chapters:");
  console.log(testPartidas.slice(0, 10));
}

run();
