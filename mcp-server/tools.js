const { z } = require('zod');
const { pool } = require('./db');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

// ─── Kitsu Sync Helpers ──────────────────────────────────────────
let cachedAdminToken = null;
async function getAdminToken() {
    if (cachedAdminToken) return cachedAdminToken;
    try {
        const response = await fetch(`${process.env.KITSU_URL}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: process.env.KITSU_ADMIN_EMAIL,
                password: process.env.KITSU_ADMIN_PASSWORD
            })
        });
        if (!response.ok) return null;
        const data = await response.json();
        cachedAdminToken = data.access_token;
        return cachedAdminToken;
    } catch (err) {
        console.error('[MCP-Sync] Kitsu token error:', err.message);
        return null;
    }
}

/**
 * Register all MCP Tools on the given McpServer instance.
 * Tools are discrete actions an AI agent can execute.
 *
 * HOW TO ADD A NEW TOOL:
 * 1. Call server.tool(name, description, schema, handler)
 *    - name: lowercase_snake_case identifier
 *    - description: clear sentence the AI reads to decide when to use this tool
 *    - schema: Zod object defining required/optional parameters
 *    - handler: async (params) => { return { content: [{ type: 'text', text: '...' }] } }
 * 2. The MCP client auto-discovers it. No wiring needed.
 */
function registerTools(server) {

    // ═══════════════════════════════════════════════════════════════
    //  ATTENDANCE DOMAIN
    // ═══════════════════════════════════════════════════════════════

    server.tool(
        'get_attendance_today',
        'Get live attendance status for all employees today, or a specific employee if userId is provided. Returns check-in/out times, status (working/completed/pending_early_clockout/absent), and hours worked.',
        { userId: z.string().optional().describe('Optional employee user ID (email). If omitted, returns all employees.') },
        async ({ userId }) => {
            const today = new Date().toISOString().slice(0, 10);
            let query, params;

            if (userId) {
                query = `
                    SELECT a.user_id, u.name, a.check_in_time, a.check_out_time, a.status,
                           EXTRACT(EPOCH FROM (COALESCE(a.check_out_time, NOW()) - a.check_in_time)) / 3600 AS hours_worked
                    FROM attendance a
                    JOIN users u ON u.user_id = a.user_id
                    WHERE a.date = $1 AND a.user_id = $2`;
                params = [today, userId];
            } else {
                query = `
                    SELECT a.user_id, u.name, a.check_in_time, a.check_out_time, a.status,
                           EXTRACT(EPOCH FROM (COALESCE(a.check_out_time, NOW()) - a.check_in_time)) / 3600 AS hours_worked
                    FROM attendance a
                    JOIN users u ON u.user_id = a.user_id
                    WHERE a.date = $1
                    ORDER BY a.check_in_time ASC`;
                params = [today];
            }

            const result = await pool.query(query, params);
            const records = result.rows.map(r => ({
                ...r,
                hours_worked: r.hours_worked ? parseFloat(r.hours_worked).toFixed(2) : null
            }));

            return { content: [{ type: 'text', text: JSON.stringify({ date: today, count: records.length, records }, null, 2) }] };
        }
    );

    server.tool(
        'get_attendance_by_date',
        'Get attendance records for a specific date. Optionally filter by a single employee.',
        {
            date: z.string().describe('Date in YYYY-MM-DD format'),
            userId: z.string().optional().describe('Optional employee user ID to filter by')
        },
        async ({ date, userId }) => {
            let query = `
                SELECT a.user_id, u.name, a.check_in_time, a.check_out_time, a.status,
                       EXTRACT(EPOCH FROM (COALESCE(a.check_out_time, a.check_in_time) - a.check_in_time)) / 3600 AS hours_worked
                FROM attendance a
                JOIN users u ON u.user_id = a.user_id
                WHERE a.date = $1`;
            const params = [date];

            if (userId) {
                query += ' AND a.user_id = $2';
                params.push(userId);
            }
            query += ' ORDER BY a.check_in_time ASC';

            const result = await pool.query(query, params);
            const records = result.rows.map(r => ({
                ...r,
                hours_worked: r.hours_worked ? parseFloat(r.hours_worked).toFixed(2) : null
            }));

            return { content: [{ type: 'text', text: JSON.stringify({ date, count: records.length, records }, null, 2) }] };
        }
    );

    server.tool(
        'get_user_worktime',
        'Calculate total hours worked by a specific employee on a specific date. Returns check-in, check-out, and computed duration.',
        {
            userId: z.string().describe('Employee user ID (email)'),
            date: z.string().describe('Date in YYYY-MM-DD format')
        },
        async ({ userId, date }) => {
            const result = await pool.query(
                `SELECT check_in_time, check_out_time, status,
                        EXTRACT(EPOCH FROM (COALESCE(check_out_time, NOW()) - check_in_time)) / 3600 AS hours_worked
                 FROM attendance WHERE user_id = $1 AND date = $2`,
                [userId, date]
            );

            if (result.rowCount === 0) {
                return { content: [{ type: 'text', text: JSON.stringify({ error: 'No attendance record found for this user on this date' }) }] };
            }

            const r = result.rows[0];
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        userId, date,
                        checkIn: r.check_in_time,
                        checkOut: r.check_out_time,
                        status: r.status,
                        hoursWorked: parseFloat(r.hours_worked).toFixed(2)
                    }, null, 2)
                }]
            };
        }
    );

    server.tool(
        'get_pending_clockouts',
        'List all employees who have a pending early clock-out awaiting admin approval. Use this to review who needs approval.',
        {},
        async () => {
            const result = await pool.query(`
                SELECT a.user_id, u.name, a.date, a.check_in_time, a.check_out_time,
                       EXTRACT(EPOCH FROM (a.check_out_time - a.check_in_time)) / 3600 AS hours_worked
                FROM attendance a
                JOIN users u ON u.user_id = a.user_id
                WHERE a.status = 'pending_early_clockout'
                ORDER BY a.date DESC
            `);

            const records = result.rows.map(r => ({
                ...r,
                hours_worked: parseFloat(r.hours_worked).toFixed(2)
            }));

            return { content: [{ type: 'text', text: JSON.stringify({ count: records.length, pendingClockouts: records }, null, 2) }] };
        }
    );

    server.tool(
        'approve_early_clockout',
        'Approve an early clock-out request for an employee. This marks their day as completed.',
        {
            userId: z.string().describe('Employee user ID (email)'),
            date: z.string().describe('Date of the attendance record (YYYY-MM-DD)')
        },
        async ({ userId, date }) => {
            const result = await pool.query(
                `UPDATE attendance SET status = 'completed' 
                 WHERE user_id = $1 AND date = $2 AND status = 'pending_early_clockout'
                 RETURNING user_id, date, status`,
                [userId, date]
            );

            if (result.rowCount === 0) {
                return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'No pending early clock-out found for this user on this date' }) }] };
            }

            return { content: [{ type: 'text', text: JSON.stringify({ success: true, message: `Early clock-out approved for ${userId} on ${date}`, record: result.rows[0] }, null, 2) }] };
        }
    );

    server.tool(
        'reject_early_clockout',
        'Reject an early clock-out request. This clears their check-out time and puts them back on the clock as "working".',
        {
            userId: z.string().describe('Employee user ID (email)'),
            date: z.string().describe('Date of the attendance record (YYYY-MM-DD)')
        },
        async ({ userId, date }) => {
            const result = await pool.query(
                `UPDATE attendance SET status = 'working', check_out_time = NULL 
                 WHERE user_id = $1 AND date = $2 AND status = 'pending_early_clockout'
                 RETURNING user_id, date, status`,
                [userId, date]
            );

            if (result.rowCount === 0) {
                return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'No pending early clock-out found for this user on this date' }) }] };
            }

            return { content: [{ type: 'text', text: JSON.stringify({ success: true, message: `Early clock-out rejected for ${userId} on ${date}. Employee is back on the clock.`, record: result.rows[0] }, null, 2) }] };
        }
    );


    // ═══════════════════════════════════════════════════════════════
    //  LEAVE DOMAIN
    // ═══════════════════════════════════════════════════════════════

    server.tool(
        'get_pending_leaves',
        'List all pending leave requests awaiting admin review. Returns employee name, leave type, dates, and reason.',
        {},
        async () => {
            const result = await pool.query(`
                SELECT lr.id, lr.user_id, u.name as user_name, lr.type,
                       CAST(lr.start_date AS text) as start_date,
                       CAST(lr.end_date AS text) as end_date,
                       lr.reason, lr.created_at
                FROM leave_requests lr
                JOIN users u ON u.user_id = lr.user_id
                WHERE lr.status = 'pending'
                ORDER BY lr.created_at DESC
            `);
            return { content: [{ type: 'text', text: JSON.stringify({ count: result.rowCount, requests: result.rows }, null, 2) }] };
        }
    );

    server.tool(
        'get_leave_balance',
        'Get the remaining leave balance for a specific employee. Shows quota, used, and remaining for each leave type.',
        { userId: z.string().describe('Employee user ID (email)') },
        async ({ userId }) => {
            const policies = await pool.query('SELECT type, label, quota, cycle FROM leave_policies');
            const used = await pool.query(
                `SELECT type, COUNT(*) as count,
                        SUM(CASE WHEN type LIKE '%(Half Day)%' THEN 0.5 
                            ELSE GREATEST(1, (end_date - start_date) + 1) END) as days_used
                 FROM leave_requests 
                 WHERE user_id = $1 AND status = 'approved'
                 GROUP BY type`,
                [userId]
            );

            const balances = policies.rows.map(p => {
                // Match by exact type or by label prefix (e.g., 'Casual Leave (Half Day)' matches 'Casual Leave')
                const usedEntry = used.rows.find(u => 
                    u.type === p.label || u.type.startsWith(p.label)
                );
                const daysUsed = usedEntry ? parseFloat(usedEntry.days_used) : 0;
                return {
                    type: p.label,
                    quota: p.quota,
                    cycle: p.cycle,
                    used: daysUsed,
                    remaining: Math.max(0, p.quota - daysUsed)
                };
            });

            return { content: [{ type: 'text', text: JSON.stringify({ userId, balances }, null, 2) }] };
        }
    );

    server.tool(
        'approve_leave',
        'Approve a pending leave request by its ID.',
        { leaveId: z.string().describe('The numeric ID of the leave request to approve') },
        async ({ leaveId }) => {
            const result = await pool.query(
                `UPDATE leave_requests SET status = 'approved' WHERE id = $1 AND status = 'pending'
                 RETURNING id, user_id, type, CAST(start_date AS text) as start_date, CAST(end_date AS text) as end_date`,
                [leaveId]
            );

            if (result.rowCount === 0) {
                return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'No pending leave request found with this ID' }) }] };
            }

            return { content: [{ type: 'text', text: JSON.stringify({ success: true, message: 'Leave approved', record: result.rows[0] }, null, 2) }] };
        }
    );

    server.tool(
        'reject_leave',
        'Reject a pending leave request by its ID.',
        { leaveId: z.string().describe('The numeric ID of the leave request to reject') },
        async ({ leaveId }) => {
            const result = await pool.query(
                `UPDATE leave_requests SET status = 'rejected' WHERE id = $1 AND status = 'pending'
                 RETURNING id, user_id, type, CAST(start_date AS text) as start_date, CAST(end_date AS text) as end_date`,
                [leaveId]
            );

            if (result.rowCount === 0) {
                return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'No pending leave request found with this ID' }) }] };
            }

            return { content: [{ type: 'text', text: JSON.stringify({ success: true, message: 'Leave rejected', record: result.rows[0] }, null, 2) }] };
        }
    );

    server.tool(
        'submit_leave',
        'Submit a leave request on behalf of an employee. This is an admin action — the leave is created with "pending" status by default.',
        {
            userId: z.string().describe('Employee user ID (email)'),
            type: z.string().describe('Leave type (e.g., "Casual Leave", "Sick Leave", "Work From Home")'),
            startDate: z.string().describe('Start date (YYYY-MM-DD)'),
            endDate: z.string().describe('End date (YYYY-MM-DD)'),
            reason: z.string().optional().describe('Reason for leave'),
            autoApprove: z.boolean().optional().describe('If true, leave is created as approved (admin override). Defaults to false.')
        },
        async ({ userId, type, startDate, endDate, reason, autoApprove }) => {
            const status = autoApprove ? 'approved' : 'pending';
            const result = await pool.query(
                `INSERT INTO leave_requests (user_id, type, start_date, end_date, reason, status)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 RETURNING id, user_id, type, CAST(start_date AS text) as start_date, CAST(end_date AS text) as end_date, status`,
                [userId, type, startDate, endDate, reason || 'Submitted via MCP', status]
            );

            return { content: [{ type: 'text', text: JSON.stringify({ success: true, message: `Leave request created (${status})`, record: result.rows[0] }, null, 2) }] };
        }
    );

    server.tool(
        'get_employees_on_leave',
        'Get a list of employees who are on approved leave on a specific date. Defaults to today if no date provided.',
        { date: z.string().optional().describe('Date to check (YYYY-MM-DD). Defaults to today.') },
        async ({ date }) => {
            const checkDate = date || new Date().toISOString().slice(0, 10);
            const result = await pool.query(`
                SELECT lr.user_id, u.name, lr.type, 
                       CAST(lr.start_date AS text) as start_date,
                       CAST(lr.end_date AS text) as end_date, lr.reason
                FROM leave_requests lr
                JOIN users u ON u.user_id = lr.user_id
                WHERE lr.status = 'approved' AND lr.start_date <= $1 AND lr.end_date >= $1
                ORDER BY u.name
            `, [checkDate]);

            return { content: [{ type: 'text', text: JSON.stringify({ date: checkDate, count: result.rowCount, employees: result.rows }, null, 2) }] };
        }
    );


    // ═══════════════════════════════════════════════════════════════
    //  USER DOMAIN
    // ═══════════════════════════════════════════════════════════════

    server.tool(
        'list_users',
        'List all registered employees in the attendance tracker system. Shows their name, ID, role, and phone number (if registered).',
        {},
        async () => {
            const result = await pool.query(
                'SELECT user_id, name, role, phone, created_at FROM users ORDER BY name'
            );
            return { content: [{ type: 'text', text: JSON.stringify({ count: result.rowCount, users: result.rows }, null, 2) }] };
        }
    );

    server.tool(
        'sync_users_from_kitsu',
        'Bulk sync all users from Kitsu into the local database. Pulls names, roles, and phone numbers for all users. Run this to ensure all WhatsApp identities are up to date.',
        {},
        async () => {
            const adminToken = await getAdminToken();
            if (!adminToken) {
                return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'Failed to authenticate with Kitsu' }) }] };
            }

            try {
                const response = await fetch(`${process.env.KITSU_URL}/api/data/persons`, {
                    headers: { 'Authorization': `Bearer ${adminToken}` }
                });
                if (!response.ok) throw new Error(`Kitsu API returned ${response.status}`);
                
                const persons = await response.json();
                let synced = 0;

                for (const p of persons) {
                    const fullName = `${p.first_name || ''} ${p.last_name || ''}`.trim();
                    const role = ['admin', 'studio_manager'].includes(p.role) ? 'admin' : 'user';
                    const phone = p.phone || null;

                    await pool.query(
                        `INSERT INTO users (user_id, name, password, role, phone) 
                         VALUES ($1, $2, 'synced_from_kitsu', $3, $4)
                         ON CONFLICT (user_id) 
                         DO UPDATE SET name = $2, role = $3, phone = COALESCE($4, users.phone)`,
                        [p.email, fullName, role, phone]
                    );
                    synced++;
                }

                return { content: [{ type: 'text', text: JSON.stringify({ success: true, message: `Successfully synced ${synced} users from Kitsu`, count: synced }, null, 2) }] };
            } catch (err) {
                return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: err.message }) }] };
            }
        }
    );

    server.tool(
        'get_user_info',
        'Get detailed information about a specific employee, including their attendance today and leave balances.',
        { userId: z.string().describe('Employee user ID (email)') },
        async ({ userId }) => {
            const today = new Date().toISOString().slice(0, 10);
            
            const [user, todayAtt, recentLeaves] = await Promise.all([
                pool.query('SELECT user_id, name, role, phone, created_at FROM users WHERE user_id = $1', [userId]),
                pool.query('SELECT check_in_time, check_out_time, status FROM attendance WHERE user_id = $1 AND date = $2', [userId, today]),
                pool.query(
                    `SELECT id, type, CAST(start_date AS text) as start_date, CAST(end_date AS text) as end_date, status, reason
                     FROM leave_requests WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10`,
                    [userId]
                )
            ]);

            if (user.rowCount === 0) {
                return { content: [{ type: 'text', text: JSON.stringify({ error: 'User not found' }) }] };
            }

            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        user: user.rows[0],
                        todayAttendance: todayAtt.rows[0] || null,
                        recentLeaves: recentLeaves.rows
                    }, null, 2)
                }]
            };
        }
    );


    // ═══════════════════════════════════════════════════════════════
    //  HOLIDAY DOMAIN
    // ═══════════════════════════════════════════════════════════════

    server.tool(
        'list_holidays',
        'List all holidays configured in the system (both public and optional).',
        {},
        async () => {
            const result = await pool.query(
                'SELECT name, CAST(date AS text) as date, type FROM holidays ORDER BY date ASC'
            );
            return { content: [{ type: 'text', text: JSON.stringify({ count: result.rowCount, holidays: result.rows }, null, 2) }] };
        }
    );

    server.tool(
        'get_upcoming_holidays',
        'Get holidays coming up in the next N days. Defaults to 30 days.',
        { days: z.number().optional().describe('Number of days to look ahead. Default: 30') },
        async ({ days }) => {
            const lookAhead = days || 30;
            const today = new Date().toISOString().slice(0, 10);
            const futureDate = new Date();
            futureDate.setDate(futureDate.getDate() + lookAhead);
            const futureDateStr = futureDate.toISOString().slice(0, 10);

            const result = await pool.query(
                `SELECT name, CAST(date AS text) as date, type FROM holidays 
                 WHERE date >= $1 AND date <= $2 ORDER BY date ASC`,
                [today, futureDateStr]
            );

            return { content: [{ type: 'text', text: JSON.stringify({ from: today, to: futureDateStr, count: result.rowCount, holidays: result.rows }, null, 2) }] };
        }
    );


    // ═══════════════════════════════════════════════════════════════
    //  WHATSAPP IDENTITY DOMAIN
    // ═══════════════════════════════════════════════════════════════

    server.tool(
        'lookup_user_by_phone',
        'Find an employee by their phone number. Used to resolve a WhatsApp sender to an attendance system user. Returns the user_id (email), name, role, and phone.',
        { phone: z.string().describe('Phone number to look up (e.g., "+919876543210"). Will be matched with flexible normalization — trailing digits match.') },
        async ({ phone }) => {
            // Normalize: strip all non-digit characters, keep last 10 digits for matching
            const digits = phone.replace(/\D/g, '');
            const last10 = digits.slice(-10);

            const result = await pool.query(
                `SELECT user_id, name, role, phone
                 FROM users
                 WHERE REGEXP_REPLACE(phone, '\\D', '', 'g') LIKE '%' || $1`,
                [last10]
            );

            if (result.rowCount === 0) {
                return { content: [{ type: 'text', text: JSON.stringify({ found: false, error: 'No user found with this phone number. Ensure the phone is saved in the user profile.' }) }] };
            }

            const user = result.rows[0];
            return { content: [{ type: 'text', text: JSON.stringify({ found: true, userId: user.user_id, name: user.name, role: user.role, phone: user.phone }, null, 2) }] };
        }
    );

    server.tool(
        'get_all_user_phones',
        'Get a list of all employees with their phone numbers. Used by the cron job to send WhatsApp reminders. Only returns users who have a phone number registered.',
        {},
        async () => {
            const result = await pool.query(
                `SELECT user_id, name, role, phone
                 FROM users
                 WHERE phone IS NOT NULL AND phone != ''
                 ORDER BY name`
            );
            return { content: [{ type: 'text', text: JSON.stringify({ count: result.rowCount, users: result.rows }, null, 2) }] };
        }
    );


    // ═══════════════════════════════════════════════════════════════
    //  ATTENDANCE WRITE DOMAIN (WhatsApp check-in/out)
    // ═══════════════════════════════════════════════════════════════

    server.tool(
        'mark_attendance',
        'Check in or check out an employee for today. Use isCheckOut=false (or omit) for check-in. Use isCheckOut=true for check-out. Handles all business logic: duplicate detection, early clock-out tracking, and auto half-day leave generation for shifts under 4 hours.',
        {
            userId: z.string().describe('Employee user ID (email)'),
            isCheckOut: z.boolean().optional().describe('true = check out, false/omitted = check in')
        },
        async ({ userId, isCheckOut }) => {
            const today = new Date().toISOString().slice(0, 10);

            if (!isCheckOut) {
                // ── CHECK-IN ──
                const result = await pool.query(
                    `INSERT INTO attendance (user_id, date, check_in_time, status)
                     VALUES ($1, $2, NOW(), 'working')
                     ON CONFLICT (user_id, date) DO NOTHING
                     RETURNING user_id, date, check_in_time, status`,
                    [userId, today]
                );

                if (result.rowCount === 0) {
                    // Already checked in today
                    const existing = await pool.query(
                        `SELECT check_in_time, check_out_time, status FROM attendance WHERE user_id = $1 AND date = $2`,
                        [userId, today]
                    );
                    const rec = existing.rows[0];
                    return { content: [{ type: 'text', text: JSON.stringify({
                        success: false,
                        message: 'Already checked in today',
                        checkInTime: rec.check_in_time,
                        checkOutTime: rec.check_out_time,
                        status: rec.status
                    }, null, 2) }] };
                }

                return { content: [{ type: 'text', text: JSON.stringify({
                    success: true,
                    message: `Checked in successfully at ${new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })}`,
                    record: result.rows[0]
                }, null, 2) }] };

            } else {
                // ── CHECK-OUT (transactional) ──
                const client = await pool.connect();
                try {
                    await client.query('BEGIN');

                    const attRes = await client.query(
                        `SELECT check_in_time, check_out_time FROM attendance WHERE user_id = $1 AND date = $2 FOR UPDATE`,
                        [userId, today]
                    );

                    if (attRes.rowCount === 0) {
                        await client.query('ROLLBACK');
                        return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'No check-in found for today. Please check in first.' }) }] };
                    }

                    const record = attRes.rows[0];
                    if (record.check_out_time) {
                        await client.query('ROLLBACK');
                        return { content: [{ type: 'text', text: JSON.stringify({ success: false, message: 'Already checked out today', checkOutTime: record.check_out_time }) }] };
                    }

                    const checkInTime = new Date(record.check_in_time);
                    const now = new Date();
                    const hoursWorked = (now - checkInTime) / (1000 * 60 * 60);
                    let newStatus = 'completed';
                    let extraMessage = '';

                    if (hoursWorked < 4) {
                        // Auto-generate Half Day Leave
                        await client.query(
                            `INSERT INTO leave_requests (user_id, type, start_date, end_date, reason, status)
                             VALUES ($1, $2, $3, $4, $5, $6)`,
                            [userId, 'Casual Leave (Half Day)', today, today, 'Auto-generated Short Shift (< 4 hours)', 'pending']
                        );
                        extraMessage = ' ⚠️ Short shift detected (< 4h). A half-day leave request has been auto-generated.';
                    } else if (hoursWorked < 8) {
                        newStatus = 'pending_early_clockout';
                        extraMessage = ' ⏰ Early clock-out detected (< 8h). Pending admin approval.';
                    }

                    await client.query(
                        `UPDATE attendance SET check_out_time = NOW(), status = $3 WHERE user_id = $1 AND date = $2`,
                        [userId, today, newStatus]
                    );

                    await client.query('COMMIT');

                    return { content: [{ type: 'text', text: JSON.stringify({
                        success: true,
                        message: `Checked out successfully. Hours worked: ${hoursWorked.toFixed(2)}.${extraMessage}`,
                        hoursWorked: hoursWorked.toFixed(2),
                        status: newStatus
                    }, null, 2) }] };

                } catch (txnErr) {
                    await client.query('ROLLBACK');
                    return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'Check-out failed: ' + txnErr.message }) }] };
                } finally {
                    client.release();
                }
            }
        }
    );
}

module.exports = { registerTools };
