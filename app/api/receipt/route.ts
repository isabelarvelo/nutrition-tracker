import { env } from 'cloudflare:workers';
import { requireUser } from '../../lib/auth';
import { readReceipt } from '../../lib/resolve/receipt';
import type { MealImageInput } from '../../lib/resolve/parse';

export async function POST(request:Request){
  const user=await requireUser();if(!user)return Response.json({error:'Sign in required'},{status:401});
  if(Number(request.headers.get('content-length'))>11*1024*1024)return Response.json({error:'Use a receipt photo under 10 MB.'},{status:413});
  const form=await request.formData().catch(()=>null);
  const file=form?.get('receipt');
  if(!(file instanceof File)||!file.size||file.size>10*1024*1024||!['image/jpeg','image/png','image/webp','image/gif'].includes(file.type))return Response.json({error:'Choose a JPG, PNG, WebP or GIF receipt photo under 10 MB.'},{status:400});
  if(!env.OPENAI_API_KEY)return Response.json({error:'Receipt reading is not configured yet.'},{status:503});
  const bytes=new Uint8Array(await file.arrayBuffer());let binary='';
  for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
  try{
    const items=await readReceipt({mimeType:file.type as MealImageInput['mimeType'],base64:btoa(binary)},{apiKey:env.OPENAI_API_KEY.trim(),model:env.OPENAI_VISION_MODEL?.trim()});
    return Response.json({items},{headers:{'Cache-Control':'no-store'}});
  }catch{return Response.json({error:'Could not read this receipt. Try a clearer photo; nothing was saved.'},{status:502});}
}
