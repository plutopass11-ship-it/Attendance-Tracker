#!/bin/sh
# ==============================================================================
# Attendance Tracker - Synology DSM Daily Database Backup Script
# Can be scheduled via DSM: Control Panel > Task Scheduler > Scheduled Task (Root)
# Schedule: Run Daily at 02:00 AM IST
# ==============================================================================

BACKUP_DIR="/volume1/docker/Apps/Attendance-Tracker/backups"
LOG_FILE="${BACKUP_DIR}/backup.log"
DATE=$(date +%Y-%m-%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/backup_${DATE}.sql.gz"

mkdir -p "${BACKUP_DIR}"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting PostgreSQL backup..." >> "${LOG_FILE}"

# Dump directly from running PostgreSQL container
docker exec attendance-postgres pg_dump -U attendance_admin attendance_tracker 2>> "${LOG_FILE}" | gzip > "${BACKUP_FILE}"

if [ -s "${BACKUP_FILE}" ]; then
    SIZE=$(du -h "${BACKUP_FILE}" | awk '{print $1}')
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Backup created successfully: ${BACKUP_FILE} (${SIZE})" >> "${LOG_FILE}"
else
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: Backup failed or produced empty file!" >> "${LOG_FILE}"
fi

# Rotate backups: delete backups older than 14 days
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Cleaning up backups older than 14 days..." >> "${LOG_FILE}"
find "${BACKUP_DIR}" -name "backup_*.sql.gz" -mtime +14 -exec rm -f {} \; >> "${LOG_FILE}" 2>&1

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Backup run finished." >> "${LOG_FILE}"
