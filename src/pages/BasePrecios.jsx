import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../utils/supabaseClient';
import { formatDecimal, parseDecimal } from '../utils/format';
import { useModal, useToast } from '../utils/useModal';
import {
  Search, Save, FileUp, Loader2, Database, TableProperties,
  X, CheckCircle, AlertCircle, Upload, Info, FileText, AlertTriangle
} from 'lucide-react';
import { bc3ToBasePrecios, getRatio } from '../utils/bc3ToBasePrecios';
import { extraerPartidasDePDF, extraerPartidasDePDFConIA } from '../utils/pdfExtractor';
import { detectarSimilares, detectarDuplicadosInternos } from '../utils/similarityUtils';

// ── Clasificación client-side ──────────────────────────────────────────────────
// Misma jerarquía que bc3ToBasePrecios.clasificarTipo — se mantienen sincronizadas.
// 'ud'/'u' NO se usan como indicador temprano de material (son ambiguas).
const UNIDADES_MAT_PURAS = new Set(['kg','g','tn','l','lt','saco','pack','palet','rollo','bob','lam','bl','bote','caja','juego','set','pieza','pz']);
const UNIDADES_TRAB = new Set(['m2','m²','m3','m³','ml','h','jorn','pa','m']);

const KWTRAB = [
  'instalac','montaje','colocac','demolicion','excavac','derribo','levantado',
  'enfoscado','alicatado','solado','pintado','tendido','ejecucion','encofrado',
  'hormigonado','ferrallado','replanteo','impermeabilizac','aislamiento aplicado',
  'suministro e instalac','reform','rehabilitac','saneamiento de','urbanizac',
  'construccion','trasdosado','tabicado','forrado','revoco','guarnecido','enlucido',
  'chapado','preparacion de','reparacion','tratamiento de','aplicacion de',
  'puesta en obra','formacion de','desmontaje','reconstruccion','reposicion',
  'canalizacion','tendido de','recibido de','sellado de','rejuntado',
];
const KWMAT = [
  'cemento','arena ','grava','mortero seco','yeso','escayola','cal ',
  'silicona ','adhesivo ','cola de','barniz ','disolvente','imprimacion',
  'saco de','kg de','litro de','tablero ','panel ','chapa ','lamina ',
  'perfil ','tubo de ','cable de ','conductor ','tornillo','perno ','anclaje ',
  'ladrillo','baldosa','azulejo','gres ','porcelanato','teja ','pizarra ',
  'pintura ','esmalte ','sellador','malla ','fibra ','espuma ',
  'lana de roca','lana mineral','poliestireno','poliuretano','corcho ',
  'madera ','tablero de','placa de','pladur','carton yeso',
  'acero ','hierro ','aluminio ','cobre ','pvc ','polietileno',
];

function normDesc(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function inferirTipoPartida(item) {
  if (!item) return 'desconocido';
  // Columna DB tiene prioridad absoluta
  if (item.tipo_partida && item.tipo_partida !== 'desconocido') return item.tipo_partida;
  if (item.tipo === 'Capítulo') return 'capitulo';

  const cod  = (item.codigo || '').toUpperCase();
  const desc = normDesc((item.descripcion_corta || '') + ' ' + (item.tags || ''));
  const ud   = normDesc(item.unidad).trim();
  const mo   = parseFloat(item.mano_de_obra)   || 0;
  const p    = parseFloat(item.precio_total)   || 0;

  // 1. Prefijos BC3
  if (/^(MO[O]?|MANO)/.test(cod)) return 'mano_de_obra';
  if (/^(MQ|MAQ)/.test(cod))      return 'maquinaria';
  if (/^(MT|MAT|MA\d|AU|AUX)/.test(cod)) return 'material';

  // 2. Recursos por descripción
  if (/^(oficial|peon|ayudante|operari|capataz|encargado|albanil|fontanero|electricista|pintor)\b/.test(desc))
    return 'mano_de_obra';

  // 3. MO >= 15 % → trabajo
  if (p > 0 && mo > 0 && (mo / p) >= 0.15) return 'trabajo';

  // 4. Keywords ejecución → trabajo (ANTES de unidades)
  if (KWTRAB.some(kw => desc.includes(kw))) return 'trabajo';

  // 5. Keywords producto → material
  if (KWMAT.some(kw => desc.includes(kw))) return 'material';

  // 6. Unidades de trabajo → trabajo
  if (UNIDADES_TRAB.has(ud)) return 'trabajo';

  // 7. Unidades inequívocas de material → material
  if (UNIDADES_MAT_PURAS.has(ud)) return 'material';

  // 8. Ambigua 'ud'/'u': precio > 100 € → trabajo
  if (ud === 'ud' || ud === 'u') return p > 100 ? 'trabajo' : 'material';

  return 'partida';
}

// Colores y etiquetas para tipo_partida
const TIPO_CONFIG = {
  material:     { label: 'Material',    bg: '#dbeafe', color: '#1d4ed8' },
  trabajo:      { label: 'Trabajo',     bg: '#dcfce7', color: '#15803d' },
  mano_de_obra: { label: 'Mano Obra',   bg: '#fce7f3', color: '#be185d' },
  maquinaria:   { label: 'Maquinaria',  bg: '#ede9fe', color: '#7c3aed' },
  auxiliar:     { label: 'Auxiliar',    bg: '#fef9c3', color: '#a16207' },
  capitulo:     { label: 'Capítulo',    bg: '#f3f4f6', color: '#6b7280' },
  partida:      { label: 'Partida',     bg: '#f3f4f6', color: '#6b7280' },
  desconocido:  { label: '?',           bg: '#f3f4f6', color: '#6b7280' },
};

function TipoBadge({ tipo }) {
  const cfg = TIPO_CONFIG[tipo] || TIPO_CONFIG.desconocido;
  return (
    <span style={{ background: cfg.bg, color: cfg.color, padding: '2px 8px',
      borderRadius: '20px', fontSize: '0.72rem', fontWeight: 600, whiteSpace: 'nowrap' }}>
      {cfg.label}
    </span>
  );
}

const PAGE_SIZE    = 50;
const UPSERT_BATCH = 200;

// ── Helpers ───────────────────────────────────────────────────────────────────

function readFileAsLatin1(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = e => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsText(file, 'windows-1252');
  });
}

