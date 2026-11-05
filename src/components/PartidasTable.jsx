import React, { useState, useMemo } from 'react';
import { Trophy, MessageSquare, ChevronDown, ChevronRight, ChevronsUpDown } from 'lucide-react';
import { formatDecimal, parseDecimal, fmtEuro, aplicarBeneficio } from '../utils/format';
import {
  getTipoFila,
  calcularTotalesCapitulos,
  obtenerJerarquiaFila,
  inferirCapituloPadre,
  parseMedicionesGuardadas,
} from '../utils/partidas';

const fmtMedNum = (v) =>
  v === null || v === undefined || v === ''
    ? '—'
    : Number(v).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 3 });

const renderDescripcionPartida = (desc, esPartida) => {
  if (!esPartida || typeof desc !== 'string' || !desc.includes(' — ')) {
    return desc;
  }
  const sepIdx = desc.indexOf(' — ');
  const resumen = desc.slice(0, sepIdx);
  const detalle = desc.slice(sepIdx + 3);
  return (
    <>
      <strong style={{ color: 'var(--primary)', fontWeight: 700 }}>{resumen}</strong>
      {' — '}
      <span>{detalle}</span>
    </>
  );
};

/**
 * Componente compartido de tabla jerárquica de partidas para Borradores y Jefes de Obra.
 * - Muestra totales de Coste y PVP (con beneficio) en capítulos, subcapítulos y partidas.
 * - Permite plegar/desplegar capítulos (ocultando sus subcapítulos/partidas) y subcapítulos (ocultando sus partidas).
 * - Muestra botón "P" debajo de Ud. para expandir/colapsar el desglose de medición (~M) por partida o globalmente.
 * - Encapsula el buffer de edición decimal (`rawInputs`) y utiliza clases CSS de `src/index.css`.
 */
