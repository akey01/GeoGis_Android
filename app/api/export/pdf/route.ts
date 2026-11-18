import { NextResponse } from 'next/server';
import { enforceAuthAndDeviceGuard } from '@/src/middleware/authGuard';
import { isDemoRole } from '@/src/types/auth';

export const dynamic = 'force-dynamic';

/**
 * POST /api/export/pdf
 * Exportación de planos PDF y fichas catastrales.
 * Estrictamente bloqueada para el rol 'demo' y 'operador_campo'.
 */
export async function POST(request: Request) {
  const guard = await enforceAuthAndDeviceGuard(request, {
    requiredCapability: 'export_pdf',
    endpoint: '/api/export/pdf',
  });

  if (!guard.ok) {
    return guard.response;
  }

  if (isDemoRole(guard.canonicalRole)) {
    return NextResponse.json(
      {
        error: 'La descarga de PDF, memorias descriptivas y fichas catastrales está estrictamente bloqueada en Modo Demo.',
        code: 'DEMO_PDF_BLOCKED',
      },
      { status: 403 },
    );
  }

  try {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json({
      ok: true,
      role: guard.canonicalRole,
      authorized: true,
      timestamp: new Date().toISOString(),
      projectName: body?.projectName || 'Plano Catastral',
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Error procesando exportación PDF' },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  const guard = await enforceAuthAndDeviceGuard(request, {
    requiredCapability: 'export_pdf',
    endpoint: '/api/export/pdf',
  });

  if (!guard.ok) {
    return guard.response;
  }

  return NextResponse.json({
    ok: true,
    role: guard.canonicalRole,
    authorized: true,
  });
}

