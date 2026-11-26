import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const PKG_DIR = path.join(ROOT, 'node_modules', '@mlightcad', 'libredwg-web');
const TARGET_DIR = path.join(ROOT, 'public', 'wasm');

function copyDirFiltered(srcDir, dstDir, allowedExts) {
  if (!fs.existsSync(srcDir)) return 0;
  let copied = 0;
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const dstPath = path.join(dstDir, entry.name);
    if (entry.isDirectory()) {
      copied += copyDirFiltered(srcPath, dstPath, allowedExts);
      continue;
    }
    if (!entry.isFile()) continue;
    const lower = entry.name.toLowerCase();
    if (lower.endsWith('.d.ts') || lower.endsWith('.map')) continue;
    if (!allowedExts.some((ext) => lower.endsWith(ext))) continue;
    fs.mkdirSync(path.dirname(dstPath), { recursive: true });
    fs.copyFileSync(srcPath, dstPath);
    copied++;
  }
  return copied;
}

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

const distCopied = copyDirFiltered(path.join(PKG_DIR, 'dist'), path.join(TARGET_DIR, 'dist'), ['.js', '.mjs']);
const wasmCopied = copyDirFiltered(path.join(PKG_DIR, 'wasm'), path.join(TARGET_DIR, 'wasm'), ['.js', '.mjs', '.wasm']);

const fallbackWasm =
  [
    path.join(PKG_DIR, 'wasm', 'libredwg-web.wasm'),
    path.join(PKG_DIR, 'dist', 'libredwg-web.wasm'),
    path.join(PKG_DIR, 'libredwg-web.wasm'),
  ].find((p) => fs.existsSync(p)) || findWasmFile(PKG_DIR);

if (fallbackWasm) {
  fs.mkdirSync(TARGET_DIR, { recursive: true });
  fs.copyFileSync(fallbackWasm, path.join(TARGET_DIR, 'libredwg-web.wasm'));
}

console.log(
  `[copy-libredwg-wasm] Copiados dist=${distCopied}, wasm=${wasmCopied}${fallbackWasm ? ' + libredwg-web.wasm' : ''} -> public/wasm/`
);
