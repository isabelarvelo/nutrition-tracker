import { env } from 'cloudflare:workers';
import { requireUser } from '../../lib/auth';

const ACCEPTED = ['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/x-m4a'];

// Browser recording still requires microphone permission, including iframe permission.
export async function POST(request: Request) {
  const user = await requireUser();
  if (!user) return Response.json({ error: 'Sign in required' }, { status: 401 });
  if (Number(request.headers.get('content-length')) > 26 * 1024 * 1024)
    return Response.json({ error: 'That recording is too long. Keep voice notes under about two minutes.' }, { status: 413 });

  const form = await request.formData().catch(() => null);
  const file = form?.get('audio');
  if (!(file instanceof File) || !file.size)
    return Response.json({ error: 'No audio arrived. Record again and then save.' }, { status: 400 });
  if (file.size > 25 * 1024 * 1024)
    return Response.json({ error: 'That recording is too long. Keep voice notes under about two minutes.' }, { status: 400 });
  // Browsers append codec parameters, e.g. audio/webm;codecs=opus.
  const mime = file.type.split(';')[0].trim().toLowerCase();
  if (!ACCEPTED.includes(mime))
    return Response.json({ error: 'That audio format is not supported. Type the meal instead.' }, { status: 400 });

  if (!env.OPENAI_API_KEY?.trim())
    return Response.json({ error: 'Voice notes are not configured yet. Type the meal instead.' }, { status: 503 });

  const upstream = new FormData();
  upstream.append('file', file, file.name || 'voice-note.webm');
  upstream.append('model', env.OPENAI_TRANSCRIBE_MODEL?.trim() || 'whisper-1');
  upstream.append('response_format', 'text');
  upstream.append('language', 'en');
  // Priming the decoder with domain vocabulary measurably reduces errors on
  // brand names and units, which is most of what a food voice note contains.
  upstream.append('prompt', 'A spoken food log. Expect quantities and units (grams, ounces, cups, tablespoons, slices, scoops), brand names, and dish names.');

  try {
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY.trim()}` },
      body: upstream,
      signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok) throw new Error('Transcription unavailable');
    const transcript = (await response.text()).trim();
    if (!transcript) return Response.json({ error: 'Nothing was audible in that recording. Try again closer to the microphone.' }, { status: 422 });
    return Response.json({ transcript: transcript.slice(0, 2000) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ error: 'Could not transcribe that recording. Your draft is still here.' }, { status: 502 });
  }
}
