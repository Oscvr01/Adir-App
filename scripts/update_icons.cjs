const fs = require('fs');
const path = require('path');

const files = {
    'Ajustes.jsx': 'Settings',
    'BandejaEntrada.jsx': 'Mailbox',
    'BasePrecios.jsx': 'Database',
    'Borradores.jsx': 'Files',
    'Comparativa.jsx': 'BarChart2',
    'Dashboard.jsx': 'LayoutDashboard',
    'Historial.jsx': 'History',
    'JefesObra.jsx': 'HardHat',
    'PresupuestosFirmados.jsx': 'FileSignature',
    'Proveedores.jsx': 'Users',
    'Proyectos.jsx': 'Files',
    'Portal.jsx': 'Globe'
};

const dir = './src/pages';

for (let f in files) {
    let p = path.join(dir, f);
    if (!fs.existsSync(p)) continue;
    
    let icon = files[f];
    let content = fs.readFileSync(p, 'utf8');
    
    // Add import if missing
    if (!content.includes(icon) && content.includes('lucide-react')) {
        content = content.replace(/import \{([^}]+)\} from 'lucide-react'/, (match, p1) => `import { ${p1}, ${icon} } from 'lucide-react'`);
    } else if (!content.includes('lucide-react')) {
        content = `import { ${icon} } from 'lucide-react';\n` + content;
    }
    
    // Replace h1 tag
    if (f === 'Borradores.jsx') {
        content = content.replace(/<h1(.*?)>(Borradores)<\/h1>/, `<h1$1 style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '6px' }}><${icon} size={32} color="var(--primary)" /> $2</h1>`);
    } else if (content.match(/<h1(.*?)>/) && !content.includes(`<${icon} size={32}`)) {
        content = content.replace(/<h1(.*?)>/, `<h1$1 style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '6px' }}><${icon} size={32} color="var(--primary)" /> `);
    }

    fs.writeFileSync(p, content);
}
