import test from 'node:test';
import assert from 'node:assert/strict';
import { receiptFoods, readReceipt } from './receipt.ts';

test('receipt review excludes non-food, unclear items and duplicate products',()=>{
  const item=(name,isHumanFood=true,confidence=.98)=>({name,receiptText:name,isHumanFood,confidence});
  assert.deepEqual(receiptFoods({items:[item('Brami pasta'),item('BRAMI PASTA'),item('Dish soap',false),item('Pet food',false),item('Unknown item',true,.5),item('Bananas')]}),[{name:'Brami pasta',alias:'Brami pasta'},{name:'Bananas',alias:'Bananas'}]);
});

test('receipt reading rejects incomplete model output without saving invented items',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async()=>Response.json({status:'incomplete',output:[]});
  try{await assert.rejects(()=>readReceipt({mimeType:'image/png',base64:'test'},{apiKey:'test'}),/incomplete/);}finally{globalThis.fetch=original;}
});

test('receipt output never carries prices, purchase portions or inferred nutrients',()=>{
  const foods=receiptFoods({items:[{name:'Oats',receiptText:'ORG OATS',isHumanFood:true,confidence:1,calories:200,quantity:3,price:9}]});
  assert.deepEqual(foods,[{name:'Oats',alias:'ORG OATS'}]);
});
