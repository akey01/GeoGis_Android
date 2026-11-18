import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSession, invalidateSessionCache } from '@/lib/session';
import { markSessionTokenLoggedOut, releaseUserDeviceSession } from '@/src/middleware/authGuard';
import { normalizeUserRole } from '@/src/types/auth';

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('mode'); // 'disconnect_only' (en pagehide/beforeunload) o logout completo
  const queryDeviceId = searchParams.get('deviceId')?.trim() || '';
  const queryUserId = searchParams.get('userId')?.trim() || '';

  let body: any = {};
  try {
    const rawText = await request.text();
    if (rawText && rawText.trim().startsWith('{')) {
      body = JSON.parse(rawText);
    }
  } catch {
    body = {};
  }

  const cookieStore = await cookies().catch(() => null);
  const sessionToken = cookieStore?.get('session')?.value || null;
  const cookieDeviceId = cookieStore?.get('gt_device_id')?.value
    ? decodeURIComponent(cookieStore.get('gt_device_id')!.value).trim()
    : '';

  const session = await getSession().catch(() => null);
  const headerDeviceId = request.headers.get('x-device-id')?.trim() || '';
  const deviceId =
    queryDeviceId ||
    headerDeviceId ||
    (typeof body?.deviceId === 'string' ? body.deviceId.trim() : '') ||
    cookieDeviceId;
  const userId =
    session?.userId ||
    queryUserId ||
    (typeof body?.userId === 'string' ? body.userId.trim() : '');

  const isAdmin = normalizeUserRole(session?.role) === 'admin';

  // En disconnect_only sin userId no desactivamos a ciegas todo el device_id si no hay sesión ni userId
  if (mode === 'disconnect_only' && !userId) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  await releaseUserDeviceSession({
    userId: userId || null,
    deviceId: deviceId || null,
    releaseAllForUser: !isAdmin,
  });

  if (mode === 'disconnect_only') {
    return NextResponse.json({ ok: true, disconnected: true });
  }

  if (sessionToken) {
    markSessionTokenLoggedOut(sessionToken);
  }

  if (userId) {
    invalidateSessionCache(userId);
  }

  const response = NextResponse.json({ ok: true, loggedOut: true });
  response.cookies.delete('session');
  return response;
}
