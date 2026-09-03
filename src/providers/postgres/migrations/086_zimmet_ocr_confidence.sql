-- How confidently OCR read a scanned form, 0-100.
--
-- via_ocr already says the text came from a scan; this says how much of it the
-- reader actually understood. Without it every OCR'd form looks alike in review:
-- a name lifted cleanly from a 300dpi scan and one guessed out of a smudged fax
-- both arrive as "medium", and the person reviewing has no way to tell which is
-- which.
--
-- NULL means the form had a text layer and was never OCR'd — distinct from 0,
-- which means it was read and nothing legible came back.
ALTER TABLE zimmet_import_items
  ADD COLUMN IF NOT EXISTS ocr_confidence smallint
    CHECK (ocr_confidence IS NULL OR (ocr_confidence BETWEEN 0 AND 100));
