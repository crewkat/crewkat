-- 0099: Tools cleanup (Danny 2026-11-03) — the standalone Material prices
-- list (material_cost_items, edited from the old Toolbox) merges into
-- Saved prices (price_book_items), the price book quotes actually read.
-- Every material entry is copied over: name_en becomes the price-book
-- name, price becomes unit_price, and the description keeps whatever
-- would otherwise be lost — the Spanish name (when it differs from the
-- English one) plus the unit. Company and created/updated timestamps are
-- preserved. Idempotent: a row whose (company_id, name, unit_price)
-- already exists in the price book is skipped, so re-applying this
-- migration inserts nothing twice. The material_cost_items table itself
-- is kept (not dropped) — its rows stay as the historical record.
INSERT INTO `price_book_items` (`company_id`, `name`, `description`, `unit_price`, `created_at`, `updated_at`)
SELECT
  m.`company_id`,
  m.`name_en`,
  TRIM(
    (CASE WHEN m.`name_es` <> m.`name_en` THEN m.`name_es` ELSE '' END) ||
    (CASE WHEN m.`unit_en` <> '' THEN (CASE WHEN m.`name_es` <> m.`name_en` THEN ' · ' ELSE '' END) || m.`unit_en` ELSE '' END)
  ),
  m.`price`,
  m.`created_at`,
  m.`updated_at`
FROM `material_cost_items` m
WHERE NOT EXISTS (
  SELECT 1 FROM `price_book_items` p
  WHERE p.`company_id` = m.`company_id`
    AND p.`name` = m.`name_en`
    AND p.`unit_price` = m.`price`
);
