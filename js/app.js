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
    let currentCalDate = new Date();

    // --- INIT ---
    function init() {
        Store.autoCheckoutMissing();
        
        if (Auth.isAuthenticated()) {
            currentUser = Auth.getCurrentUser();
            showApp();
        } else {
            showLogin();
        }
        startClock();
        
        // Single Day Toggle Init
        const singleDayToggle = document.getElementById('single-day-toggle');
        const halfDayToggle = document.getElementById('half-day-toggle');
        const endDateWrapper = document.getElementById('end-date-wrapper');
        const leaveEndInput = document.getElementById('leave-end');
        if (singleDayToggle) {
            singleDayToggle.addEventListener('change', (e) => {
                if (e.target.checked) {
                    endDateWrapper.classList.add('hidden');
                    leaveEndInput.removeAttribute('required');
                    if(halfDayToggle) halfDayToggle.disabled = false;
                } else {
                    endDateWrapper.classList.remove('hidden');
                    leaveEndInput.setAttribute('required', 'true');
                    if(halfDayToggle) {
                        halfDayToggle.checked = false;
                        halfDayToggle.disabled = true;
                    }
                }
            });
            // trigger init explicitly
            if (singleDayToggle.checked) {
                leaveEndInput.removeAttribute('required');
            } else if (halfDayToggle) {
                halfDayToggle.disabled = true;
            }
        }
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

        // Sync with backend, then render. If sync fails, still render from localStorage.
        Store.syncWithBackend()
            .catch(err => console.error('Sync failed, using local data:', err))
            .finally(() => {
                updateAttendanceUI();
                renderLeaveBalances();
                renderLeaveHistory();
                renderHolidays();
                renderUserCalendar();
            });
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
        if(targetId === 'tab-calendar') renderUserCalendar();
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
        
        mainActionBtn.classList.remove('check-in', 'check-out', 'completed', 'disabled');
        statusDot.classList.remove('unverified', 'verified', 'completed', 'warning', 'pending');
        mainActionBtn.style.pointerEvents = "auto";
        mainActionBtn.style.opacity = "1";
        
        if (!record) {
            // Not checked in yet
            statusText.textContent = "Not Checked In";
            statusDot.classList.add('unverified');
            
            mainActionBtn.classList.add('check-in');
            mainActionLabel.textContent = "Check In";
            
            attendanceDetails.classList.add('hidden');
        } else if (!record.checkOutTime) {
            // Checked in, not checked out
            statusText.textContent = _isWfhAttendanceStatus(record.status) ? "Working From Home" : "Working";
            statusDot.classList.add('verified');
            
            mainActionBtn.classList.add('check-out');
            mainActionLabel.textContent = "Check Out";
            
            attendanceDetails.classList.remove('hidden');
            valCheckIn.textContent = record.checkInTime;
            valCheckOut.textContent = "--:--";
        } else if (_isPendingAttendanceStatus(record.status)) {
            // Pending Early Checkout
            statusText.textContent = "Pending Approval";
            statusDot.classList.add('warning', 'pending');
            statusDot.style.background = "#f59e0b"; // Orange fallback
            
            mainActionBtn.classList.add('disabled');
            mainActionBtn.style.pointerEvents = "none";
            mainActionBtn.style.background = "#334155"; // Greyed out
            mainActionLabel.textContent = "Pending";
            
            attendanceDetails.classList.remove('hidden');
            valCheckIn.textContent = record.checkInTime;
            valCheckOut.textContent = record.checkOutTime;
        } else {
            // Checked out (day completed)
            statusText.textContent = _isWfhAttendanceStatus(record.status) ? "WFH Day Completed" : "Day Completed";
            statusDot.classList.add('completed');
            
            mainActionBtn.classList.add('completed');
            mainActionLabel.textContent = "Done";
            
            attendanceDetails.classList.remove('hidden');
            valCheckIn.textContent = record.checkInTime;
            valCheckOut.textContent = record.checkOutTime;
        }
    }

    function _isWfh(typeName) {
        if (!typeName) return false;
        const lower = typeName.toLowerCase();
        return lower.includes('wfh') || lower === 'work from home';
    }

    function _isWfhAttendanceStatus(status) {
        return typeof status === 'string' && status.startsWith('wfh_');
    }

    function _isPendingAttendanceStatus(status) {
        return status === 'pending_early_clockout' || status === 'wfh_pending_early_clockout';
    }

    function _calcDays(l) {
        if (l.isHalfDay || (l.type && l.type.toLowerCase().includes('(half day)'))) return 0.5;
        const diff = Math.abs(new Date(l.endDate) - new Date(l.startDate));
        return Math.ceil(diff / (1000 * 60 * 60 * 24)) + 1;
    }

    // Fuzzy match: 'Casual Leave (Half Day)' matches policy 'Casual Leave'
    function _matchesType(leaveType, policyName) {
        if (!leaveType || !policyName) return false;
        return leaveType === policyName || leaveType.startsWith(policyName);
    }

    function renderLeaveBalances() {
        const leaveTypes = Store.getLeaveTypes();
        const allUserLeaves = Store.getUserLeaves(currentUser.id);
        const approvedLeaves = allUserLeaves.filter(l => l.status === 'Approved');
        const extra = Store.getExtraOff(currentUser.id) || { leaves: 0, wfh: 0 };
        const now = new Date();
        const currMonthStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;

        // Populate the leave type dropdown (excluding WFH)
        const select = document.getElementById('leave-type');
        select.innerHTML = '';

        const grid = document.getElementById('user-balances-grid');
        grid.innerHTML = '';

        // --- Leave balance cards (excluding WFH) ---
        const nonWfhTypes = leaveTypes.filter(t => !_isWfh(t.name));
        nonWfhTypes.forEach(t => {
            select.innerHTML += `<option value="${t.name}">${t.name}</option>`;
            
            let used = 0;
            const relevant = approvedLeaves.filter(l => _matchesType(l.type, t.name));
            relevant.forEach(l => {
                if (t.cycle && t.cycle.toLowerCase() === 'monthly') {
                    if (l.startDate.startsWith(currMonthStr)) used += _calcDays(l);
                } else {
                    // Yearly: count current year only
                    if (new Date(l.startDate).getFullYear() === now.getFullYear()) used += _calcDays(l);
                }
            });

            const limit = parseInt(t.limit);
            const remaining = Math.max(0, limit - used);
            const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
            const barColor = pct > 80 ? '#ef4444' : pct > 50 ? '#f59e0b' : '#10b981';

            grid.innerHTML += `
                <div style="background:var(--glass-bg); border:1px solid var(--glass-border); border-radius:10px; padding:14px;">
                    <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
                        <strong style="font-size:13px;">${t.name}</strong>
                        <span style="font-size:12px; color:var(--text-muted);">${t.cycle || 'Yearly'}</span>
                    </div>
                    <div style="display:flex; justify-content:space-between; font-size:12px; color:var(--text-muted); margin-bottom:6px;">
                        <span>Used: <strong style="color:var(--text-main)">${used}</strong></span>
                        <span>Left: <strong style="color:${barColor}">${remaining}</strong> / ${limit}</span>
                    </div>
                    <div style="background:rgba(255,255,255,0.08); border-radius:4px; height:6px; overflow:hidden;">
                        <div style="width:${pct}%; height:100%; background:${barColor}; border-radius:4px; transition:width 0.3s;"></div>
                    </div>
                </div>
            `;
        });

        if (extra.leaves > 0) {
            grid.innerHTML += `
                <div style="background:var(--glass-bg); border:1px solid var(--glass-border); border-radius:10px; padding:14px;">
                    <strong style="font-size:13px;">Extra Leave Allowance</strong>
                    <div style="font-size:22px; font-weight:700; color:#10b981; margin-top:8px;">+${extra.leaves} days</div>
                </div>
            `;
        }

        // --- WFH Balance Card ---
        const wfhPolicy = leaveTypes.find(t => _isWfh(t.name));
        const wfhLimit = wfhPolicy ? parseInt(wfhPolicy.limit) : 0;
        const wfhCycle = wfhPolicy ? wfhPolicy.cycle : 'monthly';
        const wfhExtra = extra.wfh || 0;
        const isMonthly = wfhCycle === 'monthly' || wfhCycle === 'Monthly';

        let wfhUsed = 0;
        const wfhApproved = approvedLeaves.filter(l => _isWfh(l.type));
        wfhApproved.forEach(l => {
            if (isMonthly) {
                if (l.startDate.startsWith(currMonthStr)) wfhUsed += _calcDays(l);
            } else {
                if (new Date(l.startDate).getFullYear() === now.getFullYear()) wfhUsed += _calcDays(l);
            }
        });

        const wfhTotalLimit = wfhLimit + wfhExtra;
        const wfhRemaining = Math.max(0, wfhTotalLimit - wfhUsed);
        const wfhPct = wfhTotalLimit > 0 ? Math.min(100, (wfhUsed / wfhTotalLimit) * 100) : 0;
        const wfhBarColor = wfhPct > 80 ? '#ef4444' : wfhPct > 50 ? '#f59e0b' : '#3b82f6';
        const monthName = now.toLocaleString('default', { month: 'long' });

        const wfhAllTime = wfhApproved.reduce((a, l) => a + _calcDays(l), 0);

        const wfhDiv = document.getElementById('user-wfh-balance');
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
                    <div><span style="font-size:24px; font-weight:700; color:var(--text-muted);">${wfhTotalLimit}</span> <span style="font-size:12px; color:var(--text-muted);">limit</span></div>
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
    }

    // --- Filter state ---
    let _userReqFilter = 'all';

    function renderLeaveHistory(filterOverride) {
        const filter = filterOverride || _userReqFilter;
        _userReqFilter = filter;

        let leaves = Store.getUserLeaves(currentUser.id);

        // Apply filter
        if (filter === 'Pending' || filter === 'Approved' || filter === 'Rejected') {
            leaves = leaves.filter(l => l.status === filter);
        } else if (filter === 'wfh') {
            leaves = leaves.filter(l => _isWfh(l.type));
        } else if (filter === 'leave') {
            leaves = leaves.filter(l => !_isWfh(l.type));
        }

        // Update count
        const countEl = document.getElementById('user-req-count');
        if (countEl) countEl.textContent = `${leaves.length} request${leaves.length !== 1 ? 's' : ''}`;

        leaveHistoryList.innerHTML = '';
        
        if(leaves.length === 0) {
            leaveHistoryList.innerHTML = '<li style="color:var(--text-muted); font-size: 14px; text-align: center; padding: 20px;">No requests found.</li>';
            return;
        }
        
        leaves.forEach(leave => {
            const isW = _isWfh(leave.type);
            const days = _calcDays(leave);
            const catBadge = isW
                ? '<span class="badge" style="background:#3b82f6;color:white;font-size:10px;margin-left:6px;">WFH</span>'
                : '<span class="badge" style="background:#8b5cf6;color:white;font-size:10px;margin-left:6px;">Leave</span>';

            const li = document.createElement('li');
            li.className = 'history-card';
            li.innerHTML = `
                <div class="card-main">
                    <span class="card-title">${leave.type} ${catBadge} ${leave.isHalfDay ? '<span class="badge" style="background:var(--warning); color:white; font-size:10px; margin-left:6px;">Half Day</span>' : ''}</span>
                    <span class="card-sub">${leave.startDate}${leave.startDate !== leave.endDate ? ' → ' + leave.endDate : ''} <small style="color:var(--text-muted);">(${days} day${days!==1?'s':''})</small></span>
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

    // --- CALENDAR LOGIC ---
    function renderUserCalendar() {
        const year = currentCalDate.getFullYear();
        const month = currentCalDate.getMonth();
        const monthName = currentCalDate.toLocaleString('default', { month: 'long', year: 'numeric' });
        
        const titleEl = document.getElementById('user-cal-month-title');
        if(titleEl) titleEl.textContent = monthName;
        
        const calContainer = document.getElementById('user-calendar-grid');
        if(!calContainer) return;
        calContainer.innerHTML = '';
        
        const firstDay = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        
        const myLeaves = Store.getUserLeaves(currentUser.id).filter(l => l.status === 'Approved');
        const myAttendance = Store.getAttendance().filter(r => r.userId === currentUser.id);
        const holidays = Store.getHolidays();
        
        for(let i=0; i<firstDay; i++) {
            calContainer.innerHTML += `<div class="calendar-day empty"></div>`;
        }
        
        for(let day=1; day <= daysInMonth; day++) {
            const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
            const isOnLeave = myLeaves.some(l => l.startDate <= dateStr && l.endDate >= dateStr);
            const attendanceRecord = myAttendance.find(a => a.date === dateStr);
            const holiday = holidays.find(h => h.date === dateStr);
            
            let badgesHTML = '';
            if (isOnLeave) {
                const leaveRecord = myLeaves.find(l => l.startDate <= dateStr && l.endDate >= dateStr);
                const isOpt = leaveRecord.type === 'Optional Holiday';
                const isWfh = leaveRecord.type?.toLowerCase().includes('wfh') || leaveRecord.type?.toLowerCase().includes('work from home');
                let badgeClass = '';
                if(isOpt) badgeClass = 'opt';
                else if(isWfh) badgeClass = 'wfh';
                
                badgesHTML += `<div class="cal-leave-badge ${badgeClass}">${leaveRecord.type} ${leaveRecord.isHalfDay ? '(Half)' : ''}</div>`;
            } else if (holiday && holiday.type !== 'Optional') {
                badgesHTML += `<div class="cal-leave-badge holiday">${holiday.name}</div>`;
            } else if (attendanceRecord) {
                if (attendanceRecord.checkOutTime) {
                    badgesHTML += `<div class="cal-leave-badge present">Present</div>`;
                } else {
                    badgesHTML += `<div class="cal-leave-badge working">Working</div>`;
                }
            } else if (new Date(dateStr) < new Date(getTodayDateString()) && new Date(dateStr).getDay() !== 0 && new Date(dateStr).getDay() !== 6) {
                badgesHTML += `<div class="cal-leave-badge absent">Absent</div>`;
            }
            
            // Mark Sundays for User Calendar too
            if (new Date(year, month, day).getDay() === 0) {
                badgesHTML += `<div class="cal-leave-badge holiday">Sunday</div>`;
            }
            
            const isTodayStr = (dateStr === getTodayDateString()) ? ' today' : '';

            calContainer.innerHTML += `
                <div class="calendar-day${isTodayStr}">
                    <div class="cal-date">${day}</div>
                    <div class="cal-badges">${badgesHTML}</div>
                </div>
            `;
        }
    }

    // --- EVENT LISTENERS ---

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('username').value; // email
        const pass = document.getElementById('password').value;
        
        const loginBtn = loginForm.querySelector('button[type="submit"]');
        const origText = loginBtn.textContent;
        loginBtn.textContent = 'Connecting to Kitsu...';
        loginBtn.disabled = true;

        const success = await Auth.login(id, pass);
        
        loginBtn.textContent = origText;
        loginBtn.disabled = false;

        if (success) {
            currentUser = Auth.getCurrentUser();
            showApp();
        } else {
            const errBox = document.getElementById('login-error');
            errBox.textContent = 'Invalid credentials or Server error. Check console for details.';
            errBox.style.display = 'block';
            errBox.classList.remove('hidden');
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

    // Request history filter buttons
    document.querySelectorAll('.user-req-filter').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.user-req-filter').forEach(b => {
                b.classList.remove('active', 'btn-primary');
                b.classList.add('btn-neutral');
            });
            btn.classList.add('active', 'btn-primary');
            btn.classList.remove('btn-neutral');
            renderLeaveHistory(btn.dataset.filter);
        });
    });

    document.getElementById('user-cal-prev-btn')?.addEventListener('click', () => {
        currentCalDate.setMonth(currentCalDate.getMonth() - 1);
        renderUserCalendar();
    });
    
    document.getElementById('user-cal-next-btn')?.addEventListener('click', () => {
        currentCalDate.setMonth(currentCalDate.getMonth() + 1);
        renderUserCalendar();
    });

    mainActionBtn.addEventListener('click', async () => {
        const todayStr = getTodayDateString();
        const timeStr = getCurrentTimeString();
        const record = Store.getAttendanceToday(currentUser.id, todayStr);
        
        if (!record) {
            // Check In
            const myLeaves = Store.getUserLeaves(currentUser.id).filter(l => l.status === 'Approved');
            const isWfhToday = myLeaves.some(l => _isWfh(l.type) && l.startDate <= todayStr && l.endDate >= todayStr);
            Store.addAttendance({
                userId: currentUser.id,
                date: todayStr,
                checkInTime: timeStr,
                checkOutTime: null,
                status: isWfhToday ? 'wfh_working' : 'working'
            });
            updateAttendanceUI();
            
            // Subtle animation effect
            mainActionBtn.style.transform = "scale(0.9)";
            setTimeout(() => mainActionBtn.style.transform = "none", 150);
            
        } else if (!record.checkOutTime || record.status === 'working' || record.status === 'wfh_working') {
            // Check Out
            
            // Disable button to prevent double-clicks
            const originalLabel = mainActionLabel.textContent;
            mainActionLabel.textContent = "Processing...";
            mainActionBtn.style.pointerEvents = "none";
            mainActionBtn.style.opacity = "0.7";

            // Local Calculation
            const now = new Date();
            // Parse checkInTime (e.g. "10:15", "09:30 PM")
            const inTimeParts = record.checkInTime.match(/(\d+):(\d+)\s*([a-zA-Z]*)/);
            let checkInDate = new Date();
            if (inTimeParts) {
                let hrs = parseInt(inTimeParts[1], 10);
                const mins = parseInt(inTimeParts[2], 10);
                const ampm = inTimeParts[3]?.toLowerCase();
                if (ampm === 'pm' && hrs < 12) hrs += 12;
                if (ampm === 'am' && hrs === 12) hrs = 0;
                checkInDate.setHours(hrs, mins, 0, 0);
            }
            const hoursWorked = (now - checkInDate) / (1000 * 60 * 60);

            if (hoursWorked < 4) {
               if(!confirm("You've worked less than 4 hours. Proceeding will automatically log a Half-Day Leave request for today. Continue?")) {
                   mainActionLabel.textContent = originalLabel;
                   mainActionBtn.style.pointerEvents = "auto";
                   mainActionBtn.style.opacity = "1";
                   return;
               }
            } else if (hoursWorked < 8) {
               if(!confirm("You've worked less than 8 hours. Checking out will require Admin Approval. Continue?")) {
                   mainActionLabel.textContent = originalLabel;
                   mainActionBtn.style.pointerEvents = "auto";
                   mainActionBtn.style.opacity = "1";
                   return;
               }
            }
            
            record.checkOutTime = timeStr;
            await Store.updateAttendance(record);
            
            // Restore button properties (UI update will overwrite)
            mainActionBtn.style.pointerEvents = "auto";
            mainActionBtn.style.opacity = "1";
            
            // Re-fetch store cleanly to grab the newly assigned status from the backend
            await Store.syncWithBackend();
            updateAttendanceUI();
        }
    });

    document.querySelectorAll('input[name="reqType"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            document.getElementById('leave-type-group').style.display = e.target.value === 'WFH' ? 'none' : 'flex';
            document.getElementById('leave-type').required = e.target.value === 'Leave';
        });
    });

    document.getElementById('apply-leave-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const reqVal = document.querySelector('input[name="reqType"]:checked').value;
        const type = reqVal === 'WFH' ? 'Work From Home' : document.getElementById('leave-type').value;
        
        const startStr = document.getElementById('leave-start').value;
        const endStr = document.getElementById('leave-end').value;
        const reason = document.getElementById('leave-reason').value;
        const isSingleDay = document.getElementById('single-day-toggle')?.checked;
        const isHalfDay = document.getElementById('half-day-toggle')?.checked;
        
        let start = startStr;
        let end = endStr;

        if (isSingleDay) {
            end = start;
        }
        
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
            status: 'Pending',
            isHalfDay: isHalfDay
        });

        e.target.reset();
        renderLeaveHistory();
        renderLeaveBalances();
        
        // Form submit feedback
        const btn = e.target.querySelector('button[type="submit"]');
        const origText = btn.textContent;
        btn.textContent = "Request Sent ✓";
        btn.style.background = "var(--success)";
        setTimeout(() => {
            btn.textContent = origText;
            btn.style.background = "";
        }, 2000);
    });

    // Expose refresh function for Socket.IO live updates
    window.refreshAttendanceUI = async function() {
        await Store.syncWithBackend();
        updateAttendanceUI();
    };
    // --- Realtime / Auto-Refresh Logic ---
    let lastLoadedDate = new Date().toDateString();
    
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
            const today = new Date().toDateString();
            if (today !== lastLoadedDate) {
                console.log("[App] Date changed overnight. Reloading application...");
                window.location.reload();
            } else {
                // If it's the same day, just pull latest updates in case we missed a socket event
                if (window.refreshAttendanceUI) {
                    window.refreshAttendanceUI();
                }
            }
        }
    });

    // Run init
    init();
});
