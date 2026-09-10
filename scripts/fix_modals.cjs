const fs = require('fs');
const path = require('path');

const dir = './src/pages';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.jsx'));

for (let f of files) {
    let p = path.join(dir, f);
    let c = fs.readFileSync(p, 'utf8');
    
    // Fix modal backgrounds from var(--bg-primary) or transparent to 'white'
    c = c.replace(/background:\s*'var\(--bg-primary\)'/g, "background: 'white'");
    c = c.replace(/backgroundColor:\s*'var\(--bg-primary\)'/g, "backgroundColor: 'white'");

    // For BasePrecios explicitly fixing the boxStyle
    if (f === 'BasePrecios.jsx') {
        c = c.replace(/const boxStyle = \{\s*background:\s*'var\(--bg-primary\)'/, "const boxStyle = {\n    background: 'white'");
    }

    // Fix Comparativa header
    if (f === 'Comparativa.jsx') {
        c = c.replace(/<div style=\{s\.header\}>\s*<div style=\{\{ flex: 1 \}\}>/g, '<div className="glass-card" style={{ marginBottom: \'20px\' }}>\n        <div style={s.header}>\n          <div style={{ flex: 1 }}>');
        // Close the glass-card div after the header div ends
        c = c.replace(/<button onClick=\{exportarExcel\} style=\{s\.btnExport\}>\s*<Download size=\{16\} \/> Exportar Excel\s*<\/button>\s*\)\}\s*<\/div>/g, '<button onClick={exportarExcel} style={s.btnExport}>\n            <Download size={16} /> Exportar Excel\n          </button>\n        )}\n        </div>\n      </div>');
    }
    
    fs.writeFileSync(p, c);
}
