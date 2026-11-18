import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';

const GEOMETRY_SERVICE_URL = process.env.GEOMETRY_SERVICE_URL ?? '';


export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }

    const body = await request.json();
    
    const response = await fetch(GEOMETRY_SERVICE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    
    if (!response.ok) {
      const err = await response.text();
      return NextResponse.json({ error: `Geometry service error: ${err}` }, { status: response.status });
    }
    
    const data = await response.json();
    return NextResponse.json(data);
  } catch (error: any) {
    console.error('Geometry API error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
export const runtime = 'nodejs';
