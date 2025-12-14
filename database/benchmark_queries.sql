-- Benchmark queries for mcp_execution table
-- These queries demonstrate the effectiveness of the composite indexes
-- Run with EXPLAIN ANALYZE to see execution plans and actual performance
--
-- IMPORTANT: Replace hardcoded UUID values with actual values from your database
-- The UUIDs below (00000000-0000-0000-0000-000000000001, etc.) are placeholders.
-- To get actual UUIDs from your database, run:
--   SELECT org_uuid FROM app_core.org_unit LIMIT 1;
--   SELECT user_uuid FROM app_core.user_account LIMIT 1;
--   SELECT tool_uuid FROM app_core.mcp_tool LIMIT 1;

-- Setup: Create test data (optional, for benchmarking)
-- Uncomment to generate sample data:
/*
DO $$
DECLARE
  org_id UUID;
  user_id UUID;
  tool_id UUID;
  i INT;
BEGIN
  -- Get sample IDs
  SELECT org_uuid INTO org_id FROM app_core.org_unit LIMIT 1;
  SELECT user_uuid INTO user_id FROM app_core.user_account LIMIT 1;
  SELECT tool_uuid INTO tool_id FROM app_core.mcp_tool LIMIT 1;
  
  -- Insert test data
  FOR i IN 1..10000 LOOP
    INSERT INTO app_core.mcp_execution (
      tool_uuid, org_uuid, user_uuid, params_json, status_text, duration_ms
    ) VALUES (
      tool_id,
      org_id,
      user_id,
      '{"param": "value"}'::jsonb,
      CASE (random() * 2)::int
        WHEN 0 THEN 'success'
        WHEN 1 THEN 'error'
        ELSE 'timeout'
      END,
      (random() * 1000)::int
    );
  END LOOP;
END $$;
*/

-- Query 1: Filter by org_uuid with ORDER BY created_at (most common pattern)
-- Expected: Uses idx_mcp_execution_org_created
EXPLAIN ANALYZE
SELECT * FROM app_core.mcp_execution
WHERE org_uuid = '00000000-0000-0000-0000-000000000001'::uuid
ORDER BY created_at DESC
LIMIT 50;

-- Query 2: Filter by tool_uuid only (tests if composite index works for single-column filter)
-- Expected: Uses idx_mcp_execution_tool_created
EXPLAIN ANALYZE
SELECT * FROM app_core.mcp_execution
WHERE tool_uuid = '00000000-0000-0000-0000-000000000002'::uuid
ORDER BY created_at DESC
LIMIT 50;

-- Query 3: Filter by status_text only
-- Expected: Uses idx_mcp_execution_status_created
EXPLAIN ANALYZE
SELECT * FROM app_core.mcp_execution
WHERE status_text = 'error'
ORDER BY created_at DESC
LIMIT 50;

-- Query 4: Filter by tool_uuid and status_text
-- Expected: Uses idx_mcp_execution_tool_created (most selective)
EXPLAIN ANALYZE
SELECT * FROM app_core.mcp_execution
WHERE tool_uuid = '00000000-0000-0000-0000-000000000002'::uuid
  AND status_text = 'error'
ORDER BY created_at DESC
LIMIT 50;

-- Query 5: Filter by date range and org_uuid
-- Expected: Uses idx_mcp_execution_org_created
EXPLAIN ANALYZE
SELECT * FROM app_core.mcp_execution
WHERE org_uuid = '00000000-0000-0000-0000-000000000001'::uuid
  AND created_at >= NOW() - INTERVAL '7 days'
ORDER BY created_at DESC
LIMIT 50;

-- Query 6: COUNT(*) without filters (unavoidable sequential scan)
-- Expected: Sequential scan
EXPLAIN ANALYZE
SELECT COUNT(*) FROM app_core.mcp_execution;

-- Query 7: COUNT(*) with filter (uses index)
-- Expected: Uses appropriate index
EXPLAIN ANALYZE
SELECT COUNT(*) FROM app_core.mcp_execution
WHERE org_uuid = '00000000-0000-0000-0000-000000000001'::uuid;

-- Query 8: Aggregate statistics by status (similar to usage patterns)
-- Expected: Uses indexes for filtering
EXPLAIN ANALYZE
SELECT 
  status_text,
  COUNT(*) as count,
  AVG(duration_ms) as avg_duration,
  MAX(duration_ms) as max_duration
FROM app_core.mcp_execution
WHERE org_uuid = '00000000-0000-0000-0000-000000000001'::uuid
  AND created_at >= NOW() - INTERVAL '30 days'
GROUP BY status_text;

-- Index usage statistics
-- Run after executing queries to see which indexes are being used
SELECT 
  schemaname,
  tablename,
  indexname,
  idx_scan as scans,
  idx_tup_read as tuples_read,
  idx_tup_fetch as tuples_fetched,
  pg_size_pretty(pg_relation_size(indexrelid)) as index_size
FROM pg_stat_user_indexes
WHERE schemaname = 'app_core' 
  AND tablename = 'mcp_execution'
ORDER BY idx_scan DESC;

-- Table and index size statistics
SELECT 
  pg_size_pretty(pg_total_relation_size('app_core.mcp_execution')) as total_size,
  pg_size_pretty(pg_relation_size('app_core.mcp_execution')) as table_size,
  pg_size_pretty(pg_total_relation_size('app_core.mcp_execution') - pg_relation_size('app_core.mcp_execution')) as indexes_size,
  (SELECT COUNT(*) FROM app_core.mcp_execution) as row_count;

-- Approximate count using PostgreSQL statistics (fast alternative to COUNT(*))
SELECT 
  schemaname,
  relname,
  n_live_tup as approximate_row_count,
  n_dead_tup as dead_tuples,
  last_autovacuum,
  last_autoanalyze
FROM pg_stat_user_tables
WHERE schemaname = 'app_core' 
  AND relname = 'mcp_execution';
