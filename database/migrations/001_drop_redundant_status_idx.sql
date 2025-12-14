-- Migration: Remove redundant single-column index on mcp_execution.status_text
-- Date: 2025-12-14
-- Reason: The composite index idx_mcp_execution_status_created(status_text, created_at)
--         already covers all queries that filter by status_text together with created_at.
--         The single-column index mcp_execution_status_idx is redundant and adds
--         unnecessary write and storage overhead.
--
-- Query Pattern Analysis:
--   All queries filtering by status_text also ORDER BY created_at DESC,
--   which makes the composite index idx_mcp_execution_status_created optimal.
--   See backend/src/modules/mcp/repository.ts:getMcpExecutions() for reference.
--
-- Impact: Reduces write overhead on INSERT/UPDATE/DELETE operations and saves storage space.
-- Rollback: To restore the index, run:
--   CREATE INDEX mcp_execution_status_idx ON app_core.mcp_execution(status_text);

DROP INDEX IF EXISTS app_core.mcp_execution_status_idx;
