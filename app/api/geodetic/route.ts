import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { runPythonScript } from '@/src/lib/python-bridge';
import path from 'path';

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }

    const body = await request.json();
    const scriptPath = path.join(process.cwd(), 'src/engines/geodesy/transform/transform_v2.py');
    
    const result = await runPythonScript(scriptPath, body);

    if (result.status === 'error') {
      return NextResponse.json({ error: `Geodetic engine error: ${result.message}` }, { status: 500 });
    }

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('Geodetic API error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
