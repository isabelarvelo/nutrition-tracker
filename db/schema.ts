import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const events = sqliteTable('events', {
  title: text('title').notNull().default(''),
  id: text('id').primaryKey(), userId: text('user_id').notNull(), occurredAt: text('occurred_at').notNull(), localDate: text('local_date').notNull().default('1970-01-01'), mealType: text('meal_type').notNull(), status: text('status').notNull(), note: text('note').notNull().default(''), idempotencyKey: text('idempotency_key'), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, (table) => [index('idx_events_user_time').on(table.userId, table.occurredAt), index('idx_events_user_local_date').on(table.userId, table.localDate), uniqueIndex('idx_events_user_idempotency').on(table.userId, table.idempotencyKey)]);

export const evidence = sqliteTable('evidence', {
  id: text('id').primaryKey(), eventId: text('event_id').notNull(), type: text('type').notNull(), storageKey: text('storage_key'), filename: text('filename'), mimeType: text('mime_type'), transcript: text('transcript'), sortOrder: integer('sort_order').notNull().default(0), createdAt: text('created_at').notNull(),
}, (table) => [index('idx_evidence_event').on(table.eventId)]);

export const loggedItems = sqliteTable('logged_items', {
  id: text('id').primaryKey(), eventId: text('event_id').notNull(), name: text('name').notNull(), quantity: real('quantity').notNull(), unit: text('unit').notNull(), calories: real('calories').notNull(), protein: real('protein').notNull(), carbs: real('carbs').notNull(), fat: real('fat').notNull(), fiber: real('fiber').notNull(), iron: real('iron'), calcium: real('calcium'), vitaminC: real('vitamin_c'), source: text('source').notNull(), sourceUrl: text('source_url').notNull().default(''), libraryItemId: text('library_item_id'), confidence: real('confidence').notNull(), completeness: real('completeness').notNull(), candidates: text('candidates'), resolutionTier: text('resolution_tier'), unresolvedReason: text('unresolved_reason'), clarificationQuestion: text('clarification_question'), quotedSourceText: text('quoted_source_text'),
}, (table) => [index('idx_logged_items_event').on(table.eventId)]);

export const libraryItems = sqliteTable('library_items', {
  components: text('components'),
  id: text('id').primaryKey(), userId: text('user_id').notNull(), name: text('name').notNull(), kind: text('kind').notNull(), alias: text('alias').notNull().default(''), quantity: real('quantity').notNull(), unit: text('unit').notNull(), calories: real('calories').notNull(), protein: real('protein').notNull(), carbs: real('carbs').notNull(), fat: real('fat').notNull(), fiber: real('fiber').notNull(), iron: real('iron'), calcium: real('calcium'), vitaminC: real('vitamin_c'), servingGrams: real('serving_grams'), servingsPerCookedCup: real('servings_per_cooked_cup'), sourceLabel: text('source_label').notNull().default(''), sourceUrl: text('source_url').notNull().default(''), createdAt: text('created_at').notNull(),
}, (table) => [index('idx_library_user').on(table.userId)]);

export const goals = sqliteTable('goals', {
  userId: text('user_id').primaryKey(), calories: real('calories').notNull(), protein: real('protein').notNull(), carbs: real('carbs').notNull(), fat: real('fat').notNull(), fiber: real('fiber').notNull(), breakfastTime: text('breakfast_time').notNull().default('08:00'), lunchTime: text('lunch_time').notNull().default('12:30'), dinnerTime: text('dinner_time').notNull().default('18:30'), snackTime: text('snack_time').notNull().default('15:30'), timezone: text('timezone').notNull().default('America/Chicago'), updatedAt: text('updated_at').notNull(),
});

export const providerCache = sqliteTable('provider_cache', {
  cacheKey: text('cache_key').primaryKey(),
  payload: text('payload').notNull(),
  fetchedAt: text('fetched_at').notNull(),
  expiresAt: text('expires_at').notNull(),
}, (table) => [index('idx_provider_cache_expires').on(table.expiresAt)]);
