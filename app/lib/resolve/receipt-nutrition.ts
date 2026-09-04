import type { LibraryItem } from '../../types';
import type { FoodResearchResult } from '../../food-research';

// Receipt counts and prices never define a nutritional serving. Only use a
// single confidently identified result, already checked by food research.
export async function enrichReceiptItem(
  item:LibraryItem,
  lookup:(query:string)=>Promise<{results:FoodResearchResult[]}>,
):Promise<LibraryItem>{
  try{
    const {results}=await lookup(item.name);
    if(results.length!==1)return item;
    const result=results[0];
    if(result.matchScore<.85||!result.sourceUrl||!result.serving.trim())return item;
    if(![result.calories,result.protein,result.carbs,result.fat,result.fiber].every(value=>Number.isFinite(value)&&value>=0&&value<=20000))return item;
    return {
      ...item,name:result.name,alias:[...new Set([item.name,...item.alias.split(',')].map(value=>value.trim()).filter(Boolean))].join(', '),
      quantity:1,unit:result.serving,servingGrams:result.servingGrams,servingsPerCookedCup:result.servingsPerCookedCup,
      calories:result.calories,protein:result.protein,carbs:result.carbs,fat:result.fat,fiber:result.fiber,
      iron:result.iron,calcium:result.calcium,vitaminC:result.vitaminC,
      sourceLabel:result.sourceLabel,sourceUrl:result.sourceUrl,nutritionPending:false,
    };
  }catch{return item;}
}
