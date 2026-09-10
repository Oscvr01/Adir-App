import React, { useState, useEffect } from 'react';
import { HashRouter as Router, Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom';
import { FileUp, Files, Users, Settings, BarChart2, Mailbox, HardHat, Database, History, LayoutDashboard, FileSignature, Building2, LogOut, UserCog, Loader2, Eye, EyeOff } from 'lucide-react';
import { supabase } from './utils/supabaseClient';
import { AuthProvider, useAuth } from './context/AuthContext';
import { toHex } from './utils/hash';

// ─── Modal Mi Perfil ──────────────────────────────────────────────────────────
const PerfilModal = ({ user, onClose, onSaved }) => {
  const [form, setForm] = useState({ nombre: user.nombre || '', apellido: user.apellido || '', contrasena: '' });
  const [saving, setSaving] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [msg, setMsg] = useState(null);

  const handleSave = async () => {
    if (!form.nombre.trim()) { setMsg({ type: 'error', text: 'El nombre es obligatorio.' }); return; }
    setSaving(true);
    try {
      const updateData = { nombre: form.nombre.trim(), apellido: form.apellido.trim() };
      if (form.contrasena.trim()) updateData.contrasena = toHex(form.contrasena);
      const { error } = await supabase.from('usuarios').update(updateData).eq('id', user.id);
      if (error) throw error;
      setMsg({ type: 'ok', text: 'Perfil actualizado correctamente.' });
      onSaved({ ...user, nombre: updateData.nombre, apellido: updateData.apellido });
      setTimeout(onClose, 1200);
    } catch (err) {
      setMsg({ type: 'error', text: err.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 99999, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflowY: 'auto', padding: '40px 20px' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="glass-card animate-fade-in" style={{ width: '100%', maxWidth: '440px', margin: 'auto' }}>
        <h2 style={{ marginTop: 0, marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
          <UserCog size={22} color="var(--primary)" /> Mi Perfil
        </h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, minWidth: 0 }}>
            <div style={{ minWidth: 0 }}>
              <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.4px', display: 'block', marginBottom: 5 }}>Nombre *</label>
              <input className="input" style={{ width: '100%', boxSizing: 'border-box' }} value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} />
            </div>
            <div style={{ minWidth: 0 }}>
              <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.4px', display: 'block', marginBottom: 5 }}>Apellido</label>
              <input className="input" style={{ width: '100%', boxSizing: 'border-box' }} value={form.apellido} onChange={e => setForm(f => ({ ...f, apellido: e.target.value }))} />
            </div>
          </div>
          <div>
            <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.4px', display: 'block', marginBottom: 5 }}>Nueva contraseña <span style={{ fontWeight: 400, textTransform: 'none' }}>(dejar en blanco para no cambiar)</span></label>
            <div style={{ position: 'relative' }}>
              <input className="input" type={showPass ? 'text' : 'password'} value={form.contrasena} onChange={e => setForm(f => ({ ...f, contrasena: e.target.value }))} placeholder="••••••••" style={{ paddingRight: 40 }} />
              <button onClick={() => setShowPass(v => !v)} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0 }}>
                {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          {msg && (
            <div style={{ padding: '10px 14px', borderRadius: 8, fontSize: '0.85rem', fontWeight: 600, background: msg.type === 'ok' ? 'rgba(22,163,74,0.1)' : 'rgba(220,38,38,0.1)', color: msg.type === 'ok' ? '#15803d' : '#dc2626', border: `1px solid ${msg.type === 'ok' ? 'rgba(22,163,74,0.3)' : 'rgba(220,38,38,0.3)'}` }}>
              {msg.text}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 22, paddingTop: 16, borderTop: '1px solid var(--border-color)' }}>
          <button className="btn btn-secondary" onClick={onClose} style={{ flex: 1 }}>Cancelar</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving} style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
            {saving && <Loader2 size={14} className="loader-spinner" />} Guardar cambios
          </button>
        </div>
      </div>
    </div>
  );
};

import NuevoProyecto from './pages/NuevoProyecto';
import Borradores from './pages/Borradores';
import BandejaEntrada from './pages/BandejaEntrada';
import Proveedores from './pages/Proveedores';
import Ajustes from './pages/Ajustes';
import Portal from './pages/Portal';
import PresupuestoCliente from './pages/PresupuestoCliente';
import Comparativa from './pages/Comparativa';
import JefesObra from './pages/JefesObra';
import Proyectos from './pages/Proyectos';
import BasePrecios from './pages/BasePrecios';
import Historial from './pages/Historial';
import PresupuestosFirmados from './pages/PresupuestosFirmados';
import Dashboard from './pages/Dashboard';
import Clientes from './pages/Clientes';
import Login from './pages/Login';
import Usuarios from './pages/Usuarios';

import logoAdir from './assets/adirblanco-header.webp';

const NavBadge = ({ count }) => {
  if (!count || count === 0) return null;
  return (
    <span style={{
      marginLeft: 'auto',
      backgroundColor: '#ef4444',
      color: 'white',
      fontSize: '0.65rem',
      fontWeight: 800,
      minWidth: '18px',
      height: '18px',
      borderRadius: '9px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '0 5px',
      lineHeight: 1,
      boxShadow: '0 2px 6px rgba(239,68,68,0.5)',
      animation: 'pulseBadge 2s ease-in-out infinite'
    }}>
      {count > 99 ? '99+' : count}
    </span>
  );
};

const Sidebar = ({ counts = {}, user, onOpenPerfil }) => {
  const { logout } = useAuth();
  return (
    <div className="sidebar">
      <div className="sidebar-header animate-fade-in">
        <img src={logoAdir} alt="ADIR Logo" className="sidebar-logo" />
      </div>
      <div className="sidebar-nav">
        <NavLink to="/dashboard" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>
          <LayoutDashboard size={20} />Panel de Control
        </NavLink>
        <NavLink to="/nuevo" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>
          <FileUp size={20} />Procesar BC3
        </NavLink>
        <NavLink to="/borradores" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>
          <Files size={20} />Borradores en Curso<NavBadge count={counts.borradores} />
        </NavLink>
        <NavLink to="/bandeja" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>
          <Mailbox size={20} />Buzón Entrada<NavBadge count={counts.bandeja} />
        </NavLink>
        {(user?.tipo_usuario === 1 || user?.tipo_usuario === 3) && (
          <NavLink to="/jefes-obra" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>
            <HardHat size={20} />Jefes de Obra<NavBadge count={counts.jefes} />
          </NavLink>
        )}
        <NavLink to="/proyectos" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>
          <Files size={20} />Obras y Proyectos
        </NavLink>
        <NavLink to="/clientes" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>
          <Building2 size={20} />Clientes
        </NavLink>
        <NavLink to="/proveedores" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>
          <Users size={20} />Proveedores
        </NavLink>
        <NavLink to="/comparativa" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>
          <BarChart2 size={20} />Comparativa
        </NavLink>
        <NavLink to="/presupuestos-firmados" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>
          <FileSignature size={20} />Presupuestos Firmados
        </NavLink>
        <NavLink to="/base-precios" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>
          <Database size={20} />Base Precios
        </NavLink>
        <NavLink to="/historial" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>
          <History size={20} />Historial
        </NavLink>
        {(user?.tipo_usuario === 1 || user?.tipo_usuario === 2) && (
          <NavLink to="/usuarios" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>
            <Users size={20} />Usuarios
          </NavLink>
        )}
        <NavLink to="/ajustes" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>
          <Settings size={20} />Ajustes
        </NavLink>
      </div>
      <div className="sidebar-footer">
        <button onClick={onOpenPerfil} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', marginBottom: 8, background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, cursor: 'pointer', color: '#c8d8e8', fontSize: '12px', fontWeight: 600, textAlign: 'left' }}>
          <UserCog size={14} style={{ flexShrink: 0 }} />
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.nombre} {user?.apellido}</span>
        </button>
        <button onClick={logout} style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          padding: '10px 12px',
          background: '#002D54',
          color: 'white',
          border: 'none',
          borderRadius: 6,
          cursor: 'pointer',
          fontSize: '13px',
          fontWeight: 600
        }}>
          <LogOut size={18} />
          Cerrar Sesión
        </button>
      </div>
    </div>
  );
};

