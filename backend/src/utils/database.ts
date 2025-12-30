/**
 * Database connection and query utilities
 * Uses parameterized queries to prevent SQL injection
 */

import pg from 'pg';
import { config } from '../config/index.js';
import { logger } from './logger.js';

const { Pool } = pg;

// Create connection pool
export const pool = new Pool({
  host: config.database.host,
  port: config.database.port,
  database: config.database.database,
  user: config.database.user,
  password: config.database.password,
  max: config.database.max_connections,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  ssl: config.database.ssl,
});

// Pool error handler
pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected database pool error');
});

// Pool connection handler
pool.on('connect', () => {
  logger.debug('Database pool connection established');
});

/**
 * Execute a query with parameters (prevents SQL injection)
 */
export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<pg.QueryResult<T>> {
  const start = Date.now();
  try {
    const result = await pool.query<T>(text, params);
    const duration = Date.now() - start;
    logger.debug(
      {
        query: text,
        duration,
        rows: result.rowCount,
      },
      'Query executed'
    );
    return result;
  } catch (err) {
    logger.error(
      {
        err,
        query: text,
        duration: Date.now() - start,
      },
      'Query execution failed'
    );
    throw err;
  }
}

/**
 * Execute a transaction
 */
export async function transaction<T>(
  callback: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Health check query
 */
export async function healthCheck(): Promise<boolean> {
  try {
    await query('SELECT 1');
    return true;
  } catch (err) {
    logger.error({ err }, 'Database health check failed');
    return false;
  }
}

/**
 * Graceful shutdown
 */
export async function closePool(): Promise<void> {
  await pool.end();
  logger.info('Database pool closed');
}
