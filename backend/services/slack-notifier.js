// backend/services/slack-notifier.js
const https = require('https');

const DEFAULT_SLACK_SETTINGS = {
    lateCheckInEnabled: true,
    lateThreshold: '11:00',
    adminRecipients: ['joyel@flyingpluto.ai', 'albert@flyingpluto.ai'],
    portalUrl: 'https://attendance.flyingpluto.ai',
    employeeCheckInTemplate: 'Check-In Confirmed\nTime: {time} ({location})\nHave a productive day at Flying Pluto.',
    employeeCheckOutTemplate: 'Check-Out Confirmed\nTime: {time}\nHave a great evening.',
    employeeEarlyCheckOutTemplate: 'Check-Out Recorded\nTime: {time}\nEarly Checkout has been submitted for admin approval.',
    employeeEarlyRejectedTemplate: 'Early Check-Out Request Rejected\nYour early checkout request for {date} was rejected by Admin. Please resume your shift.',
    employeeEarlyApprovedTemplate: 'Early Check-Out Approved\nYour early checkout request for {date} has been approved. Shift completed.',
    adminCheckInTemplate: 'Check-In: {name}\nTime: {time} ({status})\nMethod: {method}\nFor More Details - {portalUrl}',
    adminCheckOutTemplate: 'Check-Out: {name}\nTime: {time} ({status})\nMethod: {method}\nFor More Details - {portalUrl}'
};

// In-memory cache of userId/email -> slackMemberId
const userSlackCache = new Map();

/**
 * Performs a Slack API request with Bearer Auth
 */
function slackApiRequest(path, method, payload = null) {
    const token = process.env.SLACK_BOT_TOKEN || '';
    if (!token) return Promise.resolve({ ok: false, error: 'no_token' });

    return new Promise((resolve) => {
        const data = payload ? JSON.stringify(payload) : null;
        const options = {
            hostname: 'slack.com',
            path: '/api/' + path,
            method: method,
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json; charset=utf-8'
            }
        };

        if (data) {
            options.headers['Content-Length'] = Buffer.byteLength(data);
        }

        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(body);
                    resolve(parsed);
                } catch (e) {
                    resolve({ ok: false, error: 'invalid_json', raw: body });
                }
            });
        });

        req.on('error', (err) => {
            console.error('[Slack API Error]:', err.message);
            resolve({ ok: false, error: err.message });
        });

        if (data) req.write(data);
        req.end();
    });
}

/**
 * Finds a Slack User ID by email or name
 */
async function resolveSlackUserId({ userId, name, email }) {
    if (!userId && !email && !name) return null;

    const cacheKey = (email || userId || name).toLowerCase().trim();
    if (userSlackCache.has(cacheKey)) {
        return userSlackCache.get(cacheKey);
    }

    // 1. Try lookup by email if provided
    if (email) {
        const emailRes = await slackApiRequest(`users.lookupByEmail?email=${encodeURIComponent(email.trim())}`, 'GET');
        if (emailRes.ok && emailRes.user && emailRes.user.id) {
            const sid = emailRes.user.id;
            userSlackCache.set(cacheKey, sid);
            if (userId) userSlackCache.set(userId.toLowerCase().trim(), sid);
            return sid;
        }
    }

    // 2. Fetch users list and match by username, real name, or email prefix
    const listRes = await slackApiRequest('users.list', 'GET');
    if (listRes.ok && listRes.members) {
        const cleanTarget = (userId || name || email || '').toLowerCase().trim();
        const member = listRes.members.find(m => {
            if (m.is_bot || m.deleted) return false;
            const mName = (m.name || '').toLowerCase();
            const mReal = (m.real_name || '').toLowerCase();
            const mEmail = (m.profile && m.profile.email) ? m.profile.email.toLowerCase() : '';
            return mName === cleanTarget || mReal === cleanTarget || mEmail === cleanTarget || mEmail.startsWith(cleanTarget);
        });

        if (member) {
            const sid = member.id;
            userSlackCache.set(cacheKey, sid);
            if (userId) userSlackCache.set(userId.toLowerCase().trim(), sid);
            return sid;
        }
    }

    return null;
}

