import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMealFallback, parseMealBundle } from './parse.ts';

test('uses pasta context to normalize brand, oil, and Parmesan shorthand', () => {
  const items=parseMealFallback('2 cups of cooked brami protein pasta, drizzle of oil and sprinkle of parm');
  assert.deepEqual(items.map(({name,brand,unit,searchQuery})=>({name,brand,unit,searchQuery})),[
    {name:'protein pasta',brand:'Brami',unit:'cups',searchQuery:'Brami protein pasta'},
    {name:'Olive oil',brand:null,unit:'drizzle',searchQuery:'Olive oil'},
    {name:'Parmesan cheese',brand:null,unit:'sprinkle',searchQuery:'Parmesan cheese'},
  ]);
  assert.match(items[0].needsClarification??'',/package servings/i);
});

test('returns a meal title separately from components and prompts against composite double counting',async()=>{
  const original=globalThis.fetch;let body;
  globalThis.fetch=async(_,init)=>{body=JSON.parse(init.body);return Response.json({output_text:JSON.stringify({title:'Egg bagel sandwich',items:[{rawText:'1 bagel',name:'Bagel',brand:null,quantity:1,unit:'bagel',preparation:null,searchQuery:'bagel',confidence:.8,needsClarification:null},{rawText:'1 egg',name:'Egg',brand:null,quantity:1,unit:'large',preparation:'fried',searchQuery:'fried egg',confidence:.8,needsClarification:null}]})});};
  try{const meal=await parseMealBundle('',[{mimeType:'image/png',base64:'test'}],{apiKey:'test'});assert.equal(meal.title,'Egg bagel sandwich');assert.equal(meal.items.length,2);assert.ok(body.text.format.schema.required.includes('title'));assert.match(body.instructions,/preserve it as ONE branded item/);assert.match(body.instructions,/Never return both/);assert.doesNotMatch(body.instructions,/Keep a commercially sold composite dish together/);}
  finally{globalThis.fetch=original;}
});

test('breakdown mode fails safely instead of parsing instructions as fallback food',async()=>{
  const original=globalThis.fetch;globalThis.fetch=async()=>new Response('',{status:503});
  try{await assert.rejects(()=>parseMealBundle('Break this sandwich into parts',[],{apiKey:'test',requireModel:true}));}
  finally{globalThis.fetch=original;}
});

test('does not invent numeric quantities for qualitative portions', () => {
  const [oil]=parseMealFallback('drizzle of oil');
  assert.equal(oil.quantity,null);
  assert.equal(oil.unit,'drizzle');
});

test('sends multiple meal photos as one high-detail structured vision request', async () => {
  const originalFetch=globalThis.fetch;
  let requestBody;
  globalThis.fetch=async (_url,init) => {
    requestBody=JSON.parse(String(init?.body));
    return new Response(JSON.stringify({output_text:JSON.stringify({items:[{rawText:'4 oz grilled chicken breast',name:'Chicken breast',brand:null,quantity:4,unit:'oz',preparation:'grilled',searchQuery:'grilled chicken breast',confidence:.78,needsClarification:null}]})}));
  };
  try{
    const {items}=await parseMealBundle('',[
      {mimeType:'image/jpeg',base64:'Zmlyc3Q='},
      {mimeType:'image/png',base64:'c2Vjb25k'},
    ],{apiKey:'test-key'});
    assert.equal(items[0].name,'Chicken breast');
    assert.equal(requestBody.model,'gpt-5.6-luna');
    assert.equal(requestBody.text.format.type,'json_schema');
    assert.deepEqual(requestBody.input[0].content.slice(1).map((part)=>({type:part.type,detail:part.detail,image_url:part.image_url})),[
      {type:'input_image',detail:'high',image_url:'data:image/jpeg;base64,Zmlyc3Q='},
      {type:'input_image',detail:'high',image_url:'data:image/png;base64,c2Vjb25k'},
    ]);
  }finally{globalThis.fetch=originalFetch;}
});
