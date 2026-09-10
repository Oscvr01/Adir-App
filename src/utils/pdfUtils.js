import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { logoBase64 } from '../assets/logoBase64';
import { cleanText as cleanDesc } from './escape';

// ─── Colores corporativos ADIR (sincronizados con --primary: #002D54) ────────
const AZUL        = [0, 45, 84];     // #002D54 — azul principal app
const AZUL_LIGHT  = [199, 213, 230]; // #c7d5e6 — fondo azul claro app
const VERDE       = [5, 150, 105];   // --success: #059669
const GRIS_TEXTO  = [80, 80, 80];
const GRIS_MUTED  = [140, 140, 140];
const GRIS_FILA   = [248, 249, 252]; // Fila alternada tabla
// Jerarquía 3 niveles en tabla PDF
const CAP_FILL    = [220, 231, 242]; // #dce7f2 — fondo capítulo (igual que UI Borradores)
const SUB_FILL    = [236, 242, 249]; // más claro — fondo subcapítulo
const SUB_TEXT    = [42, 90, 138];   // #2a5a8a — texto subcapítulo

// Clasificador de fila (capítulo / subcapítulo / partida) — sincronizado con UI
const getFilaTipoPDF = (p) => {
    const cap = (p.Capítulo || p.Capitulo || '').trim();
    if (!cap.endsWith('#')) return 'partida';
    const limpio = cap.replace(/#$/, '');
    if (limpio === '99_EXTRAS') return 'capitulo';
    if (limpio.includes('.')) return 'subcapitulo';
    return 'capitulo';
};

/**
 * Genera un PDF de presupuesto con diseño corporativo ADIR unificado.
 * Usado por: Borradores, PresupuestoCliente (portal), PresupuestosFirmados, Proyectos.
 *
 * @param {Object} data
 * @param {string}  data.cliente         - Nombre del cliente
 * @param {string}  data.propuesta_id    - ID del proyecto (referencia)
 * @param {string}  data.descripcion     - Descripción del proyecto
 * @param {Array}   data.partidas        - Array de partidas del presupuesto
 * @param {number}  data.precio_total    - Total del presupuesto
 * @param {string}  [data.fecha]         - Fecha del documento (ISO o legible)
 * @param {string}  [data.token]         - Token de referencia (8 chars)
 * @param {string}  [data.titulo]        - Título del doc ("Borrador" / "Presupuesto de Obra")
 * @param {string}  [data.firma_base64]  - Base64 de la firma (activa sección firma)
 * @param {string}  [data.fecha_firma]   - Fecha de firma (ISO)
 * @returns {jsPDF}
 */
export function generarPresupuestoPDF(data) {
    const {
        cliente       = 'Sin especificar',
        propuesta_id  = '',
        descripcion   = '',
        partidas      = [],
        precio_total  = 0,
        fecha         = new Date().toISOString(),
        token         = '',
        titulo        = 'Presupuesto de Obra',
        firma_base64  = null,
        fecha_firma   = null,
    } = data;

    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const W = 210; // ancho A4

    // ── 1. CABECERA ────────────────────────────────────────────────────────────
    // Fondo azul superior
    doc.setFillColor(...AZUL);
    doc.rect(0, 0, W, 38, 'F');

    // Logo
    try {
        doc.addImage(logoBase64, 'PNG', 8, 6, 48, 24);
    } catch (_) { /* sin logo no bloquea */ }

    // Nombre empresa
    doc.setFontSize(20);
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.text('ADIR REFORMAS', 62, 18);

    // Subtítulo
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(titulo.toUpperCase(), 62, 26);

    // Badge firmado (solo si hay firma)
    if (firma_base64) {
        doc.setFillColor(...VERDE);
        doc.roundedRect(W - 52, 10, 46, 16, 3, 3, 'F');
        doc.setFontSize(8);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(255, 255, 255);
        doc.text('FIRMADO DIGITALMENTE', W - 49, 20);
    }

    // ── 2. DATOS CLIENTE ───────────────────────────────────────────────────────
    const fechaFormateada = (() => {
        try { return new Date(fecha).toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' }); }
        catch (_) { return fecha; }
    })();

    doc.setFillColor(...AZUL_LIGHT);
    doc.rect(0, 38, W, 32, 'F');

    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...AZUL);
    doc.text('CLIENTE', 14, 48);
    doc.text('PROYECTO', 90, 48);
    doc.text('FECHA', 155, 48);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...GRIS_TEXTO);
    doc.setFontSize(10);
    doc.text(cliente.substring(0, 35), 14, 55);
    doc.text((descripcion || propuesta_id).substring(0, 30), 90, 55);
    doc.text(fechaFormateada, 155, 55);

    doc.setFontSize(8);
    doc.setTextColor(...GRIS_MUTED);
    doc.text('Ref: ' + (token ? token.substring(0, 8).toUpperCase() : propuesta_id.substring(0, 8)), 14, 63);

    // ── 3. TABLA DE PARTIDAS ───────────────────────────────────────────────────
    // Detectar modo desde los datos: si hay filas que no son caps/subcaps → desglose completo
    const todasPartidas = partidas || [];
    const esModoDesglose = todasPartidas.some(p => {
        const cap = (p.Capítulo || p.Capitulo || '').trim();
        return !cap.endsWith('#');
    });

    const filas = [];
    let totalCalculado = 0;

    todasPartidas.forEach(p => {
        const tipo   = getFilaTipoPDF(p);
        const cap    = (p.Capítulo || p.Capitulo || '').replace(/#+/g, '').trim();
        const desc   = cleanDesc(p.Descripción || p.Descripcion || p.texto_partida || '').substring(0, 120);
        const totalCap = parseFloat(p.precio_total_capitulo || 0);

        if (esModoDesglose) {
            // ── MODO DESGLOSE: 6 columnas ──
            const precio = parseFloat(p['Precio Total (€)'] || p.precio_adjudicado || 0);
            const cant   = parseFloat(p.Cantidad || p.cantidad || 1);
            const unidad = (p['Unidad IA'] || p.unidad || 'ud').trim();
            const total  = precio * cant;

            if (tipo === 'capitulo') {
                // Capítulo: 6 celdas explícitas — total acumulado en col 5 (Total €)
                const totalCapStr = totalCap > 0
                    ? totalCap.toLocaleString('es-ES', { minimumFractionDigits: 2 }) + ' €'
                    : '';
                const capS = { fontStyle: 'bold', fillColor: CAP_FILL, textColor: AZUL };
                filas.push([
                    { content: cap,        styles: capS },
                    { content: desc,       styles: capS },
                    { content: '',         styles: { fillColor: CAP_FILL } },
                    { content: '',         styles: { fillColor: CAP_FILL } },
                    { content: '',         styles: { fillColor: CAP_FILL } },
                    { content: totalCapStr, styles: { ...capS, halign: 'right' } },
                ]);
            } else if (tipo === 'subcapitulo') {
                // Subcapítulo: mismo patrón con estilo itálico azul medio
                const totalSubStr = totalCap > 0
                    ? totalCap.toLocaleString('es-ES', { minimumFractionDigits: 2 }) + ' €'
                    : '';
                const subS = { fontStyle: 'italic', fillColor: SUB_FILL, textColor: SUB_TEXT };
                filas.push([
                    { content: cap,        styles: subS },
                    { content: desc,       styles: subS },
                    { content: '',         styles: { fillColor: SUB_FILL } },
                    { content: '',         styles: { fillColor: SUB_FILL } },
                    { content: '',         styles: { fillColor: SUB_FILL } },
                    { content: totalSubStr, styles: { ...subS, halign: 'right' } },
                ]);
            } else {
                totalCalculado += total;
                filas.push([
                    { content: cap, styles: { halign: 'center' } },
                    desc,
                    { content: cant.toLocaleString('es-ES', { maximumFractionDigits: 2 }), styles: { halign: 'center' } },
                    { content: unidad, styles: { halign: 'center' } },
                    { content: precio.toLocaleString('es-ES', { minimumFractionDigits: 2 }) + ' €', styles: { halign: 'right', fontStyle: precio > 0 ? 'normal' : 'italic', textColor: precio > 0 ? GRIS_TEXTO : GRIS_MUTED } },
                    { content: total.toLocaleString('es-ES', { minimumFractionDigits: 2 }) + ' €', styles: { halign: 'right', fontStyle: 'bold', textColor: total > 0 ? AZUL : GRIS_MUTED } },
                ]);
                // Comentario del jefe de obra: fila-nota que ocupa todo el ancho
                const comentario = (p.comentario || '').trim();
                if (comentario) {
                    filas.push([
                        { content: 'Comentario: ' + comentario, colSpan: 6, styles: { fontStyle: 'italic', fontSize: 8, textColor: GRIS_MUTED, fillColor: [248, 250, 252] } },
                    ]);
                }
            }
        } else {
            // ── MODO CAPS/SUBCAPS: 2 columnas (Descripción | Total) ──
            const totalStr = totalCap.toLocaleString('es-ES', { minimumFractionDigits: 2 }) + ' €';
            if (tipo === 'capitulo') {
                filas.push([
                    { content: desc, styles: { fontStyle: 'bold', fillColor: CAP_FILL, textColor: AZUL, fontSize: 9 } },
                    { content: totalStr, styles: { fontStyle: 'bold', fillColor: CAP_FILL, textColor: AZUL, halign: 'right', whiteSpace: 'nowrap' } },
                ]);
            } else if (tipo === 'subcapitulo') {
                filas.push([
                    { content: '    ' + desc, styles: { fontStyle: 'bolditalic', fillColor: SUB_FILL, textColor: SUB_TEXT } },
                    { content: totalStr, styles: { fontStyle: 'bolditalic', fillColor: SUB_FILL, textColor: SUB_TEXT, halign: 'right', whiteSpace: 'nowrap' } },
                ]);
            }
        }
    });

    if (esModoDesglose) {
        autoTable(doc, {
            startY: 75,
            head: [['Cap.', 'Descripción', 'Cant.', 'Ud.', 'Precio/ud (€)', 'Total (€)']],
            body: filas,
            theme: 'plain',
            headStyles: { fillColor: AZUL, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 9, cellPadding: 4 },
            bodyStyles: { fontSize: 8.5, cellPadding: 3, lineWidth: 0.1, lineColor: [220, 224, 235] },
            alternateRowStyles: { fillColor: GRIS_FILA },
            columnStyles: {
                0: { cellWidth: 14, halign: 'center' },
                2: { cellWidth: 16, halign: 'center' },
                3: { cellWidth: 12, halign: 'center' },
                4: { cellWidth: 28, halign: 'right' },
                5: { cellWidth: 28, halign: 'right' },
            },
            margin: { left: 14, right: 14 },
        });
    } else {
        autoTable(doc, {
            startY: 75,
            head: [['Capítulo / Descripción', 'Total (€)']],
            body: filas,
            theme: 'plain',
            headStyles: { fillColor: AZUL, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 9, cellPadding: 4 },
            bodyStyles: { fontSize: 9, cellPadding: 4, lineWidth: 0.1, lineColor: [220, 224, 235] },
            columnStyles: {
                0: { cellWidth: 'auto' },
                1: { cellWidth: 38, halign: 'right' },
            },
            margin: { left: 14, right: 14 },
        });
    }

    // ── 4. TOTAL ───────────────────────────────────────────────────────────────
    const tableEnd = (doc.lastAutoTable?.finalY || 80) + 8;
    const totalFinal = totalCalculado > 0 ? totalCalculado : parseFloat(precio_total || 0);
    const totalStr = totalFinal.toLocaleString('es-ES', { minimumFractionDigits: 2 }) + ' €';

    doc.setFillColor(...AZUL_LIGHT);
    doc.roundedRect(W - 90, tableEnd - 2, 76, 18, 3, 3, 'F');
    doc.setDrawColor(...AZUL);
    doc.setLineWidth(0.5);
    doc.roundedRect(W - 90, tableEnd - 2, 76, 18, 3, 3, 'S');

    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...AZUL);
    doc.text('TOTAL PRESUPUESTO', W - 87, tableEnd + 5);

    doc.setFontSize(14);
    doc.text(totalStr, W - 16, tableEnd + 13, { align: 'right' });

    // ── 5. SECCIÓN DE FIRMA (solo si existe) ───────────────────────────────────
    let nextY = tableEnd + 28;

    if (firma_base64) {
        const fechaFirmaStr = (() => {
            try { return new Date(fecha_firma).toLocaleString('es-ES'); }
            catch (_) { return ''; }
        })();

        // Marco firma
        doc.setFillColor(240, 253, 244);
        doc.roundedRect(14, nextY, W - 28, 55, 4, 4, 'F');
        doc.setDrawColor(...VERDE);
        doc.setLineWidth(0.6);
        doc.roundedRect(14, nextY, W - 28, 55, 4, 4, 'S');

        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...VERDE);
        doc.text('✓  FIRMADO DIGITALMENTE POR EL CLIENTE', 20, nextY + 8);

        // Imagen de firma
        try {
            doc.addImage(firma_base64, 'PNG', 18, nextY + 12, 80, 30);
        } catch (_) {}

        // Texto de certificación
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(...GRIS_MUTED);
        doc.text('Firmado por: ' + cliente, 110, nextY + 18);
        doc.text('Fecha: ' + fechaFirmaStr, 110, nextY + 25);
        doc.text('Ref: ' + (token || propuesta_id).substring(0, 8).toUpperCase(), 110, nextY + 32);
        doc.text('Firma electrónica con valor legal equivalente a firma manuscrita.', 110, nextY + 39);

        nextY += 62;
    }

    // ── 6. CLÁUSULA LEGAL ──────────────────────────────────────────────────────
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(...GRIS_MUTED);
    const clausula = 'Este presupuesto tiene una validez de 30 días desde su fecha de emisión. ' +
        'Los precios incluyen materiales y mano de obra salvo indicación contraria. ' +
        'ADIR Reformas — CIF/NIF disponible bajo solicitud.';
    const clausulaLines = doc.splitTextToSize(clausula, W - 28);
    doc.text(clausulaLines, 14, nextY);

    // ── 7. PIE DE PÁGINA ───────────────────────────────────────────────────────
    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setDrawColor(200, 210, 230);
        doc.setLineWidth(0.3);
        doc.line(14, 285, W - 14, 285);
        doc.setFontSize(7);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...GRIS_MUTED);
        doc.text('ADIR REFORMAS  —  adirbc3@gmail.com', 14, 290);
        doc.text(`Pág. ${i} / ${pageCount}`, W - 14, 290, { align: 'right' });
    }

    return doc;
}

