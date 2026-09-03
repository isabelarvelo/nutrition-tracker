import {test} from 'node:test';
import assert from 'node:assert/strict';
import {closeDatabaseMatches,parseWebResearch,researchFoodWeb} from './web-food.ts';

const carrot={id:'carrot',name:'JAMMY YUMMY, CARROT JAM',matchScore:.9};
const url='https://example.com/foods/bites';
const product={name:'Jammy protein bites, blueberry',brand:'Snack brand',serving:'1 pack (5 bites), 50 g',servingGrams:50,calories:200,protein:8,carbs:28,fat:7,fiber:3,sourceUrl:url,explanation:'Likely match; select the flavor.',confidence:.85};
function payload(products=[product],sources=[{url}],databaseMatches=[]){return {status:'completed',output:[{type:'web_search_call',action:{sources}},{type:'message',content:[{type:'output_text',text:JSON.stringify({products,databaseMatches,note:'Choose your flavor.'})}]}]};}

test('unavailable web fallback rejects carrot jam for jammy balls',()=>{
  assert.deepEqual(closeDatabaseMatches('jammy balls',[carrot]),[]);
  assert.equal(closeDatabaseMatches('carrot jam',[carrot]).length,1);
});
test('label values stay per pack and retain the supporting source',()=>{
  const result=parseWebResearch(payload(),[carrot]);
  assert.equal(result.results.length,1);
  assert.equal(result.results[0].calories,200);
  assert.equal(result.results[0].servingGrams,50);
  assert.equal(result.results[0].sourceUrl,url);
  assert.equal(result.results[0].iron,null);
});
test('invented citations and unknown database IDs cannot become results',()=>{
  assert.deepEqual(parseWebResearch(payload([product],[],[{id:'invented',explanation:'match'}]),[carrot]).results,[]);
});
test('incomplete responses and missing label values fail closed',()=>{
  assert.throws(()=>parseWebResearch({...payload(),status:'incomplete'},[]));
  assert.throws(()=>parseWebResearch(payload([{...product,protein:null}]),[]));
});
test('research sends context separately, requires web search, and does not store responses',async()=>{
  const original=globalThis.fetch;
  let calls=0;
  globalThis.fetch=async(_url,options)=>{
    calls++;
    const body=JSON.parse(options.body);
    assert.equal(body.store,false);
    assert.equal(body.tool_choice,'required');
    assert.equal(body.tools[0].type,'web_search');
    if(calls===1){assert.equal(body.input,'jammy balls');assert.equal(body.text,undefined);}
    else{assert.equal(JSON.parse(body.input).context.preferences,'plant based');assert.ok(JSON.parse(body.input).findings);}
    return Response.json(payload());
  };
  try{assert.equal((await researchFoodWeb('jammy balls',[carrot],{savedFoods:[],preferences:'plant based'},{apiKey:'test'})).results.length,1);assert.equal(calls,2);}
  finally{globalThis.fetch=original;}
});
