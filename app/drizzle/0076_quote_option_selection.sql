-- 0076: client option selections for estimates. One JSON object on the quote:
-- { "selected": string[] (line ids the client ticked on the client page),
--   "accepted": null | { "items": [line...], "optionsTotal": string,
--                        "totalWithOptions": string, "acceptedAt": string } }
-- The accepted snapshot is written when the estimate is accepted (or
-- converted), so accepted options flow into the invoice at the prices the
-- client saw even if the estimate is edited afterwards.
ALTER TABLE `quotes` ADD `option_selection_json` text NOT NULL DEFAULT '{}';
