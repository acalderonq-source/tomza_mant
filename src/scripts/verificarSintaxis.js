const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
function revisar(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) revisar(file);
    else if (entry.name.endsWith('.js')) {
      const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', windowsHide: true });
      if (result.status !== 0) { console.error(result.stderr || file); process.exitCode = 1; }
    }
  }
}
revisar(path.resolve(__dirname, '..'));
revisar(path.resolve(__dirname, '../../public/js'));
if (!process.exitCode) console.log('Sintaxis JavaScript verificada.');
