const fs = require('fs');
const path = require('path');

function searchDir(dir, pattern) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      if (file !== 'node_modules' && file !== '.git' && file !== 'dist') {
        searchDir(fullPath, pattern);
      }
    } else if (file.endsWith('.js') || file.endsWith('.jsx')) {
      const content = fs.readFileSync(fullPath, 'utf8');
      if (content.includes(pattern)) {
        console.log(`Match in ${fullPath}`);
      }
    }
  }
}

const searchPattern = process.argv[2] || 'presupuestos_cliente';
console.log(`Searching for "${searchPattern}" in src/ ...`);
searchDir(path.join(__dirname, 'src'), searchPattern);
