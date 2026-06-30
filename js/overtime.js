// overtime.js — Overtime Report Module (Admin-only)
// Self-contained: fetches from /api/overtime, renders into #admin-tab-overtime

window.OvertimeUI = {

    _data: null,
    _sortField: 'date',
    _sortAsc: false,
    _selectedUsers: [],
    _allUsers: [],
    _dropdownOpen: false,
    _initialized: false,

    // ─── Initialization ───
    init: function() {
        if (!this._initialized) {
            this._setupDefaults();
            this._populateUsers();
            this._setupClickOutside();
            this._initialized = true;
        }
        // Always re-render in case data changed
        if (this._data) this._render();
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
        const triggerText = selectedCount === 0 ? 'All Employees' :
            selectedCount === 1 ? this._allUsers.find(u => u.id === this._selectedUsers[0])?.name || '1 selected' :
            `${selectedCount} employees selected`;

        container.innerHTML = `
            <div class="ot-ms-trigger" onclick="window.OvertimeUI._toggleDropdown(event)">
                <span class="ot-ms-text">${triggerText}</span>
                <ion-icon name="chevron-down-outline" class="ot-ms-arrow ${this._dropdownOpen ? 'open' : ''}"></ion-icon>
            </div>
            <div class="ot-ms-dropdown ${this._dropdownOpen ? 'open' : ''}">
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
        e.stopPropagation();
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
        if (btn) { btn.disabled = true; btn.innerHTML = '<ion-icon name="hourglass-outline"></ion-icon> Loading...'; }

        try {
            let url = `/api/overtime?from=${from}&to=${to}`;
            if (this._selectedUsers.length > 0) {
                url += `&userIds=${this._selectedUsers.join(',')}`;
            }
            const resp = await fetch(url);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            this._data = await resp.json();
            this._render();
        } catch (err) {
            console.error('Overtime fetch error:', err);
            alert('Failed to fetch overtime report. Please try again.');
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = '<ion-icon name="search-outline"></ion-icon> Generate'; }
        }
    },

    // ─── Render ───
    _render: function() {
        if (!this._data) return;
        this._renderStats();
        this._renderTable();
    },

    _renderStats: function() {
        const s = this._data.summary;
        const statsEl = document.getElementById('overtime-stats');
        if (!statsEl) return;

        statsEl.innerHTML = `
            <div class="stat-card">
                <h3>Total Overtime</h3>
                <div class="stat-value" style="color: var(--primary);">${s.totalOvertimeFormatted}</div>
            </div>
            <div class="stat-card">
                <h3>Employees with OT</h3>
                <div class="stat-value" style="color: var(--success);">${s.userCount}</div>
            </div>
            <div class="stat-card">
                <h3>OT Sessions</h3>
                <div class="stat-value" style="color: var(--warning);">${s.recordCount}</div>
            </div>
            <div class="stat-card">
                <h3>Avg OT / Session</h3>
                <div class="stat-value" style="color: #f472b6;">${s.recordCount > 0 ? Math.floor(s.totalOvertimeMinutes / s.recordCount) + 'm' : '0m'}</div>
            </div>
        `;
    },

    _renderTable: function() {
        const tbody = document.getElementById('overtime-tbody');
        const emptyEl = document.getElementById('overtime-empty');
        const tableEl = document.getElementById('overtime-table');
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
            const dayName = dateObj.toLocaleDateString('en-IN', { weekday: 'short' });
            return `<tr>
                <td><strong>${r.userName}</strong></td>
                <td>${r.date} <span style="color:var(--text-muted);font-size:12px;">(${dayName})</span></td>
                <td>${r.checkIn}</td>
                <td>${r.checkOut}</td>
                <td>${r.totalHoursWorked}h</td>
                <td style="color:var(--warning);">${r.overtimeStart}</td>
                <td style="color:var(--danger);">${r.overtimeEnd}</td>
                <td><span class="ot-badge ${badge.cls}">${r.overtimeFormatted}</span></td>
            </tr>`;
        }).join('');
    },

    _getOTBadge: function(minutes) {
        if (minutes >= 240) return { cls: 'ot-badge-high' };    // 4h+
        if (minutes >= 120) return { cls: 'ot-badge-medium' };  // 2-4h
        return { cls: 'ot-badge-low' };                          // <2h
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

        const headers = ['Employee', 'Date', 'Check In', 'Check Out', 'Total Hours', 'OT Start', 'OT End', 'Overtime'];
        const rows = this._data.records.map(r => [
            r.userName, r.date, r.checkIn, r.checkOut,
            r.totalHoursWorked + 'h', r.overtimeStart, r.overtimeEnd, r.overtimeFormatted
        ]);

        // Add summary rows
        rows.push([]);
        rows.push(['--- Summary ---']);
        rows.push(['Total Overtime', this._data.summary.totalOvertimeFormatted]);
        rows.push(['Employees with OT', this._data.summary.userCount]);
        rows.push(['Total OT Sessions', this._data.summary.recordCount]);
        rows.push([]);
        rows.push(['--- Per Employee ---']);
        rows.push(['Employee', 'Total Overtime', 'Days with OT']);
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
        a.download = `overtime_report_${from}_to_${to}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
};
