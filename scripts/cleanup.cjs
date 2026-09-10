const fs = require('fs');
const dir = './src/pages';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.jsx'));

for (let f of files) {
    let p = dir + '/' + f;
    let c = fs.readFileSync(p, 'utf8');
    
    // Remove the img tag
    c = c.replace(/\s*<img src=\{logoAdir\} alt="ADIR" style=\{\{ height: 40, objectFit: 'contain' \}\} \/>\r?\n?/g, '');
    
    // Remove the import
    c = c.replace(/import logoAdir from '\.\.\/assets\/adir_logo\.png';\r?\n?/g, '');
    
    // Fix duplicate style tags
    c = c.replace(/<h1 style=\{\{[^}]+\}\} style=\{\{([^}]+)\}\}>/g, '<h1 style={{$1}}>');
    c = c.replace(/<h1 style=\{s\.title\} style=\{\{([^}]+)\}\}>/g, '<h1 style={{ ...s.title, $1 }}>');
    
    fs.writeFileSync(p, c);
}
