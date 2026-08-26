-- DSA accidental portfolio-test cleanup — 2026-08-26
--
-- Removes only the 24 records accidentally created by the portfolio test run:
-- account IDs 2 through 25, broker = Demo, created from 2026-08-26 11:42:28
-- through 2026-08-26 11:43:20 (Asia/Shanghai application time).
-- Account #1 (涨乐财付通) is explicitly outside this scope.
--
-- The guard aborts without changing anything if the target set is no longer
-- exactly the expected 24 test accounts.  Run this as one script in Supabase
-- SQL Editor if a manual cleanup is required.

BEGIN;

DO $$
DECLARE
  target_count integer;
  invalid_count integer;
BEGIN
  SELECT COUNT(*)
    INTO target_count
    FROM dsa_portfolio_accounts
   WHERE id BETWEEN 2 AND 25;

  SELECT COUNT(*)
    INTO invalid_count
    FROM dsa_portfolio_accounts
   WHERE id BETWEEN 2 AND 25
     AND (
       broker IS DISTINCT FROM 'Demo'
       OR created_at < TIMESTAMP '2026-08-26 11:42:28'
       OR created_at >= TIMESTAMP '2026-08-26 11:43:20'
     );

  IF target_count <> 24 OR invalid_count <> 0 THEN
    RAISE EXCEPTION
      'Refusing cleanup: expected 24 matching accidental test accounts, found % target / % invalid',
      target_count, invalid_count;
  END IF;
END $$;

-- Delete dependent rows first because all account foreign keys are NO ACTION.
DELETE FROM dsa_portfolio_position_lots
 WHERE account_id BETWEEN 2 AND 25;

DELETE FROM dsa_portfolio_daily_snapshots
 WHERE account_id BETWEEN 2 AND 25;

DELETE FROM dsa_portfolio_positions
 WHERE account_id BETWEEN 2 AND 25;

DELETE FROM dsa_portfolio_corporate_actions
 WHERE account_id BETWEEN 2 AND 25;

DELETE FROM dsa_portfolio_cash_ledger
 WHERE account_id BETWEEN 2 AND 25;

DELETE FROM dsa_portfolio_trades
 WHERE account_id BETWEEN 2 AND 25;

DELETE FROM dsa_portfolio_accounts
 WHERE id BETWEEN 2 AND 25;

COMMIT;

-- Expected result after a successful run: only account #1 remains, and all
-- portfolio child tables contain zero rows for account IDs 2 through 25.
