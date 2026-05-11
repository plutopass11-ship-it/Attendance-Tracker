// attendance-processor.js
// Reusable attendance logic shared between web check-in and ZKTeco device punches

function getTodayStr() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

async function processPunch(pool, appUserId, punchTime) {
  const dateStr = `${punchTime.getFullYear()}-${String(punchTime.getMonth() + 1).padStart(2, '0')}-${String(punchTime.getDate()).padStart(2, '0')}`;
  const timeStr = punchTime.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });

  // Check WFH leave today
  const wfhRes = await pool.query(
    `SELECT 1 FROM leave_requests
     WHERE user_id = $1 AND status = 'approved'
       AND start_date <= $2 AND end_date >= $2
       AND (LOWER(type) LIKE '%wfh%' OR LOWER(type) = 'work from home')
     LIMIT 1`,
    [appUserId, dateStr]
  );
  const isWfh = wfhRes.rowCount > 0;

  // Get today's record
  const attRes = await pool.query(
    'SELECT id, check_in_time, check_out_time, status FROM attendance WHERE user_id = $1 AND date = $2',
    [appUserId, dateStr]
  );

  let action = null;
  let newStatus = null;

  if (attRes.rowCount === 0) {
    // CHECK IN
    const checkInStatus = isWfh ? 'wfh_working' : 'working';
    await pool.query(
      `INSERT INTO attendance (user_id, date, check_in_time, status)
       VALUES ($1, $2, NOW(), $3)
       ON CONFLICT (user_id, date) DO UPDATE SET status = EXCLUDED.status`,
      [appUserId, dateStr, checkInStatus]
    );
    action = 'check_in';
    newStatus = checkInStatus;
  } else {
    const record = attRes.rows[0];
    if (!record.check_out_time && !record.status?.includes('completed')) {
      // CHECK OUT
      const checkInTime = new Date(record.check_in_time);
      const hoursWorked = (punchTime - checkInTime) / (1000 * 60 * 60);
      const baseStatus = isWfh ? 'wfh_' : '';

      let finalStatus = baseStatus + 'completed';
      if (hoursWorked < 4) {
        await pool.query(
          `INSERT INTO leave_requests (user_id, type, start_date, end_date, reason, status)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [appUserId, 'Casual Leave (Half Day)', dateStr, dateStr, 'Auto-generated Short Shift (< 4 hours)', 'pending']
        );
      } else if (hoursWorked < 8) {
        finalStatus = baseStatus + 'pending_early_clockout';
      }

      await pool.query(
        'UPDATE attendance SET check_out_time = NOW(), status = $1 WHERE id = $2',
        [finalStatus, record.id]
      );
      action = 'check_out';
      newStatus = finalStatus;
    } else {
      action = 'ignored';
      newStatus = record.status;
    }
  }

  return { action, dateStr, timeStr, newStatus };
}

module.exports = { processPunch, getTodayStr };
