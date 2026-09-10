import React, { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '../utils/supabaseClient';
import { N8N_BASE_URL } from '../config';
import { useModal } from '../utils/useModal';
import { generarPresupuestoPDF, descargarPDF } from '../utils/pdfUtils';
import { Download, PenLine, CheckCircle, X, Loader2 } from 'lucide-react';
import { cleanText } from '../utils/escape';

const PresupuestoCliente = () => {
    const location = useLocation();
    const { showAlert, ModalUI } = useModal();
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [presupuesto, setPresupuesto] = useState(null);
    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(false);
    const [rejected, setRejected] = useState(false);
    const [isDrawing, setIsDrawing] = useState(false);
    const [hasSigned, setHasSigned] = useState(false);
    const [showRejectModal, setShowRejectModal] = useState(false);
    const [rejectReason, setRejectReason] = useState('');
    const [firmaData, setFirmaData] = useState(null);
    const [fechaFirma, setFechaFirma] = useState(null);

    const canvasRef = useRef(null);
    const lastPos = useRef({ x: 0, y: 0 });

    useEffect(() => {
        const fetchPresupuesto = async () => {
            try {
                const params = new URLSearchParams(location.search);
                const token = params.get('token');
                if (!token) throw new Error('Enlace inválido. Falta el token de seguridad.');

                const { data, error } = await supabase
                    .from('presupuestos_cliente')
                    .select('*')
                    .eq('token', token)
                    .single();

                if (error || !data) throw new Error('Presupuesto no encontrado. El enlace puede haber caducado.');
                if (data.estado === 'firmado') {
                    setPresupuesto(data);
                    setFirmaData(data.firma_base64 || null);
                    setFechaFirma(data.fecha_firma || null);
                    setSuccess(true);
                    setLoading(false);
                    return;
                }
                if (data.estado === 'rechazado') {
                    setRejected(true);
                    setLoading(false);
                    return;
                }

                setPresupuesto(data);
            } catch (err) {
                setError(err.message);
            } finally {
                setLoading(false);
            }
        };
        fetchPresupuesto();
        // Página pública cargada desde enlace: lectura única del token en mount.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ─── Canvas de firma ───
    const getPos = (e, canvas) => {
        const rect = canvas.getBoundingClientRect();
        if (e.touches) {
            return {
                x: e.touches[0].clientX - rect.left,
                y: e.touches[0].clientY - rect.top
            };
        }
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const startDraw = (e) => {
        const canvas = canvasRef.current;
        lastPos.current = getPos(e, canvas);
        setIsDrawing(true);
        setHasSigned(true);
    };

    const draw = (e) => {
        if (!isDrawing) return;
        e.preventDefault();
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        const pos = getPos(e, canvas);
        ctx.beginPath();
        ctx.moveTo(lastPos.current.x, lastPos.current.y);
        ctx.lineTo(pos.x, pos.y);
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        ctx.stroke();
        lastPos.current = pos;
    };

    const stopDraw = () => setIsDrawing(false);

    const clearSignature = () => {
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        setHasSigned(false);
    };

    // ─── Generación PDF ───
    const generatePDF = (forDownload = false) => {
        const doc = generarPresupuestoPDF({
            cliente:      presupuesto.cliente_nombre || 'Sin especificar',
            propuesta_id: presupuesto.propuesta_id,
            descripcion:  presupuesto.proyecto_descripcion || presupuesto.propuesta_id,
            partidas:     presupuesto.partidas || [],
            precio_total: presupuesto.precio_total,
            fecha:        presupuesto.fecha_envio,
            token:        presupuesto.token,
            titulo:       'Presupuesto de Obra',
        });
        if (forDownload) {
            descargarPDF(doc, 'Presupuesto_ADIR_' + presupuesto.propuesta_id);
        }
        return doc;
    };

    // ─── Enviar firma ───
    const handleFirmar = async () => {
        if (!hasSigned) return showAlert('Por favor, añade tu firma antes de confirmar.', { type: 'warning', title: 'Firma necesaria' });
        setSubmitting(true);
        try {
            const canvas = canvasRef.current;
            const firmaBase64 = canvas.toDataURL('image/png');

            const { error } = await supabase
                .from('presupuestos_cliente')
                .update({
                    estado: 'firmado',
                    firma_base64: firmaBase64,
                    fecha_firma: new Date().toISOString()
                })
                .eq('token', presupuesto.token);

            if (error) throw error;

            const ahora = new Date().toISOString();
            setFirmaData(firmaBase64);
            setFechaFirma(ahora);

            // Notificar a n8n
            try {
                await fetch(`${N8N_BASE_URL}/webhook/presupuesto-firmado`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        token: presupuesto.token,
                        propuesta_id: presupuesto.propuesta_id,
                        cliente_nombre: presupuesto.cliente_nombre,
                        cliente_email: presupuesto.cliente_email,
                        precio_total: presupuesto.precio_total,
                        firma_base64: firmaBase64
                    })
                });
            } catch (e) {
                console.warn('n8n no disponible:', e);
            }

            setSuccess(true);
        } catch (err) {
            showAlert('Error al registrar la firma: ' + err.message, { type: 'error', title: 'Error' });
        } finally {
            setSubmitting(false);
        }
    };

    // ─── Rechazar presupuesto ───
    const handleRechazar = async () => {
        if (!rejectReason.trim()) return showAlert('Por favor, indica el motivo del rechazo.', { type: 'warning', title: 'Motivo necesario' });
        setSubmitting(true);
        try {
            const { error } = await supabase
                .from('presupuestos_cliente')
                .update({
                    estado: 'rechazado',
                    fecha_firma: new Date().toISOString(),
                    detalles_rechazo: rejectReason
                })
                .eq('token', presupuesto.token);

            if (error) throw error;

            try {
                await fetch(`${N8N_BASE_URL}/webhook/presupuesto-rechazado`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        token: presupuesto.token,
                        propuesta_id: presupuesto.propuesta_id,
                        cliente_email: presupuesto.cliente_email,
                        motivo: rejectReason
                    })
                });
            } catch (e) {
                console.warn('n8n no disponible:', e);
            }

            setRejected(true);
            setShowRejectModal(false);
        } catch (err) {
            showAlert('Error al registrar el rechazo: ' + err.message, { type: 'error', title: 'Error' });
        } finally {
            setSubmitting(false);
        }
    };

    // ─── Estados de pantalla ───
    if (loading) return (
        <div style={styles.centered}>
            <Loader2 size={40} style={{ animation: 'spin 1s linear infinite', color: '#002D54' }} />
            <p style={{ color: '#50504d', marginTop: 16 }}>Cargando su presupuesto seguro...</p>
        </div>
    );

    if (error) return (
        <div style={styles.centered}>
            <div style={styles.errorBox}>
                <X size={40} color="#dc2626" />
                <h2>Enlace no válido</h2>
                <p>{error}</p>
                <p style={{ fontSize: '0.8rem', color: '#9ca3af' }}>Si cree que es un error, contacte con ADIR Reformas.</p>
            </div>
        </div>
    );

    if (success) return (
        <div style={styles.centered}>
            <div style={{ ...styles.successBox, maxWidth: 480 }}>
                <CheckCircle size={60} color="#16a34a" />
                <h2 style={{ color: '#15803d' }}>¡Presupuesto Firmado!</h2>
                <p>Hemos recibido su conformidad. Nos pondremos en contacto con usted en breve para coordinar el inicio de la obra.</p>
                {firmaData && presupuesto && (
                    <button
                        onClick={() => {
                            const doc = generarPresupuestoPDF({
                                cliente:      presupuesto.cliente_nombre || 'Sin especificar',
                                propuesta_id: presupuesto.propuesta_id,
                                descripcion:  presupuesto.proyecto_descripcion || presupuesto.propuesta_id,
                                partidas:     presupuesto.partidas || [],
                                precio_total: presupuesto.precio_total,
                                fecha:        presupuesto.fecha_envio,
                                token:        presupuesto.token,
                                titulo:       'Contrato de Obra — Copia Firmada',
                                firma_base64: firmaData,
                                fecha_firma:  fechaFirma,
                            });
                            descargarPDF(doc, 'Contrato_Firmado_' + presupuesto.propuesta_id);
                        }}
                        style={{ ...styles.btnPrimary, marginTop: 16, width: '100%', justifyContent: 'center' }}
                    >
                        <Download size={16} />
                        Descargar mi copia firmada en PDF
                    </button>
                )}
                <p style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: 12 }}>Puede cerrar esta ventana cuando lo desee.</p>
            </div>
        </div>
    );

    if (rejected) return (
        <div style={styles.centered}>
            <div style={{ ...styles.errorBox, borderColor: '#fbbf24' }}>
                <X size={40} color="#d97706" />
                <h2 style={{ color: '#b45309' }}>Presupuesto Rechazado</h2>
                <p>Hemos registrado que no acepta este presupuesto. El equipo de ADIR revisará su caso y contactará con usted.</p>
            </div>
        </div>
    );

    // Detectar modo desde los datos guardados en Supabase:
    // Si hay filas que NO terminan en '#' → desglose completo (caps + partidas individuales)
    // Si todas terminan en '#' → vista resumida solo capítulos/subcapítulos
    const todasPartidas = presupuesto.partidas || [];
    const esModoDesglose = todasPartidas.some(p => {
        const cap = (p.Capítulo || p.Capitulo || '').trim();
        return !cap.endsWith('#');
    });
    const total = parseFloat(presupuesto.precio_total || 0);

    // Helper para clasificar fila (sincronizado con JefesObra)
    const getTipoFila = (p) => {
        const cap = (p.Capítulo || p.Capitulo || '').trim();
        if (!cap.endsWith('#')) return 'partida';
        const limpio = cap.replace(/#$/, '');
        if (limpio === '99_EXTRAS') return 'capitulo';
        if (limpio.includes('.')) return 'subcapitulo';
        return 'capitulo';
    };

    return (
        <div style={styles.page}>
            {ModalUI}
            {/* Cabecera */}
            <div style={styles.header}>
                <div>
                    <div style={styles.logo}>ADIR</div>
                    <p style={{ color: '#7a7a77', fontSize: '0.9rem', margin: 0 }}>Portal de Cliente</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                    <p style={{ margin: 0, fontWeight: 'bold', color: '#1e293b' }}>Ref: {presupuesto.token.substring(0, 8).toUpperCase()}</p>
                    <p style={{ margin: 0, color: '#50504d', fontSize: '0.85rem' }}>{new Date(presupuesto.fecha_envio).toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' })}</p>
                </div>
            </div>

            <div style={styles.container}>
                {/* Info cliente */}
                <div style={styles.card}>
                    <h2 style={styles.cardTitle}>Estimado/a {presupuesto.cliente_nombre || 'Cliente'},</h2>
                    <p style={{ color: '#50504d', lineHeight: 1.6 }}>
                        Le adjuntamos el presupuesto detallado para el proyecto <strong>{presupuesto.proyecto_descripcion || presupuesto.propuesta_id}</strong>.
                        Por favor, revise cada partida y, si está de acuerdo, firme digitalmente al pie del documento.
                    </p>
                    <button onClick={() => generatePDF(true)} style={styles.btnSecondary}>
                        <Download size={16} />
                        Descargar PDF
                    </button>
                </div>

                {/* Tabla presupuesto — modo dinámico según datos guardados */}
                <div style={styles.card}>
                    <h3 style={styles.sectionTitle}>
                        {esModoDesglose ? 'Desglose Detallado del Presupuesto' : 'Resumen del Presupuesto'}
                    </h3>
                    <div style={{ overflowX: 'auto' }}>
                        <table style={styles.table}>
                            <thead>
                                <tr style={{ backgroundColor: '#002D54', color: 'white' }}>
                                    {esModoDesglose ? (
                                        <>
                                            <th style={{ ...styles.th, textAlign: 'left' }}>Descripción</th>
                                            <th style={{ ...styles.th, textAlign: 'center', width: 70 }}>Cant.</th>
                                            <th style={{ ...styles.th, textAlign: 'center', width: 50 }}>Ud.</th>
                                            <th style={{ ...styles.th, textAlign: 'right', width: 110 }}>Precio/ud (€)</th>
                                            <th style={{ ...styles.th, textAlign: 'right', width: 110 }}>Total (€)</th>
                                        </>
                                    ) : (
                                        <>
                                            <th style={{ ...styles.th, textAlign: 'left' }}>Capítulo / Descripción</th>
                                            <th style={{ ...styles.th, textAlign: 'right', width: 150 }}>Total (€)</th>
                                        </>
                                    )}
                                </tr>
                            </thead>
                            <tbody>
                                {todasPartidas.map((p, idx) => {
                                    const tipo = getTipoFila(p);
                                    const desc = cleanText(p.Descripción || p.Descripcion || p.texto_partida || '-');
                                    const totalCap = parseFloat(p.precio_total_capitulo || 0);

                                    // ── Capítulo principal ──
                                    if (tipo === 'capitulo') {
                                        const colSpan = esModoDesglose ? 5 : 2;
                                        return (
                                            <tr key={idx}>
                                                <td colSpan={colSpan} style={{
                                                    padding: '11px 16px', fontWeight: 700,
                                                    fontSize: '0.9rem', letterSpacing: '0.4px',
                                                    backgroundColor: '#002D54', color: 'white',
                                                    textTransform: 'uppercase'
                                                }}>
                                                    {!esModoDesglose && (
                                                        <span style={{ display: 'inline-block', float: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>
                                                            {totalCap.toLocaleString('es-ES', { minimumFractionDigits: 2 })} €
                                                        </span>
                                                    )}
                                                    {desc}
                                                </td>
                                            </tr>
                                        );
                                    }

                                    // ── Subcapítulo ──
                                    if (tipo === 'subcapitulo') {
                                        const colSpan = esModoDesglose ? 5 : 2;
                                        return (
                                            <tr key={idx}>
                                                <td colSpan={colSpan} style={{
                                                    padding: '8px 28px', fontWeight: 600,
                                                    fontSize: '0.85rem',
                                                    backgroundColor: '#1e3a8a', color: '#bfdbfe',
                                                    fontStyle: 'italic'
                                                }}>
                                                    {!esModoDesglose && (
                                                        <span style={{ display: 'inline-block', float: 'right', fontWeight: 600, whiteSpace: 'nowrap' }}>
                                                            {totalCap.toLocaleString('es-ES', { minimumFractionDigits: 2 })} €
                                                        </span>
                                                    )}
                                                    {desc}
                                                </td>
                                            </tr>
                                        );
                                    }

                                    // ── Partida individual (solo en modo desglose) ──
                                    const precioUd = parseFloat(p['Precio Total (€)'] || p.precio_adjudicado || 0);
                                    const cant = parseFloat(p.Cantidad || p.cantidad || 1);
                                    const ud = (p['Unidad IA'] || p.unidad || 'ud').trim();
                                    const totalFila = precioUd * cant;
                                    const bgColor = idx % 2 === 0 ? '#ffffff' : '#f8fafc';

                                    return (
                                        <tr key={idx} style={{ backgroundColor: bgColor }}>
                                            <td style={{ ...styles.td, paddingLeft: 32, color: '#334155' }}>
                                                {desc}
                                                {(p.comentario && p.comentario.trim()) && (
                                                    <div style={{ fontSize: '0.78rem', fontStyle: 'italic', color: '#64748b', marginTop: 4 }}>
                                                        {p.comentario.trim()}
                                                    </div>
                                                )}
                                            </td>
                                            <td style={{ ...styles.td, textAlign: 'center', color: '#64748b', whiteSpace: 'nowrap' }}>
                                                {cant.toLocaleString('es-ES', { maximumFractionDigits: 2 })}
                                            </td>
                                            <td style={{ ...styles.td, textAlign: 'center', color: '#64748b' }}>{ud}</td>
                                            <td style={{ ...styles.td, textAlign: 'right', color: '#64748b', whiteSpace: 'nowrap' }}>
                                                {precioUd.toLocaleString('es-ES', { minimumFractionDigits: 2 })} €
                                            </td>
                                            <td style={{ ...styles.td, textAlign: 'right', fontWeight: 600, color: '#002D54', whiteSpace: 'nowrap' }}>
                                                {totalFila.toLocaleString('es-ES', { minimumFractionDigits: 2 })} €
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                            <tfoot>
                                <tr style={{ backgroundColor: '#002D54', color: 'white' }}>
                                    <td colSpan={esModoDesglose ? 4 : 1} style={{ ...styles.td, fontWeight: 'bold', fontSize: '1.05rem' }}>
                                        TOTAL PRESUPUESTO
                                    </td>
                                    <td style={{ ...styles.td, textAlign: 'right', fontWeight: 'bold', fontSize: '1.1rem', whiteSpace: 'nowrap' }}>
                                        {total.toLocaleString('es-ES', { minimumFractionDigits: 2 })} €
                                    </td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                    <p style={{ fontSize: '0.78rem', color: '#7a7a77', marginTop: 12 }}>
                        * Presupuesto válido por 30 días desde la fecha de emisión. Precios incluyen materiales y mano de obra salvo indicación contraria.
                    </p>
                </div>

                {/* Zona de firma */}
                <div style={styles.card}>
                    <h3 style={styles.sectionTitle}><PenLine size={18} /> Firma Digital</h3>
                    <p style={{ color: '#50504d', marginBottom: 12 }}>Firme en el recuadro inferior para aceptar este presupuesto. Al confirmar, ambas partes quedan obligadas a los términos acordados.</p>

                    <div style={{ position: 'relative', marginBottom: 12 }}>
                        <canvas
                            ref={canvasRef}
                            width={700}
                            height={180}
                            style={styles.canvas}
                            onMouseDown={startDraw}
                            onMouseMove={draw}
                            onMouseUp={stopDraw}
                            onMouseLeave={stopDraw}
                            onTouchStart={startDraw}
                            onTouchMove={draw}
                            onTouchEnd={stopDraw}
                        />
                        {!hasSigned && (
                            <div style={styles.canvasPlaceholder}>Firme aquí con el ratón o el dedo</div>
                        )}
                    </div>

                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                        <button onClick={clearSignature} style={styles.btnOutline}>
                            <X size={14} /> Borrar firma
                        </button>
                        <button onClick={handleFirmar} disabled={!hasSigned || submitting} style={{ ...styles.btnPrimary, opacity: hasSigned ? 1 : 0.5 }}>
                            {submitting ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <CheckCircle size={16} />}
                            {submitting ? 'Registrando...' : 'Confirmar y Firmar Presupuesto'}
                        </button>
                        <button onClick={() => setShowRejectModal(true)} style={styles.btnDanger}>
                            <X size={14} /> No acepto
                        </button>
                    </div>
                </div>
            </div>

            {/* Modal de rechazo */}
            {showRejectModal && (
                <div style={styles.overlay}>
                    <div style={styles.modal}>
                        <h3 style={{ color: '#dc2626', margin: '0 0 12px' }}>Rechazar Presupuesto</h3>
                        <p style={{ color: '#6b7280', marginBottom: 12 }}>Indique brevemente el motivo. El equipo de ADIR se pondrá en contacto con usted para ajustar la oferta.</p>
                        <textarea
                            rows={4}
                            value={rejectReason}
                            onChange={e => setRejectReason(e.target.value)}
                            placeholder="Ej: El precio supera mi presupuesto, me gustaría replantear las partidas de..."
                            style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid #c7d5e6', resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box' }}
                        />
                        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                            <button onClick={() => setShowRejectModal(false)} style={{ ...styles.btnOutline, flex: 1 }}>Cancelar</button>
                            <button onClick={handleRechazar} disabled={submitting} style={{ ...styles.btnDanger, flex: 1 }}>
                                {submitting ? 'Enviando...' : 'Confirmar Rechazo'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
    );
};

const styles = {
    page: { minHeight: '100vh', backgroundColor: '#e5edf7', fontFamily: "'Inter', system-ui, sans-serif" },
    centered: { minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', backgroundColor: '#e5edf7', padding: 20 },
    errorBox: { background: 'white', padding: 40, borderRadius: 16, textAlign: 'center', maxWidth: 420, border: '1px solid #fee2e2', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' },
    successBox: { background: 'white', padding: 40, borderRadius: 16, textAlign: 'center', maxWidth: 420, border: '1px solid #dcfce7', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' },
    header: { background: 'linear-gradient(135deg, #1e3a8a, #002D54)', color: 'white', padding: '24px 40px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
    logo: { fontSize: '2rem', fontWeight: '900', letterSpacing: 4, color: 'white' },
    container: { maxWidth: 920, margin: '0 auto', padding: '32px 20px' },
    card: { background: 'white', borderRadius: 16, padding: 28, marginBottom: 20, boxShadow: '0 2px 12px rgba(0,0,0,0.06)', border: '1px solid #b0b0b0' },
    cardTitle: { margin: '0 0 12px', color: '#1e293b', fontSize: '1.3rem' },
    sectionTitle: { display: 'flex', alignItems: 'center', gap: 8, color: '#1e293b', fontWeight: 700, fontSize: '1.1rem', margin: '0 0 16px' },
    table: { width: '100%', borderCollapse: 'collapse', borderRadius: 8, overflow: 'hidden' },
    th: { padding: '12px 16px', fontWeight: 600, fontSize: '0.9rem' },
    td: { padding: '10px 16px', fontSize: '0.9rem', color: '#334155' },
    canvas: { width: '100%', maxWidth: 700, height: 180, border: '2px dashed #c7d5e6', borderRadius: 10, cursor: 'crosshair', backgroundColor: '#e5edf7', display: 'block', touchAction: 'none' },
    canvasPlaceholder: { position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', color: '#7a7a77', fontSize: '0.9rem', pointerEvents: 'none' },
    btnPrimary: { display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 24px', background: '#002D54', color: 'white', border: 'none', borderRadius: 10, cursor: 'pointer', fontWeight: 700, fontSize: '0.95rem', transition: 'all 0.2s' },
    btnSecondary: { display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 20px', background: '#e5edf7', color: '#002D54', border: '1px solid #c7d5e6', borderRadius: 10, cursor: 'pointer', fontWeight: 600, marginTop: 12 },
    btnOutline: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 18px', background: 'white', color: '#50504d', border: '1px solid #c7d5e6', borderRadius: 10, cursor: 'pointer', fontWeight: 500 },
    btnDanger: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 18px', background: '#fee2e2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 10, cursor: 'pointer', fontWeight: 600 },
    overlay: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000 },
    modal: { background: 'white', borderRadius: 16, padding: 32, maxWidth: 480, width: '90%', boxShadow: '0 25px 50px rgba(0,0,0,0.3)' },
};

export default PresupuestoCliente;
