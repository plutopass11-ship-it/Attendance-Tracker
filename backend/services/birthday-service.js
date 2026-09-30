/**
 * Birthday & Employee Management Service (PEMDA Integration)
 * Integrates Attendance Tracker with Pluto Studio Employee & Talent Dashboard (port 7589)
 * Fetches, caches, and matches employee birthdays and personnel details.
 */

const PEMDA_URL = process.env.PEMDA_URL || 'http://192.168.1.60:7589';

class BirthdayService {
  constructor() {
    this.pemdaUrl = PEMDA_URL;
    this.birthdaysCache = [];
    this.employeesCache = [];
    this.lastSyncTime = null;
    this.syncInterval = null;
    this.isSyncing = false;
  }

  /**
   * Initialize service and start background polling
   */
  async init(pollMinutes = 30) {
    console.log(`[Birthday Service] Initializing with PEMDA at ${this.pemdaUrl}...`);
    await this.syncFromPemda();
    
    // Poll every 30 minutes to keep birthdays fresh
    if (this.syncInterval) clearInterval(this.syncInterval);
    this.syncInterval = setInterval(() => {
      this.syncFromPemda().catch(err => {
        console.warn('[Birthday Service] Periodic sync warning:', err.message);
      });
    }, pollMinutes * 60 * 1000);
  }

  /**
   * Fetch latest birthdays and employees from PEMDA
   */
  async syncFromPemda() {
    if (this.isSyncing) return;
    this.isSyncing = true;
    try {
      const [bdayRes, empRes] = await Promise.allSettled([
        fetch(`${this.pemdaUrl}/api/birthdays`, { signal: AbortSignal.timeout(6000) }),
        fetch(`${this.pemdaUrl}/api/employees`, { signal: AbortSignal.timeout(6000) })
      ]);

      if (bdayRes.status === 'fulfilled' && bdayRes.value.ok) {
        const bdayData = await bdayRes.value.json();
        if (Array.isArray(bdayData.birthdays)) {
          this.birthdaysCache = bdayData.birthdays;
          console.log(`[Birthday Service] Synced ${this.birthdaysCache.length} employee birthday(s) from PEMDA.`);
        }
      } else {
        const reason = bdayRes.status === 'rejected' ? bdayRes.reason.message : `HTTP ${bdayRes.value?.status}`;
        console.warn(`[Birthday Service] Could not fetch /api/birthdays (${reason}). Retaining ${this.birthdaysCache.length} cached record(s).`);
      }

      if (empRes.status === 'fulfilled' && empRes.value.ok) {
        const empData = await empRes.value.json();
        if (Array.isArray(empData.employees)) {
          this.employeesCache = empData.employees;
        }
      }

      this.lastSyncTime = new Date();
    } catch (err) {
      console.warn('[Birthday Service] Sync error:', err.message);
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Normalizes a name string for fuzzy matching (case, whitespace, punctuation)
   */
  normalizeName(str) {
    if (!str) return '';
    return str.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  /**
   * Check if today is the birthday of the user (identified by userId/email and/or name)
   * Evaluated in IST (Asia/Kolkata)
   */
  isBirthdayToday(userId, name) {
    if (!userId && !name) return { isBirthday: false };

    // Get today's IST month and day
    const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const currentMonth = nowIST.getMonth() + 1; // 1-12
    const currentDay = nowIST.getDate(); // 1-31

    const normUser = (userId || '').trim().toLowerCase();
    const normName = this.normalizeName(name);

    for (const b of this.birthdaysCache) {
      const bEmail = (b.email || '').trim().toLowerCase();
      const bName = this.normalizeName(b.name);

      // Check match by email OR name match
      let isMatch = false;
      if (normUser && bEmail && normUser === bEmail) {
        isMatch = true;
      } else if (normName && bName) {
        if (normName === bName || normName.includes(bName) || bName.includes(normName)) {
          isMatch = true;
        }
      }

      if (isMatch && b.dateOfBirth) {
        // Parse dateOfBirth YYYY-MM-DD
        const parts = b.dateOfBirth.split('-');
        if (parts.length >= 3) {
          const birthMonth = parseInt(parts[1], 10);
          const birthDay = parseInt(parts[2], 10);

          if (birthMonth === currentMonth && birthDay === currentDay) {
            return {
              isBirthday: true,
              person: {
                name: b.name || name,
                empId: b.empId,
                dateOfBirth: b.dateOfBirth,
                age: b.turningAge,
                classification: b.classification
              }
            };
          }
        }
      }
    }

    return { isBirthday: false };
  }

  /**
   * Get all employees celebrating their birthday today (IST)
   */
  getTodayCelebrants() {
    const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const currentMonth = nowIST.getMonth() + 1;
    const currentDay = nowIST.getDate();

    return this.birthdaysCache.filter(b => {
      if (!b.dateOfBirth) return false;
      const parts = b.dateOfBirth.split('-');
      if (parts.length < 3) return false;
      return parseInt(parts[1], 10) === currentMonth && parseInt(parts[2], 10) === currentDay;
    });
  }

  /**
   * Get upcoming birthdays list, sorted with nearest first
   */
  getUpcomingBirthdays(limit = 10) {
    const list = [...this.birthdaysCache];
    list.sort((a, b) => (a.daysUntilBirthday || 999) - (b.daysUntilBirthday || 999));
    return list.slice(0, limit);
  }

  /**
   * Get full summary for attendance dashboard
   */
  getStatus() {
    return {
      connected: this.birthdaysCache.length > 0 || this.lastSyncTime !== null,
      pemdaUrl: this.pemdaUrl,
      lastSync: this.lastSyncTime ? this.lastSyncTime.toISOString() : null,
      birthdaysCount: this.birthdaysCache.length,
      employeesCount: this.employeesCache.length,
      todayBirthdays: this.getTodayCelebrants()
    };
  }
}

module.exports = new BirthdayService();
