-- 0101: Crawl fix A14 — migration 0099 merged material_cost_items into
-- the Saved prices price book (price_book_items) and stored each
-- material's SPANISH name as the item description ("Madera 2×4×8 ·
-- each"), so the list showed English names with Spanish descriptions.
-- Rewrite the description of exactly the rows 0099 generated — matched
-- character-for-character against the string 0099 built, joined back
-- to the source material row — to the English unit alone ("each",
-- "sheet", "bag", ...), the information the merge meant to preserve.
-- Rows a user has edited since the merge no longer match the generated
-- string and are left untouched.
UPDATE `price_book_items`
SET `description` = (
  SELECT m.`unit_en`
  FROM `material_cost_items` m
  WHERE m.`company_id` = `price_book_items`.`company_id`
    AND m.`name_en` = `price_book_items`.`name`
    AND m.`price` = `price_book_items`.`unit_price`
    AND `price_book_items`.`description` = TRIM(
      (CASE WHEN m.`name_es` <> m.`name_en` THEN m.`name_es` ELSE '' END) ||
      (CASE WHEN m.`unit_en` <> '' THEN (CASE WHEN m.`name_es` <> m.`name_en` THEN ' · ' ELSE '' END) || m.`unit_en` ELSE '' END)
    )
  LIMIT 1
)
WHERE EXISTS (
  SELECT 1
  FROM `material_cost_items` m
  WHERE m.`company_id` = `price_book_items`.`company_id`
    AND m.`name_en` = `price_book_items`.`name`
    AND m.`price` = `price_book_items`.`unit_price`
    AND `price_book_items`.`description` = TRIM(
      (CASE WHEN m.`name_es` <> m.`name_en` THEN m.`name_es` ELSE '' END) ||
      (CASE WHEN m.`unit_en` <> '' THEN (CASE WHEN m.`name_es` <> m.`name_en` THEN ' · ' ELSE '' END) || m.`unit_en` ELSE '' END)
    )
);
