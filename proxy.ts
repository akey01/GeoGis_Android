import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

const DEFAULT_JWT_SECRET = 'geotrans-secret-key-2026-v4-premium';

export async function proxy(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;
  const sessionToken = request.cookies.get('session')?.value;
  const jwtSecret = process.env.JWT_SECRET || DEFAULT_JWT_SECRET;

  // Si el usuario viene redirigido por cuenta suspendida o cierre de sesión forzado, limpiar cookie de sesión
  if (pathname === '/login' && (searchParams.has('suspended') || searchParams.has('logout'))) {
    const response = NextResponse.next();
    response.cookies.delete('session');
    return response;
  }

  let isAuthenticated = false;

  if (sessionToken && jwtSecret) {
    try {
      const secret = new TextEncoder().encode(jwtSecret);
      await jwtVerify(sessionToken, secret);
      isAuthenticated = true;
    } catch {
      isAuthenticated = false;
    }
  }

  // Proteger rutas de Dashboard: requerir sesión
  if (pathname.startsWith('/dashboard')) {
    if (!isAuthenticated) {
      const loginUrl = new URL('/login', request.url);
      return NextResponse.redirect(loginUrl);
    }
  }

  // Redirigir usuarios autenticados fuera de login o registro
  if ((pathname === '/login' || pathname === '/register') && isAuthenticated) {
    const dashboardUrl = new URL('/dashboard', request.url);
    return NextResponse.redirect(dashboardUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/login', '/register'],
};
