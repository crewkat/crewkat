-- 0079: the contractor's saved signature (Danny 2026-10-14). Drawn once
-- in Settings, stored as a PNG blob like the company logo, and applied
-- with one tap ("Sign with saved signature") to any contract / change
-- order — the drawn-signature equivalent for the contractor's side,
-- recorded with signer + timestamp exactly like a drawn signature.
ALTER TABLE `settings` ADD `signature_blob_key` text;
