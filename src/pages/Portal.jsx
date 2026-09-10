import { Globe } from 'lucide-react';
import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../utils/supabaseClient';
import { N8N_BASE_URL } from '../config';
import { useToast } from '../utils/useModal';
import { generarPDFOfertaProveedor, descargarPDF } from '../utils/pdfUtils';
import { cleanText } from '../utils/escape';
import { formatDecimal, parseDecimal } from '../utils/format';

const Portal = () => {
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [solicitud, setSolicitud] = useState(null);
  const [partidas, setPartidas] = useState([]);
  const [precios, setPrecios] = useState({});
  const [rawPrecios, setRawPrecios] = useState({});

  const [comentarios, setComentarios] = useState({});
  const [comentariosGenerales, setComentariosGenerales] = useState('');
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const { showToast, ToastUI } = useToast();

  useEffect(() => {
    const fetchSolicitud = async () => {
      try {
        const token = searchParams.get('token');
        if (!token) throw new Error("Enlace inválido. Falta el token.");

        // Fetch Solicitud (usando limit(1) para evitar el error 406 si hay duplicados por pruebas de n8n)
        const { data: solDataArray, error: solError } = await supabase
          .from('solicitudes')
          .select('*')
          .eq('token', token)
          .limit(1);

        const solData = solDataArray && solDataArray.length > 0 ? solDataArray[0] : null;

        if (solError || !solData) {
            console.error(solError);
            throw new Error("La solicitud no existe, el enlace está corrupto o ha caducado.");
        }
        if (solData.estado_solicitud === 'Respondido') throw new Error("Esta solicitud ya fue respondida.");

        setSolicitud(solData);

        // Buscar partidas mediante oficio_asignado
        const { data: partData, error: partError } = await supabase
          .from('partidas')
          .select('*')
          .eq('propuesta_id', solData.propuesta_id)
          .eq('oficio_asignado', solData.oficio_solicitado);

        if (partError) console.warn("Error cargando partidas por oficio:", partError);
        setPartidas(partData || []);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchSolicitud();
  }, [searchParams]);

  const handlePriceChange = (id, value) => {
    setPrecios({ ...precios, [id]: value });
  };

  const handleComentarioChange = (id, value) => {
    setComentarios({ ...comentarios, [id]: value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      // Usar id si existe, si no caer al token (que siempre es no-nulo) como clave única
      const solId = solicitud.id || solicitud.token;
      const payload = {
        token: solicitud.token,
        solicitud_id: solId,
        proveedor_id: solicitud.proveedor_id,
        precios: partidas.map(p => ({
          partida_id: p.id,
          precio_ofertado: parseFloat(precios[p.id] || 0),
          comentarios: comentarios[p.id] || ''
        })),
        comentarios_generales: comentariosGenerales
      };

      const webhookUrl = `${N8N_BASE_URL}/webhook/fase5-respuesta`;
      
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) throw new Error("Error de conexión con el sistema.");

      // ── Guardar directamente en Supabase lo que n8n puede no persistir ────────

      // 1. Comentarios por partida → upsert en respuestas
      //    Usamos upsert (no update) porque n8n es asíncrono y puede que aún
      //    no haya creado las filas cuando llegamos aquí. Si ya existen, las
      //    actualiza; si no, las crea con el comentario ya incluido.
      const partidsConComentario = partidas.filter(p => comentarios[p.id] && comentarios[p.id].trim());
      if (partidsConComentario.length > 0) {
        await Promise.all(
          partidsConComentario.map(p =>
            supabase.from('respuestas')
              .upsert(
                {
                  solicitud_id: solId,
                  partida_id: p.id,
                  comentarios: comentarios[p.id].trim()
                },
                { onConflict: 'solicitud_id,partida_id', ignoreDuplicates: false }
              )
          )
        );
      }

      // 2. Anotaciones generales → solicitudes.comentarios_generales
      //    Usamos token (único garantizado) como clave de búsqueda en lugar de id que puede ser nulo
      if (comentariosGenerales && comentariosGenerales.trim()) {
        await supabase
          .from('solicitudes')
          .update({ comentarios_generales: comentariosGenerales.trim() })
          .eq('token', solicitud.token);
      }

      setSuccess(true);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDownloadPDF = () => {
    try {
      const doc = generarPDFOfertaProveedor({
        proveedorNombre: solicitud.proveedor_nombre || solicitud.proveedores?.nombre || 'Proveedor',
        proveedorEmail: solicitud.proveedor_email || '',
        proyectoNombre: solicitud.propuestas?.cliente || solicitud.propuesta_id || '',
        oficio: solicitud.oficio_solicitado || '',
        fecha: new Date().toISOString(),
        partidas: partidas.map(p => ({
          descripcion: p.texto_descripcion || p.texto_partida || '',
          unidad: p.unidad || 'ud',
          cantidad: p.cantidad || 1,
          precioOfertado: parseFloat(precios[p.id] || 0),
          comentario: comentarios[p.id] || '',
        })),
        comentariosGenerales: comentariosGenerales || '',
      });

      const safeProveedor = (solicitud.proveedor_nombre || 'Proveedor').replace(/\s+/g, '_');
      const safeOficio = (solicitud.oficio_solicitado || 'Oficio').replace(/\s+/g, '_');
      descargarPDF(doc, `Oferta_${safeProveedor}_${safeOficio}`);
    } catch (err) {
      console.error("[PDF PORTAL] Error:", err);
      showToast("Error al generar el PDF: " + err.message, "error");
    }
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}>Cargando portal seguro...</div>;
  if (error) return <div style={{ padding: 40, textAlign: 'center', color: 'red' }}><h2>Acceso Denegado</h2><p>{error}</p></div>;
  if (success) return (
    <div className="glass-card text-center animate-fade-in" style={{ maxWidth: 600, margin: '60px auto', padding: '40px 30px', textAlign: 'center' }}>
      {ToastUI}
      <div style={{ fontSize: '4rem', marginBottom: '20px' }}>✅</div>
      <h2 style={{ color: 'var(--success)', marginBottom: '15px', fontSize: '1.8rem', fontWeight: 700 }}>¡Presupuesto Enviado!</h2>
      <p style={{ color: 'var(--text-muted)', marginBottom: '30px', fontSize: '1.05rem', lineHeight: '1.6' }}>
        Tus precios y anotaciones se han registrado correctamente en el sistema de ADIR Reformas.
      </p>
      <div style={{ display: 'flex', gap: '15px', justifyContent: 'center', flexWrap: 'wrap' }}>
        <button 
          onClick={handleDownloadPDF} 
          style={{ 
            padding: '12px 24px', 
            background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', 
            color: 'white', 
            border: 'none', 
            borderRadius: '6px', 
            cursor: 'pointer', 
            fontWeight: '600',
            boxShadow: '0 4px 12px rgba(16, 185, 129, 0.2)',
            transition: 'transform 0.2s, box-shadow 0.2s'
          }}
          onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 6px 20px rgba(16, 185, 129, 0.3)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(16, 185, 129, 0.2)'; }}
        >
          📄 Descargar Copia en PDF
        </button>
      </div>
    </div>
  );

  return (
    <div style={{ maxWidth: 800, margin: '40px auto', fontFamily: 'system-ui' }}>
      
      {ToastUI}

      <h1 style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '6px' }}><Globe size={32} color="var(--primary)" /> Portal del Proveedor - ADIR</h1>
      <div style={{ padding: 20, background: '#f8f9fa', borderRadius: 8, marginBottom: 20 }}>
        <h3>Hola, {solicitud.proveedor_nombre || solicitud.proveedores?.nombre || "Proveedor"}</h3>
        <p>Por favor, indica tu precio por cada partida solicitada para <strong>{solicitud.oficio_solicitado}</strong>.</p>
        {solicitud.anexo_url && (
          <p style={{ marginTop: 10, marginBottom: 0 }}>
            📎 {solicitud.anexo_url.startsWith('http') ? (
              <a href={solicitud.anexo_url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)', fontWeight: 600 }}>
                Descargar anexo del proyecto
              </a>
            ) : (
              <span style={{ fontWeight: 600, color: 'var(--text-muted)' }}>
                Anexo enviado por email: {solicitud.anexo_url}
              </span>
            )}
          </p>
        )}
      </div>

      <form onSubmit={handleSubmit}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#e9ecef' }}>
              <th style={{ padding: 10, textAlign: 'left' }}>Descripción</th>
              <th style={{ padding: 10, textAlign: 'center' }}>Ud.</th>
              <th style={{ padding: 10, textAlign: 'right' }}>Cantidad</th>
              <th style={{ padding: 10, textAlign: 'right' }}>Precio Unitario (€)</th>
              <th style={{ padding: 10, textAlign: 'left' }}>Observaciones</th>
            </tr>
          </thead>
          <tbody>
            {partidas.map(p => (
              <tr key={p.id} style={{ borderBottom: '1px solid #dee2e6' }}>
                <td style={{ padding: 10 }}>{cleanText(p.texto_descripcion || p.texto_partida)}</td>
                <td style={{ padding: 10, textAlign: 'center' }}>{p.unidad || 'ud'}</td>
                <td style={{ padding: 10, textAlign: 'right' }}>{p.cantidad || 1}</td>
                <td style={{ padding: 10, textAlign: 'right' }}>
                  <input
                    type="text"
                    required
                    style={{ padding: 8, width: 100, textAlign: 'right', border: '1px solid #ced4da', borderRadius: 4 }}
                    value={rawPrecios[p.id] ?? (precios[p.id] ? formatDecimal(precios[p.id]) : '')}
                    onChange={(e) => setRawPrecios({ ...rawPrecios, [p.id]: e.target.value })}
                    onBlur={(e) => {
                      const v = parseDecimal(e.target.value);
                      handlePriceChange(p.id, v);
                      setRawPrecios(prev => { const n = { ...prev }; delete n[p.id]; return n; });
                    }}
                    placeholder="0,00"
                  />
                </td>
                <td style={{ padding: 10 }}>
                  <input
                    type="text"
                    style={{ padding: 8, width: '100%', minWidth: 150, border: '1px solid #ced4da', borderRadius: 4 }}
                    value={comentarios[p.id] || ''}
                    onChange={(e) => handleComentarioChange(p.id, e.target.value)}
                    placeholder="Notas opcionales..."
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        
        <div style={{ marginTop: 24, padding: 20, background: '#f8f9fa', borderRadius: 8, border: '1px solid #dee2e6' }}>
          <h4 style={{ margin: '0 0 10px 0', color: '#495057' }}>Anotaciones Generales</h4>
          <p style={{ margin: '0 0 10px 0', fontSize: '0.9rem', color: '#6c757d' }}>Si necesitas hacer algún comentario general sobre el proyecto o las condiciones, indícalo aquí:</p>
          <textarea
            style={{ width: '100%', minHeight: 80, padding: 12, borderRadius: 4, border: '1px solid #ced4da', resize: 'vertical' }}
            placeholder="Anotaciones, plazos estimados, condiciones especiales..."
            value={comentariosGenerales}
            onChange={(e) => setComentariosGenerales(e.target.value)}
          />
        </div>

        <div style={{ marginTop: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button
            type="button"
            onClick={handleDownloadPDF}
            style={{
              padding: '12px 20px',
              background: '#f1f5f9',
              color: '#334155',
              border: '1px solid #cbd5e1',
              borderRadius: 6,
              cursor: 'pointer',
              fontWeight: '600',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              transition: 'background-color 0.2s'
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#e2e8f0'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#f1f5f9'}
          >
            📄 Previsualizar PDF
          </button>
          <button 
            type="submit" 
            disabled={submitting}
            style={{ 
              padding: '12px 24px', 
              background: 'linear-gradient(135deg, #002D54 0%, #001a33 100%)', 
              color: 'white', 
              border: 'none', 
              borderRadius: 6, 
              cursor: submitting ? 'wait' : 'pointer', 
              fontWeight: 'bold',
              boxShadow: '0 4px 12px rgba(0, 45, 84, 0.2)',
              transition: 'transform 0.2s, box-shadow 0.2s'
            }}
            onMouseEnter={(e) => { if (!submitting) { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 6px 20px rgba(0, 45, 84, 0.3)'; } }}
            onMouseLeave={(e) => { if (!submitting) { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 45, 84, 0.2)'; } }}
          >
            {submitting ? 'Enviando...' : 'Enviar Presupuesto'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default Portal;