/**
 * Genera un PDF con la oferta recibida de un proveedor (precios + observaciones).
 * Usado por: Comparativa → botón PDF por proveedor.
 *
 * @param {Object} data
 * @param {string}  data.proveedorNombre       - Nombre del proveedor
 * @param {string}  [data.proveedorEmail]      - Email del proveedor
 * @param {string}  data.proyectoNombre        - ID / nombre del proyecto
 * @param {string}  data.oficio                - Proveedores solicitado
 * @param {string}  [data.fecha]               - Fecha de respuesta (ISO)
 * @param {Array}   data.partidas              - [{descripcion, unidad, cantidad, precioOfertado, comentario}]
 * @param {string}  [data.comentariosGenerales] - Anotaciones generales del proveedor
 * @returns {jsPDF}
 */
export function generarPDFOfertaProveedor(data) {
    const {
        proveedorNombre     = 'Proveedor',
        proveedorEmail      = '',
        proyectoNombre      = '',
        oficio              = '',
        fecha               = new Date().toISOString(),
        partidas            = [],
        comentariosGenerales = '',
    } = data;

    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const W = 210;

    // ── 1. CABECERA ────────────────────────────────────────────────────────────
    doc.setFillColor(...AZUL);
    doc.rect(0, 0, W, 38, 'F');

    try { doc.addImage(logoBase64, 'PNG', 8, 6, 48, 24); } catch (_) {}

    doc.setFontSize(18);
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.text('ADIR REFORMAS', 62, 17);

    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text('OFERTA RECIBIDA — ' + oficio.toUpperCase(), 62, 26);

    // Badge Proveedores
    doc.setFillColor(255, 255, 255);
    doc.setGState(doc.GState({ opacity: 0.15 }));
    doc.roundedRect(W - 56, 8, 50, 20, 3, 3, 'F');
    doc.setGState(doc.GState({ opacity: 1 }));
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(255, 255, 255);
    doc.text(oficio.substring(0, 20).toUpperCase(), W - 53, 20);

    // ── 2. DATOS PROVEEDOR / PROYECTO ─────────────────────────────────────────
    const fechaFormateada = (() => {
        try { return new Date(fecha).toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' }); }
        catch (_) { return fecha; }
    })();

    doc.setFillColor(...AZUL_LIGHT);
    doc.rect(0, 38, W, 32, 'F');

    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...AZUL);
    doc.text('PROVEEDOR', 14, 47);
    doc.text('PROYECTO', 90, 47);
    doc.text('FECHA RESPUESTA', 155, 47);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...GRIS_TEXTO);
    doc.setFontSize(10);
    doc.text(proveedorNombre.substring(0, 35), 14, 55);
    doc.text(proyectoNombre.substring(0, 30), 90, 55);
    doc.text(fechaFormateada, 155, 55);

    if (proveedorEmail) {
        doc.setFontSize(8);
        doc.setTextColor(...GRIS_MUTED);
        doc.text(proveedorEmail.substring(0, 40), 14, 62);
    }

    // ── 3. TABLA DE PARTIDAS ───────────────────────────────────────────────────
    const VERDE_CELL = [209, 250, 229];
    // precioOfertado es precio/ud (lo que introdujo el proveedor por unidad)
    const total = partidas.reduce((s, p) => s + (Number(p.precioOfertado) || 0) * (Number(p.cantidad) || 1), 0);

    const filas = partidas.map(p => {
        const precioUd = Number(p.precioOfertado) || 0;
        const cantidad = Number(p.cantidad) || 1;
        const totalLinea = precioUd * cantidad;
        return [
            { content: cleanDesc(p.descripcion), styles: { textColor: GRIS_TEXTO } },
            { content: (p.unidad || 'ud'), styles: { halign: 'center' } },
            { content: cantidad.toLocaleString('es-ES', { maximumFractionDigits: 2 }), styles: { halign: 'center' } },
            { content: precioUd.toLocaleString('es-ES', { minimumFractionDigits: 2 }) + ' €', styles: { halign: 'right' } },
            { content: totalLinea.toLocaleString('es-ES', { minimumFractionDigits: 2 }) + ' €', styles: { halign: 'right', fontStyle: 'bold', textColor: [5, 150, 105] } },
            { content: p.comentario || '', styles: { textColor: GRIS_MUTED, fontSize: 7.5 } },
        ];
    });

    autoTable(doc, {
        startY: 76,
        head: [['Descripción', 'Ud.', 'Cant.', 'P. Unit.', 'P. Total', 'Observaciones']],
        body: filas,
        theme: 'plain',
        headStyles: {
            fillColor: AZUL,
            textColor: [255, 255, 255],
            fontStyle: 'bold',
            fontSize: 8,
            cellPadding: 3,
        },
        bodyStyles: {
            fontSize: 8,
            cellPadding: 3,
            lineWidth: 0.1,
            lineColor: [220, 224, 235],
        },
        alternateRowStyles: { fillColor: GRIS_FILA },
        columnStyles: {
            0: { cellWidth: 'auto' },
            1: { cellWidth: 14, halign: 'center' },
            2: { cellWidth: 14, halign: 'center' },
            3: { cellWidth: 26, halign: 'right' },
            4: { cellWidth: 26, halign: 'right' },
            5: { cellWidth: 36 },
        },
        margin: { left: 14, right: 14 },
    });

    // ── 4. TOTAL ───────────────────────────────────────────────────────────────
    const tableEnd = (doc.lastAutoTable?.finalY || 80) + 8;
    const totalStr = total.toLocaleString('es-ES', { minimumFractionDigits: 2 }) + ' €';

    doc.setFillColor(...AZUL_LIGHT);
    doc.roundedRect(W - 90, tableEnd - 2, 76, 18, 3, 3, 'F');
    doc.setDrawColor(...AZUL);
    doc.setLineWidth(0.5);
    doc.roundedRect(W - 90, tableEnd - 2, 76, 18, 3, 3, 'S');
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...AZUL);
    doc.text('TOTAL OFERTA', W - 87, tableEnd + 5);
    doc.setFontSize(14);
    doc.text(totalStr, W - 16, tableEnd + 13, { align: 'right' });

    // ── 5. ANOTACIONES GENERALES ───────────────────────────────────────────────
    let nextY = tableEnd + 28;

    if (comentariosGenerales && comentariosGenerales.trim()) {
        const lineas = doc.splitTextToSize(comentariosGenerales, W - 40);
        const boxHeight = 12 + lineas.length * 5;

        // Si no cabe en la página actual (altura máxima utilizable aprox 270mm), saltamos de página
        if (nextY + boxHeight > 270) {
            doc.addPage();
            nextY = 25; // Empezar arriba en la nueva página
        }

        // Título de la sección
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...AZUL);
        doc.text('ANOTACIONES GENERALES', 14, nextY);
        
        // Línea decorativa
        doc.setDrawColor(...AZUL_LIGHT);
        doc.setLineWidth(0.3);
        doc.line(14, nextY + 2, W - 14, nextY + 2);
        
        nextY += 8;

        // Caja de comentarios (diseño de tarjeta limpia)
        doc.setFillColor(248, 250, 252); // Fondo gris muy claro suave
        doc.setDrawColor(226, 232, 240); // Borde gris claro
        doc.setLineWidth(0.4);
        doc.roundedRect(14, nextY, W - 28, boxHeight, 3, 3, 'FD');

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.5);
        doc.setTextColor(...GRIS_TEXTO);
        doc.text(lineas, 20, nextY + 7);
        
        nextY += boxHeight + 10;
    }

    // ── 6. PIE DE PÁGINA ───────────────────────────────────────────────────────
    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setDrawColor(200, 210, 230);
        doc.setLineWidth(0.3);
        doc.line(14, 285, W - 14, 285);
        doc.setFontSize(7);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...GRIS_MUTED);
        doc.text('ADIR REFORMAS  —  Oferta recibida de: ' + proveedorNombre, 14, 290);
        doc.text(`Pág. ${i} / ${pageCount}`, W - 14, 290, { align: 'right' });
    }

    return doc;
}

