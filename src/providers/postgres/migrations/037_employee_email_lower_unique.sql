-- Case-insensitive uniqueness for the email addresses that act as identity keys.
--
-- employees.email links an employee to their login and is what /api/me/zimmet
-- resolves the caller by; users.email is the login itself. Both carry a plain
-- UNIQUE constraint, which Postgres enforces byte-exactly — so "Ali@corp.com"
-- and "ali@corp.com" could coexist as two rows. Every write path lowercases
-- now, but rows written before that fix (or by an older updateEmployee, which
-- did not normalize) may already be split.
--
-- This migration must never block a server start, so it repairs what it safely
-- can and warns instead of failing when a human decision is needed.

DO $$
DECLARE
  dupe_employees INT;
  dupe_users     INT;
BEGIN
  -- 1) Lowercase every row whose lowercase form is not already taken by a
  --    different row. This is a pure normalization: no identity is merged.
  UPDATE employees e
     SET email = lower(e.email)
   WHERE e.email <> lower(e.email)
     AND NOT EXISTS (
       SELECT 1 FROM employees o WHERE o.id <> e.id AND o.email = lower(e.email)
     );

  UPDATE users u
     SET email = lower(u.email)
   WHERE u.email <> lower(u.email)
     AND NOT EXISTS (
       SELECT 1 FROM users o WHERE o.id <> u.id AND o.email = lower(u.email)
     );

  -- 2) Whatever is left is a genuine collision — two records claiming the same
  --    identity. Merging them is a business decision, not a migration's call.
  SELECT count(*) INTO dupe_employees
    FROM (SELECT 1 FROM employees GROUP BY lower(email) HAVING count(*) > 1) d;
  SELECT count(*) INTO dupe_users
    FROM (SELECT 1 FROM users GROUP BY lower(email) HAVING count(*) > 1) d;

  IF dupe_employees = 0 THEN
    CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_email_lower
      ON employees (lower(email));
  ELSE
    RAISE WARNING '[itacm] % employee email(s) differ only by case — unique index NOT created. Merge the duplicates (SELECT lower(email), count(*) FROM employees GROUP BY 1 HAVING count(*) > 1), then run: CREATE UNIQUE INDEX idx_employees_email_lower ON employees (lower(email));', dupe_employees;
  END IF;

  IF dupe_users = 0 THEN
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower
      ON users (lower(email));
  ELSE
    RAISE WARNING '[itacm] % user email(s) differ only by case — unique index NOT created. Merge the duplicates, then run: CREATE UNIQUE INDEX idx_users_email_lower ON users (lower(email));', dupe_users;
  END IF;
END $$;
