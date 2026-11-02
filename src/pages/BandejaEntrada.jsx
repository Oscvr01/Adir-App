import React, { useState, useEffect } from 'react';
import { supabase } from '../utils/supabaseClient';
import { Loader2, Mailbox, CheckCircle, Trash2, Clock, Bell, Archive, Mail, User, Building2 } from 'lucide-react';
import { useToast } from '../utils/useModal';
import { getCleanProjectName } from '../utils/aiAllocation';

const isEmailFormat = (str) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str || '');

const BandejaEntrada = () => {
    const [pendientes, setPendientes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState({});
    const [editTitles, setEditTitles] = useState({});
    const [editClientes, setEditClientes] = useState({});
    const [editEmails, setEditEmails] = useState({});
    const { showToast, ToastUI } = useToast();
    const [notificaciones, setNotificaciones] = useState([]);
    // IDs de proyectos aceptados cuyo cliente aún no está en BD (para ofrecer guardarlo)
    const [ofrecerGuardarCliente, setOfrecerGuardarCliente] = useState({});
    // Directorio completo de clientes (para el combobox de selección)
    const [clientesDir, setClientesDir] = useState([]);

    useEffect(() => {
        (async () => {
            try {
                const { data, error } = await supabase
                    .from('clientes')
                    .select('id,nombre,email')
                    .order('nombre', { ascending: true });
                if (error) throw error;
                setClientesDir(data || []);
            } catch (e) {
                console.warn('No se pudo cargar el directorio de clientes:', e);
            }
        })();
    }, []);

    // Al escribir/elegir un cliente solo se actualiza el NOMBRE.
    // El cuadro de correo se mantiene intacto (es el correo del remitente).
    const handleClienteChange = (proyectoId, value) => {
        setEditClientes(prev => ({ ...prev, [proyectoId]: value }));
    };

    const fetchPendientes = React.useCallback(async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('propuestas')
                .select('*')
                .eq('estado', 'Pendiente')
                .order('fecha_recepcion', { ascending: false });

            if (error) throw error;
            setPendientes(data || []);

            // Extraer emails únicos para buscar clientes asociados en BD
            const emails = [...new Set(
                (data || []).map(p => isEmailFormat(p.cliente) ? p.cliente : (isEmailFormat(p.direccion) ? p.direccion : null)).filter(Boolean)
            )];

            // Mapa email → nombre desde ctcon_clientes
            let emailToNombre = {};
            if (emails.length > 0) {
                const { data: clis } = await supabase
                    .from('clientes')
                    .select('nombre,email')
                    .in('email', emails);
                (clis || []).forEach(c => { if (c.email) emailToNombre[c.email] = c.nombre; });
            }

            const initialTitles  = {};
            const initialClientes = {};
            const initialEmails  = {};
            (data || []).forEach(p => {
                // Título: extraer nombre limpio del ID del proyecto
                initialTitles[p.Proyecto] = getCleanProjectName(p.Proyecto);

                let emailUsado = '';
                let nombreUsado = '';

                if (isEmailFormat(p.cliente)) {
                    // BC3 llegó con el remitente como "cliente"
                    emailUsado   = p.cliente;
                    // Si el email está en el directorio → auto-rellenar nombre
                    nombreUsado  = emailToNombre[p.cliente] || '';
                } else {
                    nombreUsado  = p.cliente || '';
                    emailUsado   = isEmailFormat(p.direccion) ? p.direccion : (p.direccion || '');
                    // Si tenemos email y no tenemos nombre, intentar lookup
                    if (!nombreUsado && emailUsado && emailToNombre[emailUsado]) {
                        nombreUsado = emailToNombre[emailUsado];
                    }
                }

                initialClientes[p.Proyecto] = nombreUsado;
                initialEmails[p.Proyecto]   = emailUsado;
            });
            setEditTitles(initialTitles);
            setEditClientes(initialClientes);
            setEditEmails(initialEmails);
        } catch (error) {
            console.error("Error al cargar la bandeja de entrada:", error);
            showToast("Error de conexión al cargar la bandeja.", "error");
        } finally {
            setLoading(false);
        }
    }, [showToast]);

    const fetchNotificaciones = React.useCallback(async () => {
        try {
            const { data, error } = await supabase
                .from('presupuestos_cliente')
                .select('*')
                .in('estado', ['firmado', 'rechazado'])
                .order('fecha_firma', { ascending: false });
                
            if (error) throw error;
            setNotificaciones(data || []);
        } catch (error) {
            console.error("Error al cargar notificaciones:", error);
        }
    }, []);

    useEffect(() => {
        fetchPendientes();
        fetchNotificaciones();
    }, [fetchPendientes, fetchNotificaciones]);

    const handleArchivarNotificacion = async (token, estadoActual) => {
        try {
            const nuevoEstado = estadoActual === 'firmado' ? 'firmado_archivado' : 'rechazado_archivado';
            const { error } = await supabase
                .from('presupuestos_cliente')
                .update({ estado: nuevoEstado })
                .eq('token', token);

            if (error) throw error;
            
            showToast('Notificación archivada correctamente.');
            setNotificaciones(prev => prev.filter(n => n.token !== token));
        } catch (error) {
            console.error("Error archivando:", error);
            showToast("Error al archivar la notificación.", "error");
        }
    };

    const handleAccept = async (proyectoId) => {
        if (!proyectoId) return;

        const finalTitle   = editTitles[proyectoId]   || "Sin Título";
        const finalCliente = editClientes[proyectoId] || '';
        const finalEmail   = editEmails[proyectoId]   || '';

        setActionLoading(prev => ({ ...prev, [proyectoId]: true }));
        try {
            const { error } = await supabase
                .from('propuestas')
                .update({
                    estado:    'Borrador',
                    cliente:   finalCliente.trim() || null,
                    direccion: finalEmail
                })
                .eq('Proyecto', proyectoId);

            if (error) throw error;

            showToast(`✅ Proyecto "${finalTitle}" aceptado.`);
            setPendientes(prev => prev.filter(p => p.Proyecto !== proyectoId));

            // Si hay email y nombre pero no estaba en el directorio → ofrecer guardarlo
            if (finalEmail && finalCliente.trim()) {
                const { data: existe } = await supabase
                    .from('clientes')
                    .select('id')
                    .eq('email', finalEmail)
                    .maybeSingle();
                if (!existe) {
                    setOfrecerGuardarCliente(prev => ({
                        ...prev,
                        [proyectoId]: { nombre: finalCliente.trim(), email: finalEmail }
                    }));
                }
            }
        } catch (error) {
            console.error("Error aceptando el proyecto:", error);
            showToast("Error al aceptar: " + error.message, "error");
        } finally {
            setActionLoading(prev => ({ ...prev, [proyectoId]: false }));
        }
    };

    const handleGuardarCliente = async (proyectoId) => {
        const info = ofrecerGuardarCliente[proyectoId];
        if (!info) return;
        try {
            const { error } = await supabase.from('clientes').insert([{ nombre: info.nombre, email: info.email }]);
            if (error) throw error;
            showToast(`👤 "${info.nombre}" guardado en el directorio de Clientes.`);
        } catch (err) {
            showToast('Error al guardar cliente: ' + err.message, 'error');
        } finally {
            setOfrecerGuardarCliente(prev => { const n = { ...prev }; delete n[proyectoId]; return n; });
        }
    };

    const [confirmingReject, setConfirmingReject] = useState(null);

    const handleReject = async (proyectoId) => {
        if (!proyectoId) {
            showToast("No se pudo identificar el proyecto para borrar.", "error");
            return;
        }

        if (confirmingReject !== proyectoId) {
            setConfirmingReject(proyectoId);
            return;
        }
        
        setActionLoading(prev => ({ ...prev, [proyectoId]: true }));
        try {

            const proyectoNombre = editTitles[proyectoId] || proyectoId.split('_')[0];

            // 1. Borramos partidas asociadas
            await supabase.from('partidas').delete().eq('propuesta_id', proyectoId);

            // 2. Borramos la propuesta maestra y VERIFICAMOS el conteo
            const { error: errorPropuesta, count } = await supabase
                .from('propuestas')
                .delete({ count: 'exact' })
                .eq('Proyecto', proyectoId);

            if (errorPropuesta) throw errorPropuesta;

            if (count === 0) {
                throw new Error("El servidor no eliminó el registro. Verifica los permisos en la API.");
            }

            showToast(`🗑️ Proyecto "${proyectoNombre}" eliminado permanentemente.`);
            setPendientes(prev => prev.filter(p => p.Proyecto !== proyectoId));
            setConfirmingReject(null);
        } catch (error) {
            console.error("Error crítico al borrar:", error);
            showToast("Fallo en base de datos: " + error.message, "error");
        } finally {
            setActionLoading(prev => ({ ...prev, [proyectoId]: false }));
        }
    };

    return (
        <div className="animate-fade-in" style={{ padding: '0 20px 40px', maxWidth: '1200px', margin: '0 auto' }}>
            {ToastUI}
            <datalist id="clientes-directorio">
                {clientesDir.map((c) => (
                    <option key={c.id} value={c.nombre} />
                ))}
            </datalist>
            <div className="glass-card" style={{ marginBottom: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                        <div>
                            <h1 style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: 0 }}><Mailbox size={32} color="var(--primary)" /> Bandeja de Recepción Automática</h1>
                            <p style={{ margin: '2px 0 0', color: 'var(--text-muted)', fontSize: '0.9rem' }}>Buzón inteligente que intercepta correos con ficheros BC3 configurados mediante n8n. Los proyectos recibidos aparecen aquí para revisión y aceptación.</p>
                        </div>
                    </div>
                </div>
            </div>

            {notificaciones.length > 0 && (
                <div style={{ marginBottom: '40px' }}>
                    <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-primary)', marginBottom: '16px', fontSize: '1.25rem' }}>
                        <Bell size={24} color="#f59e0b" /> Notificaciones Recientes
                    </h2>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '20px' }}>
                        {notificaciones.map(n => {
                            const isFirmado = n.estado === 'firmado';
                            return (
                                <div key={n.token} className="glass-card" style={{ display: 'flex', flexDirection: 'column', borderLeft: `6px solid ${isFirmado ? '#16a34a' : '#dc2626'}`, padding: '20px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                                        <span className="badge" style={{ backgroundColor: isFirmado ? '#dcfce7' : '#fee2e2', color: isFirmado ? '#15803d' : '#991b1b', fontWeight: 'bold' }}>
                                            {isFirmado ? '✅ PRESUPUESTO FIRMADO' : '❌ PRESUPUESTO RECHAZADO'}
                                        </span>
                                        <button onClick={() => handleArchivarNotificacion(n.token, n.estado)} title="Archivar/Marcar leído" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '6px', cursor: 'pointer', color: 'var(--text-muted)' }}>
                                            <Archive size={16} />
                                        </button>
                                    </div>
                                    <h3 style={{ margin: '0 0 8px', fontSize: '1.1rem' }}>{n.cliente_nombre || n.cliente_email}</h3>
                                    <p style={{ margin: '0 0 4px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}><strong>Proyecto:</strong> {n.propuesta_id}</p>
                                    <p style={{ margin: '0 0 12px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}><strong>Importe:</strong> {Number(n.precio_total || 0).toLocaleString('es-ES', {minimumFractionDigits: 2})} €</p>
                                    
                                    {!isFirmado && n.detalles_rechazo && (
                                        <div style={{ backgroundColor: '#fef2f2', border: '1px solid #fecaca', padding: '10px', borderRadius: '8px', fontSize: '0.8rem', color: '#7f1d1d', marginTop: 'auto' }}>
                                            <strong>Motivo:</strong> {n.detalles_rechazo}
                                        </div>
                                    )}
                                    
                                    {isFirmado && (
                                        <div style={{ marginTop: 'auto', fontSize: '0.8rem', color: '#15803d', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: '600' }}>
                                            <CheckCircle size={14} /> Listo para ejecución
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Banner: ofrecer guardar cliente nuevo tras aceptar */}
            {Object.entries(ofrecerGuardarCliente).map(([proyId, info]) => (
                <div key={proyId} className="glass-card animate-fade-in" style={{ marginBottom: '16px', borderLeft: '4px solid var(--primary)', display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap', padding: '14px 20px' }}>
                    <Building2 size={20} color="var(--primary)" style={{ flexShrink: 0 }} />
                    <span style={{ flex: 1, fontSize: '0.9rem' }}>
                        <strong>{info.nombre}</strong> ({info.email}) no está en el directorio de clientes.
                        ¿Quieres guardarlo?
                    </span>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <button className="btn btn-secondary" style={{ fontSize: '0.82rem', padding: '5px 12px' }} onClick={() => setOfrecerGuardarCliente(prev => { const n = { ...prev }; delete n[proyId]; return n; })}>
                            No ahora
                        </button>
                        <button className="btn btn-primary" style={{ fontSize: '0.82rem', padding: '5px 12px', display: 'flex', alignItems: 'center', gap: '5px' }} onClick={() => handleGuardarCliente(proyId)}>
                            <Building2 size={13} /> Guardar cliente
                        </button>
                    </div>
                </div>
            ))}

            {loading ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '60px' }}>
                    <Loader2 className="loader-spinner" size={32} />
                </div>
            ) : pendientes.length === 0 ? (
                <div className="glass-card" style={{ textAlign: 'center', padding: '60px', marginTop: '20px' }}>
                    <Mailbox size={48} color="var(--text-muted)" style={{ opacity: 0.5, marginBottom: '20px', display: 'block', marginLeft: 'auto', marginRight: 'auto' }} />
                    <h3 style={{ color: 'var(--text-secondary)' }}>Bandeja Vacía</h3>
                    <p style={{ opacity: 0.7 }}>No hay nuevos proyectos atrapados por el correo.</p>
                </div>
            ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '20px' }}>
                    {pendientes.map((p, index) => {
                        const uniqueKey = p.Proyecto || `pendiente-${index}`;
                        return (
                            <div key={uniqueKey} className="glass-card" style={{ display: 'flex', flexDirection: 'column', borderTop: '4px solid var(--accent-primary)' }}>
                                <label style={{ fontSize: '0.7rem', fontWeight: 'bold', color: 'var(--text-muted)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                    Nombre del Proyecto
                                </label>
                                <input
                                    type="text"
                                    className="input"
                                    style={{
                                        marginBottom: '10px',
                                        fontSize: '1.05rem',
                                        fontWeight: '600',
                                        backgroundColor: 'rgba(0, 0, 0, 0.05)',
                                        border: '1px solid var(--border-color)',
                                        cursor: 'not-allowed',
                                        opacity: 0.7
                                    }}
                                    value={editTitles[p.Proyecto] || ""}
                                    readOnly
                                    disabled
                                    placeholder="Nombre del presupuesto..."
                                />

                                <label style={{ fontSize: '0.7rem', fontWeight: 'bold', color: 'var(--text-muted)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <User size={11} /> Cliente / Empresa
                                </label>
                                <input
                                    type="text"
                                    className="input"
                                    list="clientes-directorio"
                                    autoComplete="off"
                                    name={`cliente-${p.Proyecto}`}
                                    style={{ marginBottom: '10px', backgroundColor: 'white', border: '1px solid var(--border-color)' }}
                                    value={editClientes[p.Proyecto] || ""}
                                    onChange={(e) => handleClienteChange(p.Proyecto, e.target.value)}
                                    placeholder="Selecciona o escribe un cliente..."
                                />

                                <label style={{ fontSize: '0.7rem', fontWeight: 'bold', color: 'var(--text-muted)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <Mail size={11} /> Email de Contacto
                                </label>
                                <input
                                    type="email"
                                    className="input"
                                    autoComplete="off"
                                    style={{ marginBottom: '12px', backgroundColor: 'rgba(255,255,255,0.5)', border: '1px solid var(--border-color)' }}
                                    value={editEmails[p.Proyecto] || ""}
                                    onChange={(e) => setEditEmails(prev => ({ ...prev, [p.Proyecto]: e.target.value }))}
                                    placeholder="correo@cliente.com"
                                />

                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '18px' }}>
                                    <Clock size={13} />
                                    Recibido el: {p.fecha_recepcion ? new Date(p.fecha_recepcion).toLocaleDateString('es-ES') : 'Hoy'}
                                </div>

                                <div style={{ display: 'flex', gap: '10px', marginTop: 'auto' }}>
                                    {confirmingReject === p.Proyecto ? (
                                        <>
                                            <button 
                                                className="btn"
                                                style={{ 
                                                    flex: 1, 
                                                    backgroundColor: '#6b7280', 
                                                    color: 'white',
                                                    fontWeight: '600'
                                                }}
                                                onClick={() => setConfirmingReject(null)}
                                            >
                                                Cancelar
                                            </button>
                                            <button 
                                                className="btn"
                                                style={{ 
                                                    flex: 1.5, 
                                                    backgroundColor: '#dc2626', 
                                                    color: 'white',
                                                    fontWeight: 'bold',
                                                    boxShadow: '0 4px 12px rgba(220, 38, 38, 0.3)'
                                                }}
                                                onClick={() => handleReject(p.Proyecto)}
                                                disabled={!!actionLoading[p.Proyecto]}
                                            >
                                                {actionLoading[p.Proyecto] ? <Loader2 className="loader-spinner" size={16} /> : <Trash2 size={16} />}
                                                Confirmar Borrado
                                            </button>
                                        </>
                                    ) : (
                                        <>
                                            <button 
                                                className="btn"
                                                style={{ flex: 1, backgroundColor: 'rgba(239, 68, 68, 0.1)', color: 'var(--error)', border: '1px solid var(--error)' }}
                                                onClick={() => {

                                                    handleReject(p.Proyecto);
                                                }}
                                                disabled={!!actionLoading[p.Proyecto]}
                                            >
                                                {actionLoading[p.Proyecto] ? <Loader2 className="loader-spinner" size={16} /> : <Trash2 size={16} />}
                                                Rechazar
                                            </button>
                                            <button 
                                                className="btn btn-primary"
                                                style={{ flex: 1.5, backgroundColor: 'var(--success)' }}
                                                onClick={() => {

                                                    handleAccept(p.Proyecto);
                                                }}
                                                disabled={!!actionLoading[p.Proyecto]}
                                            >
                                                {actionLoading[p.Proyecto] ? <Loader2 className="loader-spinner" size={16} /> : <CheckCircle size={16} />}
                                                Aceptar y Abrir
                                            </button>
                                        </>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default BandejaEntrada;

