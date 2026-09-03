import assert from 'node:assert/strict';
import test from 'node:test';
import {estimateFoods,applyEstimate} from './estimate.ts';
import {withQuantity} from './portion.ts';

const item={id:'bagel',name:'whole wheat bagel',quantity:2,unit:'bagels',calories:0,protein:0,carbs:0,fat:0,fiber:0,iron:null,calcium:null,vitaminC:null,source:'Needs research',sourceUrl:'',libraryItemId:null,confidence:0,completeness:0,resolutionTier:'unresolved'};
const best={name:'Whole wheat bagel',quantity:2,unit:'bagels',assumption:'Two medium bagels, about 100 g each.',calories:500,protein:20,carbs:96,fat:4,fiber:12};

test('fills unresolved nutrition with a labeled estimate and portion-specific alternatives',async()=>{
  const original=globalThis.fetch;
  let sent;
  globalThis.fetch=async(_,init)=>{sent=JSON.parse(init.body);return Response.json({output:[{content:[{type:'output_text',text:JSON.stringify({foods:[{id:'bagel',options:[best,{...best,name:'Small whole wheat bagel',calories:360}]}]})}]}]});};
  try{
    const estimates=await estimateFoods([item],{apiKey:'test'});
    const updated=applyEstimate(item,estimates.get(item.id));
    assert.equal(updated.calories,500);
    assert.equal(updated.quantity,2);
    assert.equal(updated.unit,'bagels');
    assert.equal(updated.source,'AI estimate · review');
    assert.equal(updated.resolutionTier,'estimated');
    assert.equal(updated.iron,null);
    assert.equal(updated.candidates.length,2);
    assert.equal(updated.candidates[1].nutrients.calories,360);
    assert.match(updated.clarificationQuestion,/Two medium/);
    assert.equal(sent.store,false);
    assert.equal(sent.text.format.strict,true);
    assert.equal(JSON.parse(sent.input)[0].quantity,2);
  }finally{globalThis.fetch=original;}
});

test('keeps unknown nutrition unresolved when API fails rather than inventing zeros as estimates',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async()=>new Response('',{status:429});
  try{assert.equal((await estimateFoods([item],{apiKey:'test'})).size,0);assert.deepEqual(applyEstimate(item,[]),item);}
  finally{globalThis.fetch=original;}
});

test('rejects invalid nutrients and ignores hallucinated item ids',async()=>{
  const original=globalThis.fetch;
  try{
    globalThis.fetch=async()=>Response.json({output_text:JSON.stringify({foods:[{id:'bagel',options:[{...best,calories:-1}]}]})});
    assert.equal((await estimateFoods([item],{apiKey:'test'})).size,0);
    globalThis.fetch=async()=>Response.json({output_text:JSON.stringify({foods:[{id:'not-requested',options:[best]}]})});
    assert.equal((await estimateFoods([item],{apiKey:'test'})).size,0);
  }finally{globalThis.fetch=original;}
});

test('quantity edits scale totals while preserving unknown micronutrients',()=>{
  const portion=withQuantity({...item,...best},1);
  assert.equal(portion.calories,250);
  assert.equal(portion.protein,10);
  assert.equal(portion.iron,null);
  assert.equal(withQuantity({...item,...best},0).calories,500);
});

test('no key or foods means no estimate request',async()=>{
  assert.equal((await estimateFoods([item],{})).size,0);
  assert.equal((await estimateFoods([],{apiKey:'test'})).size,0);
});
