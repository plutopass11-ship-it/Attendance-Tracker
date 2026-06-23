const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const { createServer } = require('http');
const { Server } = require('socket.io');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});
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

  // Check if user is deactivated locally
  try {
    const localUser = await pool.query('SELECT is_active FROM users WHERE user_id = $1', [email]);
    if (localUser.rowCount > 0 && localUser.rows[0].is_active === false) {
      return res.status(403).json({ success: false, message: 'Account has been deactivated.' });
    }
  } catch(e) {}

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

    const hasIsActiveCol = await columnExists('users', 'is_active');
    const users = await pool.query(`SELECT user_id as id, name, role, ${hasIsActiveCol ? 'is_active' : 'true'} as is_active FROM users;`);
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
    io.emit('attendance:update', { userId });
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
        io.emit('attendance:update', { userId });
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
        io.emit('attendance:update', { userId });
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

        if (result.rowCount > 0) {
            io.emit('attendance:update', { userId: result.rows[0].user_id });
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
            'DELETE FROM leave_requests WHERE id = $1 RETURNING user_id',
            [req.params.id]
        );
        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, message: 'Leave record not found' });
        }
        io.emit('attendance:update', { userId: result.rows[0].user_id });
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
        io.emit('attendance:update', { userId: req.params.userId });
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

// Kitsu Removal Sync Endpoints
app.get('/api/users/pending_removal', async (req, res) => {
    try {
        const result = await pool.query("SELECT user_id as id, name, role FROM users WHERE pending_removal = true AND is_active = true");
        res.json({ success: true, pending_removals: result.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false });
    }
});

app.post('/api/users/:id/dismiss_removal', async (req, res) => {
    try {
        await pool.query("UPDATE users SET pending_removal = false WHERE user_id = $1", [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false });
    }
});

