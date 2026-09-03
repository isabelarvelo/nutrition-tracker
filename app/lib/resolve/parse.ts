import { z } from 'zod';

const parsedFoodSchema = z.object({
  rawText: z.string().min(1).max(500),
  name: z.string().min(1).max(200),
  brand: z.string().max(100).nullable(),
  quantity: z.number().finite().positive().max(20_000).nullable(),
  unit: z.string().max(80).nullable(),
  preparation: z.string().max(200).nullable(),
  searchQuery: z.string().min(1).max(200),
  confidence: z.number().finite().min(0).max(1),
  needsClarification: z.string().max(300).nullable(),
});

const parsedMealSchema = z.object({ items: z.array(parsedFoodSchema).max(30) });
export type ParsedFood = z.infer<typeof parsedFoodSchema>;
export type MealImageInput = { mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'; base64: string };

const responseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      minItems: 0,
      maxItems: 30,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['rawText', 'name', 'brand', 'quantity', 'unit', 'preparation', 'searchQuery', 'confidence', 'needsClarification'],
        properties: {
          rawText: { type: 'string' },
          name: { type: 'string' },
          brand: { type: ['string', 'null'] },
          quantity: { type: ['number', 'null'] },
          unit: { type: ['string', 'null'] },
          preparation: { type: ['string', 'null'] },
          searchQuery: { type: 'string' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          needsClarification: { type: ['string', 'null'] },
        },
      },
    },
  },
};

const instructions = `You parse a person's short meal description into foods for deterministic nutrition lookup.
- Split separate foods and toppings, but keep a commercially sold composite dish together.
- Use surrounding meal context to expand shorthand. On pasta, "parm" means grated Parmesan cheese and an unspecified cooking oil means olive oil unless the text says otherwise.
- Separate brand from food name. "Brami protein pasta" becomes brand "Brami" and name "protein pasta".
- Keep qualitative amounts as qualitative units: drizzle, sprinkle, handful. Do not convert them into teaspoons or grams.
- If no numeric quantity was stated, quantity must be null.
- searchQuery is only the canonical brand + food name used by nutrition databases. Exclude quantity and preparation.
- preparation describes cooked, fried, scrambled, and similar modifiers.
- Ask a concise clarification only when it materially changes nutrition, such as an unknown cooked yield or drink size.
- Return only the requested structured result. Never calculate nutrients.`;

const visionInstructions = `You interpret all supplied evidence as one eating event for deterministic nutrition lookup.
- Use both the person's description and every image. Images may show a dish, menu, nutrition label, recipe, ingredient, receipt, or portion reference.
- Do not create duplicate items when multiple images show the same food. Use extra images as supporting evidence.
- Split visually distinct foods, toppings, sauces, drinks, and cooking fats when they materially affect nutrition. Keep a commercially sold composite dish together.
- Read visible menu, package, and nutrition-label text when it improves identification, but do not invent text that is not legible.
- Estimate a practical portion only when visual evidence supports one. Prefer grams, ounces, cups, tablespoons, pieces, slices, or a common serving unit.
- rawText must be a concise lookup phrase that includes the estimated quantity and unit when available, followed by the food name and preparation. Example: "4 oz grilled chicken breast".
- Separate brand from food name. searchQuery is only the canonical brand + food name used by nutrition databases; exclude quantity and preparation.
- preparation describes cooked, fried, scrambled, and similar modifiers.
- confidence measures confidence in the identity and portion together. Lower it when the portion, hidden ingredients, oil, sauce, or preparation is uncertain.
- Ask at most one concise clarification per item, and only when the answer could materially change nutrition. Mention the specific uncertainty.
- If no food or food-related evidence is visible, return an empty items array.
- Return only the requested structured result. Never calculate calories or nutrients.`;

function splitFallback(text:string){
  return text.replace(/^\s*[*•-]\s*/,'').split(/\s*(?:,|;|\n)\s*|\s+and\s+(?=(?:\d+(?:\.\d+)?|\d+\/\d+|a\b|an\b|one\b|two\b|half\b|sprinkle\b|drizzle\b|dash\b|handful\b))/i).map((part)=>part.replace(/^\s*(?:and|plus)\s+/i,'').trim()).filter(Boolean);
}