const PartidasTable = ({
  mode = 'borradores',
  partidas = [],
  beneficioPct = 0,
  listaOficios = [],
  respuestasPorPartida = {},
  expandedMediciones: externalExpandedMediciones,
  onExpandedMedicionesChange,
  onUpdateCantidad,
  onUpdateUnidad,
  onUpdatePrice,
  onUpdateOficio,
  onUpdateProveedor,
  onToggleAprobado,
  onToggleAllAprobado,
  onOpenComentario,
}) => {
  const [rawInputs, setRawInputs] = useState({});
  const [collapsedCaps, setCollapsedCaps] = useState(() => new Set());
  const [collapsedSubcaps, setCollapsedSubcaps] = useState(() => new Set());
  const [internalExpandedMediciones, setInternalExpandedMediciones] = useState(() => new Set());

  const isControlledMediciones = externalExpandedMediciones !== undefined;
  const expandedMediciones = isControlledMediciones ? externalExpandedMediciones : internalExpandedMediciones;

  const setExpandedMedicionesState = (updater) => {
    const nextVal = typeof updater === 'function' ? updater(expandedMediciones) : updater;
    if (!isControlledMediciones) {
      setInternalExpandedMediciones(nextVal);
    }
    if (typeof onExpandedMedicionesChange === 'function') {
      onExpandedMedicionesChange(nextVal);
    }
  };

  const isJefes = mode === 'jefes';

  // Partidas enriquecidas con capitulo_codigo inferido (para proyectos antiguos sin capitulo_codigo en BD)
  const partidasConJerarquia = useMemo(() => inferirCapituloPadre(partidas), [partidas]);

  // Costes totales acumulados por capítulo y subcapítulo
  const totalesCoste = useMemo(
    () => calcularTotalesCapitulos(partidasConJerarquia),
    [partidasConJerarquia]
  );

  // Conjuntos de códigos limpios de capítulos, subcapítulos y partidas con medición presentes en la tabla
  const { capitulosCodigos, subcapitulosCodigos, extrasIdx, indicesConMedicion } = useMemo(() => {
    const caps = new Set();
    const subcaps = new Set();
    const medIndices = new Set();
    let extIdx = -1;
    partidasConJerarquia.forEach((p, i) => {
      const tipo = getTipoFila(p);
      const limpio = (p.Capítulo || '').replace(/#+$/, '').trim();
      if (tipo === 'capitulo') {
        caps.add(limpio);
        if (limpio === '99_EXTRAS') extIdx = i;
      } else if (tipo === 'subcapitulo') {
        subcaps.add(limpio);
      } else if (tipo === 'partida') {
        const meds = parseMedicionesGuardadas(p);
        if (meds.length > 0) medIndices.add(i);
      }
    });
    return {
      capitulosCodigos: caps,
      subcapitulosCodigos: subcaps,
      extrasIdx: extIdx,
      indicesConMedicion: medIndices,
    };
  }, [partidasConJerarquia]);

  const toggleCapitulo = (capCod) => {
    setCollapsedCaps((prev) => {
      const next = new Set(prev);
      if (next.has(capCod)) next.delete(capCod);
      else next.add(capCod);
      return next;
    });
  };

  const toggleSubcapitulo = (subcapCod) => {
    setCollapsedSubcaps((prev) => {
      const next = new Set(prev);
      if (next.has(subcapCod)) next.delete(subcapCod);
      else next.add(subcapCod);
      return next;
    });
  };

  const toggleMedicion = (idx) => {
    setExpandedMedicionesState((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const allCapsCollapsed =
    capitulosCodigos.size > 0 && collapsedCaps.size >= capitulosCodigos.size;
  const allSubcapsCollapsed =
    subcapitulosCodigos.size > 0 && collapsedSubcaps.size >= subcapitulosCodigos.size;
  const allMedicionesExpanded =
    indicesConMedicion.size > 0 &&
    Array.from(indicesConMedicion).every((idx) => expandedMediciones.has(idx));

  const handleToggleAllCaps = () => {
    if (allCapsCollapsed) {
      setCollapsedCaps(new Set());
      setCollapsedSubcaps(new Set());
    } else {
      setCollapsedCaps(new Set(capitulosCodigos));
    }
  };

  const handleToggleAllSubcaps = () => {
    if (allSubcapsCollapsed) {
      setCollapsedSubcaps(new Set());
    } else {
      setCollapsedCaps(new Set());
      setCollapsedSubcaps(new Set(subcapitulosCodigos));
    }
  };

  const handleToggleAllMediciones = () => {
    if (allMedicionesExpanded) {
      setExpandedMedicionesState(new Set());
    } else {
      setCollapsedCaps(new Set());
      setCollapsedSubcaps(new Set());
      setExpandedMedicionesState(new Set(indicesConMedicion));
    }
  };

  const partidasReales = isJefes
    ? partidasConJerarquia.filter((p) => getTipoFila(p) === 'partida')
    : [];
  const allApproved =
    isJefes && partidasReales.length > 0 && partidasReales.every((p) => p.aprobado);

  const renderMedicionSubrow = (p, idx, mediciones, colSpan) => {
    const capClean = (p.Capítulo || '').replace(/#+/g, '');
    const ud = (p['Unidad IA'] || p.unidad || p.Unidad || '').trim();
    const cantTotal = parseFloat(p.Cantidad) || 0;
    return (
      <tr key={`med_${idx}`} className="pt-row-medicion">
        <td colSpan={colSpan}>
          <div className="pt-medicion-box">
            <div className="pt-medicion-header">
              <span>
                Desglose de medición — Partida {capClean} ({mediciones.length}{' '}
                {mediciones.length === 1 ? 'línea' : 'líneas'})
              </span>
              <span>
                Total: {fmtMedNum(cantTotal)} {ud}
              </span>
            </div>
            <table className="pt-medicion-table">
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Comentario / Descripción</th>
                  <th style={{ textAlign: 'right', width: '75px' }}>Uds.</th>
                  <th style={{ textAlign: 'right', width: '85px' }}>Longitud</th>
                  <th style={{ textAlign: 'right', width: '85px' }}>Anchura</th>
                  <th style={{ textAlign: 'right', width: '85px' }}>Altura</th>
                  <th style={{ textAlign: 'right', width: '95px' }}>Parcial</th>
                </tr>
              </thead>
              <tbody>
                {mediciones.map((m, mIdx) => (
                  <tr key={mIdx}>
                    <td style={{ textAlign: 'left' }}>{m.comentario || '—'}</td>
                    <td style={{ textAlign: 'right' }}>{fmtMedNum(m.uds)}</td>
                    <td style={{ textAlign: 'right' }}>{fmtMedNum(m.largo)}</td>
                    <td style={{ textAlign: 'right' }}>{fmtMedNum(m.ancho)}</td>
                    <td style={{ textAlign: 'right' }}>{fmtMedNum(m.alto)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtMedNum(m.parcial)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={5} style={{ textAlign: 'right' }}>
                    Total medición {ud ? `(${ud})` : ''}
                  </td>
                  <td style={{ textAlign: 'right' }}>{fmtMedNum(cantTotal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </td>
      </tr>
    );
  };

  return (
    <div className="table-container">
      {(capitulosCodigos.size > 0 || indicesConMedicion.size > 0) && (
        <div className="pt-toolbar">
          {indicesConMedicion.size > 0 && (
            <button
              type="button"
              className={`pt-btn-collapse-all ${allMedicionesExpanded ? 'pt-btn-medicion-global-active' : ''}`}
              onClick={handleToggleAllMediciones}
              title="Muestra u oculta el desglose de medición (P) de todas las partidas que tengan líneas de medición"
            >
              <span className="pt-badge-p-inline">P</span>
              {allMedicionesExpanded
                ? `Ocultar mediciones (${indicesConMedicion.size})`
                : `Mostrar mediciones (${indicesConMedicion.size})`}
            </button>
          )}
          {subcapitulosCodigos.size > 0 && (
            <button
              type="button"
              className="pt-btn-collapse-all"
              onClick={handleToggleAllSubcaps}
              title="Mantiene visibles los capítulos y subcapítulos plegando únicamente las partidas"
            >
              <ChevronsUpDown size={14} />
              {allSubcapsCollapsed ? 'Desplegar partidas' : 'Plegar partidas (ver subcapítulos)'}
            </button>
          )}
          {capitulosCodigos.size > 0 && (
            <button
              type="button"
              className="pt-btn-collapse-all"
              onClick={handleToggleAllCaps}
              title="Pliega o despliega todos los capítulos de la tabla"
            >
              <ChevronsUpDown size={14} />
              {allCapsCollapsed ? 'Desplegar todo' : 'Plegar capítulos'}
            </button>
          )}
        </div>
      )}
      <table style={isJefes ? { borderCollapse: 'collapse' } : undefined}>
        <thead>
          {isJefes ? (
            <tr>
              <th style={{ width: '50px', textAlign: 'center' }}>
                <input
                  type="checkbox"
                  onChange={onToggleAllAprobado}
                  checked={allApproved}
                  style={{ transform: 'scale(1.2)', cursor: 'pointer' }}
                  title="Marcar / Desmarcar todas"
                />
              </th>
              <th style={{ width: '85px' }}>Capítulo</th>
              <th>Descripción</th>
              <th style={{ width: '60px', textAlign: 'center' }}>Cant.</th>
              <th style={{ width: '55px', textAlign: 'center' }}>Ud.</th>
              <th style={{ width: '120px' }}>Oficio</th>
              <th>Proveedor / Oferta</th>
              <th style={{ width: '95px', textAlign: 'right' }}>Precio/ud (€)</th>
              <th style={{ width: '105px', textAlign: 'right' }}>Coste (€)</th>
              <th style={{ width: '110px', textAlign: 'right' }}>PVP (€)</th>
            </tr>
          ) : (
            <tr>
              <th style={{ width: '85px' }}>Cap.</th>
              <th>Descripción de la Partida</th>
              <th style={{ width: '75px', textAlign: 'center' }}>Cant.</th>
              <th style={{ width: '60px', textAlign: 'center' }}>Ud.</th>
              <th style={{ width: '115px', textAlign: 'right' }}>Precio/ud (€)</th>
              <th style={{ width: '115px', textAlign: 'right' }}>Coste (€)</th>
              <th style={{ width: '115px', textAlign: 'right' }}>PVP (€)</th>
              <th style={{ width: '105px', textAlign: 'right' }}>Est. IA (€)</th>
              <th style={{ width: '180px' }}>Oficio Asignado</th>
            </tr>
          )}
        </thead>
        <tbody>
          {partidasConJerarquia.map((p, idx) => {
            const tipoFila = getTipoFila(p);
            const esCapitulo = tipoFila === 'capitulo';
            const esSubcapitulo = tipoFila === 'subcapitulo';
            const esPartida = tipoFila === 'partida';
            const enExtras = extrasIdx !== -1 && idx > extrasIdx;

            const { capRoot, subcapParent } = obtenerJerarquiaFila(
              p,
              subcapitulosCodigos,
              enExtras
            );

            // Lógica de visibilidad por plegado:
            // - Si es subcapítulo y su capítulo padre está plegado → ocultar
            // - Si es partida y su capítulo padre o subcapítulo padre está plegado → ocultar
            if (esSubcapitulo && collapsedCaps.has(capRoot)) {
              return null;
            }
            if (esPartida) {
              if (collapsedCaps.has(capRoot)) return null;
              if (subcapParent && collapsedSubcaps.has(subcapParent)) return null;
            }

            const capClean = (p.Capítulo || '').replace(/#+/g, '');
            const isCapCollapsed = esCapitulo && collapsedCaps.has(capClean);
            const isSubcapCollapsed = esSubcapitulo && collapsedSubcaps.has(capClean);

            const mediciones = esPartida ? parseMedicionesGuardadas(p) : [];
            const tieneMedicion = mediciones.length > 0;
            const isMedicionOpen = tieneMedicion && expandedMediciones.has(idx);

            const costeFila = esPartida
              ? (parseFloat(p['Precio Total (€)']) || 0) * (parseFloat(p.Cantidad) || 1)
              : totalesCoste[p.Capítulo] || 0;
            const pvpFila = aplicarBeneficio(costeFila, beneficioPct);

            const rowClass = esCapitulo
              ? 'pt-row-cap'
              : esSubcapitulo
                ? 'pt-row-subcap'
                : isJefes && p.aprobado
                  ? 'pt-row-approved'
                  : 'pt-row-partida';

            const codClass = esCapitulo
              ? 'pt-cod-cap'
              : esSubcapitulo
                ? 'pt-cod-subcap'
                : 'pt-cod';

            const descClass = esCapitulo
              ? 'pt-desc-cap'
              : esSubcapitulo
                ? 'pt-desc-subcap'
                : isJefes
                  ? 'pt-desc-jefes'
                  : 'pt-desc';

            const costeCellClass = esSubcapitulo ? 'pt-total-coste-subcap' : 'pt-total-coste';
            const pvpCellClass = esCapitulo
              ? 'pt-total-pvp-cap'
              : esSubcapitulo
                ? 'pt-total-pvp-subcap'
                : 'pt-total-pvp';

            const handleRowClick = () => {
              if (esCapitulo) toggleCapitulo(capClean);
              else if (esSubcapitulo) toggleSubcapitulo(capClean);
            };

            const renderChevron = () => {
              if (esCapitulo) {
                return isCapCollapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />;
              }
              if (esSubcapitulo) {
                return isSubcapCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />;
              }
              return null;
            };

            const renderBotonP = () => {
              if (!tieneMedicion) return null;
              return (
                <button
                  type="button"
                  className={`pt-btn-medicion-p ${isMedicionOpen ? 'active' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleMedicion(idx);
                  }}
                  title={`${isMedicionOpen ? 'Ocultar' : 'Mostrar'} medición de presupuesto (${mediciones.length} ${mediciones.length === 1 ? 'línea' : 'líneas'})`}
                >
                  P
                </button>
              );
            };

            if (isJefes) {
              const tieneComentario = Boolean(p.comentario && p.comentario.trim());

              return (
                <React.Fragment key={idx}>
                  <tr
                    className={rowClass}
                    onClick={esCapitulo || esSubcapitulo ? handleRowClick : undefined}
                    title={
                      esCapitulo
                        ? 'Haz clic para plegar/desplegar este capítulo'
                        : esSubcapitulo
                          ? 'Haz clic para plegar/desplegar las partidas de este subcapítulo'
                          : undefined
                    }
                  >
                    <td className="pt-cell-center" onClick={(e) => esPartida && e.stopPropagation()}>
                      {esPartida && (
                        <input
                          type="checkbox"
                          checked={Boolean(p.aprobado)}
                          onChange={() => onToggleAprobado(idx)}
                          style={{ transform: 'scale(1.2)', cursor: 'pointer' }}
                        />
                      )}
                    </td>
                    <td className={codClass}>
                      <span className="pt-cod-inner">
                        {renderChevron()}
                        {capClean}
                      </span>
                    </td>
                    <td className={descClass}>
                      {renderDescripcionPartida(p.Descripción, esPartida)}
                      {esPartida && (
                        <button
                          type="button"
                          className="pt-comment-btn"
                          onClick={() => onOpenComentario(idx, p.comentario || '')}
                          title={tieneComentario ? 'Editar comentario' : 'Añadir comentario'}
                          style={{ color: tieneComentario ? '#16a34a' : '#9ca3af' }}
                        >
                          <MessageSquare size={16} />
                        </button>
                      )}
                    </td>
                    <td className="pt-cell-center" style={{ fontSize: '0.8rem' }}>
                      {esPartida && (
                        <input
                          type="text"
                          className="pt-input-cant-jefes"
                          value={rawInputs[`cant_${idx}`] ?? formatDecimal(p.Cantidad)}
                          onChange={(e) =>
                            setRawInputs((prev) => ({ ...prev, [`cant_${idx}`]: e.target.value }))
                          }
                          onBlur={(e) => {
                            const v = parseDecimal(e.target.value);
                            onUpdateCantidad(idx, v);
                            setRawInputs((prev) => {
                              const n = { ...prev };
                              delete n[`cant_${idx}`];
                              return n;
                            });
                          }}
                        />
                      )}
                    </td>
                    <td className="pt-cell-center" style={{ fontSize: '0.8rem' }}>
                      {esPartida && (
                        <div className="pt-ud-stack">
                          <input
                            type="text"
                            className="pt-input-ud-jefes"
                            value={p['Unidad IA'] || ''}
                            onChange={(e) => onUpdateUnidad(idx, e.target.value)}
                          />
                          {renderBotonP()}
                        </div>
                      )}
                    </td>
                    <td style={{ fontSize: '0.8rem', verticalAlign: 'middle' }}>
                      {esPartida && (
                        <select
                          className="pt-select-jefes"
                          onChange={(e) => onUpdateOficio(idx, e.target.value)}
                          value={p['Oficio Asignado'] || ''}
                        >
                          <option value="Sin asignar">Sin asignar</option>
                          {p['Oficio Asignado'] &&
                            p['Oficio Asignado'] !== 'Sin asignar' &&
                            !listaOficios.includes(p['Oficio Asignado']) && (
                              <option value={p['Oficio Asignado']}>{p['Oficio Asignado']}</option>
                            )}
                          {listaOficios.map((of) => (
                            <option key={of} value={of}>
                              {of}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td style={{ fontSize: '0.8rem', verticalAlign: 'middle' }}>
                      {esPartida && (
                        <select
                          className="pt-select-jefes"
                          onChange={(e) => onUpdateProveedor(idx, e.target.value)}
                          value={p.solicitud_seleccionada_id || ''}
                        >
                          <option value="">-- Usar precio base --</option>
                          {(respuestasPorPartida[p.id] || []).map((r) => (
                            <option key={r.solicitud_id} value={r.solicitud_id}>
                              {r.proveedor_nombre} ({r.precio_ofertado}€)
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td className="pt-cell-right">
                      {esPartida && (
                        <input
                          type="text"
                          className="pt-input-price-jefes"
                          value={rawInputs[`price_${idx}`] ?? formatDecimal(p['Precio Total (€)'])}
                          onChange={(e) =>
                            setRawInputs((prev) => ({ ...prev, [`price_${idx}`]: e.target.value }))
                          }
                          onBlur={(e) => {
                            const v = parseDecimal(e.target.value);
                            onUpdatePrice(idx, v);
                            setRawInputs((prev) => {
                              const n = { ...prev };
                              delete n[`price_${idx}`];
                              return n;
                            });
                          }}
                        />
                      )}
                    </td>
                    <td className={costeCellClass}>{fmtEuro(costeFila)}</td>
                    <td className={pvpCellClass}>{fmtEuro(pvpFila)}</td>
                  </tr>
                  {isMedicionOpen && renderMedicionSubrow(p, idx, mediciones, 10)}
                </React.Fragment>
              );
            }

            // mode === 'borradores'
            const precioIA = parseFloat(p['Precio IA']) || 0;
            const justif = p['Justificacion IA'] || '';
            const esAdjudicado = p.estado_adjudicacion === 'Adjudicado';

            return (
              <React.Fragment key={idx}>
                <tr
                  className={rowClass}
                  onClick={esCapitulo || esSubcapitulo ? handleRowClick : undefined}
                  title={
                    esCapitulo
                      ? 'Haz clic para plegar/desplegar este capítulo'
                      : esSubcapitulo
                        ? 'Haz clic para plegar/desplegar las partidas de este subcapítulo'
                        : undefined
                  }
                >
                  <td className={codClass}>
                    <span className="pt-cod-inner">
                      {renderChevron()}
                      {capClean}
                    </span>
                  </td>
                  <td className={descClass}>{renderDescripcionPartida(p.Descripción, esPartida)}</td>
                  <td className="pt-cell-center">
                    {esPartida && (
                      <input
                        type="text"
                        className="pt-input-cant"
                        value={rawInputs[`cant_${idx}`] ?? formatDecimal(p.Cantidad)}
                        onChange={(e) =>
                          setRawInputs((prev) => ({ ...prev, [`cant_${idx}`]: e.target.value }))
                        }
                        onBlur={(e) => {
                          const v = parseDecimal(e.target.value);
                          onUpdateCantidad(idx, v);
                          setRawInputs((prev) => {
                            const n = { ...prev };
                            delete n[`cant_${idx}`];
                            return n;
                          });
                        }}
                      />
                    )}
                  </td>
                  <td className="pt-cell-center">
                    {esPartida && (
                      <div className="pt-ud-stack">
                        <input
                          type="text"
                          className={p.unidad_asignada_por_ia ? 'pt-input-ud-ia' : 'pt-input-ud'}
                          value={p['Unidad IA']}
                          onChange={(e) => onUpdateUnidad(idx, e.target.value)}
                          title={
                            p.unidad_asignada_por_ia
                              ? '🤖 Unidad asignada por IA — edita para confirmar'
                              : ''
                          }
                        />
                        {renderBotonP()}
                      </div>
                    )}
                  </td>
                  <td className="pt-cell-right">
                    {esPartida && (
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'flex-end',
                          gap: '4px',
                        }}
                      >
                        {esAdjudicado && (
                          <Trophy
                            size={14}
                            color="#059669"
                            title="Precio adjudicado — solo modificable desde Comparativa"
                          />
                        )}
                        <input
                          type="text"
                          className={esAdjudicado ? 'pt-input-price-adj' : 'pt-input-price'}
                          value={rawInputs[`price_${idx}`] ?? formatDecimal(p['Precio Total (€)'])}
                          onChange={(e) => {
                            if (esAdjudicado) return;
                            setRawInputs((prev) => ({ ...prev, [`price_${idx}`]: e.target.value }));
                          }}
                          onBlur={(e) => {
                            if (esAdjudicado) return;
                            const v = parseDecimal(e.target.value);
                            onUpdatePrice(idx, v);
                            setRawInputs((prev) => {
                              const n = { ...prev };
                              delete n[`price_${idx}`];
                              return n;
                            });
                          }}
                          readOnly={esAdjudicado}
                          title={
                            esAdjudicado
                              ? 'Precio adjudicado — solo modificable desde Comparativa'
                              : ''
                          }
                        />
                      </div>
                    )}
                  </td>
                  <td className={costeCellClass}>{fmtEuro(costeFila)}</td>
                  <td className={pvpCellClass}>{fmtEuro(pvpFila)}</td>
                  <td className="pt-cell-right">
                    {esPartida && precioIA > 0 && (
                      <div
                        title={justif || 'Sin justificación'}
                        style={{ cursor: justif ? 'help' : 'default' }}
                      >
                        <span
                          style={{
                            fontSize: '0.88rem',
                            color: 'var(--text-muted)',
                            fontStyle: 'italic',
                          }}
                        >
                          {precioIA.toLocaleString('es-ES', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </span>
                        {justif && (
                          <div
                            style={{
                              fontSize: '0.7rem',
                              color: 'var(--text-muted)',
                              opacity: 0.75,
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              maxWidth: '120px',
                            }}
                          >
                            {justif}
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                  <td>
                    {esPartida && (
                      <select
                        value={p['Oficio Asignado']}
                        onChange={(e) => onUpdateOficio(idx, e.target.value)}
                        style={{ width: '100%' }}
                      >
                        {listaOficios.map((of) => (
                          <option key={of} value={of}>
                            {of}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                </tr>
                {isMedicionOpen && renderMedicionSubrow(p, idx, mediciones, 9)}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default PartidasTable;
