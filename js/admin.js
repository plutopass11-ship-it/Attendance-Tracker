// admin.js
window.AdminUI = {
    currentUser: null,
    currentCalDate: new Date(),
    kitsuPersons: [],
    attendanceChartInstance: null,
    wfhMonthlyChartInstance: null,
    leaveVsWfhChartInstance: null,

    _isWfh: function(type) {
        return type?.toLowerCase().includes('wfh') || type?.toLowerCase().includes('work from home');
    },
    _calcDays: function(leave) {
        if (leave.isHalfDay) return 0.5;
        const s = new Date(leave.startDate), e = new Date(leave.endDate);
        return Math.max(1, Math.ceil(Math.abs(e - s) / (1000*60*60*24)) + 1);
    },
    
    init: async function(user) {
        try {
            Store.autoCheckoutMissing();
            
            this.currentUser = user;
            
            document.getElementById('admin-greeting').textContent = 'Hello, ' + user.name;
            this.setupEventListeners();

            // Sync with backend DB first, then render
            await Store.syncWithBackend();
            this.renderDashboard(); // initial render with cached data
            this.syncKitsuUsers();  // async: updates kitsuPersons and re-renders when ready
        } catch(e) {
            document.getElementById('admin-greeting').textContent = "CRASH: " + e.message;
            console.error(e);
        }
    },
    
    setupEventListeners: function() {
        // Nav switching
        const adminNavs = document.querySelectorAll('.admin-nav-item');
        adminNavs.forEach(nav => {
            nav.addEventListener('click', (e) => {
                const target = e.currentTarget.dataset.target;
                
                // Update nav class
                adminNavs.forEach(n => n.classList.remove('active'));
                e.currentTarget.classList.add('active');
                
                // Hide all tabs
                document.querySelectorAll('.admin-tab').forEach(t => t.classList.add('hidden'));
                document.getElementById(target).classList.remove('hidden');
                
                // Render corresponding tab data
                if(target === 'admin-tab-dashboard') this.renderDashboard();
                if(target === 'admin-tab-leaves') this.renderLeaves();
                if(target === 'admin-tab-calendar') this.renderCalendar();
                if(target === 'admin-tab-users') this.renderUsers();
                if(target === 'admin-tab-policies') this.renderPolicies();
                if(target === 'admin-tab-holidays') this.renderHolidays();
                if(target === 'admin-tab-migration') this.renderMigrationTab();
            });
        });

        // Calendar Nav
        document.getElementById('cal-prev-btn')?.addEventListener('click', () => {
            this.currentCalDate.setMonth(this.currentCalDate.getMonth() - 1);
            this.renderCalendar();
        });
        document.getElementById('cal-next-btn')?.addEventListener('click', () => {
            this.currentCalDate.setMonth(this.currentCalDate.getMonth() + 1);
            this.renderCalendar();
        });

        // Modals Logic
        const holModal = document.getElementById('holiday-modal');
        const ltModal = document.getElementById('leave-type-modal');
        
        // Edit Holiday Logic
        const editHolModal = document.getElementById('edit-holiday-modal');
        document.getElementById('close-edit-holiday-modal')?.addEventListener('click', () => {
            editHolModal.classList.add('hidden');
        });
        document.getElementById('edit-holiday-form')?.addEventListener('submit', (e) => {
            e.preventDefault();
            const oldDate = document.getElementById('edit-holiday-old-date').value;
            const newDate = document.getElementById('edit-holiday-date-input').value;
            const name = document.getElementById('edit-holiday-name-input').value;
            const type = document.getElementById('edit-holiday-type-input').value;
            Store.updateHoliday(oldDate, { date: newDate, name, type });
            window.AdminUI.renderHolidays();
            editHolModal.classList.add('hidden');
        });

        // Add Holiday
        const addHoliBtn = document.getElementById('add-holiday-btn');
        if(addHoliBtn) addHoliBtn.addEventListener('click', () => {
            document.getElementById('holiday-form').reset();
            holModal.classList.remove('hidden');
        });
        
        document.getElementById('close-holiday-modal')?.addEventListener('click', () => {
            holModal.classList.add('hidden');
        });
        
        document.getElementById('holiday-form')?.addEventListener('submit', (e) => {
            e.preventDefault();
            const date = document.getElementById('holiday-date-input').value;
            const name = document.getElementById('holiday-name-input').value;
            const type = document.getElementById('holiday-type-input').value;
            Store.addHoliday({ date, name, type });
            window.AdminUI.renderHolidays();
            holModal.classList.add('hidden');
        });

        // Add Leave Type
        const addPolicyBtn = document.getElementById('add-policy-btn');
        if(addPolicyBtn) addPolicyBtn.addEventListener('click', () => {
            document.getElementById('leave-type-form').reset();
            ltModal.classList.remove('hidden');
        });
        
        document.getElementById('close-leave-type-modal')?.addEventListener('click', () => {
            ltModal.classList.add('hidden');
        });
        
        document.getElementById('leave-type-form')?.addEventListener('submit', (e) => {
            e.preventDefault();
            const name = document.getElementById('leave-name-input').value;
            const limit = parseInt(document.getElementById('leave-limit-input').value, 10);
            const cycle = document.getElementById('leave-cycle-input').value;
            Store.addLeaveType({ id: Date.now().toString(), name, limit, cycle });
            window.AdminUI.renderPolicies();
            ltModal.classList.add('hidden');
        });

        // Edit Leave Type Logic
        const editLtModal = document.getElementById('edit-leave-type-modal');
        document.getElementById('close-edit-leave-type-modal')?.addEventListener('click', () => {
            editLtModal.classList.add('hidden');
        });
        document.getElementById('edit-leave-type-form')?.addEventListener('submit', (e) => {
            e.preventDefault();
            const id = document.getElementById('edit-leave-id').value;
            const name = document.getElementById('edit-leave-name-input').value;
            const limit = parseInt(document.getElementById('edit-leave-limit-input').value, 10);
            const cycle = document.getElementById('edit-leave-cycle-input').value;
            Store.updateLeaveType(id, name, limit, cycle);
            window.AdminUI.renderPolicies();
            editLtModal.classList.add('hidden');
        });

        // Extra Off
        const extraOffModal = document.getElementById('extra-off-modal');
        document.getElementById('close-extra-off-modal')?.addEventListener('click', () => {
            extraOffModal.classList.add('hidden');
        });
        document.getElementById('extra-off-form')?.addEventListener('submit', (e) => {
            e.preventDefault();
            const uid = document.getElementById('extra-off-userid').value;
            const leaves = document.getElementById('extra-leaves-input').value;
            const wfh = document.getElementById('extra-wfh-input').value;
            Store.updateExtraOff(uid, leaves, wfh);
            window.AdminUI.renderUsers();
            extraOffModal.classList.add('hidden');
        });

        // Grant Leave Logic
        const grantLeaveModal = document.getElementById('grant-leave-modal');
        
        document.querySelectorAll('input[name="adminReqType"]')?.forEach(radio => {
            radio.addEventListener('change', (e) => {
                document.getElementById('admin-leave-type-group').style.display = e.target.value === 'WFH' ? 'none' : 'flex';
                document.getElementById('grant-leave-type').required = e.target.value === 'Leave';
            });
        });

        document.getElementById('close-grant-leave-modal')?.addEventListener('click', () => {
            grantLeaveModal.classList.add('hidden');
        });
        document.getElementById('grant-leave-form')?.addEventListener('submit', (e) => {
            e.preventDefault();
            const start = document.getElementById('grant-leave-start').value;
            const end = document.getElementById('grant-leave-end').value;
            
            const reqVal = document.querySelector('input[name="adminReqType"]:checked')?.value || 'Leave';
            const type = reqVal === 'WFH' ? 'Work From Home' : document.getElementById('grant-leave-type').value;
            
            const reason = document.getElementById('grant-leave-reason').value;
            const uid = document.getElementById('grant-leave-user').value;
            const isHalfDay = document.getElementById('grant-half-day-toggle')?.checked;

            if (new Date(start) > new Date(end)) {
                alert('End date cannot be before start date.');
                return;
            }

            const activePersons = window.AdminUI._cachedUsers || [];
            const user = activePersons.find(x => x.id === uid) || { first_name: 'Unknown', last_name: 'User', email: 'unknown' };

            const request = {
                id: Date.now().toString(),
                userId: uid,
                userName: `${user.first_name} ${user.last_name}`,
                userEmail: user.email,
                type,
                startDate: start,
                endDate: end,
                reason: reason + ' (Admin Granted)',
                status: 'Approved',
                appliedOn: new Date().toISOString(),
                isHalfDay: isHalfDay
            };
            
            Store.addLeaveRequest(request);
            window.AdminUI.renderLeaves();
            e.target.reset();
            grantLeaveModal.classList.add('hidden');
        });

        // Logout
        document.getElementById('admin-logout-btn').addEventListener('click', () => {
            Auth.logout();
            window.location.reload();
        });

        // Export / Import Data logic
        document.getElementById('btn-export-data')?.addEventListener('click', () => {
            const data = {
                users: localStorage.getItem('users'),
                holidays: localStorage.getItem('holidays'),
                attendance: localStorage.getItem('attendance'),
                leaves: localStorage.getItem('leaves'),
                leaveTypes: localStorage.getItem('leaveTypes'),
                extraOff: localStorage.getItem('extraOff')
            };
            const blob = new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'});
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `attendance_backup_${new Date().toISOString().slice(0,10)}.json`;
            a.click();
            URL.revokeObjectURL(url);
        });

        document.getElementById('file-import-data')?.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (evt) => {
                try {
                    const data = JSON.parse(evt.target.result);
                    if (data.users) localStorage.setItem('users', data.users);
                    if (data.holidays) localStorage.setItem('holidays', data.holidays);
                    if (data.attendance) localStorage.setItem('attendance', data.attendance);
                    if (data.leaves) localStorage.setItem('leaves', data.leaves);
                    if (data.leaveTypes) localStorage.setItem('leaveTypes', data.leaveTypes);
                    if (data.extraOff) localStorage.setItem('extraOff', data.extraOff);
                    alert('Data imported successfully. Reloading...');
                    window.location.reload();
                } catch (err) {
                    alert('Invalid JSON file format.');
                }
            };
            reader.readAsText(file);
        });

        // --- Migration Tab Event Listeners ---
        this._migrationBatch = [];

        document.getElementById('migration-add-row-btn')?.addEventListener('click', () => {
            const typeSelect = document.getElementById('migration-type-select');
            const startDate = document.getElementById('migration-start-date').value;
            const endDate = document.getElementById('migration-end-date').value;
            const reason = document.getElementById('migration-reason').value;

            if (!startDate || !endDate) {
                alert('Please fill in both Start and End dates.');
                return;
            }
            if (new Date(startDate) > new Date(endDate)) {
                alert('End date cannot be before start date.');
                return;
            }

            const type = typeSelect.value === 'WFH' ? 'Work From Home' : typeSelect.options[typeSelect.selectedIndex].text;

            this._migrationBatch.push({
                type,
                startDate,
                endDate,
                reason: reason || 'Migrated from old system'
            });

            // Clear date inputs for next entry
            document.getElementById('migration-start-date').value = '';
            document.getElementById('migration-end-date').value = '';
            document.getElementById('migration-reason').value = '';

            this._renderMigrationBatch();
        });

        document.getElementById('migration-clear-btn')?.addEventListener('click', () => {
            this._migrationBatch = [];
            this._renderMigrationBatch();
        });

        document.getElementById('migration-submit-btn')?.addEventListener('click', async () => {
            if (this._migrationBatch.length === 0) {
                alert('No records to submit. Add entries first.');
                return;
            }

            const userId = document.getElementById('migration-user-select').value;
            if (!userId) {
                alert('Please select a user.');
                return;
            }

            const records = this._migrationBatch.map(r => ({
                userId,
                type: r.type,
                startDate: r.startDate,
                endDate: r.endDate,
                reason: r.reason,
                status: 'approved'
            }));

            const btn = document.getElementById('migration-submit-btn');
            btn.textContent = 'Syncing...';
            btn.disabled = true;

            try {
                const res = await fetch('/api/admin/migration/history', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ records })
                });
                const data = await res.json();

                if (data.success) {
                    const s = data.summary;
                    alert(`Migration complete!\n\nAdded: ${s.added}\nFailed: ${s.failed}${s.errors.length ? '\n\nErrors:\n' + s.errors.map(e => `Row ${e.index+1}: ${e.message}`).join('\n') : ''}`);
                    this._migrationBatch = [];
                    this._renderMigrationBatch();
                    // Re-sync store so new leaves appear everywhere
                    await Store.syncWithBackend();
                    this.renderMigrationHistory();
                } else {
                    alert('Migration failed: ' + (data.message || 'Unknown error'));
                }
            } catch (err) {
                console.error('Migration submit error:', err);
                alert('Error connecting to backend.');
            } finally {
                btn.disabled = false;
                btn.textContent = `Sync History (${this._migrationBatch.length} records)`;
            }
        });
    },

    syncKitsuUsers: async function() {
        try {
            const res = await fetch('/api/sync/store');
            if(res.ok) {
                const data = await res.json();
                // Map DB users to the format the dashboard expects
                this.kitsuPersons = (data.users || []).map(u => {
                    const nameParts = (u.name || '').split(' ');
                    return {
                        id: u.id,
                        first_name: nameParts[0] || '',
                        last_name: nameParts.slice(1).join(' ') || '',
                        email: u.id,
                        role: u.role,
                        active: true
                    };
                });
                this.renderDashboard();
            }
        } catch(e) { console.error('Error syncing users:', e); }
    },

    getTodayStr: function() {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    },

    renderDashboard: function() {
        const today = this.getTodayStr();
        const attendance = Store.getAllAttendanceToday(today);
        const leaves = Store.getAllLeaves();
        
        // Exclude super-admins (founders) from all headcount calculations
        const activePersons = this.kitsuPersons.filter(p => p.active && (p.role || '').toLowerCase() !== 'admin');
        const presentCount = attendance.filter(r => activePersons.some(p => p.id === r.userId)).length;
        const totalUsers = activePersons.length > 0 ? activePersons.length : 0;
        document.getElementById('stat-present').textContent = `${presentCount} / ${totalUsers}`;
        
        const pendingCount = leaves.filter(l => l.status === 'Pending').length;
        document.getElementById('stat-pending').textContent = pendingCount;
        
        // Render Table
        const tbody = document.getElementById('live-attendance-tbody');
        tbody.innerHTML = '';
        
        let onLeaveCount = 0;
        let wfhCount = 0;
        
        activePersons.forEach(user => {
            const record = attendance.find(r => r.userId === user.id);
            const tr = document.createElement('tr');
            
            let statusBadge = '<span class="badge rejected">Absent</span>';
            let checkIn = '--:--';
            let checkOut = '--:--';
            
            if(record) {
                checkIn = record.checkInTime;
                if(record.checkOutTime) {
                    statusBadge = '<span class="badge approved">Completed</span>';
                    checkOut = record.checkOutTime;
                } else {
                    statusBadge = '<span class="badge pending">Working</span>';
                }
            }
            
            // Check if on leave
            const activeLeave = leaves.find(l => l.userId === user.id && l.status === 'Approved' && l.startDate <= today && l.endDate >= today);
            if(activeLeave && !record) {
                const isWfh = activeLeave.type?.toLowerCase().includes('wfh') || activeLeave.type?.toLowerCase().includes('work from home');
                if(isWfh) {
                    statusBadge = '<span class="badge" style="background:#3b82f6;color:white;">WFH</span>';
                    wfhCount++;
                } else {
                    statusBadge = '<span class="badge" style="background:#8b5cf6;color:white;">On Leave</span>';
                    onLeaveCount++;
                }
            }

            tr.innerHTML = `
                <td><strong>${user.first_name} ${user.last_name}</strong><br><small style="color:var(--text-muted)">${user.id}</small></td>
                <td>${statusBadge}</td>
                <td>${checkIn}</td>
                <td>${checkOut}</td>
            `;
            tbody.appendChild(tr);
        });

        // Update WFH & On Leave stats
        const onLeaveEl = document.getElementById('stat-on-leave');
        const wfhEl = document.getElementById('stat-wfh');
        if (onLeaveEl) onLeaveEl.textContent = onLeaveCount;
        if (wfhEl) wfhEl.textContent = wfhCount;

        // 1. Render Main Chart
        const absentCount = totalUsers > 0 ? Math.max(0, totalUsers - presentCount - onLeaveCount - wfhCount) : 0;
        const ctx = document.getElementById('attendanceChart');
        if(ctx) {
            try {
                if(window.AdminUI.attendanceChartInstance) {
                    window.AdminUI.attendanceChartInstance.destroy();
                }
                window.AdminUI.attendanceChartInstance = new Chart(ctx, {
                    type: 'doughnut',
                    data: {
                        labels: totalUsers > 0 ? ['Office', 'WFH', 'On Leave', 'Absent'] : ['No Data'],
                        datasets: [{
                            data: totalUsers > 0 ? [presentCount, wfhCount, onLeaveCount, absentCount] : [1],
                            backgroundColor: totalUsers > 0 ? ['#10b981', '#3b82f6', '#8b5cf6', '#ef4444'] : ['#334155'],
                            borderWidth: 0
                        }]
                    },
                    options: {
                        responsive: false,
                        plugins: {
                            legend: { position: 'right', labels: { color: '#e2e8f0', usePointStyle: true } }
                        }
                    }
                });
            } catch(e) { console.error("Chart error:", e); }
        }

        // 2. Trend Chart (7 days)
        const trendCtx = document.getElementById('trendChart');
        if(trendCtx) {
            if(window.AdminUI.trendChartInstance) window.AdminUI.trendChartInstance.destroy();
            
            const labels = [];
            const officeData = [];
            const wfhData = [];
            const leaveData = [];
            
            for(let i=6; i>=0; i--) {
                const d = new Date();
                d.setDate(d.getDate() - i);
                const dStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
                labels.push(`${d.getMonth()+1}/${d.getDate()}`);
                
                const dayAttendance = Store.getAllAttendanceToday(dStr).length;
                let dayLeaveCount = 0;
                let dayWfhCount = 0;
                
                // Only count non-admin employees in trend
                activePersons.forEach(user => {
                    const actL = leaves.find(l => l.userId === user.id && l.status === 'Approved' && l.startDate <= dStr && l.endDate >= dStr);
                    if(actL) {
                        const isW = actL.type?.toLowerCase().includes('wfh') || actL.type?.toLowerCase().includes('work from home');
                        if(isW) dayWfhCount++; else dayLeaveCount++;
                    }
                });
                
                officeData.push(dayAttendance);
                wfhData.push(dayWfhCount);
                leaveData.push(dayLeaveCount);
            }
            
            window.AdminUI.trendChartInstance = new Chart(trendCtx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [
                        { label: 'Office', data: officeData, borderColor: '#10b981', backgroundColor: '#10b981', tension: 0.3 },
                        { label: 'WFH', data: wfhData, borderColor: '#3b82f6', backgroundColor: '#3b82f6', tension: 0.3 },
                        { label: 'On Leave', data: leaveData, borderColor: '#8b5cf6', backgroundColor: '#8b5cf6', tension: 0.3 }
                    ]
                },
                options: { responsive: false, plugins: { legend: { labels: { color: '#e2e8f0'} } }, scales: { y: { beginAtZero: true, ticks: {color: '#94a3b8', stepSize:1}, grid:{color:'rgba(255,255,255,0.05)'} }, x: { ticks: {color: '#94a3b8'}, grid:{color:'rgba(255,255,255,0.05)'} } } }
            });
        }

        // 3. Leave Distribution
        const distCtx = document.getElementById('leaveDistChart');
        if(distCtx) {
            if(window.AdminUI.distChartInstance) window.AdminUI.distChartInstance.destroy();
            const typeCounts = {};
            leaves.filter(l => l.status === 'Approved').forEach(l => {
                const isW = l.type?.toLowerCase().includes('wfh') || l.type?.toLowerCase().includes('work from home');
                if(!isW) typeCounts[l.type] = (typeCounts[l.type] || 0) + 1;
            });
            const bgColors = ['#f43f5e', '#d946ef', '#f59e0b', '#3b82f6', '#10b981', '#14b8a6', '#64748b'];
            window.AdminUI.distChartInstance = new Chart(distCtx, {
                type: 'pie',
                data: {
                    labels: Object.keys(typeCounts).length ? Object.keys(typeCounts) : ['No Leaves'],
                    datasets: [{ data: Object.keys(typeCounts).length ? Object.values(typeCounts) : [1], backgroundColor: Object.keys(typeCounts).length ? bgColors.slice(0, Object.keys(typeCounts).length) : ['#334155'], borderWidth:0 }]
                },
                options: { responsive:false, plugins: { legend: { position: 'right', labels: {color: '#e2e8f0', usePointStyle: true} } } }
            });
        }

        // 4. Top Takers
        const takersCtx = document.getElementById('topTakersChart');
        if(takersCtx) {
            if(window.AdminUI.takersChartInstance) window.AdminUI.takersChartInstance.destroy();
            const userTotals = {};
            leaves.filter(l => l.status === 'Approved').forEach(l => {
                userTotals[l.userId] = (userTotals[l.userId] || 0) + 1;
            });
            const sorted = Object.entries(userTotals).sort((a,b) => b[1] - a[1]).slice(0, 5);
            const tkLabels = sorted.map(s => {
                const u = activePersons.find(p => p.id === s[0]);
                return u ? `${u.first_name} ${u.last_name}` : s[0];
            });
            const tkData = sorted.map(s => s[1]);
            
            window.AdminUI.takersChartInstance = new Chart(takersCtx, {
                type: 'bar',
                data: {
                    labels: tkLabels.length ? tkLabels : ['None'],
                    datasets: [{ label: 'Approved Requests', data: tkData.length ? tkData : [0], backgroundColor: '#f43f5e', borderRadius:4 }]
                },
                options: { indexAxis: 'y', responsive:false, plugins: { legend: { display:false } }, scales: { y: { ticks: {color: '#94a3b8'}, grid:{display:false} }, x: { ticks: {color: '#94a3b8', stepSize:1}, grid:{color:'rgba(255,255,255,0.05)'} } } }
            });
        }

        // 5. WFH Monthly Usage Chart
        const wfhMonthlyCtx = document.getElementById('wfhMonthlyChart');
        if (wfhMonthlyCtx) {
            if (this.wfhMonthlyChartInstance) this.wfhMonthlyChartInstance.destroy();
            const wfhMonthLabels = [];
            const wfhMonthData = [];
            const now = new Date();
            for (let m = 5; m >= 0; m--) {
                const d = new Date(now.getFullYear(), now.getMonth() - m, 1);
                const mStr = d.toLocaleString('default', { month: 'short', year: '2-digit' });
                wfhMonthLabels.push(mStr);
                const mStart = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;
                const mEnd = new Date(d.getFullYear(), d.getMonth()+1, 0);
                const mEndStr = `${mEnd.getFullYear()}-${String(mEnd.getMonth()+1).padStart(2,'0')}-${String(mEnd.getDate()).padStart(2,'0')}`;
                let wfhDays = 0;
                leaves.filter(l => l.status === 'Approved' && this._isWfh(l.type)).forEach(l => {
                    if (l.endDate >= mStart && l.startDate <= mEndStr) wfhDays += this._calcDays(l);
                });
                wfhMonthData.push(wfhDays);
            }
            this.wfhMonthlyChartInstance = new Chart(wfhMonthlyCtx, {
                type: 'bar',
                data: { labels: wfhMonthLabels, datasets: [{ label: 'WFH Days', data: wfhMonthData, backgroundColor: '#3b82f6', borderRadius: 6 }] },
                options: { responsive: false, plugins: { legend: { labels: { color: '#e2e8f0' } } }, scales: { y: { beginAtZero: true, ticks: { color: '#94a3b8', stepSize: 1 }, grid: { color: 'rgba(255,255,255,0.05)' } }, x: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.05)' } } } }
            });
        }

        // 6. Leave vs WFH Split Chart
        const lvwCtx = document.getElementById('leaveVsWfhChart');
        if (lvwCtx) {
            if (this.leaveVsWfhChartInstance) this.leaveVsWfhChartInstance.destroy();
            const approvedLeaves = leaves.filter(l => l.status === 'Approved');
            const totalWfhDays = approvedLeaves.filter(l => this._isWfh(l.type)).reduce((a, l) => a + this._calcDays(l), 0);
            const totalLeaveDays = approvedLeaves.filter(l => !this._isWfh(l.type)).reduce((a, l) => a + this._calcDays(l), 0);
            this.leaveVsWfhChartInstance = new Chart(lvwCtx, {
                type: 'doughnut',
                data: {
                    labels: (totalWfhDays + totalLeaveDays) > 0 ? ['Leaves', 'WFH'] : ['No Data'],
                    datasets: [{ data: (totalWfhDays + totalLeaveDays) > 0 ? [totalLeaveDays, totalWfhDays] : [1], backgroundColor: (totalWfhDays + totalLeaveDays) > 0 ? ['#8b5cf6', '#3b82f6'] : ['#334155'], borderWidth: 0 }]
                },
                options: { responsive: false, plugins: { legend: { position: 'right', labels: { color: '#e2e8f0', usePointStyle: true } } } }
            });
        }
    },

    renderLeaves: function() {
        const leaves = Store.getAllLeaves();
        const tbody = document.getElementById('admin-leaves-tbody');
        if(!tbody) return;
        tbody.innerHTML = '';
        
        if(leaves.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">No leaves found.</td></tr>';
            return;
        }
        
        leaves.forEach(l => {
            const sDate = l.startDate;
            const eDate = l.endDate;
            const diffTime = Math.abs(new Date(eDate).getTime() - new Date(sDate).getTime());
            const diffDays = l.isHalfDay ? 0.5 : Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;

            const userObj = window.AdminUI.kitsuPersons.find(u => u.id === l.userId);
            const displayObjName = userObj ? `${userObj.first_name} ${userObj.last_name}` : (l.userName || l.userId || 'Unknown');

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${displayObjName}</strong></td>
                <td>${l.type} ${l.isHalfDay ? '<span class="badge" style="background:var(--warning); color:white; font-size:10px; margin-left:6px;">Half Day</span>' : ''}</td>
                <td>${sDate} to ${eDate} (${diffDays} day${diffDays!==1?'s':''})</td>
                <td>${l.reason}</td>
            `;

            let actionHtml = '';
            if (l.status === 'Pending') {
                actionHtml = `
                    <button class="btn-small btn-approve" onclick="window.AdminUI.updateLeave('${l.id}','Approved')">Approve</button>
                    <button class="btn-small btn-reject" onclick="window.AdminUI.updateLeave('${l.id}','Rejected')">Reject</button>
                `;
            } else if (l.status === 'Approved') {
                actionHtml = `
                    <em>Approved</em> <br/>
                    <button class="btn-small btn-reject" style="margin-top:6px;" onclick="window.AdminUI.updateLeave('${l.id}','Rejected')">Revoke</button>
                `;
            } else {
                actionHtml = `<em>${l.status}</em>`;
            }
            tr.innerHTML += `<td style="min-width: 140px;">${actionHtml}</td>`;
            
            tbody.appendChild(tr);
        });
    },

    updateLeave: function(leaveId, status) {
        Store.updateLeaveStatus(leaveId, status);
        this.renderLeaves();
        this.renderDashboard(); // refresh stats
    },

    renderUsers: async function() {
        const tbody = document.getElementById('admin-users-tbody');
        if(!tbody) return;
        tbody.innerHTML = `
            <tr>
                <td><div class="skeleton" style="height:20px; width:120px; border-radius:4px; margin-bottom:6px;"></div><div class="skeleton" style="height:12px; width:80px; border-radius:4px;"></div></td>
                <td><div class="skeleton" style="height:20px; width:150px; border-radius:4px;"></div></td>
                <td><div class="skeleton" style="height:24px; width:100px; border-radius:12px;"></div></td>
                <td><div class="skeleton" style="height:24px; width:100px; border-radius:12px;"></div></td>
                <td><div class="skeleton" style="height:28px; width:60px; border-radius:4px;"></div></td>
            </tr>
            <tr>
                <td><div class="skeleton" style="height:20px; width:100px; border-radius:4px; margin-bottom:6px;"></div><div class="skeleton" style="height:12px; width:70px; border-radius:4px;"></div></td>
                <td><div class="skeleton" style="height:20px; width:130px; border-radius:4px;"></div></td>
                <td><div class="skeleton" style="height:24px; width:90px; border-radius:12px;"></div></td>
                <td><div class="skeleton" style="height:24px; width:100px; border-radius:12px;"></div></td>
                <td><div class="skeleton" style="height:28px; width:60px; border-radius:4px;"></div></td>
            </tr>
        `;
        
        try {
            const res = await fetch('/api/sync/store');
            const data = await res.json();
            
            // In postgres we only store active users generally, so we show all rows
            const dbUsers = data.users || [];
            window.AdminUI._cachedUsers = dbUsers;
            
            const grantUserSelect = document.getElementById('grant-leave-user');
            if(grantUserSelect) {
                grantUserSelect.innerHTML = dbUsers.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
            }
            
            tbody.innerHTML = '';
            
            dbUsers.forEach(p => {
                const tr = document.createElement('tr');
                const fullName = p.name;
                const email = p.id;
                // Treat users with role 'admin' as having Super Admin app access
                const appAccess = p.role === 'admin' ? 'Super Admin' : 'Normal User';
                
                const extra = Store.getExtraOff(p.id) || { leaves: 0, wfh: 0 };
                const extraText = `+${extra.leaves} L / +${extra.wfh} WFH`;
                
                tr.innerHTML = `
                    <td><strong>${fullName}</strong></td>
                    <td>${email}</td>
                    <td><span class="badge" style="background:#475569; color:white">Standard</span></td>
                    <td><span class="badge" style="background: ${p.role==='admin'?'var(--primary)':'var(--glass-border)'}; color:${p.role==='admin'?'white':'var(--text-main)'}">${appAccess}</span></td>
                    <td>
                        <button class="btn-small" style="background:#3b82f6; color:white; margin-right:4px;" onclick="window.AdminUI.openUserDetail('${p.id}')">View</button>
                        <button class="btn-small btn-primary" style="margin-right:4px;" onclick="window.AdminUI.openExtraOffModal('${p.id}', ${extra.leaves}, ${extra.wfh})">Edit Off</button>
                        ${p.id !== this.currentUser.id ? `<button class="btn-small btn-reject" onclick="window.AdminUI.deleteUser('${p.id}')">Remove</button>` : ''}
                    </td>
                `;
                tbody.appendChild(tr);
            });
        } catch(e) {
            console.error(e);
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--danger)">Failed to sync users with Backend.</td></tr>';
        }
    },

    openUserDetail: function(userId) {
        const users = this._cachedUsers || [];
        const user = users.find(u => u.id === userId);
        if (!user) return;

        const allLeaves = Store.getAllLeaves().filter(l => l.userId === userId);
        const leaveTypes = Store.getLeaveTypes();
        const extra = Store.getExtraOff(userId);

        // Separate WFH and Leaves
        const wfhRequests = allLeaves.filter(l => this._isWfh(l.type));
        const leaveRequests = allLeaves.filter(l => !this._isWfh(l.type));

        // --- WFH Balance ---
        const wfhPolicy = leaveTypes.find(t => this._isWfh(t.name));
        const wfhLimit = wfhPolicy ? parseInt(wfhPolicy.limit) : 0;
        const wfhCycle = wfhPolicy ? wfhPolicy.cycle : 'monthly';
        let wfhUsed = 0;
        const now = new Date();
        wfhRequests.filter(l => l.status === 'Approved').forEach(l => {
            // For monthly cycle, only count current month
            if (wfhCycle === 'monthly' || wfhCycle === 'Monthly') {
                const mStart = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
                const mEnd = new Date(now.getFullYear(), now.getMonth()+1, 0);
                const mEndStr = `${mEnd.getFullYear()}-${String(mEnd.getMonth()+1).padStart(2,'0')}-${String(mEnd.getDate()).padStart(2,'0')}`;
                if (l.endDate >= mStart && l.startDate <= mEndStr) wfhUsed += this._calcDays(l);
            } else {
                wfhUsed += this._calcDays(l);
            }
        });
        const wfhExtra = extra.wfh || 0;
        const wfhRemaining = Math.max(0, wfhLimit + wfhExtra - wfhUsed);

        // --- Leave Balances per type (excluding WFH) ---
        const leaveBalances = leaveTypes.filter(t => !this._isWfh(t.name)).map(t => {
            const used = leaveRequests.filter(l => l.type === t.name && l.status === 'Approved')
                .reduce((a, l) => a + this._calcDays(l), 0);
            const limit = parseInt(t.limit);
            return { name: t.name, limit, cycle: t.cycle, used, remaining: Math.max(0, limit - used) };
        });

        // Add extra leaves to the first leave type or show as a separate card
        const extraLeaves = extra.leaves || 0;

        // --- Populate Modal ---
        document.getElementById('user-detail-name').textContent = user.name;
        document.getElementById('user-detail-email').textContent = userId;

        // Leave balance cards
        const balancesDiv = document.getElementById('user-detail-leave-balances');
        balancesDiv.innerHTML = '';
        leaveBalances.forEach(b => {
            const pct = b.limit > 0 ? Math.min(100, (b.used / b.limit) * 100) : 0;
            const barColor = pct > 80 ? '#ef4444' : pct > 50 ? '#f59e0b' : '#10b981';
            balancesDiv.innerHTML += `
                <div style="background:var(--glass-bg); border:1px solid var(--glass-border); border-radius:10px; padding:14px;">
                    <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
                        <strong style="font-size:13px;">${b.name}</strong>
                        <span style="font-size:12px; color:var(--text-muted);">${b.cycle}</span>
                    </div>
                    <div style="display:flex; justify-content:space-between; font-size:12px; color:var(--text-muted); margin-bottom:6px;">
                        <span>Used: <strong style="color:var(--text-main)">${b.used}</strong></span>
                        <span>Left: <strong style="color:${barColor}">${b.remaining}</strong> / ${b.limit}</span>
                    </div>
                    <div style="background:rgba(255,255,255,0.08); border-radius:4px; height:6px; overflow:hidden;">
                        <div style="width:${pct}%; height:100%; background:${barColor}; border-radius:4px; transition:width 0.3s;"></div>
                    </div>
                </div>
            `;
        });
        if (extraLeaves > 0) {
            balancesDiv.innerHTML += `
                <div style="background:var(--glass-bg); border:1px solid var(--glass-border); border-radius:10px; padding:14px;">
                    <strong style="font-size:13px;">Extra Leave Allowance</strong>
                    <div style="font-size:22px; font-weight:700; color:#10b981; margin-top:8px;">+${extraLeaves} days</div>
                </div>
            `;
        }

        // WFH balance card
        const wfhDiv = document.getElementById('user-detail-wfh-balance');
        const wfhAllTime = wfhRequests.filter(l => l.status === 'Approved').reduce((a, l) => a + this._calcDays(l), 0);
        const wfhPct = (wfhLimit + wfhExtra) > 0 ? Math.min(100, (wfhUsed / (wfhLimit + wfhExtra)) * 100) : 0;
        const wfhBarColor = wfhPct > 80 ? '#ef4444' : wfhPct > 50 ? '#f59e0b' : '#3b82f6';
        const isMonthly = wfhCycle === 'monthly' || wfhCycle === 'Monthly';
        const monthName = now.toLocaleString('default', { month: 'long' });
        wfhDiv.innerHTML = `
            <div style="background:rgba(59,130,246,0.08); border:1px solid rgba(59,130,246,0.25); border-radius:10px; padding:16px;">
                <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
                    <strong style="font-size:14px;">Work From Home</strong>
                    <span style="font-size:12px; color:var(--text-muted);">${wfhCycle}${wfhExtra > 0 ? ' (+' + wfhExtra + ' extra)' : ''}</span>
                </div>
                ${isMonthly ? `<div style="font-size:12px; color:var(--text-muted); margin-bottom:10px;">📅 ${monthName} ${now.getFullYear()}</div>` : ''}
                <div style="display:flex; gap:24px; margin-bottom:8px;">
                    <div><span style="font-size:24px; font-weight:700; color:#3b82f6;">${wfhUsed}</span> <span style="font-size:12px; color:var(--text-muted);">used ${isMonthly ? 'this month' : ''}</span></div>
                    <div><span style="font-size:24px; font-weight:700; color:${wfhBarColor};">${wfhRemaining}</span> <span style="font-size:12px; color:var(--text-muted);">remaining</span></div>
                    <div><span style="font-size:24px; font-weight:700; color:var(--text-muted);">${wfhLimit + wfhExtra}</span> <span style="font-size:12px; color:var(--text-muted);">limit</span></div>
                </div>
                <div style="background:rgba(255,255,255,0.08); border-radius:4px; height:6px; overflow:hidden; margin-bottom:12px;">
                    <div style="width:${wfhPct}%; height:100%; background:${wfhBarColor}; border-radius:4px; transition:width 0.3s;"></div>
                </div>
                <div style="display:flex; justify-content:space-between; padding-top:10px; border-top:1px solid rgba(255,255,255,0.06);">
                    <span style="font-size:13px; color:var(--text-muted);">📊 All-Time WFH Total</span>
                    <strong style="font-size:15px; color:#3b82f6;">${wfhAllTime} day${wfhAllTime !== 1 ? 's' : ''}</strong>
                </div>
            </div>
        `;

        // History table
        this._userDetailRequests = allLeaves;
        this._renderUserDetailHistory('all');

        // Filter buttons
        document.querySelectorAll('.user-detail-filter').forEach(btn => {
            btn.onclick = () => {
                document.querySelectorAll('.user-detail-filter').forEach(b => { b.classList.remove('active'); b.classList.remove('btn-primary'); b.classList.add('btn-neutral'); });
                btn.classList.add('active'); btn.classList.remove('btn-neutral'); btn.classList.add('btn-primary');
                this._renderUserDetailHistory(btn.dataset.filter);
            };
        });

        // Close modal handler
        document.getElementById('close-user-detail-modal').onclick = () => document.getElementById('user-detail-modal').classList.add('hidden');
        document.getElementById('user-detail-modal').querySelector('.modal-overlay').onclick = () => document.getElementById('user-detail-modal').classList.add('hidden');

        document.getElementById('user-detail-modal').classList.remove('hidden');
    },

    _renderUserDetailHistory: function(filter) {
        const tbody = document.getElementById('user-detail-history-tbody');
        if (!tbody) return;

        let requests = this._userDetailRequests || [];
        if (filter === 'wfh') requests = requests.filter(l => this._isWfh(l.type));
        else if (filter === 'leave') requests = requests.filter(l => !this._isWfh(l.type));

        if (requests.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--text-muted); padding:20px;">No records found.</td></tr>';
            return;
        }

        tbody.innerHTML = '';
        requests.forEach(l => {
            const days = this._calcDays(l);
            const isW = this._isWfh(l.type);
            const catBadge = isW
                ? '<span class="badge" style="background:#3b82f6; color:white;">WFH</span>'
                : '<span class="badge" style="background:#8b5cf6; color:white;">Leave</span>';
            let statusBadge = '';
            if (l.status === 'Approved') statusBadge = '<span class="badge approved">Approved</span>';
            else if (l.status === 'Pending') statusBadge = '<span class="badge pending">Pending</span>';
            else statusBadge = `<span class="badge rejected">${l.status}</span>`;

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${l.type}${l.isHalfDay ? ' <small style="color:var(--warning);">(Half)</small>' : ''}</td>
                <td>${catBadge}</td>
                <td>${l.startDate}${l.startDate !== l.endDate ? ' → ' + l.endDate : ''}</td>
                <td>${days}</td>
                <td>${statusBadge}</td>
            `;
            tbody.appendChild(tr);
        });
    },

    openExtraOffModal: function(uid, currLeaves, currWfh) {
        document.getElementById('extra-off-userid').value = uid;
        document.getElementById('extra-leaves-input').value = currLeaves;
        document.getElementById('extra-wfh-input').value = currWfh;
        document.getElementById('extra-off-modal').classList.remove('hidden');
    },

    deleteUser: async function(id) {
        if(confirm(`Are you sure you want to remove user: ${id}?`)) {
            try {
                const res = await fetch(`/api/users/${id}`, { method: 'DELETE' });
                const data = await res.json();
                if (data.success) {
                    alert('User removed successfully.');
                    this.renderUsers();
                    this.renderDashboard();
                } else {
                    alert('Failed to remove user: ' + (data.message || 'Unknown error'));
                }
            } catch (err) {
                console.error('Delete error:', err);
                alert('Error connecting to backend.');
            }
        }
    },

    renderPolicies: function() {
        const types = Store.getLeaveTypes();
        const tbody = document.getElementById('admin-policies-tbody');

        // Populate Grant Leave Type dropdown
        const relevantTypes = types.filter(t => !t.name.toLowerCase().includes('wfh') && !t.name.toLowerCase().includes('work from home'));
        const grantTypeSelect = document.getElementById('grant-leave-type');
        if(grantTypeSelect) {
            grantTypeSelect.innerHTML = relevantTypes.map(t => `<option value="${t.name}">${t.name}</option>`).join('');
            // Add Compensatory Off for Admin explicitly
            grantTypeSelect.innerHTML += `<option value="Compensatory Off">Compensatory Off</option>`;
        }
        
        if(!tbody) return;
        tbody.innerHTML = '';
        
        types.forEach(t => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${t.name}</strong></td>
                <td>${t.limit} days</td>
                <td>${t.cycle}</td>
                <td>
                    <div class="action-row">
                        <button class="btn-small btn-primary" onclick="window.AdminUI.openEditLeaveTypeModal('${t.id}', '${t.name}', ${t.limit}, '${t.cycle}')">Edit</button>
                        <button class="btn-small btn-reject" onclick="window.AdminUI.deleteLeaveType('${t.id}', '${t.name}')">Remove</button>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        });
    },

    openEditLeaveTypeModal: function(id, name, currLimit, currCycle) {
        document.getElementById('edit-leave-id').value = id;
        document.getElementById('edit-leave-name-input').value = name;
        document.getElementById('edit-leave-limit-input').value = currLimit;
        document.getElementById('edit-leave-cycle-input').value = currCycle;
        document.getElementById('edit-leave-type-modal').classList.remove('hidden');
    },

    deleteLeaveType: function(id, name) {
        if(confirm(`Remove leave type: ${name}?`)) {
            Store.deleteLeaveType(id);
            this.renderPolicies();
        }
    },

    renderCalendar: function() {
        const year = this.currentCalDate.getFullYear();
        const month = this.currentCalDate.getMonth();
        const monthName = this.currentCalDate.toLocaleString('default', { month: 'long', year: 'numeric' });
        
        const titleEl = document.getElementById('cal-month-title');
        if(titleEl) titleEl.textContent = monthName;
        
        const calContainer = document.getElementById('admin-calendar-grid');
        if(!calContainer) return;
        calContainer.innerHTML = '';
        
        const firstDay = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        
        const allLeaves = Store.getAllLeaves().filter(l => l.status === 'Approved');
        const users = this.kitsuPersons;
        const holidays = Store.getHolidays();
        
        for(let i=0; i<firstDay; i++) {
            calContainer.innerHTML += `<div class="calendar-day empty"></div>`;
        }
        
        for(let day=1; day <= daysInMonth; day++) {
            const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
            const folksOnLeave = allLeaves.filter(l => l.startDate <= dateStr && l.endDate >= dateStr);
            const holiday = holidays.find(h => h.date === dateStr);
            
            let badgesHTML = '';
            folksOnLeave.forEach(leave => {
                const user = users.find(u => u.id === leave.userId);
                const name = user ? user.first_name : (leave.userName || leave.userId);
                const isOpt = leave.type === 'Optional Holiday';
                const isWfh = leave.type?.toLowerCase().includes('wfh') || leave.type?.toLowerCase().includes('work from home');
                let badgeClass = '';
                if(isOpt) badgeClass = 'opt';
                else if(isWfh) badgeClass = 'wfh';
                
                badgesHTML += `<div class="cal-leave-badge ${badgeClass}">${name} ${isWfh ? '(WFH)' : (leave.isHalfDay ? '(Half)' : '')}</div>`;
            });

            if (holiday) {
                const hClass = holiday.type === 'Optional' ? 'opt' : 'holiday';
                badgesHTML += `<div class="cal-leave-badge ${hClass}">${holiday.name}</div>`;
            }

            const dayOfWeek = new Date(year, month, day).getDay();
            if (dayOfWeek === 0) {
                badgesHTML += `<div class="cal-leave-badge holiday">Sunday</div>`;
            }
            
            const isTodayStr = (dateStr === this.getTodayStr()) ? ' today' : '';

            calContainer.innerHTML += `
                <div class="calendar-day${isTodayStr}">
                    <div class="cal-date">${day}</div>
                    <div class="cal-badges">${badgesHTML}</div>
                </div>
            `;
        }
    },

    renderHolidays: function() {
        const holidays = Store.getHolidays();
        const tbody = document.getElementById('admin-holidays-tbody');
        tbody.innerHTML = '';
        
        holidays.forEach(h => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${h.date}</strong></td>
                <td>${h.name}</td>
                <td><span class="badge" style="background: ${h.type==='Optional'?'var(--warning)':'var(--success)'}; color:white">${h.type || 'Public'}</span></td>
                <td>
                    <div class="action-row">
                        <button class="btn-small btn-primary" onclick="window.AdminUI.openEditHolidayModal('${h.date}', '${h.name.replace(/'/g, "\\'")}', '${h.type}')">Edit</button>
                        <button class="btn-small btn-reject" onclick="window.AdminUI.deleteHoliday('${h.date}')">Remove</button>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        });
    },

    openEditHolidayModal: function(date, name, type) {
        document.getElementById('edit-holiday-old-date').value = date;
        document.getElementById('edit-holiday-date-input').value = date;
        document.getElementById('edit-holiday-name-input').value = name;
        document.getElementById('edit-holiday-type-input').value = type || 'Public';
        document.getElementById('edit-holiday-modal').classList.remove('hidden');
    },

    deleteHoliday: function(dateStr) {
        if(confirm(`Remove holiday on ${dateStr}?`)) {
            Store.deleteHoliday(dateStr);
            this.renderHolidays();
        }
    },

    // --- Migration Tab ---
    _migrationBatch: [],

    renderMigrationTab: async function() {
        // Populate user dropdown
        try {
            const res = await fetch('/api/sync/store');
            const data = await res.json();
            const dbUsers = data.users || [];

            const userSelect = document.getElementById('migration-user-select');
            if (userSelect) {
                userSelect.innerHTML = dbUsers.map(p => `<option value="${p.id}">${p.name} (${p.id})</option>`).join('');
            }

            // Populate type dropdown with leave types + WFH
            const typeSelect = document.getElementById('migration-type-select');
            if (typeSelect) {
                const types = Store.getLeaveTypes();
                let options = '<option value="WFH">Work From Home</option>';
                types.forEach(t => {
                    if (!t.name.toLowerCase().includes('wfh') && !t.name.toLowerCase().includes('work from home')) {
                        options += `<option value="${t.name}">${t.name}</option>`;
                    }
                });
                typeSelect.innerHTML = options;
            }
        } catch (e) {
            console.error('Error populating migration dropdowns:', e);
        }

        this._renderMigrationBatch();
        this.renderMigrationHistory();
    },

    _renderMigrationBatch: function() {
        const tbody = document.getElementById('migration-batch-tbody');
        const submitBtn = document.getElementById('migration-submit-btn');
        if (!tbody) return;

        if (this._migrationBatch.length === 0) {
            tbody.innerHTML = '<tr id="migration-empty-row"><td colspan="6" style="text-align:center; color:var(--text-muted); padding:24px;">No records added yet. Use the form above to add entries.</td></tr>';
            if (submitBtn) submitBtn.textContent = 'Sync History (0 records)';
            return;
        }

        tbody.innerHTML = '';
        this._migrationBatch.forEach((r, i) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${i + 1}</td>
                <td>${r.type}</td>
                <td>${r.startDate}</td>
                <td>${r.endDate}</td>
                <td style="max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${r.reason}</td>
                <td><button class="btn-small btn-reject" onclick="window.AdminUI.removeMigrationRow(${i})">✕</button></td>
            `;
            tbody.appendChild(tr);
        });

        if (submitBtn) submitBtn.textContent = `Sync History (${this._migrationBatch.length} record${this._migrationBatch.length !== 1 ? 's' : ''})`;
    },

    removeMigrationRow: function(index) {
        this._migrationBatch.splice(index, 1);
        this._renderMigrationBatch();
    },

    renderMigrationHistory: async function() {
        const tbody = document.getElementById('migration-history-tbody');
        if (!tbody) return;

        try {
            const res = await fetch('/api/sync/store');
            const data = await res.json();
            const allLeaves = data.leaves || [];
            const dbUsers = data.users || [];

            // Count migrated records per user using the isHistorical flag from API
            const userMigrationCounts = {};
            allLeaves.forEach(l => {
                if (l.isHistorical) {
                    userMigrationCounts[l.userId] = (userMigrationCounts[l.userId] || 0) + 1;
                }
            });

            tbody.innerHTML = '';
            const usersWithHistory = Object.keys(userMigrationCounts);

            if (usersWithHistory.length === 0) {
                tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; color:var(--text-muted);">No migrated records found.</td></tr>';
                return;
            }

            usersWithHistory.forEach(uid => {
                const user = dbUsers.find(u => u.id === uid);
                const displayName = user ? user.name : uid;
                const count = userMigrationCounts[uid];
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><strong>${displayName}</strong><br><small style="color:var(--text-muted)">${uid}</small></td>
                    <td><span class="badge" style="background:var(--primary); color:white;">${count} record${count !== 1 ? 's' : ''}</span></td>
                    <td><button class="btn-small btn-reject" onclick="window.AdminUI.clearMigrationHistory('${uid}', '${displayName}')">Clear History</button></td>
                `;
                tbody.appendChild(tr);
            });
        } catch (e) {
            console.error('Error rendering migration history:', e);
            tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; color:var(--danger);">Failed to load.</td></tr>';
        }
    },

    clearMigrationHistory: async function(userId, displayName) {
        if (!confirm(`Are you sure you want to delete ALL migrated records for ${displayName}?\n\nThis cannot be undone.`)) return;

        try {
            const res = await fetch(`/api/admin/migration/history/${encodeURIComponent(userId)}`, { method: 'DELETE' });
            const data = await res.json();
            if (data.success) {
                alert(`Deleted ${data.deletedCount} migrated record(s) for ${displayName}.`);
                await Store.syncWithBackend();
                this.renderMigrationHistory();
            } else {
                alert('Failed: ' + (data.message || 'Unknown error'));
            }
        } catch (err) {
            console.error('Clear migration error:', err);
            alert('Error connecting to backend.');
        }
    }
};

// Force Vite cache invalidation
console.log("AdminUI loaded successfully");
