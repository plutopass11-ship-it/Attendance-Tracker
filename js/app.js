// app.js
document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const loginView = document.getElementById('login-view');
    const appView = document.getElementById('app-view');
    const loginForm = document.getElementById('login-form');
    const loginError = document.getElementById('login-error');
    const logoutBtn = document.getElementById('logout-btn');
    const userNameEl = document.getElementById('user-name');
    const userInitialEl = document.getElementById('user-initial');
    
    // Tabs
    const tabs = document.querySelectorAll('.tab-content');
    const navItems = document.querySelectorAll('.nav-item');
    
    // Attendance Elements
    const currentTimeEl = document.getElementById('current-time');
    const currentDateEl = document.getElementById('current-date');
    const statusText = document.getElementById('attendance-status-text');
    const statusDot = document.getElementById('attendance-status-dot');
    const mainActionBtn = document.getElementById('main-action-btn');
    const mainActionLabel = document.getElementById('main-action-label');
    const attendanceDetails = document.getElementById('attendance-details');
    const valCheckIn = document.getElementById('val-check-in');
    const valCheckOut = document.getElementById('val-check-out');
    
    // Leaves Elements
    const leaveForm = document.getElementById('leave-form');
    const leaveHistoryList = document.getElementById('leave-history-list');
    
    // Holidays Element
    const publicHolidaysList = document.getElementById('public-holidays-list');
    const optionalHolidaysList = document.getElementById('optional-holidays-list');
    const optionalQuotaText = document.getElementById('optional-quota-text');

    // State
    let currentUser = null;
    let timerInterval = null;

    // --- INIT ---
    function init() {
        if (Auth.isAuthenticated()) {
            currentUser = Auth.getCurrentUser();
            showApp();
        } else {
            showLogin();
        }
        startClock();
    }

    // --- NAVIGATION ---
    function showLogin() {
        loginView.classList.remove('hidden');
        appView.classList.add('hidden');
    }

    function showApp() {
        loginView.classList.add('hidden');
        appView.classList.remove('hidden');
        
        // Setup User Info
        userNameEl.textContent = currentUser.name;
        userInitialEl.textContent = currentUser.name.charAt(0).toUpperCase();

        // Admin check
        if(currentUser.role === 'admin') {
            appView.classList.add('hidden');
            document.getElementById('admin-view').classList.remove('hidden');
            if(window.AdminUI) window.AdminUI.init(currentUser);
            return;
        }

        // Initialize Tabs Data
        updateAttendanceUI();
        renderLeaveBalances();
        renderLeaveHistory();
        renderHolidays();
    }

    function switchTab(targetId) {
        // Update Nav UI
        navItems.forEach(nav => {
            if(nav.dataset.target === targetId) nav.classList.add('active');
            else nav.classList.remove('active');
        });
        
        // Update Content
        tabs.forEach(tab => {
            if(tab.id === targetId) tab.classList.add('active');
            else tab.classList.remove('active');
        });
        
        if(targetId === 'tab-attendance') updateAttendanceUI();
        if(targetId === 'tab-leaves') renderLeaveHistory();
        if(targetId === 'tab-holidays') renderHolidays();
    }

    // --- CLOCK ---
    function startClock() {
        if (timerInterval) clearInterval(timerInterval);
        const updateTime = () => {
            const now = new Date();
            currentTimeEl.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            currentDateEl.textContent = now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
        };
        updateTime();
        timerInterval = setInterval(updateTime, 60000); // update every minute
    }

    // --- ATTENDANCE LOGIC ---
    function getTodayDateString() {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    }

    function getCurrentTimeString() {
        const now = new Date();
        return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    function updateAttendanceUI() {
        const todayStr = getTodayDateString();
        const record = Store.getAttendanceToday(currentUser.id, todayStr);
        
        mainActionBtn.classList.remove('check-in', 'check-out', 'completed');
        statusDot.classList.remove('unverified', 'verified', 'completed');
        
        if (!record) {
            // Not checked in yet
            statusText.textContent = "Not Checked In";
            statusDot.classList.add('unverified');
            
            mainActionBtn.classList.add('check-in');
            mainActionLabel.textContent = "Check In";
            
            attendanceDetails.classList.add('hidden');
        } else if (!record.checkOutTime) {
            // Checked in, not checked out
            statusText.textContent = "Working";
            statusDot.classList.add('verified');
            
            mainActionBtn.classList.add('check-out');
            mainActionLabel.textContent = "Check Out";
            
            attendanceDetails.classList.remove('hidden');
            valCheckIn.textContent = record.checkInTime;
            valCheckOut.textContent = "--:--";
        } else {
            // Checked out (day completed)
            statusText.textContent = "Day Completed";
            statusDot.classList.add('completed');
            
            mainActionBtn.classList.add('completed');
            mainActionLabel.textContent = "Done";
            
            attendanceDetails.classList.remove('hidden');
            valCheckIn.textContent = record.checkInTime;
            valCheckOut.textContent = record.checkOutTime;
        }
    }

    // --- LEAVE LOGIC ---
    function renderLeaveBalances() {
        const types = Store.getLeaveTypes();
        const userLeaves = Store.getUserLeaves(currentUser.id).filter(l => l.status === 'Approved');
        
        const select = document.getElementById('leave-type');
        select.innerHTML = '';
        
        const grid = document.getElementById('user-balances-grid');
        grid.innerHTML = '';

        const now = new Date();
        const currMonthStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;

        types.forEach(t => {
            select.innerHTML += `<option value="${t.name}">${t.name}</option>`;
            
            let taken = 0;
            const relevantLeaves = userLeaves.filter(l => l.type === t.name);
            
            relevantLeaves.forEach(l => {
                const sDate = new Date(l.startDate);
                const eDate = new Date(l.endDate);
                
                if(t.cycle === 'Monthly') {
                    if (l.startDate.startsWith(currMonthStr)) taken += 1;
                } else {
                    const diffTimes = eDate - sDate;
                    const diffDays = Math.ceil(diffTimes / (1000 * 60 * 60 * 24)) + 1;
                    taken += diffDays;
                }
            });
            
            const remaining = Math.max(0, t.limit - taken);
            
            grid.innerHTML += `
                <div class="glass-panel" style="padding:12px; text-align:center;">
                    <div style="font-size:11px; color:var(--text-muted); margin-bottom:4px;">${t.name}</div>
                    <div style="font-size:18px; font-weight:700; color: ${remaining>0 ? 'var(--text-main)' : 'var(--danger)'}">
                        ${remaining} <span style="font-size:12px; font-weight:400; color:var(--text-muted)">/ ${t.limit}</span>
                    </div>
                </div>
            `;
        });
    }

    function renderLeaveHistory() {
        const leaves = Store.getUserLeaves(currentUser.id);
        leaveHistoryList.innerHTML = '';
        
        if(leaves.length === 0) {
            leaveHistoryList.innerHTML = '<li style="color:var(--text-muted); font-size: 14px; text-align: center; padding: 20px;">No leave requests.</li>';
            return;
        }
        
        leaves.forEach(leave => {
            const li = document.createElement('li');
            li.className = 'history-card';
            li.innerHTML = `
                <div class="card-main">
                    <span class="card-title">${leave.type}</span>
                    <span class="card-sub">${leave.startDate} to ${leave.endDate}</span>
                </div>
                <span class="badge ${leave.status.toLowerCase()}">${leave.status}</span>
            `;
            leaveHistoryList.appendChild(li);
        });
    }

    // --- HOLIDAYS LOGIC ---
    // Expose claim Optional function to global scope for inline onclicks
    window.claimOptionalHoliday = function(dateStr, nameStr) {
        const hDate = new Date(dateStr);
        const today = new Date();
        const diffDays = (hDate - today) / (1000 * 60 * 60 * 24);
        
        if (diffDays < 2) {
            alert('Cannot claim! Optional holidays must be claimed at least 2 days in advance.');
            return;
        }

        if (Store.getRemainingQuota(currentUser.id) <= 0) {
            alert('You have no Optional Holiday quota remaining.');
            return;
        }

        if(confirm(`Claim ${nameStr} as an Optional Holiday?`)) {
            Store.claimOptionalHoliday(currentUser.id, { date: dateStr, name: nameStr });
            alert('Successfully claimed! Added to your approved leaves.');
            renderHolidays();
            renderLeaveHistory();
        }
    };

    function renderHolidays() {
        const holidays = Store.getHolidays();
        publicHolidaysList.innerHTML = '';
        optionalHolidaysList.innerHTML = '';
        
        const quota = Store.getRemainingQuota(currentUser.id);
        optionalQuotaText.textContent = `${quota}/3 Remaining`;

        holidays.forEach(h => {
            const isOptional = h.type === 'Optional';
            
            const dateObj = new Date(h.date);
            const mon = dateObj.toLocaleString('default', { month: 'short' });
            const day = dateObj.getDate();
            
            const div = document.createElement('div');
            div.className = 'holiday-card';
            
            let btnHtml = '';
            if (isOptional) {
                // Check if already claimed
                const leaves = Store.getUserLeaves(currentUser.id);
                const isClaimed = leaves.some(l => l.startDate === h.date && l.type === 'Optional Holiday');
                
                if(isClaimed) {
                    btnHtml = '<span class="badge" style="background:var(--success); color:white">Claimed</span>';
                } else if(quota > 0) {
                    btnHtml = `<button class="btn-primary" style="padding:6px 12px; margin:0; width:auto; font-size:12px;" onclick="window.claimOptionalHoliday('${h.date}', '${h.name}')">Claim</button>`;
                } else {
                    btnHtml = '<span style="font-size:12px; color:var(--text-muted)">Quota Full</span>';
                }
            }

            div.innerHTML = `
                <div class="holiday-date">
                    <span class="day">${day}</span>
                    <span class="mon">${mon}</span>
                </div>
                <div class="card-main" style="flex:1">
                    <span class="card-title">${h.name}</span>
                    <span class="card-sub">${dateObj.toLocaleString('en-US', { weekday: 'long' })}</span>
                </div>
                ${btnHtml}
            `;
            
            if (isOptional) {
                optionalHolidaysList.appendChild(div);
            } else {
                publicHolidaysList.appendChild(div);
            }
        });
        
        if(optionalHolidaysList.innerHTML === '') {
            optionalHolidaysList.innerHTML = '<div style="color:var(--text-muted); font-size: 14px; text-align: center; padding: 10px;">No optional holidays available.</div>';
        }
    }

    // --- EVENT LISTENERS ---
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const userId = document.getElementById('username').value;
        const pass = document.getElementById('password').value;
        
        if(await Auth.login(userId, pass)) {
            loginError.textContent = '';
            init(); // Reinitialize with auth
            document.getElementById('password').value = '';
        } else {
            loginError.textContent = 'Invalid User ID or Password';
        }
    });

    logoutBtn.addEventListener('click', () => {
        Auth.logout();
        currentUser = null;
        showLogin();
    });

    navItems.forEach(nav => {
        nav.addEventListener('click', () => {
            switchTab(nav.dataset.target);
        });
    });

    mainActionBtn.addEventListener('click', () => {
        const todayStr = getTodayDateString();
        const timeStr = getCurrentTimeString();
        const record = Store.getAttendanceToday(currentUser.id, todayStr);
        
        if (!record) {
            // Check In
            Store.addAttendance({
                userId: currentUser.id,
                date: todayStr,
                checkInTime: timeStr,
                checkOutTime: null
            });
            updateAttendanceUI();
            
            // Subtle animation effect
            mainActionBtn.style.transform = "scale(0.9)";
            setTimeout(() => mainActionBtn.style.transform = "none", 150);
            
        } else if (!record.checkOutTime) {
            // Check Out
            record.checkOutTime = timeStr;
            Store.updateAttendance(record);
            updateAttendanceUI();
        }
    });

    leaveForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const start = document.getElementById('leave-start').value;
        const end = document.getElementById('leave-end').value;
        const type = document.getElementById('leave-type').value;
        const reason = document.getElementById('leave-reason').value;
        
        if (new Date(start) > new Date(end)) {
            alert('End date cannot be before start date.');
            return;
        }

        Store.addLeaveRequest({
            userId: currentUser.id,
            type: type,
            startDate: start,
            endDate: end,
            reason: reason,
            status: 'Pending'
        });

        leaveForm.reset();
        renderLeaveHistory();
        
        // Form submit feedback
        const btn = leaveForm.querySelector('button');
        const origText = btn.textContent;
        btn.textContent = "Request Sent ✓";
        btn.style.background = "var(--success)";
        setTimeout(() => {
            btn.textContent = origText;
            btn.style.background = "";
        }, 2000);
    });

    // Run init
    init();
});