function fallbackItem(rawText:string):ParsedFood{
  const amount=rawText.match(/^\s*(\d+\/\d+|\d+(?:\.\d+)?)\s*(cups?|tbsp|tablespoons?|tsp|teaspoons?|oz|ounces?|grams?|g|servings?)?/i);
  const quantity=amount?.[1]?.includes('/')?Number(amount[1].split('/')[0])/Number(amount[1].split('/')[1]):amount?.[1]?Number(amount[1]):null;
  const qualitative=rawText.match(/\b(drizzle|sprinkle|handful|dash)\b/i)?.[1]?.toLowerCase()??null;
  const cleaned=rawText.replace(/^\s*(?:\d+\/\d+|\d+(?:\.\d+)?)\s*/,'').replace(/^(?:cups?|tbsp|tablespoons?|tsp|teaspoons?|oz|ounces?|grams?|g|servings?)\s+(?:of\s+)?/i,'').replace(/^(?:drizzle|sprinkle|handful|dash)\s+(?:of\s+)?/i,'').trim();
  if(/\bparm(?:esan)?\b/i.test(cleaned))return{rawText,name:'Parmesan cheese',brand:null,quantity,unit:qualitative??amount?.[2]?.toLowerCase()??null,preparation:'grated',searchQuery:'Parmesan cheese',confidence:.88,needsClarification:null};
  if(/\boil\b/i.test(cleaned))return{rawText,name:'Olive oil',brand:null,quantity,unit:qualitative??amount?.[2]?.toLowerCase()??null,preparation:null,searchQuery:'Olive oil',confidence:.72,needsClarification:qualitative?`How much was the ${qualitative} of olive oil?`:null};
  const brami=/\bbrami\b/i.test(cleaned);const name=cleaned.replace(/\bbrami\b/ig,'').replace(/\bcooked\b/ig,'').replace(/\s+/g,' ').trim();
  return{rawText,name:name||'Food item',brand:brami?'Brami':null,quantity,unit:qualitative??amount?.[2]?.toLowerCase()??null,preparation:/\bcooked\b/i.test(cleaned)?'cooked':null,searchQuery:brami?`Brami ${name}`:name,confidence:.65,needsClarification:brami&&/\bcups?\b/i.test(rawText)&&/\bcooked\b/i.test(rawText)?'How many package servings were in the cooked portion?':null};
}

export function parseMealFallback(text:string){return splitFallback(text).map(fallbackItem);}

function outputText(payload:{output_text?:unknown;output?:Array<{content?:Array<{type?:string;text?:string}>}>}){
  if(typeof payload.output_text==='string')return payload.output_text;
  return payload.output?.flatMap((item)=>item.content??[]).find((item)=>item.type==='output_text')?.text??'';
}

export async function parseMealText(text:string,options:{apiKey?:string;model?:string}):Promise<ParsedFood[]>{
  if(!options.apiKey)return parseMealFallback(text);
  try{
    const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${options.apiKey}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(15_000),body:JSON.stringify({model:options.model??'gpt-5.4-mini',instructions,input:text,store:false,text:{format:{type:'json_schema',name:'parsed_meal',strict:true,schema:responseSchema}}})});
    if(!response.ok)throw new Error(`OpenAI parse returned ${response.status}`);
    const payload=await response.json() as {output_text?:unknown;output?:Array<{content?:Array<{type?:string;text?:string}>}>};
    return parsedMealSchema.parse(JSON.parse(outputText(payload))).items;
  }catch(error){
    console.warn('Structured meal parse failed; using local parser',{error:error instanceof Error?error.message:String(error)});
    return parseMealFallback(text);
  }
}

export async function parseMealEvidence(text:string,images:MealImageInput[],options:{apiKey?:string;model?:string}):Promise<ParsedFood[]>{
  if(!images.length)return parseMealText(text,options);
  if(!options.apiKey)return text.trim()?parseMealFallback(text):[];
  try{
    const content:Array<Record<string,string>>=[
      {type:'input_text',text:text.trim()?`User description: ${text.trim()}\nInterpret the description and images as one meal.`:'No description was supplied. Identify the meal from the images.'},
      ...images.map((image)=>({type:'input_image',image_url:`data:${image.mimeType};base64,${image.base64}`,detail:'high'})),
    ];
    const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${options.apiKey}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(30_000),body:JSON.stringify({model:options.model??'gpt-5.6-luna',instructions:visionInstructions,input:[{role:'user',content}],store:false,text:{format:{type:'json_schema',name:'parsed_meal',strict:true,schema:responseSchema}}})});
    if(!response.ok)throw new Error(`OpenAI vision parse returned ${response.status}`);
    const payload=await response.json() as {output_text?:unknown;output?:Array<{content?:Array<{type?:string;text?:string}>}>};
    return parsedMealSchema.parse(JSON.parse(outputText(payload))).items;
  }catch(error){
    console.warn('Structured photo parse failed; using text fallback',{error:error instanceof Error?error.message:String(error)});
    return text.trim()?parseMealFallback(text):[];
  }
}