/**
 * Sends a raw direct message
 */
async function sendDirectMessage(slackUserId, text) {
    if (!slackUserId || !text) return;
    const payload = {
        channel: slackUserId,
        text: text
    };
    return await slackApiRequest('chat.postMessage', 'POST', payload);
}

/**
 * Retrieves Slack settings from database or defaults
 */
async function getSlackSettings(pool) {
    try {
        if (!pool) return DEFAULT_SLACK_SETTINGS;
        const res = await pool.query("SELECT value FROM studio_settings WHERE key = 'slackSettings' LIMIT 1");
        if (res.rowCount > 0 && res.rows[0].value) {
            const parsed = JSON.parse(res.rows[0].value);
            return { ...DEFAULT_SLACK_SETTINGS, ...parsed };
        }
    } catch (e) {
        console.error('[Slack] Error reading settings:', e.message);
    }
    return DEFAULT_SLACK_SETTINGS;
}

/**
 * Checks if current IST time is late (default: 11:00 AM)
 */
function isLateCheckIn(thresholdTimeStr = '11:00') {
    try {
        const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
        const [tHours, tMins] = (thresholdTimeStr || '11:00').split(':').map(Number);
        const currentMins = nowIST.getHours() * 60 + nowIST.getMinutes();
        const thresholdMins = tHours * 60 + (tMins || 0);
        return currentMins > thresholdMins;
    } catch (e) {
        return false;
    }
}

/**
 * Template variable replacer
 */
function renderTemplate(template, vars) {
    let result = template || '';
    for (const [k, v] of Object.entries(vars)) {
        result = result.replace(new RegExp(`\\{${k}\\}`, 'g'), v || '');
    }
    return result;
}

/**
 * Main Check-In Notification Dispatcher
 */
async function notifyCheckIn({ pool, name, userId, email, timeIST, method = 'Biometric Scanner', isWfh = false }) {
    try {
        const settings = await getSlackSettings(pool);
        const isLate = (settings.lateCheckInEnabled !== false) && isLateCheckIn(settings.lateThreshold);
        const locationText = isWfh ? 'Work From Home' : 'In Office';
        const statusText = isLate ? 'Late Check-In' : 'On-Time';

        const templateVars = {
            name: name || userId || 'Employee',
            userId: userId || '',
            time: timeIST,
            location: locationText,
            status: statusText,
            method: method,
            portalUrl: settings.portalUrl || 'https://attendance.flyingpluto.ai'
        };

        // 1. Send clean 1-on-1 DM to employee
        const employeeSlackId = await resolveSlackUserId({ userId, name, email });
        if (employeeSlackId) {
            const empMessage = renderTemplate(settings.employeeCheckInTemplate, templateVars);
            await sendDirectMessage(employeeSlackId, empMessage);
        }

        // 2. Broadcast clean notification to all Admin Recipients
        const adminRecipients = Array.isArray(settings.adminRecipients) ? settings.adminRecipients : [];
        if (adminRecipients.length > 0) {
            const adminMessage = renderTemplate(settings.adminCheckInTemplate, templateVars);
            for (const adminEmail of adminRecipients) {
                const adminSlackId = await resolveSlackUserId({ email: adminEmail });
                if (adminSlackId) {
                    await sendDirectMessage(adminSlackId, adminMessage);
                }
            }
        }
    } catch (err) {
        console.error('[Slack] notifyCheckIn error:', err);
    }
}

/**
 * Main Check-Out Notification Dispatcher
 */
