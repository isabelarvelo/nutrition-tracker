import { index, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const events = sqliteTable('events', {
  id: text('id').primaryKey(), userId: text('user_id').notNull(), occurredAt: text('occurred_at').notNull(), mealType: text('meal_type').notNull(), status: text('status').notNull(), note: text('note').notNull().default(''), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, (table) => [index('idx_events_user_time').on(table.userId, table.occurredAt)]);

export const evidence = sqliteTable('evidence', {
  id: text('id').primaryKey(), eventId: text('event_id').notNull(), type: text('type').notNull(), storageKey: text('storage_key'), filename: text('filename'), mimeType: text('mime_type'), transcript: text('transcript'), sortOrder: real('sort_order').notNull().default(0), createdAt: text('created_at').notNull(),
}, (table) => [index('idx_evidence_event').on(table.eventId)]);

export const loggedItems = sqliteTable('logged_items', {
  id: text('id').primaryKey(), eventId: text('event_id').notNull(), name: text('name').notNull(), quantity: real('quantity').notNull(), unit: text('unit').notNull(), calories: real('calories').notNull(), protein: real('protein').notNull(), carbs: real('carbs').notNull(), fat: real('fat').notNull(), fiber: real('fiber').notNull(), iron: real('iron'), calcium: real('calcium'), vitaminC: real('vitamin_c'), source: text('source').notNull(), sourceUrl: text('source_url').notNull().default(''), libraryItemId: text('library_item_id'), confidence: real('confidence').notNull(), completeness: real('completeness').notNull(),
}, (table) => [index('idx_logged_items_event').on(table.eventId)]);

export const libraryItems = sqliteTable('library_items', {
  id: text('id').primaryKey(), userId: text('user_id').notNull(), name: text('name').notNull(), kind: text('kind').notNull(), alias: text('alias').notNull().default(''), quantity: real('quantity').notNull(), unit: text('unit').notNull(), calories: real('calories').notNull(), protein: real('protein').notNull(), carbs: real('carbs').notNull(), fat: real('fat').notNull(), fiber: real('fiber').notNull(), iron: real('iron'), calcium: real('calcium'), vitaminC: real('vitamin_c'), servingGrams: real('serving_grams'), servingsPerCookedCup: real('servings_per_cooked_cup'), sourceLabel: text('source_label').notNull().default(''), sourceUrl: text('source_url').notNull().default(''), createdAt: text('created_at').notNull(),
}, (table) => [index('idx_library_user').on(table.userId)]);

export const goals = sqliteTable('goals', {
  userId: text('user_id').primaryKey(), calories: real('calories').notNull(), protein: real('protein').notNull(), carbs: real('carbs').notNull(), fat: real('fat').notNull(), fiber: real('fiber').notNull(), breakfastTime: text('breakfast_time').notNull().default('08:00'), lunchTime: text('lunch_time').notNull().default('12:30'), dinnerTime: text('dinner_time').notNull().default('18:30'), snackTime: text('snack_time').notNull().default('15:30'), updatedAt: text('updated_at').notNull(),
});
