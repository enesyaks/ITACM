-- Instance default currency (ISO 4217). Contracts may still override per record.
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS currency TEXT;
UPDATE app_settings SET currency = 'TRY' WHERE id = 1 AND (currency IS NULL OR currency = '');
