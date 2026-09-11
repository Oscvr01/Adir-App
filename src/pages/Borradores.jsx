import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { N8N_BASE_URL } from '../config';
import { supabase } from '../utils/supabaseClient';
import { useModal, useToast } from '../utils/useModal';
import { Loader2, Bot, ArrowLeft, ArrowRight, Hash, Save, Trash2, Send, RefreshCw, Mail, Search, FileDown, ClipboardCheck, Folder, Calendar, User, Users, CheckSquare, Square, Check, X, Trophy, Paperclip, HardHat, Files, AlertTriangle, Clock, Timer } from 'lucide-react';

// ── Calcula días restantes sobre el plazo de 15 días ─────────────────────────
const getDeadlineInfo = (fechaRef, dias = 15) => {
    if (!fechaRef) return null;
    const ref = new Date(String(fechaRef).replace(' ', 'T').split('T')[0]);
    const hoy = new Date(); hoy.setHours(0,0,0,0);
    const msDay = 86400000;
    const transcurridos = Math.round((hoy - ref) / msDay);
    const restantes = dias - transcurridos;
    let urgency = 'ok';
    if (restantes <= 0) urgency = 'overdue';
    else if (restantes <= 3) urgency = 'danger';
    else if (restantes <= 7) urgency = 'warning';
    return { transcurridos, restantes, urgency, pct: Math.min(100, Math.round((transcurridos / dias) * 100)) };
};

const URGENCY_COLOR = { ok: '#16a34a', warning: '#d97706', danger: '#dc2626', overdue: '#7f1d1d' };
const URGENCY_BG    = { ok: 'rgba(22,163,74,0.08)', warning: 'rgba(245,158,11,0.08)', danger: 'rgba(220,38,38,0.08)', overdue: 'rgba(127,29,29,0.1)' };

