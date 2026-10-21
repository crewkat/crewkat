-- 0086: Explicit job contract sum (Danny 2026-10-21) — the original
-- contract amount the change-order price chain builds on. Danny's
-- Anthony job proved the derived base can come up $0 (uploaded-PDF
-- contract with no stored amount, amountDue unset), so the contractor
-- can now set the figure directly. amountDue keeps its separate
-- balance-due meaning (payment reminders quote it as the balance).
ALTER TABLE `jobs` ADD COLUMN `contract_sum` text DEFAULT '' NOT NULL;
