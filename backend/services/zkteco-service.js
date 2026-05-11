const Zkteco = require('zkteco-js');

// ─── Configuration ───
const DEVICE_IP = process.env.ZKTECO_IP || '192.168.1.252';
const DEVICE_PORT = parseInt(process.env.ZKTECO_PORT, 10) || 4370;
const POLL_INTERVAL_MS = parseInt(process.env.ZKTECO_POLL_INTERVAL, 10) || 30000;

let device = null;
let isConnected = false;
let lastSyncAt = null;
let logsOnDevice = 0;
let io = null; // Socket.IO instance (injected)
let pool = null; // PostgreSQL pool (injected)

// ─── Helpers ───
function getTodayStr() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function nowStr() {
  return new Date().toISOString();
}

// ─── Connection Management ───
async function connectDevice() {
  if (device && isConnected) return true;

  // Clean up any lingering device/socket from a previous failed attempt
  if (device) {
    try { await device.disconnect(); } catch (e) {}
    device = null;
    // Give the device time to release the connection
    await new Promise(r => setTimeout(r, 1000));
  }

  device = new Zkteco(DEVICE_IP, DEVICE_PORT, 10000, 5200);
  try {
    await device.createSocket();
    isConnected = true;
    let info = null;
    try { info = await device.getInfo(); } catch (e) {}
    logsOnDevice = info?.logCapacity || 0;
    console.log(`[ZKTECO] Connected to ${DEVICE_IP}:${DEVICE_PORT}`);
    emitStatus();
    return true;
  } catch (err) {
    console.error('[ZKTECO] Connection failed:', err.message);
    // Force-destroy the socket to prevent lingering connections
    try { await device.disconnect(); } catch (e) {}
    isConnected = false;
    device = null;
    emitStatus();
    return false;
  }
}

async function disconnectDevice() {
  if (!device) return;
  try {
    await device.disconnect();
  } catch (e) {}
  isConnected = false;
  device = null;
  emitStatus();
}

function emitStatus() {
  if (io) {
    io.emit('device:status', {
      connected: isConnected,
      ip: DEVICE_IP,
      port: DEVICE_PORT,
      lastSyncAt,
      logsOnDevice
    });
  }
}

// ─── Device User Operations ───
async function getDeviceUsers() {
  if (!await connectDevice()) return [];
  try {
    const users = await device.getUsers();
    return users?.data || [];
  } catch (err) {
    console.error('[ZKTECO] getUsers error:', err.message);
    return [];
  }
}

async function getAttendances() {
  if (!await connectDevice()) return [];
  try {
    const logs = await device.getAttendances();
    return logs?.data || [];
  } catch (err) {
    console.error('[ZKTECO] getAttendances error:', err.message);
    return [];
  }
}

async function createDeviceUser(uid, userId, name, password = '0', role = 0, cardno = 0) {
  if (!await connectDevice()) return false;
  try {
    await device.setUser(uid, userId, name, password, role, cardno);
    console.log(`[ZKTECO] Created user: ${name} (uid=${uid}, id=${userId})`);
    return true;
  } catch (err) {
    console.error('[ZKTECO] setUser error:', err.message);
    return false;
  }
}

async function deleteDeviceUser(uid) {
  if (!await connectDevice()) return false;
  try {
    await device.deleteUser(uid);
    console.log(`[ZKTECO] Deleted user uid=${uid}`);
    return true;
  } catch (err) {
    console.error('[ZKTECO] deleteUser error:', err.message);
    return false;
  }
}