const AppContent = () => {
  const { user, loading } = useAuth();
  const location = useLocation();
  const [sessionCache, setSessionCache] = React.useState({});
  const [sidebarCounts, setSidebarCounts] = useState({ borradores: 0, bandeja: 0, jefes: 0 });
  const [showPerfil, setShowPerfil] = useState(false);
  const [currentUser, setCurrentUser] = React.useState(null);

  // Mantener una copia local del usuario para reflejar cambios de nombre en sidebar
  React.useEffect(() => { setCurrentUser(user); }, [user]);

  const isPortalPath = location.pathname.startsWith('/portal') || location.pathname.startsWith('/presupuesto-cliente');
  const isUsuariosPath = location.pathname.startsWith('/usuarios');

  const fetchCounts = React.useCallback(async () => {
    try {
      const [r1, r2, r3] = await Promise.all([
        supabase.from('propuestas').select('*', { count: 'exact', head: true }).eq('estado', 'Borrador'),
        supabase.from('propuestas').select('*', { count: 'exact', head: true }).eq('estado', 'Pendiente'),
        supabase.from('propuestas').select('*', { count: 'exact', head: true }).eq('estado', 'En Revisión'),
      ]);
      setSidebarCounts({ borradores: r1.count || 0, bandeja: r2.count || 0, jefes: r3.count || 0 });
    } catch (e) { console.warn('Error fetching sidebar counts:', e); }
  }, []);

  useEffect(() => {
    if (user) {
      fetchCounts();
      const interval = setInterval(fetchCounts, 30000);
      return () => clearInterval(interval);
    }
  }, [fetchCounts, user]);

  // Nota: la notificación en vivo de firmas dependía de supabase realtime, que
  // el backend MySQL no soporta (el shim deja channel().subscribe() como no-op).
  // Se retiró el código muerto; reimplementar sobre polling/webhook si se desea.

  if (loading) {
    return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}>Cargando...</div>;
  }

  // Portal routes (sin autenticación requerida)
  if (isPortalPath) {
    return (
      <Routes>
        <Route path="/portal" element={<Portal />} />
        <Route path="/presupuesto-cliente" element={<PresupuestoCliente />} />
      </Routes>
    );
  }

  // Si no hay usuario autenticado, mostrar login
  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  // Usuarios solo para admin/administración
  if (isUsuariosPath && user.tipo_usuario !== 1 && user.tipo_usuario !== 2) {
    return <Navigate to="/dashboard" replace />;
  }

  // Jefes de obra: Jefe de Obra (3) y Administrador (1)
  if (location.pathname.startsWith('/jefes-obra') && user.tipo_usuario !== 3 && user.tipo_usuario !== 1) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="app-container">
      <Sidebar counts={sidebarCounts} user={currentUser || user} onOpenPerfil={() => setShowPerfil(true)} />
      <main className="main-content">
      {showPerfil && currentUser && (
        <PerfilModal
          user={currentUser}
          onClose={() => setShowPerfil(false)}
          onSaved={(updated) => {
            setCurrentUser(updated);
            const stored = localStorage.getItem('adir_user');
            if (stored) {
              try { localStorage.setItem('adir_user', JSON.stringify({ ...JSON.parse(stored), nombre: updated.nombre, apellido: updated.apellido })); } catch (_) {}
            }
          }}
        />
      )}
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/nuevo" element={<NuevoProyecto />} />
          <Route path="/borradores" element={<Borradores sessionCache={sessionCache} setSessionCache={setSessionCache} />} />
          <Route path="/bandeja" element={<BandejaEntrada />} />
          {(user.tipo_usuario === 1 || user.tipo_usuario === 3) && <Route path="/jefes-obra" element={<JefesObra />} />}
          <Route path="/proyectos" element={<Proyectos />} />
          <Route path="/clientes" element={<Clientes />} />
          <Route path="/proveedores" element={<Proveedores />} />
          <Route path="/comparativa" element={<Comparativa sessionCache={sessionCache} setSessionCache={setSessionCache} />} />
          <Route path="/base-precios" element={<BasePrecios />} />
          <Route path="/historial" element={<Historial />} />
          <Route path="/presupuestos-firmados" element={<PresupuestosFirmados />} />
          {(user.tipo_usuario === 1 || user.tipo_usuario === 2) && <Route path="/usuarios" element={<Usuarios />} />}
          <Route path="/ajustes" element={<Ajustes />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </main>
    </div>
  );
};

function App() {
  return (
    <AuthProvider>
      <Router>
        <AppContent />
      </Router>
    </AuthProvider>
  );
}

export default App;
