// admin.js
window.AdminUI = {
    currentUser: null,
    currentCalDate: new Date(),
    kitsuPersons: [],
    attendanceChartInstance: null,
    
    init: function(user) {
        try {
            Store.autoCheckoutMissing();
            
            this.currentUser = user;
            
            this.syncKitsuUsers();

            document.getElementById('admin-greeting').textContent = 'Hello, ' + user.name;
            this.setupEventListeners();
            this.renderDashboard();
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
        
        const presentCount = attendance.length;
        const activePersons = this.kitsuPersons.filter(p => p.active);
        const totalUsers = activePersons.length > 0 ? activePersons.length : '-';
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

        // 1. Render Main Chart
        const absentCount = totalUsers !== '-' ? Math.max(0, totalUsers - presentCount - onLeaveCount - wfhCount) : 0;
        const ctx = document.getElementById('attendanceChart');
        if(ctx && totalUsers !== '-') {
            try {
                if(window.AdminUI.attendanceChartInstance) {
                    window.AdminUI.attendanceChartInstance.destroy();
                }
                window.AdminUI.attendanceChartInstance = new Chart(ctx, {
                    type: 'doughnut',
                    data: {
                        labels: ['Office', 'WFH', 'On Leave', 'Absent'],
                        datasets: [{
                            data: [presentCount, wfhCount, onLeaveCount, absentCount],
                            backgroundColor: ['#10b981', '#3b82f6', '#8b5cf6', '#ef4444'],
                            borderWidth: 0
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: { position: 'right', labels: { color: '#e2e8f0', usePointStyle: true } }
                        }
                    }
                });
            } catch(e) { console.error("Chart error:", e); }
        }

        // 2. Trend Chart (7 days)
        const trendCtx = document.getElementById('trendChart');
        if(trendCtx && totalUsers !== '-') {
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
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#e2e8f0'} } }, scales: { y: { beginAtZero: true, ticks: {color: '#94a3b8', stepSize:1}, grid:{color:'rgba(255,255,255,0.05)'} }, x: { ticks: {color: '#94a3b8'}, grid:{color:'rgba(255,255,255,0.05)'} } } }
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
                options: { responsive:true, maintainAspectRatio:false, plugins: { legend: { position: 'right', labels: {color: '#e2e8f0', usePointStyle: true} } } }
            });
        }

        // 4. Top Takers
        const takersCtx = document.getElementById('topTakersChart');
        if(takersCtx && totalUsers !== '-') {
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
                options: { indexAxis: 'y', responsive:true, maintainAspectRatio:false, plugins: { legend: { display:false } }, scales: { y: { ticks: {color: '#94a3b8'}, grid:{display:false} }, x: { ticks: {color: '#94a3b8', stepSize:1}, grid:{color:'rgba(255,255,255,0.05)'} } } }
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
                        <span style="font-size:12px; margin-right:8px; color:var(--text-muted);">${extraText}</span>
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
    }
};

// Force Vite cache invalidation
console.log("AdminUI loaded successfully");
