// reports.js — Reports & Analytics Module (Admin-only)
// Self-contained: reads from Store, renders into #admin-tab-reports

window.ReportsUI = {

    _hoursChart: null,
    _flexChart: null,

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
        // Persist to backend
        fetch('/api/settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(this._settings)
        }).catch(err => console.error('Settings save error:', err));
    },

    // ─── Utility: Parse check-in/out times to minutes since midnight ───
    _parseTimeToMinutes: function(timeStr) {
        if (!timeStr || timeStr === '--:--') return null;
        // Handle formats: "10:30 AM", "14:30", "10:30 am", "20:00 (Auto)"
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
            return { userId: u.id, name: u.name, totalHours, daysWorked, records };
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
        // Format as 12-hour
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
        // Count working days in range (excluding Sundays by default for 6-day)
        const from = new Date(fromDate);
        const to = new Date(toDate);
        let totalWorkingDays = 0;
        const d = new Date(from);
        while (d <= to) {
            const dow = d.getDay(); // 0=Sun, 6=Sat
            if (s.workDays === 5) {
                if (dow !== 0 && dow !== 6) totalWorkingDays++;
            } else if (s.workDays === 6) {
                if (dow !== 0) totalWorkingDays++;
            } else {
                totalWorkingDays++; // 7-day
            }
            d.setDate(d.getDate() + 1);
        }

        const expectedHoursPerPerson = totalWorkingDays * s.dailyHours;
        return users.map(u => {
            const actual = this._getUserHours(u.id, fromDate, toDate);
            const diff = actual - expectedHoursPerPerson;
            return { userId: u.id, name: u.name, expected: expectedHoursPerPerson, actual: Math.round(actual * 10) / 10, diff: Math.round(diff * 10) / 10 };
        });
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
        const headers = ['Employee', 'Total Hours', 'Days Worked', 'Avg Hours/Day'];
        const rows = data.map(u => [
            u.name,
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
        this._downloadCSV(`company_hours_${period}.csv`, headers, rows);
    },

    _getRange: function(period) {
        const to = this._today();
        let from;
        switch(period) {
            case 'weekly': from = this._startOfWeek(); break;
            case 'monthly': from = this._startOfMonth(); break;
            case 'yearly': from = this._startOfYear(); break;
            default: from = '2020-01-01'; break; // all-time
        }
        return { from, to };
    },

    // ─── Settings Modal ───
    openSettings: function() {
        document.getElementById('setting-work-days').value = this._settings.workDays;
        document.getElementById('setting-daily-hours').value = this._settings.dailyHours;
        document.getElementById('studio-settings-modal').classList.remove('hidden');
    },

    saveSettings: function() {
        this._settings.workDays = parseInt(document.getElementById('setting-work-days').value, 10) || 6;
        this._settings.dailyHours = parseInt(document.getElementById('setting-daily-hours').value, 10) || 8;
        this._saveSettings();
        document.getElementById('studio-settings-modal').classList.add('hidden');
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

        let html = '';

        // ─── Studio Summary Cards ───
        html += `
        <div class="stats-grid" style="grid-template-columns: repeat(4, 1fr); margin-bottom: 24px;">
            <div class="stat-card">
                <h3>Total Man-Hours</h3>
                <div class="stat-value" style="color:#3b82f6;">${totals.totalManHours.toFixed(1)}h</div>
            </div>
            <div class="stat-card">
                <h3>Total Man-Days</h3>
                <div class="stat-value" style="color:#10b981;">${totals.totalManDays}</div>
            </div>
            <div class="stat-card">
                <h3>Avg Hours / Employee</h3>
                <div class="stat-value" style="color:#8b5cf6;">${totals.userCount > 0 ? (totals.totalManHours / totals.userCount).toFixed(1) : '0'}h</div>
            </div>
            <div class="stat-card">
                <h3>Studio Expected (wk)</h3>
                <div class="stat-value" style="color:#f59e0b;">${expectedWeekly}h × ${totals.userCount}</div>
            </div>
        </div>`;

        // ─── Burnout Alerts ───
        if (burnout.length > 0) {
            html += `<div class="glass-panel" style="margin-bottom: 24px; border-left: 4px solid #ef4444;">
                <h3 class="section-subtitle" style="color:#ef4444;">⚠️ Burnout Alerts <small style="color:var(--text-muted); font-weight:400;">(7-day rolling avg &gt; 10h/day)</small></h3>
                <div style="display:flex; gap:12px; flex-wrap:wrap;">`;
            burnout.forEach(b => {
                html += `<div style="background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.3); border-radius:10px; padding:12px 16px; min-width:180px;">
                    <div style="font-weight:600; margin-bottom:4px;">${b.name}</div>
                    <div style="font-size:13px; color:var(--text-muted);">${b.avgHrs}h avg/day • ${b.daysWorked} days • ${b.totalHrs}h total</div>
                </div>`;
            });
            html += `</div></div>`;
        }

        // ─── Individual Hours Table ───
        html += `
        <div class="glass-panel" style="margin-bottom: 24px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
                <h3 class="section-subtitle" style="margin:0;">📊 Individual Work Hours</h3>
                <div style="display:flex; gap:8px;">
                    <button class="btn-small btn-primary" style="width:auto; padding:4px 12px; margin:0;" onclick="window.ReportsUI.exportIndividual('${period}')">Export CSV</button>
                </div>
            </div>
            <div style="position: relative; width: 100%; height: 250px; margin-bottom: 20px;">
                <canvas id="reportsHoursChart"></canvas>
            </div>
            <div style="overflow-x:auto; max-height:400px; overflow-y:auto;">
                <table class="admin-table">
                    <thead><tr>
                        <th>Employee</th>
                        <th>Hours Worked</th>
                        <th>Days Worked</th>
                        <th>Avg Hours/Day</th>
                        <th>Avg Check-In</th>
                        <th>Status</th>
                    </tr></thead>
                    <tbody>`;

        allData.forEach(u => {
            const avgPerDay = u.daysWorked > 0 ? (u.totalHours / u.daysWorked) : 0;
            const avgCheckIn = this._getAvgCheckIn(u.userId);
            let statusBadge = '<span class="badge approved">Normal</span>';
            if (avgPerDay > 10) statusBadge = '<span class="badge rejected">Burnout Risk</span>';
            else if (avgPerDay > 9) statusBadge = '<span class="badge pending">High Load</span>';
            else if (u.daysWorked === 0) statusBadge = '<span class="badge" style="background:#475569;color:white;">No Data</span>';

            html += `<tr>
                <td style="font-weight:500;">${u.name}</td>
                <td>${u.totalHours.toFixed(1)}h</td>
                <td>${u.daysWorked}</td>
                <td>${avgPerDay.toFixed(1)}h</td>
                <td>${avgCheckIn}</td>
                <td>${statusBadge}</td>
            </tr>`;
        });

        html += `</tbody></table></div></div>`;

        // ─── Flex-Time Balance Table ───
        html += `
        <div class="glass-panel" style="margin-bottom: 24px;">
            <h3 class="section-subtitle">⚖️ Flex-Time Balance <small style="color:var(--text-muted); font-weight:400;">(${s.workDays} days/wk × ${s.dailyHours}h/day)</small></h3>
            <div style="position: relative; width: 100%; height: 250px; margin-bottom: 20px;">
                <canvas id="reportsFlexChart"></canvas>
            </div>
            <div style="overflow-x:auto; max-height:400px; overflow-y:auto;">
                <table class="admin-table">
                    <thead><tr>
                        <th>Employee</th>
                        <th>Expected Hours</th>
                        <th>Actual Hours</th>
                        <th>Balance</th>
                    </tr></thead>
                    <tbody>`;

        flex.sort((a, b) => a.diff - b.diff);
        flex.forEach(f => {
            const color = f.diff >= 0 ? '#10b981' : '#ef4444';
            const sign = f.diff >= 0 ? '+' : '';
            html += `<tr>
                <td style="font-weight:500;">${f.name}</td>
                <td>${f.expected}h</td>
                <td>${f.actual}h</td>
                <td style="color:${color}; font-weight:600;">${sign}${f.diff}h</td>
            </tr>`;
        });

        html += `</tbody></table></div></div>`;

        // ─── Company Export ───
        html += `
        <div class="glass-panel">
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <h3 class="section-subtitle" style="margin:0;">📥 Company Export</h3>
                <div style="display:flex; gap:8px; flex-wrap:wrap;">
                    <button class="btn-small btn-neutral" style="width:auto; padding:6px 14px; margin:0;" onclick="window.ReportsUI.exportCompany('weekly')">Weekly</button>
                    <button class="btn-small btn-neutral" style="width:auto; padding:6px 14px; margin:0;" onclick="window.ReportsUI.exportCompany('monthly')">Monthly</button>
                    <button class="btn-small btn-neutral" style="width:auto; padding:6px 14px; margin:0;" onclick="window.ReportsUI.exportCompany('yearly')">Yearly</button>
                    <button class="btn-small btn-primary" style="width:auto; padding:6px 14px; margin:0;" onclick="window.ReportsUI.exportCompany('alltime')">All Time</button>
                </div>
            </div>
        </div>`;

        container.innerHTML = html;

        // Give DOM time to insert HTML before mounting charts
        setTimeout(() => this._renderCharts(allData, flex), 0);
    },

    _renderCharts: function(allData, flex) {
        if (this._hoursChart) this._hoursChart.destroy();
        if (this._flexChart) this._flexChart.destroy();

        // 1. Individual Hours Chart
        const ctxHours = document.getElementById('reportsHoursChart');
        if (ctxHours) {
            this._hoursChart = new Chart(ctxHours, {
                type: 'bar',
                data: {
                    labels: allData.map(d => d.name),
                    datasets: [{
                        label: 'Total Hours',
                        data: allData.map(d => parseFloat(d.totalHours.toFixed(1))),
                        backgroundColor: '#3b82f6',
                        borderRadius: 4
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: {
                        y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } },
                        x: { grid: { display: false }, ticks: { color: '#94a3b8' } }
                    }
                }
            });
        }

        // 2. Flex-Time Balance Chart
        const ctxFlex = document.getElementById('reportsFlexChart');
        if (ctxFlex) {
            const data = flex.map(f => f.diff);
            const bgColors = data.map(val => val >= 0 ? '#10b981' : '#ef4444');
            this._flexChart = new Chart(ctxFlex, {
                type: 'bar',
                data: {
                    labels: flex.map(f => f.name),
                    datasets: [{
                        label: 'Flex-Time Balance',
                        data: data,
                        backgroundColor: bgColors,
                        borderRadius: 4
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: {
                        y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } },
                        x: { grid: { display: false }, ticks: { color: '#94a3b8' } }
                    }
                }
            });
        }
    }
};
