// overtime.js — Overtime Report Module (Admin-only)
// Complete OnlyGenius Dark SaaS Architecture with Analytics Charts

window.OvertimeUI = {

    _data: null,
    _sortField: 'date',
    _sortAsc: false,
    _selectedUsers: [],
    _allUsers: [],
    _dropdownOpen: false,
    _initialized: false,
    _artistChart: null,
    _trendChart: null,

    // ─── Initialization ───
    init: function() {
        if (!this._initialized) {
            this._setupDefaults();
            this._populateUsers();
            this._setupClickOutside();
            this._initialized = true;
            // Auto fetch current month report on initial load
            this.fetchReport();
        } else if (this._data) {
            this._render();
        }
    },

    _setupDefaults: function() {
        const now = new Date();
        const startDate = document.getElementById('overtime-start-date');
        const endDate = document.getElementById('overtime-end-date');
        if (startDate) {
            startDate.value = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
        }
        if (endDate) {
            const y = now.getFullYear(), m = now.getMonth()+1, d = now.getDate();
            endDate.value = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        }
    },

    setPreset: function(preset) {
        const now = new Date();
        const startEl = document.getElementById('overtime-start-date');
        const endEl = document.getElementById('overtime-end-date');
        if (!startEl || !endEl) return;

        const _fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

        if (preset === 'this_month') {
            startEl.value = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
            endEl.value = _fmt(now);
        } else if (preset === 'last_month') {
            const firstOfLast = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            const lastOfLast = new Date(now.getFullYear(), now.getMonth(), 0);
            startEl.value = _fmt(firstOfLast);
            endEl.value = _fmt(lastOfLast);
        } else if (preset === 'last_30') {
            const d30 = new Date(now.getTime() - 30 * 86400000);
            startEl.value = _fmt(d30);
            endEl.value = _fmt(now);
        }

        this.fetchReport();
    },

    _populateUsers: function() {
        const users = (typeof Store !== 'undefined' && Store.getUsers) ? Store.getUsers() : [];
        this._allUsers = users.filter(u => u.is_active !== false);
        this._selectedUsers = []; // empty = all users
        this._renderMultiSelect();
    },

    // ─── Multi-Select Dropdown ───
    _renderMultiSelect: function() {
        const container = document.getElementById('overtime-user-select');
        if (!container) return;

        const selectedCount = this._selectedUsers.length;
        const triggerText = selectedCount === 0 ? 'All Employees (Everyone)' :
            selectedCount === 1 ? this._allUsers.find(u => u.id === this._selectedUsers[0])?.name || '1 selected' :
            `${selectedCount} employees selected`;

        container.innerHTML = `
            <div class="ot-ms-trigger" onclick="window.OvertimeUI._toggleDropdown(event)">
                <span class="ot-ms-text">${triggerText}</span>
                <ion-icon name="chevron-down-outline" class="ot-ms-arrow ${this._dropdownOpen ? 'open' : ''}"></ion-icon>
            </div>
            <div class="ot-ms-dropdown ${this._dropdownOpen ? 'open' : ''}" onclick="event.stopPropagation()">
                <div class="ot-ms-search">
                    <input type="text" placeholder="Search employees..." oninput="window.OvertimeUI._filterUsers(this.value)" id="ot-user-search">
                </div>
                <div class="ot-ms-option ot-ms-select-all" onclick="window.OvertimeUI._toggleSelectAll()">
                    <input type="checkbox" ${selectedCount === 0 ? 'checked' : ''} readonly>
                    <span>All Employees</span>
                </div>
                <div class="ot-ms-options" id="ot-ms-options-list">
                    ${this._allUsers.map(u => `
                        <div class="ot-ms-option" onclick="window.OvertimeUI._toggleUser('${u.id}')" data-name="${u.name.toLowerCase()}">
                            <input type="checkbox" ${this._selectedUsers.includes(u.id) ? 'checked' : ''} readonly>
                            <span>${u.name}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    },

    _toggleDropdown: function(e) {
        if (e) e.stopPropagation();
        this._dropdownOpen = !this._dropdownOpen;
        this._renderMultiSelect();
        if (this._dropdownOpen) {
            setTimeout(() => {
                const search = document.getElementById('ot-user-search');
                if (search) search.focus();
            }, 50);
        }
    },

    _setupClickOutside: function() {
        document.addEventListener('click', (e) => {
            const container = document.getElementById('overtime-user-select');
            if (container && !container.contains(e.target) && this._dropdownOpen) {
                this._dropdownOpen = false;
                this._renderMultiSelect();
            }
        });
    },

    _toggleSelectAll: function() {
        this._selectedUsers = []; // empty = all
        this._renderMultiSelect();
    },

    _toggleUser: function(userId) {
        const idx = this._selectedUsers.indexOf(userId);
        if (idx >= 0) {
            this._selectedUsers.splice(idx, 1);
        } else {
            this._selectedUsers.push(userId);
        }
        this._renderMultiSelect();
    },

    _filterUsers: function(query) {
        const q = query.toLowerCase();
        const options = document.querySelectorAll('#ot-ms-options-list .ot-ms-option');
        options.forEach(opt => {
            const name = opt.getAttribute('data-name') || '';
            opt.style.display = name.includes(q) ? '' : 'none';
        });
    },

    // ─── Fetch Report ───
    fetchReport: async function() {
        const from = document.getElementById('overtime-start-date')?.value;
        const to = document.getElementById('overtime-end-date')?.value;
        if (!from || !to) {
            alert('Please select both start and end dates.');
            return;
        }

        const btn = document.querySelector('#admin-tab-overtime .btn-primary');
        if (btn) { btn.disabled = true; btn.innerHTML = '<ion-icon name="hourglass-outline"></ion-icon> Computing...'; }

        try {
            let url = `/api/overtime?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
            if (this._selectedUsers.length > 0) {
                url += `&userIds=${encodeURIComponent(this._selectedUsers.join(','))}`;
            }
            const resp = await fetch(url);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            this._data = await resp.json();
            this._render();
        } catch (err) {
            console.error('Overtime fetch error:', err);
            // Fallback calculation from local Store if server API is unreachable
            this._computeFallback(from, to);
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = '<ion-icon name="flash-outline"></ion-icon> Generate'; }
        }
    },

    _computeFallback: function(from, to) {
        const users = (typeof Store !== 'undefined' && Store.getUsers) ? Store.getUsers() : [];
        const attendance = (typeof Store !== 'undefined' && Store.getAttendance) ? Store.getAttendance() : [];

        const parseTimeMinutes = (tStr) => {
            if (!tStr) return null;
            const m = tStr.match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/i);
            if (!m) return null;
            let h = parseInt(m[1], 10);
            const mins = parseInt(m[2], 10);
            const ampm = m[3]?.toLowerCase();
            if (ampm === 'pm' && h < 12) h += 12;
            if (ampm === 'am' && h === 12) h = 0;
            return h * 60 + mins;
        };

        const formatMinsToTime = (totalM) => {
            let h = Math.floor(totalM / 60);
            const m = totalM % 60;
            const ampm = h >= 12 ? 'PM' : 'AM';
            const h12 = h > 12 ? h - 12 : (h === 0 ? 12 : h);
            return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${ampm}`;
        };

        const records = [];
        const userOtMap = {};

        attendance.forEach(a => {
            if (a.date < from || a.date > to) return;
            if (this._selectedUsers.length > 0 && !this._selectedUsers.includes(a.userId)) return;
            if (!a.checkInTime || !a.checkOutTime) return;

            const inM = parseTimeMinutes(a.checkInTime);
            const outM = parseTimeMinutes(a.checkOutTime);
            if (inM === null || outM === null || outM <= inM) return;

            const totalWorkedMins = outM - inM;
            const standardShiftMins = 8 * 60;

            if (totalWorkedMins > standardShiftMins) {
                const otMins = totalWorkedMins - standardShiftMins;
                const otStartM = inM + standardShiftMins;
                const user = users.find(u => u.id === a.userId) || { name: a.userId };

                const rec = {
                    userId: a.userId,
                    userName: user.name,
                    date: a.date,
                    checkIn: a.checkInTime,
                    checkOut: a.checkOutTime,
                    totalHoursWorked: (totalWorkedMins / 60).toFixed(1),
                    overtimeStart: formatMinsToTime(otStartM),
                    overtimeEnd: a.checkOutTime,
                    overtimeMinutes: otMins,
                    overtimeFormatted: `${Math.floor(otMins / 60)}h ${otMins % 60}m`
                };
                records.push(rec);

                if (!userOtMap[a.userId]) {
                    userOtMap[a.userId] = { userId: a.userId, userName: user.name, totalMinutes: 0, daysWithOvertime: 0 };
                }
                userOtMap[a.userId].totalMinutes += otMins;
                userOtMap[a.userId].daysWithOvertime += 1;
            }
        });

        const perUser = Object.values(userOtMap).map(u => ({
            ...u,
            totalFormatted: `${Math.floor(u.totalMinutes / 60)}h ${u.totalMinutes % 60}m`
        }));

        const totalOtMinutes = records.reduce((sum, r) => sum + r.overtimeMinutes, 0);

        this._data = {
            summary: {
                totalOvertimeFormatted: `${Math.floor(totalOtMinutes / 60)}h ${totalOtMinutes % 60}m`,
                totalOvertimeMinutes: totalOtMinutes,
                userCount: perUser.length,
                recordCount: records.length,
                perUser
            },
            records
        };
        this._render();
    },

    // ─── Render Pipeline ───
    _render: function() {
        if (!this._data) return;
        this._renderStats();
        this._renderCharts();
        this._renderTable();
    },

    _renderStats: function() {
        const s = this._data.summary;
        const statsEl = document.getElementById('overtime-stats');
        if (!statsEl) return;

        const avgMins = s.recordCount > 0 ? Math.floor(s.totalOvertimeMinutes / s.recordCount) : 0;
        const avgH = Math.floor(avgMins / 60);
        const avgM = avgMins % 60;
        const avgFormatted = avgH > 0 ? `${avgH}h ${avgM}m` : `${avgM}m`;

        statsEl.innerHTML = `
            <div class="report-kpi-card">
                <div class="report-kpi-header">
                    <div class="report-kpi-icon neutral">
                        <ion-icon name="moon-outline"></ion-icon>
                    </div>
                    <h4 class="report-kpi-title">Total Overtime Logged</h4>
                </div>
                <div class="report-kpi-value" style="color:#a855f7; font-size:24px;">${s.totalOvertimeFormatted}</div>
                <div class="report-kpi-badge positive">
                    <span>▲ Across Studio Shifts</span>
                </div>
            </div>

            <div class="report-kpi-card">
                <div class="report-kpi-header">
                    <div class="report-kpi-icon profit">
                        <ion-icon name="people-outline"></ion-icon>
                    </div>
                    <h4 class="report-kpi-title">Artists with Overtime</h4>
                </div>
                <div class="report-kpi-value">${s.userCount} <span style="font-size:16px; color:#64748b; font-weight:600;">Artists</span></div>
                <div class="report-kpi-badge positive">
                    <span>● Active Contributors</span>
                </div>
            </div>

            <div class="report-kpi-card">
                <div class="report-kpi-header">
                    <div class="report-kpi-icon income">
                        <ion-icon name="checkmark-done-circle-outline"></ion-icon>
                    </div>
                    <h4 class="report-kpi-title">Total OT Sessions</h4>
                </div>
                <div class="report-kpi-value">${s.recordCount} <span style="font-size:16px; color:#64748b; font-weight:600;">Sessions</span></div>
                <div class="report-kpi-badge positive">
                    <span>● Verified Shift Logs</span>
                </div>
            </div>

            <div class="report-kpi-card">
                <div class="report-kpi-header">
                    <div class="report-kpi-icon expense">
                        <ion-icon name="hourglass-outline"></ion-icon>
                    </div>
                    <h4 class="report-kpi-title">Avg Overtime / Shift</h4>
                </div>
                <div class="report-kpi-value" style="font-size:24px;">${avgFormatted}</div>
                <div class="report-kpi-badge neutral">
                    <span style="color:#94a3b8;">● Extended Shift Mean</span>
                </div>
            </div>
        `;
    },

    _renderCharts: function() {
        const chartsContainer = document.getElementById('overtime-charts-container');
        if (!chartsContainer) return;

        if (this._data.records.length === 0) {
            chartsContainer.style.display = 'none';
            return;
        }
        chartsContainer.style.display = 'grid';

        // 1. Overtime by Artist (Capsule Bars)
        const artistCtx = document.getElementById('overtimeArtistChart');
        if (artistCtx) {
            if (this._artistChart) this._artistChart.destroy();

            const perUserSorted = [...(this._data.summary.perUser || [])]
                .sort((a, b) => b.totalMinutes - a.totalMinutes)
                .slice(0, 8); // Top 8 artists

            const labels = perUserSorted.map(u => u.userName);
            const dataHours = perUserSorted.map(u => Math.round((u.totalMinutes / 60) * 10) / 10);

            this._artistChart = new Chart(artistCtx, {
                type: 'bar',
                data: {
                    labels,
                    datasets: [{
                        label: 'Overtime Hours',
                        data: dataHours,
                        backgroundColor: '#f59e0b',
                        hoverBackgroundColor: '#d97706',
                        borderRadius: 10,
                        borderSkipped: false,
                        maxBarThickness: 34
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            backgroundColor: '#0a0c10',
                            titleColor: '#ffffff',
                            bodyColor: '#fbbf24',
                            borderColor: 'rgba(255,255,255,0.1)',
                            borderWidth: 1,
                            padding: 10,
                            callbacks: {
                                label: ctx => `⚡ Overtime: ${ctx.parsed.y}h logged`
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
                                callback: val => val + 'h'
                            }
                        },
                        x: {
                            grid: { display: false },
                            ticks: { color: '#64748b', font: { size: 11 } }
                        }
                    }
                }
            });
        }

        // 2. Daily Overtime Trajectory (Spline Curve)
        const trendCtx = document.getElementById('overtimeTrendChart');
        if (trendCtx) {
            if (this._trendChart) this._trendChart.destroy();

            // Group OT minutes by date
            const dateMap = {};
            this._data.records.forEach(r => {
                dateMap[r.date] = (dateMap[r.date] || 0) + (r.overtimeMinutes || 0);
            });

            const sortedDates = Object.keys(dateMap).sort();
            const dateLabels = sortedDates.map(dStr => {
                const dObj = new Date(dStr + 'T00:00:00');
                return isNaN(dObj.getTime()) ? dStr : dObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            });
            const otHoursData = sortedDates.map(dStr => Math.round((dateMap[dStr] / 60) * 10) / 10);

            const ctx2d = trendCtx.getContext('2d');
            const gradient = ctx2d.createLinearGradient(0, 0, 0, 240);
            gradient.addColorStop(0, 'rgba(168, 85, 247, 0.32)');
            gradient.addColorStop(1, 'rgba(168, 85, 247, 0.0)');

            this._trendChart = new Chart(trendCtx, {
                type: 'line',
                data: {
                    labels: dateLabels,
                    datasets: [{
                        label: 'Total Studio OT Hours',
                        data: otHoursData,
                        borderColor: '#a855f7',
                        borderWidth: 2.5,
                        backgroundColor: gradient,
                        fill: true,
                        tension: 0.4,
                        pointRadius: 3,
                        pointHoverRadius: 6,
                        pointBackgroundColor: '#a855f7',
                        pointBorderColor: '#ffffff',
                        pointBorderWidth: 2
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            backgroundColor: '#0a0c10',
                            titleColor: '#ffffff',
                            bodyColor: '#c084fc',
                            borderColor: 'rgba(255,255,255,0.1)',
                            borderWidth: 1,
                            padding: 10,
                            callbacks: {
                                label: ctx => `🌙 Studio Overtime: ${ctx.parsed.y}h logged`
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
                                callback: val => val + 'h'
                            }
                        },
                        x: {
                            grid: { display: false },
                            ticks: { color: '#64748b', font: { size: 11 } }
                        }
                    }
                }
            });
        }
    },

    _renderTable: function() {
        const tbody = document.getElementById('overtime-tbody');
        const emptyEl = document.getElementById('overtime-empty');
        const tableEl = document.getElementById('overtime-table');
        const countEl = document.getElementById('overtime-records-count');
        if (!tbody) return;

        let records = [...this._data.records];

        // Sort
        records.sort((a, b) => {
            let va = a[this._sortField];
            let vb = b[this._sortField];
            if (this._sortField === 'overtimeMinutes' || this._sortField === 'totalHoursWorked') {
                va = parseFloat(va) || 0;
                vb = parseFloat(vb) || 0;
            } else {
                va = String(va || '').toLowerCase();
                vb = String(vb || '').toLowerCase();
            }
            if (va < vb) return this._sortAsc ? -1 : 1;
            if (va > vb) return this._sortAsc ? 1 : -1;
            return 0;
        });

        if (countEl) countEl.textContent = `${records.length} extended shift sessions logged`;

        if (records.length === 0) {
            tbody.innerHTML = '';
            if (tableEl) tableEl.style.display = 'none';
            if (emptyEl) emptyEl.classList.remove('hidden');
            return;
        }

        if (tableEl) tableEl.style.display = '';
        if (emptyEl) emptyEl.classList.add('hidden');

        tbody.innerHTML = records.map(r => {
            const badge = this._getOTBadge(r.overtimeMinutes);
            const dateObj = new Date(r.date + 'T00:00:00');
            const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'short' });
            const initials = r.userName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();

            return `<tr>
                <td style="padding:14px 16px;">
                    <div style="display:flex; align-items:center; gap:10px;">
                        <div style="width:30px; height:30px; border-radius:50%; background:linear-gradient(135deg, #3b82f6, #8b5cf6); color:#fff; font-size:11px; font-weight:700; display:flex; align-items:center; justify-content:center;">
                            ${initials}
                        </div>
                        <div>
                            <div style="font-weight:700; color:#ffffff; font-size:13px;">${r.userName}</div>
                            <div style="font-size:11px; color:#64748b;">Artist ID: ${r.userId}</div>
                        </div>
                    </div>
                </td>
                <td style="padding:14px 16px; color:#ffffff; font-weight:600;">
                    ${r.date} <span style="color:#94a3b8; font-size:12px; font-weight:400;">(${dayName})</span>
                </td>
                <td style="padding:14px 16px; color:#cbd5e1;"><ion-icon name="time-outline" style="vertical-align:middle; color:#64748b; margin-right:4px;"></ion-icon>${r.checkIn}</td>
                <td style="padding:14px 16px; color:#cbd5e1;">${r.checkOut}</td>
                <td style="padding:14px 16px;">
                    <span style="color:#ffffff; font-weight:700;">${r.totalHoursWorked}h</span>
                </td>
                <td style="padding:14px 16px; color:#94a3b8; font-size:12px;">
                    <span style="color:#f59e0b;">${r.overtimeStart}</span> → <span style="color:#ef4444;">${r.overtimeEnd}</span>
                </td>
                <td style="padding:14px 16px;">
                    <span class="ot-badge ${badge.cls}">${badge.icon} +${r.overtimeFormatted}</span>
                </td>
                <td style="padding:14px 16px; text-align:right;">
                    <span class="status-pill pill-approved">Verified</span>
                </td>
            </tr>`;
        }).join('');
    },

    _getOTBadge: function(minutes) {
        if (minutes >= 180) return { cls: 'ot-badge-high', icon: '🔥' };    // 3h+
        if (minutes >= 60) return { cls: 'ot-badge-medium', icon: '⚡' };   // 1-3h
        return { cls: 'ot-badge-low', icon: '⏱️' };                          // <1h
    },

    // ─── Sorting ───
    sortBy: function(field) {
        if (this._sortField === field) {
            this._sortAsc = !this._sortAsc;
        } else {
            this._sortField = field;
            this._sortAsc = true;
        }

        // Update sort indicators in header
        document.querySelectorAll('#overtime-table th[data-sort]').forEach(th => {
            const icon = th.dataset.sort === field
                ? (this._sortAsc ? ' ▲' : ' ▼')
                : ' ↕';
            const label = th.textContent.replace(/[↕▲▼]/g, '').trim();
            th.textContent = label + icon;
            th.classList.toggle('sort-active', th.dataset.sort === field);
        });

        this._renderTable();
    },

    // ─── CSV Export ───
    exportCSV: function() {
        if (!this._data || !this._data.records.length) {
            alert('No data to export. Please generate a report first.');
            return;
        }

        const headers = ['Employee', 'Date', 'Check In', 'Check Out', 'Total Hours Worked', 'OT Window Start', 'OT Window End', 'Overtime Hours'];
        const rows = this._data.records.map(r => [
            r.userName, r.date, r.checkIn, r.checkOut,
            r.totalHoursWorked + 'h', r.overtimeStart, r.overtimeEnd, r.overtimeFormatted
        ]);

        // Add summary rows
        rows.push([]);
        rows.push(['--- Studio Overtime Summary ---']);
        rows.push(['Total Overtime Hours', this._data.summary.totalOvertimeFormatted]);
        rows.push(['Artists with Overtime', this._data.summary.userCount]);
        rows.push(['Total Overtime Sessions', this._data.summary.recordCount]);
        rows.push([]);
        rows.push(['--- Per Artist Breakdown ---']);
        rows.push(['Artist Name', 'Total Overtime Hours', 'Days with Overtime']);
        this._data.summary.perUser.forEach(u => {
            rows.push([u.userName, u.totalFormatted, u.daysWithOvertime]);
        });

        const csv = [headers.join(','), ...rows.map(r => r.map(c => `"${c}"`).join(','))].join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const from = document.getElementById('overtime-start-date')?.value || 'report';
        const to = document.getElementById('overtime-end-date')?.value || '';
        a.download = `studio_overtime_report_${from}_to_${to}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
};
