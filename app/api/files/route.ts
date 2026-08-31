import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '../../chatgpt-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  const userId = user?.userId ?? (process.env.NODE_ENV !== 'production' ? 'local-single-user' : null);
  const key = new URL(request.url).searchParams.get('key');
  if (!userId) return new Response('Authentication required', { status: 401 });
  if (!key || !key.startsWith(`${userId}/`)) return new Response('Not found', { status: 404 });
  const object = await env.FILES.get(key);
  if (!object) return new Response('Not found', { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('Cache-Control', 'private, max-age=3600');
  return new Response(object.body, { headers });
}