app.post('/api/users/:id/deactivate', async (req, res) => {
    try {
        await pool.query("UPDATE users SET is_active = false, pending_removal = false WHERE user_id = $1", [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        console.error('Deactivate user error:', err);
        res.status(500).json({ success: false, message: 'Deactivate failed' });
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

// 10. Studio Settings
app.get('/api/settings', async (req, res) => {
    try {
        if (!(await tableExists('studio_settings'))) return res.json({});
        const result = await pool.query("SELECT value FROM studio_settings WHERE key = 'studioConfig' LIMIT 1");
        if (result.rowCount > 0) {
            res.json(JSON.parse(result.rows[0].value));
        } else {
            res.json({});
        }
    } catch (err) {
        console.error('Settings fetch error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/settings', async (req, res) => {
    try {
        const value = JSON.stringify(req.body);
        await pool.query(
            `INSERT INTO studio_settings (key, value) VALUES ('studioConfig', $1)
             ON CONFLICT (key) DO UPDATE SET value = $1`,
            [value]
        );
        res.json({ success: true });
    } catch (err) {
        console.error('Settings save error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});


// 11. User History (comprehensive data for Employee History tab)
app.get('/api/users/:id/history', async (req, res) => {
    const userId = req.params.id;
    try {
        // Fetch all attendance records
        const attendance = await pool.query(`
            SELECT user_id as "userId", CAST(date as text) as "date",
                   check_in_time as "checkInTime", check_out_time as "checkOutTime",
                   status
            FROM attendance WHERE user_id = $1 ORDER BY date DESC
        `, [userId]);

        // Fetch all leave records
        const hasAutoApplied = await columnExists('leave_requests', 'is_auto_applied');
        const leaves = await pool.query(`
            SELECT id::text, user_id as "userId", type,
                   CAST(start_date as text) as "startDate",
                   CAST(end_date as text) as "endDate",
                   reason, status,
                   COALESCE(is_historical, false) as "isHistorical",
                   ${hasAutoApplied ? 'COALESCE(is_auto_applied, false)' : 'false::boolean'} as "isAutoApplied"
            FROM leave_requests WHERE user_id = $1 ORDER BY id DESC
        `, [userId]);

        // Format attendance times to IST
        const formattedAttendance = attendance.rows.map(a => ({
            ...a,
            checkInTime: a.checkInTime ? new Date(a.checkInTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : null,
            checkOutTime: a.checkOutTime ? new Date(a.checkOutTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : null,
            // Compute hours worked from raw timestamps
            hoursWorked: (a.checkInTime && a.checkOutTime) ? ((new Date(a.checkOutTime) - new Date(a.checkInTime)) / (1000 * 60 * 60)).toFixed(1) : null,
            // Late login flag: check-in after 11:00 AM IST
            isLateLogin: a.checkInTime ? (() => {
                const checkIn = new Date(a.checkInTime);
                const istHour = parseInt(checkIn.toLocaleTimeString('en-IN', { hour: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }));
                const istMin = parseInt(checkIn.toLocaleTimeString('en-IN', { minute: '2-digit', timeZone: 'Asia/Kolkata' }));
                return (istHour > 11 || (istHour === 11 && istMin > 0));
            })() : false,
            // Early checkout flag: checkout before 6 PM IST (less than 8 hours)
            isEarlyLogout: (a.checkInTime && a.checkOutTime) ? ((new Date(a.checkOutTime) - new Date(a.checkInTime)) / (1000 * 60 * 60) < 8) : false
        }));

        // Capitalize leave statuses for frontend
        const formattedLeaves = leaves.rows.map(l => ({
            ...l,
            status: l.status ? l.status.charAt(0).toUpperCase() + l.status.slice(1) : l.status
        }));

        res.json({
            attendance: formattedAttendance,
            leaves: formattedLeaves
        });
    } catch (err) {
        console.error('User history fetch error:', err);
        res.status(500).json({ error: 'Failed to fetch user history', details: err.message });
    }
});
// 12a. Kitsu User Removal Sweep (runs EOD)
async function checkKitsuRemovals() {
    try {
        console.log('[Kitsu Sweep] Running EOD Kitsu sweep to find removed users...');
        const adminToken = await getAdminToken();
        if (!adminToken) {
            console.error('[Kitsu Sweep] No admin token available.');
            return;
        }
        
        const response = await fetch(`${KITSU_URL}/api/data/persons`, {
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });
        if (!response.ok) {
            console.error('[Kitsu Sweep] Kitsu persons API returned:', response.status);
            return;
        }
        const persons = await response.json();
        const kitsuEmails = persons.map(p => p.email);

        const hasIsActiveCol = await columnExists('users', 'is_active');
        const activeCondition = hasIsActiveCol ? 'AND is_active = true' : '';
        const localUsersResult = await pool.query(`SELECT user_id FROM users WHERE role != 'admin' ${activeCondition}`);
        const localUserIds = localUsersResult.rows.map(r => r.user_id);

        for (const localId of localUserIds) {
            if (!kitsuEmails.includes(localId)) {
                await pool.query("UPDATE users SET pending_removal = true WHERE user_id = $1", [localId]);
                console.log(`[Kitsu Sweep] User ${localId} not found in Kitsu. Marked for pending removal.`);
            } else {
                await pool.query("UPDATE users SET pending_removal = false WHERE user_id = $1", [localId]);
            }
        }
    } catch (err) {
        console.error('[Kitsu Sweep] Error:', err);
    }
}

// 12. Auto Half-Day Leave Cron (runs at 11:05 AM IST)
async function runAutoHalfDayLeave() {
    try {
        const now = new Date();
        // Get IST time
        const istTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
        const istHour = istTime.getHours();
        const istDay = istTime.getDay(); // 0=Sunday

        // Only run on working days (Mon-Sat) and only at/after 11 AM
        if (istDay === 0 || istHour < 11) return;

        const todayStr = `${istTime.getFullYear()}-${String(istTime.getMonth()+1).padStart(2,'0')}-${String(istTime.getDate()).padStart(2,'0')}`;

        console.log(`[Auto Half-Day] Checking for missing logins on ${todayStr}...`);

        // Check if today is a holiday (holidays may be stored in localStorage only)
        try {
            if (await tableExists('holidays')) {
                const holidayCheck = await pool.query(
                    "SELECT 1 FROM holidays WHERE date = $1 AND LOWER(type) = 'public' LIMIT 1",
                    [todayStr]
                );
                if (holidayCheck.rowCount > 0) {
                    console.log('[Auto Half-Day] Today is a public holiday, skipping.');
                    return;
                }
            }
        } catch (e) {
            console.log('[Auto Half-Day] Holidays table not found, skipping holiday check.');
        }

        // Get all active non-admin users
        const hasIsActiveCol = await columnExists('users', 'is_active');
        const activeCondition = hasIsActiveCol ? 'AND is_active = true' : '';
        const users = await pool.query(`SELECT user_id FROM users WHERE role != 'admin' ${activeCondition}`);

        // Leave type priority order (lowercase slug matching)
        const priorityOrder = ['earned', 'casual', 'sick'];

        // Get leave policies
        const hasLabel = await columnExists('leave_policies', 'label');
        const hasQuota = await columnExists('leave_policies', 'quota');
        const hasCycle = await columnExists('leave_policies', 'cycle');
        const policies = await pool.query(`
            SELECT id, type,
                   ${hasLabel ? 'label' : 'type'} as label,
                   ${hasQuota ? 'quota' : '12'} as quota,
                   ${hasCycle ? 'cycle' : "'yearly'"} as cycle
            FROM leave_policies
        `);

        const currentYear = istTime.getFullYear();
        const currentMonthStr = `${currentYear}-${String(istTime.getMonth()+1).padStart(2,'0')}`;

        let autoApplied = 0;

        for (const user of users.rows) {
            const uid = user.user_id;

            // Check if user already has attendance today
            const attCheck = await pool.query(
                'SELECT 1 FROM attendance WHERE user_id = $1 AND date = $2 LIMIT 1',
                [uid, todayStr]
            );
            if (attCheck.rowCount > 0) continue;

            // Check if user already has approved leave covering today
            const leaveCheck = await pool.query(
                "SELECT 1 FROM leave_requests WHERE user_id = $1 AND status = 'approved' AND start_date <= $2 AND end_date >= $2 LIMIT 1",
                [uid, todayStr]
            );
            if (leaveCheck.rowCount > 0) continue;

            // Check if already auto-applied today
            const hasAutoCol = await columnExists('leave_requests', 'is_auto_applied');
            if (hasAutoCol) {
                const autoCheck = await pool.query(
                    "SELECT 1 FROM leave_requests WHERE user_id = $1 AND start_date = $2 AND is_auto_applied = true LIMIT 1",
                    [uid, todayStr]
                );
                if (autoCheck.rowCount > 0) continue;
            }

            // Determine leave type by hierarchy
            let selectedType = null;
            let selectedLabel = null;

            for (const priority of priorityOrder) {
                // Find policy matching this priority keyword
                const policy = policies.rows.find(p => {
                    const slug = (p.type || '').toLowerCase();
                    const label = (p.label || '').toLowerCase();
                    return slug.includes(priority) || label.includes(priority);
                });
                if (!policy) continue;

                // Calculate used leaves for this type
                const isMonthly = (policy.cycle || 'yearly').toLowerCase() === 'monthly';
                let usedQuery;
                if (isMonthly) {
                    usedQuery = await pool.query(
                        `SELECT COALESCE(SUM(
                            CASE WHEN LOWER(type) LIKE '%half day%' THEN 0.5
                            ELSE GREATEST(1, (end_date - start_date + 1)) END
                        ), 0) as used
                        FROM leave_requests
                        WHERE user_id = $1 AND status = 'approved'
                          AND (LOWER(type) LIKE $2 OR LOWER(type) LIKE $3)
                          AND to_char(start_date, 'YYYY-MM') = $4`,
                        [uid, `%${priority}%`, `${policy.label.toLowerCase()}%`, currentMonthStr]
                    );
                } else {
                    usedQuery = await pool.query(
                        `SELECT COALESCE(SUM(
                            CASE WHEN LOWER(type) LIKE '%half day%' THEN 0.5
                            ELSE GREATEST(1, (end_date - start_date + 1)) END
                        ), 0) as used
                        FROM leave_requests
                        WHERE user_id = $1 AND status = 'approved'
                          AND (LOWER(type) LIKE $2 OR LOWER(type) LIKE $3)
                          AND EXTRACT(YEAR FROM start_date) = $4`,
                        [uid, `%${priority}%`, `${policy.label.toLowerCase()}%`, currentYear]
                    );
                }

                const used = parseFloat(usedQuery.rows[0].used);
                const quota = parseInt(policy.quota);
                const remaining = quota - used;

                if (remaining >= 0.5) {
                    selectedType = policy.label;
                    selectedLabel = `${policy.label} (Half Day)`;
                    break;
                }
            }

            // Fallback to LOP if no quota available
            if (!selectedLabel) {
                selectedLabel = 'Loss of Pay (Half Day)';
            }

            // Auto-apply the half-day leave
            const insertCols = hasAutoCol
                ? '(user_id, type, start_date, end_date, reason, status, is_auto_applied)'
                : '(user_id, type, start_date, end_date, reason, status)';
            const insertVals = hasAutoCol
                ? [uid, selectedLabel, todayStr, todayStr, 'Auto-applied: No login by 11:00 AM', 'pending', true]
                : [uid, selectedLabel, todayStr, todayStr, 'Auto-applied: No login by 11:00 AM', 'pending'];
            const placeholders = hasAutoCol ? '$1, $2, $3, $4, $5, $6, $7' : '$1, $2, $3, $4, $5, $6';

            await pool.query(
                `INSERT INTO leave_requests ${insertCols} VALUES (${placeholders})`,
                insertVals
            );

            console.log(`[Auto Half-Day] Applied '${selectedLabel}' for user ${uid}`);
            autoApplied++;
        }

        if (autoApplied > 0) {
            console.log(`[Auto Half-Day] Completed check. Applied half-day leaves for ${autoApplied} users.`);
            io.emit('attendance:update', { broadcast: true }); // Notify all clients that a mass update occurred
        } else {
            console.log('[Auto Half-Day] All users accounted for. No auto-leaves needed.');
        }
    } catch (err) {
        console.error('[Auto Half-Day] Error:', err);
    }
}

// Manual trigger endpoint for auto half-day (admin use)
app.post('/api/cron/auto-halfday', async (req, res) => {
    try {
        await runAutoHalfDayLeave();
        res.json({ success: true, message: 'Auto half-day check completed.' });
    } catch (err) {
        console.error('Manual auto-halfday error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});


// ============================================================
// Socket.IO Connection Handler
// ============================================================
io.on('connection', (socket) => {
    console.log(`[Socket.IO] Client connected: ${socket.id}`);

    socket.on('disconnect', () => {
        console.log(`[Socket.IO] Client disconnected: ${socket.id}`);
    });
});


// --- Database auto-migration on startup ---
async function runMigrations() {
    try {
        // Create studio_settings table if it doesn't exist
        await pool.query(`
            CREATE TABLE IF NOT EXISTS studio_settings (
                key VARCHAR(50) PRIMARY KEY,
                value TEXT NOT NULL
            );
        `);
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

        // Add is_auto_applied column for auto half-day leaves
        if (await tableExists('leave_requests') && !(await columnExists('leave_requests', 'is_auto_applied'))) {
            await pool.query('ALTER TABLE leave_requests ADD COLUMN is_auto_applied BOOLEAN DEFAULT false;');
            console.log('Added is_auto_applied column to leave_requests table.');
        }
        // Add pending_removal and is_active columns to users table
        if (await tableExists('users')) {
            if (!(await columnExists('users', 'pending_removal'))) {
                await pool.query('ALTER TABLE users ADD COLUMN pending_removal BOOLEAN DEFAULT false;');
                console.log('Added pending_removal column to users table.');
            }
            if (!(await columnExists('users', 'is_active'))) {
                await pool.query('ALTER TABLE users ADD COLUMN is_active BOOLEAN DEFAULT true;');
                console.log('Added is_active column to users table.');
            }
        }

        console.log('DB migrations completed.');
    } catch (err) {
        console.error('Migration error:', err);
    }
}

// Startup
const PORT = process.env.PORT || 4000;
runMigrations().then(() => {
    httpServer.listen(PORT, () => {
        console.log(`Backend running on port ${PORT} (HTTP + Socket.IO)`);

        // Schedule auto half-day check every 5 minutes between 11:00-11:30 AM IST
        setInterval(() => {
            const now = new Date();
            const istTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
            const h = istTime.getHours();
            const m = istTime.getMinutes();
            // Run between 11:00 and 11:30 AM IST
            if (h === 11 && m >= 0 && m <= 30) {
                runAutoHalfDayLeave();
            }
        }, 5 * 60 * 1000); // Check every 5 minutes

        console.log('Auto half-day leave scheduler initialized (11:00-11:30 AM IST)');

        // Schedule Kitsu user sweep
        let lastSweepDate = null;
        setInterval(() => {
            const now = new Date();
            const istTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
            const h = istTime.getHours();
            const currentDateStr = istTime.toDateString();
            
            // Run at 23:xx IST, once per day
            if (h === 23 && lastSweepDate !== currentDateStr) {
                lastSweepDate = currentDateStr;
                checkKitsuRemovals();
            }
        }, 30 * 60 * 1000); // Check every 30 minutes
        console.log('EOD Kitsu removal sweep scheduler initialized (23:xx IST)');
    });
});
