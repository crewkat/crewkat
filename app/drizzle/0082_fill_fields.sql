-- 0082: Fill-in fields for uploaded-PDF documents (Danny 2026-10-17) —
-- DocuSign-style TEXT / INITIALS / CHECKBOX fields placed by the sender
-- next to the 0078 signature fields. Definitions (kind, role, label,
-- required flag, page-relative box, contractor prefill) are a JSON array
-- on the document; the values a signer enters are a JSON object keyed by
-- field id. Values are composited into the final signed PDF exactly like
-- the signature stamps. Empty defaults = no fill fields, so every
-- existing document and reader is untouched.
ALTER TABLE `documents` ADD COLUMN `fill_fields_json` text NOT NULL DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE `documents` ADD COLUMN `fill_values_json` text NOT NULL DEFAULT '{}';
