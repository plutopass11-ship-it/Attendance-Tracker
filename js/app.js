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
        // Exclude WFH from standard dynamic leave types
        const types = Store.getLeaveTypes().filter(t => !t.name.toLowerCase().includes('wfh') && !t.name.toLowerCase().includes('work from home'));
        const userLeaves = Store.getUserLeaves(currentUser.id).filter(l => l.status === 'Approved');
        const extraOff = Store.getExtraOff(currentUser.id) || { leaves: 0, wfh: 0 };
        
        const select = document.getElementById('leave-type');
        select.innerHTML = '';
        
        const grid = document.getElementById('user-balances-grid');
        grid.innerHTML = '';

        const now = new Date();
        const currMonthStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;

        let leavesLimit = extraOff.leaves;
        let leavesRemaining = extraOff.leaves;
        let wfhLimit = extraOff.wfh;
        let wfhRemaining = extraOff.wfh;
        
        let typesHtml = '';

        types.forEach(t => {
            select.innerHTML += `<option value="${t.name}">${t.name}</option>`;
            
            let taken = 0;
            const relevantLeaves = userLeaves.filter(l => l.type === t.name);
            
            relevantLeaves.forEach(l => {
                const sDate = new Date(l.startDate);
                const eDate = new Date(l.endDate);
                if(t.cycle && t.cycle.toLowerCase() === 'monthly') {
                    if (l.startDate.startsWith(currMonthStr)) {
                        taken += l.isHalfDay ? 0.5 : 1;
                    }
                } else {
                    // Yearly reset: Only subtract leaves taken in the current year
                    if (sDate.getFullYear() === now.getFullYear() || eDate.getFullYear() === now.getFullYear()) {
                        const diffTimes = eDate - sDate;
                        const diffDays = Math.ceil(diffTimes / (1000 * 60 * 60 * 24)) + 1;
                        taken += l.isHalfDay ? 0.5 : diffDays;
                    }
                }
            });
            
            const remainingForType = Math.max(0, t.limit - taken);
            leavesLimit += t.limit;
            leavesRemaining += remainingForType;
            
            typesHtml += `
                <div style="display:flex; justify-content:space-between; padding:8px 12px; border-bottom:1px solid rgba(255,255,255,0.05); font-size:13px;">
                    <span style="color:var(--text-muted)">${t.name}</span>
                    <strong style="color: ${remainingForType>0 ? 'var(--text-main)' : 'var(--danger)'}">${remainingForType} / ${t.limit}</strong>
                </div>
            `;
        });
        
        let wfhTaken = 0;
        const wfhRequests = userLeaves.filter(l => l.type.toLowerCase().includes('wfh') || l.type.toLowerCase() === 'work from home');
        wfhRequests.forEach(l => {
            // WFH is generally monthly
            if (l.startDate.startsWith(currMonthStr)) {
                const diffTimes = new Date(l.endDate) - new Date(l.startDate);
                const diffDays = Math.ceil(diffTimes / (1000 * 60 * 60 * 24)) + 1;
                wfhTaken += l.isHalfDay ? 0.5 : diffDays;
            }
        });
        wfhRemaining -= wfhTaken;

        grid.innerHTML = `
            <div class="glass-panel" style="padding:16px; text-align:center;">
                <div style="font-size:12px; color:var(--text-muted); margin-bottom:6px;">Extra Leaves</div>
                <div style="font-size:24px; font-weight:700; color: ${extraOff.leaves>0 ? 'var(--text-main)' : 'var(--danger)'}">
                    ${extraOff.leaves}
                </div>
            </div>
            <div class="glass-panel" style="padding:16px; text-align:center;">
                <div style="font-size:12px; color:var(--text-muted); margin-bottom:6px;">Remaining WFH</div>
                <div style="font-size:24px; font-weight:700; color: ${wfhRemaining>0 ? 'var(--text-main)' : 'var(--danger)'}">
                    ${wfhRemaining} <span style="font-size:12px; font-weight:400; color:var(--text-muted)">/ ${wfhLimit}</span>
                </div>
            </div>
            <div class="glass-panel" style="grid-column: span 2; padding:16px;">
                <h4 style="margin-top:0; margin-bottom:12px; font-size:14px; color:var(--text-main);">Leave Breakdown</h4>
                ${typesHtml}
            </div>
        `;
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
                    <span class="card-title">${leave.type} ${leave.isHalfDay ? '<span class="badge" style="background:var(--warning); color:white; font-size:10px; margin-left:6px;">Half Day</span>' : ''}</span>
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

    document.getElementById('user-cal-prev-btn')?.addEventListener('click', () => {
        currentCalDate.setMonth(currentCalDate.getMonth() - 1);
        renderUserCalendar();
    });
    
    document.getElementById('user-cal-next-btn')?.addEventListener('click', () => {
        currentCalDate.setMonth(currentCalDate.getMonth() + 1);
        renderUserCalendar();
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

    // Run init
    init();
});
