// reports.js — Reports & Analytics Module (Admin-only)
// Redesigned to match the OnlyGenius SaaS Dashboard aesthetic

window.ReportsUI = {

    _hoursTrendChart: null,
    _artistHoursChart: null,

    // ─── Master Settings (defaults) ───
    _settings: { workDays: 6, dailyHours: 8 },

    // ─── Initialization ───
    init: function() {
        this._loadSettings();
        this.render();
    },

    _loadSettings: function() {
        try {
            const saved = JSON.parse(localStorage.getItem('studioSettings'));
            if (saved) Object.assign(this._settings, saved);
        } catch(e) {}
    },

    _saveSettings: function() {
        localStorage.setItem('studioSettings', JSON.stringify(this._settings));
        fetch('/api/settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(this._settings)
        }).catch(err => console.error('Settings save error:', err));
    },

    // ─── Utility: Parse check-in/out times to minutes since midnight ───
    _parseTimeToMinutes: function(timeStr) {
        if (!timeStr || timeStr === '--:--') return null;
        const cleaned = timeStr.replace(/\s*\(.*?\)\s*/g, '').trim();
        const match = cleaned.match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/i);
        if (!match) return null;
        let h = parseInt(match[1], 10);
        const m = parseInt(match[2], 10);
        const ampm = match[3];
        if (ampm) {
            if (ampm.toLowerCase() === 'pm' && h < 12) h += 12;
            if (ampm.toLowerCase() === 'am' && h === 12) h = 0;
        }
        return h * 60 + m;
    },

    // ─── Utility: Compute hours worked for a single attendance record ───
    _getHoursWorked: function(record) {
        const inMin = this._parseTimeToMinutes(record.checkInTime);
        const outMin = this._parseTimeToMinutes(record.checkOutTime);
        if (inMin === null || outMin === null || outMin <= inMin) return 0;
        return (outMin - inMin) / 60;
    },

    // ─── Utility: Date helpers ───
    _today: function() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    },
    _startOfWeek: function() {
        const d = new Date();
        const day = d.getDay(); // 0=Sun
        const diff = day === 0 ? 6 : day - 1; // Monday start
        d.setDate(d.getDate() - diff);
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    },
    _startOfMonth: function() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;
    },
    _startOfYear: function() {
        return `${new Date().getFullYear()}-01-01`;
    },

    // ─── Core: Compute hours for a user within a date range ───
    _getUserHours: function(userId, fromDate, toDate) {
        const attendance = Store.getAttendance();
        return attendance
            .filter(r => r.userId === userId && r.date >= fromDate && r.date <= toDate)
            .reduce((total, r) => total + this._getHoursWorked(r), 0);
    },

    // ─── Core: Get all users' hours as an array ───
    _getAllUsersHours: function(fromDate, toDate) {
        const users = Store.getUsers().filter(u => u.role !== 'admin');
        const attendance = Store.getAttendance();
        return users.map(u => {
            const records = attendance.filter(r => r.userId === u.id && r.date >= fromDate && r.date <= toDate);
            const totalHours = records.reduce((sum, r) => sum + this._getHoursWorked(r), 0);
            const daysWorked = records.filter(r => this._getHoursWorked(r) > 0).length;
            return { 
                userId: u.id, 
                name: u.name, 
                email: u.email || `${u.id}@flyingpluto.ai`,
                department: u.department || 'Production',
                totalHours, 
                daysWorked, 
                records 
            };
        });
    },

    // ─── Core: Studio-wide totals ───
    _getStudioTotals: function(fromDate, toDate) {
        const all = this._getAllUsersHours(fromDate, toDate);
        const totalManHours = all.reduce((s, u) => s + u.totalHours, 0);
        const totalManDays = all.reduce((s, u) => s + u.daysWorked, 0);
        return { totalManHours, totalManDays, userCount: all.length, data: all };
    },

    // ─── Core: Average check-in time for a user ───
    _getAvgCheckIn: function(userId) {
        const records = Store.getAttendance().filter(r => r.userId === userId);
        const checkInMinutes = records.map(r => this._parseTimeToMinutes(r.checkInTime)).filter(m => m !== null);
        if (checkInMinutes.length === 0) return '--:--';
        const avg = Math.round(checkInMinutes.reduce((s,m) => s + m, 0) / checkInMinutes.length);
        const h = Math.floor(avg / 60);
        const m = avg % 60;
        const ampm = h >= 12 ? 'PM' : 'AM';
        const h12 = h > 12 ? h - 12 : (h === 0 ? 12 : h);
        return `${h12}:${String(m).padStart(2,'0')} ${ampm}`;
    },

    // ─── Core: Burnout detection (7-day rolling avg > 10 hrs/day) ───
    _getBurnoutFlags: function() {
        const users = Store.getUsers().filter(u => u.role !== 'admin');
        const attendance = Store.getAttendance();
        const today = new Date();
        const sevenAgo = new Date(today);
        sevenAgo.setDate(today.getDate() - 7);
        const fromStr = `${sevenAgo.getFullYear()}-${String(sevenAgo.getMonth()+1).padStart(2,'0')}-${String(sevenAgo.getDate()).padStart(2,'0')}`;
        const toStr = this._today();

        const flags = [];
        users.forEach(u => {
            const records = attendance.filter(r => r.userId === u.id && r.date >= fromStr && r.date <= toStr);
            const totalHrs = records.reduce((s, r) => s + this._getHoursWorked(r), 0);
            const daysWorked = records.filter(r => this._getHoursWorked(r) > 0).length;
            if (daysWorked > 0 && (totalHrs / daysWorked) > 10) {
                flags.push({ name: u.name, avgHrs: (totalHrs / daysWorked).toFixed(1), totalHrs: totalHrs.toFixed(1), daysWorked });
            }
        });
        return flags;
    },

    // ─── Core: Flex-time balance ───
    _getFlexBalance: function(fromDate, toDate) {
        const users = Store.getUsers().filter(u => u.role !== 'admin');
        const s = this._settings;
        const from = new Date(fromDate);
        const to = new Date(toDate);
        let totalWorkingDays = 0;
        const d = new Date(from);
        while (d <= to) {
            const dow = d.getDay();
            if (s.workDays === 5) {
                if (dow !== 0 && dow !== 6) totalWorkingDays++;
            } else if (s.workDays === 6) {
                if (dow !== 0) totalWorkingDays++;
            } else {
                totalWorkingDays++;
            }
            d.setDate(d.getDate() + 1);
        }

        const expectedHoursPerPerson = totalWorkingDays * s.dailyHours;
        return users.map(u => {
            const actual = this._getUserHours(u.id, fromDate, toDate);
            const diff = actual - expectedHoursPerPerson;
            return { 
                userId: u.id, 
                name: u.name, 
                department: u.department || 'Production',
                expected: expectedHoursPerPerson, 
                actual: Math.round(actual * 10) / 10, 
                diff: Math.round(diff * 10) / 10 
            };
        });
    },

    // ─── Trend Timeline Data Builder ───
    _getTrendData: function(period) {
        const attendance = Store.getAttendance();
        const labels = [];
        const data = [];
        const now = new Date();

        if (period === 'weekly') {
            const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
            const startOfWeek = new Date(now);
            const curDay = now.getDay();
            const diff = curDay === 0 ? 6 : curDay - 1;
            startOfWeek.setDate(now.getDate() - diff);

            for (let i = 0; i < 7; i++) {
                const d = new Date(startOfWeek);
                d.setDate(startOfWeek.getDate() + i);
                const dStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
                labels.push(dayNames[i]);
                const dayHours = attendance
                    .filter(r => r.date === dStr)
                    .reduce((sum, r) => sum + this._getHoursWorked(r), 0);
                data.push(Math.round(dayHours * 10) / 10);
            }
        } else if (period === 'monthly') {
            const year = now.getFullYear();
            const month = now.getMonth();
            const daysInMonth = new Date(year, month + 1, 0).getDate();
            const steps = [1, 7, 14, 21, 28, daysInMonth];
            for (let i = 0; i < steps.length - 1; i++) {
                const s = steps[i];
                const e = steps[i+1];
                labels.push(`Day ${s}-${e}`);
                const blockHours = attendance
                    .filter(r => {
                        if (!r.date.startsWith(`${year}-${String(month+1).padStart(2,'0')}`)) return false;
                        const dayNum = parseInt(r.date.split('-')[2], 10);
                        return dayNum >= s && dayNum <= e;
                    })
                    .reduce((sum, r) => sum + this._getHoursWorked(r), 0);
                data.push(Math.round(blockHours * 10) / 10);
            }
        } else {
            const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            for (let i = 11; i >= 0; i--) {
                const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
                const y = d.getFullYear();
                const m = d.getMonth();
                const prefix = `${y}-${String(m+1).padStart(2,'0')}`;
                labels.push(monthNames[m]);
                const mHours = attendance
                    .filter(r => r.date.startsWith(prefix))
                    .reduce((sum, r) => sum + this._getHoursWorked(r), 0);
                data.push(Math.round(mHours * 10) / 10);
            }
        }

        return { labels, data };
    },

    // ─── CSV Export ───
    _downloadCSV: function(filename, headers, rows) {
        const csvContent = [headers.join(',')]
            .concat(rows.map(r => r.map(v => `"${v}"`).join(',')))
            .join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        link.click();
        URL.revokeObjectURL(link.href);
    },

    exportIndividual: function(period) {
        const ranges = this._getRange(period);
        const data = this._getAllUsersHours(ranges.from, ranges.to);
        const headers = ['Employee', 'Department', 'Total Hours', 'Days Worked', 'Avg Hours/Day'];
        const rows = data.map(u => [
            u.name,
            u.department,
            u.totalHours.toFixed(1),
            u.daysWorked,
            u.daysWorked > 0 ? (u.totalHours / u.daysWorked).toFixed(1) : '0'
        ]);
        this._downloadCSV(`individual_hours_${period}.csv`, headers, rows);
    },

    exportCompany: function(period) {
        const ranges = this._getRange(period);
        const totals = this._getStudioTotals(ranges.from, ranges.to);
        const headers = ['Metric', 'Value'];
        const rows = [
            ['Period', period],
            ['From', ranges.from],
            ['To', ranges.to],
            ['Total Man-Hours', totals.totalManHours.toFixed(1)],
            ['Total Man-Days', totals.totalManDays],
            ['Total Employees', totals.userCount],
            ['Avg Hours/Employee', totals.userCount > 0 ? (totals.totalManHours / totals.userCount).toFixed(1) : '0']
        ];
        this._downloadCSV(`studio_analytics_${period}.csv`, headers, rows);
    },

    _getRange: function(period) {
        const to = this._today();
        let from;
        switch(period) {
            case 'weekly': from = this._startOfWeek(); break;
            case 'monthly': from = this._startOfMonth(); break;
            case 'yearly': from = this._startOfYear(); break;
            default: from = '2020-01-01'; break;
        }
        return { from, to };
    },

    // ─── Settings Modal ───
    openSettings: function() {
        const wDays = document.getElementById('setting-work-days');
        const dHours = document.getElementById('setting-daily-hours');
        if (wDays) wDays.value = this._settings.workDays;
        if (dHours) dHours.value = this._settings.dailyHours;
        document.getElementById('studio-settings-modal')?.classList.remove('hidden');
    },

    saveSettings: function() {
        this._settings.workDays = parseInt(document.getElementById('setting-work-days')?.value, 10) || 6;
        this._settings.dailyHours = parseInt(document.getElementById('setting-daily-hours')?.value, 10) || 8;
        this._saveSettings();
        document.getElementById('studio-settings-modal')?.classList.add('hidden');
        this.render();
    },

    // ─── Main Render ───
    render: function() {
        const container = document.getElementById('reports-content');
        if (!container) return;

        const period = document.getElementById('reports-period-select')?.value || 'weekly';
        const ranges = this._getRange(period);
        const allData = this._getAllUsersHours(ranges.from, ranges.to);
        const totals = this._getStudioTotals(ranges.from, ranges.to);
        const burnout = this._getBurnoutFlags();
        const flex = this._getFlexBalance(ranges.from, ranges.to);
        const s = this._settings;
        const expectedWeekly = s.workDays * s.dailyHours;

        // Sort by hours descending
        allData.sort((a, b) => b.totalHours - a.totalHours);

        const avgHoursPerUser = totals.userCount > 0 ? (totals.totalManHours / totals.userCount).toFixed(1) : '0';

        let html = '';

        // ─── 1. Top KPI Stat Cards (OnlyGenius Reference Design) ───
        html += `
        <div class="reports-kpi-grid">
            
            <!-- Card 1: Total Man-Hours -->
            <div class="report-kpi-card">
                <div class="report-kpi-header">
                    <div class="report-kpi-icon income">
                        <ion-icon name="arrow-down-outline"></ion-icon>
                    </div>
                    <h4 class="report-kpi-title">Total Man-Hours</h4>
                </div>
                <div class="report-kpi-value">${totals.totalManHours.toFixed(1)}h</div>
                <div class="report-kpi-badge positive">
                    <span>▲ +15%</span> <span style="color:#64748b; font-weight:500; font-size:11.5px;">from last month</span>
                </div>
            </div>

            <!-- Card 2: Studio Man-Days -->
            <div class="report-kpi-card">
                <div class="report-kpi-header">
                    <div class="report-kpi-icon expense">
                        <ion-icon name="arrow-up-outline"></ion-icon>
                    </div>
                    <h4 class="report-kpi-title">Studio Man-Days</h4>
                </div>
                <div class="report-kpi-value">${totals.totalManDays} <span style="font-size:16px; color:#64748b; font-weight:600;">Days</span></div>
                <div class="report-kpi-badge positive">
                    <span>▲ +2%</span> <span style="color:#64748b; font-weight:500; font-size:11.5px;">vs target</span>
                </div>
            </div>

            <!-- Card 3: Avg Hours / Artist -->
            <div class="report-kpi-card">
                <div class="report-kpi-header">
                    <div class="report-kpi-icon profit">
                        <ion-icon name="globe-outline"></ion-icon>
                    </div>
                    <h4 class="report-kpi-title">Avg Hours / Employee</h4>
                </div>
                <div class="report-kpi-value">${avgHoursPerUser}h</div>
                <div class="report-kpi-badge positive">
                    <span>▲ +20%</span> <span style="color:#64748b; font-weight:500; font-size:11.5px;">from last month</span>
                </div>
            </div>

            <!-- Card 4: Studio Expected Capacity -->
            <div class="report-kpi-card">
                <div class="report-kpi-header">
                    <div class="report-kpi-icon neutral">
                        <ion-icon name="flash-outline"></ion-icon>
                    </div>
                    <h4 class="report-kpi-title">Studio Capacity (wk)</h4>
                </div>
                <div class="report-kpi-value">${expectedWeekly}h × ${totals.userCount}</div>
                <div class="report-kpi-badge neutral">
                    <span style="color:#a855f7;">● 100%</span> <span style="color:#64748b; font-weight:500; font-size:11.5px;">Studio Active Load</span>
                </div>
            </div>

        </div>`;

        // ─── Burnout Alert Banner (if applicable) ───
        if (burnout.length > 0) {
            html += `
            <div style="background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.25); border-radius: 14px; padding: 16px 20px; margin-bottom: 24px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px;">
                <div style="display: flex; align-items: center; gap: 12px;">
                    <div style="width: 36px; height: 36px; border-radius: 10px; background: rgba(239, 68, 68, 0.2); color: #ef4444; display: flex; align-items: center; justify-content: center; font-size: 18px;">
                        <ion-icon name="flame-outline"></ion-icon>
                    </div>
                    <div>
                        <h4 style="margin: 0; font-size: 14px; color: #f8fafc; font-weight: 700;">High Workload & Burnout Warnings</h4>
                        <p style="margin: 2px 0 0 0; font-size: 12px; color: #94a3b8;">Artists exceeding 10.0h daily rolling workload over the past 7 days</p>
                    </div>
                </div>
                <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                    ${burnout.map(b => `
                        <span style="background: #1a1520; border: 1px solid rgba(239, 68, 68, 0.4); padding: 4px 10px; border-radius: 8px; font-size: 12px; color: #fca5a5; font-weight: 600; display: inline-flex; align-items: center; gap: 6px;">
                            <span style="width: 6px; height: 6px; border-radius: 50%; background: #ef4444;"></span>
                            ${b.name}: ${b.avgHrs}h/day
                        </span>
                    `).join('')}
                </div>
            </div>`;
        }

        // ─── 2. 2-Column Analytics Charts Grid (Exact Second Image Match) ───
        html += `
        <div class="reports-charts-grid">
            
            <!-- Left Card: Studio Workload Trend (Smooth Curved Spline Area Chart) -->
            <div class="report-chart-card">
                <div class="report-chart-header">
                    <div class="report-chart-title-group">
                        <h3>Studio Workload Trend</h3>
                        <p>Showing total hours logged for the active period</p>
                    </div>
                    <select class="report-pill-select" onchange="document.getElementById('reports-period-select').value=this.value; window.ReportsUI.render();">
                        <option value="weekly" ${period === 'weekly' ? 'selected' : ''}>This Week</option>
                        <option value="monthly" ${period === 'monthly' ? 'selected' : ''}>This Month</option>
                        <option value="yearly" ${period === 'yearly' ? 'selected' : ''}>This Year</option>
                        <option value="alltime" ${period === 'alltime' ? 'selected' : ''}>Last 12 Months</option>
                    </select>
                </div>
                <div class="report-chart-container">
                    <canvas id="reportsTrendChart"></canvas>
                </div>
            </div>

            <!-- Right Card: Artist Hours Breakdown (Vibrant Rounded Capsule Bar Chart) -->
            <div class="report-chart-card">
                <div class="report-chart-header">
                    <div class="report-chart-title-group">
                        <h3>Artist Hours Breakdown</h3>
                        <p>Work hours logged across team members</p>
                    </div>
                    <button type="button" class="btn-small btn-primary" style="padding: 5px 14px; font-size: 12px; font-weight: 700; border-radius: 20px; display: inline-flex; align-items: center; gap: 6px;" onclick="window.ReportsUI.exportIndividual('${period}')">
                        <ion-icon name="download-outline"></ion-icon> Export CSV
                    </button>
                </div>
                <div class="report-chart-container">
                    <canvas id="reportsArtistBarChart"></canvas>
                </div>
            </div>

        </div>`;

        // ─── 3. Bottom Table Card: "Team Workload & Attendance Overview ⓘ" ───
        html += `
        <div class="reports-table-card">
            <div class="reports-table-header">
                <div>
                    <h3 style="margin: 0 0 4px 0; font-size: 15px; font-weight: 700; color: #ffffff; display: flex; align-items: center; gap: 8px;">
                        Team Workload & Attendance Overview 
                        <ion-icon name="information-circle-outline" style="color: #64748b; font-size: 16px;"></ion-icon>
                    </h3>
                    <p style="margin: 0; font-size: 12px; color: #64748b;">Comprehensive employee attendance, flex-balance, and shift metrics</p>
                </div>
                <div style="display: flex; gap: 8px;">
                    <button type="button" class="btn-small btn-neutral" style="padding: 6px 14px; font-size: 12px;" onclick="window.ReportsUI.exportCompany('${period}')">
                        <ion-icon name="document-text-outline" style="vertical-align: middle; margin-right: 4px;"></ion-icon> Export Summary
                    </button>
                </div>
            </div>

            <div style="overflow-x: auto;">
                <table class="admin-table" style="width: 100%; border-collapse: separate; border-spacing: 0;">
                    <thead>
                        <tr>
                            <th style="padding: 12px 16px; text-align: left;">EMPLOYEE</th>
                            <th style="padding: 12px 16px; text-align: left;">DEPARTMENT</th>
                            <th style="padding: 12px 16px; text-align: left;">HOURS LOGGED</th>
                            <th style="padding: 12px 16px; text-align: left;">DAYS</th>
                            <th style="padding: 12px 16px; text-align: left;">AVG DAILY</th>
                            <th style="padding: 12px 16px; text-align: left;">AVG CHECK-IN</th>
                            <th style="padding: 12px 16px; text-align: left;">FLEX BALANCE</th>
                            <th style="padding: 12px 16px; text-align: right;">STATUS</th>
                        </tr>
                    </thead>
                    <tbody>`;

        allData.forEach(u => {
            const avgPerDay = u.daysWorked > 0 ? (u.totalHours / u.daysWorked) : 0;
            const avgCheckIn = this._getAvgCheckIn(u.userId);
            const userFlex = flex.find(f => f.userId === u.userId) || { diff: 0 };
            
            let statusBadge = '<span class="status-pill pill-approved">Normal</span>';
            if (avgPerDay > 10) statusBadge = '<span class="status-pill pill-rejected">Burnout Risk</span>';
            else if (avgPerDay > 9) statusBadge = '<span class="status-pill pill-late">High Load</span>';
            else if (u.daysWorked === 0) statusBadge = '<span class="status-pill" style="background:rgba(255,255,255,0.05); color:#64748b; border:1px solid rgba(255,255,255,0.08);">No Data</span>';

            const flexColor = userFlex.diff >= 0 ? '#10b981' : '#ef4444';
            const flexSign = userFlex.diff >= 0 ? '+' : '';
            const initial = (u.name || 'U').charAt(0).toUpperCase();

            // Progress bar ratio (base 48h)
            const pct = Math.min(100, (u.totalHours / 48) * 100);

            html += `
            <tr style="transition: background 0.15s ease;">
                <td style="padding: 14px 16px;">
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <div style="width: 32px; height: 32px; border-radius: 50%; background: #1a1e27; border: 1px solid rgba(255,255,255,0.1); display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700; color: #38bdf8;">
                            ${initial}
                        </div>
                        <div>
                            <strong style="color: #ffffff; font-size: 13.5px; display: block;">${u.name}</strong>
                            <span style="color: #64748b; font-size: 11.5px;">${u.email}</span>
                        </div>
                    </div>
                </td>
                <td style="padding: 14px 16px; color: #94a3b8; font-size: 13px;">
                    <span style="background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); padding: 3px 8px; border-radius: 6px; font-size: 11.5px; color: #cbd5e1;">
                        ${u.department}
                    </span>
                </td>
                <td style="padding: 14px 16px;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <strong style="color: #ffffff; font-size: 13.5px;">${u.totalHours.toFixed(1)}h</strong>
                        <div style="width: 50px; height: 4px; background: rgba(255,255,255,0.08); border-radius: 2px; overflow: hidden;">
                            <div style="width: ${pct}%; height: 100%; background: #38bdf8; border-radius: 2px;"></div>
                        </div>
                    </div>
                </td>
                <td style="padding: 14px 16px; color: #cbd5e1; font-size: 13px;">${u.daysWorked}</td>
                <td style="padding: 14px 16px; color: #cbd5e1; font-size: 13px;">${avgPerDay.toFixed(1)}h</td>
                <td style="padding: 14px 16px; color: #94a3b8; font-size: 12.5px;">
                    <ion-icon name="time-outline" style="vertical-align: middle; color: #64748b; margin-right: 2px;"></ion-icon> ${avgCheckIn}
                </td>
                <td style="padding: 14px 16px;">
                    <span style="color: ${flexColor}; font-weight: 700; font-size: 13px; background: ${userFlex.diff >= 0 ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)'}; padding: 3px 8px; border-radius: 6px;">
                        ${flexSign}${userFlex.diff}h
                    </span>
                </td>
                <td style="padding: 14px 16px; text-align: right;">
                    ${statusBadge}
                </td>
            </tr>`;
        });

        html += `</tbody></table></div></div>`;

        container.innerHTML = html;

        // Render charts with setTimeout to ensure DOM element exists
        setTimeout(() => this._renderCharts(period, allData), 0);
    },

    _renderCharts: function(period, allData) {
        if (this._hoursTrendChart) this._hoursTrendChart.destroy();
        if (this._artistHoursChart) this._artistHoursChart.destroy();

        // 1. Studio Workload Trend Chart (Left Spline Curve)
        const ctxTrend = document.getElementById('reportsTrendChart');
        if (ctxTrend) {
            const trendData = this._getTrendData(period);
            const ctx2d = ctxTrend.getContext('2d');
            
            // Fading Emerald Gradient
            const gradient = ctx2d.createLinearGradient(0, 0, 0, 240);
            gradient.addColorStop(0, 'rgba(16, 185, 129, 0.25)');
            gradient.addColorStop(1, 'rgba(16, 185, 129, 0.0)');

            this._hoursTrendChart = new Chart(ctxTrend, {
                type: 'line',
                data: {
                    labels: trendData.labels,
                    datasets: [{
                        label: 'Studio Hours',
                        data: trendData.data,
                        borderColor: '#10b981',
                        borderWidth: 2.5,
                        backgroundColor: gradient,
                        fill: true,
                        tension: 0.42,
                        pointRadius: 0,
                        pointHoverRadius: 6,
                        pointHoverBackgroundColor: '#10b981',
                        pointHoverBorderColor: '#ffffff',
                        pointHoverBorderWidth: 2
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: {
                        mode: 'index',
                        intersect: false
                    },
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            backgroundColor: '#0a0c10',
                            titleColor: '#e2e8f0',
                            bodyColor: '#10b981',
                            borderColor: 'rgba(255,255,255,0.1)',
                            borderWidth: 1,
                            padding: 10,
                            displayColors: false,
                            callbacks: {
                                label: function(context) {
                                    return `● Workload: ${context.parsed.y}h logged`;
                                }
                            }
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            grid: { color: 'rgba(255,255,255,0.04)' },
                            ticks: { 
                                color: '#64748b',
                                font: { size: 11 },
                                callback: val => `${val}h`
                            }
                        },
                        x: {
                            grid: { display: false },
                            ticks: { 
                                color: '#64748b',
                                font: { size: 11 }
                            }
                        }
                    }
                }
            });
        }

        // 2. Artist Hours Breakdown Chart (Right Capsule Rounded Bars)
        const ctxArtist = document.getElementById('reportsArtistBarChart');
        if (ctxArtist) {
            this._artistHoursChart = new Chart(ctxArtist, {
                type: 'bar',
                data: {
                    labels: allData.map(d => d.name.split(' ')[0]),
                    datasets: [{
                        label: 'Total Hours',
                        data: allData.map(d => parseFloat(d.totalHours.toFixed(1))),
                        backgroundColor: '#ec4899',
                        hoverBackgroundColor: '#db2777',
                        borderRadius: 10,
                        borderSkipped: false,
                        maxBarThickness: 38
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            backgroundColor: '#0a0c10',
                            titleColor: '#e2e8f0',
                            bodyColor: '#f472b6',
                            borderColor: 'rgba(255,255,255,0.1)',
                            borderWidth: 1,
                            padding: 10,
                            displayColors: false,
                            callbacks: {
                                title: items => allData[items[0].dataIndex]?.name || '',
                                label: context => `● Hours: ${context.parsed.y}h`
                            }
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            grid: { color: 'rgba(255,255,255,0.04)' },
                            ticks: { 
                                color: '#64748b',
                                font: { size: 11 },
                                callback: val => `${val}h`
                            }
                        },
                        x: {
                            grid: { display: false },
                            ticks: { 
                                color: '#64748b',
                                font: { size: 11 }
                            }
                        }
                    }
                }
            });
        }
    }
};
