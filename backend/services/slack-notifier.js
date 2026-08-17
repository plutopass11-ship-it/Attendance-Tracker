// backend/services/slack-notifier.js
const https = require('https');

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN || '';
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL || '';

// Cache of userId/email -> slackMemberId
const userSlackCache = new Map();

/**
 * Performs a Slack API request with Bearer Auth
 */
function slackApiRequest(path, method, payload = null) {
    const token = process.env.SLACK_BOT_TOKEN || SLACK_BOT_TOKEN;
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

    const cacheKey = userId || email || name;
    if (userSlackCache.has(cacheKey)) {
        return userSlackCache.get(cacheKey);
    }

    // 1. Try lookup by email if provided
    if (email) {
        const emailRes = await slackApiRequest(`users.lookupByEmail?email=${encodeURIComponent(email)}`, 'GET');
        if (emailRes.ok && emailRes.user && emailRes.user.id) {
            const sid = emailRes.user.id;
            userSlackCache.set(cacheKey, sid);
            if (userId) userSlackCache.set(userId, sid);
            return sid;
        }
    }

    // 2. Fetch users list and match by name or username
    const listRes = await slackApiRequest('users.list', 'GET');
    if (listRes.ok && listRes.members) {
        const cleanTarget = (userId || name || '').toLowerCase().trim();
        const member = listRes.members.find(m => {
            if (m.is_bot || m.deleted) return false;
            const mName = (m.name || '').toLowerCase();
            const mReal = (m.real_name || '').toLowerCase();
            const mEmail = (m.profile && m.profile.email) ? m.profile.email.toLowerCase() : '';
            return mName === cleanTarget || mReal === cleanTarget || mEmail.startsWith(cleanTarget);
        });

        if (member) {
            const sid = member.id;
            userSlackCache.set(cacheKey, sid);
            if (userId) userSlackCache.set(userId, sid);
            return sid;
        }
    }

    return null;
}

/**
 * Sends a private 1-on-1 Direct Message to an employee
 */
async function sendDirectMessage(slackUserId, text, blocks = null) {
    if (!slackUserId) return;
    const payload = {
        channel: slackUserId,
        text: text
    };
    if (blocks) payload.blocks = blocks;

    const res = await slackApiRequest('chat.postMessage', 'POST', payload);
    if (!res.ok) {
        console.error(`[Slack] Failed to send DM to ${slackUserId}:`, res.error);
    }
    return res;
}

/**
 * Notifies employee privately on Check-In
 */
async function notifyCheckIn({ name, userId, email, timeIST, method = 'Biometric Scanner', isWfh = false }) {
    try {
        const slackUserId = await resolveSlackUserId({ userId, name, email });
        const locationText = isWfh ? '🏠 Work From Home' : '🏢 In Office';
        const displayName = name || userId || 'there';

        const text = `🟢 Good morning ${displayName}! Your check-in is confirmed at ${timeIST} (${locationText}).`;
        const blocks = [
            {
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `🟢 *Check-In Confirmed*\nGood morning, *${displayName}*! 👋\n\n⏰ *Time*: *${timeIST}*\n📍 *Location*: ${locationText}\n📱 *Method*: ${method}\n\n_Have a productive and great day at Flying Pluto!_ ✨`
                }
            }
        ];

        if (slackUserId) {
            await sendDirectMessage(slackUserId, text, blocks);
        } else {
            console.log(`[Slack] No matching Slack member found for ${userId} (${name})`);
        }
    } catch (err) {
        console.error('[Slack] notifyCheckIn error:', err);
    }
}

/**
 * Notifies employee privately on Check-Out
 */
async function notifyCheckOut({ name, userId, email, timeIST, hoursWorked, status, method = 'Biometric Scanner' }) {
    try {
        const slackUserId = await resolveSlackUserId({ userId, name, email });
        const displayName = name || userId || 'there';

        let statusEmoji = '🔵';
        let statusLabel = 'Shift Completed';

        if (status === 'pending_early_clockout' || status === 'wfh_pending_early_clockout') {
            statusEmoji = '🟡';
            statusLabel = 'Early Clock-Out (Pending Admin Review)';
        } else if (status === 'half_day' || (hoursWorked && parseFloat(hoursWorked) < 4)) {
            statusEmoji = '🟠';
            statusLabel = 'Short Shift (< 4h) — Half-Day Leave Generated';
        }

        const text = `${statusEmoji} Goodbye ${displayName}! Your check-out is confirmed at ${timeIST}. Hours worked: ${hoursWorked || 'N/A'}.`;
        const blocks = [
            {
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `${statusEmoji} *Check-Out Confirmed*\nGoodbye, *${displayName}*! 👋\n\n⏰ *Time*: *${timeIST}*\n⏱️ *Hours Worked*: *${hoursWorked || 'N/A'}*\n📊 *Status*: ${statusLabel}\n📱 *Method*: ${method}\n\n_Enjoy your evening!_ 🎉`
                }
            }
        ];

        if (slackUserId) {
            await sendDirectMessage(slackUserId, text, blocks);
        } else {
            console.log(`[Slack] No matching Slack member found for ${userId} (${name})`);
        }
    } catch (err) {
        console.error('[Slack] notifyCheckOut error:', err);
    }
}

module.exports = {
    notifyCheckIn,
    notifyCheckOut,
    sendDirectMessage,
    resolveSlackUserId
};
