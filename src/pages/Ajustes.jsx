import React, { useState, useEffect } from 'react';
import { Save, Loader2, Settings, Key, Mail, AlertTriangle, CheckCircle, Percent } from 'lucide-react';
import { useToast } from '../utils/useModal';
import { supabase } from '../utils/supabaseClient';

const Ajustes = () => {
    const { showToast, ToastUI } = useToast();
    const [groqKey, setGroqKey] = useState('');
    const [groqConfigured, setGroqConfigured] = useState(false);
    const [loading, setLoading] = useState(true);
    const [savingGroq, setSavingGroq] = useState(false);
    const [beneficioPct, setBeneficioPct] = useState('');
    const [savingBeneficio, setSavingBeneficio] = useState(false);

    useEffect(() => {
        const init = async () => {
            // Leer clave Groq desde Supabase (fallback: localStorage)
            try {
                const { data } = await supabase
                    .from('configuracion')
                    .select('valor')
                    .eq('clave', 'groq_api_key')
                    .maybeSingle();
                if (data?.valor && data.valor.length > 10) {
                    setGroqConfigured(true);
                    localStorage.setItem('groq_api_key', data.valor);
                } else {
                    const cached = localStorage.getItem('groq_api_key');
                    if (cached && cached.length > 10) setGroqConfigured(true);
                }
            } catch (_) {}
            // Leer % de beneficio por defecto
            try {
                const { data } = await supabase
                    .from('configuracion')
                    .select('valor')
                    .eq('clave', 'beneficio_pct')
                    .maybeSingle();
                if (data?.valor !== undefined && data?.valor !== null && data.valor !== '') {
                    setBeneficioPct(String(data.valor));
                }
            } catch (_) {}
        };
        init().finally(() => setLoading(false));
    }, []);

    const handleSaveBeneficio = async (e) => {
        e.preventDefault();
        const pct = parseFloat(String(beneficioPct).replace(',', '.'));
        if (isNaN(pct) || pct < 0 || pct > 100) {
            showToast('Introduce un % de beneficio válido (0–100).', 'error');
            return;
        }
        setSavingBeneficio(true);
        try {
            const { error } = await supabase
                .from('configuracion')
                .upsert({ clave: 'beneficio_pct', valor: String(pct), updated_at: new Date().toISOString() }, { onConflict: 'clave' });
            if (error) throw error;
            setBeneficioPct(String(pct));
            showToast('% de beneficio por defecto guardado ✅');
        } catch (err) {
            showToast('Error al guardar el % de beneficio: ' + err.message, 'error');
        } finally {
            setSavingBeneficio(false);
        }
    };

    const handleSaveGroq = async (e) => {
        e.preventDefault();
        const key = groqKey.trim();
        if (!key || key.length < 10) {
            showToast("Introduce una API Key de Groq válida (más de 10 caracteres)", "error");
            return;
        }
        setSavingGroq(true);
        try {
            // Guardar en Supabase (disponible desde cualquier navegador)
            const { error } = await supabase
                .from('configuracion')
                .upsert({ clave: 'groq_api_key', valor: key, updated_at: new Date().toISOString() }, { onConflict: 'clave' });
            if (error) throw error;
            // También en localStorage como caché inmediata
            localStorage.setItem('groq_api_key', key);
            setGroqConfigured(true);
            setGroqKey('');
            showToast("API Key guardada en la nube ✅ — disponible desde cualquier navegador");
        } catch (err) {
            showToast("Error al guardar la API Key: " + err.message, "error");
        } finally {
            setSavingGroq(false);
        }
    };

    return (
        <div className="animate-fade-in">
            <div className="glass-card" style={{ marginBottom: '20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    <div>
                        <h1 style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: 0 }}><Settings size={32} color="var(--primary)" /> Ajustes</h1>
                        <p style={{ margin: '2px 0 0', color: 'var(--text-muted)', fontSize: '0.9rem' }}>Configuración general de la aplicación.</p>
                    </div>
                </div>
            </div>

            {ToastUI}

            {loading ? (
                <div style={{ padding: '40px', textAlign: 'center' }}><Loader2 className="loader-spinner" /> Cargando configuración...</div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', maxWidth: '680px' }}>

                    {/* % BENEFICIO POR DEFECTO */}
                    <div className="glass-card" style={{ border: '1px solid var(--primary)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                            <Percent size={22} color="var(--primary)" />
                            <h2 style={{ margin: 0 }}>Margen de beneficio por defecto</h2>
                        </div>
                        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '16px' }}>
                            Se aplica a los precios de coste para calcular el PVP del cliente. Se puede
                            ajustar por proyecto en Borradores y Jefe de Obra. El cliente no ve este porcentaje.
                        </p>
                        <form onSubmit={handleSaveBeneficio}>
                            <div className="form-group">
                                <label>% de beneficio</label>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, maxWidth: 200 }}>
                                    <input
                                        type="number"
                                        min="0" max="100" step="0.5"
                                        value={beneficioPct}
                                        onChange={e => setBeneficioPct(e.target.value)}
                                        placeholder="Ej: 15"
                                        style={{ width: '100%', padding: '10px', borderRadius: '4px', border: '1px solid var(--border-color)' }}
                                    />
                                    <span style={{ fontWeight: 700, color: 'var(--text-muted)' }}>%</span>
                                </div>
                            </div>
                            <button type="submit" className="btn btn-primary" disabled={savingBeneficio} style={{ marginTop: '16px' }}>
                                {savingBeneficio ? <Loader2 className="loader-spinner" size={16} /> : <Save size={16} />}
                                {savingBeneficio ? ' Guardando...' : ' Guardar % por defecto'}
                            </button>
                        </form>
                    </div>

                    {/* GROQ API */}
                    <div className="glass-card" style={{ border: groqConfigured ? '1px solid var(--success)' : '1px solid var(--primary)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                            <Key size={22} color="var(--primary)" />
                            <h2 style={{ margin: 0 }}>Inteligencia Artificial — Groq (LLaMA 3)</h2>
                            {groqConfigured && (
                                <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--success)', fontSize: '0.85rem', fontWeight: 600 }}>
                                    <CheckCircle size={14} /> Configurada
                                </span>
                            )}
                        </div>
                        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '16px' }}>
                            La clave se guarda en la base de datos de la app — no tendrás que introducirla de nuevo desde ningún navegador.
                            Obtén tu clave en{' '}
                            <a href="https://console.groq.com/keys" target="_blank" rel="noopener noreferrer">console.groq.com</a>.
                        </p>
                        <form onSubmit={handleSaveGroq}>
                            <div className="form-group">
                                <label>API Key de Groq</label>
                                <input
                                    type="password"
                                    value={groqKey}
                                    onChange={e => setGroqKey(e.target.value)}
                                    placeholder={groqConfigured ? "Clave ya guardada — escribe una nueva para reemplazarla" : "Pega aquí tu API Key de Groq..."}
                                    style={{ width: '100%', padding: '10px', borderRadius: '4px', border: '1px solid var(--border-color)', fontFamily: 'monospace' }}
                                />
                            </div>
                            <button type="submit" className="btn btn-primary" disabled={savingGroq} style={{ marginTop: '16px' }}>
                                {savingGroq ? <Loader2 className="loader-spinner" size={16} /> : <Save size={16} />}
                                {savingGroq ? ' Guardando...' : ' Guardar en la nube'}
                            </button>
                        </form>
                    </div>

                    {/* CORREO — informativo */}
                    <div className="glass-card">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                            <Mail size={22} color="var(--primary)" />
                            <h2 style={{ margin: 0 }}>Configuración de Correo</h2>
                        </div>

                        {/* Aviso de arquitectura fija */}
                        <div style={{ display: 'flex', gap: '10px', padding: '12px 14px', background: '#fff8e1', border: '1px solid #f59e0b', borderRadius: '8px', marginBottom: '16px' }}>
                            <AlertTriangle size={18} color="#d97706" style={{ flexShrink: 0, marginTop: '1px' }} />
                            <div style={{ fontSize: '0.83rem', color: '#92400e' }}>
                                <strong>El envío de correos está gestionado por n8n + Brevo</strong>, no directamente desde la app.
                                El correo emisor fijo es <code style={{ background: '#fef3c7', padding: '1px 4px', borderRadius: '3px' }}>adirbc3@gmail.com</code> configurado en el workflow de n8n.
                                Cambiarlo aquí <strong>no afectaría</strong> al envío real — para modificarlo hay que actualizar los nodos "Enviar Email (Brevo)" en n8n.
                            </div>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                            <div style={{ padding: '12px', background: 'var(--bg-secondary)', borderRadius: '6px' }}>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '4px' }}>CORREO EMISOR (n8n)</div>
                                <div style={{ fontFamily: 'monospace', fontSize: '0.9rem', color: 'var(--primary)' }}>adirbc3@gmail.com</div>
                            </div>
                            <div style={{ padding: '12px', background: 'var(--bg-secondary)', borderRadius: '6px' }}>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '4px' }}>PROVEEDOR DE ENVÍO</div>
                                <div style={{ fontFamily: 'monospace', fontSize: '0.9rem', color: 'var(--primary)' }}>Brevo API</div>
                            </div>
                        </div>
                    </div>

                </div>
            )}
        </div>
    );
};

export default Ajustes;
