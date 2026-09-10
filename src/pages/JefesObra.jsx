import React, { useState, useEffect } from 'react';
import { supabase } from '../utils/supabaseClient';
import { N8N_BASE_URL } from '../config';
import { useAuth } from '../context/AuthContext';
import { useModal, useToast, Modal } from '../utils/useModal';
import {
  Loader2, RefreshCw, HardHat, FileText, ArrowLeft, CheckCircle,
  X, AlertCircle, Trophy, User, Calendar, Briefcase, Trash2, MessageSquare
} from 'lucide-react';
import { TODOS_LOS_OFICIOS, getCleanProjectName } from '../utils/aiAllocation';
import { escapeHtml, cleanText } from '../utils/escape';
import { formatDecimal, parseDecimal, fmtEuro, aplicarBeneficio } from '../utils/format';
import { normalizarYOrdenarPartidas, getTipoFila } from '../utils/partidas';

const JefesObra = () => {
    const { user } = useAuth();
    const { showAlert, ModalUI } = useModal();
    const { showToast, ToastUI } = useToast();
    // Popup de comentario por partida: { idx, texto } o null
    const [comentarioModal, setComentarioModal] = useState(null);
    const [guardandoComentario, setGuardandoComentario] = useState(false);

    const esAdmin = user?.tipo_usuario === 1;

    const [proyectos, setProyectos] = useState([]);
    const [loading, setLoading] = useState(true);
    const [jefeSeleccionado, setJefeSeleccionado] = useState('');
    const [jefesDisponibles, setJefesDisponibles] = useState([]);
    const [todosLosJefes, setTodosLosJefes] = useState([]);

    const [activeProject, setActiveProject] = useState(null);
    const [partidas, setPartidas] = useState([]);
    const [respuestasPorPartida, setRespuestasPorPartida] = useState({});
    const [loadingProject, setLoadingProject] = useState(false);
    const [showDenyModal, setShowDenyModal] = useState(false);
    const [showApproveWarning, setShowApproveWarning] = useState(false);
    const [showFormatModal, setShowFormatModal] = useState(false);
    // modoPortal: qué datos se guardan en Supabase para el formulario de firma
    // El correo SIEMPRE muestra solo capítulos y subcapítulos
    const [modoPortal, setModoPortal] = useState('desglose');
    
    const [showEditMetadata, setShowEditMetadata] = useState(false);
    const [metadataForm, setMetadataForm] = useState({ nombre_proyecto: '', cliente: '', cliente_email: '' });
    const [projectToDelete, setProjectToDelete] = useState(null);
    const [deleting, setDeleting] = useState(false);
    const [rawInputs, setRawInputs] = useState({});
    const [oficiosDinamicos, setOficiosDinamicos] = useState(TODOS_LOS_OFICIOS);
    const [defaultBeneficioPct, setDefaultBeneficioPct] = useState(0);
    const [savingBeneficio, setSavingBeneficio] = useState(false);

    // % de beneficio efectivo del proyecto: override de la propuesta o el de Ajustes.
    const beneficioPct = (activeProject?.beneficio_pct !== null && activeProject?.beneficio_pct !== undefined && activeProject?.beneficio_pct !== '')
        ? parseFloat(activeProject.beneficio_pct)
        : defaultBeneficioPct;

    // Cargar el % de beneficio por defecto (Ajustes) una vez al montar.
    useEffect(() => {
        supabase.from('configuracion').select('valor').eq('clave', 'beneficio_pct').maybeSingle()
            .then(({ data }) => { if (data?.valor) setDefaultBeneficioPct(parseFloat(data.valor) || 0); });
    }, []);

    // Guarda el % de beneficio del proyecto (override) en la propuesta.
    const guardarBeneficioProyecto = async (nuevoPct) => {
        const pct = nuevoPct === '' ? null : parseFloat(String(nuevoPct).replace(',', '.'));
        if (pct !== null && (isNaN(pct) || pct < 0 || pct > 100)) {
            showToast('% de beneficio inválido (0–100).', 'error');
            return;
        }
        setSavingBeneficio(true);
        try {
            const { error } = await supabase.from('propuestas').update({ beneficio_pct: pct }).eq('Proyecto', activeProject.Proyecto);
            if (error) throw error;
            setActiveProject(prev => ({ ...prev, beneficio_pct: pct }));
            showToast('% de beneficio del proyecto guardado.');
        } catch (e) {
            showToast('Error al guardar el %: ' + (e.message || e), 'error');
        } finally {
            setSavingBeneficio(false);
        }
    };


    const fetchProyectos = React.useCallback(async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('propuestas')
                .select('*')
                .eq('estado', 'En Revisión');

            if (error) throw error;
            if (data) {
                // Admin ve todos; jefe de obra solo los asignados a su correo
                const filtrados = (user?.tipo_usuario === 1)
                    ? data
                    : (user?.correo ? data.filter(p => p.jefe_obra === user.correo) : data);

                setProyectos(filtrados);
                // jefesDisponibles siempre del total (para el filtro del admin)
                const jefes = [...new Set(data.map(p => p.jefe_obra).filter(Boolean))];
                setJefesDisponibles(jefes);
                // Jefe de obra: auto-selecciona su propio correo
                if (user?.tipo_usuario === 3 && user?.correo) {
                    setJefeSeleccionado(user.correo);
                }
            }
        } catch (error) {
            console.error("Error fetching projects:", error);
            showToast("Error al cargar proyectos en revisión.", "error");
        } finally {
            setLoading(false);
        }
    }, [showToast, user]);

    useEffect(() => {
        fetchProyectos();
    }, [fetchProyectos]);

    // Cargar todos los jefes de obra registrados (para reasignación)
    useEffect(() => {
        const cargarTodosJefes = async () => {
            const { data } = await supabase
                .from('usuarios')
                .select('nombre,apellido,correo')
                .eq('tipo_usuario', 3);
            if (data) setTodosLosJefes(data);
        };
        cargarTodosJefes();
    }, []);


    const openProject = async (project) => {
        setActiveProject(project);
        setLoadingProject(true);
        try {
            // Cargar Oficios de Proveedores
            const { data: provData } = await supabase.from('proveedores').select('oficio_principal');
            if (provData) {
                const customOficios = provData.map(pr => pr.oficio_principal).filter(Boolean);
                const uniqueOficios = [...new Set([...TODOS_LOS_OFICIOS, ...customOficios])].sort();
                setOficiosDinamicos(uniqueOficios);
            }

            // 1. Cargar Partidas
            const { data: pData, error: pError } = await supabase
                .from('partidas')
                .select('*')
                .eq('propuesta_id', project.Proyecto);
            
            if (pError) throw pError;

            // 2. Cargar Respuestas (Precios de proveedores) para este proyecto
            const { data: rData, error: rError } = await supabase
                .from('respuestas')
                .select('*')
                .in('partida_id', (pData || []).map(p => p.id));
            
            if (rError) console.warn("Error cargando respuestas:", rError);

            // 3. Cargar Solicitudes correspondientes a estas respuestas (para obtener proveedor_nombre/proveedor_id)
            let solicitudesData = [];
            if (rData && rData.length > 0) {
                const uniqueSolicitudIds = [...new Set(rData.map(r => r.solicitud_id).filter(Boolean))];
                if (uniqueSolicitudIds.length > 0) {
                    const { data: sData, error: sError } = await supabase
                        .from('solicitudes')
                        .select('id, proveedor_id, proveedor_nombre')
                        .in('id', uniqueSolicitudIds);
                    if (!sError && sData) {
                        solicitudesData = sData;
                    } else if (sError) {
                        console.warn("Error cargando solicitudes para respuestas:", sError);
                    }
                }
            }

            // Organizar respuestas por partida_id
            const solicitudesMap = new Map(solicitudesData.map(s => [s.id, s]));
            const respMap = {};
            (rData || []).forEach(r => {
                const sol = solicitudesMap.get(r.solicitud_id);
                if (!respMap[r.partida_id]) respMap[r.partida_id] = [];
                respMap[r.partida_id].push({
                    ...r,
                    proveedor_nombre: sol?.proveedor_nombre || 'Prov. Desconocido',
                    proveedor_id: sol?.proveedor_id || r.proveedor_id
                });
            });
            setRespuestasPorPartida(respMap);
            
            const mapped = (pData || []).map(p => {
                const capCode = p.texto_partida ? p.texto_partida.split('::')[0] : "";
                const descClean = cleanText(p.texto_partida);
                const finalPrice = (p.precio_adjudicado && parseFloat(p.precio_adjudicado) > 0)
                    ? parseFloat(p.precio_adjudicado)
                    : (p.precio_base_estimado || 0);

                return {
                    ...p,
                    Capítulo: capCode,
                    Descripción: descClean,
                    "Precio Total (€)": finalPrice,
                    "Oficio Asignado": p.oficio_asignado || "Sin asignar",
                    Cantidad: p.cantidad !== undefined ? p.cantidad : 0,
                    "Unidad IA": p.unidad || "",
                    valor_anterior_precio: finalPrice,
                    valor_anterior_oficio_id: p.proveedor_adjudicado_id || null,
                    aprobado: false,
                    isModified: false,
                    solicitud_seleccionada_id: null
                };
            });

            // Normalización compartida: elimina título raíz, agrupa partidas sueltas
            // bajo "99_EXTRAS" y ordena por código. Los campos extra del header de
            // EXTRAS (aprobado/isModified/solicitud_seleccionada_id) son específicos
            // de esta vista. (lógica común → src/utils/partidas.js)
            const sorted = normalizarYOrdenarPartidas(mapped, {
                aprobado: false,
                isModified: false,
                solicitud_seleccionada_id: null,
            });

            setPartidas(sorted);
        } catch (err) {
            console.error(err);
            showAlert('Error cargando detalles del proyecto.', { type: 'error', title: 'Error' });
            setActiveProject(null);
        } finally {
            setLoadingProject(false);
        }
    };

    const openEditMetadata = () => {
        setMetadataForm({
            nombre_proyecto: activeProject.descripcion || getCleanProjectName(activeProject.Proyecto),
            cliente: activeProject.cliente || '',
            cliente_email: activeProject.direccion || ''
        });
        setShowEditMetadata(true);
    };

    const saveMetadata = async () => {
        try {
            // Nota: 'descripcion' no existe aún en propuestas — se guarda solo en estado local
            const { error } = await supabase.from('propuestas')
                .update({
                    cliente: metadataForm.cliente,
                    direccion: metadataForm.cliente_email
                })
                .eq('Proyecto', activeProject.Proyecto);

            if (error) throw error;
            
            setActiveProject(prev => ({
                ...prev,
                descripcion: metadataForm.nombre_proyecto,
                cliente: metadataForm.cliente,
                direccion: metadataForm.cliente_email
            }));
            
            fetchProyectos(); // Refrescar lista de fondo
            setShowEditMetadata(false);
            showToast("Datos del proyecto actualizados", "success");
        } catch (err) {
            console.error(err);
            showToast("Error al guardar cambios del proyecto", "error");
        }
    };

    const denegarProyecto = async () => {
        setLoadingProject(true);
        try {
            const { error } = await supabase
                .from('propuestas')
                .update({ estado: 'Borrador' })
                .eq('Proyecto', activeProject.Proyecto);
                
            if (error) throw error;
            
            setShowDenyModal(false);
            showToast('❌ Proyecto denegado y devuelto a Borradores.', 'warning');
            setActiveProject(null);
            fetchProyectos();
        } catch (err) {
            console.error(err);
            showAlert('Error al denegar proyecto: ' + err.message, { type: 'error', title: 'Error' });
        } finally {
            setLoadingProject(false);
        }
    };

    const eliminarProyecto = async () => {
        if (!projectToDelete) return;
        setDeleting(true);
        try {
            // 1. Solicitudes (y sus respuestas vinculadas)
            await supabase.from('solicitudes').delete().eq('propuesta_id', projectToDelete.Proyecto);
            // 2. Partidas
            await supabase.from('partidas').delete().eq('propuesta_id', projectToDelete.Proyecto);
            // 3. Propuesta
            const { error, count } = await supabase
                .from('propuestas')
                .delete({ count: 'exact' })
                .eq('Proyecto', projectToDelete.Proyecto);
            if (error) throw error;
            if (count === 0) throw new Error('No se pudo borrar (posible restricción RLS).');
            showToast(`Proyecto "${getCleanProjectName(projectToDelete.Proyecto)}" eliminado.`, 'success');
            setProjectToDelete(null);
            fetchProyectos();
        } catch (err) {
            console.error(err);
            showToast('Error al eliminar: ' + err.message, 'error');
        } finally {
            setDeleting(false);
        }
    };

    const updatePrice = (idx, val) => {
        const copy = [...partidas];
        copy[idx]["Precio Total (€)"] = parseFloat(val) || 0;
        copy[idx].isModified = true;
        setPartidas(copy);
    };

    const updateOficio = (idx, val) => {
        const copy = [...partidas];
        copy[idx]["Oficio Asignado"] = val;
        copy[idx].isModified = true;
        setPartidas(copy);
    };

    const updateCantidad = (idx, val) => {
        const copy = [...partidas];
        copy[idx].Cantidad = val;
        copy[idx].isModified = true;
        setPartidas(copy);
    };

    const updateUnidad = (idx, val) => {
        const copy = [...partidas];
        copy[idx]["Unidad IA"] = val;
        copy[idx].isModified = true;
        setPartidas(copy);
    };

    const updateProveedor = (idx, solId) => {
        const copy = [...partidas];
        const partida = copy[idx];
        const resps = respuestasPorPartida[partida.id] || [];
        const selectedResp = resps.find(r => r.solicitud_id === solId);
        
        partida.proveedor_adjudicado_id = selectedResp ? selectedResp.proveedor_id : null;
        partida.solicitud_seleccionada_id = solId;
        partida.isModified = true;
        
        if (selectedResp) {
            partida["Precio Total (€)"] = selectedResp.precio_ofertado;
        }
        setPartidas(copy);
    };

    const toggleAprobado = (idx) => {
        const copy = [...partidas];
        copy[idx].aprobado = !copy[idx].aprobado;
        setPartidas(copy);
    };

    const toggleAllAprobado = () => {
        const partidasReales = partidas.filter(p => !(p.Capítulo && p.Capítulo.endsWith('#')));
        const allApproved = partidasReales.length > 0 && partidasReales.every(p => p.aprobado);
        
        const copy = partidas.map(p => {
            if (!(p.Capítulo && p.Capítulo.endsWith('#'))) {
                return { ...p, aprobado: !allApproved };
            }
            return p;
        });
        setPartidas(copy);
    };

    const handleConfirmarClick = () => {
        if (!activeProject.direccion || activeProject.direccion.trim() === '') {
            showAlert('Por favor, añade un correo electrónico de contacto (Editar Datos) antes de aprobar el proyecto. Este correo es necesario para enviar el presupuesto para firma.', { type: 'warning', title: 'Email Requerido' });
            return;
        }

        const noAprobadas = partidas.filter(p => !p.aprobado && !(p.Capítulo && p.Capítulo.endsWith('#')));
        if (noAprobadas.length > 0) {
            setShowApproveWarning(true);
        } else {
            setShowFormatModal(true);
        }
    };

    // Calcula el total de un capítulo/subcapítulo sumando todas sus partidas descendientes
    const calcularTotalesCapitulos = (todasPartidas) => {
        const totales = {};
        const headers = todasPartidas.filter(p => getTipoFila(p) !== 'partida');
        const items   = todasPartidas.filter(p => getTipoFila(p) === 'partida');

        for (const header of headers) {
            const hCode    = (header.Capítulo || '').replace(/#+$/, '');
            const isExtras = hCode === '99_EXTRAS';
            const hIdx     = todasPartidas.indexOf(header);

            totales[header.Capítulo] = items.reduce((acc, item) => {
                const iIdx  = todasPartidas.indexOf(item);
                const iCode = (item.Capítulo || '').trim();
                const match = isExtras
                    ? iIdx > hIdx
                    : iCode === hCode || iCode.startsWith(hCode + '.');
                if (!match) return acc;
                return acc + (parseFloat(item['Precio Total (€)']) || 0) * (parseFloat(item.Cantidad) || 1);
            }, 0);
        }
        return totales;
    };

    // Sanitiza una partida antes de guardarla en la BD — elimina todos los campos
    // de estado React que no necesita el portal del cliente ni el PDF.
    // El precio del cliente = coste × (1 + beneficio%). El margen se incrusta aquí,
    // al congelar el snapshot que verá el cliente (precio_total_capitulo ya viene
    // con beneficio aplicado desde totalesCapitulos).
    const sanitizarPartidaParaBD = (p) => ({
        Capítulo:            p.Capítulo || '',
        Descripción:         p.Descripción || '',
        Cantidad:            parseFloat(p.Cantidad) || 0,
        'Unidad IA':         p['Unidad IA'] || p.unidad || '',
        precio_adjudicado:   aplicarBeneficio(parseFloat(p['Precio Total (€)']) || 0, beneficioPct),
        precio_total_capitulo: parseFloat(p.precio_total_capitulo) || 0,
        comentario:          p.comentario || '',
    });

    // modoPortal: 'capitulos' | 'desglose' → qué datos se guardan en Supabase para el formulario de firma
    // El correo SIEMPRE renderiza solo capítulos y subcapítulos
    const confirmarProyecto = async (modoPortalParam) => {
        setLoadingProject(true);
        setShowApproveWarning(false);
        setShowFormatModal(false);
        try {
            const updatePromises = partidas.filter(p => p.id && !p._synthetic).map(p => {
                const dataToUpdate = {
                    precio_base_estimado: parseFloat(p["Precio Total (€)"]) || 0,
                    precio_adjudicado: parseFloat(p["Precio Total (€)"]) || 0,
                    oficio_asignado: p["Oficio Asignado"] === "Sin asignar" ? null : p["Oficio Asignado"],
                    cantidad: parseFloat(p.Cantidad) || 0,
                    unidad: p["Unidad IA"] || null,
                    proveedor_adjudicado_id: p.proveedor_adjudicado_id || null,
                    estado_adjudicacion: p.proveedor_adjudicado_id ? 'Adjudicado' : null
                };
                return supabase.from('partidas').update(dataToUpdate).eq('id', p.id);
            });

            const results = await Promise.all(updatePromises);
            const hasError = results.find(r => r.error);
            if (hasError) throw hasError.error;

            // Generar logs de auditoría para los cambios del Jefe de Obra
            const logsAudit = partidas
                .filter(p => p.isModified)
                .map(p => ({
                    origen_cambio: 'Manual (Jefe Obra)',
                    tipo_entidad: 'Partida',
                    entidad_id: String(p.id),
                    proyecto_referencia: activeProject?.Proyecto || 'Sin Proyecto',
                    campo_modificado: 'Revisión Jefe Obra',
                    valor_anterior: `PVP: ${p.valor_anterior_precio ?? 0}€ | ProvID: ${p.valor_anterior_oficio_id || 'N/A'}`,
                    valor_nuevo: `PVP: ${p["Precio Total (€)"] || 0}€ | ProvID: ${p.proveedor_adjudicado_id || 'N/A'}`,
                    detalles: `Jefe de Obra: ${activeProject.jefe_obra} | ${p.Descripción}`
                }));

            if (logsAudit.length > 0) {
                await supabase.from('historial_cambios').insert(logsAudit);
            }

            const solUpdates = [];
            partidas.forEach(p => {
                if (p.solicitud_seleccionada_id) {
                    solUpdates.push(supabase.from('solicitudes').update({ estado_solicitud: 'Adjudicada' }).eq('id', p.solicitud_seleccionada_id));
                }
            });
            if (solUpdates.length > 0) await Promise.all(solUpdates);

            const { error } = await supabase
                .from('propuestas')
                .update({ estado: 'En Curso' })
                .eq('Proyecto', activeProject.Proyecto);

            if (error) throw error;

            // ─── Crear presupuesto para cliente y enviar email ───
            const token = crypto.randomUUID();
            const precioTotalCoste = partidas
                .filter(p => !p.Capítulo?.endsWith('#'))
                .reduce((acc, p) => acc + (parseFloat(p['Precio Total (€)']) || 0) * (parseFloat(p.Cantidad) || 1), 0);
            // El cliente ve el PVP: coste + beneficio incrustado.
            const precioTotal = aplicarBeneficio(precioTotalCoste, beneficioPct);

            // Totales por capítulo con el beneficio ya incrustado (snapshot y email).
            const totalesCoste = calcularTotalesCapitulos(partidas);
            const totalesCapitulos = {};
            for (const k in totalesCoste) totalesCapitulos[k] = aplicarBeneficio(totalesCoste[k], beneficioPct);

            // Enriquecer todos los headers con su total calculado
            const partidasParaCliente = partidas.map(p => {
                const tipoFila = getTipoFila(p);
                if (tipoFila === 'capitulo' || tipoFila === 'subcapitulo') {
                    return { ...p, precio_total_capitulo: totalesCapitulos[p.Capítulo] ?? 0 };
                }
                return p;
            });

            // soloCapitulosPortal: qué se guarda en Supabase para el formulario de firma del cliente
            // soloCapitulosEmail: el correo SIEMPRE muestra solo capítulos y subcapítulos
            const soloCapitulosPortal = modoPortalParam === 'capitulos';
            const soloCapitulosEmail  = true;

            const partidasGuardar = (soloCapitulosPortal
                ? partidasParaCliente.filter(p => {
                    const tipoFila = getTipoFila(p);
                    return tipoFila === 'capitulo' || tipoFila === 'subcapitulo';
                  })
                : partidasParaCliente
            ).map(sanitizarPartidaParaBD); // ← solo los campos necesarios, sin estado React

            // Buscar cliente_id por email, y si no existe por nombre
            let clienteId = null;
            if (activeProject.direccion) {
                const { data: cd } = await supabase.from('clientes').select('id').eq('email', activeProject.direccion).maybeSingle();
                clienteId = cd?.id ?? null;
            }
            if (!clienteId && activeProject.cliente) {
                const { data: cd } = await supabase.from('clientes').select('id').eq('nombre', activeProject.cliente).maybeSingle();
                clienteId = cd?.id ?? null;
            }

            await supabase.from('presupuestos_cliente').insert({
                token,
                propuesta_id: activeProject.Proyecto,
                cliente_nombre: activeProject.cliente || '',
                cliente_email: activeProject.direccion || '',
                cliente_id: clienteId,
                proyecto_descripcion: activeProject.descripcion || getCleanProjectName(activeProject.Proyecto),
                partidas: partidasGuardar,
                precio_total: precioTotal
            });

            const baseOrigin = window.location.origin + window.location.pathname.replace(/\/$/, '');
            const portalUrl = `${baseOrigin}/#/presupuesto-cliente?token=${token}`;

            // ─── Construir HTML del email según formato elegido ───
            let filasHtml = '';

            if (soloCapitulosEmail) {
                // Solo capítulos y subcapítulos con su precio total acumulado
                const partidasEmail = partidasParaCliente.filter(p => {
                    const t = getTipoFila(p);
                    return t === 'capitulo' || t === 'subcapitulo';
                });
                filasHtml = partidasEmail.map((p) => {
                    const tipoFila = getTipoFila(p);
                    const capClean = (p.Capítulo || '').replace(/#+$/, '');
                    const totalCap = parseFloat(p.precio_total_capitulo) || 0;
                    const esCap    = tipoFila === 'capitulo';
                    const bgColor  = esCap ? '#dce7f2' : '#eef4fb';
                    const paddingLeft = esCap ? '14px' : '28px';
                    const textColor   = esCap ? '#002D54' : '#2a5a8a';
                    const fontWeight  = esCap ? '700' : '600';
                    const borderStyle = esCap ? 'border-bottom: 2px solid #cbd5e1;' : 'border-bottom: 1px solid #e2e8f0;';
                    const desc = (p.Descripción || p.texto_partida || '-').replace(/</g, '&lt;').replace(/>/g, '&gt;');

                    return `<tr style="background:${bgColor}; ${borderStyle}">` +
                        `<td colspan="3" style="padding:10px 14px; padding-left:${paddingLeft}; font-size:13px; font-weight:${fontWeight}; color:${textColor};">` +
                            `${capClean ? capClean + ' — ' : ''}${desc}` +
                        `</td>` +
                        `<td style="padding:10px 14px; font-size:13px; text-align:right; font-weight:${fontWeight}; color:${textColor}; white-space:nowrap;">` +
                            `${totalCap.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €` +
                        `</td>` +
                    `</tr>`;
                }).join('');
            } else {
                // Desglose completo: headers de capítulo con total + cada partida con su precio
                let partidaIndex = 0;
                filasHtml = partidasParaCliente.map((p) => {
                    const tipoFila = getTipoFila(p);
                    const capClean = (p.Capítulo || '').replace(/#+$/, '');
                    const desc = (p.Descripción || p.texto_partida || '-').replace(/</g, '&lt;').replace(/>/g, '&gt;');

                    if (tipoFila === 'capitulo' || tipoFila === 'subcapitulo') {
                        const totalCap = parseFloat(p.precio_total_capitulo) || 0;
                        const esCap    = tipoFila === 'capitulo';
                        const bgColor  = esCap ? '#dce7f2' : '#eef4fb';
                        const paddingLeft = esCap ? '14px' : '28px';
                        const textColor   = esCap ? '#002D54' : '#2a5a8a';
                        const fontWeight  = esCap ? '700' : '600';
                        const borderStyle = esCap ? 'border-top: 1px solid #cbd5e1; border-bottom: 2px solid #cbd5e1;' : 'border-bottom: 1px solid #e2e8f0;';

                        return `<tr style="background:${bgColor}; ${borderStyle}">` +
                            `<td colspan="3" style="padding:10px 14px; padding-left:${paddingLeft}; font-size:13px; font-weight:${fontWeight}; color:${textColor};">` +
                                `${capClean ? capClean + ' — ' : ''}${desc}` +
                            `</td>` +
                            `<td style="padding:10px 14px; font-size:13px; text-align:right; font-weight:${fontWeight}; color:${textColor}; white-space:nowrap;">` +
                                `${totalCap.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €` +
                            `</td>` +
                        `</tr>`;
                    } else {
                        const pUnit = parseFloat(p['Precio Total (€)']) || 0;
                        const cant  = parseFloat(p.Cantidad) || 1;
                        const total = pUnit * cant;
                        const ud    = p['Unidad IA'] || p.unidad || 'ud';
                        const bgColor = partidaIndex % 2 === 0 ? '#ffffff' : '#f8fafc';
                        partidaIndex++;

                        return `<tr style="background:${bgColor};">` +
                            `<td style="padding:10px 14px; padding-left:42px; font-size:13px; color:#334155; border-bottom:1px solid #e2e8f0;">${desc}</td>` +
                            `<td style="padding:10px 14px; font-size:12px; text-align:center; color:#64748b; border-bottom:1px solid #e2e8f0; white-space:nowrap;">${cant.toLocaleString('es-ES', { maximumFractionDigits: 2 })} ${ud}</td>` +
                            `<td style="padding:10px 14px; font-size:12px; text-align:right; color:#64748b; border-bottom:1px solid #e2e8f0; white-space:nowrap;">${pUnit.toLocaleString('es-ES', { minimumFractionDigits: 2 })} €</td>` +
                            `<td style="padding:10px 14px; font-size:13px; text-align:right; font-weight:600; color:#002D54; border-bottom:1px solid #e2e8f0; white-space:nowrap;">${total.toLocaleString('es-ES', { minimumFractionDigits: 2 })} €</td>` +
                        `</tr>`;
                    }
                }).join('');
            }

            const theadHtml = soloCapitulosEmail
                ? `<thead><tr style="background:#002D54;color:white;">` +
                    `<th colspan="3" style="padding:11px 14px;text-align:left;font-size:13px;">Capítulo / Descripción</th>` +
                    `<th style="padding:11px 14px;text-align:right;font-size:13px;width:140px;">Total (€)</th>` +
                  `</tr></thead>`
                : `<thead><tr style="background:#002D54;color:white;">` +
                    `<th style="padding:11px 14px;text-align:left;font-size:13px;">Descripción</th>` +
                    `<th style="padding:11px 14px;text-align:center;font-size:12px;width:100px;">Cantidad</th>` +
                    `<th style="padding:11px 14px;text-align:right;font-size:12px;width:110px;">Precio/ud (€)</th>` +
                    `<th style="padding:11px 14px;text-align:right;font-size:13px;width:120px;">Total (€)</th>` +
                  `</tr></thead>`;

            const tableHtml =
                `<table style="width:100%;border-collapse:collapse;margin-bottom:20px;">` +
                    theadHtml +
                    `<tbody>${filasHtml}</tbody>` +
                    `<tfoot><tr style="background:#002D54;color:white;">` +
                        `<td colspan="3" style="padding:12px 14px;font-weight:bold;font-size:15px;text-align:left;">TOTAL PRESUPUESTO</td>` +
                        `<td style="padding:12px 14px;text-align:right;font-weight:bold;font-size:15px;white-space:nowrap;">${precioTotal.toLocaleString('es-ES', { minimumFractionDigits: 2 })} €</td>` +
                    `</tr></tfoot>` +
                `</table>`;

            // Escape de valores dinámicos para evitar inyección HTML en el email.
            const clienteS    = escapeHtml(activeProject.cliente || 'Cliente');
            const proyectoNS  = escapeHtml(activeProject.descripcion || getCleanProjectName(activeProject.Proyecto));
            const portalUrlS  = escapeHtml(portalUrl);

            const htmlPresupuesto =
                `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>` +
                `<body style="font-family:Arial,sans-serif;background:#f1f5f9;margin:0;padding:20px 0;">` +
                `<div style="max-width:660px;margin:0 auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.10);">` +
                  `<div style="background:#002D54;padding:28px 32px;text-align:center;">` +
                    `<h1 style="color:white;margin:0;font-size:24px;font-weight:800;letter-spacing:-0.5px;">ADIR Reformas</h1>` +
                    `<p style="color:rgba(255,255,255,0.65);margin:6px 0 0;font-size:13px;">Presupuesto de Obra</p>` +
                  `</div>` +
                  `<div style="padding:32px;">` +
                    `<p style="font-size:15px;color:#334155;margin:0 0 8px;">Estimado/a <strong>${clienteS}</strong>,</p>` +
                    `<p style="font-size:14px;color:#64748b;margin:0 0 24px;line-height:1.6;">` +
                      `Le adjuntamos el presupuesto detallado para el proyecto <strong>${proyectoNS}</strong>. ` +
                      `Por favor, revíselo y proceda a firmarlo desde el siguiente enlace.` +
                    `</p>` +
                    tableHtml +
                    `<div style="text-align:center;margin:28px 0 20px;">` +
                      `<a href="${portalUrlS}" style="display:inline-block;padding:16px 36px;background:#002D54;color:white;text-decoration:none;border-radius:10px;font-weight:700;font-size:15px;letter-spacing:0.2px;">` +
                        `→ Revisar y Firmar Presupuesto` +
                      `</a>` +
                    `</div>` +
                    `<p style="font-size:11px;color:#94a3b8;text-align:center;margin:0;">` +
                      `Si el botón no funciona, copie este enlace en su navegador:<br>` +
                      `<a href="${portalUrlS}" style="color:#002D54;word-break:break-all;">${portalUrlS}</a>` +
                    `</p>` +
                  `</div>` +
                  `<div style="background:#f8fafc;padding:16px 32px;border-top:1px solid #e2e8f0;text-align:center;">` +
                    `<p style="margin:0;font-size:11px;color:#94a3b8;">ADIR Reformas · Gestión Profesional de Obras y Reformas · adirbc3@gmail.com</p>` +
                  `</div>` +
                `</div>` +
                `</body></html>`;

            // JSON.stringify en el body del fetch maneja el encoding correctamente —
            // no hace falta reemplazar comillas ni colapsar whitespace manualmente.
            // El Code node de n8n hace JSON.stringify(payload) de forma segura.
            fetch(`${N8N_BASE_URL}/webhook/presupuesto-cliente`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    token,
                    cliente_email: activeProject.direccion || '',
                    cliente_nombre: activeProject.cliente || '',
                    proyecto_nombre: activeProject.descripcion || getCleanProjectName(activeProject.Proyecto),
                    proyecto: activeProject.Proyecto,
                    precio_total: precioTotal,
                    portal_url: portalUrl,
                    html_presupuesto: htmlPresupuesto,
                    modo_email: 'capitulos',
                    modo_portal: modoPortalParam,
                    partidas: soloCapitulosPortal
                        ? partidasGuardar.map(p => ({
                            texto_partida: (p.Capítulo || 'S/C') + '::' + (p.Descripción || p.texto_partida || 'Sin descripcion'),
                            precio_adjudicado: parseFloat(p.precio_total_capitulo) || 0,
                            precio_base_estimado: parseFloat(p.precio_total_capitulo) || 0,
                            cantidad: 1,
                            unidad: 'ud'
                        }))
                        : partidas
                            .filter(p => !p.Capítulo?.endsWith('#'))
                            .map(p => ({
                                texto_partida: (p.Capítulo || 'S/C') + '::' + (p.Descripción || p.texto_partida || 'Sin descripcion'),
                                precio_adjudicado: aplicarBeneficio(parseFloat(p['Precio Total (€)']) || 0, beneficioPct),
                                precio_base_estimado: aplicarBeneficio(parseFloat(p['Precio Total (€)']) || 0, beneficioPct),
                                cantidad: parseFloat(p.Cantidad) || 1,
                                unidad: p['Unidad IA'] || p.unidad || 'ud'
                            }))
                })
            }).then(async r => {
                if (!r.ok) {
                    const txt = await r.text().catch(() => 'sin respuesta');
                    console.error('[JefesObra] Email cliente error:', r.status, txt);
                    showToast(`⚠️ Email al cliente no pudo enviarse (${r.status}). Comprueba n8n.`, 'error');
                }
            }).catch(e => {
                console.warn('[JefesObra] n8n no disponible:', e.message);
                showToast('⚠️ No se pudo conectar con n8n. El email puede no haberse enviado.', 'warning');
            });

            showAlert(`✅ Proyecto aprobado y en curso.\n\n📧 Presupuesto enviado al cliente.\n\n🔗 Enlace:\n${portalUrl}`, { type: 'success', title: '¡Proyecto Aprobado!' });
            setActiveProject(null);
            fetchProyectos();
        } catch (err) {
            console.error(err);
            showAlert('Error al confirmar proyecto: ' + err.message, { type: 'error', title: 'Error' });
        } finally {
            setLoadingProject(false);
        }
    };

    const reasignarJefe = async (proyectoId, nuevoCorreo) => {
        const { error } = await supabase
            .from('propuestas')
            .update({ jefe_obra: nuevoCorreo || null })
            .eq('Proyecto', proyectoId);
        if (error) {
            showToast('Error al reasignar jefe de obra.', 'error');
        } else {
            showToast('✅ Jefe de obra reasignado.', 'success');
            if (nuevoCorreo) {
                const jefeData = todosLosJefes.find(j => j.correo === nuevoCorreo);
                const proyecto = proyectos.find(p => p.Proyecto === proyectoId);
                if (N8N_BASE_URL) {
                    fetch(`${N8N_BASE_URL}/webhook/notificar-jefe-obra`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            proyectoId,
                            proyectoNombre: proyecto?.cliente || proyectoId,
                            jefeCorreo: nuevoCorreo,
                            jefeNombre: jefeData ? `${jefeData.nombre} ${jefeData.apellido}` : nuevoCorreo,
                            tipo: 'reasignacion'
                        })
                    }).catch(() => {});
                }
            }
            fetchProyectos();
        }
    };

    const proyectosFiltrados = jefeSeleccionado
        ? proyectos.filter(p => p.jefe_obra === jefeSeleccionado)
        : proyectos;

    // Guarda el comentario de una partida de inmediato en BD (modo elegido:
    // persistir al cerrar el popup, sin esperar al Guardar general).
    // Requiere la columna `comentario` en ctcon_partidas (ver migración).
    const guardarComentario = async (idx, texto) => {
        const t = (texto || '').trim();
        const p = partidas[idx];
        setGuardandoComentario(true);
        try {
            if (p?.id && !p._synthetic) {
                const { error } = await supabase.from('partidas').update({ comentario: t }).eq('id', p.id);
                if (error) throw error;
            }
            // Solo tras confirmar en BD: el botón pasa a verde de verdad.
            setPartidas(prev => {
                const copy = [...prev];
                copy[idx] = { ...copy[idx], comentario: t };
                return copy;
            });
            showToast(t ? 'Comentario guardado.' : 'Comentario eliminado.', 'success');
            setComentarioModal(null);
        } catch (e) {
            showToast('Error al guardar el comentario: ' + (e.message || e), 'error');
        } finally {
            setGuardandoComentario(false);
        }
    };

    return (
        <div>
            {ModalUI}
            {ToastUI}
            {comentarioModal && (
                <Modal
                    title="Comentario de la partida"
                    icon={<MessageSquare size={20} color="var(--primary)" />}
                    onClose={() => !guardandoComentario && setComentarioModal(null)}
                    maxWidth={480}
                    footer={<>
                        <button className="btn btn-secondary" onClick={() => setComentarioModal(null)} disabled={guardandoComentario}>Cancelar</button>
                        <button className="btn btn-primary" onClick={() => guardarComentario(comentarioModal.idx, comentarioModal.texto)} disabled={guardandoComentario} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            {guardandoComentario && <Loader2 size={14} className="loader-spinner" />} Guardar comentario
                        </button>
                    </>}
                >
                    <p style={{ margin: '0 0 12px', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                        Quedará asociado a la partida (se reflejará en el presupuesto del cliente).
                    </p>
                    <textarea
                        autoFocus
                        value={comentarioModal.texto}
                        onChange={(e) => setComentarioModal(m => ({ ...m, texto: e.target.value }))}
                        placeholder="Escribe aquí el comentario…"
                        style={{ width: '100%', minHeight: 120, padding: 10, borderRadius: 8, border: '1px solid var(--border-color)', fontSize: '0.9rem', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit' }}
                    />
                </Modal>
            )}
            <div className="animate-fade-in">
                {activeProject ? (
                    /* ─── VISTA DETALLE DEL PROYECTO ─── */
                    <div style={{ paddingBottom: '40px' }}>
                        <div className="glass-card" style={{ marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
                                <button className="btn btn-secondary" onClick={() => setActiveProject(null)} style={{ padding: '8px', borderRadius: '50%' }}>
                                    <ArrowLeft size={18} />
                                </button>
                                <div>
                                    <h1 style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '6px' }}><HardHat size={32} color="var(--primary)" />
                                        {activeProject.descripcion || getCleanProjectName(activeProject.Proyecto)}
                                        <button className="btn btn-secondary btn-sm" onClick={openEditMetadata} title="Editar Datos del Proyecto" style={{ padding: '4px 8px', fontSize: '0.75rem', fontWeight: 600 }}>
                                            ✏️ Editar Datos
                                        </button>
                                    </h1>
                                    <div style={{ display: 'flex', gap: '15px', marginTop: '4px', marginBottom: '10px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                        {activeProject.cliente && <span>👤 <strong>Cliente:</strong> {activeProject.cliente}</span>}
                                        {activeProject.direccion && <span>📧 <strong>Email:</strong> {activeProject.direccion}</span>}
                                    </div>
                                    <span className="badge badge-blue">Revisión de Jefe de Obra</span>
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                                <button
                                    className="btn btn-secondary"
                                    onClick={() => setShowDenyModal(true)}
                                    disabled={loadingProject}
                                    style={{ background: '#fee2e2', color: '#991b1b', border: '1px solid #fecaca' }}
                                >
                                    Denegar y Devolver
                                </button>
                                <button className="btn btn-success" onClick={handleConfirmarClick} disabled={loadingProject} style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                    {loadingProject ? <Loader2 className="loader-spinner" size={16} /> : <CheckCircle size={16} />}
                                    Aprobar y Empezar Obra
                                </button>
                            </div>
                        </div>

                        {!loadingProject && partidas.length > 0 && (
                            <div style={{
                                position: 'sticky', bottom: 0, zIndex: 10,
                                background: 'var(--bg-card)', borderTop: '2px solid var(--primary)',
                                padding: '14px 24px', borderRadius: '0 0 16px 16px',
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                boxShadow: '0 -4px 20px rgba(0,0,0,0.1)', marginBottom: '8px'
                            }}>
                                <span style={{ fontWeight: 600, color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                                    Total presupuesto ({partidas.filter(p => !p.Capítulo?.endsWith('#')).length} partidas)
                                </span>
                                {(() => {
                                    const costeTotal = partidas
                                        .filter(p => !p.Capítulo?.endsWith('#'))
                                        .reduce((acc, p) => acc + (parseFloat(p['Precio Total (€)']) || 0) * (parseFloat(p.Cantidad) || 1), 0);
                                    return (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
                                            <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                                                Coste: <strong>{fmtEuro(costeTotal)}</strong>
                                            </span>
                                            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                                                Beneficio
                                                <input
                                                    key={activeProject.Proyecto}
                                                    type="number" min="0" max="100" step="0.5"
                                                    defaultValue={activeProject.beneficio_pct ?? ''}
                                                    placeholder={String(defaultBeneficioPct)}
                                                    onBlur={(e) => guardarBeneficioProyecto(e.target.value)}
                                                    disabled={savingBeneficio}
                                                    title="% de beneficio de este proyecto (vacío = usa el de Ajustes)"
                                                    style={{ width: 62, padding: '4px 6px', textAlign: 'right', border: '1px solid var(--border-color)', borderRadius: 4 }}
                                                />
                                                %
                                            </span>
                                            <span style={{ fontWeight: 800, fontSize: '1.4rem', color: 'var(--primary)' }}>
                                                PVP: {fmtEuro(aplicarBeneficio(costeTotal, beneficioPct))}
                                            </span>
                                        </div>
                                    );
                                })()}
                            </div>
                        )}

                        <div className="glass-card">
                            {loadingProject ? (
                                <div style={{ textAlign: 'center', padding: '40px' }}><Loader2 className="loader-spinner" size={32} /></div>
                            ) : (
                                <div className="table-container">
                                    <table style={{ borderCollapse: 'collapse' }}>
                                        <thead>
                                            <tr>
                                                <th style={{ width: '50px', textAlign: 'center' }}>
                                                    <input
                                                        type="checkbox"
                                                        onChange={toggleAllAprobado}
                                                        checked={partidas.filter(p => !(p.Capítulo && p.Capítulo.endsWith('#'))).length > 0 && partidas.filter(p => !(p.Capítulo && p.Capítulo.endsWith('#'))).every(p => p.aprobado)}
                                                        style={{ transform: 'scale(1.2)', cursor: 'pointer' }}
                                                        title="Marcar / Desmarcar todas"
                                                    />
                                                </th>
                                                <th>Capítulo</th>
                                                <th>Descripción</th>
                                                <th style={{ width: '60px', textAlign: 'center' }}>Cant.</th>
                                                <th style={{ width: '55px', textAlign: 'center' }}>Ud.</th>
                                                <th style={{ width: '120px' }}>Oficio</th>
                                                <th>Proveedor / Oferta</th>
                                                <th style={{ width: '100px', textAlign: 'right' }}>Precio/ud (€)</th>
                                                <th style={{ width: '100px', textAlign: 'right' }}>Total (€)</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {partidas.map((p, idx) => {
                                                const tipoFila = getTipoFila(p);
                                                const esCapitulo   = tipoFila === 'capitulo';
                                                const esSubcap     = tipoFila === 'subcapitulo';
                                                const esPartida    = tipoFila === 'partida';
                                                const capClean = (p.Capítulo || '').replace(/#+/g, '');

                                                let rowStyle = { backgroundColor: 'transparent' };
                                                let codStyle = { fontWeight: 500, color: 'var(--text-muted)', paddingLeft: '8px', verticalAlign: 'middle' };
                                                let descStyle = { fontSize: '0.85rem', color: 'var(--text-main)', fontWeight: 400, paddingLeft: '8px', verticalAlign: 'middle' };

                                                if (esCapitulo) {
                                                    rowStyle = { backgroundColor: '#dce7f2', borderTop: '1px solid var(--border-color)', borderBottom: '1px solid var(--border-color)' };
                                                    codStyle = { ...codStyle, fontWeight: 800, color: 'var(--primary)', fontSize: '0.92rem', paddingLeft: '10px' };
                                                    descStyle = { ...descStyle, fontWeight: 700, color: 'var(--primary)', fontSize: '0.92rem' };
                                                } else if (esSubcap) {
                                                    rowStyle = { backgroundColor: 'var(--bg-secondary)' };
                                                    codStyle = { ...codStyle, fontWeight: 700, color: '#2a5a8a', fontSize: '0.88rem', paddingLeft: '10px' };
                                                    descStyle = { ...descStyle, fontWeight: 600, color: '#2a5a8a', fontSize: '0.88rem' };
                                                } else if (p.aprobado) {
                                                    rowStyle = { backgroundColor: 'rgba(22, 163, 74, 0.05)' };
                                                }

                                                return (
                                                    <tr key={idx} style={rowStyle}>
                                                        <td style={{ textAlign: 'center', verticalAlign: 'middle' }}>
                                                            {esPartida && (
                                                                <input type="checkbox" checked={p.aprobado} onChange={() => toggleAprobado(idx)} style={{ transform: 'scale(1.2)', cursor: 'pointer' }} />
                                                            )}
                                                        </td>
                                                        <td style={codStyle}>{capClean}</td>
                                                        <td style={descStyle}>
                                                            {p.Descripción}
                                                            {esPartida && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setComentarioModal({ idx, texto: p.comentario || '' })}
                                                                    title={(p.comentario && p.comentario.trim()) ? 'Editar comentario' : 'Añadir comentario'}
                                                                    style={{
                                                                        marginLeft: 8, background: 'none', border: 'none', cursor: 'pointer',
                                                                        padding: 2, verticalAlign: 'middle', lineHeight: 0,
                                                                        color: (p.comentario && p.comentario.trim()) ? '#16a34a' : '#9ca3af'
                                                                    }}
                                                                >
                                                                    <MessageSquare size={16} />
                                                                </button>
                                                            )}
                                                        </td>
                                                        <td style={{ textAlign: 'center', fontSize: '0.8rem', verticalAlign: 'middle' }}>
                                                            {esPartida && (
                                                                <input
                                                                    type="text"
                                                                    value={rawInputs[`cant_${idx}`] ?? formatDecimal(p.Cantidad)}
                                                                    onChange={(e) => setRawInputs(prev => ({ ...prev, [`cant_${idx}`]: e.target.value }))}
                                                                    onBlur={(e) => {
                                                                        const v = parseDecimal(e.target.value);
                                                                        updateCantidad(idx, v);
                                                                        setRawInputs(prev => { const n = { ...prev }; delete n[`cant_${idx}`]; return n; });
                                                                    }}
                                                                    style={{ width: '60px', textAlign: 'center', padding: '4px', border: '1px solid var(--border-color)', borderRadius: '4px', backgroundColor: 'var(--bg-card)' }}
                                                                />
                                                            )}
                                                        </td>
                                                        <td style={{ textAlign: 'center', fontSize: '0.8rem', verticalAlign: 'middle' }}>
                                                            {esPartida && (
                                                                <input
                                                                    type="text"
                                                                    value={p['Unidad IA'] || ''}
                                                                    onChange={(e) => updateUnidad(idx, e.target.value)}
                                                                    style={{ width: '50px', textAlign: 'center', padding: '4px', border: '1px solid var(--border-color)', borderRadius: '4px', backgroundColor: 'var(--bg-card)' }}
                                                                />
                                                            )}
                                                        </td>
                                                        <td style={{ fontSize: '0.8rem', verticalAlign: 'middle' }}>
                                                            {esPartida && (
                                                                <select
                                                                    style={{ width: '100%', padding: '4px', borderRadius: '4px', fontSize: '0.75rem', backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}
                                                                    onChange={(e) => updateOficio(idx, e.target.value)}
                                                                    value={p["Oficio Asignado"] || ''}
                                                                >
                                                                    <option value="Sin asignar">Sin asignar</option>
                                                                    {p["Oficio Asignado"] && p["Oficio Asignado"] !== "Sin asignar" && !oficiosDinamicos.includes(p["Oficio Asignado"]) && (
                                                                        <option value={p["Oficio Asignado"]}>{p["Oficio Asignado"]}</option>
                                                                    )}
                                                                    {oficiosDinamicos.map(of => (
                                                                        <option key={of} value={of}>{of}</option>
                                                                    ))}
                                                                </select>
                                                            )}
                                                        </td>
                                                        <td style={{ fontSize: '0.8rem', verticalAlign: 'middle' }}>
                                                            {esPartida && (
                                                                <select
                                                                    style={{ width: '100%', padding: '4px', borderRadius: '4px', fontSize: '0.75rem' }}
                                                                    onChange={(e) => updateProveedor(idx, e.target.value)}
                                                                    value={p.solicitud_seleccionada_id || ''}
                                                                >
                                                                    <option value="">-- Usar precio base --</option>
                                                                    {(respuestasPorPartida[p.id] || []).map(r => (
                                                                        <option key={r.solicitud_id} value={r.solicitud_id}>
                                                                            {r.proveedor_nombre} ({r.precio_ofertado}€)
                                                                        </option>
                                                                    ))}
                                                                </select>
                                                            )}
                                                        </td>
                                                        <td style={{ textAlign: 'right', verticalAlign: 'middle' }}>
                                                            {esPartida && (
                                                                <input
                                                                    type="text"
                                                                    value={rawInputs[`price_${idx}`] ?? formatDecimal(p['Precio Total (€)'])}
                                                                    onChange={(e) => setRawInputs(prev => ({ ...prev, [`price_${idx}`]: e.target.value }))}
                                                                    onBlur={(e) => {
                                                                        const v = parseDecimal(e.target.value);
                                                                        updatePrice(idx, v);
                                                                        setRawInputs(prev => { const n = { ...prev }; delete n[`price_${idx}`]; return n; });
                                                                    }}
                                                                    style={{ width: '88px', textAlign: 'right', padding: '6px', border: '1px solid var(--border-color)', borderRadius: '4px', backgroundColor: 'var(--bg-card)' }}
                                                                />
                                                            )}
                                                        </td>
                                                        <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--primary)', whiteSpace: 'nowrap', fontSize: '0.85rem', verticalAlign: 'middle' }}>
                                                            {esPartida && (
                                                                fmtEuro((parseFloat(p['Precio Total (€)']) || 0) * (parseFloat(p.Cantidad) || 1))
                                                            )}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    </div>
                ) : (
                    /* ─── VISTA LISTADO DE PROYECTOS ─── */
                    <>
                        <div className="glass-card" style={{ marginBottom: '20px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                                    <div>
                                        <h1 style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: 0 }}><HardHat size={32} color="var(--primary)" /> Panel de Jefes de Obra</h1>
                                        <p style={{ margin: '2px 0 0', color: 'var(--text-muted)', fontSize: '0.9rem' }}>Gestiona las revisiones técnicas y adjudicaciones.</p>
                                    </div>
                                </div>
                                <button className="btn btn-secondary" onClick={fetchProyectos} disabled={loading}>
                                    <RefreshCw size={16} className={loading ? 'loader-spinner' : ''} />
                                </button>
                            </div>
                        </div>

                        {esAdmin && (
                            <div className="glass-card" style={{ marginTop: '24px', marginBottom: '24px' }}>
                                <h3>🔍 Filtrar por Jefe de Obra</h3>
                                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '15px' }}>
                                    Como administrador ves todos los proyectos. Filtra por jefe si lo necesitas.
                                </p>
                                <select
                                    value={jefeSeleccionado}
                                    onChange={(e) => setJefeSeleccionado(e.target.value)}
                                    style={{ width: '100%', maxWidth: '340px', padding: '10px', borderRadius: 'var(--radius-md)' }}
                                >
                                    <option value="">— Todos los proyectos —</option>
                                    {jefesDisponibles.map(jefe => {
                                        const j = todosLosJefes.find(t => t.correo === jefe);
                                        return (
                                            <option key={jefe} value={jefe}>
                                                {j ? `${j.nombre} ${j.apellido}` : jefe}
                                            </option>
                                        );
                                    })}
                                </select>
                            </div>
                        )}

                        <div className="glass-card">
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
                                <HardHat size={24} color="var(--accent-primary)" />
                                <h2 style={{ margin: 0 }}>Proyectos Pendientes de Revisión</h2>
                            </div>
                            
                            {loading ? (
                                <div style={{ padding: '40px', textAlign: 'center' }}>
                                    <Loader2 className="loader-spinner" /> Cargando...
                                </div>
                            ) : (
                                <div className="table-container">
                                    <table>
                                        <thead>
                                            <tr>
                                                <th>ID Proyecto / Cliente</th>
                                                <th>Fecha Recepción</th>
                                                <th>Jefe Asignado</th>
                                                <th style={{ textAlign: 'right' }}>Acciones</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {proyectosFiltrados.length === 0 ? (
                                                <tr><td colSpan="4">No hay proyectos asignados a este perfil.</td></tr>
                                            ) : (
                                                proyectosFiltrados.map((pro, idx) => (
                                                    <tr key={idx}>
                                                        <td style={{ fontWeight: '600' }}>
                                                            {getCleanProjectName(pro.Proyecto)}
                                                            <div style={{ fontSize: '0.8rem', color: 'var(--text-main)', fontWeight: 'normal', marginTop: '2px' }}>
                                                                👤 Cliente: {pro.cliente || "No asignado"}
                                                            </div>
                                                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 'normal' }}>
                                                                ID: {pro.Proyecto}
                                                            </div>
                                                        </td>
                                                        <td>{new Date(pro.fecha_recepcion).toLocaleDateString()}</td>
                                                        <td>
                                                            {esAdmin ? (
                                                                <select
                                                                    value={pro.jefe_obra || ''}
                                                                    onChange={(e) => reasignarJefe(pro.Proyecto, e.target.value)}
                                                                    style={{
                                                                        padding: '5px 8px', borderRadius: 6,
                                                                        border: '1px solid var(--border-color)',
                                                                        backgroundColor: 'var(--bg-card)',
                                                                        fontSize: '0.82rem', minWidth: '180px'
                                                                    }}
                                                                >
                                                                    <option value="">— Sin asignar —</option>
                                                                    {todosLosJefes.map(j => (
                                                                        <option key={j.correo} value={j.correo}>
                                                                            {j.nombre} {j.apellido}
                                                                        </option>
                                                                    ))}
                                                                </select>
                                                            ) : (
                                                                <span className="badge" style={{ backgroundColor: '#e5edf7', color: '#002D54', border: '1px solid #c7d5e6' }}>
                                                                    {pro.jefe_obra || 'Sin Asignar'}
                                                                </span>
                                                            )}
                                                        </td>
                                                        <td style={{ textAlign: 'right' }}>
                                                            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                                                                <button className="btn btn-primary btn-sm" onClick={() => openProject(pro)} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                                                    <FileText size={14} /> Evaluar
                                                                </button>
                                                                <button
                                                                    className="btn btn-sm"
                                                                    onClick={() => setProjectToDelete(pro)}
                                                                    title="Eliminar proyecto"
                                                                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#fee2e2', color: '#991b1b', border: '1px solid #fecaca' }}
                                                                >
                                                                    <Trash2 size={13} />
                                                                </button>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                ))
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    </>
                )}
            </div>

            {/* ─── MODALES (FUERA del div animado para asegurar el centrado en pantalla completa) ─── */}
            {showDenyModal && (
                <div style={modalOverlay}>
                    <div style={modalContent}>
                        <div style={{ width: '60px', height: '60px', background: '#fee2e2', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
                            <X size={30} color="#dc2626" />
                        </div>
                        <h3 style={{ margin: '0 0 10px', fontSize: '1.25rem', color: '#111827' }}>¿Denegar Proyecto?</h3>
                        <p style={{ margin: '0 0 24px', fontSize: '0.95rem', color: '#6b7280', lineHeight: 1.5 }}>
                            El proyecto volverá a la sección de <strong>Borradores</strong>. Oficina podrá editarlo de nuevo y ajustar precios o proveedores.
                        </p>
                        <div style={{ display: 'flex', gap: '12px' }}>
                            <button onClick={() => setShowDenyModal(false)} style={btnCancel}>Cancelar</button>
                            <button onClick={denegarProyecto} style={btnDanger}>Confirmar y Devolver</button>
                        </div>
                    </div>
                </div>
            )}

            {showApproveWarning && (
                <div style={modalOverlay}>
                    <div style={modalContent}>
                        <div style={{ width: '60px', height: '60px', background: '#fef3c7', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
                            <AlertCircle size={30} color="#d97706" />
                        </div>
                        <h3 style={{ margin: '0 0 10px', fontSize: '1.25rem', color: '#111827' }}>Partidas sin revisar</h3>
                        <p style={{ margin: '0 0 24px', fontSize: '0.95rem', color: '#6b7280', lineHeight: 1.5 }}>
                            Tienes algunas partidas sin marcar como revisadas (OK). ¿Deseas aprobar el proyecto de todas formas?
                        </p>
                        <div style={{ display: 'flex', gap: '12px' }}>
                            <button onClick={() => setShowApproveWarning(false)} style={btnCancel}>Seguir Revisando</button>
                            <button onClick={() => { setShowApproveWarning(false); setShowFormatModal(true); }} style={btnSuccess}>Aprobar de todas formas</button>
                        </div>
                    </div>
                </div>
            )}

            {showFormatModal && (
                <div style={modalOverlay}>
                    <div style={{...modalContent, textAlign: 'left', maxWidth: '500px'}}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px', borderBottom: '1px solid var(--border-color)', paddingBottom: '14px' }}>
                            <span style={{ fontSize: '1.5rem' }}>📋</span>
                            <h3 style={{ margin: 0, color: 'var(--primary)', fontSize: '1.2rem', fontWeight: 700 }}>Formato del Presupuesto</h3>
                        </div>

                        {/* ─── Correo: siempre caps/subcaps (info fija) ─── */}
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '12px 14px', marginBottom: '20px', borderRadius: '10px', backgroundColor: '#f0f7ff', border: '1px solid #bfdbfe' }}>
                            <span style={{ fontSize: '1.1rem', marginTop: '1px' }}>📧</span>
                            <div>
                                <strong style={{ display: 'block', fontSize: '0.88rem', color: '#1e40af', marginBottom: '2px' }}>El correo siempre muestra solo capítulos y subcapítulos</strong>
                                <span style={{ fontSize: '0.78rem', color: '#3b82f6' }}>Vista resumida: una línea por capítulo/subcapítulo con su total acumulado.</span>
                            </div>
                        </div>

                        {/* ─── Formulario de firma ─── */}
                        <div style={{ marginBottom: '24px' }}>
                            <p style={{ margin: '0 0 8px', fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                📝 Formulario de firma — portal del cliente
                            </p>
                            <p style={{ margin: '0 0 14px', fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                                Qué nivel de detalle verá el cliente en el portal al revisar y firmar:
                            </p>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                <label style={{
                                    display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '14px 16px',
                                    borderRadius: '10px', cursor: 'pointer', transition: 'all 0.2s',
                                    border: modoPortal === 'desglose' ? '2px solid var(--primary)' : '1px solid var(--border-color)',
                                    backgroundColor: modoPortal === 'desglose' ? 'rgba(0, 45, 84, 0.05)' : 'transparent'
                                }}>
                                    <input type="radio" name="modoPortal" value="desglose"
                                        checked={modoPortal === 'desglose'} onChange={() => setModoPortal('desglose')}
                                        style={{ marginTop: '3px', accentColor: 'var(--primary)' }} />
                                    <div>
                                        <strong style={{ display: 'block', fontSize: '0.9rem', marginBottom: '3px' }}>Desglose completo — todas las partes y partidas</strong>
                                        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>El portal muestra capítulos, subcapítulos y cada partida individual con sus precios.</span>
                                    </div>
                                </label>
                                <label style={{
                                    display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '14px 16px',
                                    borderRadius: '10px', cursor: 'pointer', transition: 'all 0.2s',
                                    border: modoPortal === 'capitulos' ? '2px solid var(--primary)' : '1px solid var(--border-color)',
                                    backgroundColor: modoPortal === 'capitulos' ? 'rgba(0, 45, 84, 0.05)' : 'transparent'
                                }}>
                                    <input type="radio" name="modoPortal" value="capitulos"
                                        checked={modoPortal === 'capitulos'} onChange={() => setModoPortal('capitulos')}
                                        style={{ marginTop: '3px', accentColor: 'var(--primary)' }} />
                                    <div>
                                        <strong style={{ display: 'block', fontSize: '0.9rem', marginBottom: '3px' }}>Solo capítulos y subcapítulos</strong>
                                        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>El portal muestra únicamente el resumen por capítulo/subcapítulo, sin detallar partidas.</span>
                                    </div>
                                </label>
                            </div>
                        </div>

                        <div style={{ display: 'flex', gap: '12px' }}>
                            <button className="btn btn-secondary" onClick={() => setShowFormatModal(false)} style={{ flex: 1 }}>
                                Cancelar
                            </button>
                            <button
                                className="btn btn-success"
                                onClick={() => confirmarProyecto(modoPortal)}
                                style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px' }}
                            >
                                <CheckCircle size={16} /> Aprobar y Enviar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {projectToDelete && (
                <div style={modalOverlay}>
                    <div style={modalContent}>
                        <div style={{ width: '60px', height: '60px', background: '#fee2e2', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
                            <Trash2 size={28} color="#dc2626" />
                        </div>
                        <h3 style={{ margin: '0 0 10px', fontSize: '1.2rem', color: '#111827' }}>¿Eliminar Proyecto?</h3>
                        <p style={{ margin: '0 0 6px', fontSize: '0.95rem', color: '#374151', fontWeight: 600 }}>
                            {getCleanProjectName(projectToDelete.Proyecto)}
                        </p>
                        <p style={{ margin: '0 0 24px', fontSize: '0.88rem', color: '#6b7280', lineHeight: 1.5 }}>
                            Esta acción borrará permanentemente el proyecto, todas sus partidas y solicitudes de la base de datos. <strong>No se puede deshacer.</strong>
                        </p>
                        <div style={{ display: 'flex', gap: '12px' }}>
                            <button onClick={() => setProjectToDelete(null)} style={btnCancel} disabled={deleting}>Cancelar</button>
                            <button onClick={eliminarProyecto} style={btnDanger} disabled={deleting}>
                                {deleting ? <Loader2 size={14} className="loader-spinner" /> : <Trash2 size={14} />}
                                {deleting ? ' Eliminando...' : ' Eliminar definitivamente'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showEditMetadata && (
                <div style={modalOverlay}>
                    <div style={{...modalContent, textAlign: 'left', maxWidth: '450px'}}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
                            <span style={{ fontSize: '1.4rem' }}>✏️</span>
                            <h3 style={{ color: 'var(--primary)', margin: 0, fontSize: '1.15rem', fontWeight: 700 }}>Editar Datos del Proyecto</h3>
                        </div>

                        <div style={{ marginBottom: '15px' }}>
                            <label style={{ display: 'block', marginBottom: '5px', fontSize: '0.85rem', fontWeight: 600 }}>
                                Nombre del Proyecto:
                                <span style={{ fontWeight: 400, color: 'var(--text-secondary)', marginLeft: '6px', fontSize: '0.78rem' }}>(aparece en el correo y el portal)</span>
                            </label>
                            <input
                                type="text"
                                value={metadataForm.nombre_proyecto}
                                onChange={(e) => setMetadataForm({...metadataForm, nombre_proyecto: e.target.value})}
                                placeholder="Nombre descriptivo del proyecto..."
                                style={{ width: '100%', padding: '10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
                            />
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px', display: 'block' }}>
                                Referencia BC3: <code style={{ backgroundColor: '#f1f5f9', padding: '1px 5px', borderRadius: '4px' }}>{activeProject.Proyecto}</code>
                            </span>
                        </div>

                        <div style={{ marginBottom: '15px' }}>
                            <label style={{ display: 'block', marginBottom: '5px', fontSize: '0.85rem', fontWeight: 600 }}>Nombre del Cliente:</label>
                            <input
                                type="text"
                                value={metadataForm.cliente}
                                onChange={(e) => setMetadataForm({...metadataForm, cliente: e.target.value})}
                                placeholder="Nombre del cliente..."
                                style={{ width: '100%', padding: '10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
                            />
                        </div>

                        <div style={{ marginBottom: '20px' }}>
                            <label style={{ display: 'block', marginBottom: '5px', fontSize: '0.85rem', fontWeight: 600 }}>Email de Contacto <span style={{ fontWeight: 400, color: 'var(--text-secondary)' }}>(para firma digital)</span>:</label>
                            <input
                                type="email"
                                value={metadataForm.cliente_email}
                                onChange={(e) => setMetadataForm({...metadataForm, cliente_email: e.target.value})}
                                placeholder="ejemplo@correo.com"
                                style={{ width: '100%', padding: '10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
                            />
                        </div>

                        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                            <button className="btn btn-secondary" onClick={() => setShowEditMetadata(false)}>Cancelar</button>
                            <button className="btn btn-primary" onClick={saveMetadata}>Guardar Cambios</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

const modalOverlay = {
    position: 'fixed', 
    top: 0, 
    left: 0, 
    width: '100vw', 
    height: '100vh',
    backgroundColor: 'rgba(0,0,0,0.6)', 
    backdropFilter: 'blur(8px)',
    zIndex: 1000000, 
    display: 'flex', 
    justifyContent: 'center', 
    alignItems: 'center'
};
const modalContent = {
    background: 'white', 
    padding: '40px', 
    borderRadius: '24px',
    maxWidth: '460px', 
    width: '90%', 
    textAlign: 'center',
    boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)',
    position: 'relative',
    // Aseguramos que sea el centro de la ventana
    margin: 'auto'
};
const btnCancel = { flex: 1, padding: '12px', borderRadius: '10px', border: '1px solid #c7d5e6', background: 'white', fontWeight: 600, cursor: 'pointer' };
const btnDanger = { flex: 1, padding: '12px', borderRadius: '10px', border: 'none', background: '#dc2626', color: 'white', fontWeight: 600, cursor: 'pointer' };
const btnSuccess = { flex: 1, padding: '12px', borderRadius: '10px', border: 'none', background: '#16a34a', color: 'white', fontWeight: 600, cursor: 'pointer' };

export default JefesObra;
