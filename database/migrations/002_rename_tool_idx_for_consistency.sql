-- Migration: Rename mcp_execution_tool_idx to idx_mcp_execution_tool for consistency
-- Date: 2025-12-14
-- Reason: Align with project naming convention where all indexes use the idx_ prefix pattern.
--         Existing composite indexes use idx_{table}_{columns} format, so single-column
--         indexes should follow idx_{table}_{column} format for consistency.
--
-- Context: The index was created as mcp_execution_tool_idx (suffix pattern) but should
--          use idx_mcp_execution_tool (prefix pattern) to match other indexes like
--          idx_mcp_execution_tool_created, idx_mcp_execution_status_created, etc.
--
-- Impact: Improves maintainability through consistent naming conventions.
-- Rollback: To revert the change, run:
--   ALTER INDEX IF EXISTS app_core.idx_mcp_execution_tool RENAME TO mcp_execution_tool_idx;

-- Drop the old index if it exists (for idempotency)
DROP INDEX IF EXISTS app_core.mcp_execution_tool_idx;

-- Create the index with the correct name
CREATE INDEX IF NOT EXISTS idx_mcp_execution_tool ON app_core.mcp_execution(tool_uuid);
