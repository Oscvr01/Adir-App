import React, { useState, useMemo } from 'react';
import { Trophy, MessageSquare, ChevronDown, ChevronRight, ChevronsUpDown } from 'lucide-react';
import { formatDecimal, parseDecimal, fmtEuro, aplicarBeneficio } from '../utils/format';
import {
  getTipoFila,
  calcularTotalesCapitulos,
  obtenerJerarquiaFila,
} from '../utils/partidas';

/**
 * Componente compartido de tabla jerárquica de partidas para Borradores y Jefes de Obra.
 * - Muestra totales de Coste y PVP (con beneficio) en capítulos, subcapítulos y partidas.
 * - Permite plegar/desplegar capítulos (ocultando sus subcapítulos/partidas) y subcapítulos (ocultando sus partidas).
 * - Encapsula el buffer de edición decimal (`rawInputs`) y utiliza clases CSS de `src/index.css`.
 */
const PartidasTable = ({
  mode = 'borradores',
  partidas = [],
  beneficioPct = 0,
  listaOficios = [],
  respuestasPorPartida = {},
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

  const isJefes = mode === 'jefes';

  // Costes totales acumulados por capítulo y subcapítulo
  const totalesCoste = useMemo(() => calcularTotalesCapitulos(partidas), [partidas]);

  // Conjuntos de códigos limpios de capítulos y subcapítulos presentes en la tabla
  const { capitulosCodigos, subcapitulosCodigos, extrasIdx } = useMemo(() => {
    const caps = new Set();
    const subcaps = new Set();
    let extIdx = -1;
    partidas.forEach((p, i) => {
      const tipo = getTipoFila(p);
      const limpio = (p.Capítulo || '').replace(/#+$/, '').trim();
      if (tipo === 'capitulo') {
        caps.add(limpio);
        if (limpio === '99_EXTRAS') extIdx = i;
      } else if (tipo === 'subcapitulo') {
        subcaps.add(limpio);
      }
    });
    return { capitulosCodigos: caps, subcapitulosCodigos: subcaps, extrasIdx: extIdx };
  }, [partidas]);

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

  const allCapsCollapsed =
    capitulosCodigos.size > 0 && collapsedCaps.size >= capitulosCodigos.size;
  const allSubcapsCollapsed =
    subcapitulosCodigos.size > 0 && collapsedSubcaps.size >= subcapitulosCodigos.size;

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

  const partidasReales = isJefes
    ? partidas.filter((p) => getTipoFila(p) === 'partida')
    : [];
  const allApproved =
    isJefes && partidasReales.length > 0 && partidasReales.every((p) => p.aprobado);

  return (
    <div className="table-container">
      {capitulosCodigos.size > 0 && (
        <div className="pt-toolbar">
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
          <button
            type="button"
            className="pt-btn-collapse-all"
            onClick={handleToggleAllCaps}
            title="Pliega o despliega todos los capítulos de la tabla"
          >
            <ChevronsUpDown size={14} />
            {allCapsCollapsed ? 'Desplegar todo' : 'Plegar capítulos'}
          </button>
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
          {partidas.map((p, idx) => {
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

            if (isJefes) {
              const tieneComentario = Boolean(p.comentario && p.comentario.trim());

              return (
                <tr
                  key={idx}
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
                    {p.Descripción}
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
                      <input
                        type="text"
                        className="pt-input-ud-jefes"
                        value={p['Unidad IA'] || ''}
                        onChange={(e) => onUpdateUnidad(idx, e.target.value)}
                      />
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
              );
            }

            // mode === 'borradores'
            const precioIA = parseFloat(p['Precio IA']) || 0;
            const justif = p['Justificacion IA'] || '';
            const esAdjudicado = p.estado_adjudicacion === 'Adjudicado';

            return (
              <tr
                key={idx}
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
                <td className={descClass}>{p.Descripción}</td>
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
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default PartidasTable;
