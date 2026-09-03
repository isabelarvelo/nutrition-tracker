import { env } from 'cloudflare:workers';
import { requireUser } from '../../lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const user = await requireUser();
  if (!user) return new Response('Authentication required', { status: 401 });
  const userId = user.userId;
  const key = new URL(request.url).searchParams.get('key');
  if (!key || key.includes('..') || key.includes('\\') || key.startsWith('/') || !key.startsWith(`${userId}/`)) return new Response('Not found', { status: 404 });
  const segments = key.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..') || segments[0] !== userId) return new Response('Not found', { status: 404 });
  const object = await env.FILES.get(key);
  if (!object) return new Response('Not found', { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('Cache-Control', 'private, max-age=3600');
  return new Response(object.body, { headers });
}