// ─── Attendance Processing ───
async function processAttendanceLog(log) {
  if (!pool) return;

  const { userId: zkUserId, attTime } = log;
  if (!zkUserId || !attTime) return;

  try {
    // 1. Find mapping for this device user
    const mappingRes = await pool.query(
      'SELECT user_id FROM zkteco_users WHERE zkteco_user_id = $1',
      [zkUserId.toString()]
    );

    if (mappingRes.rowCount === 0) {
      console.log(`[ZKTECO] Unmapped punch: user_id=${zkUserId} at ${attTime}`);
      return;
    }

    const appUserId = mappingRes.rows[0].user_id;
    const punchTime = new Date(attTime);
    const dateStr = `${punchTime.getFullYear()}-${String(punchTime.getMonth() + 1).padStart(2, '0')}-${String(punchTime.getDate()).padStart(2, '0')}`;
    const timeStr = punchTime.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });

    // 2. Check if WFH today
    const wfhRes = await pool.query(
      `SELECT 1 FROM leave_requests
       WHERE user_id = $1 AND status = 'approved'
         AND start_date <= $2 AND end_date >= $2
         AND (LOWER(type) LIKE '%wfh%' OR LOWER(type) = 'work from home')
       LIMIT 1`,
      [appUserId, dateStr]
    );
    const isWfh = wfhRes.rowCount > 0;

    // 3. Get today's attendance record
    const attRes = await pool.query(
      'SELECT id, check_in_time, check_out_time, status FROM attendance WHERE user_id = $1 AND date = $2',
      [appUserId, dateStr]
    );

    if (attRes.rowCount === 0) {
      // ─── CHECK IN ───
      const checkInStatus = isWfh ? 'wfh_working' : 'working';
      await pool.query(
        `INSERT INTO attendance (user_id, date, check_in_time, status)
         VALUES ($1, $2, NOW(), $3)
         ON CONFLICT (user_id, date) DO UPDATE SET status = EXCLUDED.status`,
        [appUserId, dateStr, checkInStatus]
      );
      console.log(`[ZKTECO] Check-in: ${appUserId} at ${timeStr}`);
    } else {
      const record = attRes.rows[0];
      if (!record.check_out_time && !record.status?.includes('completed')) {
        // ─── CHECK OUT ───
        const checkInTime = new Date(record.check_in_time);
        const hoursWorked = (punchTime - checkInTime) / (1000 * 60 * 60);
        const baseStatus = isWfh ? 'wfh_' : '';

        let newStatus = baseStatus + 'completed';
        if (hoursWorked < 4) {
          // Auto half-day leave
          await pool.query(
            `INSERT INTO leave_requests (user_id, type, start_date, end_date, reason, status)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [appUserId, 'Casual Leave (Half Day)', dateStr, dateStr, 'Auto-generated Short Shift (< 4 hours)', 'pending']
          );
        } else if (hoursWorked < 8) {
          newStatus = baseStatus + 'pending_early_clockout';
        }

        await pool.query(
          'UPDATE attendance SET check_out_time = NOW(), status = $1 WHERE id = $2',
          [newStatus, record.id]
        );
        console.log(`[ZKTECO] Check-out: ${appUserId} at ${timeStr} (status=${newStatus})`);
      } else {
        // Already completed, ignore duplicate
        return;
      }
    }

    // 4. Emit live update to all connected browsers
    if (io) {
      io.emit('attendance:update', {
        userId: appUserId,
        date: dateStr,
        time: timeStr,
        source: 'device'
      });
    }
  } catch (err) {
    console.error('[ZKTECO] Process attendance error:', err.message);
  }
}

// ─── Sync Operations ───
async function syncAttendanceLogs() {
  if (!await connectDevice()) return { processed: 0, errors: 0 };

  const logs = await getAttendances();
  let processed = 0;
  let errors = 0;

  for (const log of logs) {
    try {
      await processAttendanceLog(log);
      processed++;
    } catch (e) {
      errors++;
    }
  }

  lastSyncAt = nowStr();
  emitStatus();
  console.log(`[ZKTECO] Synced ${processed} logs (${errors} errors)`);
  return { processed, errors };
}

async function syncKitsuUsersToDevice() {
  if (!pool) return { pushed: 0, failed: 0 };

  // Get all app users that don't have a device mapping yet
  const res = await pool.query(
    `SELECT u.user_id, u.name
     FROM users u
     LEFT JOIN zkteco_users z ON u.user_id = z.user_id
     WHERE z.user_id IS NULL AND u.role != 'admin'`
  );

  let pushed = 0;
  let failed = 0;
  let nextUid = 1;

  // Find next available UID
  try {
    const uidRes = await pool.query('SELECT MAX(zkteco_uid) as max_uid FROM zkteco_users');
    nextUid = (uidRes.rows[0]?.max_uid || 0) + 1;
  } catch (e) {}

  for (const user of res.rows) {
    const zkUserId = (10000 + nextUid).toString(); // e.g. 10001, 10002
    const uid = nextUid;
    const name = user.name;

    const created = await createDeviceUser(uid, zkUserId, name);
    if (created) {
      await pool.query(
        `INSERT INTO zkteco_users (user_id, zkteco_uid, zkteco_user_id, status)
         VALUES ($1, $2, $3, $4)`,
        [user.user_id, uid, zkUserId, 'pending_enrollment']
      );
      pushed++;
      nextUid++;
    } else {
      failed++;
    }
  }

  return { pushed, failed };
}

// ─── Real-Time Log Listener ───
async function startRealtimeLogs() {
  if (!await connectDevice()) return;
  try {
    await device.getRealTimeLogs((log) => {
      console.log('[ZKTECO] Real-time log:', log);
      processAttendanceLog(log);
    });
    console.log('[ZKTECO] Real-time log listener started');
  } catch (err) {
    console.error('[ZKTECO] Real-time logs error:', err.message);
  }
}

// ─── Polling Loop ───
let pollTimer = null;

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    await syncAttendanceLogs();
  }, POLL_INTERVAL_MS);
  console.log(`[ZKTECO] Polling started every ${POLL_INTERVAL_MS}ms`);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

// ─── Public API ───
module.exports = {
  inject: (socketIoInstance, pgPool) => {
    io = socketIoInstance;
    pool = pgPool;
  },
  connect: connectDevice,
  disconnect: disconnectDevice,
  getStatus: () => ({
    connected: isConnected,
    ip: DEVICE_IP,
    port: DEVICE_PORT,
    lastSyncAt,
    logsOnDevice,
    polling: !!pollTimer
  }),
  getDeviceUsers,
  getAttendances,
  createDeviceUser,
  deleteDeviceUser,
  syncAttendanceLogs,
  syncKitsuUsersToDevice,
  startRealtimeLogs,
  startPolling,
  stopPolling,
  processAttendanceLog
};
