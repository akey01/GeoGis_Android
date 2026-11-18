import fs from 'fs';
import path from 'path';

/**
 * La marca de agua en la capa 'DEMO_WATERMARK_GEOTRANSFORMER' se genera ahora de forma
 * nativa dentro de render.py mediante ezdxf (con handles hexadecimales válidos y registro
 * en la tabla LAYER de AutoCAD R2010/AC1024), evitando corromper la sección OBJECTS del DXF.
 * Se mantiene esta función como no-op seguro por compatibilidad.
 */
export function injectDemoWatermarkIntoDxfFile(_dxfFilePath: string, _points: any[]): void {
  // No-op: handled natively by ezdxf in src/engines/geodesy/exporters/render.py
}

export function cleanupOutputsDirAsync(dir: string, maxAgeMs = 7_200_000) {
  setTimeout(async () => {
    try {
      if (!fs.existsSync(/*turbopackIgnore: true*/ dir)) return;
      const files = await fs.promises.readdir(/*turbopackIgnore: true*/ dir);
      const now = Date.now();
      for (const file of files) {
        if (file === '.gitkeep') continue;
        const fp = path.join(/*turbopackIgnore: true*/ dir, file);
        try {
          const stat = await fs.promises.stat(/*turbopackIgnore: true*/ fp);
          if (now - stat.mtimeMs > maxAgeMs) {
            await fs.promises.unlink(/*turbopackIgnore: true*/ fp);
          }
        } catch {
          /* ignore individual file error */
        }
      }
    } catch {
      /* ignore cleanup error */
    }
  }, 100);
}

