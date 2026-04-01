// admin.js
window.AdminUI = {
    currentUser: null,
    currentCalDate: new Date(),
    
    init: function(user) {
        this.currentUser = user;
        document.getElementById('admin-greeting').textContent = 'Hello, ' + user.name;
        this.setupEventListeners();
        this.renderDashboard();
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

        // Add Holiday
        const addHoli = document.getElementById('add-holiday-btn');
        if(addHoli) addHoli.addEventListener('click', () => {
            const date = prompt("Enter Date (YYYY-MM-DD):", "2026-06-01");
            if(!date) return;
            const name = prompt("Enter Holiday Name:");
            if(!name) return;
            const isOptional = confirm("Is this an OPTIONAL holiday? (Press OK for Yes, Cancel for No)");
            
            Store.addHoliday({ date, name, type: isOptional ? 'Optional' : 'Public' });
            this.renderHolidays();
        });

        // Logout
        document.getElementById('admin-logout-btn').addEventListener('click', () => {
            Auth.logout();
            window.location.reload();
        });

        // User Modal
        const userModal = document.getElementById('admin-user-modal');
        const addUserBtn = document.getElementById('add-user-btn');
        if(addUserBtn) addUserBtn.addEventListener('click', () => {
            document.getElementById('admin-user-form').reset();
            userModal.classList.remove('hidden');
        });
        
        const cnlBtn = document.getElementById('modal-user-cancel');
        if(cnlBtn) cnlBtn.addEventListener('click', () => userModal.classList.add('hidden'));
        
        const formEl = document.getElementById('admin-user-form');
        if(formEl) formEl.addEventListener('submit', (e) => {
            e.preventDefault();
            const id = document.getElementById('modal-user-id').value;
            const name = document.getElementById('modal-user-name').value;
            const pass = document.getElementById('modal-user-pass').value;
            const role = document.getElementById('modal-user-role').value;
            
            Store.addUser({ id, name, role, password: pass });
            userModal.classList.add('hidden');
            this.renderUsers();
            this.renderDashboard();
        });
    },
    
    getTodayStr: function() {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    },

    renderDashboard: function() {
        const today = this.getTodayStr();
        const allUsers = Store.getAllUsers().filter(u => u.role === 'user');
        const presentTodayData = Store.getAllAttendanceToday(today);
        
        let presentCount = presentTodayData.length;
        document.getElementById('stat-present').textContent = `${presentCount} / ${allUsers.length}`;
        
        const allLeaves = Store.getAllLeaves();
        const pendingCount = allLeaves.filter(l => l.status === 'Pending').length;
        document.getElementById('stat-pending').textContent = pendingCount;
        
        // Render Table
        const tbody = document.getElementById('live-attendance-tbody');
        tbody.innerHTML = '';
        
        allUsers.forEach(user => {
            const record = presentTodayData.find(r => r.userId === user.id);
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
            const isUserOnLeave = allLeaves.some(l => l.userId === user.id && l.status === 'Approved' && l.startDate <= today && l.endDate >= today);
            if(isUserOnLeave && !record) {
                statusBadge = '<span class="badge" style="background:#3b82f6;color:white;">On Leave</span>';
            }

            tr.innerHTML = `
                <td><strong>${user.name}</strong><br><small style="color:var(--text-muted)">${user.id}</small></td>
                <td>${statusBadge}</td>
                <td>${checkIn}</td>
                <td>${checkOut}</td>
            `;
            tbody.appendChild(tr);
        });
    },

    renderLeaves: function() {
        const leaves = Store.getAllLeaves();
        const list = document.getElementById('admin-leaves-list');
        list.innerHTML = '';
        
        if(leaves.length === 0) {
            list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted)">No leaves found.</div>';
            return;
        }
        
        leaves.forEach(l => {
            const user = Store.getUserById(l.userId);
            const div = document.createElement('div');
            div.className = 'history-card';
            div.style.marginBottom = '12px';
            
            let actions = '';
            if(l.status === 'Pending') {
                actions = `
                    <div class="action-row" style="margin-top:10px;">
                        <button class="btn-small btn-approve" onclick="window.AdminUI.updateLeave('${l.id}', 'Approved')">Approve</button>
                        <button class="btn-small btn-reject" onclick="window.AdminUI.updateLeave('${l.id}', 'Rejected')">Reject</button>
                    </div>
                `;
            }
            
            div.innerHTML = `
                <div style="flex:1">
                    <div style="display:flex; justify-content:space-between;">
                        <span class="card-title">${user ? user.name : l.userId} <span style="font-weight:400; color:var(--text-muted);">(${l.type})</span></span>
                        <span class="badge ${l.status.toLowerCase()}">${l.status}</span>
                    </div>
                    <div class="card-sub" style="margin-top:6px;">Dates: ${l.startDate} to ${l.endDate}</div>
                    <div class="card-sub" style="margin-top:4px;">Reason: ${l.reason}</div>
                    ${actions}
                </div>
            `;
            list.appendChild(div);
        });
    },

    updateLeave: function(leaveId, status) {
        Store.updateLeaveStatus(leaveId, status);
        this.renderLeaves();
        this.renderDashboard(); // refresh stats
    },

    renderUsers: function() {
        const users = Store.getAllUsers();
        const tbody = document.getElementById('admin-users-tbody');
        tbody.innerHTML = '';
        
        users.forEach(u => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${u.id}</td>
                <td><strong>${u.name}</strong></td>
                <td><span class="badge" style="background: ${u.role==='admin'?'var(--primary)':'rgba(255,255,255,0.1)'}; color: ${u.role==='admin'?'white':'var(--text-main)'}">${u.role.toUpperCase()}</span></td>
                <td>
                    ${u.id === this.currentUser.id ? '<span style="color:var(--text-muted);font-size:12px">Current User</span>' : `<button class="btn-small btn-reject" onclick="window.AdminUI.deleteUser('${u.id}')">Remove</button>`}
                </td>
            `;
            tbody.appendChild(tr);
        });
    },

    deleteUser: function(id) {
        if(confirm(`Are you sure you want to remove user: ${id}?`)) {
            Store.deleteUser(id);
            this.renderUsers();
            this.renderDashboard();
        }
    },

    renderPolicies: function() {
        const types = Store.getLeaveTypes();
        const tbody = document.getElementById('admin-policies-tbody');
        if(!tbody) return;
        tbody.innerHTML = '';
        
        types.forEach(t => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${t.name}</strong></td>
                <td>${t.limit} days</td>
                <td>${t.cycle}</td>
                <td>
                    <button class="btn-small btn-primary" onclick="window.AdminUI.editLeaveLimit('${t.id}', '${t.name}', ${t.limit})">Edit Limit</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    },

    editLeaveLimit: function(id, name, oldLimit) {
        const newLim = prompt(`Enter new limit for ${name} (currently ${oldLimit}):`, oldLimit);
        if(newLim && !isNaN(newLim)) {
            Store.updateLeaveTypeLimit(id, parseInt(newLim, 10));
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
        const users = Store.getAllUsers();
        
        for(let i=0; i<firstDay; i++) {
            calContainer.innerHTML += `<div class="calendar-day empty"></div>`;
        }
        
        for(let day=1; day <= daysInMonth; day++) {
            const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
            const folksOnLeave = allLeaves.filter(l => l.startDate <= dateStr && l.endDate >= dateStr);
            
            let badgesHTML = '';
            folksOnLeave.forEach(leave => {
                const user = users.find(u => u.id === leave.userId);
                const name = user ? user.name.split(' ')[0] : leave.userId;
                const isOpt = leave.type === 'Optional Holiday';
                badgesHTML += `<div class="cal-leave-badge ${isOpt ? 'opt' : ''}">${name}</div>`;
            });
            
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
                    <button class="btn-small btn-reject" onclick="window.AdminUI.deleteHoliday('${h.date}')">Remove</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    },

    deleteHoliday: function(dateStr) {
        if(confirm(`Remove holiday on ${dateStr}?`)) {
            Store.deleteHoliday(dateStr);
            this.renderHolidays();
        }
    }
};
