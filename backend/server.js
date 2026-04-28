const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  user: process.env.POSTGRES_USER || 'attendance_admin',
  host: process.env.POSTGRES_HOST || 'attendance-db',
  database: process.env.POSTGRES_DB || 'attendance_tracker',
  password: process.env.POSTGRES_PASSWORD || 'AttendancePluto@2026',
  port: process.env.POSTGRES_PORT || 5432,
});

const KITSU_URL = process.env.KITSU_URL || 'http://host.docker.internal:3002';
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || '';  // e.g. http://n8n:5678/webhook/leave-status-changed

// --- Service Account (Admin Token Cache) ---
// Uses a dedicated Kitsu admin account to fetch person data,
// since non-admin Kitsu users can't access /api/data/persons.
const KITSU_ADMIN_EMAIL = process.env.KITSU_ADMIN_EMAIL || '';
const KITSU_ADMIN_PASSWORD = process.env.KITSU_ADMIN_PASSWORD || '';
let cachedAdminToken = null;
let adminTokenExpiry = 0;

async function columnExists(tableName, columnName) {
  const result = await pool.query(
    `
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
        AND column_name = $2
      LIMIT 1;
    `,
    [tableName, columnName]
  );

  return result.rowCount > 0;
}

async function tableExists(tableName) {
  const result = await pool.query(
    `
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = $1
      LIMIT 1;
    `,
    [tableName]
  );

  return result.rowCount > 0;
}

async function getAdminToken() {
  // Return cached token if still valid (refresh every 30 min)
  if (cachedAdminToken && Date.now() < adminTokenExpiry) {
    return cachedAdminToken;
  }
  if (!KITSU_ADMIN_EMAIL || !KITSU_ADMIN_PASSWORD) {
    console.error('KITSU_ADMIN_EMAIL or KITSU_ADMIN_PASSWORD not set!');
    return null;
  }
  console.log('Refreshing Kitsu admin token...');
  const token = await loginToKitsu(KITSU_ADMIN_EMAIL, KITSU_ADMIN_PASSWORD);
  if (token) {
    cachedAdminToken = token;
    adminTokenExpiry = Date.now() + 30 * 60 * 1000; // 30 minutes
    console.log('Admin token cached successfully.');
  } else {
    console.error('Failed to obtain admin token from Kitsu!');
  }
  return token;
}

