'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getSession, invalidateSessionCache } from '@/lib/session';
import { releaseUserDeviceSession } from '@/src/middleware/authGuard';
import { normalizeUserRole } from '@/src/types/auth';

export async function logoutUser() {
  const cookieStore = await cookies();
  const session = await getSession().catch(() => null);
  const rawDeviceCookie = cookieStore.get('gt_device_id')?.value;
  const deviceId = rawDeviceCookie ? decodeURIComponent(rawDeviceCookie).trim() : '';
  const isAdmin = normalizeUserRole(session?.role) === 'admin';

  await releaseUserDeviceSession({
    userId: session?.userId || null,
    deviceId: deviceId || null,
    releaseAllForUser: !isAdmin,
  });

  if (session?.userId) {
    invalidateSessionCache(session.userId);
  }

  cookieStore.delete('session');
  redirect('/login');
}
