const { Pool } = require('pg');
require('dotenv').config({ path: '../deployment/.env' });

const pool = new Pool({
  user: process.env.POSTGRES_USER,
  host: 'localhost',
  database: process.env.POSTGRES_DB,
  password: process.env.POSTGRES_PASSWORD,
  port: 5434, // External port from docker-compose
});

async function test() {
  try {
    const res = await pool.query('SELECT user_id, name, phone FROM users LIMIT 10');
    console.log('Users in DB:');
    console.table(res.rows);
  } catch (err) {
    console.error('Connection error:', err.message);
  } finally {
    await pool.end();
  }
}

test();
