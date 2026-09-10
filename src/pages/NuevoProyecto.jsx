import React, { useState, useEffect } from 'react';
import { UploadCloud, CheckCircle, Loader2, FileText, Hash, Euro, Layers, ArrowRight, Building2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../utils/supabaseClient';
import { parseBC3 } from '../utils/bc3Parser';
import { getTipoFila, calcularTotalPartidas } from '../utils/partidas';
import { useToast } from '../utils/useModal';

const NuevoProyecto = () => {
    const [file, setFile] = useState(null);
    const [loading, setLoading] = useState(false);
    const [previewing, setPreviewing] = useState(false);
    const [preview, setPreview] = useState(null);
    const [success, setSuccess] = useState(false);
    const { showToast, ToastUI } = useToast();
    const navigate = useNavigate();

    // ── Cliente ──────────────────────────────────────────────────────────────
    const [clientes, setClientes] = useState([]);
    const [clienteId, setClienteId] = useState('');        // id del cliente existente, o 'nuevo'
    const [nuevoCliente, setNuevoCliente] = useState({ nombre: '', email: '' });

    useEffect(() => {
        (async () => {
            try {
                const { data, error } = await supabase
                    .from('clientes')
                    .select('id,nombre,email')
                    .order('nombre', { ascending: true });
                if (error) throw error;
                setClientes(data || []);
            } catch (e) {
                console.warn('No se pudieron cargar los clientes:', e);
            }
        })();
    }, []);

    const handleDrop = (e) => {
        e.preventDefault();
        const droppedFile = e.dataTransfer.files[0];
        if (droppedFile && droppedFile.name.toLowerCase().endsWith('.bc3')) {
            setFile(droppedFile);
            setPreview(null);
            setSuccess(false);
            generatePreview(droppedFile);
        } else {
            showToast("Por favor, suelta un archivo .bc3 válido.", "error");
        }
    };

    const handleFileChange = (e) => {
        const selectedFile = e.target.files[0];
        if (selectedFile && selectedFile.name.toLowerCase().endsWith('.bc3')) {
            setFile(selectedFile);
            setPreview(null);
            setSuccess(false);
            generatePreview(selectedFile);
        }
    };

    const generatePreview = (f) => {
        setPreviewing(true);
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const text = e.target.result;
                const allItems = parseBC3(text);

                // Clasificación unificada con Borradores (getTipoFila por marca '#'),
                // para que el conteo y el total coincidan exactamente con el borrador.
                const soloPartidas = allItems.filter(p => getTipoFila(p) === 'partida');
                // Capítulos raíz, excluyendo el capítulo sintético de EXTRAS
                // (partidas sueltas): no debe contarse en el resumen inicial.
                const soloCapitulos = allItems.filter(
                    p => getTipoFila(p) === 'capitulo' && p.Capítulo.replace(/#$/, '') !== '99_EXTRAS'
                );

                // Total: misma fuente de verdad que Borradores (precio × cantidad de hojas)
                const totalEstimado = calcularTotalPartidas(allItems);

                // Agrupar partidas bajo su capítulo raíz (sea directo o a través de subcapítulo)
                // Recorremos en orden DFS: cuando vemos un 'capitulo' actualizamos currentCap
                // Las partidas debajo (a cualquier profundidad) se acumulan en ese capítulo
                const capMap = {};
                let currentCapCod = null;
                allItems.forEach(p => {
                    if (getTipoFila(p) === 'capitulo') {
                        const cod = p.Capítulo.replace(/#$/, '');
                        currentCapCod = cod;
                        if (!capMap[cod]) capMap[cod] = { nombre: p.Descripción || cod, codigo: cod, count: 0, total: 0 };
                    } else if (getTipoFila(p) === 'partida' && currentCapCod) {
                        const precio = (Number(p['Precio Total (€)']) || 0) * (Number(p.Cantidad) || 1);
                        capMap[currentCapCod].count++;
                        capMap[currentCapCod].total += precio;
                    }
                    // subcapítulos: no hacen nada en la agrupación, sus partidas caen bajo currentCap
                });

                // Ordenar capítulos numéricamente ascendente
                const capitulosOrdenados = Object.values(capMap).sort((a, b) => {
                    const pa = a.codigo.split('.').map(x => parseInt(x) || 0);
                    const pb = b.codigo.split('.').map(x => parseInt(x) || 0);
                    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
                        const va = i < pa.length ? pa[i] : 0;
                        const vb = i < pb.length ? pb[i] : 0;
                        if (va !== vb) return va - vb;
                    }
                    return 0;
                });

                setPreview({
                    partidas: soloPartidas.length,
                    capitulos: capitulosOrdenados.slice(0, 10),
                    totalCapitulos: soloCapitulos.length,
                    totalHierarchy: capitulosOrdenados.length,
                    totalEstimado
                });
            } catch (err) {
                console.error(err);
                showToast("Error al previsualizar el fichero.", "error");
            } finally {
                setPreviewing(false);
            }
        };
        reader.readAsText(f, 'ISO-8859-1');
    };

    const processFile = () => {
        if (!file) return;

        // Validar selección de cliente
        if (!clienteId) {
            showToast('Selecciona un cliente o crea uno nuevo.', 'warning');
            return;
        }
        if (clienteId === 'nuevo' && !nuevoCliente.nombre.trim()) {
            showToast('Indica el nombre del nuevo cliente.', 'warning');
            return;
        }
        if (clienteId === 'nuevo' && !nuevoCliente.email.trim()) {
            showToast('Hace falta añadir un correo electrónico para el cliente.', 'warning');
            return;
        }

        setLoading(true);
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const text = e.target.result;
                const allItems = parseBC3(text);
                const projectName = file.name.replace(/\.bc3$/i, '');

                // ── Resolver cliente (existente o nuevo) ──────────────────────
                let clienteNombre = '';
                let clienteEmail = '';
                if (clienteId === 'nuevo') {
                    clienteNombre = nuevoCliente.nombre.trim();
                    clienteEmail = nuevoCliente.email.trim();
                    const { error: cliError } = await supabase
                        .from('clientes')
                        .insert([{ nombre: clienteNombre, email: clienteEmail }]);
                    if (cliError) throw new Error('Error al crear cliente: ' + (cliError.message || JSON.stringify(cliError)));
                } else {
                    const c = clientes.find((x) => String(x.id) === String(clienteId));
                    clienteNombre = c?.nombre || projectName;
                    clienteEmail = c?.email || '';
                }

                let idUnico = projectName;
                let suffix = 1;
                let collision = true;
                while (collision) {
                    const { data: existing } = await supabase
                        .from('propuestas').select('Proyecto').eq('Proyecto', idUnico).maybeSingle();
                    if (existing) { idUnico = `${projectName}_${suffix}`; suffix++; }
                    else collision = false;
                }
                const { error: propError } = await supabase
                    .from('propuestas')
                    .insert([{ Proyecto: idUnico, cliente: clienteNombre, direccion: clienteEmail, estado: 'Borrador', fecha_recepcion: new Date().toISOString().split('T')[0] }]);
                if (propError) throw new Error(propError.message || JSON.stringify(propError));
                const propuestaId = idUnico;
                await supabase.from('partidas').delete().eq('propuesta_id', propuestaId);

                // Guardar TODOS los items (capítulos, subcapítulos y partidas)
                // Los capítulos/subcapítulos se detectan por el '#' en el código
                const mappedPartidas = allItems.map((p, index) => ({
                    id: `${propuestaId}-${index}-${p['Capítulo'].replace(/[^a-zA-Z0-9._-]/g, '_')}`,
                    propuesta_id: propuestaId,
                    texto_partida: `${p['Capítulo']}::${p['Descripción']}`,
                    oficio_asignado: null,
                    cantidad: Number(p.Cantidad) || 1,
                    unidad: p.Unidad || p.unidad || null,
                    // precio_base_estimado = precio UNITARIO del ~C
                    precio_base_estimado: Number(p['Precio Total (€)']) || 0
                }));
                const { error: partError } = await supabase.from('partidas').insert(mappedPartidas);
                if (partError) {
                    // Rollback: eliminar la propuesta recién creada para no dejarla huérfana
                    await supabase.from('propuestas').delete().eq('Proyecto', propuestaId);
                    throw partError;
                }
                setSuccess(true);
                setFile(null);
                setPreview(null);
                setClienteId('');
                setNuevoCliente({ nombre: '', email: '' });
                // Refrescar lista de clientes por si se creó uno nuevo
                if (clienteId === 'nuevo') {
                    supabase.from('clientes').select('id,nombre,email').order('nombre', { ascending: true })
                        .then(({ data }) => setClientes(data || []));
                }
                showToast("¡Proyecto importado correctamente!");
            } catch (error) {
                console.error(error);
                const errMsg = error.message || error.error || (typeof error === 'object' ? JSON.stringify(error) : String(error));
                showToast("Error procesando fichero: " + errMsg, 'error');
            } finally {
                setLoading(false);
            }
        };
        reader.readAsText(file, 'ISO-8859-1');
    };

    const fmt = (n) => Number(n).toLocaleString('es-ES', { minimumFractionDigits: 2 }) + ' €';

    return (
        <div className="animate-fade-in">
            <div className="glass-card" style={{ marginBottom: '20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    <div>
                        <h1 style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: 0 }}>
                            <UploadCloud size={32} color="var(--primary)" />
                            Procesar Nuevo BC3
                        </h1>
                        <p style={{ margin: '2px 0 0', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                            Carga un archivo .bc3 de Presto para importarlo directamente a Borradores en Curso.
                        </p>
                    </div>
                </div>
            </div>

            {ToastUI}

            {success && (
                <div className="glass-card animate-fade-in" style={{ marginBottom: '24px', borderLeft: '4px solid var(--success)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
                        <div>
                            <h2 style={{ color: 'var(--success)', display: 'flex', alignItems: 'center', gap: '8px', margin: '0 0 6px' }}>
                                <CheckCircle size={22} /> Proyecto Importado con Exito
                            </h2>
                            <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                                Las partidas han sido guardadas. Ya puedes gestionarlo en Borradores en Curso.
                            </p>
                        </div>
                        <button
                            className="btn btn-primary"
                            onClick={() => navigate('/borradores')}
                            style={{ display: 'flex', alignItems: 'center', gap: '8px', whiteSpace: 'nowrap' }}
                        >
                            Ir a Borradores <ArrowRight size={16} />
                        </button>
                    </div>
                </div>
            )}

            <div className="glass-card">
                <div
                    className={`dropzone ${file ? 'active' : ''}`}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={handleDrop}
                    onClick={() => document.getElementById('file-upload').click()}
                    style={{ cursor: 'pointer' }}
                >
                    <UploadCloud className="dropzone-icon" />
                    {file ? (
                        <div>
                            <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center' }}>
                                <FileText size={20} /> {file.name}
                            </h3>
                            <p style={{ marginTop: '8px' }}>{(file.size / 1024).toFixed(2)} KB</p>
                        </div>
                    ) : (
                        <div>
                            <h3>Selecciona tu archivo .bc3</h3>
                            <p>Arrastra y suelta aquí o haz clic para buscar</p>
                        </div>
                    )}
                    <input id="file-upload" type="file" accept=".bc3" style={{ display: 'none' }} onChange={handleFileChange} />
                </div>

                {previewing && (
                    <div style={{ marginTop: '24px', display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--text-muted)' }}>
                        <Loader2 className="loader-spinner" size={18} /> Analizando estructura del BC3...
                    </div>
                )}

                {preview && !previewing && (
                    <div className="animate-fade-in" style={{ marginTop: '24px' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px', marginBottom: '20px' }}>
                            {[
                                { icon: <Layers size={20} color="#6366f1" />, label: 'Capítulos', value: preview.totalCapitulos, bg: 'rgba(99,102,241,0.08)', color: '#6366f1' },
                                { icon: <Hash size={20} color="var(--primary)" />, label: 'Partidas (hojas)', value: preview.partidas, bg: 'rgba(0,45,84,0.08)', color: 'var(--primary)' },
                                { icon: <Euro size={20} color="#059669" />, label: 'Total Estimado', value: fmt(preview.totalEstimado), bg: 'rgba(5,150,105,0.08)', color: '#059669' },
                            ].map((stat, i) => (
                                <div key={i} style={{ background: stat.bg, borderRadius: '12px', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                                    <div style={{ background: 'white', borderRadius: '8px', padding: '8px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
                                        {stat.icon}
                                    </div>
                                    <div>
                                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>{stat.label}</div>
                                        <div style={{ fontWeight: 700, color: stat.color, fontSize: '1rem' }}>{stat.value}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div style={{ background: 'var(--bg-secondary)', borderRadius: '10px', padding: '14px' }}>
                            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '10px' }}>
                                Distribución por capítulos
                            </div>
                            {preview.capitulos.map((cap, i) => (
                                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
                                    <span style={{
                                        background: 'var(--primary)',
                                        color: 'white',
                                        borderRadius: '4px',
                                        padding: '2px 7px',
                                        fontSize: '0.7rem',
                                        fontWeight: 700,
                                        whiteSpace: 'nowrap',
                                        minWidth: '32px',
                                        textAlign: 'center'
                                    }}>
                                        {cap.codigo}
                                    </span>
                                    <span style={{
                                        flex: 1,
                                        fontSize: '0.83rem',
                                        color: 'var(--text-main)',
                                        fontWeight: 500,
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap'
                                    }}>
                                        {cap.nombre}
                                    </span>
                                    <div style={{ width: '72px', height: '4px', background: 'var(--border-color)', borderRadius: '2px', overflow: 'hidden', flexShrink: 0 }}>
                                        <div style={{ height: '100%', width: `${Math.min(100, preview.totalEstimado > 0 ? (cap.total / preview.totalEstimado) * 100 : 0)}%`, background: 'var(--primary)', borderRadius: '2px' }} />
                                    </div>
                                    <span style={{ color: 'var(--text-light)', whiteSpace: 'nowrap', fontSize: '0.77rem', minWidth: '55px', textAlign: 'right' }}>{cap.count} part.</span>
                                    <span style={{ fontWeight: 600, color: 'var(--primary)', whiteSpace: 'nowrap', fontSize: '0.8rem', minWidth: '72px', textAlign: 'right' }}>{fmt(cap.total)}</span>
                                </div>
                            ))}
                            {preview.totalHierarchy > 10 && (
                                <p style={{ margin: '8px 0 0', color: 'var(--text-muted)', fontSize: '0.79rem', textAlign: 'center', fontStyle: 'italic' }}>
                                    + {preview.totalHierarchy - 10} capítulos más…
                                </p>
                            )}
                        </div>
                    </div>
                )}

                {file && !loading && (
                    <div className="animate-fade-in" style={{ marginTop: '24px', background: 'var(--bg-secondary)', borderRadius: '10px', padding: '16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                            <Building2 size={18} color="var(--primary)" />
                            <span style={{ fontWeight: 700, color: 'var(--text-main)', fontSize: '0.9rem' }}>Asignar cliente</span>
                        </div>
                        <select
                            value={clienteId}
                            onChange={(e) => setClienteId(e.target.value)}
                            style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border-color)', borderRadius: 6, fontSize: '0.9rem', marginBottom: clienteId === 'nuevo' ? 12 : 0 }}
                        >
                            <option value="">— Selecciona un cliente —</option>
                            {clientes.map((c) => (
                                <option key={c.id} value={c.id}>{c.nombre}{c.email ? ` (${c.email})` : ''}</option>
                            ))}
                            <option value="nuevo">➕ Nuevo cliente…</option>
                        </select>
                        {clienteId === 'nuevo' && (
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                                <input
                                    type="text"
                                    placeholder="Nombre del cliente"
                                    value={nuevoCliente.nombre}
                                    onChange={(e) => setNuevoCliente({ ...nuevoCliente, nombre: e.target.value })}
                                    style={{ padding: '10px 12px', border: '1px solid var(--border-color)', borderRadius: 6, fontSize: '0.9rem' }}
                                />
                                <input
                                    type="email"
                                    placeholder="Correo electrónico"
                                    value={nuevoCliente.email}
                                    onChange={(e) => setNuevoCliente({ ...nuevoCliente, email: e.target.value })}
                                    style={{ padding: '10px 12px', border: '1px solid var(--border-color)', borderRadius: 6, fontSize: '0.9rem' }}
                                />
                            </div>
                        )}
                    </div>
                )}

                {file && !loading && (
                    <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                        <button className="btn btn-secondary" onClick={() => { setFile(null); setPreview(null); setClienteId(''); setNuevoCliente({ nombre: '', email: '' }); }}>
                            Cancelar
                        </button>
                        <button className="btn btn-primary" onClick={processFile} disabled={previewing}>
                            <UploadCloud size={16} /> Importar a Borradores
                        </button>
                    </div>
                )}

                {loading && (
                    <div style={{ marginTop: '24px', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--primary)' }}>
                        <Loader2 className="loader-spinner" /> <strong>Analizando e importando proyecto...</strong>
                    </div>
                )}
            </div>
        </div>
    );
};

export default NuevoProyecto;