function scoreColor(score) {
  if (score >= 0.8) return '#ef4444';  // rojo → casi idéntico
  if (score >= 0.65) return '#f59e0b'; // naranja → similar
  return '#22c55e';                    // verde → diferente
}

function scoreLabel(tipo, score) {
  if (tipo === 'igual') return `Muy similar (${Math.round(score * 100)}%)`;
  return `Posible duplicado (${Math.round(score * 100)}%)`;
}

// ── Modal de importación (BC3 y PDF) ─────────────────────────────────────────

function ModalImport({ onClose, onImportDone, showToast }) {
  // Pasos: 'tipo' → 'drop' → 'parsing' → 'similares' → 'preview' → 'importing' → 'done'
  const [step, setStep]             = useState('drop'); // skip 'tipo', elegir en drop zone
  const [fileType, setFileType]     = useState(null);   // 'bc3' | 'pdf'
  const [dragging, setDragging]     = useState(false);
  const [parsing, setParsing]       = useState(false);
  const [error, setError]           = useState('');
  const [partidas, setPartidas]     = useState([]); // partidas parseadas brutas
  const [conMatch, setConMatch]     = useState([]); // partidas + campo match
  const [decisions, setDecisions]   = useState({}); // idx → 'crear'|'actualizar'|'ignorar'
  const [importing, setImporting]   = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importStats, setImportStats] = useState(null);
  const [aiProgress, setAiProgress] = useState(0);
  const [usingAI, setUsingAI]       = useState(false);
  const inputRef = useRef(null);

  // ── Manejo de archivo ─────────────────────────────────────────────────────

  const handleFile = useCallback(async (file) => {
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext !== 'bc3' && ext !== 'pdf') {
      setError('Selecciona un archivo .bc3 o .pdf');
      return;
    }
    setError('');
    setFileType(ext);
    setParsing(true);
    setStep('parsing');

    try {
      let filas = [];

      if (ext === 'bc3') {
        const text = await readFileAsLatin1(file);
        filas = bc3ToBasePrecios(text);
      } else {
        // PDF — intentar con Mistral IA, fallback a heurístico
        let apiKey = localStorage.getItem('mistral_api_key');
        if (!apiKey || apiKey.length < 10) {
          try {
            const { data: cfgData } = await supabase
              .from('configuracion').select('valor')
              .eq('clave', 'mistral_api_key').maybeSingle();
            if (cfgData?.valor && cfgData.valor.length > 10) {
              apiKey = cfgData.valor;
              localStorage.setItem('mistral_api_key', apiKey);
            }
          } catch (_) {}
        }

        let raw;
        if (apiKey && apiKey.length > 10) {
          setUsingAI(true);
          setAiProgress(0);
          raw = await extraerPartidasDePDFConIA(file, apiKey, pct => setAiProgress(pct));
          setUsingAI(false);
        } else {
          raw = await extraerPartidasDePDF(file);
        }

        if (raw.length === 0) {
          setError('No se encontraron partidas con precio en el PDF. Asegúrate de que no está escaneado como imagen.');
          setStep('drop');
          setParsing(false);
          return;
        }
        // Extraer nombre del proveedor del nombre del archivo
        const proveedor = (() => {
          const nombre = file.name.replace(/\.pdf$/i, '');
          const limpio = nombre
            .replace(/^(tarifa\s+de?\s*|lista\s+de?\s*precios?\s*|catalogo\s*|precio[s]?\s+)/i, '')
            .replace(/\s*[-–]\s*(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s*\d{4}/i, '')
            .replace(/\s+\d{4}[-/]?\d*\s*$/, '')
            .trim();
          return limpio.split(/[\s_]+/).filter(w => w.length > 0).slice(0, 3)
            .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ') || 'Importado PDF';
        })();

        // Para PDF: completar con estimación de desglose
        filas = raw.map(p => {
          const ratio = getRatio(p.descripcion_corta);
          return {
            codigo:            null,
            categoria:         proveedor,
            fuente:            proveedor,
            tipo_partida:      'material',
            descripcion_corta: p.descripcion_corta,
            unidad:            p.unidad,
            precio_total:      p.precio_total,
            mano_de_obra:      parseFloat((p.precio_total * ratio.mo).toFixed(4)),
            materiales_y_otros: parseFloat((p.precio_total * ratio.mat).toFixed(4)),
            maquinaria:        parseFloat((p.precio_total * ratio.maq).toFixed(4)),
            desglose_estimado: true,
          };
        });
      }

      if (filas.length === 0) {
        setError('No se encontraron partidas válidas en el archivo.');
        setStep('drop');
        return;
      }

      // Detectar duplicados internos (dentro del mismo archivo)
      const dupesInternos = detectarDuplicadosInternos(filas);
      const filasUnicas = filas.filter((_, i) => !dupesInternos.has(i));

      // Comparar con base de datos existente
      const { data: existentes = [] } = await supabase
        .from('base_precios_adir')
        .select('id, codigo, descripcion_corta, precio_total, categoria')
        .limit(5000);

      const conMatchArr = detectarSimilares(filasUnicas, existentes || []);
      setPartidas(filasUnicas);
      setConMatch(conMatchArr);

      // Decisiones iniciales automáticas
      const dec = {};
      conMatchArr.forEach((p, i) => {
        if (!p.match) dec[i] = 'crear';
        else if (p.match.tipo === 'igual') dec[i] = 'actualizar';
        else dec[i] = 'crear'; // similares → dejar que el usuario decida
      });
      setDecisions(dec);

      setStep('similares');
    } catch (e) {
      console.error(e);
      setError('Error al procesar el archivo: ' + e.message);
      setStep('drop');
    } finally {
      setParsing(false);
    }
  }, []);

  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    handleFile(e.dataTransfer.files[0]);
  };

  // ── Importar ──────────────────────────────────────────────────────────────

  const handleImport = async () => {
    setImporting(true);
    setImportProgress(0);
    let creadas = 0, actualizadas = 0, ignoradas = 0, errores = 0;

    const toCreate  = conMatch.filter((_, i) => decisions[i] === 'crear');
    const toUpdate  = conMatch.filter((_, i) => decisions[i] === 'actualizar');
    ignoradas       = conMatch.filter((_, i) => decisions[i] === 'ignorar').length;

    const total = toCreate.length + toUpdate.length;
    let done = 0;

    // ── Crear nuevas (upsert por descripcion_corta si no tienen código) ──
    for (let i = 0; i < toCreate.length; i += UPSERT_BATCH) {
      const lote = toCreate.slice(i, i + UPSERT_BATCH).map(({ desglose_estimado, match, pagina, ...rest }) => {
        // Si es PDF sin código, generar uno provisional con suficiente entropía
        // para evitar colisiones en imports grandes (paradoja del cumpleaños).
        if (!rest.codigo) {
          const uuid = (typeof crypto !== 'undefined' && crypto.randomUUID)
            ? crypto.randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()
            : (Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-6)).toUpperCase();
          rest.codigo = 'PDF_' + uuid;
        }
        return rest;
      });
      try {
        const { error } = await supabase.from('base_precios_adir').upsert(lote, { onConflict: 'codigo' });
        if (error) { errores += lote.length; console.error(error); }
        else creadas += lote.length;
      } catch (e) { errores += lote.length; }
      done += lote.length;
      setImportProgress(Math.round((done / total) * 100));
    }

    // ── Actualizar precio en existentes ──────────────────────────────────
    for (const p of toUpdate) {
      try {
        const { error } = await supabase
          .from('base_precios_adir')
          .update({
            precio_total:      p.precio_total,
            mano_de_obra:      p.mano_de_obra,
            materiales_y_otros: p.materiales_y_otros,
            maquinaria:        p.maquinaria,
          })
          .eq('id', p.match.existente.id);
        if (error) { errores++; console.error('[BasePrecios] update error:', error); }
        else actualizadas++;
      } catch (e) { errores++; console.error('[BasePrecios] update exception:', e); }
      done++;
      setImportProgress(Math.round((done / total) * 100));
    }

    setImporting(false);
    setImportStats({ creadas, actualizadas, ignoradas, errores });
    setStep('done');
    if (errores === 0) showToast(`✓ ${creadas} creadas, ${actualizadas} actualizadas.`);
    else showToast(`Importación con ${errores} errores.`, 'error');
    onImportDone();
  };

  // ── Estadísticas de similares ─────────────────────────────────────────────
  const numIguales  = conMatch.filter(p => p.match?.tipo === 'igual').length;
  const numSimilar  = conMatch.filter(p => p.match?.tipo === 'similar').length;
  const numNuevas   = conMatch.filter(p => !p.match).length;

  // ── Render ────────────────────────────────────────────────────────────────

  const overlayStyle = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
    zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px',
  };
  const boxStyle = {
    background: 'white', borderRadius: '16px', padding: '28px',
    maxWidth: '820px', width: '100%', maxHeight: '92vh', overflowY: 'auto',
    boxShadow: '0 24px 64px rgba(0,0,0,0.45)',
  };

  return createPortal(
    <div style={overlayStyle} onClick={e => e.target === e.currentTarget && !importing && onClose()}>
      <div style={boxStyle}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '22px' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.35rem' }}>Importar a Base de Precios</h2>
            <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
              Sube un archivo <strong>.bc3</strong> (FIEBDC) o un <strong>.pdf</strong> de tarifa de precios
            </p>
          </div>
          {!importing && (
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '4px' }}>
              <X size={20} />
            </button>
          )}
        </div>

        {/* ── DROP ZONE ── */}
        {step === 'drop' && (
          <>
            <div
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => inputRef.current?.click()}
              style={{
                border: `2px dashed ${dragging ? 'var(--primary)' : 'var(--border-color)'}`,
                borderRadius: '12px', padding: '52px 24px', textAlign: 'center',
                cursor: 'pointer', transition: 'all 0.2s',
                background: dragging ? 'var(--primary-light)' : 'transparent',
              }}
            >
              <Upload size={44} style={{ color: dragging ? 'var(--primary)' : 'var(--text-muted)', marginBottom: '14px' }} />
              <p style={{ margin: 0, fontWeight: 600, fontSize: '1.1rem' }}>Arrastra tu archivo aquí</p>
              <p style={{ margin: '8px 0 0', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
                o haz clic para seleccionarlo
              </p>
              <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', marginTop: '18px' }}>
                <TypeBadge icon={<FileText size={14} />} label=".BC3" desc="FIEBDC-3" color="var(--primary)" />
                <TypeBadge icon={<FileText size={14} />} label=".PDF" desc="Tarifa de precios" color="#f59e0b" />
              </div>
              <input ref={inputRef} type="file" accept=".bc3,.pdf" style={{ display: 'none' }}
                onChange={e => handleFile(e.target.files[0])} />
            </div>
            {error && <ErrorBanner msg={error} />}
          </>
        )}

        {/* ── PARSING ── */}
        {step === 'parsing' && (
          <div style={{ textAlign: 'center', padding: '52px 0' }}>
            <Loader2 size={38} className="loader-spinner" style={{ display: 'inline-block', marginBottom: '14px' }} />
            {usingAI ? (
              <>
                <p style={{ color: 'var(--text-muted)', margin: 0, fontWeight: 600 }}>
                  Analizando PDF con Mistral IA…
                </p>
                <div style={{ width: '220px', margin: '14px auto 0', background: '#e5e7eb', borderRadius: '99px', height: '8px' }}>
                  <div style={{ width: `${aiProgress}%`, background: 'var(--primary)', height: '8px', borderRadius: '99px', transition: 'width 0.4s' }} />
                </div>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '8px' }}>
                  {aiProgress}% — identificando precios y unidades…
                </p>
              </>
            ) : (
              <>
                <p style={{ color: 'var(--text-muted)', margin: 0 }}>
                  {fileType === 'pdf' ? 'Extrayendo partidas del PDF…' : 'Analizando archivo BC3…'}
                </p>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '6px' }}>
                  Comparando con {'>'}5.000 partidas existentes…
                </p>
              </>
            )}
          </div>
        )}

        {/* ── REVISIÓN DE SIMILARES ── */}
        {step === 'similares' && (
          <>
            {/* Stats row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginBottom: '18px' }}>
              <StatCard label="Nuevas"       value={numNuevas}  color="#22c55e" sub="se añadirán" />
              <StatCard label="Muy similares" value={numIguales} color="#ef4444" sub="actualizar precio" />
              <StatCard label="Parecidas"     value={numSimilar} color="#f59e0b" sub="revisa manualmente" />
            </div>

            {/* Aviso si hay similares */}
            {(numIguales + numSimilar) > 0 && (
              <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '12px 14px',
                background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.25)',
                borderRadius: '10px', marginBottom: '14px' }}>
                <AlertTriangle size={16} style={{ color: '#f59e0b', marginTop: '2px', flexShrink: 0 }} />
                <p style={{ margin: 0, fontSize: '0.83rem', color: 'var(--text-secondary)' }}>
                  Se han detectado partidas similares a las ya existentes. Decide para cada una si
                  <strong> actualizar el precio</strong> en la base, <strong>crear nueva entrada</strong> o <strong>ignorar</strong>.
                </p>
              </div>
            )}

            {/* Tabla de revisión */}
            <div style={{ maxHeight: '380px', overflowY: 'auto', borderRadius: '8px',
              border: '1px solid var(--border-color)', marginBottom: '18px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-secondary)', zIndex: 1 }}>
                  <tr>
                    <th style={th}>Nueva partida</th>
                    <th style={th}>Precio</th>
                    <th style={th}>Similar existente</th>
                    <th style={th}>Coincidencia</th>
                    <th style={th}>Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {conMatch.map((p, i) => (
                    <tr key={i} style={{ borderTop: '1px solid var(--border-color)',
                      background: decisions[i] === 'ignorar' ? 'rgba(100,100,100,0.05)' : undefined,
                      opacity: decisions[i] === 'ignorar' ? 0.5 : 1 }}>
                      <td style={{ ...td, maxWidth: '200px' }}>
                        <div style={{ fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                          title={p.descripcion_corta}>{p.descripcion_corta}</div>
                        <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)' }}>{p.unidad} · {p.categoria}</div>
                      </td>
                      <td style={{ ...td, fontWeight: 700, color: 'var(--primary)', whiteSpace: 'nowrap' }}>
                        {p.precio_total?.toFixed(2)} €
                      </td>
                      <td style={{ ...td, maxWidth: '180px' }}>
                        {p.match ? (
                          <>
                            <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: '0.78rem' }}
                              title={p.match.existente.descripcion_corta}>{p.match.existente.descripcion_corta}</div>
                            <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)' }}>
                              Precio actual: {p.match.existente.precio_total} €
                            </div>
                          </>
                        ) : (
                          <span style={{ color: '#22c55e', fontSize: '0.78rem' }}>— Nueva —</span>
                        )}
                      </td>
                      <td style={td}>
                        {p.match ? (
                          <span style={{ background: scoreColor(p.match.score) + '22',
                            color: scoreColor(p.match.score), padding: '2px 8px',
                            borderRadius: '20px', fontSize: '0.73rem', fontWeight: 600, whiteSpace: 'nowrap' }}>
                            {scoreLabel(p.match.tipo, p.match.score)}
                          </span>
                        ) : (
                          <span style={{ color: '#22c55e', fontSize: '0.73rem' }}>Nueva</span>
                        )}
                      </td>
                      <td style={td}>
                        <select
                          value={decisions[i]}
                          onChange={e => setDecisions(d => ({ ...d, [i]: e.target.value }))}
                          style={{ fontSize: '0.78rem', padding: '3px 6px', borderRadius: '6px',
                            border: '1px solid var(--border-color)', background: 'white',
                            color: decisions[i] === 'ignorar' ? 'var(--text-muted)' : undefined }}
                        >
                          <option value="crear">Crear nueva</option>
                          {p.match && <option value="actualizar">Actualizar precio</option>}
                          <option value="ignorar">Ignorar</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Acciones rápidas */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
              <button className="btn btn-secondary" style={{ fontSize: '0.8rem', padding: '5px 12px' }}
                onClick={() => {
                  const dec = {};
                  conMatch.forEach((p, i) => { dec[i] = p.match?.tipo === 'igual' ? 'actualizar' : 'crear'; });
                  setDecisions(dec);
                }}>
                Auto: actualizar iguales, crear resto
              </button>
              <button className="btn btn-secondary" style={{ fontSize: '0.8rem', padding: '5px 12px' }}
                onClick={() => {
                  const dec = {};
                  conMatch.forEach((p, i) => { dec[i] = p.match ? 'ignorar' : 'crear'; });
                  setDecisions(dec);
                }}>
                Solo nuevas (ignorar similares)
              </button>
            </div>

            {/* Resumen de decisiones */}
            <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap', fontSize: '0.83rem' }}>
              <span>📥 {Object.values(decisions).filter(d => d === 'crear').length} a crear</span>
              <span>🔄 {Object.values(decisions).filter(d => d === 'actualizar').length} a actualizar</span>
              <span style={{ color: 'var(--text-muted)' }}>⏭ {Object.values(decisions).filter(d => d === 'ignorar').length} ignoradas</span>
            </div>

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => { setStep('drop'); setConMatch([]); setPartidas([]); }}>
                Cambiar archivo
              </button>
              <button className="btn btn-primary" onClick={handleImport}
                disabled={Object.values(decisions).every(d => d === 'ignorar')}
                style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <FileUp size={15} />
                Confirmar importación
              </button>
            </div>
          </>
        )}

        {/* ── IMPORTANDO ── */}
        {importing && (
          <div style={{ margin: '16px 0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', fontSize: '0.85rem' }}>
              <span>Importando…</span><span>{importProgress}%</span>
            </div>
            <div style={{ height: '8px', background: 'var(--bg-secondary)', borderRadius: '4px', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${importProgress}%`, background: 'var(--primary)',
                transition: 'width 0.3s', borderRadius: '4px' }} />
            </div>
          </div>
        )}

        {/* ── HECHO ── */}
        {step === 'done' && importStats && (
          <div style={{ textAlign: 'center', padding: '32px 0' }}>
            <CheckCircle size={52} style={{ color: '#22c55e', marginBottom: '14px' }} />
            <h3 style={{ margin: '0 0 10px' }}>¡Importación completada!</h3>
            <div style={{ display: 'flex', gap: '20px', justifyContent: 'center', margin: '16px 0', flexWrap: 'wrap' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '2rem', fontWeight: 700, color: '#22c55e' }}>{importStats.creadas}</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>creadas</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--primary)' }}>{importStats.actualizadas}</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>actualizadas</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--text-muted)' }}>{importStats.ignoradas}</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>ignoradas</div>
              </div>
              {importStats.errores > 0 && (
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '2rem', fontWeight: 700, color: '#ef4444' }}>{importStats.errores}</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>errores</div>
                </div>
              )}
            </div>
            <button className="btn btn-primary" onClick={onClose}>Cerrar</button>
          </div>
        )}

      </div>
    </div>
  , document.body);
}

// ── Sub-componentes pequeños ──────────────────────────────────────────────────

function StatCard({ label, value, color, sub }) {
  return (
    <div style={{ background: 'var(--bg-secondary)', borderRadius: '10px', padding: '14px 16px',
      borderLeft: `4px solid ${color}` }}>
      <div style={{ fontSize: '1.8rem', fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)', marginTop: '4px' }}>{label}</div>
      {sub && <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)', marginTop: '2px' }}>{sub}</div>}
    </div>
  );
}

function TypeBadge({ icon, label, desc, color }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 14px',
      border: `1px solid ${color}40`, borderRadius: '20px', color }}>
      {icon}
      <span style={{ fontWeight: 700, fontSize: '0.85rem' }}>{label}</span>
      <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{desc}</span>
    </div>
  );
}

function ErrorBanner({ msg }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px',
      background: 'rgba(239,68,68,0.1)', borderRadius: '10px', color: '#ef4444', marginTop: '14px' }}>
      <AlertCircle size={16} /> {msg}
    </div>
  );
}

const th = { padding: '8px 10px', textAlign: 'left', fontWeight: 600, whiteSpace: 'nowrap', fontSize: '0.78rem' };
const td = { padding: '7px 10px', verticalAlign: 'middle' };

// ── Panel: estimación precio trabajo a partir de precio material ───────────────
/**
 * Dado un material con precio conocido, estima cuánto costaría el trabajo
 * que lo incluye, usando los ratios de desglose por categoría.
 *
 * Ejemplo: "Azulejo 60x60 = 12 €/m²" → categoría alicatado (55% mat)
 *   → precio trabajo ≈ 12 / 0.55 = 21.8 €/m²  (solo por componente material)
 */
function PanelEstimacionTrabajo({ item, onClose }) {
  const ratio = getRatio(item.categoria + ' ' + item.descripcion_corta);
  const pMat  = parseFloat(item.precio_total) || 0;

  // Precio completo del trabajo si este material representa ratio.mat del total
  const pTrabajoEstimado = ratio.mat > 0 ? pMat / ratio.mat : null;
  const pMO  = pTrabajoEstimado ? pTrabajoEstimado * ratio.mo  : null;
  const pMaq = pTrabajoEstimado ? pTrabajoEstimado * ratio.maq : null;

  return (
    <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
      borderRadius: '12px', padding: '18px 20px', marginBottom: '16px', position: 'relative' }}>
      <button onClick={onClose} style={{ position: 'absolute', top: '12px', right: '12px',
        background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
        <X size={16} />
      </button>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
        <Info size={16} style={{ color: 'var(--primary)' }} />
        <strong style={{ fontSize: '0.92rem' }}>Estimación cruzada: precio de trabajo</strong>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          basada en que este material ≈ {Math.round(ratio.mat * 100)}% del coste del trabajo
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '10px' }}>
        <MiniStat label="Precio material" value={`${pMat.toFixed(2)} €/${item.unidad || 'ud'}`}
          color="var(--primary)" sub={`Fuente: ${item.fuente || 'ADIR'} · ${item.fecha_actualizacion || '—'}`} />
        {pTrabajoEstimado && (
          <>
            <MiniStat label="Trabajo completo estimado"
              value={`${pTrabajoEstimado.toFixed(2)} €/${item.unidad || 'ud'}`}
              color="#15803d"
              sub={`Material ${Math.round(ratio.mat*100)}% + MO ${Math.round(ratio.mo*100)}% + Maq ${Math.round(ratio.maq*100)}%`} />
            <MiniStat label="MO estimada" value={`${pMO.toFixed(2)} €`} color="#7c3aed" />
            <MiniStat label="Maquinaria estimada" value={`${pMaq.toFixed(2)} €`} color="#b45309" />
          </>
        )}
      </div>

      <p style={{ margin: '12px 0 0', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
        ⚠️ Estimación orientativa. Busca en la pestaña <strong>Base CYPE Murcia</strong> trabajos de
        "{item.categoria}" para contrastar con precios reales de ejecución.
      </p>
    </div>
  );
}

function MiniStat({ label, value, color, sub }) {
  return (
    <div style={{ background: 'white', borderRadius: '8px', padding: '10px 14px',
      borderLeft: `3px solid ${color}` }}>
      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '2px' }}>{label}</div>
      <div style={{ fontWeight: 700, color, fontSize: '1rem' }}>{value}</div>
      {sub && <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '2px' }}>{sub}</div>}
    </div>
  );
}

// ── Página principal ──────────────────────────────────────────────────────────

const BasePrecios = () => {
  const { ModalUI }          = useModal();
  const { showToast, ToastUI } = useToast();

  const [activeTab,             setActiveTab]             = useState('adir');
  const [data,                  setData]                  = useState([]);
  const [loading,               setLoading]               = useState(false);
  const [searchTerm,            setSearchTerm]            = useState('');
  const [selectedCategory,      setSelectedCategory]      = useState('');
  const [selectedTipo,          setSelectedTipo]          = useState(''); // '' | 'material' | 'trabajo' | 'auxiliar' | 'capitulo'
  const [categoriasDisponibles, setCategoriasDisponibles] = useState([]);
  const [page,                  setPage]                  = useState(0);
  const [hasMore,               setHasMore]               = useState(true);
  const [showImportModal,       setShowImportModal]       = useState(false);
  const [editingId,             setEditingId]             = useState(null);
  const [editValues,            setEditValues]            = useState({});
  const [rawEditValues,         setRawEditValues]         = useState({});

  const [saving,                setSaving]                = useState(false);
  const [selectedItem,          setSelectedItem]          = useState(null); // para panel cruzado

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchData(true); }, [activeTab, searchTerm, selectedCategory, selectedTipo]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { cargarCategorias(); setSelectedCategory(''); }, [activeTab]);

  const cargarCategorias = async () => {
    const table = activeTab === 'adir' ? 'base_precios_adir' : 'PreciosCype';
    try {
      const { data } = await supabase.from(table).select('categoria').limit(3000);
      if (data) setCategoriasDisponibles([...new Set(data.map(d => d.categoria).filter(Boolean))].sort());
    } catch (e) { console.error('Error categorías:', e); }
  };

  const fetchData = async (reset = false) => {
    setLoading(true);
    const currentPage = reset ? 0 : page;
    if (reset) { setPage(0); setData([]); }
    const table = activeTab === 'adir' ? 'base_precios_adir' : 'PreciosCype';
    try {
      let query = supabase.from(table).select('*')
        .not('codigo', 'ilike', '%#').order('codigo', { ascending: true });
      if (searchTerm) query = query.or(`codigo.ilike.%${searchTerm}%,descripcion_corta.ilike.%${searchTerm}%`);
      if (selectedCategory) query = query.ilike('categoria', `%${selectedCategory}%`);
      if (selectedTipo) query = query.eq('tipo_partida', selectedTipo);
      const from = currentPage * PAGE_SIZE;
      const { data: res, error } = await query.range(from, from + PAGE_SIZE - 1);
      if (error) throw error;
      if (res) {
        reset ? setData(res) : setData(prev => [...prev, ...res]);
        setHasMore(res.length === PAGE_SIZE);
      }
    } catch (e) {
      console.error('fetchData:', e);
      showToast('Error al cargar los datos.', 'error');
    } finally { setLoading(false); }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (page > 0) fetchData(); }, [page]);

  const handleEditClick = (item) => {
    setEditingId(item.codigo);
    setEditValues({
      precio_total:       item.precio_total       || 0,
      mano_de_obra:       item.mano_de_obra       || 0,
      materiales_y_otros: (activeTab === 'adir' ? item.materiales_y_otros : item.materiales) || 0,
      maquinaria:         item.maquinaria         || 0,
    });
  };

  const handleSaveEdit = async (codigo) => {
    setSaving(true);
    const table = activeTab === 'adir' ? 'base_precios_adir' : 'PreciosCype';
    const safeFloat = v => { const n = parseFloat(String(v).replace(',', '.')); return isNaN(n) ? 0 : n; };
    const payload = {
      precio_total: safeFloat(editValues.precio_total),
      mano_de_obra: safeFloat(editValues.mano_de_obra),
      maquinaria:   safeFloat(editValues.maquinaria),
    };
    if (activeTab === 'adir') payload.materiales_y_otros = safeFloat(editValues.materiales_y_otros);
    else payload.materiales = safeFloat(editValues.materiales_y_otros);
    try {
      const orig = data.find(d => d.codigo === codigo);
      const { error } = await supabase.from(table).update(payload).eq('codigo', codigo);
      if (error) throw new Error(error.message || JSON.stringify(error));
      await supabase.from('historial_cambios').insert({
        origen_cambio: 'Manual', tipo_entidad: activeTab === 'adir' ? 'Base ADIR' : 'Base CYPE',
        entidad_id: codigo, campo_modificado: 'Precio Total',
        valor_anterior: String(orig?.precio_total || 0), valor_nuevo: String(payload.precio_total),
        detalles: orig?.descripcion_corta,
      }).catch(() => {}); // historial no bloquea
      showToast('Precio actualizado correctamente.');
      setData(data.map(d => d.codigo === codigo ? { ...d, ...payload } : d));
      setEditingId(null);
    } catch (e) {
      console.error(e);
      showToast('Error al actualizar precio: ' + (e.message || e), 'error');
    } finally { setSaving(false); }
  };

  return (
    <div className="animate-fade-in" style={{ paddingBottom: '40px' }}>
      {ModalUI}
      {ToastUI}
      {showImportModal && (
        <ModalImport
          onClose={() => setShowImportModal(false)}
          onImportDone={() => { fetchData(true); cargarCategorias(); }}
          showToast={showToast}
        />
      )}

      {/* Header */}
      <div className="glass-card" style={{ marginBottom: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '15px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>            <div>
              <h1 style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '6px' }}><Database size={32} color="var(--primary)" /> Bases de Precios</h1>
              <p style={{ margin: '2px 0 0', color: 'var(--text-muted)', fontSize: '0.9rem' }}>Visualiza y modifica las bases de precios oficiales.</p>
            </div>
          </div>
          {activeTab === 'adir' && (
            <button className="btn btn-secondary" onClick={() => setShowImportModal(true)}>
              <FileUp size={16} /> Subir BC3 / PDF
            </button>
          )}
        </div>
      </div>

      {/* Tabs + tabla */}
      <div className="glass-card" style={{ marginBottom: '20px', padding: '0' }}>
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)' }}>
          {[['adir', <Database size={18} />, 'Base Oficial ADIR'],
            ['cype', <TableProperties size={18} />, 'Base CYPE Murcia']].map(([tab, icon, label]) => (
            <button key={tab}
              style={{
                flex: 1, padding: '15px', border: 'none', cursor: 'pointer',
                background: activeTab === tab ? 'var(--primary-light)' : 'transparent',
                borderBottom: activeTab === tab ? '2px solid var(--primary)' : '2px solid transparent',
                color: activeTab === tab ? 'var(--primary)' : 'var(--text-muted)',
                fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
              }}
              onClick={() => setActiveTab(tab)}
            >
              {icon} {label}
            </button>
          ))}
        </div>

        <div style={{ padding: '20px' }}>
          {/* Filtros */}
          <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ position: 'relative', flex: '2', minWidth: '220px' }}>
              <Search size={18} style={{ position: 'absolute', top: '12px', left: '12px', color: 'var(--text-light)' }} />
              <input type="text" placeholder="Buscar por código o descripción..."
                value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                style={{ width: '100%', paddingLeft: '40px' }} />
            </div>
            <div style={{ flex: '1', minWidth: '180px' }}>
              <select value={selectedCategory} onChange={e => setSelectedCategory(e.target.value)}
                style={{ width: '100%', padding: '10px', borderRadius: '8px',
                  border: '1px solid var(--border-color)', backgroundColor: 'white' }}>
                <option value="">Todas las categorías</option>
                {categoriasDisponibles.map((cat, i) => <option key={i} value={cat}>{cat}</option>)}
              </select>
            </div>
            {/* Filtro por tipo */}
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {[['', 'Todos'], ['material', '🧱 Materiales'], ['trabajo', '🔨 Trabajos'], ['auxiliar', '⚙️ Auxiliares'], ['capitulo', '📁 Capítulos'], ['partida', '📄 Partidas']].map(([val, label]) => (
                <button key={val}
                  onClick={() => setSelectedTipo(val)}
                  style={{
                    padding: '6px 14px', borderRadius: '20px', border: '1px solid var(--border-color)',
                    fontSize: '0.82rem', fontWeight: selectedTipo === val ? 700 : 400, cursor: 'pointer',
                    background: selectedTipo === val ? 'var(--primary)' : 'var(--bg-secondary)',
                    color: selectedTipo === val ? 'white' : 'var(--text-secondary)',
                    transition: 'all 0.15s',
                  }}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Panel cruzado material → trabajo */}
          {selectedItem && selectedItem.tipo_partida === 'material' && (
            <PanelEstimacionTrabajo item={selectedItem} onClose={() => setSelectedItem(null)} />
          )}

          {/* Tabla */}
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Tipo</th>
                  <th>Código</th><th>Categoría</th><th>Descripción</th><th>Ud.</th>
                  <th>M.O. (€)</th><th>Mat/Otros (€)</th><th>Maq. (€)</th>
                  <th>Precio Total (€)</th>
                  <th>Fuente</th>
                  <th>Actualizado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {data
                  .map(item => ({ ...item, _tipo: item.tipo_partida || inferirTipoPartida(item) }))
                  .map(item => (
                  <tr key={item.codigo}
                    style={{ cursor: item._tipo === 'material' ? 'pointer' : undefined }}
                    onClick={item._tipo === 'material' ? () => setSelectedItem(item) : undefined}
                    title={item._tipo === 'material' ? 'Haz clic para estimar precio de trabajo' : undefined}>
                    <td><TipoBadge tipo={item._tipo} /></td>
                    <td style={{ fontWeight: 'bold', fontSize: '0.82rem' }}>{item.codigo}</td>
                    <td style={{ fontSize: '0.78rem', color: 'var(--text-muted)', maxWidth: '100px',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                      title={item.categoria}>{item.categoria}</td>
                    <td style={{ maxWidth: '260px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                      title={item.descripcion_corta}>{item.descripcion_corta}</td>
                    <td style={{ fontSize: '0.82rem' }}>{item.unidad}</td>
                    {editingId === item.codigo ? (
                      <>
                        <td><input type="text" style={{ width: '70px', padding: '4px' }} value={rawEditValues.mano_de_obra ?? formatDecimal(editValues.mano_de_obra)} onChange={e => setRawEditValues({ ...rawEditValues, mano_de_obra: e.target.value })} onBlur={e => { setEditValues({ ...editValues, mano_de_obra: parseDecimal(e.target.value) }); setRawEditValues(prev => { const n = { ...prev }; delete n.mano_de_obra; return n; }); }} /></td>
                        <td><input type="text" style={{ width: '70px', padding: '4px' }} value={rawEditValues.materiales_y_otros ?? formatDecimal(editValues.materiales_y_otros)} onChange={e => setRawEditValues({ ...rawEditValues, materiales_y_otros: e.target.value })} onBlur={e => { setEditValues({ ...editValues, materiales_y_otros: parseDecimal(e.target.value) }); setRawEditValues(prev => { const n = { ...prev }; delete n.materiales_y_otros; return n; }); }} /></td>
                        <td><input type="text" style={{ width: '70px', padding: '4px' }} value={rawEditValues.maquinaria ?? formatDecimal(editValues.maquinaria)} onChange={e => setRawEditValues({ ...rawEditValues, maquinaria: e.target.value })} onBlur={e => { setEditValues({ ...editValues, maquinaria: parseDecimal(e.target.value) }); setRawEditValues(prev => { const n = { ...prev }; delete n.maquinaria; return n; }); }} /></td>
                        <td><input type="text" style={{ width: '70px', padding: '4px', fontWeight: 'bold' }} value={rawEditValues.precio_total ?? formatDecimal(editValues.precio_total)} onChange={e => setRawEditValues({ ...rawEditValues, precio_total: e.target.value })} onBlur={e => { setEditValues({ ...editValues, precio_total: parseDecimal(e.target.value) }); setRawEditValues(prev => { const n = { ...prev }; delete n.precio_total; return n; }); }} /></td>
                        <td />
                        <td>
                          <div style={{ display: 'flex', gap: '5px' }}>
                            <button className="btn btn-success" style={{ padding: '4px 8px', fontSize: '0.75rem' }} onClick={e => { e.stopPropagation(); handleSaveEdit(item.codigo); }} disabled={saving}>
                              {saving ? '…' : <Save size={14} />}
                            </button>
                            <button className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: '0.75rem' }} onClick={e => { e.stopPropagation(); setEditingId(null); setRawEditValues({}); }}>X</button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td style={{ fontSize: '0.82rem' }}>{item.mano_de_obra ?? '-'}</td>
                        <td style={{ fontSize: '0.82rem' }}>{activeTab === 'adir' ? item.materiales_y_otros : item.materiales}</td>
                        <td style={{ fontSize: '0.82rem' }}>{item.maquinaria || 0}</td>
                        <td style={{ fontWeight: 'bold', color: 'var(--primary)' }}>{item.precio_total}</td>
                        <td style={{ fontSize: '0.73rem', color: 'var(--text-muted)' }}>{item.fuente || (activeTab === 'adir' ? 'ADIR' : 'CYPE')}</td>
                        <td style={{ fontSize: '0.73rem', color: 'var(--text-muted)' }}>
                          {(item.fecha_actualizacion || item.fecha)
                            ? new Date(item.fecha_actualizacion || item.fecha).toLocaleDateString('es-ES', { month: 'short', year: 'numeric' })
                            : '—'}
                        </td>
                        <td>
                          <button className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: '0.75rem' }}
                            onClick={e => { e.stopPropagation(); handleEditClick(item); }}>
                            Editar
                          </button>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>

            {loading && (
              <div style={{ textAlign: 'center', padding: '20px' }}>
                <Loader2 className="loader-spinner" style={{ display: 'inline-block' }} />
              </div>
            )}
            {!loading && data.length === 0 && (
              <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)' }}>
                No se encontraron resultados.
              </div>
            )}
            {!loading && hasMore && data.length > 0 && (
              <div style={{ textAlign: 'center', padding: '20px' }}>
                <button className="btn btn-secondary" onClick={() => setPage(p => p + 1)}>Cargar más</button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default BasePrecios;
