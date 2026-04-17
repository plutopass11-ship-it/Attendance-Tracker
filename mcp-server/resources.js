const { pool } = require('./db');

/**
 * Register all MCP Resources on the given McpServer instance.
 * Resources are read-only, URI-addressable data snapshots.
 * 
 * HOW TO ADD A NEW RESOURCE:
 * 1. Call server.resource(name, uri, handler)
 * 2. The handler returns { contents: [{ uri, mimeType, text }] }
 * 3. That's it — the MCP client auto-discovers it.
 */
function registerResources(server) {

    // ─── attendance://status/today ───────────────────────────────
    // Full live snapshot: who's checked in, checked out, pending, absent
    server.resource(
        'today-status',
        'attendance://status/today',
        async (uri) => {
            const today = new Date().toISOString().slice(0, 10);
            const users = await pool.query('SELECT user_id, name, role FROM users');
            const attendance = await pool.query(
                `SELECT user_id, check_in_time, check_out_time, status 
                 FROM attendance WHERE date = $1`, [today]
            );
            const leaves = await pool.query(
                `SELECT user_id, type, status FROM leave_requests 
                 WHERE status = 'approved' AND start_date <= $1 AND end_date >= $1`, [today]
            );

            const snapshot = users.rows
                .filter(u => u.role !== 'admin')
                .map(u => {
                    const att = attendance.rows.find(a => a.user_id === u.user_id);
                    const leave = leaves.rows.find(l => l.user_id === u.user_id);
                    let status = 'absent';
                    let checkIn = null, checkOut = null, hoursWorked = null;

                    if (att) {
                        status = att.status || 'working';
                        checkIn = att.check_in_time;
                        checkOut = att.check_out_time;
                        if (checkIn && checkOut) {
                            hoursWorked = ((new Date(checkOut) - new Date(checkIn)) / (1000 * 60 * 60)).toFixed(2);
                        }
                    } else if (leave) {
                        const isWfh = leave.type?.toLowerCase().includes('wfh') || leave.type?.toLowerCase().includes('work from home');
                        status = isWfh ? 'wfh' : 'on_leave';
                    }

                    return { userId: u.user_id, name: u.name, status, checkIn, checkOut, hoursWorked };
                });

            return {
                contents: [{
                    uri: uri.href,
                    mimeType: 'application/json',
                    text: JSON.stringify({ date: today, employees: snapshot }, null, 2)
                }]
            };
        }
    );

    // ─── attendance://leaves/pending ─────────────────────────────
    // All pending leave requests awaiting admin action
    server.resource(
        'pending-leaves',
        'attendance://leaves/pending',
        async (uri) => {
            const result = await pool.query(`
                SELECT lr.id, lr.user_id, u.name as user_name, lr.type, 
                       CAST(lr.start_date AS text) as start_date, 
                       CAST(lr.end_date AS text) as end_date,
                       lr.reason, lr.status, lr.created_at
                FROM leave_requests lr
                JOIN users u ON u.user_id = lr.user_id
                WHERE lr.status = 'pending'
                ORDER BY lr.created_at DESC
            `);
            return {
                contents: [{
                    uri: uri.href,
                    mimeType: 'application/json',
                    text: JSON.stringify({ count: result.rowCount, requests: result.rows }, null, 2)
                }]
            };
        }
    );

    // ─── attendance://policies ───────────────────────────────────
    // Current leave policy configuration
    server.resource(
        'leave-policies',
        'attendance://policies',
        async (uri) => {
            const result = await pool.query(
                'SELECT id, type, label, quota, cycle FROM leave_policies ORDER BY id'
            );
            return {
                contents: [{
                    uri: uri.href,
                    mimeType: 'application/json',
                    text: JSON.stringify({ policies: result.rows }, null, 2)
                }]
            };
        }
    );

    // ─── attendance://holidays ───────────────────────────────────
    // Full holiday calendar (public + optional)
    server.resource(
        'holidays',
        'attendance://holidays',
        async (uri) => {
            const result = await pool.query(
                'SELECT name, CAST(date AS text) as date, type FROM holidays ORDER BY date ASC'
            );
            return {
                contents: [{
                    uri: uri.href,
                    mimeType: 'application/json',
                    text: JSON.stringify({ holidays: result.rows }, null, 2)
                }]
            };
        }
    );
}

module.exports = { registerResources };
