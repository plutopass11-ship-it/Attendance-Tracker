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
        const adminView = document.getElementById('admin-view');
        if (loginView) loginView.classList.remove('hidden');
        if (appView) appView.classList.add('hidden');
        if (adminView) adminView.classList.add('hidden');
    }

    function showApp() {
        if (!currentUser) return;
        
        const adminView = document.getElementById('admin-view');

        if (loginView) loginView.classList.add('hidden');

        // Admin check first
        if (currentUser.role === 'admin') {
            if (appView) appView.classList.add('hidden');
            if (adminView) adminView.classList.remove('hidden');
            if (window.AdminUI) window.AdminUI.init(currentUser);
            return;
        }

        // Employee view: ALWAYS hide adminView and show appView
        if (adminView) adminView.classList.add('hidden');
        if (appView) appView.classList.remove('hidden');
        
        // Setup User Info safely
        if (userNameEl) userNameEl.textContent = currentUser.name;
        if (userInitialEl) userInitialEl.textContent = (currentUser.name || 'U').charAt(0).toUpperCase();

        const roleDeptEl = document.getElementById('user-role-dept');
        if (roleDeptEl) roleDeptEl.textContent = currentUser.department ? `Flying Pluto Studios · ${currentUser.department}` : 'Flying Pluto Studios · Team';

        startClock();

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
        const allNavs = document.querySelectorAll('.bottom-nav .nav-item, .nav-item');
        const allTabs = document.querySelectorAll('.tab-content');

        allNavs.forEach(nav => {
            if (nav.dataset.target === targetId) nav.classList.add('active');
            else nav.classList.remove('active');
        });
        
        allTabs.forEach(tab => {
            if (tab.id === targetId) {
                tab.classList.add('active');
                tab.style.display = 'block';
            } else {
                tab.classList.remove('active');
                tab.style.display = 'none';
            }
        });
        
        if (targetId === 'tab-attendance') updateAttendanceUI();
        if (targetId === 'tab-calendar') renderUserCalendar();
        if (targetId === 'tab-leaves') {
            renderLeaveBalances();
            renderLeaveHistory();
        }
        if (targetId === 'tab-holidays') renderHolidays();
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
        
        mainActionBtn.className = 'punch-circle-btn';
        if (statusText) statusText.className = 'status-pill';
        mainActionBtn.style.pointerEvents = "auto";
        mainActionBtn.style.opacity = "1";
        
        if (!record) {
            // Not checked in yet
            if (statusText) {
                statusText.textContent = "Not Checked In";
                statusText.className = 'status-pill pill-late';
            }
            
            mainActionBtn.classList.add('punch-in');
            mainActionLabel.textContent = "Check In";
            
            attendanceDetails.classList.add('hidden');
        } else if (!record.checkOutTime) {
            // Checked in, not checked out
            const isWfh = _isWfhAttendanceStatus(record.status);
            if (statusText) {
                statusText.textContent = isWfh ? "WFH Remote Active" : "In Office Working";
                statusText.className = isWfh ? 'status-pill pill-wfh' : 'status-pill pill-active';
            }
            
            mainActionBtn.classList.add('punch-out');
            mainActionLabel.textContent = "Check Out";
            
            attendanceDetails.classList.remove('hidden');
            valCheckIn.textContent = record.checkInTime;
            valCheckOut.textContent = "--:--";
        } else if (_isPendingAttendanceStatus(record.status)) {
            // Pending Early Checkout
            if (statusText) {
                statusText.textContent = "Pending Early Clockout Approval";
                statusText.className = 'status-pill pill-late';
            }
            
            mainActionBtn.classList.add('punch-in');
            mainActionBtn.style.pointerEvents = "none";
            mainActionBtn.style.background = "#1a1e27";
            mainActionBtn.style.color = "var(--text-tertiary)";
            mainActionLabel.textContent = "Pending";
            
            attendanceDetails.classList.remove('hidden');
            valCheckIn.textContent = record.checkInTime;
            valCheckOut.textContent = record.checkOutTime;
        } else {
            // Checked out (day completed)
            const isWfh = _isWfhAttendanceStatus(record.status);
            if (statusText) {
                statusText.textContent = isWfh ? "WFH Completed" : "Shift Completed";
                statusText.className = 'status-pill pill-completed';
            }
            
            mainActionBtn.classList.add('punch-in');
            mainActionBtn.style.pointerEvents = "none";
            mainActionBtn.style.background = "#1a1e27";
            mainActionBtn.style.color = "var(--text-tertiary)";
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
        if (!currentUser) currentUser = Auth.getCurrentUser();
        if (!currentUser) return;
        const leaveTypes = Store.getLeaveTypes();
        const allUserLeaves = Store.getUserLeaves(currentUser.id);
        const approvedLeaves = allUserLeaves.filter(l => l.status === 'Approved');
        const extra = Store.getExtraOff(currentUser.id) || { leaves: 0, wfh: 0 };
        const now = new Date();
        const currMonthStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;

        // Populate the leave type dropdown (excluding WFH)
        const select = document.getElementById('leave-type');
        if (select) select.innerHTML = '';

        const grid = document.getElementById('user-balances-grid');
        if (grid) grid.innerHTML = '';

        // --- Leave balance cards (excluding WFH) ---
        const nonWfhTypes = leaveTypes.filter(t => !_isWfh(t.name));
        nonWfhTypes.forEach(t => {
            if (select) select.innerHTML += `<option value="${t.name}">${t.name}</option>`;
            
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

            if (grid) {
                grid.innerHTML += `
                    <div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); border-radius:12px; padding:16px;">
                        <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
                            <strong style="font-size:13.5px; color:#f8fafc;">${t.name}</strong>
                            <span style="font-size:11.5px; color:#64748b; font-weight:600; text-transform:uppercase;">${t.cycle || 'Yearly'}</span>
                        </div>
                        <div style="display:flex; justify-content:space-between; font-size:12.5px; color:#94a3b8; margin-bottom:8px;">
                            <span>Used: <strong style="color:#ffffff">${used}</strong></span>
                            <span>Left: <strong style="color:${barColor}">${remaining}</strong> / ${limit}</span>
                        </div>
                        <div style="background:rgba(255,255,255,0.08); border-radius:4px; height:6px; overflow:hidden;">
                            <div style="width:${pct}%; height:100%; background:${barColor}; border-radius:4px; transition:width 0.3s;"></div>
                        </div>
                    </div>
                `;
            }
        });

        if (extra.leaves > 0 && grid) {
            grid.innerHTML += `
                <div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); border-radius:12px; padding:16px;">
                    <strong style="font-size:13.5px; color:#f8fafc;">Extra Leave Allowance</strong>
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
        if (wfhDiv) {
            wfhDiv.innerHTML = `
                <div style="background:rgba(59,130,246,0.06); border:1px solid rgba(59,130,246,0.25); border-radius:12px; padding:18px;">
                    <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
                        <strong style="font-size:14px; color:#f8fafc;">Work From Home</strong>
                        <span style="font-size:12px; color:#94a3b8;">${wfhCycle}${wfhExtra > 0 ? ' (+' + wfhExtra + ' extra)' : ''}</span>
                    </div>
                    ${isMonthly ? `<div style="font-size:12px; color:#64748b; margin-bottom:10px;">📅 ${monthName} ${now.getFullYear()}</div>` : ''}
                    <div style="display:flex; gap:24px; margin-bottom:10px;">
                        <div><span style="font-size:24px; font-weight:700; color:#38bdf8;">${wfhUsed}</span> <span style="font-size:12px; color:#94a3b8;">used ${isMonthly ? 'this month' : ''}</span></div>
                        <div><span style="font-size:24px; font-weight:700; color:${wfhBarColor};">${wfhRemaining}</span> <span style="font-size:12px; color:#94a3b8;">remaining</span></div>
                        <div><span style="font-size:24px; font-weight:700; color:#64748b;">${wfhTotalLimit}</span> <span style="font-size:12px; color:#94a3b8;">limit</span></div>
                    </div>
                    <div style="background:rgba(255,255,255,0.08); border-radius:4px; height:6px; overflow:hidden; margin-bottom:12px;">
                        <div style="width:${wfhPct}%; height:100%; background:${wfhBarColor}; border-radius:4px; transition:width 0.3s;"></div>
                    </div>
                    <div style="display:flex; justify-content:space-between; padding-top:12px; border-top:1px solid rgba(255,255,255,0.06);">
                        <span style="font-size:13px; color:#94a3b8;">📊 All-Time WFH Total</span>
                        <strong style="font-size:15px; color:#38bdf8;">${wfhAllTime} day${wfhAllTime !== 1 ? 's' : ''}</strong>
                    </div>
                </div>
            `;
        }
    }

    // --- Filter state ---
    let _userReqFilter = 'all';

    function renderLeaveHistory(filterOverride) {
        if (!currentUser) currentUser = Auth.getCurrentUser();
        if (!currentUser) return;
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

        const list = document.getElementById('leave-history-list');
        if (!list) return;
        list.innerHTML = '';
        
        if (leaves.length === 0) {
            list.innerHTML = '<li style="color:#64748b; font-size: 13px; text-align: center; padding: 24px; background: rgba(255,255,255,0.02); border-radius: 12px; border: 1px dashed rgba(255,255,255,0.08);">No leave or WFH requests found.</li>';
            return;
        }
        
        leaves.forEach(leave => {
            const isW = _isWfh(leave.type);
            const days = _calcDays(leave);
            const statusClass = (leave.status || '').toLowerCase();
            const statusColor = statusClass === 'approved' ? '#10b981' : statusClass === 'rejected' ? '#ef4444' : '#f59e0b';
            const statusBg = statusClass === 'approved' ? 'rgba(16,185,129,0.15)' : statusClass === 'rejected' ? 'rgba(239,68,68,0.15)' : 'rgba(245,158,11,0.15)';

            const li = document.createElement('li');
            li.className = 'history-item';
            li.innerHTML = `
                <div class="history-info">
                    <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
                        <h4 style="margin:0; font-size:14px; color:#f8fafc;">${leave.type}</h4>
                        <span class="badge" style="background:${isW ? 'rgba(6,182,212,0.15)' : 'rgba(139,92,246,0.15)'}; color:${isW ? '#06b6d4' : '#8b5cf6'}; font-size:11px; padding:2px 8px;">${isW ? 'WFH' : 'Leave'}</span>
                        ${leave.isHalfDay ? '<span class="badge" style="background:rgba(245,158,11,0.15); color:#f59e0b; font-size:11px; padding:2px 8px;">Half Day</span>' : ''}
                    </div>
                    <p style="margin:0; font-size:12px; color:#94a3b8;">
                        📅 ${leave.startDate}${leave.startDate !== leave.endDate ? ' → ' + leave.endDate : ''} 
                        <span style="color:#64748b; margin-left:6px;">(${days} day${days!==1?'s':''})</span>
                    </p>
                    ${leave.reason ? `<p style="margin:4px 0 0; font-size:11.5px; color:#64748b; font-style:italic;">"${leave.reason}"</p>` : ''}
                </div>
                <span class="status-pill" style="background:${statusBg}; color:${statusColor}; border:1px solid ${statusColor}40;">${leave.status}</span>
            `;
            list.appendChild(li);
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
        if (publicHolidaysList) publicHolidaysList.innerHTML = '';
        if (optionalHolidaysList) optionalHolidaysList.innerHTML = '';
        
        const quota = Store.getRemainingQuota(currentUser ? currentUser.id : '');
        if (optionalQuotaText) optionalQuotaText.textContent = `${quota}/3 Remaining`;

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

    // --- CALENDAR LOGIC (Employee View) ---
    let selectedUserCalDate = null;

    function renderUserCalendar() {
        if (!currentCalDate) currentCalDate = new Date();
        const year = currentCalDate.getFullYear();
        const month = currentCalDate.getMonth();
        const todayStr = getTodayDateString();
        
        if (!selectedUserCalDate) {
            selectedUserCalDate = todayStr;
        }

        const monthName = currentCalDate.toLocaleString('default', { month: 'long', year: 'numeric' }).toUpperCase();
        const titleEl = document.getElementById('user-cal-month-title');
        if (titleEl) titleEl.textContent = monthName;

        const todayDayNum = new Date().getDate();
        const todayIcon = document.getElementById('user-cal-today-day-icon');
        if (todayIcon) todayIcon.textContent = todayDayNum;

        const calContainer = document.getElementById('user-calendar-grid');
        if (!calContainer) return;
        calContainer.innerHTML = '';

        // Monday-first: 0=Mon, 1=Tue, ..., 6=Sun
        const firstDaySundayBased = new Date(year, month, 1).getDay();
        const firstDayIndex = (firstDaySundayBased + 6) % 7;
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const prevMonthDays = new Date(year, month, 0).getDate();

        const myLeaves = currentUser ? Store.getUserLeaves(currentUser.id).filter(l => l.status === 'Approved') : [];
        const myAttendance = currentUser ? Store.getAttendance().filter(r => r.userId === currentUser.id) : [];
        const holidays = Store.getHolidays();

        // 1. Previous Month Dimmed Days
        for (let i = firstDayIndex - 1; i >= 0; i--) {
            const prevDayNum = prevMonthDays - i;
            const cell = document.createElement('div');
            cell.className = 'cal-day-cell dimmed';
            cell.innerHTML = `<span class="cal-day-num">${prevDayNum}</span>`;
            calContainer.appendChild(cell);
        }

        // 2. Current Month Days
        for (let day = 1; day <= daysInMonth; day++) {
            const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
            const isToday = (dateStr === todayStr);
            const isSelected = (dateStr === selectedUserCalDate);
            const dayOfWeek = (new Date(year, month, day).getDay() + 6) % 7;
            const isSunday = (dayOfWeek === 6);

            const leaveRecord = myLeaves.find(l => l.startDate <= dateStr && l.endDate >= dateStr);
            const attendanceRecord = myAttendance.find(a => a.date === dateStr);
            const holiday = holidays.find(h => h.date === dateStr);
            const isWfh = leaveRecord && (leaveRecord.type?.toLowerCase().includes('wfh') || leaveRecord.type?.toLowerCase().includes('work from home'));

            let barsHTML = '';
            if (holiday) {
                barsHTML += `<div class="cal-bar holiday" title="Holiday: ${holiday.name}"></div>`;
            }
            if (isWfh) {
                barsHTML += `<div class="cal-bar wfh" title="Work From Home"></div>`;
            } else if (leaveRecord) {
                barsHTML += `<div class="cal-bar leave" title="${leaveRecord.type}"></div>`;
            } else if (attendanceRecord) {
                barsHTML += `<div class="cal-bar" style="background:#10b981;" title="Present"></div>`;
            }

            const cell = document.createElement('div');
            let classes = ['cal-day-cell'];
            if (isToday) classes.push('today');
            if (isSelected) classes.push('selected');
            if (isSunday) classes.push('sunday');
            cell.className = classes.join(' ');
            cell.setAttribute('data-date', dateStr);

            cell.innerHTML = `
                <span class="cal-day-num">${day}</span>
                ${barsHTML ? '<div class="cal-bars-container">' + barsHTML + '</div>' : ''}
            `;

            cell.onclick = () => {
                selectUserCalendarDay(dateStr);
            };

            calContainer.appendChild(cell);
        }

        // 3. Next Month Dimmed Days
        const totalCellsSoFar = firstDayIndex + daysInMonth;
        const totalRows = Math.ceil(totalCellsSoFar / 7);
        const totalTargetCells = totalRows * 7;
        const nextDaysCount = totalTargetCells - totalCellsSoFar;

        for (let nextDay = 1; nextDay <= nextDaysCount; nextDay++) {
            const cell = document.createElement('div');
            cell.className = 'cal-day-cell dimmed';
            cell.innerHTML = `<span class="cal-day-num">${nextDay}</span>`;
            calContainer.appendChild(cell);
        }

        renderUserCalendarAgenda(selectedUserCalDate || todayStr);
    }

    function selectUserCalendarDay(dateStr) {
        selectedUserCalDate = dateStr;
        document.querySelectorAll('#user-calendar-grid .cal-day-cell').forEach(c => {
            c.classList.remove('selected');
            if (c.getAttribute('data-date') === dateStr) {
                c.classList.add('selected');
            }
        });
        renderUserCalendarAgenda(dateStr);
    }

    function renderUserCalendarAgenda(dateStr) {
        const [y, m, d] = dateStr.split('-').map(Number);
        const dateObj = new Date(y, m - 1, d);
        const dayNum = d;
        const dayName = dateObj.toLocaleString('default', { weekday: 'short' }).toUpperCase();

        const numEl = document.getElementById('user-cal-sel-day-num');
        const nameEl = document.getElementById('user-cal-sel-day-name');

        if (numEl) numEl.textContent = dayNum;
        if (nameEl) nameEl.textContent = dayName;

        const container = document.getElementById('user-cal-agenda-container');
        if (!container) return;
        container.innerHTML = '';

        const myLeaves = currentUser ? Store.getUserLeaves(currentUser.id).filter(l => l.status === 'Approved' && l.startDate <= dateStr && l.endDate >= dateStr) : [];
        const myAttendance = currentUser ? Store.getAttendance().filter(r => r.userId === currentUser.id && r.date === dateStr) : [];
        const holidays = Store.getHolidays().filter(h => h.date === dateStr);

        let totalEvents = 0;

        // Holidays
        holidays.forEach(h => {
            totalEvents++;
            const card = document.createElement('div');
            card.className = 'cal-event-card holiday';
            card.innerHTML = `
                <div class="cal-event-icon"><ion-icon name="calendar"></ion-icon></div>
                <div class="cal-event-info">
                    <h4>${h.name}</h4>
                    <p>${h.type || 'Public Holiday'} • Studio Holiday</p>
                </div>
                <span class="cal-event-badge" style="background:rgba(16,185,129,0.2); color:#10b981;">Holiday</span>
            `;
            container.appendChild(card);
        });

        // Leaves & WFH
        myLeaves.forEach(l => {
            totalEvents++;
            const isWfh = l.type?.toLowerCase().includes('wfh') || l.type?.toLowerCase().includes('work from home');
            const isHalf = l.isHalfDay || (l.type || '').toLowerCase().includes('half day');

            const card = document.createElement('div');
            card.className = `cal-event-card ${isWfh ? 'wfh' : 'leave'}`;
            card.innerHTML = `
                <div class="cal-event-icon"><ion-icon name="${isWfh ? 'home' : 'airplane'}"></ion-icon></div>
                <div class="cal-event-info">
                    <h4>${isWfh ? 'Work From Home' : l.type}</h4>
                    <p>Approved ${isHalf ? '• Half Day' : '• Full Day'}</p>
                </div>
                <span class="cal-event-badge" style="background:${isWfh ? 'rgba(6,182,212,0.2)' : 'rgba(139,92,246,0.2)'}; color:${isWfh ? '#06b6d4' : '#8b5cf6'};">${isWfh ? 'WFH' : 'Leave'}</span>
            `;
            container.appendChild(card);
        });

        // Attendance Record
        myAttendance.forEach(a => {
            totalEvents++;
            const card = document.createElement('div');
            card.className = 'cal-event-card';
            card.innerHTML = `
                <div class="cal-event-icon" style="background:rgba(37,99,235,0.2); color:#38bdf8;"><ion-icon name="finger-print"></ion-icon></div>
                <div class="cal-event-info">
                    <h4>Studio Shift Logged</h4>
                    <p>In: ${a.checkInTime || '--:--'} • Out: ${a.checkOutTime || 'Active'}</p>
                </div>
                <span class="cal-event-badge" style="background:rgba(37,99,235,0.2); color:#38bdf8;">Shift</span>
            `;
            container.appendChild(card);
        });

        if (totalEvents === 0) {
            container.innerHTML = `
                <div class="cal-empty-day">
                    <ion-icon name="calendar-outline" style="font-size:36px; color:#334155; margin-bottom:8px;"></ion-icon>
                    <h4 style="color:#e2e8f0; margin:0 0 4px 0; font-size:14px;">No Events Scheduled</h4>
                    <p>No studio holidays, shifts, or planned leaves on this date.</p>
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

    document.getElementById('user-cal-today-btn')?.addEventListener('click', () => {
        currentCalDate = new Date();
        selectedUserCalDate = getTodayDateString();
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

    document.getElementById('apply-leave-form')?.addEventListener('submit', async (e) => {
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

        const requestedDays = isHalfDay ? 0.5 : (Math.round(Math.abs(new Date(end) - new Date(start)) / 86400000) + 1);
        const balances = Store.getUserLeaveBalances(currentUser.id);
        const isWfh = reqVal === 'WFH';
        const matchedPolicy = balances.find(b => {
            if (isWfh) return b.name.toLowerCase().includes('wfh') || b.name.toLowerCase().includes('work from home');
            return type.toLowerCase().startsWith(b.name.toLowerCase()) || b.name.toLowerCase().startsWith(type.toLowerCase());
        });

        // Pre-validate on client
        if (matchedPolicy && requestedDays > matchedPolicy.remaining) {
            window.showInsufficientLeaveModal({
                message: `You requested <strong>${requestedDays} day(s)</strong> of <strong>${matchedPolicy.name}</strong>, but you only have <strong>${matchedPolicy.remaining} day(s)</strong> remaining.`,
                requestedDays,
                availableDays: matchedPolicy.remaining,
                leaveType: matchedPolicy.name,
                balances
            });
            return;
        }

        const btn = e.target.querySelector('button[type="submit"]');
        const origText = btn.textContent;
        btn.disabled = true;
        btn.textContent = "Checking balance...";

        const result = await Store.addLeaveRequest({
            userId: currentUser.id,
            type: isHalfDay ? `${type} (Half Day)` : type,
            startDate: start,
            endDate: end,
            reason: reason,
            status: 'Pending',
            isHalfDay: isHalfDay
        });

        btn.disabled = false;

        if (!result.success) {
            btn.textContent = origText;
            if (result.error === 'INSUFFICIENT_LEAVE_BALANCE' || result.balances) {
                window.showInsufficientLeaveModal(result);
            } else {
                alert(result.message || 'Failed to submit leave request.');
            }
            return;
        }

        e.target.reset();
        renderLeaveHistory();
        renderLeaveBalances();
        
        // Form submit feedback
        btn.textContent = "Request Sent ✓";
        btn.style.background = "var(--success)";
        setTimeout(() => {
            btn.textContent = origText;
            btn.style.background = "";
        }, 2000);
    });

    // Modal helpers for Insufficient Leave
    window.showInsufficientLeaveModal = function(data) {
        const modal = document.getElementById('insufficient-leave-modal');
        if (!modal) return;
        modal.style.display = 'flex';
        modal.classList.remove('hidden');

        const msgEl = document.getElementById('insufficient-leave-msg');
        if (msgEl) {
            msgEl.innerHTML = data.message || `You requested <strong>${data.requestedDays || ''} day(s)</strong> of <strong>${data.leaveType || 'Leave'}</strong>, but only have <strong>${data.availableDays || 0} day(s)</strong> remaining.`;
        }

        const breakdownEl = document.getElementById('insufficient-leave-breakdown');
        if (breakdownEl && data.balances) {
            breakdownEl.innerHTML = '';
            data.balances.forEach(b => {
                const isZero = b.remaining <= 0;
                const badgeColor = isZero ? '#ef4444' : b.remaining <= 2 ? '#f59e0b' : '#10b981';
                const badgeBg = isZero ? 'rgba(239,68,68,0.15)' : b.remaining <= 2 ? 'rgba(245,158,11,0.15)' : 'rgba(16,185,129,0.15)';
                const borderCol = isZero ? 'rgba(239,68,68,0.3)' : 'rgba(255,255,255,0.08)';
                const usedVal = b.totalUsed !== undefined ? b.totalUsed : (b.used !== undefined ? b.used : 0);

                breakdownEl.innerHTML += `
                    <div style="background:rgba(255,255,255,0.03); border:1px solid ${borderCol}; border-radius:10px; padding:10px 12px; display:flex; flex-direction:column; justify-content:space-between;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                            <strong style="font-size:12.5px; color:#f8fafc;">${b.name || b.label}</strong>
                            <span style="font-size:10px; color:#64748b; text-transform:uppercase; font-weight:600;">${b.cycle || 'Yearly'}</span>
                        </div>
                        <div style="display:flex; justify-content:space-between; align-items:center; font-size:11.5px; color:#94a3b8;">
                            <span>Used: <strong style="color:#ffffff;">${usedVal}</strong></span>
                            <span style="background:${badgeBg}; color:${badgeColor}; border:1px solid ${badgeColor}40; padding:2px 8px; border-radius:6px; font-weight:700; font-size:11px;">
                                ${b.remaining} / ${b.quota || b.limit} left
                            </span>
                        </div>
                    </div>
                `;
            });
        }
    };

    window.closeInsufficientLeaveModal = function() {
        const modal = document.getElementById('insufficient-leave-modal');
        if (modal) {
            modal.style.display = 'none';
            modal.classList.add('hidden');
        }
    };

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