/**
 * Descarga un documento jsPDF con nombre correcto y extensión .pdf.
 * Usa dataURIstring + <a download> para máxima compatibilidad.
 * @param {jsPDF} doc
 * @param {string} filename - sin extensión (se añade .pdf automáticamente)
 */
export function descargarPDF(doc, filename) {
    const safeName = (filename || 'documento').replace(/[^a-zA-Z0-9_\-. ]/g, '_');
    const finalName = safeName.endsWith('.pdf') ? safeName : safeName + '.pdf';

    // Método 1: dataURIstring (más fiable para el nombre del fichero)
    // Helper para retirar el <a> de forma segura aunque el componente se haya desmontado.
    const safeRemove = (el) => { try { el && el.remove && el.remove(); } catch (_) {} };

    try {
        const dataUri = doc.output('datauristring');
        const link = document.createElement('a');
        link.href = dataUri;
        link.download = finalName;
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        setTimeout(() => safeRemove(link), 200);
        return;
    } catch (_) {}

    // Método 2: Blob + createObjectURL
    try {
        const blob = doc.output('blob');
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = finalName;
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        safeRemove(link);
        setTimeout(() => URL.revokeObjectURL(url), 3000);
        return;
    } catch (_) {}

    // Fallback
    doc.save(finalName);
}
