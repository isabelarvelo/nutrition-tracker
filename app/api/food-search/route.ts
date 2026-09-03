import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '../../chatgpt-auth';
import { researchFoods } from '../../food-research';

export const dynamic = 'force-dynamic';

export async function GET(request:Request){
  const user=await getChatGPTUser();
  if(!user&&process.env.NODE_ENV==='production')return Response.json({error:'Authentication required'},{status:401});
  const query=new URL(request.url).searchParams.get('q')?.trim()??'';
  if(query.length<2||query.length>100)return Response.json({error:'Enter a specific food or brand.'},{status:400});
  const apiKey=env.USDA_API_KEY?.trim();
  if(!apiKey)return Response.json({error:'USDA nutrition search is not configured.'},{status:503});
  try{const researched=await researchFoods(query,apiKey,true,6);return Response.json({...researched,note:researched.searched!==query?`Searched “${researched.searched}” and ranked matches against “${query}”.`:null});}
  catch{return Response.json({error:'The nutrition source is temporarily unavailable. Try again shortly.'},{status:502});}
}
