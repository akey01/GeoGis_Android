import { NextResponse } from 'next/server';
import db from '@/lib/db';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-device-id',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET() {
  let database = 'disconnected';
  let dbError: string | undefined;

  try {
    await db.query('SELECT 1');
    database = 'connected';
  } catch (err: any) {
    dbError = err?.message || 'Database connection error';
  }

  return NextResponse.json(
    {
      status: database === 'connected' ? 'ok' : 'degraded',
      database,
      ...(dbError ? { dbError } : {}),
      timestamp: new Date().toISOString(),
      version: '6.0.0',
    },
    { status: 200, headers: CORS_HEADERS }
  );
}
