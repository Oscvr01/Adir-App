/**
 * Hash de contraseña en hex de los bytes UTF-8 (NO es bcrypt — ver A2 en la
 * auditoría de seguridad). Fuente única: antes estaba duplicado en App.jsx y
 * Usuarios.jsx. Migrar a bcrypt server-side se hace aquí, en un solo sitio.
 */
export const toHex = (str) =>
  Array.from(new TextEncoder().encode(str))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
