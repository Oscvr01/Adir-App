import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useModal, useToast, Modal } from '../utils/useModal';
import { Edit2, Trash2, Plus, Users, Search, Loader2, Eye, EyeOff } from 'lucide-react';
import { supabase } from '../utils/supabaseClient';
import { toHex } from '../utils/hash';

const TIPOS_USUARIO = {
  0: 'Usuario / Resp. Obra',
  1: 'Administrador',
  2: 'Administración',
  3: 'Jefe de Obra'
};

const EMPTY_FORM = {
  nombre: '',
  apellido: '',
  correo: '',
  contrasena: '',
  tipo_usuario: 0
};

const Usuarios = () => {
  const { user } = useAuth();
  const { showToast, ToastUI } = useToast();
  const { showConfirm, ModalUI } = useModal();
  const navigate = useNavigate();
  const [usuarios, setUsuarios] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);

  // Verificar permisos
  useEffect(() => {
    if (!user || (user.tipo_usuario !== 1 && user.tipo_usuario !== 2)) {
      navigate('/dashboard', { replace: true });
    }
  }, [user, navigate]);

  const fetchUsuarios = React.useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('usuarios')
        .select('id,nombre,apellido,correo,tipo_usuario')
        .order('nombre', { ascending: true });

      if (error) throw error;
      setUsuarios(data || []);
    } catch (err) {
      console.error('Error fetching usuarios:', err);
      showToast('Error al cargar usuarios', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    fetchUsuarios();
  }, [fetchUsuarios]);

  const filteredUsuarios = useMemo(() => {
    if (!search.trim()) return usuarios;
    const q = search.toLowerCase();
    return usuarios.filter((u) =>
      u.nombre?.toLowerCase().includes(q) ||
      u.apellido?.toLowerCase().includes(q) ||
      u.correo?.toLowerCase().includes(q)
    );
  }, [usuarios, search]);

  const openNew = () => {
    setEditingItem(null);
    setForm(EMPTY_FORM);
    setShowPass(false);
    setShowModal(true);
  };

  const openEdit = (u) => {
    setEditingItem(u);
    setForm({
      nombre: u.nombre || '',
      apellido: u.apellido || '',
      correo: u.correo || '',
      contrasena: '',
      tipo_usuario: u.tipo_usuario ?? 0
    });
    setShowPass(false);
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.nombre.trim() || !form.correo.trim()) {
      showToast('Campos requeridos: nombre y correo', 'error');
      return;
    }
    if (!editingItem && !form.contrasena.trim()) {
      showToast('Contraseña requerida para nuevo usuario', 'error');
      return;
    }

    setSaving(true);
    try {
      if (editingItem) {
        const updateData = {
          nombre: form.nombre,
          apellido: form.apellido,
          correo: form.correo,
          tipo_usuario: form.tipo_usuario
        };
        if (form.contrasena.trim()) {
          updateData.contrasena = toHex(form.contrasena);
        }

        const { error } = await supabase
          .from('usuarios')
          .update(updateData)
          .eq('id', editingItem.id);

        if (error) throw error;
        showToast('Usuario actualizado', 'success');
      } else {
        const insertData = {
          nombre: form.nombre,
          apellido: form.apellido,
          correo: form.correo,
          contrasena: toHex(form.contrasena),
          tipo_usuario: form.tipo_usuario,
          isActive: 1
        };

        const { error } = await supabase.from('usuarios').insert([insertData]);

        if (error) throw error;
        showToast('Usuario creado', 'success');
      }

      setShowModal(false);
      fetchUsuarios();
    } catch (err) {
      console.error('Error saving usuario:', err);
      showToast(err.message || 'Error al guardar', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (u) => {
    showConfirm(
      `¿Eliminar al usuario "${u.nombre} ${u.apellido}"?`,
      async () => {
        try {
          const { error } = await supabase.from('usuarios').delete().eq('id', u.id);
          if (error) throw error;
          showToast('Usuario eliminado', 'success');
          fetchUsuarios();
        } catch (err) {
          console.error('Error deleting usuario:', err);
          showToast('Error al eliminar', 'error');
        }
      },
      { type: 'danger', confirmLabel: 'Eliminar', title: 'Eliminar Usuario' }
    );
  };

  const setField = (key) => (e) =>
    setForm((prev) => ({ ...prev, [key]: key === 'tipo_usuario' ? parseInt(e.target.value, 10) : e.target.value }));

  const labelStyle = { fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.4px', display: 'block', marginBottom: 5 };

  return (
    <div className="animate-fade-in">
      {ToastUI}
      {ModalUI}

      {/* Header */}
      <div className="glass-card" style={{ marginBottom: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h1 style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: 0 }}>
              <Users size={32} color="var(--primary)" /> Gestión de Usuarios
            </h1>
            <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
              Administra los usuarios del sistema y sus permisos.
            </p>
          </div>
          <button className="btn btn-primary" onClick={openNew} style={{ display: 'flex', alignItems: 'center', gap: '8px', whiteSpace: 'nowrap' }}>
            <Plus size={16} /> Nuevo Usuario
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
              placeholder="Buscar por nombre o correo..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ paddingLeft: '34px' }}
            />
          </div>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem', whiteSpace: 'nowrap' }}>
            {filteredUsuarios.length} / {usuarios.length} usuarios
          </span>
        </div>
      </div>

      {/* Lista */}
      <div className="glass-card" style={{ padding: 0 }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '60px' }}>
            <Loader2 className="loader-spinner" size={32} />
          </div>
        ) : filteredUsuarios.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '64px 20px', color: 'var(--text-muted)' }}>
            <Users size={52} style={{ opacity: 0.2, display: 'block', margin: '0 auto 16px' }} />
            <p>{search ? 'No se encontraron usuarios.' : 'Aún no hay usuarios registrados.'}</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
              <thead>
                <tr style={{ background: 'var(--bg-secondary)', borderBottom: '2px solid var(--border-color)' }}>
                  {['Nombre', 'Correo', 'Tipo', 'Acciones'].map((h, i) => (
                    <th key={i} style={{
                      padding: '12px 16px',
                      textAlign: i === 3 ? 'center' : 'left',
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
                {filteredUsuarios.map((u, i) => {
                  const rowBg = i % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.018)';
                  return (
                    <tr key={u.id}
                      style={{ borderBottom: '1px solid var(--border-color)', background: rowBg }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(0,45,84,0.04)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = rowBg)}
                    >
                      <td style={{ padding: '10px 16px', fontWeight: 600, fontSize: '0.95rem' }}>
                        {u.nombre} {u.apellido}
                      </td>
                      <td style={{ padding: '10px 16px', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                        {u.correo}
                      </td>
                      <td style={{ padding: '10px 16px' }}>
                        <span style={{ display: 'inline-block', padding: '3px 10px', background: 'rgba(0,45,84,0.08)', color: 'var(--primary)', borderRadius: 12, fontSize: '0.72rem', fontWeight: 700 }}>
                          {TIPOS_USUARIO[u.tipo_usuario] || 'Desconocido'}
                        </span>
                      </td>
                      <td style={{ padding: '10px 16px' }}>
                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                          <button
                            className="btn btn-secondary"
                            onClick={() => openEdit(u)}
                            style={{ padding: '5px 10px', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '4px' }}
                            title="Editar usuario"
                          >
                            <Edit2 size={12} /> Editar
                          </button>
                          <button
                            className="btn"
                            onClick={() => handleDelete(u)}
                            style={{ padding: '5px 10px', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '4px', backgroundColor: 'rgba(239,68,68,0.08)', color: 'var(--error)', border: '1px solid var(--error)' }}
                            title="Eliminar usuario"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal crear/editar */}
      {showModal && (
        <Modal
          title={editingItem ? 'Editar Usuario' : 'Nuevo Usuario'}
          icon={<Users size={22} color="var(--primary)" />}
          onClose={() => setShowModal(false)}
          maxWidth={480}
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {saving && <Loader2 className="loader-spinner" size={14} />}
                {editingItem ? 'Guardar cambios' : 'Crear usuario'}
              </button>
            </>
          }
        >
          <div style={{ display: 'grid', gap: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, minWidth: 0 }}>
              <div style={{ minWidth: 0 }}>
                <label style={labelStyle}>Nombre *</label>
                <input className="input" style={{ width: '100%', boxSizing: 'border-box' }} value={form.nombre} onChange={setField('nombre')} autoFocus />
              </div>
              <div style={{ minWidth: 0 }}>
                <label style={labelStyle}>Apellido</label>
                <input className="input" style={{ width: '100%', boxSizing: 'border-box' }} value={form.apellido} onChange={setField('apellido')} />
              </div>
            </div>
            <div>
              <label style={labelStyle}>Correo *</label>
              <input className="input" type="email" value={form.correo} onChange={setField('correo')} />
            </div>
            <div>
              <label style={labelStyle}>
                {editingItem ? 'Nueva contraseña' : 'Contraseña *'}
                {editingItem && <span style={{ fontWeight: 400, textTransform: 'none' }}> (dejar en blanco para no cambiar)</span>}
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  className="input"
                  type={showPass ? 'text' : 'password'}
                  value={form.contrasena}
                  onChange={setField('contrasena')}
                  placeholder={editingItem ? '••••••••' : 'Contraseña inicial'}
                  style={{ paddingRight: 40 }}
                />
                <button onClick={() => setShowPass((v) => !v)} type="button"
                  style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0 }}>
                  {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            <div>
              <label style={labelStyle}>Tipo de usuario</label>
              <select className="input" value={form.tipo_usuario} onChange={setField('tipo_usuario')}>
                {Object.entries(TIPOS_USUARIO).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default Usuarios;
