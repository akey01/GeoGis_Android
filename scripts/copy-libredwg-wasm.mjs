import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const PKG_DIR = path.join(ROOT, 'node_modules', '@mlightcad', 'libredwg-web');
const TARGET_DIR = path.join(ROOT, 'public', 'wasm');
const TARGET_FILE = path.join(TARGET_DIR, 'libredwg-web.wasm');

function findWasmFile(dir, depth = 0) {
  if (!fs.existsSync(dir) || depth > 4) return null;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.wasm')) {
      return path.join(dir, entry.name);
    }
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const found = findWasmFile(path.join(dir, entry.name), depth + 1);
      if (found) return found;
    }
  }
  return null;
}

if (!fs.existsSync(PKG_DIR)) {
  console.warn('[copy-libredwg-wasm] @mlightcad/libredwg-web no instalado aún; omitiendo copia.');
  process.exit(0);
}

const candidates = [
  path.join(PKG_DIR, 'wasm', 'libredwg-web.wasm'),
  path.join(PKG_DIR, 'dist', 'libredwg-web.wasm'),
  path.join(PKG_DIR, 'libredwg-web.wasm'),
];

const sourceFile = candidates.find((p) => fs.existsSync(p)) || findWasmFile(PKG_DIR);

if (!sourceFile) {
  console.warn('[copy-libredwg-wasm] No se encontró archivo .wasm dentro de @mlightcad/libredwg-web.');
  process.exit(0);
}

fs.mkdirSync(TARGET_DIR, { recursive: true });
fs.copyFileSync(sourceFile, TARGET_FILE);
const sizeKb = (fs.statSync(TARGET_FILE).size / 1024).toFixed(1);
console.log(`[copy-libredwg-wasm] Copiado ${path.relative(ROOT, sourceFile)} -> public/wasm/libredwg-web.wasm (${sizeKb} KB)`);
