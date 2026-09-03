import { z } from 'zod';
import { isValidTimeZone } from './dates';

const finiteNutrient = z.number().finite().nonnegative().max(20_000);
const nullableNutrient = finiteNutrient.nullable();
const shortText = z.string().trim().max(200);
const id = z.string().min(1).max(100);

export const nutrientsSchema = z.object({
  calories: finiteNutrient,
  protein: finiteNutrient,
  carbs: finiteNutrient,
  fat: finiteNutrient,
  fiber: finiteNutrient,
  iron: nullableNutrient,
  calcium: nullableNutrient,
  vitaminC: nullableNutrient,
});

export const foodItemSchema = nutrientsSchema.extend({
  id,
  name: z.string().trim().min(1).max(200),
  quantity: z.number().finite().positive().max(20_000),
  unit: z.string().trim().min(1).max(80),
  source: shortText,
  sourceUrl: z.union([z.url().max(2_000), z.literal('')]),
  libraryItemId: id.nullable(),
  confidence: z.number().finite().min(0).max(1),
  completeness: z.number().finite().min(0).max(1),
});

export const nutritionCandidateSchema = z.object({
  providerId: z.enum(['library', 'usda', 'off', 'web', 'estimate']),
  externalId: id,
  name: z.string().trim().min(1).max(200),
  brand: shortText.nullable(),
  servingDescription: z.string().trim().min(1).max(200),
  servingGrams: finiteNutrient.positive().nullable(),
  unitGrams: z.record(z.string().max(80), finiteNutrient),
  nutrients: nutrientsSchema,
  sourceLabel: shortText,
  sourceUrl: z.union([z.url().max(2_000), z.literal('')]),
  matchScore: z.number().finite().min(0).max(1),
  dataQuality: z.enum(['verified', 'crowdsourced', 'extracted', 'estimated']),
  quantity: z.number().finite().positive().max(20000).optional(),
  unit: z.string().trim().min(1).max(80).optional(),
  assumption: z.string().max(300).optional(),
});

export const libraryItemSchema = nutrientsSchema.extend({
  id: z.string().max(100),
  name: z.string().trim().min(1).max(200),
  kind: z.enum(['food', 'recipe', 'meal']),
  alias: z.string().trim().max(1_000),
  quantity: z.number().finite().positive().max(20_000),
  unit: z.string().trim().min(1).max(80),
  servingGrams: finiteNutrient.positive().nullable(),
  servingsPerCookedCup: finiteNutrient.positive().nullable(),
  sourceLabel: shortText,
  sourceUrl: z.union([z.url().max(2_000), z.literal('')]),
});

export const goalsSchema = z.object({
  calories: finiteNutrient.positive(),
  protein: finiteNutrient.positive(),
  carbs: finiteNutrient.positive(),
  fat: finiteNutrient.positive(),
  fiber: finiteNutrient.positive(),
});

const clockTime = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const mealTimesSchema = z.object({
  Breakfast: clockTime,
  Lunch: clockTime,
  Dinner: clockTime,
  Snack: clockTime,
});

export const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('rename_event'), eventId:id, title:z.string().trim().min(1).max(200) }),
  z.object({ action: z.literal('break_item'), itemId:id, name:z.string().trim().min(1).max(200), quantity:z.number().finite().positive().max(20000), unit:z.string().trim().min(1).max(80), details:z.string().trim().max(2000).optional() }),
  z.object({ action: z.literal('log_library'), itemId:id, occurredAt:z.iso.datetime(), mealType:shortText }),
  z.object({ action: z.literal('verify'), eventId: id }),
  z.object({ action: z.literal('update_event'), eventId: id, occurredAt: z.iso.datetime(), mealType: shortText, note: z.string().max(10_000) }),
  z.object({ action: z.literal('update_item'), item: foodItemSchema }),
  z.object({ action: z.literal('add_item'), eventId: id, item: foodItemSchema }),
  z.object({ action: z.literal('add_foods'), eventId: id, description: z.string().trim().min(1).max(2000) }),
  z.object({ action: z.literal('estimate_item'), itemId: id, name: z.string().trim().min(1).max(200), quantity: z.number().finite().positive().max(20000), unit: z.string().trim().min(1).max(80) }),
  z.object({ action: z.literal('delete_item'), itemId: id }),
  z.object({ action: z.literal('resolve_candidate'), itemId: id, candidate: nutritionCandidateSchema }),
  z.object({ action: z.literal('delete_event'), eventId: id }),
  z.object({ action: z.literal('repeat'), eventId: id }),
  z.object({ action: z.literal('save_library'), item: libraryItemSchema }),
  z.object({ action: z.literal('delete_library'), itemId: id }),
  z.object({ action: z.literal('update_library_from_item'), libraryItemId: id, item: foodItemSchema }),
  z.object({ action: z.literal('save_event_to_library'), eventId: id, name: z.string().trim().max(200).optional() }),
  z.object({ action: z.literal('save_goals'), goals: goalsSchema, mealTimes: mealTimesSchema.optional(), timezone: z.string().refine(isValidTimeZone).optional() }),
  z.object({ action: z.literal('delete_all') }),
]);

export const capturePayloadSchema = z.object({
  title:z.string().trim().max(200).optional(),
  note: z.string().trim().max(10_000).optional(),
  transcript: z.string().trim().max(10_000).optional(),
  occurredAt: z.iso.datetime().optional(),
  mealType: z.string().trim().min(1).max(80).optional(),
  idempotencyKey: z.string().trim().min(8).max(200).optional(),
});

export function validationError(error: z.ZodError) {
  const issue = error.issues[0];
  return Response.json({
    error: issue ? `${issue.path.join('.') || 'request'}: ${issue.message}` : 'Invalid request',
    issues: error.issues,
  }, { status: 400 });
}