// ── Badge de plazo reutilizable ───────────────────────────────────────────────
const DeadlineBadge = ({ fechaRef, compact = false }) => {
    const d = getDeadlineInfo(fechaRef);
    if (!d) return null;
    const col = URGENCY_COLOR[d.urgency];
    const label = d.restantes > 0
        ? `${d.restantes}d restantes`
        : d.restantes === 0 ? '¡Vence hoy!' : `${Math.abs(d.restantes)}d de retraso`;
    if (compact) {
        return (
            <span style={{ display:'inline-flex', alignItems:'center', gap:4, background: URGENCY_BG[d.urgency], color: col, padding:'2px 8px', borderRadius:12, fontSize:'0.72rem', fontWeight:700, border:`1px solid ${col}40` }}>
                <Timer size={11} /> {label}
            </span>
        );
    }
    return (
        <div style={{ background: URGENCY_BG[d.urgency], border:`1px solid ${col}30`, borderRadius:10, padding:'10px 14px' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
                <span style={{ fontSize:'0.75rem', fontWeight:700, color: col, display:'flex', alignItems:'center', gap:5 }}>
                    <Timer size={13} /> PLAZO 15 DÍAS
                </span>
                <span style={{ fontSize:'0.82rem', fontWeight:800, color: col }}>{label}</span>
            </div>
            <div style={{ height:6, borderRadius:4, background:'rgba(0,0,0,0.08)', overflow:'hidden' }}>
                <div style={{ height:'100%', width:`${d.pct}%`, background: col, borderRadius:4, transition:'width 0.5s' }} />
            </div>
            <div style={{ display:'flex', justifyContent:'space-between', marginTop:4, fontSize:'0.68rem', color:'var(--text-muted)' }}>
                <span>Día {d.transcurridos}</span><span>Día 15</span>
            </div>
        </div>
    );
};
import { asignarProveedoresIA, TODOS_LOS_OFICIOS, getCleanProjectName } from '../utils/aiAllocation';
import { generarPresupuestoPDF, descargarPDF } from '../utils/pdfUtils';
import { escapeHtml, cleanText } from '../utils/escape';
import { formatDecimal, parseDecimal, fmtEuro, aplicarBeneficio } from '../utils/format';
import { normalizarYOrdenarPartidas, getTipoFila, calcularTotalPartidas } from '../utils/partidas';

const Borradores = ({ sessionCache = {}, setSessionCache }) => {
    const { ModalUI } = useModal();
    const { showToast, ToastUI } = useToast();
    const navigate = useNavigate();

    const [proyectos, setProyectos] = useState([]);
    const [loading, setLoading] = useState(true);

    // Vista detallada de proyecto
    const [activeProject, setActiveProject] = useState(null);
    const [partidas, setPartidas] = useState([]);
    const [proveedores, setProveedores] = useState([]);
    const [loadingProject, setLoadingProject] = useState(false);
    const [saving, setSaving] = useState(false);
    const [defaultBeneficioPct, setDefaultBeneficioPct] = useState(0);
    const [savingBeneficio, setSavingBeneficio] = useState(false);

    // % de beneficio por defecto (Ajustes), cargado una vez.
    useEffect(() => {
        supabase.from('configuracion').select('valor').eq('clave', 'beneficio_pct').maybeSingle()
            .then(({ data }) => { if (data?.valor) setDefaultBeneficioPct(parseFloat(data.valor) || 0); });
    }, []);

    // Estado de la IA y Módulos Avanzados
    const [aiLoading, setAiLoading] = useState(false);
    const [aiProgress, setAiProgress] = useState(0);
    const [histLoading, setHistLoading] = useState(false);

    const [selectedOficio, setSelectedOficio] = useState("");
    const [sendingEmails, setSendingEmails] = useState(false);
    const [selectedProviders, setSelectedProviders] = useState({});

    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
    const [projectToDelete, setProjectToDelete] = useState(null);

    const [showReviewModal, setShowReviewModal] = useState(false);
    const [jefeInput, setJefeInput] = useState('');
    const [jefesObra, setJefesObra] = useState([]);
    
    // Estados para edición de metadatos del proyecto
    const [showEditMetadata, setShowEditMetadata] = useState(false);
    const [metadataForm, setMetadataForm] = useState({ cliente: '', cliente_email: '' });

    const [showLicitationModal, setShowLicitationModal] = useState(false);
    const [solicitudesActivas, setSolicitudesActivas] = useState([]);
    const [rawInputs, setRawInputs] = useState({});
    const [anexoFile, setAnexoFile] = useState(null);
    const [anexoFileName, setAnexoFileName] = useState('');
    const [uploadingAnexo, setUploadingAnexo] = useState(false);

    // Formatea "YYYY-MM-DD HH:MM:SS" → "DD/MM/YYYY HH:MM"
    const formatFechaHora = (val) => {
        if (!val) return '';
        const d = new Date(String(val).replace(' ', 'T'));
        if (isNaN(d.getTime())) return String(val);
        return d.toLocaleString('es-ES', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
    };


    // Sincronizar cambios locales con la memoria de sesión global
    useEffect(() => {
        if (activeProject && setSessionCache) {
            setSessionCache(prev => ({
                ...prev,
                [activeProject.Proyecto]: {
                    partidas: partidas,
                    hasUnsavedChanges: hasUnsavedChanges
                }
            }));
        }
    }, [partidas, hasUnsavedChanges, activeProject, setSessionCache]);



    // Aviso al usuario si intenta salir con cambios sin guardar.
    useEffect(() => {
        if (!hasUnsavedChanges) return;
        const handler = (e) => {
            e.preventDefault();
            // Algunos navegadores ignoran el mensaje y muestran el suyo por defecto.
            e.returnValue = 'Tienes cambios sin guardar. ¿Seguro que quieres salir?';
            return e.returnValue;
        };
        window.addEventListener('beforeunload', handler);
        return () => window.removeEventListener('beforeunload', handler);
    }, [hasUnsavedChanges]);

    const fetchProyectos = React.useCallback(async (force = false) => {
        // Eliminada la guard "no refrescar si ya hay datos": al volver de otra ruta
        // el usuario espera ver datos frescos. El `force` se mantiene por compatibilidad
        // pero ya no es necesario.
        void force;
        setLoading(true);
        try {
            const { data, error } = await supabase.from('propuestas').select('*').eq('estado', 'Borrador');
            if (error) throw error;
            if (data) {
                setProyectos(data);
            }
        } catch (error) {
            console.error("Error fetching project list:", error);
            showToast("Error de conexión con la base de datos.", "error");
        } finally {
            setLoading(false);
        }
    }, [showToast]);

    useEffect(() => {
        fetchProyectos();
    }, [fetchProyectos]);

    // Cargar jefes de obra (tipo_usuario = 3) para el desplegable de revisión
    useEffect(() => {
        (async () => {
            try {
                const { data, error } = await supabase
                    .from('usuarios')
                    .select('id,nombre,apellido,correo,tipo_usuario')
                    .eq('tipo_usuario', 3);
                if (error) throw error;
                setJefesObra(data || []);
            } catch (e) {
                console.warn('No se pudieron cargar los jefes de obra:', e);
            }
        })();
    }, []);

    const confirmDelete = async (project) => {
        setLoading(true);
        try {
            console.log("Iniciando borrado verificado de proyecto:", project.Proyecto);
            
            // 1. Borrar de solicitudes si las hubiera
            await supabase.from('solicitudes').delete().eq('propuesta_id', project.Proyecto);

            // 2. Borrar partidas
            await supabase.from('partidas').delete().eq('propuesta_id', project.Proyecto);

            // 3. Borrar propuesta maestra y VERIFICAR
            const { error, count } = await supabase
                .from('propuestas')
                .delete({ count: 'exact' })
                .eq('Proyecto', project.Proyecto);

            if (error) throw error;
            
            if (count === 0) {
                throw new Error("El servidor no eliminó el registro. Verifica que el proyecto exista.");
            }

            showToast(`Proyecto "${getCleanProjectName(project.Proyecto)}" eliminado correctamente.`);
            fetchProyectos(true);
        } catch (error) {
            console.error("Error de borrado:", error);
            showToast("Error de borrado: " + (error.message || "Desconocido"), 'error');
        } finally {
            setLoading(false);
        }
    };


    const openEditMetadata = () => {
        if (!activeProject) return;
        setMetadataForm({
            cliente: activeProject.cliente || '',
            cliente_email: activeProject.direccion || ''
        });
        setShowEditMetadata(true);
    };

    const saveMetadata = async () => {
        if (!activeProject) return;
        try {
            const { error } = await supabase.from('propuestas')
                .update({
                    cliente: metadataForm.cliente,
                    direccion: metadataForm.cliente_email
                })
                .eq('Proyecto', activeProject.Proyecto);
                
            if (error) throw error;
            
            setActiveProject(prev => ({
                ...prev,
                cliente: metadataForm.cliente,
                direccion: metadataForm.cliente_email
            }));
            
            fetchProyectos(true); 
            setShowEditMetadata(false);
            showToast("Datos del proyecto actualizados", "success");
        } catch (err) {
            console.error(err);
            showToast("Error al guardar cambios del proyecto", "error");
        }
    };

    const openProject = async (project) => {
        setActiveProject(project);
        setLoadingProject(true);
        setSelectedOficio("");
        setSelectedProviders({});
        setSolicitudesActivas([]);
        // Cargar solicitudes a proveedores para este proyecto
        supabase.from('solicitudes').select('id,proveedor_nombre,oficio_solicitado,estado_solicitud,created_at')
            .eq('propuesta_id', project.Proyecto)
            .order('created_at', { ascending: false })
            .then(({ data }) => setSolicitudesActivas(data || []))
            .catch(() => {});

        if (sessionCache[project.Proyecto]) {
            setPartidas(sessionCache[project.Proyecto].partidas);
            setHasUnsavedChanges(sessionCache[project.Proyecto].hasUnsavedChanges || false);
            setLoadingProject(false);
            
            supabase.from('proveedores').select('*').then(({ data: provData }) => {
                if (provData) setProveedores(provData.map(p => ({
                    id: p.id, Nombre: p.nombre_empresa, Oficio: p.oficio_principal,
                    Email: p.email, Telefono: p.telefono
                })));
            });
            return;
        }

        try {
            const [{ data: partidasData }, { data: provData }] = await Promise.all([
                supabase.from('partidas').select('*').eq('propuesta_id', project.Proyecto),
                supabase.from('proveedores').select('*')
            ]);

            if (provData) {
                const formattedProv = provData.map(p => ({
                    id: p.id, Nombre: p.nombre_empresa, Oficio: p.oficio_principal,
                    Email: p.email, Telefono: p.telefono
                }));
                setProveedores(formattedProv);
            }

            if (partidasData) {
                const mappedPartidas = partidasData.map(p => {
                    const capCode = p.texto_partida ? p.texto_partida.split('::')[0] : "";
                    const descClean = cleanText(p.texto_partida);
                    const finalPrice = (p.precio_adjudicado && parseFloat(p.precio_adjudicado) > 0) 
                        ? parseFloat(p.precio_adjudicado) 
                        : (p.precio_base_estimado || 0);

                    const needsQuote = (!finalPrice || finalPrice === 0);

                    return {
                        ...p,
                        Capítulo: capCode,
                        Descripción: descClean,
                        "Oficio Asignado": p.oficio_asignado || "Sin asignar",
                        "Precio Total (€)": finalPrice,
                        Cantidad: p.cantidad || 0,
                        "Precio IA": p.precio_ia || 0,
                        "Unidad IA": p.unidad || "",
                        "Needs Quote": p.force_quote !== undefined ? p.force_quote : needsQuote
                    };
                });
                // Normalización compartida: elimina título raíz, agrupa partidas
                // sueltas bajo "99_EXTRAS" y ordena por código de capítulo.
                // (lógica común con JefesObra → src/utils/partidas.js)
                const sorted = normalizarYOrdenarPartidas(mappedPartidas);

                setPartidas(sorted);
            }
        } catch (error) {
            console.error("Error cargando proyecto", error);
            showToast("Error al obtener los detalles del proyecto.", 'error');
            setActiveProject(null);
        } finally {
            setLoadingProject(false);
            setHasUnsavedChanges(false);
        }
    };

    const saveAssignments = async () => {
        setSaving(true);
        try {
            const updatePromises = partidas
                .filter(p => p.id && !p._synthetic)
                .map(p => {
                    const isAdjudicado = p.estado_adjudicacion === 'Adjudicado';
                    const precioIA = parseFloat(p["Precio IA"]);
                    const updatePayload = {
                        oficio_asignado: p["Oficio Asignado"] === "Sin asignar" ? null : p["Oficio Asignado"],
                        precio_ia: isNaN(precioIA) ? null : precioIA,
                        unidad: p["Unidad IA"] || null,
                        cantidad: parseFloat(p.Cantidad) || 0,
                        force_quote: p["Needs Quote"] ? 1 : 0
                    };
                    // Never overwrite precio_base_estimado for adjudicated partidas
                    // — their real price lives in precio_adjudicado
                    if (!isAdjudicado) {
                        updatePayload.precio_base_estimado = parseFloat(p["Precio Total (€)"]) || 0;
                    }
                    return supabase.from('partidas').update(updatePayload).eq('id', p.id);
                });

            const results = await Promise.all(updatePromises);
            const hasError = results.find(r => r.error);

            if (!hasError) {
                const logsAudit = partidas
                    .filter(p => p.isModified)
                    .map(p => ({
                        origen_cambio: p.origen_modificacion || 'Manual',
                        tipo_entidad: 'Partida',
                        entidad_id: String(p.id),
                        proyecto_referencia: activeProject?.Proyecto || 'Sin Proyecto',
                        campo_modificado: 'Precio / Oficio',
                        valor_anterior: `PVP: ${p.valor_anterior_precio ?? 0}€ | Oficio: ${p.valor_anterior_oficio || 'Sin asignar'}`,
                        valor_nuevo: `PVP: ${p["Precio Total (€)"] || 0}€ | Oficio: ${p["Oficio Asignado"] || 'Sin asignar'}`,
                        detalles: p.Descripción || p.texto_partida || ''
                    }));
                if (logsAudit.length > 0) await supabase.from('historial_cambios').insert(logsAudit);
                showToast(`✅ ${updatePromises.length} partidas guardadas.`);
                setPartidas(prev => prev.map(p => ({ ...p, isModified: false, origen_modificacion: null })));
                setHasUnsavedChanges(false);
                return true;
            } else {
                showToast("Error al guardar partidas: " + hasError.error.message, 'error');
                return false;
            }
        } catch (err) {
            showToast("Error de conexión al guardar cambios.", 'error');
            return false;
        } finally {
            setSaving(false);
        }
    };

    const handleHistoricalAssign = async () => {
        setHistLoading(true);
        try {
            // 1. Buscar en base ADIR por código exacto
            const codigosActuales = partidas
                .map(p => p.texto_partida ? p.texto_partida.split('::')[0].trim() : "")
                .filter(c => c && !c.includes('#'));

            const adirBaseMap = new Map();
            if (codigosActuales.length > 0) {
                const { data: baseData, error: baseError } = await supabase
                    .from('base_precios_adir')
                    .select('codigo, precio_total, unidad')
                    .in('codigo', codigosActuales);
                if (!baseError && baseData) {
                    baseData.forEach(item => adirBaseMap.set(item.codigo, { precio: item.precio_total, unidad: item.unidad }));
                }
            }

            // 2. Buscar en histórico: SOLO partidas de menos de 3 años y priorizando
            //    la más reciente, para no arrastrar precios ni ofertas obsoletos.
            const limite3Anios = new Date();
            limite3Anios.setFullYear(limite3Anios.getFullYear() - 3);
            const fechaLimite = limite3Anios.toISOString().split('T')[0]; // YYYY-MM-DD

            const { data: propData, error: propError } = await supabase
                .from('propuestas')
                .select('Proyecto')
                .neq('Proyecto', activeProject.Proyecto)
                .neq('estado', 'Pendiente');

            const historyMap = new Map();   // clave: texto_partida exacto
            const codeHistMap = new Map();  // clave: código (antes de ::)

            if (!propError && propData && propData.length > 0) {
                const { data: partData, error: partError } = await supabase
                    .from('partidas')
                    .select('texto_partida, precio_adjudicado, precio_base_estimado, unidad, created_at')
                    .in('propuesta_id', propData.map(p => p.Proyecto))
                    .gte('created_at', fechaLimite)                 // < 3 años de antigüedad
                    .order('created_at', { ascending: false });     // más reciente primero

                if (!partError && partData) {
                    // partData viene ordenado por created_at descendente, así que la
                    // PRIMERA coincidencia por clave es la más reciente. El `if (!has)`
                    // conserva esa primera → nos quedamos siempre con el precio más nuevo.
                    partData.forEach(p => {
                        const precio = parseFloat(p.precio_adjudicado) > 0
                            ? parseFloat(p.precio_adjudicado)
                            : (parseFloat(p.precio_base_estimado) > 0 ? parseFloat(p.precio_base_estimado) : 0);
                        if (precio > 0 && p.texto_partida) {
                            // Match exacto por texto_partida completo
                            if (!historyMap.has(p.texto_partida)) {
                                historyMap.set(p.texto_partida, { precio, unidad: p.unidad });
                            }
                            // Match por código (más flexible)
                            const code = p.texto_partida.split('::')[0]?.trim();
                            if (code && !codeHistMap.has(code)) {
                                codeHistMap.set(code, { precio, unidad: p.unidad });
                            }
                        }
                    });
                }
            }

            let aplicadasAdir = 0, aplicadasHist = 0;
            const newPartidas = partidas.map(p => {
                if (p.Capítulo && p.Capítulo.match(/#+$/)) return p;
                const codigo = p.texto_partida ? p.texto_partida.split('::')[0].trim() : "";

                // Prioridad 1: Base ADIR
                const adirMatch = adirBaseMap.get(codigo);
                if (adirMatch && adirMatch.precio > 0) {
                    aplicadasAdir++;
                    return {
                        ...p,
                        "Precio Total (€)": adirMatch.precio,
                        // La unidad NO se toca — la asigna la IA o viene del BC3
                        isModified: true,
                        origen_modificacion: 'Base ADIR'
                    };
                }

                // Prioridad 2: Histórico exacto
                const histExact = historyMap.get(p.texto_partida);
                if (histExact && histExact.precio > 0) {
                    aplicadasHist++;
                    return {
                        ...p,
                        "Precio Total (€)": histExact.precio,
                        // La unidad NO se toca — la asigna la IA o viene del BC3
                        isModified: true,
                        origen_modificacion: 'Histórico'
                    };
                }

                // Prioridad 3: Histórico por código
                const histCode = codeHistMap.get(codigo);
                if (histCode && histCode.precio > 0) {
                    aplicadasHist++;
                    return {
                        ...p,
                        "Precio Total (€)": histCode.precio,
                        // La unidad NO se toca — la asigna la IA o viene del BC3
                        isModified: true,
                        origen_modificacion: 'Histórico (código)'
                    };
                }

                return p;
            });

            if (aplicadasAdir > 0 || aplicadasHist > 0) {
                setPartidas(newPartidas);
                setHasUnsavedChanges(true);
                showToast(`✅ Aplicados ${aplicadasAdir} de Base ADIR y ${aplicadasHist} de históricos.`);
            } else {
                showToast('No se encontraron coincidencias en histórico ni base ADIR.', 'warning');
            }
        } catch (error) {
            console.error("Error en búsqueda histórica:", error);
            showToast('Error al buscar precios: ' + error.message, 'error');
        } finally {
            setHistLoading(false);
        }
    };

    const handleAI = async () => {
        setAiLoading(true);
        setAiProgress(5);
        try {
            const resultado = await asignarProveedoresIA(partidas, proveedores, (prog) => { 
                if (prog.progress) setAiProgress(prog.progress);
            });
            let aplicadas = 0;
            const nuevasPartidas = partidas.map(p => {
                if (p.Capítulo && p.Capítulo.endsWith('#')) return p;
                const info = resultado.asignaciones[p.id];
                if (info && info.oficio && info.oficio !== "Sin asignar") {
                    aplicadas++;
                    // Unidad: solo se asigna si el campo está vacío.
                    // info.unidad_por_ia indica que Mistral la ha propuesto (campo vacío previo).
                    const unidadActual = p["Unidad IA"] || "";
                    const unidadFinal = unidadActual || info.unidad || "";
                    const unidadPorIA = !unidadActual && !!info.unidad && !!info.unidad_por_ia;
                    return {
                        ...p,
                        "Oficio Asignado": info.oficio,
                        "Precio IA": info.precio || 0,
                        "Justificacion IA": info.justificacion || "",
                        "Unidad IA": unidadFinal,
                        unidad_asignada_por_ia: unidadPorIA,
                        isModified: true,
                        origen_modificacion: 'IA'
                        // "Precio Total (€)" NO se toca — es el precio real que edita el usuario
                    };
                }
                return p;
            });
            if (aplicadas > 0) {
                setPartidas(nuevasPartidas);
                setHasUnsavedChanges(true);
                showToast(`✅ IA completada: ${aplicadas} partidas.`);
            } else showToast("IA no encontró tareas.", 'warning');
        } catch (err) { showToast("Error en IA: " + err.message, 'error'); }
        finally { setAiLoading(false); setAiProgress(0); }
    };

    const toggleNeedsQuote = (idx) => {
        const copy = [...partidas];
        copy[idx]["Needs Quote"] = !copy[idx]["Needs Quote"];
        setPartidas(copy);
        setHasUnsavedChanges(true);
    };

    const updatePrice = (idx, newVal) => {
        const copy = [...partidas];
        const val = parseFloat(newVal) || 0;
        copy[idx]["Precio Total (€)"] = val;
        copy[idx].isModified = true;
        copy[idx].origen_modificacion = 'Manual';
        setPartidas(copy);
        setHasUnsavedChanges(true);
    };

    const updateUnidad = (idx, newVal) => {
        const copy = [...partidas];
        copy[idx]["Unidad IA"] = newVal;
        copy[idx].unidad_asignada_por_ia = false; // el usuario la edita manualmente → quitar naranja
        copy[idx].isModified = true;
        setPartidas(copy);
        setHasUnsavedChanges(true);
    };

    const updateCantidad = (idx, newVal) => {
        const copy = [...partidas];
        copy[idx].Cantidad = newVal;
        copy[idx].isModified = true;
        setPartidas(copy);
        setHasUnsavedChanges(true);
    };

    const toggleProvider = (provName) => {
        setSelectedProviders(prev => ({
            ...prev,
            [provName]: !prev[provName]
        }));
    };

    const selectAllProvidersOficio = () => {
        const provsOficio = proveedores.filter(p => p.Oficio === selectedOficio);
        const newState = { ...selectedProviders };
        provsOficio.forEach(p => {
            newState[p.Nombre] = true;
        });
        setSelectedProviders(newState);
    };

    const deselectAllProvidersOficio = () => {
        const provsOficio = proveedores.filter(p => p.Oficio === selectedOficio);
        const newState = { ...selectedProviders };
        provsOficio.forEach(p => {
            newState[p.Nombre] = false;
        });
        setSelectedProviders(newState);
    };

    const handleAnexoChange = (e) => {
        const f = e.target.files[0];
        if (f) { setAnexoFile(f); setAnexoFileName(f.name); }
    };

    // Helper: extrae los capítulos/subcapítulos relevantes para el email al proveedor
    // (en el email solo se muestra el resumen por capítulo; el detalle va en el formulario)
    const getCapitulosParaEmail = (tareasOficio, todasPartidas) => {
        const headers = todasPartidas.filter(p => (p.Capítulo || '').endsWith('#'));
        const relevantes = new Set();
        tareasOficio.forEach(t => {
            const code = (t.Capítulo || '').trim();
            headers.forEach(h => {
                const hCode = (h.Capítulo || '').replace(/#$/, '');
                if (hCode && (code === hCode || code.startsWith(hCode + '.'))) {
                    relevantes.add(h.Capítulo);
                }
            });
        });
        return headers
            .filter(h => relevantes.has(h.Capítulo))
            .map(h => {
                const limpio = (h.Capítulo || '').replace(/#$/, '');
                const raw = h.Descripción || h.texto_partida || h.Capítulo || '-';
                const rawClean = (raw.includes('::') ? raw.split('::').slice(1).join('::') : raw).trim();
                const desc = escapeHtml(rawClean);
                return { limpio, desc, isSubcap: limpio.includes('.') };
            });
    };

    // Email al proveedor: solo muestra capítulos/subcapítulos (el formulario tiene el desglose completo)
    const buildSolicitudEmailHTML = (provNombre, oficio, clienteNombre, capitulos, portalUrl, anexoNombre) => {
        // Escape de TODOS los valores dinámicos antes de inyectar en HTML del email,
        // para evitar inyección de markup si nombres/oficios contienen caracteres HTML.
        // capitulos[i].desc ya viene escapado desde getCapitulosParaEmail.
        const provNombreS    = escapeHtml(provNombre);
        const oficioS        = escapeHtml(oficio);
        const clienteNombreS = escapeHtml(clienteNombre);
        const anexoNombreS   = escapeHtml(anexoNombre);
        const portalUrlS     = escapeHtml(portalUrl);

        const filasHtml = capitulos.length > 0
            ? capitulos.map(c => {
                const bgColor    = c.isSubcap ? '#eef4fb' : '#dce7f2';
                const paddingLeft = c.isSubcap ? '28px' : '14px';
                const textColor  = c.isSubcap ? '#2a5a8a' : '#002D54';
                const fontWeight = c.isSubcap ? '600' : '700';
                const border     = c.isSubcap ? 'border-bottom:1px solid #e2e8f0;' : 'border-bottom:2px solid #cbd5e1;';
                return `<tr style="background:${bgColor};${border}"><td style="padding:10px 14px;padding-left:${paddingLeft};font-size:13px;font-weight:${fontWeight};color:${textColor};">${c.desc}</td></tr>`;
              }).join('')
            : `<tr><td style="padding:12px 14px;font-size:13px;color:#64748b;">Partidas de ${oficioS}</td></tr>`;

        return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:Arial,sans-serif;background:#f1f5f9;margin:0;padding:20px 0;">
<div style="max-width:620px;margin:0 auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.10);">
  <div style="background:#002D54;padding:28px 32px;text-align:center;">
    <h1 style="color:white;margin:0;font-size:24px;font-weight:800;letter-spacing:-0.5px;">ADIR Reformas</h1>
    <p style="color:rgba(255,255,255,0.65);margin:6px 0 0;font-size:13px;">Gestión Profesional de Proyectos</p>
  </div>
  <div style="padding:32px;">
    <p style="font-size:15px;color:#334155;margin:0 0 8px;">Estimado/a <strong>${provNombreS}</strong>,</p>
    <p style="font-size:14px;color:#64748b;margin:0 0 24px;line-height:1.6;">
      Le enviamos esta solicitud de presupuesto para el proyecto <strong>${clienteNombreS}</strong> en el área de <strong>${oficioS}</strong>.
      Por favor, acceda al formulario para ver el detalle e introducir sus precios.
    </p>
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
      <thead>
        <tr style="background:#002D54;color:white;">
          <th style="padding:10px 14px;text-align:left;font-size:12px;font-weight:700;">Capítulos de la obra</th>
        </tr>
      </thead>
      <tbody>${filasHtml}</tbody>
    </table>
    ${anexoNombreS ? `<div style="padding:12px 16px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;margin-bottom:20px;">
      <p style="margin:0;font-size:13px;color:#1d4ed8;">📎 <strong>Documentación adjunta por email:</strong> ${anexoNombreS}</p>
    </div>` : ''}
    <div style="text-align:center;margin:28px 0 20px;">
      <a href="${portalUrlS}" style="display:inline-block;padding:16px 36px;background:#002D54;color:white;text-decoration:none;border-radius:10px;font-weight:700;font-size:15px;letter-spacing:0.2px;">
        → Acceder al Formulario de Precios
      </a>
    </div>
    <p style="font-size:11px;color:#94a3b8;text-align:center;margin:0;">
      Si el botón no funciona, copie este enlace en su navegador:<br>
      <a href="${portalUrlS}" style="color:#002D54;word-break:break-all;">${portalUrlS}</a>
    </p>
  </div>
  <div style="background:#f8fafc;padding:16px 32px;border-top:1px solid #e2e8f0;text-align:center;">
    <p style="margin:0;font-size:11px;color:#94a3b8;">ADIR Reformas · Gestión Profesional de Obras y Reformas · adirbc3@gmail.com</p>
  </div>
</div>
</body></html>`;
    };

    const handleRequestQuotes = async () => {
        if (hasUnsavedChanges) {
            const saved = await saveAssignments();
            if (!saved) {
                showToast("No se pudo guardar antes de enviar. Inténtalo de nuevo.", "error");
                return;
            }
        }

        const provs = proveedores.filter(p => p.Oficio === selectedOficio && selectedProviders[p.Nombre]);
        if (provs.length === 0) return showToast("Selecciona proveedores.", "warning");

        const tareasOficio = partidas.filter(p =>
            p["Oficio Asignado"] === selectedOficio && !p.Capítulo?.endsWith('#')
        );

        if (tareasOficio.length === 0) {
            return showToast(`No hay partidas asignadas a los Proveedores "${selectedOficio}".`, "warning");
        }

        setSendingEmails(true);
        let enviados = 0;
        let errores = 0;
        let saltados = 0;

        // Procesar anexo si existe (convertir a Base64 para enviar a n8n)
        let anexo_url = null;
        let anexo_base64 = null;
        let anexo_nombre = null;
        if (anexoFile) {
            setUploadingAnexo(true);
            try {
                anexo_nombre = anexoFile.name;
                anexo_url = anexoFile.name; // Guardamos el nombre en la BD en la columna anexo_url
                anexo_base64 = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.readAsDataURL(anexoFile);
                    reader.onload = () => resolve(reader.result);
                    reader.onerror = error => reject(error);
                });
            } catch (e) {
                console.warn('Error procesando anexo a base64:', e);
                showToast('Aviso: no se pudo procesar el archivo anexo. Se enviará sin adjunto.', 'warning');
            } finally {
                setUploadingAnexo(false);
            }
        }

        try {
            // Deduplication: skip providers with a PENDING (non-responded) solicitud
            // for this same project+oficio. If they already responded, allow re-requesting.
            const { data: existingSols } = await supabase
                .from('solicitudes')
                .select('proveedor_id, estado_solicitud')
                .eq('propuesta_id', activeProject.Proyecto)
                .eq('oficio_solicitado', selectedOficio);

            // Only block re-send if the existing solicitud is still pending (not yet responded)
            const pendingProvIds = new Set(
                (existingSols || [])
                    .filter(s => s.estado_solicitud === 'Pendiente')
                    .map(s => String(s.proveedor_id))
            );

            for (const prov of provs) {
                if (pendingProvIds.has(String(prov.id))) {
                    console.info(`[Licitación] Saltando ${prov.Nombre} - ya tiene solicitud pendiente sin responder.`);
                    saltados++;
                    continue;
                }
                const token = crypto.randomUUID();
                const baseOrigin = window.location.origin + window.location.pathname.replace(/\/$/, '');
                const portalUrl = `${baseOrigin}/#/portal?token=${token}`;
                const tareas = tareasOficio.map(t => ({
                    cap: t.Capítulo,
                    descripcion: t.Descripción || t.texto_partida || '',
                    unidad: t['Unidad IA'] || 'ud',
                    cantidad: parseFloat(t.Cantidad) || 1,
                    precio_estimado: parseFloat(t['Precio Total (€)']) || parseFloat(t.precio_base_estimado) || 0
                }));
                const projName = getCleanProjectName(activeProject.Proyecto);
                const clientName = activeProject.cliente ? ` (Cliente: ${activeProject.cliente})` : '';
                const clienteNombre = `${projName}${clientName}`;
                // Email: solo capítulos/subcapítulos (resumen); el formulario tiene el desglose completo
                const capitulosEmail = getCapitulosParaEmail(tareasOficio, partidas);
                const htmlEmail = buildSolicitudEmailHTML(prov.Nombre, selectedOficio, clienteNombre, capitulosEmail, portalUrl, anexo_nombre);
                const payload = {
                    id: token,  // usar el token como id_bc3 → garantiza id no nulo en DB
                    propuesta_id: activeProject.Proyecto,
                    cliente_nombre: clienteNombre,
                    proveedor_id: String(prov.id),
                    proveedor_nombre: prov.Nombre,
                    proveedor_email: prov.Email,
                    oficio_solicitado: selectedOficio,
                    token,
                    portal_url: portalUrl,
                    anexo_url: anexo_url || '',
                    anexo_base64: anexo_base64 || '',
                    anexo_nombre: anexo_nombre || '',
                    html_email: htmlEmail.replace(/"/g, "'").replace(/\s+/g, ' ').trim(),
                    tareas,
                };

                try {
                    const res = await fetch(
                        `${N8N_BASE_URL}/webhook/fase4-licitacion`,
                        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
                    );
                    if (res.ok) {
                        enviados++;
                    } else {
                        console.warn(`[Licitación] Error HTTP ${res.status} para ${prov.Nombre}`);
                        errores++;
                    }
                } catch (fetchErr) {
                    console.error(`[Licitación] Error de red para ${prov.Nombre}:`, fetchErr);
                    errores++;
                }
            }

            if (enviados > 0) {
                const saltadosMsg = saltados > 0 ? ` (${saltados} omitidos por solicitud previa existente)` : '';
                showToast(`✅ Solicitudes enviadas a ${enviados} proveedor(es).${errores > 0 ? ` (${errores} con error de red)` : ''}${saltadosMsg}`);
            } else if (saltados > 0) {
                showToast(`Todos los proveedores seleccionados ya tienen una solicitud pendiente sin responder. Cuando respondan podrás volver a solicitar.`, "warning");
            } else {
                showToast(`No se pudo conectar con n8n. Verifica que VITE_N8N_BASE_URL esté configurado en Vercel.`, "error");
            }
            setSelectedOficio("");
            setSelectedProviders({});
            setAnexoFile(null);
            setAnexoFileName('');
            // Refrescar solicitudes para reflejar las nuevas
            if (activeProject) {
                supabase.from('solicitudes').select('id,proveedor_nombre,oficio_solicitado,estado_solicitud,created_at')
                    .eq('propuesta_id', activeProject.Proyecto)
                    .order('created_at', { ascending: false })
                    .then(({ data }) => setSolicitudesActivas(data || []))
                    .catch(() => {});
            }
        } catch (err) {
            showToast("Error inesperado: " + err.message, "error");
        } finally {
            setSendingEmails(false);
        }
    };

    const updateOficio = (idx, newOficio) => {
        const copy = [...partidas];
        copy[idx]["Oficio Asignado"] = newOficio;
        copy[idx].isModified = true;
        setPartidas(copy);
        setHasUnsavedChanges(true);
    };

    const handleDownloadPDF = () => {
        try {
            const precioTotal = calcularTotalPartidas(partidas);

            const doc = generarPresupuestoPDF({
                cliente:      activeProject.cliente || '',
                propuesta_id: activeProject.Proyecto,
                descripcion:  getCleanProjectName(activeProject.Proyecto),
                partidas,
                precio_total: precioTotal,
                fecha:        new Date().toISOString(),
                titulo:       'Borrador de Presupuesto',
            });
            const fname = 'Borrador_' + (activeProject.Proyecto || 'presupuesto').replace(/[^a-zA-Z0-9_-]/g, '_');
            descargarPDF(doc, fname);
        } catch (err) {
            console.error('[PDF] ERROR:', err);
            showToast('Error al generar PDF: ' + err.message, 'error');
        }
    };

    const confirmSendToReview = async () => {
        if (!jefeInput.trim()) return showToast("Asigna un Jefe de Obra.", "warning");
        setLoadingProject(true);
        try {
            if (hasUnsavedChanges) await saveAssignments();
            await supabase.from('propuestas').update({ estado: 'En Revisión', jefe_obra: jefeInput.trim() }).eq('Proyecto', activeProject.Proyecto);
            const jefeData = jefesObra.find(j => j.correo === jefeInput.trim());
            if (N8N_BASE_URL && jefeInput.trim()) {
                fetch(`${N8N_BASE_URL}/webhook/notificar-jefe-obra`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        proyectoId: activeProject.Proyecto,
                        proyectoNombre: activeProject.cliente || activeProject.Proyecto,
                        jefeCorreo: jefeInput.trim(),
                        jefeNombre: jefeData ? `${jefeData.nombre} ${jefeData.apellido}` : jefeInput.trim(),
                        tipo: 'revision'
                    })
                }).catch(() => {});
            }
            showToast("Enviado a revisión.", "success");
            setActiveProject(null);
            fetchProyectos(true);
        } catch (err) { showToast("Error al enviar: " + (err.message || err), "error"); }
        finally { setLoadingProject(false); setShowReviewModal(false); }
    };

    const budgetTotal = calcularTotalPartidas(partidas);
    // % de beneficio efectivo del proyecto (override de la propuesta o el de Ajustes).
    const beneficioPct = (activeProject?.beneficio_pct !== null && activeProject?.beneficio_pct !== undefined && activeProject?.beneficio_pct !== '')
        ? parseFloat(activeProject.beneficio_pct)
        : defaultBeneficioPct;

    const guardarBeneficioProyecto = async (nuevoPct) => {
        const pct = nuevoPct === '' ? null : parseFloat(String(nuevoPct).replace(',', '.'));
        if (pct !== null && (isNaN(pct) || pct < 0 || pct > 100)) { showToast('% de beneficio inválido (0–100).', 'error'); return; }
        setSavingBeneficio(true);
        try {
            const { error } = await supabase.from('propuestas').update({ beneficio_pct: pct }).eq('Proyecto', activeProject.Proyecto);
            if (error) throw error;
            setActiveProject(prev => ({ ...prev, beneficio_pct: pct }));
            showToast('% de beneficio del proyecto guardado.');
        } catch (e) { showToast('Error al guardar el %: ' + (e.message || e), 'error'); }
        finally { setSavingBeneficio(false); }
    };
    const listaOficios = ["Sin asignar", ...[...new Set([...TODOS_LOS_OFICIOS, ...proveedores.map(p => p.Oficio)])].sort()];
    const oficiosAsignados = [...new Set((partidas || []).map(p => p["Oficio Asignado"]).filter(o => o !== "Sin asignar"))];

    if (activeProject) {
        return (
            <>
                {ModalUI} {ToastUI}
                <div className="animate-fade-in" style={{ paddingBottom: '40px' }}>
                    <div className="glass-card" style={{ marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
                            <button className="btn btn-secondary" onClick={() => setActiveProject(null)} style={{ padding: '8px', borderRadius: '50%' }}><ArrowLeft size={18} /></button>
                            <div>
                                <h1 style={{ margin: 0, fontSize: '1.4rem', display: 'flex', alignItems: 'center', gap: '10px' }}>
                                    {getCleanProjectName(activeProject.Proyecto)}
                                    <button className="btn btn-secondary btn-sm" onClick={openEditMetadata} style={{ padding: '4px 8px', fontSize: '0.75rem' }}>✏️ Editar Datos</button>
                                </h1>
                                <div style={{ display: 'flex', gap: '15px', marginTop: '4px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                    {activeProject.cliente && <span>👤 <strong>Cliente:</strong> {activeProject.cliente}</span>}
                                    {activeProject.direccion && <span>📧 <strong>Email:</strong> {activeProject.direccion}</span>}
                                </div>
                            </div>
                        </div>
                        <div style={{ display: 'flex', gap: '10px' }}>
                            <button className="btn btn-secondary" onClick={handleDownloadPDF}><FileDown size={16} /> PDF</button>
                            <button className="btn btn-success" onClick={saveAssignments} disabled={saving}><Save size={16} /> Guardar</button>
                            <button className="btn btn-primary" onClick={() => setShowReviewModal(true)}><ClipboardCheck size={16} /> Revisión</button>
                        </div>
                    </div>

                    {/* ── Barra de plazo + solicitudes ── */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, marginBottom: 20 }}>
                        {/* Plazo 15 días */}
                        <div className="glass-card" style={{ padding: '16px 20px' }}>
                            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                                <Clock size={13} /> Plazo de entrega al cliente
                            </div>
                            <DeadlineBadge fechaRef={activeProject.fecha_recepcion || activeProject.created_at} />
                        </div>

                        {/* Solicitudes a proveedores */}
                        <div className="glass-card" style={{ padding: '16px 20px' }}>
                            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                                <Send size={13} /> Solicitudes a proveedores
                            </div>
                            {solicitudesActivas.length === 0 ? (
                                <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-muted)' }}>Sin solicitudes enviadas todavía.</p>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    {solicitudesActivas.map(s => {
                                        const respondida = s.estado_solicitud !== 'Pendiente';
                                        return (
                                            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.82rem' }}>
                                                <span style={{ width: 8, height: 8, borderRadius: '50%', background: respondida ? '#16a34a' : '#d97706', flexShrink: 0 }} />
                                                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                    <strong>{s.proveedor_nombre}</strong>
                                                    <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>({s.oficio_solicitado})</span>
                                                </span>
                                                <span style={{ fontSize: '0.72rem', fontWeight: 700, color: respondida ? '#16a34a' : '#d97706', whiteSpace: 'nowrap' }}>
                                                    {respondida ? '✓ Respondido' : '⏳ Pendiente'}
                                                </span>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px', marginBottom: '20px', alignItems: 'start' }}>
                        <div className="glass-card" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                                <Bot size={22} color="var(--primary)" />
                                <h3 style={{ margin: 0 }}>Inteligencia Artificial</h3>
                            </div>
                            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '20px', flex: 1 }}>
                                Analiza las descripciones de las partidas para asignar automáticamente el oficio más adecuado y estimar precios basados en modelos de lenguaje.
                            </p>
                            <button className="btn btn-primary" onClick={handleAI} disabled={aiLoading} style={{ width: '100%' }}>
                                {aiLoading ? <Loader2 className="loader-spinner" size={18} /> : <Bot size={18} />} 
                                {aiLoading ? 'Procesando...' : 'Auto-asignar con IA'}
                            </button>
                        </div>

                        <div className="glass-card" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                                <Search size={22} color="var(--primary)" />
                                <h3 style={{ margin: 0 }}>Buscador Histórico</h3>
                            </div>
                            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '20px', flex: 1 }}>
                                Cruza los datos de este proyecto con tu base de precios propia y proyectos anteriores para aplicar precios reales ya utilizados.
                            </p>
                            <button className="btn btn-secondary" onClick={handleHistoricalAssign} disabled={histLoading} style={{ width: '100%' }}>
                                {histLoading ? <Loader2 className="loader-spinner" size={18} /> : <RefreshCw size={18} />} 
                                {histLoading ? 'Buscando...' : 'Aplicar Precios Históricos'}
                            </button>
                        </div>

                        <div className="glass-card" style={{ display: 'flex', flexDirection: 'column' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                                <Mail size={22} color="var(--primary)" />
                                <h3 style={{ margin: 0 }}>Licitación de Proveedores</h3>
                            </div>
                            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '20px', flex: 1 }}>
                                Envía solicitudes de presupuesto a tus proveedores de confianza filtrando por Proveedores y seleccionando destinatarios específicos.
                            </p>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                <select 
                                    value={selectedOficio} 
                                    onChange={(e) => {
                                        setSelectedOficio(e.target.value);
                                        setSelectedProviders({}); 
                                    }} 
                                    style={{ width: '100%' }}
                                >
                                    <option value="">Seleccionar Proveedores</option>
                                    {oficiosAsignados.map(o => <option key={o} value={o}>{o}</option>)}
                                </select>

                                <button 
                                    className="btn btn-secondary" 
                                    onClick={() => setShowLicitationModal(true)} 
                                    disabled={!selectedOficio} 
                                    style={{ width: '100%', gap: '8px' }}
                                >
                                    <Users size={16} /> Seleccionar Proveedores
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="glass-card" style={{ 
                        padding: '16px 24px', 
                        marginBottom: '20px', 
                        display: 'flex', 
                        justifyContent: 'flex-end', 
                        alignItems: 'center',
                        gap: '20px',
                        background: 'linear-gradient(90deg, transparent, rgba(0,45,84,0.03))'
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
                            <div style={{ textAlign: 'right' }}>
                                <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Coste</div>
                                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-secondary)' }}>{fmtEuro(budgetTotal)}</div>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                                <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Beneficio</div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                                    <input
                                        key={activeProject?.Proyecto}
                                        type="number" min="0" max="100" step="0.5"
                                        defaultValue={activeProject?.beneficio_pct ?? ''}
                                        placeholder={String(defaultBeneficioPct)}
                                        onBlur={(e) => guardarBeneficioProyecto(e.target.value)}
                                        disabled={savingBeneficio}
                                        title="% de este proyecto (vacío = usa el de Ajustes)"
                                        style={{ width: 64, padding: '5px 6px', textAlign: 'right', border: '1px solid var(--border-color)', borderRadius: 4, fontWeight: 700 }}
                                    />
                                    <span style={{ fontWeight: 700, color: 'var(--text-muted)' }}>%</span>
                                </div>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                                <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>PVP Cliente</div>
                                <div style={{ fontSize: '2rem', fontWeight: 900, color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'flex-end' }}>
                                    {fmtEuro(aplicarBeneficio(budgetTotal, beneficioPct))}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="glass-card">
                        <div className="table-container">
                            <table>
                                <thead>
                                    <tr>
                                        <th style={{ width: '80px' }}>Cap.</th>
                                        <th>Descripción de la Partida</th>
                                        <th style={{ width: '80px', textAlign: 'center' }}>Cant.</th>
                                        <th style={{ width: '60px', textAlign: 'center' }}>Ud.</th>
                                        <th style={{ width: '120px', textAlign: 'right' }}>Precio/ud (€)</th>
                                        <th style={{ width: '120px', textAlign: 'right' }}>Total (€)</th>
                                        <th style={{ width: '110px', textAlign: 'right' }}>Est. IA (€)</th>
                                        <th style={{ width: '190px' }}>Oficio Asignado</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {partidas.map((p, idx) => {
                                        const tipoFila = getTipoFila(p);
                                        const esCapitulo = tipoFila === 'capitulo';
                                        const esSubcapitulo = tipoFila === 'subcapitulo';
                                        const esPartida = tipoFila === 'partida';
                                        const precioIA = parseFloat(p["Precio IA"]) || 0;
                                        const justif = p["Justificacion IA"] || "";

                                        // Estilos integrados y suaves por nivel
                                        // Capítulo: --bg-secondary (azul claro), texto --primary
                                        // Subcapítulo: punto medio — fondo ligeramente coloreado, texto --text-muted más oscuro
                                        // Partida: fondo transparent, texto normal
                                        let rowStyle = { backgroundColor: 'transparent' };
                                        let codStyle = { fontWeight: 500, color: 'var(--text-muted)', paddingLeft: '8px', verticalAlign: 'middle' };
                                        let descStyle = { fontSize: '0.9rem', lineHeight: '1.4', color: 'var(--text-main)', fontWeight: 400, paddingLeft: '8px', verticalAlign: 'middle' };
                                        // Celdas vacías en cap/subcap también necesitan verticalAlign para consistencia
                                        const emptyCell = { verticalAlign: 'middle', textAlign: 'center' };

                                        if (esCapitulo) {
                                            // Nivel superior: El más oscuro de la jerarquía (punto medio entre bg-secondary y primary-light)
                                            rowStyle = { backgroundColor: '#dce7f2', borderTop: '1px solid var(--border-color)', borderBottom: '1px solid var(--border-color)' };
                                            codStyle = { ...codStyle, fontWeight: 800, color: 'var(--primary)', fontSize: '0.92rem', paddingLeft: '10px' };
                                            descStyle = { ...descStyle, fontWeight: 700, color: 'var(--primary)', fontSize: '0.92rem' };
                                        } else if (esSubcapitulo) {
                                            // Nivel medio: Tono más claro (bg-secondary)
                                            rowStyle = { backgroundColor: 'var(--bg-secondary)' };
                                            codStyle = { ...codStyle, fontWeight: 700, color: '#2a5a8a', fontSize: '0.88rem', paddingLeft: '10px' };
                                            descStyle = { ...descStyle, fontWeight: 600, color: '#2a5a8a', fontSize: '0.88rem', paddingLeft: '8px' };
                                        }

                                        return (
                                            <tr key={idx} style={rowStyle}>
                                                <td style={codStyle}>
                                                    {p.Capítulo?.replace(/#$/, '')}
                                                </td>
                                                <td style={descStyle}>
                                                    {p.Descripción}
                                                </td>
                                                <td style={{ ...emptyCell }}>
                                                    {esPartida && <input
                                                        type="text"
                                                        value={rawInputs[`cant_${idx}`] ?? formatDecimal(p.Cantidad)}
                                                        onChange={(e) => setRawInputs(prev => ({ ...prev, [`cant_${idx}`]: e.target.value }))}
                                                        onBlur={(e) => {
                                                            const v = parseDecimal(e.target.value);
                                                            updateCantidad(idx, v);
                                                            setRawInputs(prev => { const n = { ...prev }; delete n[`cant_${idx}`]; return n; });
                                                        }}
                                                        style={{ width: '70px', textAlign: 'center', border: '1px solid var(--border-color)', borderRadius: '4px' }}
                                                    />}
                                                </td>
                                                <td style={{ ...emptyCell }}>
                                                    {esPartida && (
                                                        <input
                                                            type="text"
                                                            value={p['Unidad IA']}
                                                            onChange={(e) => updateUnidad(idx, e.target.value)}
                                                            title={p.unidad_asignada_por_ia ? '🤖 Unidad asignada por IA — edita para confirmar' : ''}
                                                            style={{
                                                                width: '55px',
                                                                textAlign: 'center',
                                                                borderRadius: '4px',
                                                                border: p.unidad_asignada_por_ia
                                                                    ? '1.5px solid #f97316'
                                                                    : '1px solid var(--border-color)',
                                                                background: p.unidad_asignada_por_ia ? '#fff7ed' : undefined,
                                                                color: p.unidad_asignada_por_ia ? '#c2410c' : undefined,
                                                                fontWeight: p.unidad_asignada_por_ia ? '700' : undefined,
                                                            }}
                                                        />
                                                    )}
                                                </td>
                                                <td style={{ textAlign: 'right', verticalAlign: 'middle' }}>
                                                    {esPartida && (
                                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '4px' }}>
                                                            {p.estado_adjudicacion === 'Adjudicado' && <Trophy size={14} color="#059669" title="Precio adjudicado — solo modificable desde Comparativa" />}
                                                            <input
                                                                type="text"
                                                                value={rawInputs[`price_${idx}`] ?? formatDecimal(p['Precio Total (€)'])}
                                                                onChange={(e) => {
                                                                    if (p.estado_adjudicacion === 'Adjudicado') return;
                                                                    setRawInputs(prev => ({ ...prev, [`price_${idx}`]: e.target.value }));
                                                                }}
                                                                onBlur={(e) => {
                                                                    if (p.estado_adjudicacion === 'Adjudicado') return;
                                                                    const v = parseDecimal(e.target.value);
                                                                    updatePrice(idx, v);
                                                                    setRawInputs(prev => { const n = { ...prev }; delete n[`price_${idx}`]; return n; });
                                                                }}
                                                                readOnly={p.estado_adjudicacion === 'Adjudicado'}
                                                                title={p.estado_adjudicacion === 'Adjudicado' ? 'Precio adjudicado — solo modificable desde Comparativa' : ''}
                                                                style={{
                                                                    width: '110px',
                                                                    textAlign: 'right',
                                                                    fontWeight: p.estado_adjudicacion === 'Adjudicado' ? 800 : 700,
                                                                    color: p.estado_adjudicacion === 'Adjudicado' ? '#059669' : 'var(--primary)',
                                                                    background: p.estado_adjudicacion === 'Adjudicado' ? '#d1fae5' : 'transparent',
                                                                    border: p.estado_adjudicacion === 'Adjudicado' ? '1px solid #10b981' : '1px solid var(--border-color)',
                                                                    borderRadius: '4px',
                                                                    padding: '4px',
                                                                    cursor: p.estado_adjudicacion === 'Adjudicado' ? 'not-allowed' : 'text'
                                                                }}
                                                            />
                                                        </div>
                                                    )}
                                                </td>
                                                <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--primary)', whiteSpace: 'nowrap', fontSize: '0.88rem', verticalAlign: 'middle' }}>
                                                    {esPartida && (
                                                        fmtEuro((parseFloat(p['Precio Total (€)']) || 0) * (parseFloat(p.Cantidad) || 1))
                                                    )}
                                                </td>
                                                <td style={{ textAlign: 'right' }}>
                                                    {esPartida && precioIA > 0 && (
                                                        <div title={justif || "Sin justificación"} style={{ cursor: justif ? 'help' : 'default' }}>
                                                            <span style={{ fontSize: '0.88rem', color: esCapitulo ? 'rgba(255,255,255,0.8)' : 'var(--text-muted)', fontStyle: 'italic' }}>
                                                                {precioIA.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                            </span>
                                                            {justif && (
                                                                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', opacity: 0.75, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '120px' }}>
                                                                    {justif}
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                </td>
                                                <td>
                                                    {esPartida && <select value={p["Oficio Asignado"]} onChange={(e) => updateOficio(idx, e.target.value)} style={{ width: '100%' }}>{listaOficios.map(of => <option key={of} value={of}>{of}</option>)}</select>}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                {showReviewModal && (
                    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,45,84,0.6)', backdropFilter: 'blur(6px)', zIndex: 9999, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                        <div style={{ maxWidth: '400px', width: '90%', background: 'white', borderRadius: 20, padding: 32, boxShadow: '0 32px 80px rgba(0,45,84,0.18)', border: '1px solid #c7d5e6' }}>
                            <h3>Asignar Jefe de Obra</h3>
                            {jefesObra.length === 0 ? (
                                <p style={{ color: '#b91c1c', marginBottom: '20px', fontSize: '14px' }}>
                                    No hay jefes de obra registrados. Crea uno en la pestaña Usuarios (tipo "Jefe de Obra").
                                </p>
                            ) : (
                                <select
                                    value={jefeInput}
                                    onChange={(e) => setJefeInput(e.target.value)}
                                    style={{ width: '100%', marginBottom: '20px', padding: '10px' }}
                                >
                                    <option value="">— Selecciona un jefe de obra —</option>
                                    {jefesObra.map((j) => {
                                        const nombre = `${j.nombre || ''} ${j.apellido || ''}`.trim();
                                        return (
                                            <option key={j.id} value={j.correo}>
                                                {nombre} ({j.correo})
                                            </option>
                                        );
                                    })}
                                </select>
                            )}
                            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                                <button className="btn btn-secondary" onClick={() => setShowReviewModal(false)}>Cancelar</button>
                                <button className="btn btn-primary" onClick={confirmSendToReview}>Confirmar</button>
                            </div>
                        </div>
                    </div>
                )}

                {showEditMetadata && (
                    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,45,84,0.6)', backdropFilter: 'blur(6px)', zIndex: 9999, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                        <div style={{ maxWidth: '450px', width: '90%', background: 'white', borderRadius: 20, padding: 32, boxShadow: '0 32px 80px rgba(0,45,84,0.18)', border: '1px solid #c7d5e6' }}>
                            <h3>Editar Datos del Proyecto</h3>
                            <div style={{ marginBottom: '15px' }}>
                                <label style={{ fontWeight: 'bold', fontSize: '0.85rem' }}>Proyecto (de BC3):</label>
                                <input type="text" value={getCleanProjectName(activeProject.Proyecto)} disabled readOnly style={{ width: '100%', backgroundColor: '#f1f5f9', cursor: 'not-allowed', color: '#64748b' }} />
                            </div>
                            <div style={{ marginBottom: '15px' }}>
                                <label style={{ fontWeight: 'bold', fontSize: '0.85rem' }}>Nombre del Cliente:</label>
                                <input type="text" value={metadataForm.cliente} onChange={(e) => setMetadataForm({...metadataForm, cliente: e.target.value})} placeholder="Nombre del cliente..." style={{ width: '100%' }} />
                            </div>
                            <div style={{ marginBottom: '15px' }}>
                                <label style={{ fontWeight: 'bold', fontSize: '0.85rem' }}>Email:</label>
                                <input type="email" value={metadataForm.cliente_email} onChange={(e) => setMetadataForm({...metadataForm, cliente_email: e.target.value})} placeholder="correo@cliente.com" style={{ width: '100%' }} />
                            </div>
                            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                                <button className="btn btn-secondary" onClick={() => setShowEditMetadata(false)}>Cancelar</button>
                                <button className="btn btn-primary" onClick={saveMetadata}>Guardar</button>
                            </div>
                        </div>
                    </div>
                )}

                {showLicitationModal && (
                    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,45,84,0.6)', backdropFilter: 'blur(6px)', zIndex: 9999, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: 20 }}>
                        <div style={{ maxWidth: 520, width: '100%', background: 'white', borderRadius: 20, padding: 32, boxShadow: '0 32px 80px rgba(0,45,84,0.18)', border: '1px solid #c7d5e6', animation: 'fadeIn 0.2s ease' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                                <div>
                                    <h3 style={{ margin: 0, color: '#002D54' }}>Solicitar Presupuesto</h3>
                                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Oficio: <strong>{selectedOficio}</strong></span>
                                </div>
                                <button onClick={() => { setShowLicitationModal(false); setAnexoFile(null); setAnexoFileName(''); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-light)', padding: 4 }}><X size={22} /></button>
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Proveedores disponibles</span>
                                <div style={{ display: 'flex', gap: 12 }}>
                                    <button onClick={selectAllProvidersOficio} style={{ fontSize: '0.75rem', color: 'var(--primary)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Todos</button>
                                    <button onClick={deselectAllProvidersOficio} style={{ fontSize: '0.75rem', color: 'var(--text-light)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Ninguno</button>
                                </div>
                            </div>

                            <div style={{ maxHeight: 240, overflowY: 'auto', marginBottom: 20, border: '1px solid var(--border-color)', borderRadius: 10, background: '#f8fafc' }}>
                                {proveedores.filter(p => p.Oficio === selectedOficio).length > 0 ? (
                                    proveedores.filter(p => p.Oficio === selectedOficio).map(p => (
                                        <div key={p.id} onClick={() => toggleProvider(p.Nombre)} style={{ padding: '12px 16px', borderBottom: '1px solid #e5edf7', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, background: selectedProviders[p.Nombre] ? '#e5edf7' : 'transparent', transition: 'background 0.15s' }}>
                                            {selectedProviders[p.Nombre] ? <CheckSquare size={18} color="var(--primary)" /> : <Square size={18} color="#c7d5e6" />}
                                            <span style={{ fontSize: '0.95rem', fontWeight: selectedProviders[p.Nombre] ? 600 : 400 }}>{p.Nombre}</span>
                                            {p.Email && <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>{p.Email}</span>}
                                        </div>
                                    ))
                                ) : (
                                    <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-light)' }}>
                                        No hay proveedores registrados para este oficio.
                                    </div>
                                )}
                            </div>

                            {/* Adjuntar Anexo */}
                            <div style={{ marginBottom: 20 }}>
                                <label style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                    Anexo / Documentación (opcional)
                                </label>
                                <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', border: '1.5px dashed var(--border-color)', borderRadius: 10, cursor: 'pointer', background: '#f8fafc', transition: 'all 0.2s' }}>
                                    <Paperclip size={16} color="var(--primary)" />
                                    <span style={{ fontSize: '0.85rem', color: anexoFileName ? '#002D54' : 'var(--text-muted)', fontWeight: anexoFileName ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {anexoFileName || 'Seleccionar PDF, imagen o documento...'}
                                    </span>
                                    <input type="file" style={{ display: 'none' }} onChange={handleAnexoChange} accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.xls,.xlsx" />
                                </label>
                                {anexoFile && (
                                    <button onClick={() => { setAnexoFile(null); setAnexoFileName(''); }} style={{ marginTop: 4, fontSize: '0.75rem', color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                                        × Quitar archivo
                                    </button>
                                )}
                                {anexoFile && (
                                    <p style={{ margin: '4px 0 0', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                                        El proveedor podrá descargarlo desde el formulario de precios.
                                    </p>
                                )}
                            </div>

                            <div style={{ display: 'flex', gap: 12 }}>
                                <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => { setShowLicitationModal(false); setAnexoFile(null); setAnexoFileName(''); }}>Cancelar</button>
                                <button
                                    className="btn btn-primary"
                                    style={{ flex: 2 }}
                                    onClick={async () => { await handleRequestQuotes(); setShowLicitationModal(false); }}
                                    disabled={sendingEmails || uploadingAnexo || Object.values(selectedProviders).filter(Boolean).length === 0}
                                >
                                    {(sendingEmails || uploadingAnexo) ? <Loader2 className="loader-spinner" size={16} /> : <Send size={16} />}
                                    {uploadingAnexo ? 'Subiendo anexo...' : sendingEmails ? 'Enviando...' : `Enviar a ${Object.values(selectedProviders).filter(Boolean).length} seleccionados`}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </>
        );
    }

    return (
        <div className="animate-fade-in">
            {ModalUI} {ToastUI}
            <div className="glass-card" style={{ marginBottom: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                        <div>
                            <h1 style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: 0 }}><Files size={32} color="var(--primary)" /> Borradores</h1>
                            <p style={{ margin: '2px 0 0', color: 'var(--text-muted)', fontSize: '0.9rem' }}>Gestiona tus licitaciones y presupuestos en curso.</p>
                        </div>
                    </div>
                    <button className="btn btn-secondary" onClick={() => fetchProyectos(true)} style={{ padding: '10px' }}><RefreshCw size={18} /></button>
                </div>
            </div>

            {loading ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '15px', padding: '100px 0' }}>
                    <Loader2 className="loader-spinner" style={{ width: '40px', height: '40px' }} />
                    <p style={{ color: 'var(--text-muted)' }}>Cargando tus proyectos...</p>
                </div>
            ) : proyectos.length > 0 ? (
                <div className="project-grid">
                    {proyectos.map((pro, idx) => (
                        <div key={idx} className="project-card animate-fade-in">
                            <div className="project-card-header">
                                <div className="project-card-info">
                                    <h3 className="project-card-title">{getCleanProjectName(pro.Proyecto)}</h3>
                                    <div className="info-item" style={{ fontWeight: 600, color: 'var(--text-main)' }}>
                                        <User size={14} /> <span>Cliente: {pro.cliente || "No asignado"}</span>
                                    </div>
                                    <div className="info-item">
                                        <Mail size={14} /> <span>Email: {pro.direccion || "Sin email"}</span>
                                    </div>
                                    <div className="info-item">
                                        <Hash size={14} /> <span>ID: {pro.Proyecto}</span>
                                    </div>
                                    <div className="info-item">
                                        <Calendar size={14} /> <span>Creado: {formatFechaHora(pro.created_at) || pro.fecha_recepcion || "Fecha no disponible"}</span>
                                    </div>
                                    <div className="info-item" style={{ marginTop: 6 }}>
                                        <DeadlineBadge fechaRef={pro.fecha_recepcion || pro.created_at} compact />
                                    </div>
                                </div>
                                <div className="badge badge-blue">Borrador</div>
                            </div>
                            
                            <div className="project-card-actions">
                                <button className="btn btn-primary" onClick={() => openProject(pro)} style={{ flex: 1, gap: '6px' }}>
                                    Abrir Proyecto <ArrowRight size={14} />
                                </button>
                                <button className="btn btn-secondary" onClick={() => setProjectToDelete(pro)} style={{ color: 'var(--danger)', padding: '10px' }}>
                                    <Trash2 size={18} />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="glass-card" style={{ textAlign: 'center', padding: '60px 20px', marginTop: '24px' }}>
                    <Folder size={48} color="var(--border-color)" style={{ marginBottom: '16px' }} />
                    <h3>No hay borradores</h3>
                    <p>Todos tus proyectos han sido procesados o aún no has subido ninguno.</p>
                    <button className="btn btn-primary mt-4" onClick={() => navigate('/nuevo')}>Empezar nuevo proyecto</button>
                </div>
            )}

            {projectToDelete && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,45,84,0.6)', backdropFilter: 'blur(6px)', zIndex: 9999, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                    <div style={{ maxWidth: '400px', width: '90%', textAlign: 'center', background: 'white', borderRadius: 20, padding: 32, boxShadow: '0 32px 80px rgba(0,45,84,0.18)', border: '1px solid #c7d5e6' }}>
                        <div style={{ background: 'rgba(220, 38, 38, 0.1)', width: '60px', height: '60px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
                            <Trash2 size={30} color="var(--danger)" />
                        </div>
                        <h2 style={{ fontSize: '1.5rem', marginBottom: '10px' }}>¿Eliminar Borrador?</h2>
                        <p style={{ marginBottom: '25px' }}>
                            Esta acción no se puede deshacer. Se borrará permanentemente el proyecto <strong>{getCleanProjectName(projectToDelete.Proyecto)}</strong>
                            {projectToDelete.cliente ? ` (Cliente: ${projectToDelete.cliente})` : ''} y todas sus partidas.
                        </p>
                        <div style={{ display: 'flex', gap: '12px' }}>
                            <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setProjectToDelete(null)}>Cancelar</button>
                            <button className="btn btn-primary" style={{ flex: 1, backgroundColor: 'var(--danger)' }} onClick={() => { confirmDelete(projectToDelete); setProjectToDelete(null); }}>Eliminar Ahora</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Borradores;
