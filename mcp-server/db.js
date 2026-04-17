const { Pool } = require('pg');

const pool = new Pool({
    user: process.env.POSTGRES_USER || 'attendance_admin',
    host: process.env.POSTGRES_HOST || 'attendance-db',
    database: process.env.POSTGRES_DB || 'attendance_tracker',
    password: process.env.POSTGRES_PASSWORD || 'AttendancePluto@2026',
    port: process.env.POSTGRES_PORT || 5432,
});

/**
 * Verify database connectivity on startup.
 * Throws on failure so the container crashes cleanly (Docker will restart it).
 */
async function testConnection() {
    const client = await pool.connect();
    try {
        const result = await client.query('SELECT NOW() AS now');
        console.log(`[MCP-DB] Connected to PostgreSQL at ${result.rows[0].now}`);
    } finally {
        client.release();
    }
}

module.exports = { pool, testConnection };
