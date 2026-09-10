import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../utils/supabaseClient';
import { useModal, useToast, Modal } from '../utils/useModal';
import { esNifValido, normalizarNif } from '../utils/nif';
import {
    Building2, Plus, Edit2, Trash2, Search, Mail, Phone,
    FileText, MapPin, Loader2, ChevronDown, ChevronUp, StickyNote
} from 'lucide-react';

const EMPTY_FORM = { nombre: '', email: '', telefono: '', nif: '', direccion: '', notas: '' };

const Clientes = () => {
    const { showConfirm, ModalUI } = useModal();
    const { showToast, ToastUI }   = useToast();

    const [clientes,       setClientes]       = useState([]);
    const [loading,        setLoading]        = useState(true);
    const [search,         setSearch]         = useState('');
    const [showModal,      setShowModal]      = useState(false);
    const [editingCliente, setEditingCliente] = useState(null);
    const [form,           setForm]           = useState(EMPTY_FORM);
    const [saving,         setSaving]         = useState(false);
    const [expandedId,     setExpandedId]     = useState(null);

    // ── Carga ─────────────────────────────────────────────────────────────────
    const fetchClientes = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('clientes')
                .select('*')
                .order('nombre', { ascending: true });
            if (error) throw error;
            setClientes(data || []);
        } catch (err) {
            showToast('Error al cargar clientes: ' + err.message, 'error');
        } finally {
            setLoading(false);
        }
    };

    // Carga única al montar; fetchClientes no necesita estar en deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { fetchClientes(); }, []);

    // ── Filtro ────────────────────────────────────────────────────────────────
    const filteredClientes = useMemo(() => {
        if (!search.trim()) return clientes;
        const q = search.toLowerCase();
        return clientes.filter(c =>
            (c.nombre   || '').toLowerCase().includes(q) ||
            (c.email    || '').toLowerCase().includes(q) ||
            (c.nif      || '').toLowerCase().includes(q) ||
            (c.telefono || '').toLowerCase().includes(q)
        );
    }, [clientes, search]);

    // ── Abrir modales ─────────────────────────────────────────────────────────
    const openNew = () => {
        setEditingCliente(null);
        setForm(EMPTY_FORM);
        setShowModal(true);
    };

    const openEdit = (c) => {
        setEditingCliente(c);
        setForm({
            nombre:    c.nombre    || '',
            email:     c.email     || '',
            telefono:  c.telefono  || '',
            nif:       c.nif       || '',
            direccion: c.direccion || '',
            notas:     c.notas     || '',
        });
        setShowModal(true);
    };

    // ── Guardar (crear o editar) ───────────────────────────────────────────────
    const handleSave = async () => {
        if (!form.nombre.trim()) {
            showToast('El nombre o empresa es obligatorio.', 'error');
            return;
        }
        if (!form.email.trim()) {
            showToast('Hace falta añadir un correo electrónico.', 'error');
            return;
        }
        const nifNorm = normalizarNif(form.nif);
        if (!nifNorm) {
            showToast('El NIF / CIF es obligatorio.', 'error');
            return;
        }
        if (!esNifValido(nifNorm)) {
            showToast('El NIF / CIF no es válido. Debe incluir la letra de control correcta (ej. 49970504Z).', 'error');
            return;
        }
        const formFinal = { ...form, nif: nifNorm };
        setSaving(true);
        try {
            if (editingCliente) {
                const { error } = await supabase
                    .from('clientes')
                    .update(formFinal)
                    .eq('id', editingCliente.id);
                if (error) throw error;
                setClientes(prev =>
                    prev.map(c => c.id === editingCliente.id ? { ...c, ...formFinal } : c)
                );
                showToast('Cliente actualizado.');
            } else {
                const { error } = await supabase.from('clientes').insert([formFinal]);
                if (error) throw error;
                await fetchClientes();
                showToast('Cliente creado correctamente.');
            }
            setShowModal(false);
        } catch (err) {
            showToast('Error: ' + err.message, 'error');
        } finally {
            setSaving(false);
        }
    };

    // ── Eliminar ──────────────────────────────────────────────────────────────
    const handleDelete = (c) => {
        showConfirm(
            `¿Eliminar a "${c.nombre}"?\n\nSus proyectos en BD no se verán afectados.`,
            async () => {
                try {
                    const { error } = await supabase.from('clientes').delete().eq('id', c.id);
                    if (error) throw error;
                    setClientes(prev => prev.filter(x => x.id !== c.id));
                    showToast('Cliente eliminado.');
                } catch (err) {
                    showToast('Error: ' + err.message, 'error');
                }
            },
            { type: 'danger', confirmLabel: 'Eliminar' }
        );
    };

    // ── Helpers UI ────────────────────────────────────────────────────────────
    const setField = (key) => (e) => {
        let val = e.target.value;
        if (key === 'nif') val = val.replace(/[-\s]/g, '').toUpperCase();
        setForm(prev => ({ ...prev, [key]: val }));
    };

    const labelStyle = { fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '0.4px' };

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <div className="animate-fade-in">
            {ToastUI}
            {ModalUI}

            {/* Header */}
            <div className="glass-card" style={{ marginBottom: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                    <div>
                        <h1 style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: 0 }}>
                            <Building2 size={32} color="var(--primary)" />
                            Clientes
                        </h1>
                        <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                            Directorio de clientes y empresas.
                        </p>
                    </div>
                    <button
                        className="btn btn-primary"
                        onClick={openNew}
                        style={{ display: 'flex', alignItems: 'center', gap: '8px', whiteSpace: 'nowrap' }}
                    >
                        <Plus size={16} /> Nuevo Cliente
                    </button>
                </div>
            </div>

            {/* Buscador */}
            <div className="glass-card" style={{ marginBottom: '16px', padding: '14px 20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                    <div style={{ position: 'relative', flex: '1 1 280px', maxWidth: '440px' }}>
                        <Search size={15} style={{ position: 'absolute', left: '11px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
                        <input
                            type="text"
                            className="input"
                            placeholder="Buscar por nombre, email o NIF..."
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            style={{ paddingLeft: '34px' }}
                        />
                    </div>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem', whiteSpace: 'nowrap' }}>
                        {filteredClientes.length} / {clientes.length} clientes
                    </span>
                </div>
            </div>

            {/* Lista */}
            <div className="glass-card" style={{ padding: 0 }}>
                {loading ? (
                    <div style={{ display: 'flex', justifyContent: 'center', padding: '60px' }}>
                        <Loader2 className="loader-spinner" size={32} />
                    </div>
                ) : filteredClientes.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '64px 20px', color: 'var(--text-muted)' }}>
                        <Building2 size={52} style={{ opacity: 0.2, display: 'block', margin: '0 auto 16px' }} />
                        <p style={{ marginBottom: '16px' }}>
                            {search ? 'No se encontraron clientes con ese criterio.' : 'Aun no hay clientes registrados.'}
                        </p>
                        {!search && (
                            <button className="btn btn-primary" onClick={openNew} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                <Plus size={15} /> Añadir primer cliente
                            </button>
                        )}
                    </div>
                ) : (
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 460 }}>
                            <thead>
                                <tr style={{ background: 'var(--bg-secondary)', borderBottom: '2px solid var(--border-color)' }}>
                                    {['', 'Nombre / Empresa', 'Email', 'Telefono', 'NIF', 'Acciones'].map((h, i) => (
                                        <th key={i} style={{
                                            padding: i === 0 ? '12px 8px 12px 16px' : '12px 16px',
                                            textAlign: 'left',
                                            fontSize: '0.72rem',
                                            fontWeight: 700,
                                            textTransform: 'uppercase',
                                            color: 'var(--text-muted)',
                                            letterSpacing: '0.5px',
                                            whiteSpace: 'nowrap'
                                        }}>
                                            {h}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {filteredClientes.map((c, i) => {
                                    const isExpanded = expandedId === c.id;
                                    const rowBg = i % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.018)';
                                    return (
                                        <React.Fragment key={c.id}>
                                            <tr
                                                style={{ borderBottom: isExpanded ? 'none' : '1px solid var(--border-color)', background: rowBg }}
                                                onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,45,84,0.04)'}
                                                onMouseLeave={e => e.currentTarget.style.background = rowBg}
                                            >
                                                <td style={{ padding: '10px 4px 10px 14px', width: '24px' }}>
                                                    {(c.direccion || c.notas) && (
                                                        <button
                                                            onClick={() => setExpandedId(isExpanded ? null : c.id)}
                                                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '2px', display: 'flex', alignItems: 'center' }}
                                                        >
                                                            {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                                        </button>
                                                    )}
                                                </td>
                                                <td style={{ padding: '10px 16px', fontWeight: 600, fontSize: '0.95rem' }}>
                                                    {c.nombre}
                                                </td>
                                                <td style={{ padding: '10px 16px', fontSize: '0.85rem' }}>
                                                    {c.email
                                                        ? <a href={`mailto:${c.email}`} style={{ color: 'var(--primary)', textDecoration: 'none' }}>{c.email}</a>
                                                        : <span style={{ color: 'var(--text-muted)' }}>-</span>}
                                                </td>
                                                <td style={{ padding: '10px 16px', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                                                    {c.telefono || '-'}
                                                </td>
                                                <td style={{ padding: '10px 16px', fontSize: '0.85rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                                                    {c.nif || '-'}
                                                </td>
                                                <td style={{ padding: '10px 16px' }}>
                                                    <div style={{ display: 'flex', gap: '8px' }}>
                                                        <button
                                                            className="btn btn-secondary"
                                                            onClick={() => openEdit(c)}
                                                            style={{ padding: '5px 10px', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '4px' }}
                                                        >
                                                            <Edit2 size={12} /> Editar
                                                        </button>
                                                        <button
                                                            className="btn"
                                                            onClick={() => handleDelete(c)}
                                                            style={{ padding: '5px 10px', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '4px', backgroundColor: 'rgba(239,68,68,0.08)', color: 'var(--error)', border: '1px solid var(--error)' }}
                                                        >
                                                            <Trash2 size={12} />
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                            {isExpanded && (
                                                <tr style={{ background: 'rgba(0,45,84,0.03)', borderBottom: '1px solid var(--border-color)' }}>
                                                    <td />
                                                    <td colSpan={5} style={{ padding: '10px 16px 14px' }}>
                                                        <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                                                            {c.direccion && (
                                                                <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                                    <MapPin size={13} /> {c.direccion}
                                                                </span>
                                                            )}
                                                            {c.notas && (
                                                                <span style={{ display: 'flex', alignItems: 'flex-start', gap: '6px' }}>
                                                                    <StickyNote size={13} style={{ flexShrink: 0, marginTop: 2 }} />
                                                                    <em>{c.notas}</em>
                                                                </span>
                                                            )}
                                                        </div>
                                                    </td>
                                                </tr>
                                            )}
                                        </React.Fragment>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Modal crear/editar — componente compartido */}
            {showModal && (
                <Modal
                    title={editingCliente ? 'Editar Cliente' : 'Nuevo Cliente'}
                    icon={<Building2 size={22} color="var(--primary)" />}
                    onClose={() => setShowModal(false)}
                    maxWidth={520}
                    footer={
                        <>
                            <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancelar</button>
                            <button className="btn btn-primary" onClick={handleSave} disabled={saving} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                {saving && <Loader2 className="loader-spinner" size={14} />}
                                {editingCliente ? 'Guardar cambios' : 'Crear cliente'}
                            </button>
                        </>
                    }
                >
                    <div style={{ display: 'grid', gap: '14px' }}>
                        {/* Nombre - fila completa */}
                        <div>
                            <label style={labelStyle}>Nombre / Empresa *</label>
                            <input type="text" className="input" style={{ width: '100%', boxSizing: 'border-box' }} value={form.nombre} onChange={setField('nombre')} autoFocus onKeyDown={e => { if (e.key === 'Enter') handleSave(); }} />
                        </div>
                        {/* Email | Telefono */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', minWidth: 0 }}>
                            <div style={{ minWidth: 0 }}>
                                <label style={labelStyle}>Email</label>
                                <input type="email" className="input" style={{ width: '100%', boxSizing: 'border-box' }} value={form.email} onChange={setField('email')} onKeyDown={e => { if (e.key === 'Enter') handleSave(); }} />
                            </div>
                            <div style={{ minWidth: 0 }}>
                                <label style={labelStyle}>Telefono</label>
                                <input type="tel" className="input" style={{ width: '100%', boxSizing: 'border-box' }} value={form.telefono} onChange={setField('telefono')} onKeyDown={e => { if (e.key === 'Enter') handleSave(); }} />
                            </div>
                        </div>
                        {/* NIF | Dirección */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', minWidth: 0 }}>
                            <div style={{ minWidth: 0 }}>
                                <label style={labelStyle}>NIF / CIF * (sin guion)</label>
                                <input type="text" className="input" style={{ width: '100%', boxSizing: 'border-box' }} value={form.nif} onChange={setField('nif')} onKeyDown={e => { if (e.key === 'Enter') handleSave(); }} />
                            </div>
                            <div style={{ minWidth: 0 }}>
                                <label style={labelStyle}>Dirección</label>
                                <input type="text" className="input" style={{ width: '100%', boxSizing: 'border-box' }} value={form.direccion} onChange={setField('direccion')} onKeyDown={e => { if (e.key === 'Enter') handleSave(); }} />
                            </div>
                        </div>
                        {/* Notas - fila completa */}
                        <div>
                            <label style={labelStyle}>Notas internas</label>
                            <textarea
                                className="input"
                                rows={2}
                                value={form.notas}
                                onChange={setField('notas')}
                                style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit' }}
                                placeholder="Observaciones, condiciones especiales..."
                            />
                        </div>
                    </div>
                </Modal>
            )}
        </div>
    );
};

export default Clientes;
