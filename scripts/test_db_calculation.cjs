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

const calcularTotalCapitulo = (parentIdx, allPartidas) => {
    const childs = getDescendantPartidas(parentIdx, allPartidas);
    return childs.reduce((acc, c) => {
        const pUnit = parseFloat(c['Precio Total (€)'] || 0);
        const cant  = parseFloat(c.Cantidad) || 1;
        return acc + (pUnit * cant);
    }, 0);
};

async function run() {
  const { data, error } = await supabase.from('presupuestos_cliente')
    .select('*')
    .eq('token', '3730023b-eea2-425f-a33c-042cc23cd5f8')
    .single();
    
  if (error) {
    console.error("Error:", error);
    return;
  }
  
  const partidas = data.partidas;
  console.log("Total items for Paco:", partidas.length);
  
  const mapped = partidas.map((p, idx) => {
    const tipoFila = getTipoFila(p);
    const totalCap = (tipoFila === 'capitulo' || tipoFila === 'subcapitulo') ? calcularTotalCapitulo(idx, partidas) : undefined;
    return {
      Cap: p.Capítulo || p.Capitulo,
      tipoFila,
      totalCap,
      precio_total_capitulo: p.precio_total_capitulo
    };
  });
  
  console.log("First 15 items calculation details:");
  console.dir(mapped.slice(0, 15), { depth: null });
}

run();
