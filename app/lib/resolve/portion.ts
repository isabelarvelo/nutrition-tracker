import type { FoodItem } from '../../types';

export function withQuantity(item:FoodItem, quantity:number):FoodItem {
  const scale=(value:number)=>quantity>0&&item.quantity>0?Math.round(value*quantity/item.quantity*10)/10:value;
  return {...item,quantity,calories:scale(item.calories),protein:scale(item.protein),carbs:scale(item.carbs),fat:scale(item.fat),fiber:scale(item.fiber),
    iron:item.iron==null?null:scale(item.iron),calcium:item.calcium==null?null:scale(item.calcium),vitaminC:item.vitaminC==null?null:scale(item.vitaminC)};
}
