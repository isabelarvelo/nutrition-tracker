import { env } from 'cloudflare:workers';
import { requireUser } from '../../lib/auth';
import { researchFoods, researchOpenFoodFacts } from '../../food-research';
import { closeDatabaseMatches, researchFoodWeb, type ResearchContext } from '../../lib/resolve/web-food';

export const dynamic = 'force-dynamic';

export async function GET(request:Request){
  const user=await requireUser();
  if(!user)return Response.json({error:'Authentication required'},{status:401});
  const query=new URL(request.url).searchParams.get('q')?.trim()??'';
  if(query.length<2||query.length>100)return Response.json({error:'Enter a specific food or brand.'},{status:400});
  const apiKey=env.USDA_API_KEY?.trim();
  const preference=new URL(request.url).searchParams.get('context')?.trim().slice(0,300);
  const context:ResearchContext={savedFoods:[],preferences:preference};
  // User-scoped context; never put personalized research in the shared provider cache.
  try{
    const saved=await env.DB.prepare('SELECT name, alias FROM library_items WHERE user_id = ? ORDER BY created_at DESC LIMIT 30').bind(user.userId).all<{name:string;alias:string}>();
    context.savedFoods=saved.results.map(food=>({name:food.name.slice(0,200),alias:food.alias.slice(0,200)}));
  }catch{/* Search remains useful without saved context. */}
  const providers=await Promise.allSettled([
    apiKey?researchFoods(query,apiKey,false,6).then(result=>result.results):Promise.resolve([]),
    researchOpenFoodFacts(query,6),
  ]);
  const candidates=providers.flatMap(result=>result.status==='fulfilled'?result.value:[]);
  const headers={'Cache-Control':'private, no-store'};
  if(env.OPENAI_API_KEY?.trim()){
    try{return Response.json(await researchFoodWeb(query,candidates,context,{apiKey:env.OPENAI_API_KEY.trim(),model:env.OPENAI_MODEL?.trim()}),{headers});}
    catch{console.warn('Web food research unavailable; using close database matches.');}
  }
  const results=closeDatabaseMatches(query,candidates);
  return Response.json({results,note:results.length?'Web research is temporarily unavailable. These are close database matches; check the product and serving.':'I couldn’t verify a close match right now. Try adding the brand or flavor, or enter the package label manually.'},{headers});
}
