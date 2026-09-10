import React, { useState, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '../utils/supabaseClient';
import { N8N_BASE_URL } from '../config';
import { useModal, useToast } from '../utils/useModal';
import {
  BarChart2, ChevronDown, ChevronRight, CheckCircle, Clock,
  AlertCircle, Trophy, Download, TrendingDown, TrendingUp, RefreshCw,
  Inbox, List, X, Euro, Calendar, User, Briefcase, Upload, Loader2, FileText
} from 'lucide-react';
import Bc3Worker from '../utils/bc3Worker.js?worker';
import { generarPDFOfertaProveedor, descargarPDF } from '../utils/pdfUtils';
import { cleanText } from '../utils/escape';
import { formatDecimal, parseDecimal } from '../utils/format';

// ─── Vista: FEED GLOBAL de respuestas recibidas ──────────────────────────────
function FeedPresupuestos({ solicitudes, respuestas, partidas, propuestas, proyectoSel, oficioSel, deleteSolicitud, allPartidas }) {
  const handleDescargarPDF = (sol, resps) => {
    const fechaResp = resps.reduce((max, r) => (r.created_at > max ? r.created_at : max), '');
    const partidasPDF = resps.map(r => {
      let part = (allPartidas || partidas).find(p => p.id === r.partida_id);
      if (!part) {
        const rCode = String(r.partida_id || '').replace(/#/g, '').trim().toLowerCase().replace(/^0+/, '');
        part = (allPartidas || partidas).find(p =>
          p.propuesta_id === sol.propuesta_id &&
          (p.texto_partida ? p.texto_partida.split('::')[0].replace(/#/g, '').trim().toLowerCase().replace(/^0+/, '') : '') === rCode
        );
      }
      const descripcion = part
        ? cleanText(part.texto_descripcion || part.texto_partida || part.id)
        : (r.partida_id || 'Partida');
      return {
        descripcion,
        unidad: part?.unidad || 'ud',
        cantidad: part?.cantidad || 1,
        precioOfertado: Number(r.precio_ofertado) || 0,
        comentario: r.comentarios || '',
      };
    });

    const doc = generarPDFOfertaProveedor({
      proveedorNombre: sol.proveedor_nombre || sol.proveedor_email || 'Proveedor',
      proveedorEmail: sol.proveedor_email || '',
      proyectoNombre: propuestas.find(p => p.Proyecto === sol.propuesta_id)?.cliente || sol.propuesta_id || '',
      oficio: sol.oficio_solicitado || '',
      fecha: fechaResp || sol.fecha_envio || new Date().toISOString(),
      partidas: partidasPDF,
      comentariosGenerales: sol.comentarios_generales || '',
    });

    const safeName = `Oferta_${(sol.proveedor_nombre || 'proveedor').replace(/\s+/g, '_')}_${(sol.oficio_solicitado || '').replace(/\s+/g, '_')}_${(sol.propuesta_id || '').replace(/\s+/g, '_')}`;
    descargarPDF(doc, safeName);
  };
  // Agrupar respuestas por solicitud_id
  const feedItems = useMemo(() => {
    const solsFiltradas = solicitudes.filter(s => {
      if (proyectoSel && s.propuesta_id !== proyectoSel) return false;
      if (oficioSel && (s.oficio_solicitado || '').toLowerCase().trim() !== oficioSel.toLowerCase().trim()) return false;
      return true;
    });

    // Solo solicitudes que tengan al menos una respuesta (fallback a _num_id/token si id es nulo)
    return solsFiltradas
      .map(sol => {
        const solKey = String(sol.id || sol._num_id || sol.token || '');
        const resps = respuestas.filter(r => String(r.solicitud_id) === solKey);
        return { sol, resps };
      })
      .filter(({ resps }) => resps.length > 0)
      .sort((a, b) => {
        // Ordenar por fecha de RESPUESTA más reciente (created_at de respuestas), más reciente arriba
        const fechaRespA = a.resps.reduce((max, r) => (r.created_at > max ? r.created_at : max), '');
        const fechaRespB = b.resps.reduce((max, r) => (r.created_at > max ? r.created_at : max), '');
        if (fechaRespA && fechaRespB) return fechaRespB.localeCompare(fechaRespA);
        // Fallback: fecha_envio de la solicitud
        return (b.sol.fecha_envio || '').localeCompare(a.sol.fecha_envio || '');
      });
  }, [solicitudes, respuestas, proyectoSel, oficioSel]);

  if (feedItems.length === 0) {
    return (
      <div style={s.emptyFeed}>
        <Inbox size={48} color="#c7d5e6" style={{ marginBottom: 16 }} />
        <p style={{ fontSize: 16, fontWeight: 600, color: '#6b7280', margin: 0 }}>
          No hay presupuestos recibidos aún
        </p>
        <p style={{ fontSize: 13, color: '#9ca3af', marginTop: 8 }}>
          Los presupuestos aparecerán aquí cuando los proveedores respondan al formulario de correo.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {feedItems.map(({ sol, resps }) => {
        const total = resps.reduce((sum, r) => sum + (Number(r.precio_ofertado) || 0), 0);
        const fechaResp = resps.reduce((max, r) => r.created_at > max ? r.created_at : max, '');
        const fechaDisplay = fechaResp
          ? new Date(fechaResp).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
          : '—';

        return (
          <div key={sol.id || sol.token} style={s.feedCard}>
            {/* Cabecera */}
            <div style={s.feedCardHeader}>
              <div style={s.feedCardLeft}>
                <div style={s.feedIcon}>
                  <User size={16} color="#002D54" />
                </div>
                <div>
                  <div style={s.feedProvNombre}>
                    {sol.proveedor_nombre || sol.proveedor_email || 'Proveedor'}
                  </div>
                  {sol.proveedor_email && sol.proveedor_nombre && (
                    <div style={s.feedProvEmail}>{sol.proveedor_email}</div>
                  )}
                </div>
              </div>
              <div style={s.feedMeta}>
                <span style={s.feedBadgeOficio}>
                  <Briefcase size={11} style={{ marginRight: 3 }} />
                  {sol.oficio_solicitado || '—'}
                </span>
                {sol.propuesta_id && (
                  <span style={s.feedBadgeProyecto}>
                    {propuestas.find(p => p.Proyecto === sol.propuesta_id)?.cliente || sol.propuesta_id}
                  </span>
                )}
                <span style={s.feedBadgeFecha}>
                  <Calendar size={11} style={{ marginRight: 3 }} />
                  {fechaDisplay}
                </span>
                {(sol.estado_solicitud === 'Respondido' || sol.estado === 'Respondido') && (
                  <span style={s.badgeOk}><CheckCircle size={11} /> Respondido</span>
                )}
                {(sol.estado_solicitud === 'Adjudicada' || sol.estado === 'Adjudicada') && (
                  <span style={s.badgeAdj2}><Trophy size={11} /> Adjudicado</span>
                )}
                <button
                  onClick={() => handleDescargarPDF(sol, resps)}
                  style={{ ...s.btnIcon, color: '#2563eb' }}
                  title="Descargar oferta en PDF"
                >
                  <Download size={14} />
                </button>
                <button
                  onClick={() => deleteSolicitud(sol.id || sol.token, sol.token)}
                  style={{ ...s.btnIcon, color: '#ef4444' }}
                  title="Eliminar presupuesto y resetear solicitud"
                >
                  <X size={14} />
                </button>
              </div>
            </div>

            {/* Tabla de partidas respondidas */}
            <div style={s.feedTableWrapper}>
              <table style={s.feedTable}>
                <thead>
                  <tr>
                    <th style={{ ...s.feedTh, textAlign: 'left', minWidth: 200 }}>Partida</th>
                    <th style={s.feedTh}>Precio/ud (€)</th>
                    <th style={s.feedTh}>Cant.</th>
                    <th style={s.feedTh}>Total línea (€)</th>
                    <th style={{ ...s.feedTh, textAlign: 'left', minWidth: 150 }}>Observaciones</th>
                  </tr>
                </thead>
                <tbody>
                  {resps.map(r => {
                    let partida = partidas.find(p => p.id === r.partida_id);
                    if (!partida) {
                        const rCode = String(r.partida_id || '').replace(/#/g, '').trim().toLowerCase().replace(/^0+/, '');
                        partida = partidas.find(p => p.propuesta_id === sol.propuesta_id && (p.texto_partida ? p.texto_partida.split('::')[0].replace(/#/g, '').trim().toLowerCase().replace(/^0+/, '') : '') === rCode);
                    }
                    const descr = partida
                      ? cleanText(partida.texto_descripcion || partida.texto_partida || partida.id)
                      : (r.partida_id || 'Partida');
                    const cant = partida?.cantidad || 1;
                    const precioUd = Number(r.precio_ofertado) || 0;
                    const totalLinea = precioUd * cant;
                    return (
                      <tr key={r.id} style={s.feedTr}>
                        <td style={{ ...s.feedTd, textAlign: 'left', maxWidth: 320 }}>
                          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{descr}</div>
                        </td>
                        <td style={{ ...s.feedTd, textAlign: 'right', fontWeight: 600, color: '#059669' }}>
                          {precioUd > 0 ? `${precioUd.toFixed(2)} €` : '—'}
                        </td>
                        <td style={{ ...s.feedTd, textAlign: 'center', color: '#6b7280' }}>
                          {cant}
                        </td>
                        <td style={{ ...s.feedTd, textAlign: 'right', fontWeight: 700, color: '#002D54' }}>
                          {totalLinea > 0 ? `${totalLinea.toFixed(2)} €` : '—'}
                        </td>
                        <td style={{ ...s.feedTd, textAlign: 'left', color: '#6b7280', fontSize: 12 }}>
                          {r.comentarios || '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {total > 0 && (
                  <tfoot>
                    <tr style={{ borderTop: '2px solid #c7d5e6', background: '#e5edf7' }}>
                      <td colSpan={3} style={{ ...s.feedTd, fontWeight: 700, textAlign: 'left' }}>TOTAL</td>
                      <td style={{ ...s.feedTd, textAlign: 'right', fontWeight: 800, fontSize: 15, color: '#002D54' }}>
                        {resps.reduce((sum, r) => {
                          let p2 = partidas.find(p => p.id === r.partida_id);
                          if (!p2) { const c = String(r.partida_id||'').replace(/#/g,'').trim().toLowerCase().replace(/^0+/,''); p2 = partidas.find(p => p.propuesta_id===sol.propuesta_id && (p.texto_partida?p.texto_partida.split('::')[0].replace(/#/g,'').trim().toLowerCase().replace(/^0+/,''):'')===c); }
                          return sum + (Number(r.precio_ofertado)||0) * (p2?.cantidad||1);
                        }, 0).toFixed(2)} €
                      </td>
                      <td style={s.feedTd}></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            {/* Anotaciones generales del proveedor */}
            {sol.comentarios_generales && sol.comentarios_generales.trim() && (
              <div style={{ padding: '10px 20px 14px', background: '#fffbeb', borderTop: '1px solid #fde68a', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <span style={{ fontSize: 14, flexShrink: 0, marginTop: 1 }}>📝</span>
                <div>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#92400e' }}>Anotaciones generales del proveedor: </span>
                  <span style={{ fontSize: 12, color: '#78350f' }}>{sol.comentarios_generales}</span>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Vista: COMPARATIVA agrupada por oficio/proyecto ─────────────────────────
function ComparativaAgrupada({
  comparativa, oficiosAbiertos, toggleGrupo,
  adjudicaciones, adjudicar, adjudicando,
  estadoBadge, propuestas, allSolicitudes = [],
  openModalCompetencia,
  hideCompetitors = false,
  isGlobalView = false,
  deleteSolicitud
}) {
  const gruposOrdenados = Object.entries(comparativa);

  if (gruposOrdenados.length === 0) {
    return (
      <div style={s.empty}>
        {isGlobalView ? 'Selecciona un proyecto para ver la comparativa global.' : 'No hay grupos de comparativa para los filtros seleccionados.'}
      </div>
    );
  }

  return (
    <div>
      {gruposOrdenados.map(([key, { oficio, proyecto, proveedores, filas, totales, presupuestoBase }]) => {
        const adjProvId = adjudicaciones[key];
        const adjProv   = adjProvId ? proveedores.find(p => p.proveedor_id === adjProvId) : null;
        
        const minTotalId = (() => {
          let min = Infinity, minId = null;
          proveedores.forEach(p => {
            const t = totales[p.solicitud_id];
            if (t > 0 && t < min) { min = t; minId = p.solicitud_id; }
          });
          return minId;
        })();

        const ahorro = adjProv && totales[adjProv.solicitud_id] && presupuestoBase
          ? presupuestoBase - totales[adjProv.solicitud_id] : null;

        return (
          <div key={key} style={s.card}>
            <div style={s.cardHeader} onClick={() => toggleGrupo(key)}>
              <div style={s.cardHeaderLeft}>
                {oficiosAbiertos[key] ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                <h2 style={s.cardTitle}>{oficio}</h2>
                <span style={s.badgeProyecto}>{propuestas?.find(p => p.Proyecto === proyecto)?.cliente || proyecto}</span>
                <span style={s.badge}>{proveedores.length} col.</span>
                {adjProv && (
                  <span style={s.badgeWinner}><Trophy size={12} /> {adjProv.nombre}</span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {ahorro !== null && (
                  ahorro >= 0
                    ? <span style={s.ahorroPos}><TrendingDown size={14} /> Ahorro {ahorro.toFixed(0)} €</span>
                    : <span style={s.ahorroNeg}><TrendingUp size={14} /> Desvío {Math.abs(ahorro).toFixed(0)} €</span>
                )}
                {!hideCompetitors && (
                  <button
                      onClick={(e) => { e.stopPropagation(); openModalCompetencia(key); }}
                      style={{ ...s.btnAdjudicar, background: '#f59e0b', fontSize: 11, padding: '4px 8px' }}
                  >
                      + Añadir Competidor
                  </button>
                )}
              </div>
            </div>

            {oficiosAbiertos[key] !== false && (
              <div>
                {!isGlobalView && (
                    <div style={s.adjudicarBar}>
                        {!adjProvId ? (
                            <>
                                <span style={{ fontSize: 13, color: '#6b7280', marginRight: 8 }}>🏆 Adjudicar a:</span>
                                {proveedores.filter(p => !p.esLocal).map(p => (
                                <button
                                    key={p.solicitud_id}
                                    onClick={() => adjudicar(key, p.solicitud_id)}
                                    disabled={!!adjudicando}
                                    style={{
                                    ...s.btnAdjudicar,
                                    opacity: adjudicando === key ? 0.6 : 1,
                                    background: p.solicitud_id === minTotalId ? '#059669' : '#002D54'
                                    }}
                                >
                                    <Trophy size={13} /> {p.nombre}
                                    {p.solicitud_id === minTotalId && totales[p.solicitud_id] > 0 && (
                                    <span style={{ marginLeft: 4, fontSize: 11, opacity: 0.85 }}>
                                        ({totales[p.solicitud_id].toFixed(0)} €)
                                    </span>
                                    )}
                                </button>
                                ))}
                            </>
                        ) : (
                            <>
                                <Trophy size={15} color="#002D54" />
                                <span style={{ color: '#002D54', fontWeight: 700, fontSize: 14 }}>
                                Adjudicado a: {adjProv?.nombre ?? 'Proveedor'}
                                </span>
                                <button
                                onClick={() => adjudicar(key, null, true)}
                                style={{ marginLeft: 'auto', padding: '5px 12px', background: '#e5edf7', border: '1px solid #c7d5e6', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}
                                >
                                Cambiar Ganador
                                </button>
                            </>
                        )}
                    </div>
                )}

                {filas.length > 0 ? (
                  <div style={s.tableWrapper}>
                    <table style={s.table}>
                      <thead>
                        <tr>
                          <th style={{ ...s.th, textAlign: 'left', minWidth: 280 }}>Partida</th>
                          <th style={s.th}>Ud.</th>
                          <th style={s.th}>Cant.</th>
                          <th style={s.th}>Base (€)</th>
                          {proveedores.map(p => (
                            <th key={p.solicitud_id} style={{
                              ...s.th,
                              background: adjProvId && p.proveedor_id === adjProvId ? '#c7d5e6'
                                : p.solicitud_id === minTotalId ? '#d1fae5' : p.esLocal ? '#fef3c7' : undefined,
                              color: adjProvId && p.proveedor_id === adjProvId ? '#002D54'
                                : p.solicitud_id === minTotalId ? '#059669' : p.esLocal ? '#92400e' : undefined
                            }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
                                {p.nombre}
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        const solFeed = allSolicitudes.find(s => s.id === p.solicitud_id);
                                        const doc = generarPDFOfertaProveedor({
                                            proveedorNombre: p.nombre,
                                            proveedorEmail: solFeed?.proveedor_email || '',
                                            proyectoNombre: propuestas.find(pr => pr.Proyecto === proyecto)?.cliente || proyecto,
                                            oficio,
                                            fecha: solFeed?.fecha_respuesta || new Date().toISOString(),
                                            partidas: filas.map(f => ({
                                                descripcion: cleanText(f.partida.texto_descripcion || f.partida.texto_partida || ''),
                                                unidad: f.partida.unidad || 'ud',
                                                cantidad: f.partida.cantidad || 1,
                                                precioOfertado: f.precios[p.solicitud_id]?.precio || 0,
                                                comentario: f.precios[p.solicitud_id]?.comentario || '',
                                            })).filter(f => f.precioOfertado > 0),
                                            comentariosGenerales: solFeed?.comentarios_generales || '',
                                        });
                                        descargarPDF(doc, `Oferta_${p.nombre.replace(/\s+/g,'_')}_${oficio.replace(/\s+/g,'_')}`);
                                    }}
                                    title="Descargar oferta en PDF"
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: adjProvId && p.proveedor_id === adjProvId ? '#002D54' : '#2563eb', display: 'flex', alignItems: 'center' }}
                                >
                                    <Download size={12} />
                                </button>
                                {!p.esLocal && deleteSolicitud && (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); deleteSolicitud(p.solicitud_id); }}
                                    title="Eliminar presupuesto"
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: '#ef4444', display: 'flex', alignItems: 'center', flexShrink: 0 }}
                                  >
                                    <X size={12} />
                                  </button>
                                )}
                              </div>
                              {!p.esLocal && (
                                  <div style={{ fontWeight: 400, fontSize: 11, marginTop: 2 }}>{estadoBadge(p.estado)}</div>
                              )}
                              {p.esLocal && (
                                  <div style={{ fontWeight: 600, fontSize: 10, marginTop: 2, color: '#d97706' }}>[BC3/Manual]</div>
                              )}
                              {!p.esLocal && (() => {
                                  const notaGral = allSolicitudes.find(s => s.id === p.solicitud_id)?.comentarios_generales;
                                  return notaGral ? (
                                      <div style={{ fontWeight: 400, fontSize: 10, marginTop: 3, color: '#92400e', fontStyle: 'italic', maxWidth: 160, whiteSpace: 'normal', lineHeight: 1.3, textAlign: 'left', background: '#fffbeb', borderRadius: 4, padding: '2px 4px' }}>
                                          {notaGral}
                                      </div>
                                  ) : null;
                              })()}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {filas.map(({ partida, precios, minProvId }) => (
                          <tr key={partida.id} style={s.tr}>
                            <td style={{ ...s.td, textAlign: 'left' }}>
                              {(partida.texto_descripcion || partida.texto_partida || '').replace(/\|/g, ' ').replace(/\s{2,}/g, ' ').trim()}
                            </td>
                            <td style={{ ...s.td, textAlign: 'center' }}>{partida.unidad || 'ud'}</td>
                            <td style={{ ...s.td, textAlign: 'right' }}>{partida.cantidad || 1}</td>
                            <td style={{ ...s.td, textAlign: 'right', color: '#9ca3af' }}>
                              {partida.precio_base_estimado
                                ? `${((partida.precio_base_estimado || 0) * (partida.cantidad || 1)).toFixed(2)} €`
                                : '—'}
                            </td>
                            {proveedores.map(p => {
                              const resp    = precios[p.solicitud_id];
                              const esMejor = p.solicitud_id === minProvId;
                              const esAdj   = adjProvId && p.proveedor_id === adjProvId;
                              return (
                                <td key={p.solicitud_id} style={{
                                  ...s.td, textAlign: 'right',
                                  background: esAdj ? '#e5edf7' : esMejor ? '#ecfdf5' : p.esLocal ? '#fffbeb' : undefined,
                                  fontWeight: esMejor || esAdj ? 700 : 400,
                                  color: esAdj ? '#002D54' : esMejor ? '#059669' : undefined
                                }}>
                                  {!resp
                                    ? <span style={{ color: '#c7d5e6' }}>—</span>
                                    : <div>
                                        <div>{resp.precio != null ? `${Number(resp.precio).toFixed(2)} €` : '—'}</div>
                                        {resp.comentario && (
                                          <div style={{ fontSize: '0.68rem', color: '#9ca3af', marginTop: 2, fontStyle: 'italic', textAlign: 'left', maxWidth: 140, whiteSpace: 'normal', lineHeight: 1.3 }}>
                                            {resp.comentario}
                                          </div>
                                        )}
                                      </div>
                                  }
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr style={{ background: '#e5edf7', borderTop: '2px solid #c7d5e6' }}>
                          <td colSpan={3} style={{ ...s.td, fontWeight: 700, textAlign: 'left' }}>TOTAL OFICIO</td>
                          <td style={{ ...s.td, textAlign: 'right', color: '#9ca3af', fontWeight: 600 }}>
                            {presupuestoBase > 0 ? `${presupuestoBase.toFixed(2)} €` : '—'}
                          </td>
                          {proveedores.map(p => {
                            const t      = totales[p.solicitud_id] || 0;
                            const esAdj  = adjProvId && p.proveedor_id === adjProvId;
                            const esMenor = p.solicitud_id === minTotalId;
                            return (
                              <td key={p.solicitud_id} style={{
                                ...s.td, textAlign: 'right', fontWeight: 700,
                                color:      esAdj ? '#002D54' : esMenor ? '#059669' : p.esLocal ? '#92400e' : '#374151',
                                background: esAdj ? '#c7d5e6' : esMenor ? '#ecfdf5' : p.esLocal ? '#fef3c7' : '#e5edf7'
                              }}>
                                {t > 0 ? `${t.toFixed(2)} €` : '—'}
                              </td>
                            );
                          })}
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                ) : (
                  <div style={{ padding: '20px 24px', color: '#9ca3af', fontSize: 13 }}>
                    No se encontraron partidas asociadas a este oficio en el proyecto.
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function Comparativa({ setSessionCache }) {
  const { ModalUI } = useModal();
  const { showToast, ToastUI } = useToast();

  const [allSolicitudes, setAllSolicitudes] = useState([]);
  const [allPartidas, setAllPartidas]       = useState([]);
  const [allRespuestas, setAllRespuestas]   = useState([]);
  const [allPropuestas, setAllPropuestas]   = useState([]);
  const [adjudicaciones, setAdjudicaciones] = useState({});
  const [loading, setLoading]               = useState(false);
  const [adjudicando, setAdjudicando]       = useState(null);
  const [vista, setVista]                   = useState('feed'); // 'feed' | 'comparativa'
  const [confirmingDelete, setConfirmingDelete] = useState(null); // ID de la solicitud a borrar

  const [modalCompetencia, setModalCompetencia] = useState(null);
  const [competenciaNombre, setCompetenciaNombre] = useState('');
  const [competenciaPrecios, setCompetenciaPrecios] = useState({});
  const [rawCompetencia, setRawCompetencia] = useState({});
  const [guardandoCompetencia, setGuardandoCompetencia] = useState(false);


  // Modal para BC3 Global
  const [modalBC3, setModalBC3] = useState(false);
  const [bc3File, setBc3File] = useState(null);
  const [bc3FileName, setBc3FileName] = useState('');
  const [bc3Project, setBc3Project] = useState('');
  const [bc3Name, setBc3Name] = useState('');
  const [bc3Loading, setBc3Loading] = useState(false);
  const [bc3DragOver, setBc3DragOver] = useState(false);

  // Competidores externos (solo en memoria, no se guardan en BD)
  const [competenciasLocales, setCompetenciasLocales] = useState([]);

  // Filtros
  const [proyectoSel, setProyectoSel] = useState('');
  const [oficioSel,   setOficioSel]   = useState('');
  const [oficiosAbiertos, setOficiosAbiertos] = useState({});

  // ─── 1. Cargar TODO al iniciar ─────────────────────────────────────────────
  const cargarTodo = async () => {
    setLoading(true);
    try {
      // Helper para traer todos los registros sorteando el límite de 1000
      const fetchAll = async (table, select = '*') => {
        let all = [];
        let from = 0;
        const step = 1000;
        while (true) {
          const { data, error } = await supabase.from(table).select(select).range(from, from + step - 1);
          if (error) { console.error(`Error fetching ${table}:`, error); break; }
          if (!data || data.length === 0) break;
          all = [...all, ...data];
          if (data.length < step) break;
          from += step;
        }
        return all;
      };

      const [{ data: sols, error: solsError }, { data: props }] = await Promise.all([
        supabase.from('solicitudes').select('*'),
        supabase.from('propuestas').select('Proyecto, cliente')
      ]);

      const parts = await fetchAll('partidas');
      const resps = await fetchAll('respuestas');

      if (solsError) console.error('Error cargando solicitudes:', solsError);

      const currentSols  = sols  || [];
      const currentParts = parts || [];
      const currentResps = resps || [];

      // Reconstruir adjudicaciones desde la BD
      const adj = {};
      currentParts.forEach(p => {
        if (p.proveedor_adjudicado_id) {
          const key = `${p.oficio_asignado || p.oficio_necesario}__${p.propuesta_id}`;
          adj[key] = p.proveedor_adjudicado_id;
        }
      });

      setAllSolicitudes(currentSols);
      setAllPartidas(currentParts);
      setAllRespuestas(currentResps);
      setAllPropuestas(props || []);
      setAdjudicaciones(adj);

      // Abrir todos los grupos por defecto
      const grupos = {};
      currentSols.forEach(s => {
        const key = `${s.oficio_solicitado}__${s.propuesta_id}`;
        grupos[key] = true;
      });
      setOficiosAbiertos(grupos);
    } catch (err) {
      console.error('Error cargando datos:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { cargarTodo(); }, []);

  const normalize = str => str ? str.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') : '';
  const normalizeCode = (c) => String(c || '').replace(/#/g, '').trim().toLowerCase().replace(/^0+/, '');

  // ─── 2. Listas únicas para filtros ────────────────────────────────────────
  const proyectosUnicos = useMemo(() => {
    const fromSols = allSolicitudes.map(s => s.propuesta_id).filter(Boolean);
    const fromPartidas = allPartidas.map(p => p.propuesta_id).filter(Boolean);
    return [...new Set([...fromSols, ...fromPartidas])].sort();
  }, [allSolicitudes, allPartidas]);
  const oficiosUnicos = useMemo(() => {
    const fromSols = (proyectoSel ? allSolicitudes.filter(s => s.propuesta_id === proyectoSel) : allSolicitudes)
      .map(s => s.oficio_solicitado).filter(Boolean);
    const fromPartidas = (proyectoSel ? allPartidas.filter(p => p.propuesta_id === proyectoSel) : allPartidas)
      .map(p => p.oficio_asignado || p.oficio_necesario).filter(Boolean);
    return [...new Set([...fromSols, ...fromPartidas])].sort();
  }, [allSolicitudes, allPartidas, proyectoSel]);

  // --- 3a. Lógica de Comparativa por Oficios (Solo para adjudicación) ---
  const comparativaOficios = useMemo(() => {
    try {
      const solicsFiltradas = allSolicitudes.filter(s => {
        if (proyectoSel && s.propuesta_id !== proyectoSel) return false;
        if (oficioSel   && normalize(s.oficio_solicitado) !== normalize(oficioSel)) return false;
        return true;
      });

      // Helper: clave efectiva de solicitud — usa id_bc3, si es null cae a _num_id (auto-increment
      // MySQL que n8n puede haber guardado en solicitud_bc3), y si no al token
      const getSolKey = s => String(s.id || s._num_id || s.token || '');

      const grupos = {};
      solicsFiltradas
        .filter(sol => allRespuestas.some(r => String(r.solicitud_id) === getSolKey(sol)))
        .forEach(sol => {
        const key = `${sol.oficio_solicitado}__${sol.propuesta_id}`;
        if (!grupos[key]) grupos[key] = { oficio: sol.oficio_solicitado, proyecto: sol.propuesta_id, solicitudes: [] };
        grupos[key].solicitudes.push(sol);
      });

      const result = {};
      Object.entries(grupos).forEach(([key, { oficio, proyecto, solicitudes: sols }]) => {
        const partidasGrupo = allPartidas.filter(p => p.propuesta_id === proyecto && (normalize(p.oficio_asignado) === normalize(oficio) || normalize(p.oficio_necesario) === normalize(oficio)));
        const proveedores = sols.map(s => ({ solicitud_id: getSolKey(s), proveedor_id: s.proveedor_id, nombre: s.proveedor_nombre || s.proveedor_email || 'Proveedor', estado: s.estado || 'Pendiente', esLocal: false }));

        if (!proveedores.length) return;

        // Construir mapa de respuestas para este grupo para búsqueda rápida
        const groupResps = {};
        allRespuestas.filter(r => sols.some(s => getSolKey(s) === String(r.solicitud_id))).forEach(r => {
            groupResps[`${String(r.solicitud_id)}__${r.partida_id}`] = r;
        });

        const filas = partidasGrupo.map(p => {
          // Inicializar todos los proveedores a null para evitar undefined en el render
          const precios = Object.fromEntries(proveedores.map(pr => [pr.solicitud_id, null]));
          let minPrecio = Infinity, minProvId = null;

          for (const prov of proveedores) {
            try {
              // Match por ID exacto primero, luego por código normalizado
              let resp = groupResps[`${prov.solicitud_id}__${p.id}`];
              if (!resp) {
                const pCode = normalizeCode(p.codigo || (p.texto_partida ? p.texto_partida.split('::')[0] : ''));
                if (pCode) resp = allRespuestas.find(r => String(r.solicitud_id) === prov.solicitud_id && normalizeCode(String(r.partida_id || '')) === pCode);
              }
              if (resp) {
                const precio = Number(resp.precio_ofertado) || 0;
                precios[prov.solicitud_id] = { precio, comentario: resp.comentarios || null };
                if (precio > 0 && precio < minPrecio) { minPrecio = precio; minProvId = prov.solicitud_id; }
              }
            } catch (_) { /* mantener null para este proveedor */ }
          }
          return { partida: p, precios, minProvId };
        });

        const totales = {};
        proveedores.forEach(prov => { totales[prov.solicitud_id] = filas.reduce((sum, { precios }) => sum + (precios[prov.solicitud_id]?.precio || 0), 0); });
        result[key] = { oficio, proyecto, proveedores, filas, totales, presupuestoBase: filas.reduce((sum, f) => sum + ((f.partida.precio_base_estimado || 0) * (f.partida.cantidad || 1)), 0) };
      });
      return result;
    } catch (e) { console.error("Error comparativaOficios:", e); return {}; }
  }, [allSolicitudes, allPartidas, allRespuestas, proyectoSel, oficioSel]);

  // --- 3b. Lógica de Comparativa Global (Proyectos vs Competencia) ---
  // UN solo grupo "Proyecto Completo" con TODAS las partidas (sin depender de oficio_asignado)
  const comparativaGlobal = useMemo(() => {
    try {
      if (!proyectoSel) return {};

      // Todas las partidas del proyecto (excluir cabeceras de capítulo)
      const lineasPartidas = allPartidas.filter(p => {
        if (p.propuesta_id !== proyectoSel) return false;
        const cod = p.codigo || (p.texto_partida ? p.texto_partida.split('::')[0] : '') || '';
        return !cod.trim().endsWith('#'); // excluir capítulos/subcapítulos
      });

      if (!lineasPartidas.length) return {};

      // Helper: clave efectiva de solicitud — usa id_bc3, si es null cae a _num_id o token
      const getSolKey = s => String(s.id || s._num_id || s.token || '');

      // Proveedores: solicitudes reales con respuestas (cualquier oficio) + BC3 locales
      const provMap = new Map();
      allSolicitudes
        .filter(s => s.propuesta_id === proyectoSel && allRespuestas.some(r => String(r.solicitud_id) === getSolKey(s)))
        .forEach(s => {
          const sk = getSolKey(s);
          if (!provMap.has(sk))
            provMap.set(sk, { solicitud_id: sk, nombre: s.proveedor_nombre || s.proveedor_email || 'Proveedor', esLocal: false });
        });
      competenciasLocales.filter(c => c.proyecto === proyectoSel).forEach(comp => {
        provMap.set(comp.id, { solicitud_id: comp.id, nombre: '(COMP) ' + comp.nombre, esLocal: true, precios: comp.precios });
      });

      const proveedores = [...provMap.values()];
      if (!proveedores.length) return {};

      const respsMap = {};
      // Incluir también respuestas con solicitud_id nulo (dato antiguo sin id_bc3)
      allRespuestas.forEach(r => { if (r.partida_id) respsMap[`${String(r.solicitud_id)}__${r.partida_id}`] = r; });

      const filas = lineasPartidas.map(p => {
        // Inicializar todos los proveedores a null para evitar undefined en el render
        const precios = Object.fromEntries(proveedores.map(pr => [pr.solicitud_id, null]));
        let minPrecio = Infinity, minProvId = null;
        for (const prov of proveedores) {
          try {
            if (prov.esLocal) {
              const pCode = normalizeCode(p.codigo || (p.texto_partida ? p.texto_partida.split('::')[0] : ''));
              const precio = prov.precios[pCode];
              if (precio !== undefined) precios[prov.solicitud_id] = { precio: Number(precio) || 0 };
            } else {
              let resp = respsMap[`${prov.solicitud_id}__${p.id}`];
              if (!resp) {
                const pCode = normalizeCode(p.codigo || (p.texto_partida ? p.texto_partida.split('::')[0] : ''));
                if (pCode) resp = allRespuestas.find(r => String(r.solicitud_id) === prov.solicitud_id && normalizeCode(String(r.partida_id || '')) === pCode);
              }
              if (resp) precios[prov.solicitud_id] = { precio: Number(resp.precio_ofertado) || 0 };
            }
            const pr = precios[prov.solicitud_id]?.precio;
            if (pr > 0 && pr < minPrecio) { minPrecio = pr; minProvId = prov.solicitud_id; }
          } catch (_) { /* mantener null */ }
        }
        return { partida: p, precios, minProvId };
      });

      const totales = {};
      proveedores.forEach(prov => {
        totales[prov.solicitud_id] = filas.reduce((sum, { precios }) => sum + (precios[prov.solicitud_id]?.precio || 0), 0);
      });

      const presupuestoBase = lineasPartidas.reduce((sum, p) => sum + ((p.precio_base_estimado || 0) * (p.cantidad || 1)), 0);
      const key = `global__${proyectoSel}`;
      return { [key]: { oficio: 'Proyecto Completo', proyecto: proyectoSel, proveedores, filas, totales, presupuestoBase } };
    } catch (e) { console.error('Error comparativaGlobal:', e); return {}; }
  }, [allSolicitudes, allPartidas, allRespuestas, proyectoSel, competenciasLocales]);

  const comparativa = vista === 'proyectos' ? comparativaGlobal : comparativaOficios;


  // ─── 4. Adjudicar proveedor ───────────────────────────────────────────────
  const adjudicar = async (grupoKey, proveedorSolicitudId, isReset = false) => {
    setAdjudicando(grupoKey);
    try {
      const { oficio, proyecto, filas, proveedores } = comparativa[grupoKey];
      
      // Si es reset, limpiamos adjudicaciones previas
      if (isReset) {
        // 1. Limpiar partidas en BD
        await supabase.from('partidas').update({
          proveedor_adjudicado_id: null,
          precio_adjudicado: null,
          estado_adjudicacion: null
        }).eq('propuesta_id', proyecto).eq('oficio_asignado', oficio);

        // 2. Limpiar solicitudes en BD
        await supabase.from('solicitudes').update({
          estado_solicitud: 'Respondido'
        }).eq('propuesta_id', proyecto).eq('oficio_solicitado', oficio);

        // 3. Update State Local
        setAdjudicaciones(prev => { const n = { ...prev }; delete n[grupoKey]; return n; });
        if (setSessionCache) {
          setSessionCache(prev => { const copy = { ...prev }; delete copy[proyecto]; return copy; });
        }
        cargarTodo(); // Recargar para asegurar sincro
        return;
      }

      const prov = proveedores.find(p => p.solicitud_id === proveedorSolicitudId);
      if (!prov) throw new Error('Proveedor no encontrado');

      const updatePartidas = filas.map(({ partida, precios }) => {
        const resp = precios[proveedorSolicitudId];
        return supabase.from('partidas').update({
          proveedor_adjudicado_id: prov.proveedor_id,
          precio_adjudicado: resp?.precio || null,
          precio_base_estimado: resp?.precio || partida.precio_base_estimado,
          estado_adjudicacion: 'Adjudicado'
        }).eq('id', partida.id);
      });

      const updateSols = proveedores.map(p =>
        supabase.from('solicitudes').update({
          estado_solicitud: p.solicitud_id === proveedorSolicitudId ? 'Adjudicada' : 'Rechazada'
        }).eq('id', p.solicitud_id)
      );

      const results = await Promise.all([...updatePartidas, ...updateSols]);
      const hasError = results.find(r => r.error);
      if (hasError) throw hasError.error;

      // Notificar vía n8n (Fase 6) — webhook pendiente de crear en n8n
      // try {
      //   const { data: provExt } = await supabase
      //     .from('proveedores').select('email, nombre_empresa').eq('id', prov.proveedor_id).single();
      //   if (provExt?.email) {
      //     fetch(`${N8N_BASE_URL}/webhook/fase6-adjudicacion`, {
      //       method: 'POST',
      //       headers: { 'Content-Type': 'application/json' },
      //       body: JSON.stringify({
      //         proveedor_email: provExt.email,
      //         proveedor_nombre: provExt.nombre_empresa,
      //         proyecto_nombre: proyecto,
      //         oficio
      //       })
      //     }).catch(() => {});
      //   }
      // } catch (emailErr) { /* silencioso */ }

      setAdjudicaciones(prev => ({ ...prev, [grupoKey]: prov.proveedor_id }));
      // Invalidar sessionCache de Borradores para este proyecto, para que al abrir
      // el proyecto se recarguen los precios adjudicados frescos desde la BD.
      if (setSessionCache) {
        setSessionCache(prev => { const copy = { ...prev }; delete copy[proyecto]; return copy; });
      }
      cargarTodo(); // Recargar para sincronizar precios en todas las vistas
      showToast(`✅ Adjudicado a ${prov.nombre}. Los precios se reflejarán en Borradores al abrir el proyecto.`);

    } catch (err) {
      console.error('Error en adjudicación:', err);
      showToast('Error al adjudicar: ' + err.message, 'error');
    } finally {
      setAdjudicando(null);
    }
  };

  // ─── 4b. Eliminar Presupuesto ─────────────────────────────────────────────
  const deleteSolicitud = async (solicitudId) => {
    if (!solicitudId) return;

    // Si aún no hemos confirmado, abrimos el modal
    if (!confirmingDelete || confirmingDelete.id !== solicitudId) {
      const sol = allSolicitudes.find(s => s.id === solicitudId);
      setConfirmingDelete(sol || { id: solicitudId });
      return;
    }

    setLoading(true);
    try {
      // 1. Borrar respuestas asociadas
      await supabase.from('respuestas').delete().eq('solicitud_id', solicitudId);
      
      // 2. Borrar la solicitud por completo
      await supabase.from('solicitudes').delete().eq('id', solicitudId);

      setConfirmingDelete(null);
      await cargarTodo();
      showToast('Presupuesto eliminado correctamente.', 'warning');
    } catch (err) {
      console.error('Error al eliminar presupuesto:', err);
      showToast('No se pudo eliminar el presupuesto.', 'error');
    } finally {
      setLoading(false);
    }
  }

  // ─── 4c. Añadir Competencia ───────────────────────────────────────────────
  const handleOpenCompetencia = (grupoKey) => {
      setCompetenciaNombre('');
      setCompetenciaPrecios({});
      setModalCompetencia(grupoKey);
  };

  const handleGuardarCompetencia = async () => {
      if (!competenciaNombre.trim()) { showToast('Ponle un nombre al competidor.', 'error'); return; }
      setGuardandoCompetencia(true);
      try {
          const { proyecto } = comparativa[modalCompetencia];

          const newComp = {
              id: 'local-' + Date.now(),
              nombre: competenciaNombre.trim(),
              proyecto: proyecto,
              precios: {}
          };

          Object.keys(competenciaPrecios).forEach(partidaId => {
              const precio = parseFloat(competenciaPrecios[partidaId]);
              if (!isNaN(precio) && precio > 0) {
                  const capCode = normalizeCode(partidaId.replace(proyecto + '-', ''));
                  newComp.precios[capCode] = precio;
              }
          });

          setCompetenciasLocales(prev => [...prev, newComp]);
          showToast(`✅ Competidor "${competenciaNombre}" añadido correctamente.`, 'success');
          setModalCompetencia(null);
          setCompetenciaNombre('');
          setCompetenciaPrecios({});
      } catch (e) {
          console.error(e);
          showToast('Error al añadir competencia: ' + e.message, 'error');
      } finally {
          setGuardandoCompetencia(false);
      }
  };

  // ─── 4d. Añadir BC3 Global ───────────────────────────────────────────────
  const handleBc3FileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setBc3File(file);
      setBc3FileName(file.name);
    }
  };

  const handleBc3Drop = (e) => {
    e.preventDefault();
    setBc3DragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && file.name.toLowerCase().endsWith('.bc3')) {
      setBc3File(file);
      setBc3FileName(file.name);
    } else if (file) {
      showToast('Por favor, suelta un archivo .bc3 válido.', 'error');
    }
  };

  const handleGuardarBC3 = async () => {
    if (!bc3Project) { showToast('Selecciona el proyecto.', 'error'); return; }
    if (!bc3Name.trim()) { showToast('Ponle un nombre a la competencia.', 'error'); return; }
    if (!bc3File) { showToast('Selecciona un archivo BC3.', 'error'); return; }

    setBc3Loading(true);
    try {
      // 1. Leer archivo
      const text = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = () => reject(new Error('No se pudo leer el archivo BC3.'));
        reader.readAsText(bc3File, 'windows-1252');
      });

      // 2. Parsear con Worker (fichero dedicado — Vite resuelve sus imports).
      const itemsBC3 = await new Promise((resolve, reject) => {
        const worker = new Bc3Worker();
        const timeout = setTimeout(() => {
            worker.terminate();
            reject(new Error('Timeout de procesamiento.'));
        }, 30000);

        worker.onmessage = (e) => {
          clearTimeout(timeout);
          worker.terminate();
          if (e.data.success) resolve(e.data.data);
          else reject(new Error(e.data.error));
        };
        worker.onerror = () => {
          clearTimeout(timeout);
          worker.terminate();
          reject(new Error('Error en el Worker.'));
        };
        worker.postMessage({ text });
      });

      // 3. Crear objeto de competencia local (memoria)
      const newComp = {
          id: 'bc3-' + Date.now(),
          nombre: bc3Name.trim(),
          proyecto: bc3Project,
          precios: {}
      };

      itemsBC3.forEach(item => {
          const code = normalizeCode(item.Capítulo);
          if (code && item['Precio Total (€)'] > 0) {
              newComp.precios[code] = item['Precio Total (€)'];
          }
      });

      if (Object.keys(newComp.precios).length === 0) {
          throw new Error('No se han encontrado precios válidos en el archivo BC3.');
      }

      setCompetenciasLocales(prev => [...prev, newComp]);
      showToast(`✅ BC3 de "${bc3Name}" cargado correctamente.`, 'success');

      // Auto-seleccionar el proyecto y cambiar a la vista global para que se vea inmediatamente
      const targetProject = bc3Project;
      setModalBC3(false);
      setBc3File(null); setBc3FileName(''); setBc3Name(''); setBc3Project('');
      setProyectoSel(targetProject);
      setVista('proyectos');

    } catch (e) {
      console.error('[BC3] Error fatal:', e);
      showToast('❌ Error al procesar: ' + e.message, 'error');
    } finally {
      setBc3Loading(false);
    }
  };

  // ─── 5. Exportar Excel ─────────────────────────────────────────────────────
  const exportarExcel = () => {
    const wb = XLSX.utils.book_new();
    Object.values(comparativa).forEach(({ oficio, proyecto, proveedores, filas, totales, presupuestoBase }) => {
      const headers = ['Código', 'Descripción', 'Ud.', 'Cant.', 'Base (€)',
        ...proveedores.map(p => p.nombre), ...proveedores.map(p => `Obs. ${p.nombre}`)];
      const rows = filas.map(({ partida, precios }) => [
        partida.codigo || '', partida.texto_partida || '', partida.unidad || 'ud',
        partida.cantidad || 1, (partida.precio_base_estimado || 0) * (partida.cantidad || 1),
        ...proveedores.map(p => precios[p.solicitud_id]?.precio ?? ''),
        ...proveedores.map(p => precios[p.solicitud_id]?.comentario ?? '')
      ]);
      const filaTotales = ['', 'TOTAL', '', '', presupuestoBase.toFixed(2),
        ...proveedores.map(p => totales[p.solicitud_id]?.toFixed(2) ?? ''), ...proveedores.map(() => '')];
      const ws = XLSX.utils.aoa_to_sheet([headers, ...rows, filaTotales]);
      ws['!cols'] = [{ wch: 12 }, { wch: 48 }, { wch: 6 }, { wch: 6 }, { wch: 12 },
        ...proveedores.map(() => ({ wch: 14 })), ...proveedores.map(() => ({ wch: 18 }))];
      XLSX.utils.book_append_sheet(wb, ws, `${oficio}-${proyecto}`.substring(0, 31));
    });
    XLSX.writeFile(wb, `Comparativa_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const toggleGrupo = key => setOficiosAbiertos(prev => ({ ...prev, [key]: prev[key] !== false ? false : true }));

  const estadoBadge = estado => {
    if (!estado || estado === 'Pendiente' || estado === 'Enviado')
      return <span style={s.badgePendiente}><Clock size={12} /> {estado || 'Pendiente'}</span>;
    if (estado === 'Adjudicada')
      return <span style={s.badgeAdj2}><Trophy size={12} /> Adjudicada</span>;
    if (estado === 'Rechazada')
      return <span style={s.badgeAlert}><AlertCircle size={12} /> Rechazada</span>;
    return <span style={s.badgeOk}><CheckCircle size={12} /> {estado}</span>;
  };

  // Contadores para las pestañas
  const totalRespuestas = useMemo(() => {
    return allSolicitudes.filter(s => {
      if (proyectoSel && s.propuesta_id !== proyectoSel) return false;
      if (oficioSel && normalize(s.oficio_solicitado) !== normalize(oficioSel)) return false;
      return allRespuestas.some(r => String(r.solicitud_id) === String(s.id || s._num_id || s.token || ''));
    }).length;
  }, [allSolicitudes, allRespuestas, proyectoSel, oficioSel]);

  const totalGrupos = Object.keys(comparativa).length;

  return (
    <div style={s.page}>
      {ModalUI}
      {ToastUI}
      {/* CABECERA */}
      <div className="glass-card" style={{ marginBottom: '20px' }}>
        <div style={s.header}>
          <div style={{ flex: 1 }}>
          <h1 style={{ ...s.title,  display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '6px'  }}><BarChart2 size={32} color="var(--primary)" /> Comparativa de Presupuestos</h1>
          <p style={s.subtitle}>
            {loading ? 'Cargando...' : `${totalRespuestas} respuesta(s) recibida(s) · ${totalGrupos} grupo(s) comparables`}
          </p>
        </div>
        <button onClick={cargarTodo} disabled={loading} style={s.btnRefresh}>
          <RefreshCw size={15} className={loading ? 'loader-spinner' : ''} /> Actualizar
        </button>
        <button onClick={() => setModalBC3(true)} style={{ ...s.btnExport, background: '#8b5cf6' }}>
          <Upload size={16} /> Añadir Competencia (BC3 Global)
        </button>
        {totalGrupos > 0 && (
          <button onClick={exportarExcel} style={s.btnExport}>
            <Download size={16} /> Exportar Excel
          </button>
        )}
        </div>
      </div>

      {/* FILTROS */}
      <div style={s.filtros}>
        <div style={s.filtroGroup}>
          <label style={s.label}>Filtrar por proyecto</label>
          <select style={s.select} value={proyectoSel} onChange={e => { setProyectoSel(e.target.value); setOficioSel(''); }}>
            <option value="">— Todos los proyectos —</option>
            {proyectosUnicos.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div style={s.filtroGroup}>
          <label style={s.label}>Filtrar por oficio</label>
          <select style={s.select} value={oficioSel} onChange={e => setOficioSel(e.target.value)}>
            <option value="">— Todos los oficios —</option>
            {oficiosUnicos.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        {(proyectoSel || oficioSel) && (
          <button
            onClick={() => { setProyectoSel(''); setOficioSel(''); }}
            style={{ alignSelf: 'flex-end', padding: '8px 14px', background: '#e5edf7', border: '1px solid #c7d5e6', borderRadius: 8, cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', gap: 5 }}
          >
            <X size={13} /> Quitar filtros
          </button>
        )}
      </div>

      {/* SELECTOR DE VISTA */}
      <div style={s.tabBar}>
        <button
          style={{ ...s.tab, ...(vista === 'feed' ? s.tabActive : {}) }}
          onClick={() => setVista('feed')}
        >
          <Inbox size={15} />
          Presupuestos Recibidos
          {totalRespuestas > 0 && (
            <span style={s.tabBadge}>{totalRespuestas}</span>
          )}
        </button>
        <button
          style={{ ...s.tab, ...(vista === 'comparativa' ? s.tabActive : {}) }}
          onClick={() => setVista('comparativa')}
        >
          <BarChart2 size={15} />
          Comparativa por Oficio (Adjudicación)
        </button>

        <button
          style={{ ...s.tab, ...(vista === 'proyectos' ? s.tabActive : {}) }}
          onClick={() => setVista('proyectos')}
        >
          <Briefcase size={15} />
          Comparativa Global Proyecto
        </button>
      </div>

      {loading && <div style={s.loading}>Cargando presupuestos recibidos...</div>}

      {!loading && (
        <>
          {vista === 'feed' && (
            <FeedPresupuestos
              solicitudes={allSolicitudes}
              respuestas={allRespuestas}
              partidas={allPartidas}
              allPartidas={allPartidas}
              propuestas={allPropuestas}
              proyectoSel={proyectoSel}
              oficioSel={oficioSel}
              deleteSolicitud={deleteSolicitud}
            />
          )}
          {vista === 'comparativa' && (
            <ComparativaAgrupada
              comparativa={comparativa}
              oficiosAbiertos={oficiosAbiertos}
              toggleGrupo={toggleGrupo}
              adjudicaciones={adjudicaciones}
              adjudicar={adjudicar}
              adjudicando={adjudicando}
              estadoBadge={estadoBadge}
              propuestas={allPropuestas}
              allSolicitudes={allSolicitudes}
              openModalCompetencia={handleOpenCompetencia}
              hideCompetitors={true}
              deleteSolicitud={deleteSolicitud}
            />
          )}
          {vista === 'proyectos' && (
            !proyectoSel ? (
              <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
                <Briefcase size={48} color="var(--accent-primary)" style={{ opacity: 0.4, marginBottom: 16 }} />
                <h3 style={{ margin: '0 0 8px', color: 'var(--text-primary)' }}>Selecciona un proyecto</h3>
                <p style={{ margin: '0 0 20px', fontSize: '0.9rem' }}>
                  Elige un proyecto en el filtro superior y luego sube un BC3 de competencia para comparar.
                </p>
                <button onClick={() => setModalBC3(true)} style={{ padding: '10px 20px', borderRadius: 8, background: 'var(--accent-primary)', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <Upload size={16} /> Añadir Competencia (BC3)
                </button>
              </div>
            ) : Object.keys(comparativaGlobal).length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
                <BarChart2 size={48} color="var(--accent-primary)" style={{ opacity: 0.4, marginBottom: 16 }} />
                <h3 style={{ margin: '0 0 8px', color: 'var(--text-primary)' }}>No hay datos comparables aún</h3>
                <h3 style={{ margin: '0 0 4px', fontSize: '1.4rem' }}>
                    {(() => {
                      const pData = allPropuestas.find(p => p.Proyecto === proyectoSel);
                      const pId = proyectoSel || '';
                      return pData?.cliente ? `${pId.split('_')[0]} - ${pData.cliente}` : pId.split('_')[0];
                    })()}
                </h3>
                <p style={{ margin: '0 0 20px', fontSize: '0.9rem' }}>
                  Sube un BC3 de un competidor para ver la comparativa del proyecto <strong>{proyectoSel}</strong>.
                </p>
                <button onClick={() => setModalBC3(true)} style={{ padding: '10px 20px', borderRadius: 8, background: '#8b5cf6', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <Upload size={16} /> Añadir Competencia (BC3)
                </button>
              </div>
            ) : (
              <ComparativaAgrupada
                comparativa={comparativaGlobal}
                oficiosAbiertos={oficiosAbiertos}
                toggleGrupo={toggleGrupo}
                adjudicaciones={adjudicaciones}
                adjudicar={adjudicar}
                adjudicando={adjudicando}
                estadoBadge={estadoBadge}
                propuestas={allPropuestas}
                openModalCompetencia={handleOpenCompetencia}
                isGlobalView={true}
              />
            )
          )}
        </>
      )}
      {/* MODAL DE CONFIRMACIÓN DE BORRADO */}
      {confirmingDelete && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, 
          backgroundColor: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)',
          zIndex: 9999, display: 'flex', justifyContent: 'center', alignItems: 'center',
          animation: 'fadeIn 0.2s ease-out'
        }}>
          <div style={{
            background: 'white', padding: '30px', borderRadius: '16px',
            maxWidth: '420px', width: '90%', textAlign: 'center',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
            border: '1px solid #fee2e2'
          }}>
            <div style={{ 
              width: '60px', height: '60px', background: '#fee2e2', borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 20px'
            }}>
              <X size={30} color="#dc2626" />
            </div>
            <h3 style={{ margin: '0 0 10px', fontSize: '1.25rem', fontWeight: 700, color: '#111827' }}>
              ¿Eliminar presupuesto?
            </h3>
            <p style={{ margin: '0 0 24px', fontSize: '0.95rem', color: '#6b7280', lineHeight: 1.5 }}>
              Vas a eliminar las respuestas de <strong>{confirmingDelete.proveedor_nombre || confirmingDelete.proveedor_email || 'este proveedor'}</strong>. 
              Esta acción reseteará la solicitud pero borrará todos los precios recibidos.
            </p>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button 
                onClick={() => setConfirmingDelete(null)}
                style={{ 
                  flex: 1, padding: '12px', borderRadius: '10px', border: '1px solid #c7d5e6',
                  background: 'white', color: '#374151', fontWeight: 600, cursor: 'pointer'
                }}
              >
                Cancelar
              </button>
              <button 
                onClick={() => deleteSolicitud(confirmingDelete.id)}
                style={{ 
                  flex: 1, padding: '12px', borderRadius: '10px', border: 'none',
                  background: '#dc2626', color: 'white', fontWeight: 600, cursor: 'pointer',
                  boxShadow: '0 4px 6px -1px rgba(220, 38, 38, 0.2)'
                }}
              >
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE COMPETENCIA */}
      {modalCompetencia && comparativa[modalCompetencia] && (
          <div style={{
              position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, 
              backgroundColor: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)',
              zIndex: 9999, display: 'flex', justifyContent: 'center', alignItems: 'center',
              animation: 'fadeIn 0.2s ease-out'
          }}>
              <div style={{
                  background: 'white', padding: '24px', borderRadius: '12px',
                  width: '90%', maxWidth: '800px', maxHeight: '90vh', display: 'flex', flexDirection: 'column',
                  boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)'
              }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                      <h3 style={{ margin: 0, fontSize: '1.25rem', color: '#111827' }}>
                          Añadir Oferta de Competencia <br/>
                          <small style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>{comparativa[modalCompetencia].oficio}</small>
                      </h3>
                      <button onClick={() => setModalCompetencia(null)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                          <X size={24} color="#6b7280" />
                      </button>
                  </div>

                  <div style={{ marginBottom: '15px' }}>
                      <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, fontSize: '0.9rem' }}>Nombre de la Empresa Competidora:</label>
                      <input 
                          type="text" 
                          value={competenciaNombre}
                          onChange={e => setCompetenciaNombre(e.target.value)}
                          placeholder="Ej. Reformas Paco S.L."
                          style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #c7d5e6', fontSize: '1rem' }}
                      />
                  </div>

                  <div style={{ overflowY: 'auto', flex: 1, border: '1px solid #c7d5e6', borderRadius: '8px', marginBottom: '20px' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                          <thead style={{ position: 'sticky', top: 0, background: '#e5edf7' }}>
                              <tr>
                                  <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid #c7d5e6' }}>Partida</th>
                                  <th style={{ padding: '8px', textAlign: 'center', borderBottom: '1px solid #c7d5e6', width: '60px' }}>Cant.</th>
                                  <th style={{ padding: '8px', textAlign: 'right', borderBottom: '1px solid #c7d5e6', width: '150px' }}>Precio Competidor (€)</th>
                              </tr>
                          </thead>
                          <tbody>
                              {comparativa[modalCompetencia].filas.map(({ partida }) => (
                                  <tr key={partida.id} style={{ borderBottom: '1px solid #e5edf7' }}>
                                      <td style={{ padding: '8px', color: '#374151' }}>{partida.texto_descripcion || partida.texto_partida}</td>
                                      <td style={{ padding: '8px', textAlign: 'center', color: '#6b7280' }}>{partida.cantidad || 1}</td>
                                      <td style={{ padding: '8px', textAlign: 'right' }}>
                                          <input
                                              type="text"
                                              placeholder="0,00"
                                              value={rawCompetencia[partida.id] ?? (competenciaPrecios[partida.id] ? formatDecimal(competenciaPrecios[partida.id]) : '')}
                                              onChange={(e) => setRawCompetencia({ ...rawCompetencia, [partida.id]: e.target.value })}
                                              onBlur={(e) => {
                                                  const v = parseDecimal(e.target.value);
                                                  setCompetenciaPrecios({ ...competenciaPrecios, [partida.id]: v });
                                                  setRawCompetencia(prev => { const n = { ...prev }; delete n[partida.id]; return n; });
                                              }}
                                              style={{ width: '100px', padding: '6px', textAlign: 'right', borderRadius: '4px', border: '1px solid #c7d5e6' }}
                                          />
                                      </td>
                                  </tr>
                              ))}
                          </tbody>
                      </table>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                      <button 
                          onClick={() => setModalCompetencia(null)}
                          style={{ padding: '10px 16px', borderRadius: '8px', border: '1px solid #c7d5e6', background: 'white', cursor: 'pointer', fontWeight: 600 }}
                      >
                          Cancelar
                      </button>
                      <button 
                          onClick={handleGuardarCompetencia}
                          disabled={guardandoCompetencia}
                          style={{ padding: '10px 16px', borderRadius: '8px', border: 'none', background: '#002D54', color: 'white', cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}
                      >
                          {guardandoCompetencia ? 'Guardando...' : 'Guardar y Comparar'}
                      </button>
                  </div>
              </div>
          </div>
      )}

      {/* MODAL DE BC3 GLOBAL */}
      {modalBC3 && (
          <div style={{
              position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, 
              backgroundColor: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)',
              zIndex: 9999, display: 'flex', justifyContent: 'center', alignItems: 'center',
              animation: 'fadeIn 0.2s ease-out'
          }}>
              <div style={{
                  background: 'white', padding: '24px', borderRadius: '12px',
                  width: '90%', maxWidth: '500px', display: 'flex', flexDirection: 'column',
                  boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)'
              }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                      <h3 style={{ margin: 0, fontSize: '1.25rem', color: '#111827' }}>
                          Añadir BC3 de la Competencia
                      </h3>
                      <button onClick={() => { setModalBC3(false); setBc3DragOver(false); }} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                          <X size={24} color="#6b7280" />
                      </button>
                  </div>

                  <div style={{ marginBottom: '15px' }}>
                      <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, fontSize: '0.9rem' }}>Proyecto Destino:</label>
                      <select 
                          value={bc3Project} 
                          onChange={e => setBc3Project(e.target.value)}
                          style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #c7d5e6', fontSize: '1rem' }}
                      >
                          <option value="">-- Selecciona el proyecto --</option>
                          {proyectosUnicos.map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                  </div>

                  <div style={{ marginBottom: '15px' }}>
                      <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, fontSize: '0.9rem' }}>Nombre de la Competencia:</label>
                      <input 
                          type="text" 
                          value={bc3Name}
                          onChange={e => setBc3Name(e.target.value)}
                          placeholder="Ej. Obras Paco S.L."
                          style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #c7d5e6', fontSize: '1rem' }}
                      />
                  </div>

                  <div style={{ marginBottom: '25px' }}>
                      <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, fontSize: '0.9rem' }}>Archivo BC3:</label>
                      <label
                          style={{
                              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                              padding: '24px 20px', borderRadius: '8px', cursor: 'pointer', transition: 'border .2s, background .2s',
                              border: bc3DragOver ? '2px dashed #8b5cf6' : (bc3File ? '2px solid #059669' : '2px dashed #c7d5e6'),
                              background: bc3DragOver ? '#f5f3ff' : (bc3File ? '#ecfdf5' : '#e5edf7'),
                          }}
                          onDragOver={(e) => { e.preventDefault(); setBc3DragOver(true); }}
                          onDragLeave={() => setBc3DragOver(false)}
                          onDrop={handleBc3Drop}
                      >
                          <Upload size={32} color={bc3DragOver ? '#8b5cf6' : bc3File ? '#059669' : '#9ca3af'} style={{ marginBottom: '10px' }} />
                          <span style={{ fontSize: '0.9rem', color: bc3File ? '#059669' : '#6b7280', fontWeight: 500, textAlign: 'center' }}>
                              {bc3FileName || (bc3DragOver ? 'Suelta el archivo .bc3 aquí' : 'Arrastra el .bc3 aquí o haz clic para buscar')}
                          </span>
                          {!bc3File && (
                              <span style={{ fontSize: '0.78rem', color: '#9ca3af', marginTop: 4 }}>Solo archivos .bc3</span>
                          )}
                          <input
                              type="file"
                              accept=".bc3"
                              onChange={handleBc3FileChange}
                              style={{ display: 'none' }}
                          />
                      </label>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                      <button
                          onClick={() => { setModalBC3(false); setBc3DragOver(false); }}
                          style={{ padding: '10px 16px', borderRadius: '8px', border: '1px solid #c7d5e6', background: 'white', cursor: 'pointer', fontWeight: 600 }}
                      >
                          Cancelar
                      </button>
                      <button 
                          onClick={handleGuardarBC3}
                          disabled={bc3Loading}
                          style={{ padding: '10px 16px', borderRadius: '8px', border: 'none', background: '#8b5cf6', color: 'white', cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}
                      >
                          {bc3Loading ? <Loader2 className="loader-spinner" size={18} /> : null}
                          {bc3Loading ? 'Procesando...' : 'Procesar BC3'}
                      </button>
                  </div>
              </div>
          </div>
      )}

      {/* Estilos globales de animación */}
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .loader-spinner { animation: spin 1s linear infinite; }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}


// ─── Estilos ──────────────────────────────────────────────────────────────────
const s = {
  page:           { padding: '24px', fontFamily: 'system-ui, sans-serif' },
  header:         { display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24, flexWrap: 'wrap' },
  headerIcon:     { background: 'var(--bg-secondary,#e5edf7)', borderRadius: 12, padding: 10, display: 'flex', alignItems: 'center' },
  title:          { margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--text-main,#1D1D1B)' },
  subtitle:       { margin: '4px 0 0', color: 'var(--text-muted,#50504d)', fontSize: 14 },
  btnExport:      { display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 18px', background: '#16a34a', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 14 },
  btnRefresh:     { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 14px', background: 'var(--bg-secondary,#e5edf7)', color: 'var(--text-main,#1D1D1B)', border: '1px solid #c7d5e6', borderRadius: 8, cursor: 'pointer', fontSize: 13 },
  filtros:        { display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap', alignItems: 'flex-end' },
  filtroGroup:    { display: 'flex', flexDirection: 'column', gap: 6, minWidth: 240 },
  label:          { fontSize: 13, fontWeight: 600, color: 'var(--text-muted,#50504d)' },
  select:         { padding: '8px 12px', borderRadius: 8, border: '1px solid #c7d5e6', background: 'var(--bg-card,white)', fontSize: 14, cursor: 'pointer' },
  loading:        { textAlign: 'center', padding: 40, color: '#50504d' },
  empty:          { textAlign: 'center', padding: '48px 32px', color: '#7a7a77', fontSize: 15, background: 'var(--bg-card,white)', borderRadius: 12, border: '1px dashed #c7d5e6' },
  // Tab bar
  tabBar:         { display: 'flex', gap: 4, marginBottom: 20, background: 'var(--bg-secondary,#e5edf7)', borderRadius: 10, padding: 4, width: 'fit-content' },
  tab:            { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600, background: 'transparent', color: '#50504d', transition: 'all .15s' },
  tabActive:      { background: 'white', color: '#1D1D1B', boxShadow: '0 1px 4px rgba(0,0,0,.1)' },
  tabBadge:       { background: '#c7d5e6', color: 'var(--primary)', borderRadius: 10, fontSize: 11, fontWeight: 700, padding: '1px 7px', minWidth: 20, textAlign: 'center' },
  // Feed cards
  emptyFeed:      { textAlign: 'center', padding: '60px 32px', background: 'var(--bg-card,white)', borderRadius: 12, border: '1px dashed #c7d5e6', display: 'flex', flexDirection: 'column', alignItems: 'center' },
  feedCard:       { border: '1px solid #c7d5e6', borderRadius: 12, background: 'var(--bg-card,white)', overflow: 'hidden' },
  feedCardHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', background: 'var(--bg-secondary,#e5edf7)', flexWrap: 'wrap', gap: 10, borderBottom: '1px solid #c7d5e6' },
  feedCardLeft:   { display: 'flex', alignItems: 'center', gap: 12 },
  feedIcon:       { width: 36, height: 36, borderRadius: 10, background: '#e5edf7', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  feedProvNombre: { fontSize: 15, fontWeight: 700, color: '#1D1D1B' },
  feedProvEmail:  { fontSize: 12, color: '#50504d', marginTop: 1 },
  feedMeta:       { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  feedBadgeOficio:   { display: 'inline-flex', alignItems: 'center', background: '#ede9fe', color: '#5b21b6', padding: '3px 10px', borderRadius: 10, fontSize: 12, fontWeight: 600 },
  feedBadgeProyecto: { background: '#e5edf7', color: '#1D1D1B', padding: '3px 8px', borderRadius: 10, fontSize: 11 },
  feedBadgeFecha:    { display: 'inline-flex', alignItems: 'center', background: '#e5edf7', color: '#50504d', padding: '3px 8px', borderRadius: 10, fontSize: 11 },
  btnIcon:           { background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 4, borderRadius: 4, transition: 'background .2s' },

  feedTableWrapper:  { overflowX: 'auto' },
  feedTable:         { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  feedTh:            { padding: '9px 14px', background: '#e5edf7', borderBottom: '1px solid #c7d5e6', fontWeight: 700, color: '#1D1D1B', textAlign: 'right', whiteSpace: 'nowrap' },
  feedTr:            { borderBottom: '1px solid #e5edf7' },
  feedTd:            { padding: '10px 14px', verticalAlign: 'top' },
  // Comparativa agrupada
  card:           { marginBottom: 20, border: '1px solid #c7d5e6', borderRadius: 12, overflow: 'hidden', background: 'var(--bg-card,white)' },
  cardHeader:     { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', cursor: 'pointer', background: 'var(--bg-secondary,#e5edf7)', flexWrap: 'wrap', gap: 10 },
  cardHeaderLeft: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  cardTitle:      { margin: 0, fontSize: 16, fontWeight: 700 },
  badge:          { background: '#c7d5e6', color: 'var(--primary)', padding: '2px 8px', borderRadius: 12, fontSize: 12, fontWeight: 600 },
  badgeProyecto:  { background: '#e5edf7', color: '#1D1D1B', padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 500, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  badgeWinner:    { display: 'inline-flex', alignItems: 'center', gap: 4, background: '#fef9c3', color: '#854d0e', padding: '3px 10px', borderRadius: 12, fontSize: 12, fontWeight: 700 },
  badgePendiente: { display: 'inline-flex', alignItems: 'center', gap: 4, background: '#fef3c7', color: '#92400e', padding: '2px 6px', borderRadius: 10, fontSize: 11, fontWeight: 600 },
  badgeOk:        { display: 'inline-flex', alignItems: 'center', gap: 4, background: '#d1fae5', color: '#065f46', padding: '2px 6px', borderRadius: 10, fontSize: 11, fontWeight: 600 },
  badgeAdj2:      { display: 'inline-flex', alignItems: 'center', gap: 4, background: '#c7d5e6', color: 'var(--primary)', padding: '2px 6px', borderRadius: 10, fontSize: 11, fontWeight: 600 },
  badgeAlert:     { display: 'inline-flex', alignItems: 'center', gap: 4, background: '#fee2e2', color: '#991b1b', padding: '2px 6px', borderRadius: 10, fontSize: 11, fontWeight: 600 },
  ahorroPos:      { display: 'inline-flex', alignItems: 'center', gap: 4, color: '#059669', fontWeight: 700, fontSize: 13 },
  ahorroNeg:      { display: 'inline-flex', alignItems: 'center', gap: 4, color: '#dc2626', fontWeight: 700, fontSize: 13 },
  adjudicarBar:   { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px', background: '#e5edf7', borderBottom: '1px solid #c7d5e6', flexWrap: 'wrap' },
  btnAdjudicar:   { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', background: 'var(--primary)', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13 },
  tableWrapper:   { overflowX: 'auto' },
  table:          { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th:             { padding: '10px 12px', background: '#e5edf7', borderBottom: '2px solid #c7d5e6', fontWeight: 700, color: '#1D1D1B', textAlign: 'right', whiteSpace: 'nowrap' },
  tr:             { borderBottom: '1px solid #e5edf7' },
  td:             { padding: '10px 12px', verticalAlign: 'top' },
  comentario:     { fontSize: 11, color: '#50504d', marginTop: 4, fontStyle: 'italic', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
};
