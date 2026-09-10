import React, { useState, useEffect } from 'react';
import { supabase } from '../utils/supabaseClient';
import { History, Search, Filter, Loader2, ArrowRight, Download, Bot, User, Clock, BookOpen } from 'lucide-react';
import { getCleanProjectName } from '../utils/aiAllocation';

const Historial = () => {
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [propuestasMap, setPropuestasMap] = useState({});

    // Filtros
    const [searchTerm, setSearchTerm] = useState('');
    const [filtroOrigen, setFiltroOrigen] = useState('');
    const [filtroEntidad, setFiltroEntidad] = useState('');

    useEffect(() => { fetchPropuestas(); }, []);
    // Re-fetch al cambiar filtros; fetchHistorial captura los valores actuales.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { fetchHistorial(); }, [filtroOrigen, filtroEntidad]);

    const fetchPropuestas = async () => {
        try {
            const { data } = await supabase.from('propuestas').select('Proyecto, cliente');
            if (data) {
                const map = {};
                data.forEach(p => { if (p.Proyecto) map[p.Proyecto] = p.cliente || null; });
                setPropuestasMap(map);
            }
        } catch (e) { console.warn('No se pudo cargar mapa de propuestas:', e); }
    };

    const formatProyecto = (ref) => {
        if (!ref) return '—';
        return getCleanProjectName(ref) || ref;
    };

    const fetchHistorial = async () => {
        setLoading(true);
        try {
            let query = supabase
                .from('historial_cambios')
                .select('*')
                .order('fecha_cambio', { ascending: false })
                .limit(100); // Mostramos los últimos 100 por rendimiento

            if (filtroOrigen) {
                query = query.eq('origen_cambio', filtroOrigen);
            }
            if (filtroEntidad) {
                query = query.eq('tipo_entidad', filtroEntidad);
            }

            const { data, error } = await query;
            if (error) throw error;
            setLogs(data || []);
        } catch (error) {
            console.error('Error al cargar el historial:', error);
        } finally {
            setLoading(false);
        }
    };

    const logsFiltrados = logs.filter(log => {
        if (!searchTerm) return true;
        const term = searchTerm.toLowerCase();
        return (
            (log.proyecto_referencia && (
                log.proyecto_referencia.toLowerCase().includes(term) ||
                (propuestasMap[log.proyecto_referencia] && propuestasMap[log.proyecto_referencia].toLowerCase().includes(term))
            )) ||
            (log.detalles && log.detalles.toLowerCase().includes(term)) ||
            (log.campo_modificado && log.campo_modificado.toLowerCase().includes(term))
        );
    });

    const formatFecha = (fechaStr) => {
        const fecha = new Date(fechaStr);
        return fecha.toLocaleString('es-ES', { 
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit'
        });
    };

    const getOrigenBadge = (origen) => {
        let bgColor = 'var(--bg-secondary)';
        let color = 'var(--text-primary)';
        
        if (origen === 'IA') { bgColor = 'rgba(168, 85, 247, 0.15)'; color = '#9333ea'; }
        else if (origen === 'Histórico') { bgColor = 'rgba(59, 130, 246, 0.15)'; color = '#2563eb'; }
        else if (origen === 'Manual') { bgColor = 'rgba(245, 158, 11, 0.15)'; color = '#d97706'; }
        else if (origen === 'Aceptación Presupuesto') { bgColor = 'rgba(22, 163, 74, 0.15)'; color = '#16a34a'; }

        return (
            <span style={{ 
                backgroundColor: bgColor, color: color, padding: '4px 8px', 
                borderRadius: '12px', fontSize: '0.75rem', fontWeight: 'bold' 
            }}>
                {origen}
            </span>
        );
    };


    const exportCSV = () => {
        const headers = ['Fecha','Proyecto','Cliente','Origen','Campo','Valor Anterior','Valor Nuevo','Detalles'];
        const rows = logsFiltrados.map(log => [
            formatFecha(log.fecha_cambio),
            log.proyecto_referencia ? formatProyecto(log.proyecto_referencia) : (log.tipo_entidad || ''),
            log.proyecto_referencia ? (propuestasMap[log.proyecto_referencia] || '') : '',
            log.origen_cambio || '',
            log.campo_modificado || '',
            log.valor_anterior || '',
            log.valor_nuevo || '',
            (log.detalles || '').replace(/"/g, '""')
        ]);
        const csv = [headers,...rows].map(r=>r.map(c=>`"${c}"`).join(',')).join('\n');
        const blob = new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8;'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href=url; a.download=`historial_${new Date().toISOString().split('T')[0]}.csv`; a.click();
        URL.revokeObjectURL(url);
    };

    const statsOrigin = logs.reduce((acc,log)=>{
        const k = log.origen_cambio||'Otro'; acc[k]=(acc[k]||0)+1; return acc;
    },{});

    const statsConfig = [
        { key:'IA', label:'IA', icon:<Bot size={18} color="#9333ea"/>, bg:'rgba(147,51,234,0.08)', color:'#9333ea' },
        { key:'Manual', label:'Manual', icon:<User size={18} color="#d97706"/>, bg:'rgba(217,119,6,0.08)', color:'#d97706' },
        { key:'Histórico', label:'Histórico', icon:<BookOpen size={18} color="#002D54"/>, bg:'rgba(0,45,84,0.08)', color:'#002D54' },
        { key:'Aceptación Presupuesto', label:'Aceptación', icon:<Clock size={18} color="#059669"/>, bg:'rgba(5,150,105,0.08)', color:'#059669' },
    ];

    return (
        <div className="animate-fade-in" style={{ paddingBottom: '40px' }}>
            <div className="glass-card" style={{ marginBottom: '20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>                        <div>
                            <h1 style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: 0 }}><History size={32} color="var(--primary)" /> Historial de Cambios</h1>
                            <p style={{ margin: '2px 0 0', color: 'var(--text-muted)', fontSize: '0.9rem' }}>Registro de auditoría de todas las modificaciones de precios y asignaciones.</p>
                        </div>
                    </div>
                    <button className="btn btn-secondary" onClick={exportCSV} disabled={logsFiltrados.length===0} style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                        <Download size={16}/> Exportar CSV
                    </button>
                </div>
            </div>

            {!loading && logs.length > 0 && (
                <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(150px, 1fr))', gap:'12px', marginBottom:'20px' }}>
                    {statsConfig.map(s => (
                        <div key={s.key} onClick={()=>setFiltroOrigen(filtroOrigen===s.key?'':s.key)}
                            style={{ background: filtroOrigen===s.key ? s.bg : 'var(--bg-card)', border: filtroOrigen===s.key ? `2px solid ${s.color}` : '2px solid transparent', borderRadius:'12px', padding:'14px 16px', display:'flex', alignItems:'center', gap:'10px', cursor:'pointer', transition:'all 0.2s', boxShadow:'0 1px 4px rgba(0,0,0,0.06)' }}>
                            <div style={{ background:s.bg, borderRadius:'8px', padding:'8px', flexShrink:0 }}>{s.icon}</div>
                            <div>
                                <div style={{ fontSize:'0.68rem', color:'var(--text-muted)', textTransform:'uppercase', fontWeight:700 }}>{s.label}</div>
                                <div style={{ fontWeight:800, color:s.color, fontSize:'1.2rem' }}>{statsOrigin[s.key]||0}</div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <div className="glass-card" style={{ marginBottom: '20px' }}>
                <div style={{ display: 'flex', gap: '15px', flexWrap: 'wrap', alignItems: 'center' }}>
                    <div style={{ position: 'relative', flex: '2', minWidth: '250px' }}>
                        <Search size={18} style={{ position: 'absolute', top: '12px', left: '12px', color: 'var(--text-light)' }} />
                        <input 
                            type="text" 
                            placeholder="Buscar por proyecto o detalles..." 
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            style={{ width: '100%', paddingLeft: '40px' }}
                        />
                    </div>
                    
                    <div style={{ flex: '1', minWidth: '150px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <Filter size={18} color="var(--text-muted)" />
                        <select 
                            value={filtroOrigen}
                            onChange={(e) => setFiltroOrigen(e.target.value)}
                            style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--border-color)', backgroundColor: 'white' }}
                        >
                            <option value="">Cualquier Origen</option>
                            <option value="Manual">Manual</option>
                            <option value="IA">Inteligencia Artificial</option>
                            <option value="Histórico">Histórico</option>
                            <option value="Aceptación Presupuesto">Aceptación Presupuesto</option>
                        </select>
                    </div>

                    <div style={{ flex: '1', minWidth: '150px' }}>
                        <select 
                            value={filtroEntidad}
                            onChange={(e) => setFiltroEntidad(e.target.value)}
                            style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--border-color)', backgroundColor: 'white' }}
                        >
                            <option value="">Cualquier Entidad</option>
                            <option value="Partida">Partida (Borradores)</option>
                            <option value="Base ADIR">Base ADIR</option>
                            <option value="Base CYPE">Base CYPE</option>
                        </select>
                    </div>
                </div>
            </div>

            <div className="glass-card" style={{ padding: '0' }}>
                <div className="table-container">
                    <table>
                        <thead>
                            <tr>
                                <th>Fecha</th>
                                <th>Proyecto / Entidad</th>
                                <th>Origen</th>
                                <th>Campo</th>
                                <th>Cambio</th>
                                <th>Detalles</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr>
                                    <td colSpan="6" style={{ textAlign: 'center', padding: '30px' }}>
                                        <Loader2 className="loader-spinner" style={{ display: 'inline-block' }} />
                                    </td>
                                </tr>
                            ) : logsFiltrados.length === 0 ? (
                                <tr>
                                    <td colSpan="6" style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)' }}>
                                        No hay registros que coincidan con los filtros.
                                    </td>
                                </tr>
                            ) : (
                                logsFiltrados.map((log) => (
                                    <tr key={log.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                        <td style={{ fontSize: '0.85rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                                            {formatFecha(log.fecha_cambio)}
                                        </td>
                                        <td style={{ fontWeight: 'bold' }}>
                                            {formatProyecto(log.proyecto_referencia) || log.tipo_entidad}
                                            {log.proyecto_referencia && propuestasMap[log.proyecto_referencia] && (
                                                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 'normal' }}>
                                                    Cliente: {propuestasMap[log.proyecto_referencia]}
                                                </div>
                                            )}
                                        </td>
                                        <td>{getOrigenBadge(log.origen_cambio)}</td>
                                        <td style={{ fontSize: '0.85rem' }}>{log.campo_modificado}</td>
                                        <td>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem' }}>
                                                <span style={{ color: 'var(--danger)', textDecoration: 'line-through' }}>
                                                    {log.valor_anterior || '-'}
                                                </span>
                                                <ArrowRight size={14} color="var(--text-muted)" />
                                                <span style={{ color: 'var(--success)', fontWeight: 'bold' }}>
                                                    {log.valor_nuevo || '-'}
                                                </span>
                                            </div>
                                        </td>
                                        <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={log.detalles}>
                                            {log.detalles}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default Historial;
