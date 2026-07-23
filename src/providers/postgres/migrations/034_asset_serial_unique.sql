-- Enforce unique serial numbers when present (case-insensitive).
-- Blank / whitespace-only values become NULL so multiple assets may omit SN.
-- Existing duplicates are reported via NOTICE and skip the unique index;
-- application-level checks still block new writes.

ALTER TABLE assets ALTER COLUMN serial_number DROP NOT NULL;

UPDATE assets
   SET serial_number = NULL
 WHERE serial_number IS NOT NULL AND btrim(serial_number) = '';

DO $$
DECLARE
  dup_count int;
  sample text;
BEGIN
  SELECT COUNT(*), MIN(sn) INTO dup_count, sample
  FROM (
    SELECT lower(btrim(serial_number)) AS sn
      FROM assets
     WHERE serial_number IS NOT NULL AND btrim(serial_number) <> ''
     GROUP BY 1
    HAVING COUNT(*) > 1
  ) d;

  IF coalesce(dup_count, 0) > 0 THEN
    RAISE NOTICE
      'itacm: % duplicate serial_number value(s) already exist (e.g. "%") — unique index skipped. Clean duplicates, then: CREATE UNIQUE INDEX idx_assets_serial_number_unique ON assets (lower(btrim(serial_number))) WHERE serial_number IS NOT NULL AND btrim(serial_number) <> '''';',
      dup_count, sample;
  ELSE
    EXECUTE $idx$
      CREATE UNIQUE INDEX IF NOT EXISTS idx_assets_serial_number_unique
        ON assets (lower(btrim(serial_number)))
        WHERE serial_number IS NOT NULL AND btrim(serial_number) <> ''
    $idx$;
  END IF;
END $$;
