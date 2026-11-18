import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { runPythonScript } from '@/src/lib/python-bridge';

interface ExportPayload {
  parcelName: string;
  puntos: { result?: { este?: number; norte?: number }; id?: string }[];
  metadata?: any;
  source_crs?: string;
  geometryType?: string;
}

export async function POST(req: NextRequest) {
  try {
    console.log('[API KML] Received request for KML export');
    const payload: ExportPayload = await req.json();
    console.log(`[API KML] Exporting parcel: ${payload.parcelName}`);
    
    const scriptPath = path.join(process.cwd(), 'src/engines/geodesy/exporters/export_kml.py');
    const tempId = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const tempKmzPath = path.join(os.tmpdir(), `temp_${tempId}.kmz`);

    const pythonPayload = {
      payload: {
        puntos: payload.puntos,
        metadata: {
          ...payload.metadata,
          geometryType: payload.geometryType || payload.metadata?.geometryType || 'cerrada',
        },
        source_crs: payload.source_crs || payload.metadata?.source_crs, 
      },
      output_path: tempKmzPath,
    };

    console.log('[API KML] Running python script...');
    const result = await runPythonScript(scriptPath, pythonPayload);

    if (result.status === 'error') {
      console.error('[API KML] Python script failed:', result.message);
      return NextResponse.json({
        status: 'error',
        message: result.message,
        traceback: result.traceback,
      }, { status: 500 });
    }

    console.log(`[API KML] Python script success. Reading file: ${tempKmzPath}`);
    const stats = await fs.stat(tempKmzPath);
    const kmzBuffer = await fs.readFile(tempKmzPath);

    // Cleanup
    await fs.unlink(tempKmzPath).catch(e => console.error(`Cleanup KML error: ${e}`));

    console.log('[API KML] Sending KMZ response');
    return new NextResponse(kmzBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.google-earth.kmz',
        'Content-Disposition': `attachment; filename="${payload.parcelName || 'Parcela'}.kmz"`,
        'Content-Length': stats.size.toString(),
      },
    });

  } catch (error: any) {
    console.error('[API KML] Export failed critical error:', error);
    return NextResponse.json({
      status: 'error',
      message: error instanceof Error ? error.message : 'Internal Server Error',
    }, { status: 500 });
  }
}
