import{s as P}from"./index-BcwgnbtC.js";const w=["Albañilería","Carpintero","Climatización","Cristalería","Electricista","Fontanería","Movimiento de Tierras","Pintor"],k=t=>t?t.replace(/_\d{8,}.*$/,"").replace(/_\d+$/,"").replace(/_/g," ").trim():"",D=15,R=1,$=t=>new Promise(u=>setTimeout(u,t)),q=async t=>{try{if(!t||t.length<5)return{context:"",unidad:null};const u=t.substring(0,20),{data:p}=await P.from("partidas").select("texto_partida, precio_adjudicado, unidad").ilike("texto_partida",`%${u}%`).gt("precio_adjudicado",0).limit(2);if(!p||p.length===0)return{context:"",unidad:null};const i=p.find(m=>m.unidad)?.unidad||null;return{context:p.map(m=>`- [HISTÓRICO REAL]: ${m.texto_partida} (Adjudicado por ${m.precio_adjudicado}€)`).join(`
`),unidad:i}}catch{return{context:"",unidad:null}}},N=async t=>{try{if(!t||t.length<4)return"";const u=t.split("::").pop().split(" ").filter(i=>i.length>3).slice(0,3).join("%"),{data:p}=await P.from("PreciosCype").select("codigo, categoria, unidad, descripcion_corta, precio_total, mano_de_obra, materiales, maquinaria").or(`descripcion_corta.ilike.%${u}%,descripcion_detallada.ilike.%${u}%`).limit(3);return!p||p.length===0?"Sin referencias exactas.":p.map(i=>`- [CYPE ${i.codigo}] (${i.categoria}): ${i.descripcion_corta}. PVP:${i.precio_total}€/${i.unidad}. (MO:${i.mano_de_obra}€, Mat:${i.materiales}€, Maq:${i.maquinaria}€)`).join(`
`)}catch{return"Error de consulta."}},T=async t=>{try{if(!t||t.length<4)return"";const u=t.split("::")[0].trim(),p=t.split("::").pop().trim(),{data:i}=await P.from("base_precios_adir").select("codigo, descripcion_corta, precio_total, unidad, mano_de_obra, materiales_y_otros").or(`codigo.eq.${u},descripcion_corta.ilike.%${p.substring(0,20)}%`).limit(2);return!i||i.length===0?"":i.map(n=>`- [BASE PROPIA]: ${n.descripcion_corta} (${n.codigo}). Precio: ${n.precio_total}€/${n.unidad}. (MO: ${n.mano_de_obra}€, Otros: ${n.materiales_y_otros}€)`).join(`
`)}catch{return""}},M=async(t,u,p)=>{const i=w.join(", ");let n=localStorage.getItem("groq_api_key");if(!n||n.length<10)try{const{data:a}=await P.from("configuracion").select("valor").eq("clave","groq_api_key").maybeSingle();a?.valor&&a.valor.length>10&&(n=a.valor,localStorage.setItem("groq_api_key",n))}catch{}if(!n||n.length<10)throw new Error("API Key no configurada. Ve a Ajustes para añadirla.");const m=t.filter(a=>!(a.Capítulo||a.Capitulo||"").endsWith("#")).map((a,A)=>({id:a.id||a.Capítulo||a.Capitulo||a.texto_partida||`partida_${A}`,cap:a.Capítulo||a.Capitulo||"S/C",desc:(a.Descripción||a.Descripcion||a.texto_partida||"").toString().trim(),unidad:a["Unidad IA"]||a.unidad||""}));if(m.length===0)return{asignaciones:{},sinProveedor:[]};const b={},C=[];for(let a=0;a<m.length;a+=D)C.push(m.slice(a,a+D));const x=async a=>{const A=a.map(async r=>{const[S,l,s]=await Promise.all([T(r.desc),q(r.desc),N(r.desc)]),e=r.unidad||l.unidad||null,c=!!e;let o="";S&&(o+=`
BASE DE PRECIOS PROPIA (PRIORIDAD ALTA):
${S}`),l.context&&(o+=`
DATOS HISTÓRICOS ADJUDICADOS:
${l.context}`),o+=`
DATOS CYPE MURCIA:
${s}`;const d=e?`
UNIDAD: ${e}`:"";return{contextStr:`TAREA ID: ${r.id}
DESCRIPCIÓN: ${r.desc}${d}
${o}`,unidad:e,tieneUnidadPrevia:c}}),E=await Promise.all(A),_=`Eres Auditor de Costos de Construcción 2026. Valora estas TAREAS de obra.

REGLAS PARA ASIGNAR PRECIO (ORDEN DE PRIORIDAD):
1. BASE PROPIA OFICIAL: Si existe dato "BASE DE PRECIOS PROPIA", úsalo como PRECIO BASE. Es la referencia interna prioritaria.
2. HISTÓRICO REAL: Si no hay base propia pero hay "HISTÓRICOS ADJUDICADOS", úsalos como precio.
3. CYPE MURCIA: Solo como referencia de mercado si no hay datos internos.
4. Si ninguna fuente tiene dato, estima el precio razonable para Murcia 2026.

REGLAS PARA ASIGNAR OFICIO (lista OFICIOS POSIBLES):
1. Elige SIEMPRE uno de los oficios listados en "OFICIOS POSIBLES" (que son los únicos que tienen proveedores disponibles actualmente). Reparte las partidas mapeándolas al oficio disponible más compatible.
2. Albañilería: albañil, tabique, ladrillo, mortero, enlucido, revoco, yeso, escayola, falso techo, pladur, demolición, derribar, desmontaje, desescombro, limpieza de obra, solados, alicatados, pavimentos, azulejos, baldosas, gres, cerámica, porcelánico.
3. Carpintero: carpintero, puertas, cercos, muebles, armarios, marcos, ventanas de madera o aluminio/PVC, persianas, tarima, parquet, cerrajería, rejas, barandillas, trabajos en metal/acero/aluminio.
4. Electricista: electricista, cable, cableado, cuadro eléctrico, enchufe, interruptor, luminaria, luces, tira led, instalación eléctrica, telecomunicaciones.
5. Fontanería: fontanero, fontanería, tubería, desagüe, PVC, grifo, sanitario, lavabo, inodoro, plato de ducha, bañera, grifería, termos, calentadores.
6. Climatización: climatización, aire acondicionado, conductos, rejillas, split, calefacción, caldera, radiador, bomba de calor, ventilación.
7. Pintor: pintor, pintura, pintar, alisado, masilla, gotelé, lijado, imprimación, barniz, lacado, esmalte.
8. Movimiento de Tierras: excavación, desbroce, vaciado, zanja, desmonte, desescombro con maquinaria, movimiento de tierras, relleno, nivelación, compactación.
9. Cristalería: cristalero, vidrios, cristales, acristalamiento, mamparas de baño, espejos, lunas.

OFICIOS POSIBLES: ${i}

REGLAS PARA ASIGNAR UNIDAD DE MEDIDA:
- Si la tarea YA tiene campo "UNIDAD:" → devuelve unidad: null (no la toques).
- Si la tarea NO tiene campo "UNIDAD:" → elige la unidad más apropiada según la descripción:
  m2 = superficies (pintura, alicatado, solado, falso techo, trasdosado...)
  ml = longitudes lineales (rodapié, canalón, tira led, conducto...)
  m3 = volúmenes (excavación, hormigón, relleno...)
  ud = unidades completas (sanitario, puerta, luminaria, cuadro, split...)
  pa = partida alzada (instalación completa, medios auxiliares, gestión...)
  h  = horas de trabajo (trabajos extra, jornadas...)
  kg = peso (acero, ferralla...)

Responde ÚNICAMENTE con la estructura JSON exacta (sin bloques de código markdown ni texto adicional):
{
  "asignaciones": {
    "ID_EJEMPLO": {
      "oficio": "Albañilería",
      "precio": 25.50,
      "unidad": "m2",
      "justificacion": "Estimación de mercado"
    }
  }
}

PAQUETE DE EVALUACIÓN:
${E.map(r=>r.contextStr).join(`

---

`)}`;let g,O=5,I=0,h="openai/gpt-oss-120b";for(;I<=O;)if(g=await fetch("https://api.groq.com/openai/v1/chat/completions",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${n}`},body:JSON.stringify({model:h,messages:[{role:"system",content:"You are a JSON generator. You MUST respond ONLY with a raw, valid JSON object without markdown formatting or introductory text."},{role:"user",content:_}],temperature:.1,response_format:{type:"json_object"}})}),g.status===429){if(I++,I>O)break;const r=Math.min(3e4,3e3*Math.pow(2,I-1));console.warn(`[Groq AI] Rate limit (429) alcanzado. Reintentando en ${r/1e3}s (Intento ${I}/${O})...`),await $(r)}else if(!g.ok&&h!=="openai/gpt-oss-20b")console.warn(`[Groq AI] Error con ${h} (${g.status}). Cambiando a modelo de respaldo openai/gpt-oss-20b...`),h="openai/gpt-oss-20b",I++,await $(1e3);else break;if(g.ok){let S=(await g.json()).choices?.[0]?.message?.content||"{}";S=S.replace(/```json/gi,"").replace(/```/g,"").trim();let l={};try{l=JSON.parse(S)}catch(e){console.warn("[Groq AI] JSON parse error:",e)}let s=l.asignaciones||l.tareas||l.partidas;if(!s){const e=Object.keys(l);e.length===1&&typeof l[e[0]]=="object"&&l[e[0]]!==null?s=l[e[0]]:s=l}if(Array.isArray(s)){const e={};s.forEach((c,o)=>{if(c&&typeof c=="object"){const d=c.id||c.ID||c.tarea_id||c.tarea||c.codigo;d&&(e[d]=c),e[o]=c}}),s=e}a.forEach((e,c)=>{let o=s[e.id];if(!o){const d=Object.keys(s).find(f=>f.includes(e.id)||e.id.includes(f)||e.cap&&(f.includes(e.cap)||e.cap.includes(f)));d&&(o=s[d])}if(!o&&Object.keys(s).length===a.length){const d=Object.keys(s)[c];o=s[d]}if(o&&o.oficio&&o.oficio!=="Sin asignar"){const d=E[c],f=d.tieneUnidadPrevia?d.unidad:o.unidad&&o.unidad!=="null"?o.unidad:null,v=!d.tieneUnidadPrevia&&!!f,y={oficio:o.oficio,precio:Number(o.precio)||0,unidad:f,unidad_por_ia:v,justificacion:o.justificacion||"S/Ref",needsQuote:o.precio===0};b[e.id]=y,e.cap&&(b[e.cap]=y),e.cap&&typeof e.cap=="string"&&(b[e.cap.replace(/#$/,"")]=y)}})}else{const r=await g.text();throw g.status===429?new Error("Límite de peticiones de Groq alcanzado (Rate Limit 429). La cuota gratuita requiere esperar unos segundos. Vuelve a intentarlo en 1 minuto."):new Error(`Groq API Error (${g.status}): ${r}`)}};let j=0;for(let a=0;a<C.length;a+=R){const A=C.slice(a,a+R);await Promise.all(A.map(x)),j+=A.reduce((E,_)=>E+_.length,0),p?.({status:"progress",progress:Math.round(j/m.length*100)}),a+R<C.length&&await $(2500)}return{asignaciones:b,sinProveedor:[]}};export{w as T,M as a,k as g};
