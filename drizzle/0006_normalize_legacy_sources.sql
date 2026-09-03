-- Data migration (no schema change).
--
-- Early builds stored lowercase, internal `source` labels on logged_items.
-- Reads went through a translation shim in app/api/state/route.ts that mapped
-- them to their display strings on every row, on every request. This rewrites
-- the stored values once so the shim can be deleted.
--
-- Idempotent: re-running matches nothing because the targets are distinct from
-- the sources.

UPDATE `logged_items` SET `source` = 'Personal Library' WHERE `source` = 'personal library';--> statement-breakpoint
UPDATE `logged_items` SET `source` = 'Built-in reference' WHERE `source` = 'reference estimate';--> statement-breakpoint
UPDATE `logged_items` SET `source` = 'Legacy estimate · review' WHERE `source` IN ('item estimate', 'AI-style estimate');--> statement-breakpoint
UPDATE `logged_items` SET `source` = 'Manual entry' WHERE `source` = 'manual';
