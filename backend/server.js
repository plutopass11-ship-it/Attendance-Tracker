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

// Utility to execute Kitsu login
async function loginToKitsu(email, password) {
  try {
    const response = await fetch(`${KITSU_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data.access_token; // returns JWT if valid
  } catch (error) {
    console.error('Kitsu Login Error:', error);
    return null;
  }
}

// Utility to get user info from Kitsu using token
async function getKitsuUser(token, email) {
  try {
    const response = await fetch(`${KITSU_URL}/api/data/persons`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!response.ok) return null;
    const persons = await response.json(); 
    return persons.find(p => p.email === email);
  } catch (err) {
    console.error('Kitsu fetch user error:', err);
    return null;
  }
}

// 1. Authentication Endpoint (Kitsu Proxy)
app.post('/api/auth/login', async (req, res) => {
  const { userId: email, password } = req.body; // Using email as userId for Kitsu

  // --- Bypass for SuperAdmin default ---
  if(email === 'admin1' && password === 'password') {
       return res.json({ success: true, user: { id: 'admin1', name: 'Super Admin', role: 'admin' }});
  }

  // Send credentials to Kitsu
  const token = await loginToKitsu(email, password);
  if (!token) {
    return res.status(401).json({ success: false, message: 'Invalid Kitsu credentials' });
  }

  // Get user profile from Kitsu
  const kitsuUser = await getKitsuUser(token, email);
  if (!kitsuUser) {
    return res.status(500).json({ success: false, message: 'Failed to fetch Kitsu profile' });
  }

  // Format the user
  const fullName = `${kitsuUser.first_name || ''} ${kitsuUser.last_name || ''}`.trim();
  const role = ['admin', 'manager', 'studio_manager'].includes(kitsuUser.role) ? 'admin' : 'user';

  // Upsert user into purely local Postgres Database to sync them natively
  try {
    const result = await pool.query(
      `INSERT INTO users (user_id, name, password, role) 
       VALUES ($1, $2, 'synced_from_kitsu', $3)
       ON CONFLICT (user_id) 
       DO UPDATE SET name = $2, role = $3
       RETURNING id, user_id, name, role`,
      [email, fullName, role]
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
    // Fetches all needed state at once for the app to function without complex UI rewrites
    const users = await pool.query('SELECT user_id as id, name, role FROM users;');
    const leaves = await pool.query('SELECT id, user_id as "userId", type, start_date as "startDate", end_date as "endDate", reason, status FROM leave_requests ORDER BY id DESC;');
    const policies = await pool.query('SELECT id, type as name, quota as limit, cycle FROM leave_policies;');
    const dates = await pool.query('SELECT date, name, type FROM holidays ORDER BY date ASC;');
    const attendance = await pool.query('SELECT user_id as "userId", CAST(date as text), check_in_time as "checkInTime", check_out_time as "checkOutTime" FROM attendance;');

    res.json({
        users: users.rows,
        leaves: leaves.rows,
        leaveTypes: policies.rows,
        holidays: dates.rows,
        attendance: attendance.rows.map(a => ({
          ...a,
          checkInTime: a.checkInTime ? new Date(a.checkInTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null,
          checkOutTime: a.checkOutTime ? new Date(a.checkOutTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null
        }))
    });
  } catch (err) {
    console.error('Store fetch error:', err);
    res.status(500).json({ error: 'Database fetch error' });
  }
});


// 3. Mark Attendance (Check in/out)
app.post('/api/attendance', async (req, res) => {
  const { userId, date, time, isCheckOut } = req.body;
  try {
    if (!isCheckOut) {
      await pool.query(
        `INSERT INTO attendance (user_id, date, check_in_time) VALUES ($1, $2, NOW()) 
         ON CONFLICT (user_id, date) DO NOTHING`,
        [userId, date]
      );
    } else {
      await pool.query(
        `UPDATE attendance SET check_out_time = NOW() WHERE user_id = $1 AND date = $2`,
        [userId, date]
      );
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
});


// 4. Submit Leave Request
app.post('/api/leaves', async (req, res) => {
    const { userId, type, startDate, endDate, reason, status } = req.body;
    try {
        await pool.query(
            `INSERT INTO leave_requests (user_id, type, start_date, end_date, reason, status)
             VALUES ($1, $2, $3, $4, $5, $6)`,
             [userId, type, startDate, endDate, reason, status || 'Pending']
        );
        res.json({ success: true });
    } catch(err) {
        console.error(err);
        res.status(500).json({ success: false });
    }
});

app.put('/api/leaves/:id', async (req, res) => {
   const { status } = req.body;
   try {
       await pool.query('UPDATE leave_requests SET status = $1 WHERE id = $2', [status, req.params.id]);
       res.json({ success: true });
   } catch(err) {
       console.error(err);
       res.status(500).json({ success: false });
   }
});


// Startup
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});
