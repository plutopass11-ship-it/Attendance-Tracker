// backend/services/backup-service.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { pipeline } = require('stream/promises');
const slackNotifier = require('./slack-notifier');

const BACKUP_DIR = path.join(__dirname, '..', 'backups');

// Ensure backups directory exists
function ensureBackupDir() {
    if (!fs.existsSync(BACKUP_DIR)) {
        fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function escapeSqlValue(val) {
    if (val === null || val === undefined) return 'NULL';
    if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
    if (typeof val === 'number') return String(val);
    if (val instanceof Date) return `'${val.toISOString()}'`;
    if (typeof val === 'object') {
        const jsonStr = JSON.stringify(val).replace(/'/g, "''");
        return `'${jsonStr}'`;
    }
    const str = String(val).replace(/'/g, "''");
    return `'${str}'`;
}

/**
 * Creates a complete PostgreSQL backup (.sql.gz) for public tables
 */
async function createBackup(pool, customFilename = null) {
    ensureBackupDir();
    const startTime = Date.now();

    const now = new Date();
    const istTimeStr = now.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    const pad = (n) => String(n).padStart(2, '0');
    const y = now.getFullYear();
    const m = pad(now.getMonth() + 1);
    const d = pad(now.getDate());
    const h = pad(now.getHours());
    const min = pad(now.getMinutes());
    const s = pad(now.getSeconds());

    const filename = customFilename || `backup_${y}-${m}-${d}_${h}${min}${s}.sql.gz`;
    const filePath = path.join(BACKUP_DIR, filename);

    const client = await pool.connect();
    let totalRows = 0;
    let tablesCount = 0;

    try {
        await client.query('BEGIN READ ONLY');

        // Fetch all tables in public schema
        const tablesRes = await client.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
              AND table_type = 'BASE TABLE'
            ORDER BY table_name;
        `);

        // Sort tables to ensure parent tables come before dependent child tables
        const preferredOrder = [
            'leave_policies',
            'holidays',
            'users',
            'system_settings',
            'biometric_users',
            'attendance',
            'leave_requests',
            'holiday_claims',
            'biometric_logs',
            'device_commands',
            'enrollment_sessions',
            'audit_logs'
        ];

        const allTables = tablesRes.rows.map(r => r.table_name);
        const sortedTables = [
            ...preferredOrder.filter(t => allTables.includes(t)),
            ...allTables.filter(t => !preferredOrder.includes(t))
        ];

        // Create write stream through gzip
        const fileStream = fs.createWriteStream(filePath);
        const gzipStream = zlib.createGzip({ level: 9 });
        gzipStream.pipe(fileStream);

        // Helper to write to stream
        const writeChunk = (text) => {
            return new Promise((resolve, reject) => {
                if (!gzipStream.write(text, 'utf8')) {
                    gzipStream.once('drain', resolve);
                } else {
                    resolve();
                }
            });
        };

        // Write SQL Header
        await writeChunk(`-- ========================================================\n`);
        await writeChunk(`-- Attendance Tracker PostgreSQL Automated Backup\n`);
        await writeChunk(`-- Generated At: ${now.toISOString()} (${istTimeStr} IST)\n`);
        await writeChunk(`-- ========================================================\n\n`);
        await writeChunk(`SET statement_timeout = 0;\n`);
        await writeChunk(`SET client_encoding = 'UTF8';\n`);
        await writeChunk(`SET standard_conforming_strings = on;\n`);
        await writeChunk(`SET check_function_bodies = false;\n`);
        await writeChunk(`SET client_min_messages = warning;\n\n`);
        await writeChunk(`BEGIN;\n\n`);

        for (const tableName of sortedTables) {
            tablesCount++;
            await writeChunk(`--\n-- Table: ${tableName}\n--\n`);

            // Get columns
            const colRes = await client.query(`
                SELECT column_name, data_type, is_nullable, column_default
                FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = $1
                ORDER BY ordinal_position;
            `, [tableName]);

            const colNames = colRes.rows.map(c => `"${c.column_name}"`);
            const colNamesList = colNames.join(', ');

            // Fetch table rows
            const rowsRes = await client.query(`SELECT * FROM "${tableName}";`);
            const rowCount = rowsRes.rows.length;
            totalRows += rowCount;

            await writeChunk(`-- Row count: ${rowCount}\n`);

            if (rowCount > 0) {
                for (const row of rowsRes.rows) {
                    const values = colRes.rows.map(c => escapeSqlValue(row[c.column_name]));
                    await writeChunk(`INSERT INTO "${tableName}" (${colNamesList}) VALUES (${values.join(', ')}) ON CONFLICT DO NOTHING;\n`);
                }
            }
            await writeChunk(`\n`);
        }

        // Handle sequences
        const seqRes = await client.query(`
            SELECT sequence_name 
            FROM information_schema.sequences 
            WHERE sequence_schema = 'public';
        `);

        if (seqRes.rows.length > 0) {
            await writeChunk(`--\n-- Update Sequences\n--\n`);
            for (const seq of seqRes.rows) {
                const sName = seq.sequence_name;
                // Guess table and column from seq name (convention: tablename_id_seq)
                const match = sName.match(/^(.+)_([a-zA-Z0-9]+)_seq$/);
                if (match) {
                    const tName = match[1];
                    const cName = match[2];
                    if (sortedTables.includes(tName)) {
                        await writeChunk(`SELECT setval('${sName}', COALESCE((SELECT MAX("${cName}") FROM "${tName}"), 1), true);\n`);
                    }
                }
            }
            await writeChunk(`\n`);
        }

        await writeChunk(`COMMIT;\n`);

        // Close gzip stream and wait for file flush
        await new Promise((resolve, reject) => {
            fileStream.on('finish', resolve);
            fileStream.on('error', reject);
            gzipStream.on('error', reject);
            gzipStream.end();
        });

        await client.query('COMMIT');

        const durationMs = Date.now() - startTime;
        const stats = fs.statSync(filePath);
        const sizeFormatted = formatBytes(stats.size);

        console.log(`[BACKUP] Successfully created ${filename} (${sizeFormatted}) in ${durationMs}ms with ${totalRows} rows across ${tablesCount} tables.`);

        // Rotate older backups
        rotateBackups();

        // Notify Slack
        if (slackNotifier && typeof slackNotifier.notifyBackupResult === 'function') {
            await slackNotifier.notifyBackupResult({
                pool,
                success: true,
                filename,
                sizeFormatted,
                totalRows,
                durationMs
            });
        }

        return {
            success: true,
            filename,
            filePath,
            sizeBytes: stats.size,
            sizeFormatted,
            durationMs,
            tablesCount,
            totalRows,
            createdAt: now.toISOString()
        };

    } catch (err) {
        try { await client.query('ROLLBACK'); } catch (_) {}
        console.error('[BACKUP] Error creating backup:', err);

        if (slackNotifier && typeof slackNotifier.notifyBackupResult === 'function') {
            await slackNotifier.notifyBackupResult({
                pool,
                success: false,
                filename,
                error: err.message
            });
        }

        throw err;
    } finally {
        client.release();
    }
}

/**
 * Rotates backups: keeps 7 daily backups, 4 weekly, 3 monthly
 */
function rotateBackups() {
    ensureBackupDir();
    try {
        const files = fs.readdirSync(BACKUP_DIR)
            .filter(f => f.endsWith('.sql.gz'))
            .map(f => {
                const p = path.join(BACKUP_DIR, f);
                const stat = fs.statSync(p);
                return { name: f, path: p, mtime: stat.mtimeMs };
            })
            .sort((a, b) => b.mtime - a.mtime); // Newest first

        if (files.length <= 7) return { deletedCount: 0 };

        const now = Date.now();
        const ONE_DAY = 24 * 60 * 60 * 1000;
        const SEVEN_DAYS = 7 * ONE_DAY;

        const toKeep = new Set();
        const weeklyBuckets = new Set();
        const monthlyBuckets = new Set();

        for (const file of files) {
            const age = now - file.mtime;
            const date = new Date(file.mtime);
            const yearWeek = `${date.getFullYear()}-W${Math.floor(date.getDate() / 7)}`;
            const yearMonth = `${date.getFullYear()}-${date.getMonth() + 1}`;

            // Keep everything under 7 days
            if (age <= SEVEN_DAYS) {
                toKeep.add(file.name);
            }
            // Keep 1 per week for 4 weeks
            else if (age <= 30 * ONE_DAY && weeklyBuckets.size < 4 && !weeklyBuckets.has(yearWeek)) {
                weeklyBuckets.add(yearWeek);
                toKeep.add(file.name);
            }
            // Keep 1 per month for 3 months
            else if (age <= 90 * ONE_DAY && monthlyBuckets.size < 3 && !monthlyBuckets.has(yearMonth)) {
                monthlyBuckets.add(yearMonth);
                toKeep.add(file.name);
            }
        }

        let deletedCount = 0;
        for (const file of files) {
            if (!toKeep.has(file.name)) {
                fs.unlinkSync(file.path);
                console.log(`[BACKUP] Rotated (deleted) old backup: ${file.name}`);
                deletedCount++;
            }
        }

        return { deletedCount };
    } catch (err) {
        console.error('[BACKUP] Error during backup rotation:', err);
        return { deletedCount: 0, error: err.message };
    }
}

/**
 * Lists all existing backups
 */
function listBackups() {
    ensureBackupDir();
    try {
        const files = fs.readdirSync(BACKUP_DIR)
            .filter(f => f.endsWith('.sql.gz'))
            .map(f => {
                const p = path.join(BACKUP_DIR, f);
                const stat = fs.statSync(p);
                return {
                    filename: f,
                    sizeBytes: stat.size,
                    sizeFormatted: formatBytes(stat.size),
                    createdAt: stat.mtime.toISOString(),
                    mtimeMs: stat.mtimeMs
                };
            })
            .sort((a, b) => b.mtimeMs - a.mtimeMs);

        return files;
    } catch (err) {
        console.error('[BACKUP] Error listing backups:', err);
        return [];
    }
}

/**
 * Returns absolute path for a specific backup file
 */
function getBackupFilePath(filename) {
    ensureBackupDir();
    const safeName = path.basename(filename);
    const fullPath = path.join(BACKUP_DIR, safeName);
    if (fs.existsSync(fullPath) && safeName.endsWith('.sql.gz')) {
        return fullPath;
    }
    return null;
}

/**
 * Schedules daily backup at 02:00 AM IST
 */
function scheduleDailyBackup(pool) {
    function getMsUntilNext2AmIST() {
        const now = new Date();
        // Convert to IST offset: +5:30 (330 minutes)
        const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
        const ist = new Date(utc + (330 * 60000));

        const targetIST = new Date(ist);
        targetIST.setHours(2, 0, 0, 0); // 02:00:00.000 AM IST

        if (ist.getTime() >= targetIST.getTime()) {
            // Already passed 02:00 AM IST today, schedule for tomorrow
            targetIST.setDate(targetIST.getDate() + 1);
        }

        const msRemaining = targetIST.getTime() - ist.getTime();
        return msRemaining;
    }

    const msUntilNext = getMsUntilNext2AmIST();
    const hoursRemaining = (msUntilNext / (1000 * 60 * 60)).toFixed(2);
    console.log(`[BACKUP] Automated daily backup scheduled for 02:00 AM IST (in ${hoursRemaining} hours).`);

    setTimeout(async () => {
        try {
            console.log('[BACKUP] Running scheduled 02:00 AM IST database backup...');
            await createBackup(pool);
        } catch (err) {
            console.error('[BACKUP] Scheduled backup failed:', err);
        } finally {
            // Reschedule for next day
            scheduleDailyBackup(pool);
        }
    }, msUntilNext);
}

module.exports = {
    createBackup,
    rotateBackups,
    listBackups,
    getBackupFilePath,
    scheduleDailyBackup,
    formatBytes
};
