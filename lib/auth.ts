import { jwtVerify, type JWTPayload } from 'jose';

export interface SessionPayload extends JWTPayload {
  userId: string;
  email: string;
  role: string;
}

export function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not configured');
  }

  return new TextEncoder().encode(secret);
}

export async function verifySessionToken(token: string): Promise<SessionPayload> {
  const { payload } = await jwtVerify(token, getJwtSecret());

  if (
    typeof payload.userId !== 'string' ||
    typeof payload.email !== 'string' ||
    typeof payload.role !== 'string'
  ) {
    throw new Error('Invalid session payload');
  }

  return payload as SessionPayload;
}