async function notifyCheckOut({ pool, name, userId, email, timeIST, hoursWorked, isEarly = false, method = 'Biometric Scanner' }) {
    try {
        const settings = await getSlackSettings(pool);
        const statusText = isEarly ? 'Early Check-Out - Sent for Approval' : 'Standard Check-Out';

        const templateVars = {
            name: name || userId || 'Employee',
            userId: userId || '',
            time: timeIST,
            status: statusText,
            hoursWorked: hoursWorked || '',
            method: method,
            portalUrl: settings.portalUrl || 'https://attendance.flyingpluto.ai'
        };

        // 1. Send clean 1-on-1 DM to employee
        const employeeSlackId = await resolveSlackUserId({ userId, name, email });
        if (employeeSlackId) {
            const templateToUse = isEarly ? settings.employeeEarlyCheckOutTemplate : settings.employeeCheckOutTemplate;
            const empMessage = renderTemplate(templateToUse, templateVars);
            await sendDirectMessage(employeeSlackId, empMessage);
        }

        // 2. Broadcast clean notification to all Admin Recipients
        const adminRecipients = Array.isArray(settings.adminRecipients) ? settings.adminRecipients : [];
        if (adminRecipients.length > 0) {
            const adminMessage = renderTemplate(settings.adminCheckOutTemplate, templateVars);
            for (const adminEmail of adminRecipients) {
                const adminSlackId = await resolveSlackUserId({ email: adminEmail });
                if (adminSlackId) {
                    await sendDirectMessage(adminSlackId, adminMessage);
                }
            }
        }
    } catch (err) {
        console.error('[Slack] notifyCheckOut error:', err);
    }
}

/**
 * Notifies Admins at 11:00 AM if employees have not checked in and are not on leave
 */
async function notifyMissingCheckIns({ pool, missingEmployees, timeIST = '11:00 AM' }) {
    if (!missingEmployees || missingEmployees.length === 0) return;
    try {
        const settings = await getSlackSettings(pool);
        if (settings.lateCheckInEnabled === false) return;
        const adminRecipients = Array.isArray(settings.adminRecipients) ? settings.adminRecipients : [];
        if (adminRecipients.length === 0) return;

        const employeeListStr = missingEmployees.map(e => `- ${e}`).join('\n');
        const portalUrl = settings.portalUrl || 'https://attendance.flyingpluto.ai';

        const message = `Missing Check-In Alert (${timeIST})\nThe following employees have not checked in today and are not on approved leave:\n${employeeListStr}\n\nFor More Details - ${portalUrl}`;

        for (const adminEmail of adminRecipients) {
            const adminSlackId = await resolveSlackUserId({ email: adminEmail });
            if (adminSlackId) {
                await sendDirectMessage(adminSlackId, message);
            }
        }
    } catch (err) {
        console.error('[Slack] notifyMissingCheckIns error:', err);
    }
}

/**
 * Notifies employee when admin approves or rejects early checkout
 */
async function notifyEarlyClockoutDecision({ pool, userId, name, email, date, action }) {
    try {
        const settings = await getSlackSettings(pool);
        const template = action === 'reject'
            ? (settings.employeeEarlyRejectedTemplate || 'Early Check-Out Request Rejected\nYour early checkout request for {date} was rejected by Admin. Please resume your shift.')
            : (settings.employeeEarlyApprovedTemplate || 'Early Check-Out Approved\nYour early checkout request for {date} has been approved. Shift completed.');

        const templateVars = {
            name: name || userId || 'Employee',
            userId: userId || '',
            date: date || 'today',
            portalUrl: settings.portalUrl || 'https://attendance.flyingpluto.ai'
        };

        const employeeSlackId = await resolveSlackUserId({ userId, name, email });
        if (employeeSlackId) {
            const message = renderTemplate(template, templateVars);
            await sendDirectMessage(employeeSlackId, message);
        }
    } catch (err) {
        console.error('[Slack] notifyEarlyClockoutDecision error:', err);
    }
}

module.exports = {
    DEFAULT_SLACK_SETTINGS,
    getSlackSettings,
    notifyCheckIn,
    notifyCheckOut,
    notifyMissingCheckIns,
    notifyEarlyClockoutDecision,
    sendDirectMessage,
    resolveSlackUserId
};


