import { useState, useEffect } from 'react';
import { supabase } from '../utils/supabaseClient';

/**
 * Hook compartido entre Borradores.jsx y JefesObra.jsx para cargar el % de
 * beneficio por defecto de Ajustes, calcular el % efectivo del proyecto activo
 * y persistir el override en `propuestas.beneficio_pct`.
 */
export function useBeneficioProyecto(activeProject, setActiveProject, showToast) {
  const [defaultBeneficioPct, setDefaultBeneficioPct] = useState(0);
  const [savingBeneficio, setSavingBeneficio] = useState(false);

  useEffect(() => {
    supabase
      .from('configuracion')
      .select('valor')
      .eq('clave', 'beneficio_pct')
      .maybeSingle()
      .then(({ data }) => {
        if (data?.valor) setDefaultBeneficioPct(parseFloat(data.valor) || 0);
      });
  }, []);

  const beneficioPct =
    activeProject?.beneficio_pct !== null &&
    activeProject?.beneficio_pct !== undefined &&
    activeProject?.beneficio_pct !== ''
      ? parseFloat(activeProject.beneficio_pct)
      : defaultBeneficioPct;

  const guardarBeneficioProyecto = async (nuevoPct) => {
    const pct = nuevoPct === '' ? null : parseFloat(String(nuevoPct).replace(',', '.'));
    if (pct !== null && (isNaN(pct) || pct < 0 || pct > 100)) {
      showToast('% de beneficio inválido (0–100).', 'error');
      return;
    }
    setSavingBeneficio(true);
    try {
      const { error } = await supabase
        .from('propuestas')
        .update({ beneficio_pct: pct })
        .eq('Proyecto', activeProject.Proyecto);
      if (error) throw error;
      setActiveProject((prev) => ({ ...prev, beneficio_pct: pct }));
      showToast('% de beneficio del proyecto guardado.');
    } catch (e) {
      showToast('Error al guardar el %: ' + (e.message || e), 'error');
    } finally {
      setSavingBeneficio(false);
    }
  };

  return {
    defaultBeneficioPct,
    savingBeneficio,
    beneficioPct,
    guardarBeneficioProyecto,
  };
}
