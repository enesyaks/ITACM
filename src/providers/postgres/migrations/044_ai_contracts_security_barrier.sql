-- Harden the AI read-only surface against leaky-qual oracles.
-- ai.contracts filters out Confidential rows (visibility <> 'Confidential').
-- Without security_barrier, Postgres may push a caller's WHERE qual below that
-- filter, letting a crafted predicate (e.g. an arithmetic error like 1/0 on a
-- CASE over a hidden row) act as a boolean/error oracle over rows the view is
-- meant to hide. security_barrier forces the view's own quals to run first.

ALTER VIEW ai.contracts SET (security_barrier = true);
