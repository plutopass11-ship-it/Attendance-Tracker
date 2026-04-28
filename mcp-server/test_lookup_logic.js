const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Manually read .env
const envPath = path.join(__dirname, '../deployment/.env');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const [key, value] = line.split('=');
  if (key && value) env[key.trim()] = value.trim();
});

const pool = new Pool({
  user: env.POSTGRES_USER,
  host: 'localhost',
  database: env.POSTGRES_DB,
  password: env.POSTGRES_PASSWORD,
  port: 5434, 
});

async function testLookup() {
  const phone = '9747296409';
  console.log(`Testing lookup for: ${phone}`);

  // This is the EXACT logic from tools.js
  const digits = phone.replace(/\D/g, '');
  const last10 = digits.slice(-10);
  console.log(`Normalized last 10 digits for matching: ${last10}`);

  try {
    const result = await pool.query(
        `SELECT user_id, name, role, phone
         FROM users
         WHERE REGEXP_REPLACE(phone, '\\D', '', 'g') LIKE '%' || $1`,
        [last10]
    );

    if (result.rowCount === 0) {
      console.log('\n❌ Result: User NOT found.');
      console.log('Ensure this number is exactly what you have in Kitsu settings.');
    } else {
      console.log('\n✅ Result: User FOUND!');
      console.table(result.rows);
    }
  } catch (err) {
    console.error('❌ Database error:', err.message);
  } finally {
    await pool.end();
  }
}

testLookup();
