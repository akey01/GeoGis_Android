import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const filename = searchParams.get('file');
    const isInline = searchParams.get('inline') === 'true';

    if (!filename) {
      return NextResponse.json({ error: 'Falta el nombre del archivo' }, { status: 400 });
    }

    const sanitizedFilename = path.basename(path.normalize(filename));
    if (!sanitizedFilename || sanitizedFilename === '.' || sanitizedFilename.includes('/') || sanitizedFilename.includes('\\')) {
      return NextResponse.json({ error: 'Nombre de archivo inválido' }, { status: 400 });
    }

    // Directorios candidatos donde pueden residir los archivos generados
    const candidateDirs = [
      path.resolve(process.cwd(), 'outputs'),
      path.resolve('/tmp', 'outputs'),
      path.resolve(process.env.TEMP || process.env.TMP || '/tmp', 'outputs')
    ];

    let filePath: string | null = null;
    for (const dir of candidateDirs) {
      const candidate = path.resolve(/*turbopackIgnore: true*/ dir, sanitizedFilename);
      if (fs.existsSync(/*turbopackIgnore: true*/ candidate)) {
        filePath = candidate;
        break;
      }
    }

    // Fallback: si no se encontró con el nombre exacto, usar la ruta estándar para el chequeo
    const defaultOutputsDir = (process.env.NODE_ENV === 'production' && process.platform !== 'win32')
      ? path.join('/tmp', 'outputs')
      : path.resolve(process.cwd(), 'outputs');
    const targetPath = filePath || path.resolve(defaultOutputsDir, sanitizedFilename);

    // Verificar sesión (opcional para archivos temporales de outputs si es descarga local directa)
    const session = await getSession();
    if (!session && !filePath) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }

    if (filePath && fs.existsSync(/*turbopackIgnore: true*/ filePath)) {
      const stat = await fs.promises.stat(/*turbopackIgnore: true*/ filePath);
      const etag = `"${stat.size}-${stat.mtimeMs}"`;
      if (request.headers.get('if-none-match') === etag) {
        return new NextResponse(null, { status: 304 });
      }

      console.log(`[API Download] Sirviendo archivo local: ${sanitizedFilename} (${stat.size} bytes)`);
      const fileBuffer = await fs.promises.readFile(/*turbopackIgnore: true*/ filePath);
      
      let contentType = 'application/octet-stream';
      if (sanitizedFilename.endsWith('.svg')) {
        contentType = 'image/svg+xml';
      } else if (sanitizedFilename.endsWith('.dxf')) {
        contentType = 'application/dxf';
      } else if (sanitizedFilename.endsWith('.zip')) {
        contentType = 'application/zip';
      } else if (sanitizedFilename.endsWith('.png')) {
        contentType = 'image/png';
      } else if (sanitizedFilename.endsWith('.jpg') || sanitizedFilename.endsWith('.jpeg')) {
        contentType = 'image/jpeg';
      }

      const contentDisposition = sanitizedFilename.endsWith('.svg') || isInline
        ? `inline; filename="${sanitizedFilename}"`
        : `attachment; filename="${sanitizedFilename}"`;

      return new NextResponse(fileBuffer, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Content-Disposition': contentDisposition,
          'Cache-Control': isInline ? 'no-store' : 'private, max-age=3600',
          'ETag': etag,
        },
      });
    }

    // 2. Fallback: Intentar descargar el archivo desde el Microservicio CAD (producción/Docker)
    // CAD_LAYOUT_SERVICE_URL puede incluir /render al final — hay que quitarlo
    const cadLayoutServiceUrl = process.env.CAD_LAYOUT_SERVICE_URL || 'http://localhost:5003';
    const baseUrl = cadLayoutServiceUrl.replace(/\/render\/?$/, '').replace(/\/$/, '');
    const downloadUrl = `${baseUrl}/download?file=${encodeURIComponent(sanitizedFilename)}`;

    try {
      console.log(`[API Download] Intentando proxying desde microservicio CAD: ${downloadUrl}`);
      const response = await fetch(downloadUrl);
      if (response.ok) {
        const fileBuffer = Buffer.from(await response.arrayBuffer());
        const contentType = response.headers.get('content-type') || 'application/octet-stream';

        return new NextResponse(fileBuffer, {
          status: 200,
          headers: {
            'Content-Type': contentType,
            'Content-Disposition': `${isInline ? 'inline' : 'attachment'}; filename="${sanitizedFilename}"`,
            'Cache-Control': isInline ? 'no-store' : 'public, max-age=3600'
          },
        });
      }
      console.log(`[API Download] Microservicio CAD respondió con estado: ${response.status}`);
    } catch (fetchErr: any) {
      console.warn(`[API Download] Falló conexión con microservicio CAD: ${fetchErr.message}`);
    }

    return NextResponse.json({ error: 'Archivo no encontrado' }, { status: 404 });
  } catch (error: any) {
    console.error('Download error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
