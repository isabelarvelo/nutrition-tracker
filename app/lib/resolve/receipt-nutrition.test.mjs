import test from 'node:test';
import assert from 'node:assert/strict';
import { enrichReceiptItem } from './receipt-nutrition.ts';
const item={id:'',name:'Brand oats',alias:'BR OATS',quantity:3,unit:'packages',nutritionPending:true,calories:0};
const result={name:'Brand · Rolled oats',serving:'½ cup dry (40 g)',servingGrams:40,servingsPerCookedCup:null,calories:150,protein:5,carbs:27,fat:3,fiber:4,iron:null,calcium:null,vitaminC:null,sourceLabel:'Manufacturer label',sourceUrl:'https://example.com/oats',matchScore:.95};

test('receipt save automatically researches the food and uses a single label serving',async()=>{
  let searched;
  const saved=await enrichReceiptItem(item,async query=>{searched=query;return {results:[result]};});
  assert.equal(searched,item.name);assert.equal(saved.nutritionPending,false);
  assert.equal(saved.quantity,1);assert.equal(saved.unit,result.serving);assert.equal(saved.calories,150);
  assert.equal(saved.sourceUrl,result.sourceUrl);assert.equal(saved.iron,null);
  assert.equal(saved.alias,'Brand oats, BR OATS');
});

test('ambiguity, weak matches, missing sources and failed research preserve a pending food',async()=>{
  for(const results of [[],[result,{...result,name:'Different flavor'}],[{...result,matchScore:.7}],[{...result,sourceUrl:''}],[{...result,protein:undefined}]]){
    assert.equal(await enrichReceiptItem(item,async()=>({results})),item);
  }
  assert.equal(await enrichReceiptItem(item,async()=>{throw new Error('offline');}),item);
});

test('verified zero values are preserved rather than treated as missing',async()=>{
  const saved=await enrichReceiptItem(item,async()=>({results:[{...result,calories:0,protein:0,carbs:0,fat:0,fiber:0}]}));
  assert.equal(saved.nutritionPending,false);assert.equal(saved.calories,0);
});