// Utility to execute Kitsu login (verifies any user's credentials)
async function loginToKitsu(email, password) {
  try {
    const response = await fetch(`${KITSU_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data.access_token;
  } catch (error) {
    console.error('Kitsu Login Error:', error);
    return null;
  }
}

// Utility to get user info from Kitsu using the ADMIN token
async function getKitsuUser(email) {
  try {
    const adminToken = await getAdminToken();
    if (!adminToken) {
      console.error('No admin token available to fetch persons');
      return null;
    }
    const response = await fetch(`${KITSU_URL}/api/data/persons`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    if (!response.ok) {
      console.error('Kitsu persons API returned:', response.status);
      // Force token refresh on next attempt
      cachedAdminToken = null;
      return null;
    }
    const persons = await response.json(); 
    return persons.find(p => p.email === email);
  } catch (err) {
    console.error('Kitsu fetch user error:', err);
    return null;
  }
}

// 1. Authentication Endpoint (Kitsu Proxy)
app.post('/api/auth/login', async (req, res) => {
  const { userId: email, password } = req.body;

  // --- Bypass for SuperAdmin default ---
  if(email === 'admin1' && password === 'password') {
       return res.json({ success: true, user: { id: 'admin1', name: 'Super Admin', role: 'admin' }});
  }

  // Step 1: Verify the user's OWN credentials against Kitsu
  const userToken = await loginToKitsu(email, password);
  if (!userToken) {
    return res.status(401).json({ success: false, message: 'Invalid Kitsu credentials' });
  }

  // Step 2: Use the ADMIN service account to fetch the user's profile
  const kitsuUser = await getKitsuUser(email);
  if (!kitsuUser) {
    return res.status(500).json({ success: false, message: 'Failed to fetch Kitsu profile' });
  }

  // Format the user
  const fullName = `${kitsuUser.first_name || ''} ${kitsuUser.last_name || ''}`.trim();
  const role = ['admin', 'studio_manager'].includes(kitsuUser.role) ? 'admin' : 'user';
  const phone = kitsuUser.phone || null; // Sync phone from Kitsu for WhatsApp identity
  const slackId = kitsuUser.notifications_slack_userid || null; // Sync Slack Member ID

  // Upsert user into purely local Postgres Database to sync them natively
  try {
    const result = await pool.query(
      `INSERT INTO users (user_id, name, password, role, phone, slack_id) 
       VALUES ($1, $2, 'synced_from_kitsu', $3, $4, $5)
       ON CONFLICT (user_id) 
       DO UPDATE SET name = $2, role = $3, phone = COALESCE($4, users.phone), slack_id = COALESCE($5, users.slack_id)
       RETURNING id, user_id, name, role`,
      [email, fullName, role, phone, slackId]
    );

    // Provide response directly mirroring Store.js output
    const userForFrontend = {
      id: result.rows[0].user_id,
      name: result.rows[0].name,
      role: result.rows[0].role
    };

    res.json({ success: true, user: userForFrontend });
  } catch (err) {
    console.error('DB Sync Error:', err);
    res.status(500).json({ success: false, message: 'Database sync error' });
  }
});


// 2. Data Retrieval endpoints (Admin Dashboard / Load Store)
app.get('/api/sync/store', async (req, res) => {
  try {
    const [
      hasHistoricalLeaves,
      hasPolicyLabel,
      hasPolicyQuota,
      hasPolicyCycle
    ] = await Promise.all([
      columnExists('leave_requests', 'is_historical'),
      columnExists('leave_policies', 'label'),
      columnExists('leave_policies', 'quota'),
      columnExists('leave_policies', 'cycle')
    ]);

    const users = await pool.query('SELECT user_id as id, name, role FROM users;');
    const leaves = await pool.query(`
      SELECT id::text, user_id as "userId", type, 
             CAST(start_date as text) as "startDate", 
             CAST(end_date as text) as "endDate", 
             reason, status,
             ${hasHistoricalLeaves ? 'COALESCE(is_historical, false)' : 'false::boolean'} as "isHistorical"
      FROM leave_requests ORDER BY id DESC;
    `);
    const policies = await pool.query(`
      SELECT
        id::text,
        ${hasPolicyLabel ? 'label' : 'type'} as "name",
        ${hasPolicyQuota ? 'quota' : '12'} as "limit",
        ${hasPolicyCycle ? 'cycle' : "'yearly'"} as "cycle"
      FROM leave_policies;
    `);
    const dates = await pool.query(`
      SELECT CAST(date as text) as "date", name, 
             CASE WHEN type='public' THEN 'Public' WHEN type='optional' THEN 'Optional' ELSE type END as "type" 
      FROM holidays ORDER BY date ASC;
    `);
    const attendance = await pool.query(`
      SELECT user_id as "userId", CAST(date as text) as "date", 
             check_in_time as "checkInTime", check_out_time as "checkOutTime",
             status
      FROM attendance;
    `);

    // Capitalize status for frontend compatibility
    const formattedLeaves = leaves.rows.map(l => ({
      ...l,
      status: l.status ? l.status.charAt(0).toUpperCase() + l.status.slice(1) : l.status
    }));

    res.json({
        users: users.rows,
        leaves: formattedLeaves,
        leaveTypes: policies.rows,
        holidays: dates.rows,
        attendance: attendance.rows.map(a => ({
          ...a,
          checkInTime: a.checkInTime ? new Date(a.checkInTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : null,
          checkOutTime: a.checkOutTime ? new Date(a.checkOutTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : null
        }))
    });
  } catch (err) {
    console.error('Store fetch error:', err);
    res.status(500).json({ error: 'Database fetch error', details: err.message });
  }
});

// 3. Mark Attendance (Check in/out)
app.post('/api/attendance', async (req, res) => {
  const { userId, date, time, isCheckOut } = req.body;
  try {
    if (!isCheckOut) {
      const wfhRes = await pool.query(
        `SELECT 1
         FROM leave_requests
         WHERE user_id = $1
           AND status = 'approved'
           AND start_date <= $2
           AND end_date >= $2
           AND (LOWER(type) LIKE '%wfh%' OR LOWER(type) = 'work from home')
         LIMIT 1`,
        [userId, date]
      );
      const checkInStatus = wfhRes.rowCount > 0 ? 'wfh_working' : 'working';

      await pool.query(
        `INSERT INTO attendance (user_id, date, check_in_time, status) VALUES ($1, $2, NOW(), $3) 
         ON CONFLICT (user_id, date) DO UPDATE SET status = EXCLUDED.status`,
        [userId, date, checkInStatus]
      );
    } else {
      const client = await pool.connect();
      try {
          await client.query('BEGIN');
          const attRes = await client.query(`SELECT check_in_time, check_out_time, status FROM attendance WHERE user_id = $1 AND date = $2 FOR UPDATE`, [userId, date]);
          
          if (attRes.rowCount > 0) {
              const record = attRes.rows[0];
              if (record.check_out_time) {
                  await client.query('ROLLBACK');
                  return res.json({ success: true, message: 'Already checked out' });
              }
              
              const checkInTime = new Date(record.check_in_time);
              const now = new Date();
              const hoursWorked = (now - checkInTime) / (1000 * 60 * 60);
              const isWfhAttendance = typeof record.status === 'string' && record.status.startsWith('wfh_');
              
              let newStatus = isWfhAttendance ? 'wfh_completed' : 'completed';
              
              if (hoursWorked < 4) {
                 // Auto-generate Half Day Leave
                 await client.query(
                    `INSERT INTO leave_requests (user_id, type, start_date, end_date, reason, status)
                     VALUES ($1, $2, $3, $4, $5, $6)`,
                     [userId, 'Casual Leave (Half Day)', date, date, 'Auto-generated Short Shift (< 4 hours)', 'pending'] 
                 );
              } else if (hoursWorked < 8) {
                 newStatus = isWfhAttendance ? 'wfh_pending_early_clockout' : 'pending_early_clockout';
              }
              
              await client.query(
                  `UPDATE attendance SET check_out_time = NOW(), status = $3 WHERE user_id = $1 AND date = $2`,
                  [userId, date, newStatus]
              );
          }
          await client.query('COMMIT');
      } catch(txnErr) {
          await client.query('ROLLBACK');
          throw txnErr;
      } finally {
          client.release();
      }
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
});

// 3b. Approve/Reject Early Clock-Out
app.put('/api/attendance/approve', async (req, res) => {
    const { userId, date, action } = req.body;
    try {
        const existing = await pool.query(
            'SELECT status FROM attendance WHERE user_id = $1 AND date = $2',
            [userId, date]
        );
        const currentStatus = existing.rows[0]?.status || 'working';
        const isWfhAttendance = typeof currentStatus === 'string' && currentStatus.startsWith('wfh_');

        let q = `UPDATE attendance SET status = $1 WHERE user_id = $2 AND date = $3`;
        let params = [isWfhAttendance ? 'wfh_completed' : 'completed', userId, date];
        if (action === 'reject') {
           q = `UPDATE attendance SET status = $1, check_out_time = NULL WHERE user_id = $2 AND date = $3`;
           params = [isWfhAttendance ? 'wfh_working' : 'working', userId, date];
        }
        await pool.query(q, params);
        res.json({ success: true });
    } catch(err) {
        console.error(err);
        res.status(500).json({ success: false });
    }
});

// 4. Submit Leave Request  (status stored lowercase for DB constraint)
app.post('/api/leaves', async (req, res) => {
    const { userId, type, startDate, endDate, reason, status, isHalfDay } = req.body;
    try {
        const dbStatus = (status || 'Pending').toLowerCase();
        await pool.query(
            `INSERT INTO leave_requests (user_id, type, start_date, end_date, reason, status)
             VALUES ($1, $2, $3, $4, $5, $6)`,
             [userId, type, startDate, endDate, reason, dbStatus]
        );
        res.json({ success: true });
    } catch(err) {
        console.error('Leave insert error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

app.put('/api/leaves/:id', async (req, res) => {
   const { status, type, startDate, endDate, reason } = req.body;
   try {
       let result;
       if (type && startDate && endDate) {
           // Full edit mode: update all fields
           const dbStatus = (status || 'approved').toLowerCase();
           result = await pool.query(
               `UPDATE leave_requests SET type = $1, start_date = $2, end_date = $3, reason = $4, status = $5 WHERE id = $6
                RETURNING id, user_id, type, CAST(start_date AS text) as start_date, CAST(end_date AS text) as end_date, status`,
               [type, startDate, endDate, reason || '', dbStatus, req.params.id]
           );
       } else {
           // Status-only update (existing behavior)
           const dbStatus = (status || 'pending').toLowerCase();
           result = await pool.query(
               `UPDATE leave_requests SET status = $1 WHERE id = $2
                RETURNING id, user_id, type, CAST(start_date AS text) as start_date, CAST(end_date AS text) as end_date, status`,
               [dbStatus, req.params.id]
           );
       }

       // If a non-WFH leave is approved, void any conflicting attendance records for those dates
       if (result.rowCount > 0) {
           const leave = result.rows[0];
           const leaveType = (leave.type || '').toLowerCase();
           const isWfh = leaveType.includes('wfh') || leaveType === 'work from home';
           if (!isWfh && leave.status === 'approved') {
               await pool.query(
                   `DELETE FROM attendance WHERE user_id = $1 AND date >= $2 AND date <= $3`,
                   [leave.user_id, leave.start_date, leave.end_date]
               );
           }
       }

       res.json({ success: true });

       // Fire-and-forget webhook to n8n for WhatsApp notifications
       if (N8N_WEBHOOK_URL && result.rowCount > 0) {
           const leave = result.rows[0];
           fetch(N8N_WEBHOOK_URL, {
               method: 'POST',
               headers: { 'Content-Type': 'application/json' },
               body: JSON.stringify({
                   event: 'leave_status_changed',
                   leaveId: leave.id,
                   userId: leave.user_id,
                   type: leave.type,
                   startDate: leave.start_date,
                   endDate: leave.end_date,
                   newStatus: leave.status
               })
           }).catch(e => console.error('n8n webhook error (non-critical):', e.message));
       }
   } catch(err) {
       console.error(err);
       res.status(500).json({ success: false });
   }
});

// 4b. Delete a specific leave request
app.delete('/api/leaves/:id', async (req, res) => {
    try {
        const result = await pool.query(
            'DELETE FROM leave_requests WHERE id = $1 RETURNING id',
            [req.params.id]
        );
        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, message: 'Leave record not found' });
        }
        res.json({ success: true });
    } catch (err) {
        console.error('Leave delete error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// 4c. Delete an attendance record for a specific user/date (admin cleanup)
app.delete('/api/attendance/:userId/:date', async (req, res) => {
    try {
        const result = await pool.query(
            'DELETE FROM attendance WHERE user_id = $1 AND date = $2 RETURNING user_id',
            [req.params.userId, req.params.date]
        );
        res.json({ success: true, deleted: result.rowCount });
    } catch (err) {
        console.error('Attendance delete error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});


// 5. Leave Policy CRUD
app.post('/api/policies', async (req, res) => {
    const { name, limit, cycle } = req.body;
    try {
        const slug = name.toLowerCase().replace(/\s+/g, '_');
        const result = await pool.query(
            `INSERT INTO leave_policies (type, label, quota, cycle) VALUES ($1, $2, $3, $4)
             ON CONFLICT (type) DO UPDATE SET label=$2, quota=$3, cycle=$4
             RETURNING id::text, label as name, quota as limit, cycle`,
            [slug, name, limit, cycle || 'yearly']
        );
        res.json({ success: true, policy: result.rows[0] });
    } catch(err) {
        console.error('Policy add error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

app.put('/api/policies/:id', async (req, res) => {
    const { name, limit, cycle } = req.body;
    try {
        await pool.query(
            'UPDATE leave_policies SET label=$1, quota=$2, cycle=$3 WHERE id=$4',
            [name, limit, cycle, req.params.id]
        );
        res.json({ success: true });
    } catch(err) {
        console.error('Policy update error:', err);
        res.status(500).json({ success: false });
    }
});

app.delete('/api/policies/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM leave_policies WHERE id=$1', [req.params.id]);
        res.json({ success: true });
    } catch(err) {
        console.error('Policy delete error:', err);
        res.status(500).json({ success: false });
    }
});


// 6. Holiday CRUD
app.post('/api/holidays', async (req, res) => {
    const { date, name, type } = req.body;
    try {
        const dbType = (type || 'Public').toLowerCase();
        await pool.query(
            `INSERT INTO holidays (date, name, type) VALUES ($1, $2, $3)
             ON CONFLICT (date) DO UPDATE SET name=$2, type=$3`,
            [date, name, dbType]
        );
        res.json({ success: true });
    } catch(err) {
        console.error('Holiday add error:', err);
        res.status(500).json({ success: false });
    }
});

app.put('/api/holidays', async (req, res) => {
    const { oldDate, date, name, type } = req.body;
    try {
        const dbType = (type || 'Public').toLowerCase();
        await pool.query(
            'UPDATE holidays SET date=$1, name=$2, type=$3 WHERE date=$4',
            [date, name, dbType, oldDate]
        );
        res.json({ success: true });
    } catch(err) {
        console.error('Holiday update error:', err);
        res.status(500).json({ success: false });
    }
});

app.delete('/api/holidays/:date', async (req, res) => {
    try {
        await pool.query('DELETE FROM holidays WHERE date=$1', [req.params.date]);
        res.json({ success: true });
    } catch(err) {
        console.error('Holiday delete error:', err);
        res.status(500).json({ success: false });
    }
});


// 7. Delete User
app.delete('/api/users/:id', async (req, res) => {
    const userId = req.params.id;
    try {
        await pool.query('DELETE FROM attendance WHERE user_id = $1', [userId]);
        await pool.query('DELETE FROM leave_requests WHERE user_id = $1', [userId]);
        await pool.query('DELETE FROM users WHERE user_id = $1', [userId]);
        res.json({ success: true });
    } catch (err) {
        console.error('Delete user error:', err);
        res.status(500).json({ success: false, message: 'Delete failed' });
    }
});


// 8. Batch Migration History (Admin-only, AI-agent ready)
app.post('/api/admin/migration/history', async (req, res) => {
    const { records } = req.body;

    if (!Array.isArray(records) || records.length === 0) {
        return res.status(400).json({ success: false, message: 'No records provided. Expected { records: [...] }' });
    }

    const results = { added: 0, failed: 0, errors: [] };
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        for (let i = 0; i < records.length; i++) {
            const r = records[i];
            try {
                if (!r.userId || !r.type || !r.startDate || !r.endDate) {
                    results.failed++;
                    results.errors.push({ index: i, message: 'Missing required fields (userId, type, startDate, endDate)', record: r });
                    continue;
                }

                const dbStatus = (r.status || 'approved').toLowerCase();
                const reason = r.reason || 'Migrated from old system';

                await client.query(
                    `INSERT INTO leave_requests (user_id, type, start_date, end_date, reason, status, is_historical)
                     VALUES ($1, $2, $3, $4, $5, $6, true)`,
                    [r.userId, r.type, r.startDate, r.endDate, reason, dbStatus]
                );
                results.added++;
            } catch (rowErr) {
                results.failed++;
                results.errors.push({ index: i, message: rowErr.message, record: r });
            }
        }

        await client.query('COMMIT');
        res.json({ success: true, summary: results });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Migration batch error:', err);
        res.status(500).json({ success: false, message: 'Transaction failed', error: err.message });
    } finally {
        client.release();
    }
});

// 9. Delete all historical (migrated) records for a user
app.delete('/api/admin/migration/history/:userId', async (req, res) => {
    try {
        const result = await pool.query(
            'DELETE FROM leave_requests WHERE user_id = $1 AND is_historical = true',
            [req.params.userId]
        );
        res.json({ success: true, deletedCount: result.rowCount });
    } catch (err) {
        console.error('Migration delete error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});


// --- Database auto-migration on startup ---
async function runMigrations() {
    try {
        if (await tableExists('leave_requests') && !(await columnExists('leave_requests', 'is_historical'))) {
            await pool.query('ALTER TABLE leave_requests ADD COLUMN is_historical BOOLEAN DEFAULT false;');
        }
        
        if (await tableExists('attendance') && !(await columnExists('attendance', 'status'))) {
            await pool.query("ALTER TABLE attendance ADD COLUMN status VARCHAR(30) DEFAULT 'working';");
        }

        // Fix stuck records from deployment transition: checked out but status still 'working'
        if (await tableExists('attendance')) {
            const fixed = await pool.query(
                "UPDATE attendance SET status = 'completed' WHERE check_out_time IS NOT NULL AND status = 'working'"
            );
            if (fixed.rowCount > 0) console.log(`Fixed ${fixed.rowCount} stuck attendance record(s).`);
        }

        if (await tableExists('leave_policies')) {
            if (!(await columnExists('leave_policies', 'label'))) {
                await pool.query("ALTER TABLE leave_policies ADD COLUMN label VARCHAR(100) DEFAULT '';");
                await pool.query("UPDATE leave_policies SET label = type WHERE label = '' OR label IS NULL;");
                await pool.query('ALTER TABLE leave_policies ALTER COLUMN label SET NOT NULL;');
            }

            if (!(await columnExists('leave_policies', 'quota'))) {
                await pool.query('ALTER TABLE leave_policies ADD COLUMN quota INTEGER DEFAULT 12;');
                await pool.query('ALTER TABLE leave_policies ALTER COLUMN quota SET NOT NULL;');
            }

            if (!(await columnExists('leave_policies', 'cycle'))) {
                await pool.query("ALTER TABLE leave_policies ADD COLUMN cycle VARCHAR(20) DEFAULT 'yearly';");
            }
        }

        // Add phone column for WhatsApp identity (synced from Kitsu)
        if (await tableExists('users') && !(await columnExists('users', 'phone'))) {
            await pool.query('ALTER TABLE users ADD COLUMN phone VARCHAR(20);');
            console.log('Added phone column to users table.');
        }

        // Drop UNIQUE constraint on phone if it exists (multiple accounts can share a phone)
        try {
            await pool.query('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_phone_key;');
        } catch (e) { /* constraint doesn't exist, that's fine */ }

        // Add slack_id column for Slack notifications
        if (await tableExists('users') && !(await columnExists('users', 'slack_id'))) {
            await pool.query('ALTER TABLE users ADD COLUMN slack_id VARCHAR(50);');
            console.log('Added slack_id column to users table.');
        }

        console.log('DB migrations completed.');
    } catch (err) {
        console.error('Migration error:', err);
    }
}

// Startup
const PORT = process.env.PORT || 4000;
runMigrations().then(() => {
    app.listen(PORT, () => {
        console.log(`Backend running on port ${PORT}`);
    });
});
