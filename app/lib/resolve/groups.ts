import type {FoodItem,LibraryItem} from '../../types';
import {withQuantity} from './portion';

export function libraryComponents(saved:LibraryItem,scale=1):FoodItem[]{
  return (saved.components??[]).map(item=>({...withQuantity(item,item.quantity*scale),id:crypto.randomUUID(),libraryItemId:null,candidates:undefined}));
}

export function mealTitle(title:string|undefined,note:string,mealType:string){
  return title?.trim()||note.trim().slice(0,200)||`${mealType} meal`;
}
