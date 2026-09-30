const { Pool } = require('../backend/node_modules/pg');

const pool = new Pool({
  user: 'attendance_admin',
  host: '192.168.1.60',
  database: 'attendance_tracker',
  password: 'AttendancePluto@2026',
  port: 5434,
});

const ESP32_URL = 'http://192.168.1.73';

async function syncTemplates() {
  console.log('Connecting to PostgreSQL on 192.168.1.60:5434...');
  const client = await pool.connect();

  try {
    // 1. Get all enrolled users from DB
    const res = await client.query('SELECT fingerprint_id, user_id, name, template_data FROM biometric_users ORDER BY fingerprint_id ASC');
    console.log(`Found ${res.rows.length} enrolled biometric user(s) in database.\n`);

    let backedUpCount = 0;
    for (const user of res.rows) {
      const slot = user.fingerprint_id;
      process.stdout.write(`Slot #${String(slot).padStart(2, '0')} (${user.name})... `);

      try {
        const fetchRes = await fetch(`${ESP32_URL}/template?slot=${slot}`, { signal: AbortSignal.timeout(4000) });
        if (!fetchRes.ok) {
          console.log(`Sensor returned HTTP ${fetchRes.status}`);
          continue;
        }

        const data = await fetchRes.json();
        if (data.template && data.template.length > 50) {
          await client.query(
            'UPDATE biometric_users SET template_data = $1 WHERE fingerprint_id = $2',
            [data.template, slot]
          );
          console.log(`Saved template (${data.template.length} hex chars / 512 bytes)`);
          backedUpCount++;
        } else {
          console.log('Empty template received');
        }
      } catch (err) {
        console.log(`Failed: ${err.message}`);
      }

      // Small pause between UART transfers
      await new Promise(r => setTimeout(r, 150));
    }

    console.log(`\n==============================================`);
    console.log(`Done! Backed up ${backedUpCount}/${res.rows.length} biometric templates into PostgreSQL.`);
    console.log(`==============================================`);

  } finally {
    client.release();
    pool.end();
  }
}

syncTemplates().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
