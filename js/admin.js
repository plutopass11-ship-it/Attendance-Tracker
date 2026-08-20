// admin.js
window.AdminUI = Object.assign(window.AdminUI || {}, {
    currentUser: null,
    currentCalDate: new Date(),
    kitsuPersons: [],
    attendanceChartInstance: null,
    wfhMonthlyChartInstance: null,
    leaveVsWfhChartInstance: null,

    _isWfh: function(type) {
        return type?.toLowerCase().includes('wfh') || type?.toLowerCase().includes('work from home');
    },
    _isWfhAttendanceStatus: function(status) {
        return typeof status === 'string' && status.startsWith('wfh_');
    },
    _isPendingAttendanceStatus: function(status) {
        return status === 'pending_early_clockout' || status === 'wfh_pending_early_clockout';
    },
    _calcDays: function(leave) {
        if (leave.isHalfDay || (leave.type && leave.type.toLowerCase().includes('(half day)'))) return 0.5;
        const s = new Date(leave.startDate), e = new Date(leave.endDate);
        return Math.max(1, Math.ceil(Math.abs(e - s) / (1000*60*60*24)) + 1);
    },
    // Fuzzy match: 'Casual Leave (Half Day)' matches policy 'Casual Leave'
    _matchesType: function(leaveType, policyName) {
        if (!leaveType || !policyName) return false;
        return leaveType === policyName || leaveType.startsWith(policyName);
    },
    
    _mapUsersToPersons: function(users) {
        return (users || []).map(u => {
            const nameParts = (u.name || '').split(' ');
            return {
                id: u.id,
                name: u.name || u.id,
                first_name: nameParts[0] || '',
                last_name: nameParts.slice(1).join(' ') || '',
                email: u.email || u.id,
                department: u.department || 'Production',
                role: u.role || 'user',
                active: u.active !== false && u.is_active !== false
            };
        });
    },

    init: async function(user) {
        try {
            this.currentUser = user;
            
            const greetingEl = document.getElementById('admin-greeting');
            if (greetingEl) greetingEl.textContent = 'Hello, ' + (user.name || 'Admin');

            const sidebarNameEl = document.getElementById('sidebar-user-name');
            const sidebarAvatarEl = document.getElementById('sidebar-user-avatar');
            if (sidebarNameEl) sidebarNameEl.textContent = user.name || 'Studio Admin';
            if (sidebarAvatarEl) {
                const initials = (user.name || 'Admin').split(' ').map(n=>n[0]).join('').substring(0, 2).toUpperCase();
                sidebarAvatarEl.textContent = initials;
            }

            // Immediately populate kitsuPersons from localStorage so initial render has data instantly
            const storedUsers = Store.getUsers() || [];
            if (storedUsers.length > 0) {
                this.kitsuPersons = this._mapUsersToPersons(storedUsers);
            }

            this.setupEventListeners();

            // Initial render with cached data
            this.renderDashboard();
            this.updatePendingLeaveBadge();

            // Sync with backend DB in background, then update
            Store.syncWithBackend().then(() => {
                const updatedUsers = Store.getUsers() || [];
                if (updatedUsers.length > 0) {
                    this.kitsuPersons = this._mapUsersToPersons(updatedUsers);
                }
                this.renderDashboard();
                this.updatePendingLeaveBadge();
                this.fetchPendingRemovals();
            }).catch(err => {
                console.error("Backend sync notice:", err);
            });
        } catch(e) {
            const greetingEl = document.getElementById('admin-greeting');
            if (greetingEl) greetingEl.textContent = "CRASH: " + e.message;
            console.error(e);
        }
    },

    updatePendingLeaveBadge: function() {
        const allLeaves = (typeof Store !== 'undefined' && Store.getAllLeaves) ? Store.getAllLeaves() : [];
        const pendingCount = allLeaves.filter(l => (l.status || '').toLowerCase() === 'pending').length;
        const badgeEl = document.getElementById('sidebar-leaves-badge');
        if (badgeEl) {
            if (pendingCount > 0) {
                badgeEl.textContent = pendingCount;
                badgeEl.setAttribute('data-count', String(pendingCount));
                badgeEl.classList.remove('hidden');
                badgeEl.style.display = 'inline-flex';
            } else {
                badgeEl.textContent = '';
                badgeEl.setAttribute('data-count', '0');
                badgeEl.classList.add('hidden');
                badgeEl.style.display = 'none';
            }
        }
    },
    
    approveEarlyClockOut: async function(userId, date, action) {
        if(!confirm(`Are you sure you want to ${action} early clock-out?`)) return;
        await Store.approveEarlyClockout(userId, date, action);
        await Store.syncWithBackend();
        this.renderDashboard();
    },

    switchToSlackTab: function() {
        const slackBtn = document.querySelector('.admin-nav-item[data-target="admin-tab-slack"]');
        if (slackBtn) {
            slackBtn.click();
        } else {
            document.querySelectorAll('.admin-tab').forEach(t => t.classList.add('hidden'));
            document.querySelectorAll('.admin-nav-item').forEach(n => n.classList.remove('active'));
            const slackTab = document.getElementById('admin-tab-slack');
            if (slackTab) {
                slackTab.classList.remove('hidden');
                if (window.loadSlackSettings) window.loadSlackSettings();
            }
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
                if(target === 'admin-tab-reports' && window.ReportsUI) window.ReportsUI.init();
                if(target === 'admin-tab-history') this.renderHistoryTab();
                if(target === 'admin-tab-biometric') this.renderBiometricTab();
                if(target === 'admin-tab-slack' && window.loadSlackSettings) window.loadSlackSettings();
                if(target === 'admin-tab-overtime' && window.OvertimeUI) window.OvertimeUI.init();
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
        document.getElementById('cal-today-btn')?.addEventListener('click', () => {
            this.currentCalDate = new Date();
            this.selectedCalDate = this.getTodayStr();
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
        document.getElementById('grant-leave-form')?.addEventListener('submit', async (e) => {
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

            const requestedDays = isHalfDay ? 0.5 : (Math.round(Math.abs(new Date(end) - new Date(start)) / 86400000) + 1);
            const balances = Store.getUserLeaveBalances(uid);
            const isWfh = reqVal === 'WFH';
            const matchedPolicy = balances.find(b => {
                if (isWfh) return b.name.toLowerCase().includes('wfh') || b.name.toLowerCase().includes('work from home');
                return type.toLowerCase().startsWith(b.name.toLowerCase()) || b.name.toLowerCase().startsWith(type.toLowerCase());
            });

            if (matchedPolicy && requestedDays > matchedPolicy.remaining) {
                window.showInsufficientLeaveModal({
                    message: `Cannot grant leave: Employee requested <strong>${requestedDays} day(s)</strong> of <strong>${matchedPolicy.name}</strong>, but only has <strong>${matchedPolicy.remaining} day(s)</strong> remaining.`,
                    requestedDays,
                    availableDays: matchedPolicy.remaining,
                    leaveType: matchedPolicy.name,
                    balances
                });
                return;
            }

            const activePersons = window.AdminUI._cachedUsers || [];
            const user = activePersons.find(x => x.id === uid) || { first_name: 'Unknown', last_name: 'User', email: uid, name: uid };

            const request = {
                id: Date.now().toString(),
                userId: uid,
                userName: user.name || `${user.first_name || ''} ${user.last_name || ''}`.trim() || uid,
                userEmail: user.email || uid,
                type: isHalfDay ? `${type} (Half Day)` : type,
                startDate: start,
                endDate: end,
                reason: reason + ' (Admin Granted)',
                status: 'Approved',
                appliedOn: new Date().toISOString(),
                isHalfDay: isHalfDay
            };
            
            const result = await Store.addLeaveRequest(request);
            if (!result.success) {
                if (result.error === 'INSUFFICIENT_LEAVE_BALANCE' || result.balances) {
                    window.showInsufficientLeaveModal(result);
                } else {
                    alert(result.message || 'Failed to grant leave.');
                }
                return;
            }

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

        document.getElementById('migration-json-upload')?.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (evt) => {
                try {
                    const data = JSON.parse(evt.target.result);
                    if (!Array.isArray(data)) throw new Error('Root must be a JSON array of records.');
                    
                    let added = 0;
                    data.forEach(item => {
                        if (item.type && item.startDate && item.endDate) {
                            this._migrationBatch.push({
                                type: item.type,
                                startDate: item.startDate,
                                endDate: item.endDate,
                                reason: item.reason || 'Migrated via JSON'
                            });
                            added++;
                        }
                    });
                    this._renderMigrationBatch();
                    alert(`Successfully imported \${added} records into the batch. Remember to click "Sync History" to save.`);
                } catch (err) {
                    alert('Invalid JSON file:\\n' + err.message + '\\n\\nPlease follow the expected format:\\n[{"type":"...", "startDate":"...", "endDate":"...", "reason":"..."}]');
                }
                e.target.value = ''; // Reset input
            };
            reader.readAsText(file);
        });

        document.getElementById('btn-process-pasted-json')?.addEventListener('click', () => {
            const textarea = document.getElementById('paste-json-textarea');
            const content = textarea.value.trim();
            if (!content) return;
            
            try {
                const data = JSON.parse(content);
                if (!Array.isArray(data)) throw new Error('Root must be a JSON array of records.');
                
                let added = 0;
                data.forEach(item => {
                    if (item.type && item.startDate && item.endDate) {
                        this._migrationBatch.push({
                            type: item.type,
                            startDate: item.startDate,
                            endDate: item.endDate,
                            reason: item.reason || 'Migrated via JSON'
                        });
                        added++;
                    }
                });
                this._renderMigrationBatch();
                document.getElementById('paste-json-modal').classList.add('hidden');
                textarea.value = '';
                alert(`Successfully imported \${added} records into the batch. Remember to click "Sync History" to save.`);
            } catch (err) {
                alert('Invalid JSON data:\\n' + err.message + '\\n\\nPlease follow the expected format:\\n[{"type":"...", "startDate":"...", "endDate":"...", "reason":"..."}]');
            }
        });

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

    fetchPendingRemovals: async function() {
        try {
            const res = await fetch('/api/users/pending_removal');
            if (res.ok) {
                const data = await res.json();
                if (data.success) {
                    this.renderPendingRemovals(data.pending_removals);
                }
            }
        } catch(e) {
            console.error('Failed to fetch pending removals:', e);
        }
    },

    renderPendingRemovals: function(users) {
        const container = document.getElementById('pending-removals-container');
        if (!container) return;
        
        if (!users || users.length === 0) {
            container.innerHTML = '';
            return;
        }

        let html = '<div style="background: var(--danger-light, #fee2e2); border: 1px solid var(--danger, #ef4444); border-radius: 8px; padding: 15px; margin-bottom: 20px;">';
        html += '<h3 style="margin-top: 0; color: var(--danger, #b91c1c); display: flex; align-items: center; gap: 8px;"><ion-icon name="warning-outline"></ion-icon> Action Required: Users removed from Kitsu</h3>';
        html += '<ul style="list-style: none; padding: 0; margin: 0;">';
        
        users.forEach(u => {
            html += `<li style="display: flex; justify-content: space-between; align-items: center; background: white; padding: 10px; border-radius: 6px; margin-bottom: 8px; border: 1px solid #fca5a5;">
                <div>
                    <strong>${u.name}</strong> (${u.id})
                </div>
                <div style="display: flex; gap: 10px;">
                    <button class="btn-primary" style="background: var(--danger, #ef4444); padding: 6px 12px; font-size: 12px;" onclick="AdminUI.confirmRemoval('${u.id}')">Confirm Deactivation</button>
                    <button class="btn-secondary" style="padding: 6px 12px; font-size: 12px; color: var(--text-main); border: 1px solid var(--glass-border);" onclick="AdminUI.dismissRemoval('${u.id}')">Dismiss</button>
                </div>
            </li>`;
        });
        
        html += '</ul></div>';
        container.innerHTML = html;
    },

    confirmRemoval: async function(userId) {
        if (!confirm('Are you sure you want to deactivate this user? Their history will be kept.')) return;
        try {
            const res = await fetch(`/api/users/${userId}/deactivate`, { method: 'POST' });
            if (res.ok) {
                alert('User deactivated.');
                this.fetchPendingRemovals();
                this.renderUsers();
            }
        } catch (e) {
            console.error(e);
            alert('Failed to deactivate user.');
        }
    },

    dismissRemoval: async function(userId) {
        try {
            const res = await fetch(`/api/users/${userId}/dismiss_removal`, { method: 'POST' });
            if (res.ok) {
                this.fetchPendingRemovals();
            }
        } catch (e) {
            console.error(e);
            alert('Failed to dismiss.');
        }
    },

    getTodayStr: function() {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    },

    renderDashboard: function() {
        const today = this.getTodayStr();
        const attendance = Store.getAllAttendanceToday(today);
        const leaves = Store.getAllLeaves();
        let onLeaveCount = 0;
        let wfhCount = 0;
        
        // Exclude super-admins (founders) from all headcount calculations
        const activePersons = (this.kitsuPersons && this.kitsuPersons.length > 0) 
            ? this.kitsuPersons.filter(p => p.active && (p.role || '').toLowerCase() !== 'admin')
            : this._mapUsersToPersons(Store.getUsers()).filter(p => p.active && (p.role || '').toLowerCase() !== 'admin');
        
        const presentCount = attendance.filter(r => activePersons.some(p => p.id === r.userId) && !this._isWfhAttendanceStatus(r.status)).length;
        const totalUsers = activePersons.length > 0 ? activePersons.length : 0;
        
        const statPresentEl = document.getElementById('stat-present');
        if (statPresentEl) statPresentEl.textContent = `${presentCount} / ${totalUsers}`;
        
        const pendingCount = leaves.filter(l => l.status === 'Pending').length;
        const statPendingEl = document.getElementById('stat-pending');
        if (statPendingEl) statPendingEl.textContent = pendingCount;
        
        // Render Live Attendance Table (OnlyGenius Clients List Style)
        const tbody = document.getElementById('live-attendance-tbody');
        if (tbody) {
            tbody.innerHTML = '';
            
            activePersons.forEach(user => {
                const record = attendance.find(r => r.userId === user.id);
                const activeLeave = leaves.find(l => l.userId === user.id && l.status === 'Approved' && l.startDate <= today && l.endDate >= today);
                const isWfhLeave = activeLeave && this._isWfh(activeLeave.type);
                const isHalfDayLeave = activeLeave && (activeLeave.type || '').toLowerCase().includes('half day');
                const isOnLeaveToday = activeLeave && !isWfhLeave && (!isHalfDayLeave || !record);
                
                let statusBadge = '<span class="status-pill pill-rejected">Absent</span>';
                let checkIn = '--:--';
                let checkOut = '--:--';
                let feedType = 'absent';
                let actionButtons = `
                    <div style="display:inline-flex; align-items:center; gap:8px; justify-content:flex-end;">
                        <button type="button" class="btn-neutral btn-small" style="padding:4px 8px; font-size:12px;" title="View Member History" onclick="window.AdminUI.openUserDetail('${user.id}')">
                            <ion-icon name="ellipsis-horizontal"></ion-icon>
                        </button>
                    </div>`;
                
                if (isOnLeaveToday) {
                    statusBadge = isHalfDayLeave 
                        ? '<span class="status-pill pill-completed">Half Day Leave</span>' 
                        : '<span class="status-pill pill-completed">On Leave</span>';
                    onLeaveCount++;
                    feedType = 'leave';
                } else if(record) {
                    const isWfhAttendance = this._isWfhAttendanceStatus(record.status) || isWfhLeave;
                    if (isWfhAttendance) {
                        wfhCount++;
                        feedType = 'wfh';
                    } else {
                        feedType = 'office';
                    }
                    checkIn = record.checkInTime || '--:--';
                    
                    let extraBadge = isHalfDayLeave ? ' <span class="status-pill pill-completed" style="margin-left:4px;">Half Day</span>' : '';
                    if (isHalfDayLeave) onLeaveCount++;

                    if(this._isPendingAttendanceStatus(record.status)) {
                        statusBadge = '<span class="status-pill pill-late">Early Clockout Pending</span>' + extraBadge;
                        checkOut = record.checkOutTime || '--:--';
                        actionButtons = `
                            <div style="display:inline-flex; align-items:center; gap:6px; justify-content:flex-end;">
                                <button type="button" class="btn-primary btn-small" style="padding:4px 10px; font-size:11.5px; font-weight:700;" onclick="window.AdminUI.approveEarlyClockOut('${user.id}', '${today}', 'approve')">Approve</button>
                                <button type="button" class="btn-danger btn-small" style="padding:4px 10px; font-size:11.5px; font-weight:700;" onclick="window.AdminUI.approveEarlyClockOut('${user.id}', '${today}', 'reject')">Reject</button>
                                <button type="button" class="btn-neutral btn-small" style="padding:4px 8px; font-size:12px;" title="View Member History" onclick="window.AdminUI.openUserDetail('${user.id}')">
                                    <ion-icon name="ellipsis-horizontal"></ion-icon>
                                </button>
                            </div>`;
                    } else if(record.checkOutTime && (record.status === 'completed' || record.status === 'wfh_completed')) {
                        statusBadge = (isWfhAttendance
                            ? '<span class="status-pill pill-wfh">WFH Completed</span>'
                            : '<span class="status-pill pill-active">Completed</span>') + extraBadge;
                        checkOut = record.checkOutTime;
                    } else {
                        statusBadge = (isWfhAttendance
                            ? '<span class="status-pill pill-wfh">WFH Active</span>'
                            : '<span class="status-pill pill-active">Active</span>') + extraBadge;
                        checkOut = record.checkOutTime || '--:--';
                    }
                } else if(activeLeave && !record) {
                    if(isWfhLeave) {
                        statusBadge = '<span class="status-pill pill-wfh">WFH Active</span>';
                        wfhCount++;
                        feedType = 'wfh';
                    }
                }

                const fullName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.id;
                const initials = `${(user.first_name || 'U')[0]}${(user.last_name || '')[0] || ''}`.toUpperCase();

                const tr = document.createElement('tr');
                tr.setAttribute('data-feed-type', feedType);
                tr.setAttribute('data-search', `${fullName} ${user.id} ${user.department || ''}`.toLowerCase());
                tr.innerHTML = `
                    <td>
                        <div class="user-cell">
                            <div class="user-cell-avatar">${initials}</div>
                            <div class="user-cell-info">
                                <span class="name">${fullName}</span>
                                <span class="dept">${user.email || user.id}</span>
                            </div>
                        </div>
                    </td>
                    <td><span style="color:#ffffff; font-size:13px; font-weight:500;">${user.department || 'Production'}</span></td>
                    <td><strong style="color:var(--text-primary); font-size:13px;">${checkIn}</strong></td>
                    <td><strong style="color:var(--text-primary); font-size:13px;">${checkOut}</strong></td>
                    <td>${statusBadge}</td>
                    <td style="text-align:right;">${actionButtons}</td>
                `;
                tbody.appendChild(tr);
            });

            // Update Header Stat Cards
            const onLeaveEl = document.getElementById('stat-on-leave');
            const wfhEl = document.getElementById('stat-wfh');
            if (onLeaveEl) onLeaveEl.textContent = onLeaveCount;
            if (wfhEl) wfhEl.textContent = wfhCount;
        }

        // =========================================================================
        // Chart 1: Studio Attendance Trends (Real DB Records over Selected Period)
        // =========================================================================
        const trendCtx = document.getElementById('trendChart');
        if(trendCtx) {
            try {
                if(window.AdminUI.trendChartInstance) window.AdminUI.trendChartInstance.destroy();
                
                const periodEl = document.getElementById('dash-trend-period');
                const is6Months = periodEl && periodEl.value === '6m';
                const allAttendance = Store.getAttendance();
                const allLeaves = Store.getAllLeaves();
                
                let labels = [];
                let officeData = [];
                let wfhData = [];
                
                if (is6Months) {
                    const now = new Date();
                    for (let i = 5; i >= 0; i--) {
                        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
                        const y = d.getFullYear();
                        const m = String(d.getMonth() + 1).padStart(2, '0');
                        const monthPrefix = `${y}-${m}`;
                        labels.push(d.toLocaleString('en-US', { month: 'short' }));
                        
                        const mRecords = allAttendance.filter(r => (r.date || '').startsWith(monthPrefix));
                        const mOffice = mRecords.filter(r => !this._isWfhAttendanceStatus(r.status)).length;
                        const mWfh = mRecords.filter(r => this._isWfhAttendanceStatus(r.status)).length;
                        
                        officeData.push(mOffice);
                        wfhData.push(mWfh);
                    }
                } else {
                    for (let i = 6; i >= 0; i--) {
                        const d = new Date();
                        d.setDate(d.getDate() - i);
                        const dStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
                        const dayLabel = (i === 0) ? 'Today' : d.toLocaleDateString('en-US', { weekday: 'short' });
                        labels.push(dayLabel);
                        
                        const dayRecords = allAttendance.filter(r => r.date === dStr);
                        const dayOffice = dayRecords.filter(r => !this._isWfhAttendanceStatus(r.status)).length;
                        
                        let dayWfh = dayRecords.filter(r => this._isWfhAttendanceStatus(r.status)).length;
                        allLeaves.filter(l => l.status === 'Approved' && l.startDate <= dStr && l.endDate >= dStr && this._isWfh(l.type))
                            .forEach(l => {
                                if (!dayRecords.some(r => r.userId === l.userId && this._isWfhAttendanceStatus(r.status))) {
                                    dayWfh++;
                                }
                            });
                        
                        officeData.push(dayOffice);
                        wfhData.push(dayWfh);
                    }
                }
                
                const ctx2d = trendCtx.getContext('2d');
                const gradBlue = ctx2d.createLinearGradient(0, 0, 0, 240);
                gradBlue.addColorStop(0, 'rgba(37, 99, 235, 0.45)');
                gradBlue.addColorStop(1, 'rgba(37, 99, 235, 0.0)');

                const gradAmber = ctx2d.createLinearGradient(0, 0, 0, 240);
                gradAmber.addColorStop(0, 'rgba(245, 158, 11, 0.35)');
                gradAmber.addColorStop(1, 'rgba(245, 158, 11, 0.0)');
                
                window.AdminUI.trendChartInstance = new Chart(trendCtx, {
                    type: 'line',
                    data: {
                        labels: labels,
                        datasets: [
                            { 
                                label: 'In Studio', 
                                data: officeData, 
                                borderColor: '#2563eb', 
                                backgroundColor: gradBlue, 
                                fill: true,
                                tension: 0.45,
                                borderWidth: 3,
                                pointRadius: 0,
                                pointHoverRadius: 6,
                                pointBackgroundColor: '#2563eb'
                            },
                            { 
                                label: 'Remote (WFH)', 
                                data: wfhData, 
                                borderColor: '#f59e0b', 
                                backgroundColor: gradAmber, 
                                fill: true,
                                tension: 0.45,
                                borderWidth: 3,
                                pointRadius: 0,
                                pointHoverRadius: 6,
                                pointBackgroundColor: '#f59e0b'
                            }
                        ]
                    },
                    options: { 
                        responsive: true, 
                        maintainAspectRatio: false,
                        interaction: { intersect: false, mode: 'index' },
                        plugins: { 
                            legend: { 
                                position: 'bottom',
                                labels: { color: '#94a3b8', font: { family: 'Plus Jakarta Sans', size: 12 }, usePointStyle: true, boxWidth: 8, padding: 14 } 
                            } 
                        }, 
                        scales: { 
                            y: { 
                                beginAtZero: true, 
                                ticks: { color: '#64748b', stepSize: Math.max(1, Math.ceil(Math.max(...officeData, ...wfhData, 1) / 5)), font: { family: 'Plus Jakarta Sans', size: 11 } }, 
                                grid: { color: 'rgba(255,255,255,0.04)' } 
                            }, 
                            x: { 
                                ticks: { color: '#64748b', font: { family: 'Plus Jakarta Sans', size: 11 } }, 
                                grid: { display: false } 
                            } 
                        } 
                    }
                });
            } catch(e) { console.error("Trend chart error:", e); }
        }

        // =========================================================================
        // Chart 2: Today's Headcount Distribution (Real Live Counts)
        // =========================================================================
        const deptCtx = document.getElementById('attendanceChart');
        if(deptCtx) {
            try {
                if(window.AdminUI.attendanceChartInstance) {
                    window.AdminUI.attendanceChartInstance.destroy();
                }
                
                const notCheckedIn = Math.max(0, totalUsers - presentCount - (wfhCount || 0) - (onLeaveCount || 0));
                const splitLabels = ['In Office', 'Remote (WFH)', 'On Leave', 'Not Checked In'];
                const splitData = [presentCount || 0, wfhCount || 0, onLeaveCount || 0, notCheckedIn];
                const splitColors = ['#2563eb', '#06b6d4', '#8b5cf6', '#ef4444'];
                
                window.AdminUI.attendanceChartInstance = new Chart(deptCtx, {
                    type: 'bar',
                    data: {
                        labels: splitLabels,
                        datasets: [{
                            data: splitData,
                            backgroundColor: splitColors,
                            borderRadius: 8,
                            barThickness: 32
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: { display: false }
                        },
                        scales: {
                            y: {
                                beginAtZero: true,
                                ticks: { color: '#64748b', stepSize: 1, font: { family: 'Plus Jakarta Sans', size: 11 } },
                                grid: { color: 'rgba(255,255,255,0.04)' }
                            },
                            x: {
                                ticks: { color: '#94a3b8', font: { family: 'Plus Jakarta Sans', size: 11 } },
                                grid: { display: false }
                            }
                        }
                    }
                });
            } catch(e) { console.error("Headcount distribution chart error:", e); }
        }

        // =========================================================================
        // Chart 3: Monthly Shifts Recorded (Past 6 Months Real DB Counts)
        // =========================================================================
        const monthlyCtx = document.getElementById('monthlyAttendanceChart');
        if(monthlyCtx) {
            try {
                if(window.AdminUI.monthlyChartInstance) window.AdminUI.monthlyChartInstance.destroy();
                const allAttendance = Store.getAttendance();
                const now = new Date();
                const mMonths = [];
                const mCounts = [];
                const mColors = ['#2563eb', '#10b981', '#f97316', '#eab308', '#ec4899', '#a855f7'];

                for (let i = 5; i >= 0; i--) {
                    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
                    const y = d.getFullYear();
                    const m = String(d.getMonth() + 1).padStart(2, '0');
                    const monthPrefix = `${y}-${m}`;
                    mMonths.push(d.toLocaleString('en-US', { month: 'short' }));
                    
                    const count = allAttendance.filter(r => (r.date || '').startsWith(monthPrefix)).length;
                    mCounts.push(count);
                }

                window.AdminUI.monthlyChartInstance = new Chart(monthlyCtx, {
                    type: 'bar',
                    data: {
                        labels: mMonths,
                        datasets: [{
                            label: 'Total Shifts',
                            data: mCounts,
                            backgroundColor: mColors,
                            borderRadius: 8,
                            barThickness: 28
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: { display: false }
                        },
                        scales: {
                            y: {
                                beginAtZero: true,
                                ticks: { 
                                    color: '#64748b', 
                                    stepSize: Math.max(1, Math.ceil(Math.max(...mCounts, 1) / 4)), 
                                    font: { family: 'Plus Jakarta Sans', size: 11 }
                                },
                                grid: { color: 'rgba(255,255,255,0.04)' }
                            },
                            x: {
                                ticks: { color: '#94a3b8', font: { family: 'Plus Jakarta Sans', size: 11 } },
                                grid: { display: false }
                            }
                        }
                    }
                });
            } catch(e) { console.error("Monthly shifts chart error:", e); }
        }

        // =========================================================================
        // Chart 4: Approved Leaves by Team Member (Real Aggregate from Store Leaves)
        // =========================================================================
        const takersCtx = document.getElementById('topTakersChart');
        if(takersCtx) {
            try {
                if(window.AdminUI.takersChartInstance) window.AdminUI.takersChartInstance.destroy();
                const userTotals = {};
                leaves.filter(l => l.status === 'Approved').forEach(l => {
                    const days = this._calcDays ? this._calcDays(l) : 1;
                    userTotals[l.userId] = (userTotals[l.userId] || 0) + days;
                });
                const sorted = Object.entries(userTotals).sort((a,b) => b[1] - a[1]).slice(0, 5);
                const tkLabels = sorted.map(s => {
                    const u = activePersons.find(p => p.id === s[0]);
                    return u ? `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.id : s[0];
                });
                const tkData = sorted.map(s => s[1]);
                const barColors = ['#2563eb', '#10b981', '#f59e0b', '#ec4899', '#06b6d4'];
                
                window.AdminUI.takersChartInstance = new Chart(takersCtx, {
                    type: 'bar',
                    data: {
                        labels: tkLabels.length ? tkLabels : ['No Approved Leaves'],
                        datasets: [{ 
                            label: 'Approved Days', 
                            data: tkData.length ? tkData : [0], 
                            backgroundColor: barColors.slice(0, Math.max(1, tkLabels.length)), 
                            borderRadius: 6,
                            barThickness: 18
                        }]
                    },
                    options: { 
                        indexAxis: 'y', 
                        responsive: true, 
                        maintainAspectRatio: false,
                        plugins: { legend: { display: false } }, 
                        scales: { 
                            y: { ticks: { color: '#94a3b8', font: { family: 'Plus Jakarta Sans', size: 12 } }, grid: { display: false } }, 
                            x: { ticks: { color: '#64748b', stepSize: 1 }, grid: { color: 'rgba(255,255,255,0.04)' } } 
                        } 
                    }
                });
            } catch(e) { console.error("Takers chart error:", e); }
        }
    },

    // Segmented tab filtering for Live Attendance Feed
    filterFeedByTab: function(tab, btnEl) {
        if (btnEl) {
            document.querySelectorAll('#feed-filter-tabs .filter-tab-pill').forEach(b => b.classList.remove('active'));
            btnEl.classList.add('active');
        }
        this._currentFeedTab = tab;
        this._applyFeedFilters();
    },

    filterLiveFeed: function(query) {
        this._currentFeedSearch = (query || '').toLowerCase().trim();
        this._applyFeedFilters();
    },

    _applyFeedFilters: function() {
        const tab = this._currentFeedTab || 'all';
        const q = this._currentFeedSearch || '';
        const rows = document.querySelectorAll('#live-attendance-tbody tr');
        rows.forEach(tr => {
            const searchMatches = !q || (tr.getAttribute('data-search') || '').includes(q);
            const type = tr.getAttribute('data-feed-type') || 'absent';
            const tabMatches = (tab === 'all') || (type === tab);
            tr.style.display = (searchMatches && tabMatches) ? '' : 'none';
        });
    },

    renderLeaves: function() {
        this._leavesActiveTab = this._leavesActiveTab || 'Pending';
        const allLeaves = Store.getAllLeaves();

        // Update counts for all 3 sub-tabs
        const pendingCount = allLeaves.filter(l => (l.status || '').toLowerCase() === 'pending').length;
        const approvedCount = allLeaves.filter(l => (l.status || '').toLowerCase() === 'approved').length;
        const rejectedCount = allLeaves.filter(l => (l.status || '').toLowerCase() === 'rejected').length;

        const pCountEl = document.getElementById('leaves-pending-count');
        if (pCountEl) {
            pCountEl.textContent = pendingCount;
            pCountEl.style.display = pendingCount > 0 ? 'inline-block' : 'none';
        }
        const aCountEl = document.getElementById('leaves-approved-count');
        if (aCountEl) aCountEl.textContent = approvedCount;
        const rCountEl = document.getElementById('leaves-rejected-count');
        if (rCountEl) rCountEl.textContent = rejectedCount;

        this.updatePendingLeaveBadge();

        // Populate type filter dropdown
        const typeSelect = document.getElementById('leaves-filter-type');
        if (typeSelect) {
            const currentVal = typeSelect.value;
            const types = [...new Set(allLeaves.map(l => l.type))].sort();
            typeSelect.innerHTML = '<option value="all">All Types</option>' + types.map(t => `<option value="${t}"${currentVal === t ? ' selected' : ''}>${t}</option>`).join('');
        }

        // Populate month filter dropdown
        const monthSelect = document.getElementById('leaves-filter-month');
        if (monthSelect) {
            const currentVal = monthSelect.value;
            const months = [...new Set(allLeaves.map(l => {
                const d = new Date(l.startDate);
                return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
            }))].sort().reverse();
            monthSelect.innerHTML = '<option value="all">All Months</option>' + months.map(m => {
                const [y, mo] = m.split('-');
                const label = new Date(y, mo-1).toLocaleString('default', { month: 'long', year: 'numeric' });
                return `<option value="${m}"${currentVal === m ? ' selected' : ''}>${label}</option>`;
            }).join('');
        }

        // Populate user filter dropdown
        const userSelect = document.getElementById('leaves-filter-user');
        if (userSelect) {
            const currentVal = userSelect.value;
            const userIds = [...new Set(allLeaves.map(l => l.userId))].sort();
            const persons = this.kitsuPersons || [];
            userSelect.innerHTML = '<option value="all">All Users</option>' + userIds.map(uid => {
                const u = persons.find(p => p.id === uid);
                const name = u ? `${u.first_name} ${u.last_name}` : uid;
                return `<option value="${uid}"${currentVal === uid ? ' selected' : ''}>${name}</option>`;
            }).join('');
        }

        this.applyLeaveFilters();
    },

    switchLeavesTab: function(status) {
        this._leavesActiveTab = status;
        // Update sub-tab styles
        document.querySelectorAll('.leaves-sub-tab').forEach(btn => {
            btn.classList.remove('active', 'btn-primary');
            btn.classList.add('btn-neutral');
        });
        const activeBtn = document.querySelector(`.leaves-sub-tab[data-status="${status}"]`);
        if (activeBtn) { activeBtn.classList.add('active', 'btn-primary'); activeBtn.classList.remove('btn-neutral'); }
        this.applyLeaveFilters();
    },

    applyLeaveFilters: function() {
        const status = this._leavesActiveTab || 'Pending';
        const category = document.getElementById('leaves-filter-category')?.value || 'all';
        const type = document.getElementById('leaves-filter-type')?.value || 'all';
        const month = document.getElementById('leaves-filter-month')?.value || 'all';

        const allLeaves = Store.getAllLeaves();
        const approvedCount = allLeaves.filter(l => (l.status || '').toLowerCase() === 'approved').length;
        let leaves = allLeaves.filter(l => (l.status || '').toLowerCase() === status.toLowerCase());

        // Category filter
        if (category === 'wfh') leaves = leaves.filter(l => this._isWfh(l.type));
        else if (category === 'leave') leaves = leaves.filter(l => !this._isWfh(l.type));

        // Type filter
        if (type !== 'all') leaves = leaves.filter(l => l.type === type);

        // Month filter
        if (month !== 'all') {
            leaves = leaves.filter(l => {
                const d = new Date(l.startDate);
                const m = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
                return m === month;
            });
        }

        // User filter
        const user = document.getElementById('leaves-filter-user')?.value || 'all';
        if (user !== 'all') leaves = leaves.filter(l => l.userId === user);

        // Update result count
        const countEl = document.getElementById('leaves-result-count');
        if (countEl) countEl.textContent = `${leaves.length} result${leaves.length !== 1 ? 's' : ''}`;

        // Render table
        const tbody = document.getElementById('admin-leaves-tbody');
        if (!tbody) return;
        tbody.innerHTML = '';

        if (leaves.length === 0) {
            if (status.toLowerCase() === 'pending') {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="6" style="text-align:center; padding:48px 20px;">
                            <div style="font-size:36px; margin-bottom:12px;">🎉</div>
                            <div style="font-size:16px; font-weight:700; color:#ffffff; margin-bottom:6px;">No Pending Leave Requests</div>
                            <div style="font-size:13px; color:#64748b; margin-bottom:18px;">All leave applications are currently processed. There are ${approvedCount} approved leaves in the system.</div>
                            ${approvedCount > 0 ? `<button type="button" class="btn-small btn-primary" onclick="window.AdminUI.switchLeavesTab('Approved')" style="margin:0 auto; display:inline-flex; align-items:center; gap:6px; padding:7px 16px;"><ion-icon name="checkmark-done-outline"></ion-icon> View ${approvedCount} Approved Leaves</button>` : ''}
                        </td>
                    </tr>
                `;
            } else {
                tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:#64748b; padding:40px 20px;">No ${status.toLowerCase()} requests found matching your filter criteria.</td></tr>`;
            }
            return;
        }

        leaves.forEach(l => {
            const days = this._calcDays(l);
            const isW = this._isWfh(l.type);
            const catBadge = isW
                ? '<span class="badge-cat-wfh"><ion-icon name="home-outline"></ion-icon> WFH</span>'
                : '<span class="badge-cat-leave"><ion-icon name="airplane-outline"></ion-icon> Leave</span>';

            const userObj = this.kitsuPersons.find(u => u.id === l.userId);
            const displayName = userObj ? `${userObj.first_name} ${userObj.last_name}` : (l.userName || l.userId || 'Unknown');
            const initials = displayName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
            const department = userObj?.department || 'Studio Artist';

            const startDateFormatted = l.startDate ? new Date(l.startDate).toLocaleDateString('en-US', { day:'numeric', month:'short' }) : '-';
            const endDateFormatted = l.endDate ? new Date(l.endDate).toLocaleDateString('en-US', { day:'numeric', month:'short' }) : '-';
            const dateStr = (l.startDate === l.endDate) ? startDateFormatted : `${startDateFormatted} → ${endDateFormatted}`;

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="padding:14px 18px;">
                    <div style="display:flex; align-items:center; gap:10px;">
                        <div style="width:30px; height:30px; border-radius:50%; background:linear-gradient(135deg, #38bdf8, #6366f1); color:#fff; font-size:11px; font-weight:700; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                            ${initials}
                        </div>
                        <div>
                            <div style="font-weight:700; color:#ffffff; font-size:13.5px;">${displayName}</div>
                            <div style="font-size:11px; color:#64748b;">${department}</div>
                        </div>
                    </div>
                </td>
                <td style="padding:14px 18px;">${catBadge}</td>
                <td style="padding:14px 18px;">
                    <span style="font-weight:600; color:#f1f5f9; font-size:13px;">${l.type || '-'}</span>
                    ${l.isHalfDay ? '<span class="badge-half-day">Half Day</span>' : ''}
                </td>
                <td style="padding:14px 18px; color:#cbd5e1; font-size:12.5px; white-space:nowrap;">
                    <ion-icon name="calendar-outline" style="vertical-align:middle; color:#64748b; margin-right:4px;"></ion-icon>
                    <span>${dateStr}</span>
                    <span class="badge-duration-pill">${days} ${days === 1 ? 'day' : 'days'}</span>
                </td>
                <td style="padding:14px 18px; max-width:240px; color:#94a3b8; font-size:12.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${(l.reason || '').replace(/"/g, '&quot;')}">
                    ${l.reason ? `"${l.reason}"` : '<span style="color:#475569;">No notes provided</span>'}
                </td>
            `;

            let actionHtml = '';
            if (status.toLowerCase() === 'pending') {
                actionHtml = `
                    <div style="display:flex; gap:6px; justify-content:flex-end;">
                        <button class="btn-small btn-approve" style="padding:6px 12px; font-size:11.5px; display:inline-flex; align-items:center; gap:4px;" onclick="window.AdminUI.updateLeave('${l.id}','Approved')">
                            <ion-icon name="checkmark-outline"></ion-icon> Approve
                        </button>
                        <button class="btn-small btn-reject" style="padding:6px 12px; font-size:11.5px; display:inline-flex; align-items:center; gap:4px;" onclick="window.AdminUI.updateLeave('${l.id}','Rejected')">
                            <ion-icon name="close-outline"></ion-icon> Reject
                        </button>
                    </div>
                `;
            } else if (status.toLowerCase() === 'approved') {
                actionHtml = `
                    <div style="display:flex; gap:6px; justify-content:flex-end;">
                        <button class="btn-small btn-neutral" style="padding:6px 10px; font-size:11.5px; color:#f87171; border-color:rgba(239,68,68,0.25); background:rgba(239,68,68,0.06);" title="Revoke approval" onclick="window.AdminUI.updateLeave('${l.id}','Rejected')">
                            <ion-icon name="arrow-undo-outline" style="vertical-align:middle;"></ion-icon> Revoke
                        </button>
                    </div>
                `;
            } else {
                actionHtml = `
                    <div style="display:flex; gap:6px; justify-content:flex-end;">
                        <button class="btn-small btn-approve" style="padding:6px 10px; font-size:11.5px;" onclick="window.AdminUI.updateLeave('${l.id}','Approved')">
                            <ion-icon name="checkmark-outline"></ion-icon> Re-Approve
                        </button>
                    </div>
                `;
            }
            tr.innerHTML += `<td style="padding:14px 18px; text-align:right;">${actionHtml}</td>`;
            tbody.appendChild(tr);
        });
    },

    updateLeave: async function(leaveId, status) {
        if (status.toLowerCase() === 'approved') {
            const allLeaves = Store.getAllLeaves();
            const leave = allLeaves.find(l => l.id == leaveId || String(l.id) === String(leaveId));
            if (leave) {
                const balances = Store.getUserLeaveBalances(leave.userId, leaveId);
                const isWfh = this._isWfh(leave.type);
                const matchedPolicy = balances.find(b => {
                    if (isWfh) return b.name.toLowerCase().includes('wfh') || b.name.toLowerCase().includes('work from home');
                    return leave.type.toLowerCase().startsWith(b.name.toLowerCase()) || b.name.toLowerCase().startsWith(leave.type.toLowerCase());
                });
                const reqDays = this._calcDays(leave);
                if (matchedPolicy && reqDays > matchedPolicy.remaining) {
                    window.showInsufficientLeaveModal({
                        message: `Cannot approve leave: Employee requested <strong>${reqDays} day(s)</strong> of <strong>${matchedPolicy.name}</strong>, but only has <strong>${matchedPolicy.remaining} day(s)</strong> remaining.`,
                        requestedDays: reqDays,
                        availableDays: matchedPolicy.remaining,
                        leaveType: matchedPolicy.name,
                        balances
                    });
                    return;
                }
            }
        }
        const res = await Store.updateLeaveStatus(leaveId, status);
        if (res && !res.success) {
            if (res.error === 'INSUFFICIENT_LEAVE_BALANCE' || res.balances) {
                window.showInsufficientLeaveModal(res);
            } else {
                alert(res.message || 'Failed to update leave status.');
            }
            return;
        }
        this.renderLeaves();
        this.renderDashboard();
        this.updatePendingLeaveBadge();
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
            const dbUsers = (data.users || []).filter(u => u.is_active !== false);
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
                const isSuperAdmin = p.role === 'admin';
                const appAccess = isSuperAdmin ? 'Super Admin' : 'Artist / Team';
                const accessBadge = isSuperAdmin 
                    ? '<span class="status-pill pill-active">Super Admin</span>' 
                    : '<span class="status-pill pill-wfh">Team Member</span>';
                
                const initials = (fullName.split(' ').map(n=>n[0]).join('') || 'U').substring(0, 2).toUpperCase();
                const extra = Store.getExtraOff(p.id) || { leaves: 0, wfh: 0 };
                
                tr.innerHTML = `
                    <td>
                        <div class="user-cell">
                            <div class="user-cell-avatar">${initials}</div>
                            <div class="user-cell-info">
                                <span class="name">${fullName}</span>
                                <span class="dept">${email}</span>
                            </div>
                        </div>
                    </td>
                    <td><span style="color:var(--text-secondary); font-family:var(--font-mono); font-size:12px;">${email}</span></td>
                    <td><span class="status-pill pill-present">Active</span></td>
                    <td>${accessBadge}</td>
                    <td>
                        <div style="display:flex; gap:6px; align-items:center;">
                            <button class="btn-neutral btn-small" onclick="window.AdminUI.openUserDetail('${p.id}')">View Details</button>
                            <button class="btn-primary btn-small" onclick="window.AdminUI.openExtraOffModal('${p.id}', ${extra.leaves}, ${extra.wfh})">Extra Off</button>
                            ${p.id !== this.currentUser.id ? `<button class="btn-danger btn-small" onclick="window.AdminUI.deleteUser('${p.id}')">Remove</button>` : ''}
                        </div>
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
        const users = (this._cachedUsers && this._cachedUsers.length > 0) 
            ? this._cachedUsers 
            : (this.kitsuPersons && this.kitsuPersons.length > 0)
                ? this.kitsuPersons
                : this._mapUsersToPersons(Store.getUsers());
        
        let user = users.find(u => u.id === userId);
        if (!user) {
            const rawUser = Store.getUsers().find(u => u.id === userId);
            if (rawUser) {
                user = {
                    id: rawUser.id,
                    name: rawUser.name || rawUser.id,
                    email: rawUser.email || rawUser.id,
                    department: rawUser.department || 'Production',
                    role: rawUser.role || 'user'
                };
            }
        }
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
            const used = leaveRequests.filter(l => this._matchesType(l.type, t.name) && l.status === 'Approved')
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
        this._userDetailUserId = userId;
        this._renderUserDetailHistory('all');
        this._renderUserDetailAttendance(userId);

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
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:var(--text-muted); padding:20px;">No records found.</td></tr>';
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
                <td>${l.type}${l.isHalfDay ? ' <small style="color:var(--warning);">(Half)</small>' : ''}${l.isHistorical ? ' <small style="color:var(--text-muted);">(Migrated)</small>' : ''}</td>
                <td>${catBadge}</td>
                <td>${l.startDate}${l.startDate !== l.endDate ? ' → ' + l.endDate : ''}</td>
                <td>${days}</td>
                <td>${statusBadge}</td>
                <td style="min-width:80px;">
                    <button class="btn-small btn-primary" onclick="window.AdminUI.openEditLeaveModal('${l.id}')" style="width:auto; padding:4px 12px; margin:0;">Edit</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    },

    _renderUserDetailAttendance: function(userId) {
        const tbody = document.getElementById('user-detail-attendance-tbody');
        if (!tbody) return;

        const allAttendance = Store.getAttendance().filter(r => r.userId === userId);
        // Show last 7 records, most recent first
        const sorted = allAttendance.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 7);

        if (sorted.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--text-muted); padding:20px;">No attendance records found.</td></tr>';
            return;
        }

        tbody.innerHTML = '';
        sorted.forEach(r => {
            let statusLabel = r.status || 'unknown';
            let statusColor = '#475569';
            if (r.status === 'completed' || r.status === 'wfh_completed') statusColor = '#10b981';
            else if (r.status === 'working' || r.status === 'wfh_working') statusColor = '#f59e0b';
            else if (this._isPendingAttendanceStatus(r.status)) statusColor = '#f59e0b';

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${r.date}</td>
                <td>${r.checkInTime || '--:--'}</td>
                <td>${r.checkOutTime || '--:--'}</td>
                <td><span class="badge" style="background:${statusColor};color:white;">${statusLabel}</span></td>
                <td>
                    <button class="btn-small btn-reject" onclick="window.AdminUI.deleteAttendanceRecord('${userId}', '${r.date}')" title="Delete this attendance record">🗑️</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    },

    openEditLeaveModal: function(leaveId) {
        const allLeaves = Store.getAllLeaves();
        const leave = allLeaves.find(l => l.id == leaveId);
        if (!leave) { alert('Leave record not found.'); return; }

        document.getElementById('edit-leave-record-id').value = leave.id;
        document.getElementById('edit-leave-record-userid').value = leave.userId;
        document.getElementById('edit-leave-record-start').value = leave.startDate;
        document.getElementById('edit-leave-record-end').value = leave.endDate;
        document.getElementById('edit-leave-record-reason').value = leave.reason || '';
        document.getElementById('edit-leave-record-status').value = leave.status || 'Approved';

        // Populate type dropdown
        const typeSelect = document.getElementById('edit-leave-record-type');
        const leaveTypes = Store.getLeaveTypes();
        let options = '<option value="Work From Home">Work From Home</option>';
        leaveTypes.forEach(t => {
            if (!this._isWfh(t.name)) {
                options += `<option value="${t.name}">${t.name}</option>`;
            }
        });
        // Add half-day variants
        leaveTypes.forEach(t => {
            if (!this._isWfh(t.name)) {
                options += `<option value="${t.name} (Half Day)">${t.name} (Half Day)</option>`;
            }
        });
        typeSelect.innerHTML = options;
        typeSelect.value = leave.type;
        // If current type not in dropdown, add it
        if (typeSelect.value !== leave.type) {
            typeSelect.innerHTML += `<option value="${leave.type}" selected>${leave.type}</option>`;
        }

        // Wire up form submit & close
        const form = document.getElementById('edit-leave-form');
        const closeBtn = document.getElementById('close-edit-leave-modal');
        const modal = document.getElementById('edit-leave-modal');
        const overlay = modal.querySelector('.modal-overlay');
        const deleteBtn = document.getElementById('delete-edit-leave-btn');

        closeBtn.onclick = () => modal.classList.add('hidden');
        overlay.onclick = () => modal.classList.add('hidden');

        if (deleteBtn) {
            deleteBtn.onclick = async () => {
                modal.classList.add('hidden');
                await window.AdminUI.deleteLeaveRecord(leave.id);
            };
        }

        form.onsubmit = async (e) => {
            e.preventDefault();
            const updates = {
                type: document.getElementById('edit-leave-record-type').value,
                startDate: document.getElementById('edit-leave-record-start').value,
                endDate: document.getElementById('edit-leave-record-end').value,
                reason: document.getElementById('edit-leave-record-reason').value,
                status: document.getElementById('edit-leave-record-status').value
            };

            if (new Date(updates.startDate) > new Date(updates.endDate)) {
                alert('End date cannot be before start date.');
                return;
            }

            if (updates.status.toLowerCase() === 'approved') {
                const balances = Store.getUserLeaveBalances(leave.userId, leave.id);
                const isWfh = this._isWfh(updates.type);
                const matchedPolicy = balances.find(b => {
                    if (isWfh) return b.name.toLowerCase().includes('wfh') || b.name.toLowerCase().includes('work from home');
                    return updates.type.toLowerCase().startsWith(b.name.toLowerCase()) || b.name.toLowerCase().startsWith(updates.type.toLowerCase());
                });
                const isHalf = updates.type.toLowerCase().includes('half day');
                const reqDays = isHalf ? 0.5 : (Math.round(Math.abs(new Date(updates.endDate) - new Date(updates.startDate)) / 86400000) + 1);
                if (matchedPolicy && reqDays > matchedPolicy.remaining) {
                    window.showInsufficientLeaveModal({
                        message: `Cannot save leave: Employee requested <strong>${reqDays} day(s)</strong> of <strong>${matchedPolicy.name}</strong>, but only has <strong>${matchedPolicy.remaining} day(s)</strong> remaining.`,
                        requestedDays: reqDays,
                        availableDays: matchedPolicy.remaining,
                        leaveType: matchedPolicy.name,
                        balances
                    });
                    return;
                }
            }

            const res = await Store.editLeave(leave.id, updates);
            if (res && !res.success) {
                if (res.error === 'INSUFFICIENT_LEAVE_BALANCE' || res.balances) {
                    window.showInsufficientLeaveModal(res);
                } else {
                    alert(res.message || 'Failed to update leave.');
                }
                return;
            }

            await Store.syncWithBackend();
            modal.classList.add('hidden');
            // Refresh the user detail modal
            this.openUserDetail(leave.userId);
            this.renderDashboard();
        };

        modal.classList.remove('hidden');
    },

    deleteLeaveRecord: async function(leaveId) {
        if (!confirm('Are you sure you want to permanently delete this leave/WFH record?')) return;
        const leave = Store.getAllLeaves().find(l => l.id == leaveId);
        await Store.deleteLeave(leaveId);
        await Store.syncWithBackend();
        if (leave && this._userDetailUserId) {
            this.openUserDetail(this._userDetailUserId);
        }
        this.renderDashboard();
    },

    deleteAttendanceRecord: async function(userId, date) {
        if (!confirm(`Delete attendance record for ${date}? This cannot be undone.`)) return;
        await Store.deleteAttendanceRecord(userId, date);
        await Store.syncWithBackend();
        this._renderUserDetailAttendance(userId);
        this.renderDashboard();
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

    selectedCalDate: null,

    renderCalendar: function() {
        if (!this.currentCalDate) this.currentCalDate = new Date();
        const year = this.currentCalDate.getFullYear();
        const month = this.currentCalDate.getMonth();
        const todayStr = this.getTodayStr();
        
        if (!this.selectedCalDate) {
            this.selectedCalDate = todayStr;
        }

        // Title e.g. AUGUST 2026
        const monthName = this.currentCalDate.toLocaleString('default', { month: 'long', year: 'numeric' }).toUpperCase();
        const titleEl = document.getElementById('cal-month-title');
        if (titleEl) titleEl.textContent = monthName;

        // Today icon badge
        const todayDayNum = new Date().getDate();
        const todayIcon = document.getElementById('cal-today-day-icon');
        if (todayIcon) todayIcon.textContent = todayDayNum;

        const calContainer = document.getElementById('admin-calendar-grid');
        if (!calContainer) return;
        calContainer.innerHTML = '';

        // Monday-first offset: 0=Mon, 1=Tue, ..., 6=Sun
        const firstDaySundayBased = new Date(year, month, 1).getDay();
        const firstDayIndex = (firstDaySundayBased + 6) % 7;
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const prevMonthDays = new Date(year, month, 0).getDate();

        const allLeaves = Store.getAllLeaves().filter(l => l.status === 'Approved');
        const users = this.kitsuPersons && this.kitsuPersons.length > 0 ? this.kitsuPersons : Store.getUsers();
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
            const isSelected = (dateStr === this.selectedCalDate);
            const dayOfWeek = (new Date(year, month, day).getDay() + 6) % 7; // 6 is Sunday
            const isSunday = (dayOfWeek === 6);

            const folksOnLeave = allLeaves.filter(l => l.startDate <= dateStr && l.endDate >= dateStr);
            const holiday = holidays.find(h => h.date === dateStr);
            const hasWfh = folksOnLeave.some(l => this._isWfh(l.type));
            const hasLeave = folksOnLeave.some(l => !this._isWfh(l.type));

            let barsHTML = '';
            if (holiday) {
                barsHTML += `<div class="cal-bar holiday" title="Holiday: ${holiday.name}"></div>`;
            }
            if (hasWfh) {
                barsHTML += `<div class="cal-bar wfh" title="Team WFH"></div>`;
            }
            if (hasLeave) {
                barsHTML += `<div class="cal-bar leave" title="Team Leave"></div>`;
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
                this.selectCalendarDay(dateStr);
            };

            calContainer.appendChild(cell);
        }

        // 3. Next Month Dimmed Days to fill grid
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

        // Render Sidebar Agenda
        this.renderCalendarAgenda(this.selectedCalDate || todayStr);
    },

    selectCalendarDay: function(dateStr) {
        this.selectedCalDate = dateStr;
        // Update selection highlight in grid
        document.querySelectorAll('.cal-day-cell').forEach(c => {
            c.classList.remove('selected');
            if (c.getAttribute('data-date') === dateStr) {
                c.classList.add('selected');
            }
        });
        this.renderCalendarAgenda(dateStr);
    },

    renderCalendarAgenda: function(dateStr) {
        const [y, m, d] = dateStr.split('-').map(Number);
        const dateObj = new Date(y, m - 1, d);
        const dayNum = d;
        const dayName = dateObj.toLocaleString('default', { weekday: 'short' }).toUpperCase();
        const monthShort = dateObj.toLocaleString('default', { month: 'short' });

        const numEl = document.getElementById('cal-sel-day-num');
        const nameEl = document.getElementById('cal-sel-day-name');
        const quickAddLabel = document.getElementById('cal-quick-add-label');

        if (numEl) numEl.textContent = dayNum;
        if (nameEl) nameEl.textContent = dayName;
        if (quickAddLabel) quickAddLabel.textContent = `Add on ${dayNum} ${monthShort}`;

        const container = document.getElementById('cal-agenda-container');
        if (!container) return;
        container.innerHTML = '';

        const allLeaves = Store.getAllLeaves().filter(l => l.status === 'Approved' && l.startDate <= dateStr && l.endDate >= dateStr);
        const holidays = Store.getHolidays().filter(h => h.date === dateStr);
        const users = this.kitsuPersons && this.kitsuPersons.length > 0 ? this.kitsuPersons : Store.getUsers();

        let totalEvents = 0;

        // 1. Holidays
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

        // 2. Approved WFH & Leaves
        allLeaves.forEach(l => {
            totalEvents++;
            const user = users.find(u => u.id === l.userId);
            const fullName = user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.name || user.id : (l.userName || l.userId);
            const isWfh = this._isWfh(l.type);
            const isHalf = l.isHalfDay || (l.type || '').toLowerCase().includes('half day');

            const card = document.createElement('div');
            card.className = `cal-event-card ${isWfh ? 'wfh' : 'leave'}`;
            card.innerHTML = `
                <div class="cal-event-icon"><ion-icon name="${isWfh ? 'home' : 'airplane'}"></ion-icon></div>
                <div class="cal-event-info">
                    <h4>${fullName}</h4>
                    <p>${isWfh ? 'Work From Home' : (l.type || 'Planned Leave')}${isHalf ? ' (Half Day)' : ''}</p>
                </div>
                <span class="cal-event-badge" style="background:${isWfh ? 'rgba(6,182,212,0.2)' : 'rgba(139,92,246,0.2)'}; color:${isWfh ? '#06b6d4' : '#8b5cf6'};">${isWfh ? 'WFH' : 'Leave'}</span>
            `;
            container.appendChild(card);
        });

        if (totalEvents === 0) {
            container.innerHTML = `
                <div class="cal-empty-day">
                    <ion-icon name="calendar-outline" style="font-size:36px; color:#334155; margin-bottom:8px;"></ion-icon>
                    <h4 style="color:#e2e8f0; margin:0 0 4px 0; font-size:14px;">No Events Scheduled</h4>
                    <p>No studio holidays or planned artist leaves on this date.</p>
                </div>
            `;
        }
    },

    openAddHolidayModalForSelectedDay: function() {
        const dateStr = this.selectedCalDate || this.getTodayStr();
        const holModal = document.getElementById('holiday-modal');
        if (holModal) {
            document.getElementById('holiday-form')?.reset();
            const dateInput = document.getElementById('holiday-date-input');
            if (dateInput) dateInput.value = dateStr;
            holModal.classList.remove('hidden');
        } else if (typeof this.openEditHolidayModal === 'function') {
            this.openEditHolidayModal(dateStr, '', 'Public');
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
    },

    // ============================================================
    // Employee History Tab
    // ============================================================

    _historyAttChart: null,
    _historyTrendChart: null,
    _historyTimingChart: null,
    _historyWorkHoursChart: null,
    _historyData: null,
    _historyUserId: null,

    renderHistoryTab: async function() {
        // Populate user dropdown with database users or fallback Store users
        try {
            let dbUsers = [];
            try {
                const res = await fetch('/api/sync/store');
                if (res.ok) {
                    const data = await res.json();
                    dbUsers = (data.users || []).filter(u => u.role !== 'admin');
                }
            } catch (e) {}

            if (!dbUsers.length && typeof Store !== 'undefined' && Store.getUsers) {
                dbUsers = (Store.getUsers() || []).filter(u => u.role !== 'admin');
            }

            const select = document.getElementById('history-user-select');
            if (select) {
                const currentVal = select.value;
                select.innerHTML = '<option value="">— Select Employee —</option>' +
                    dbUsers.map(u => `<option value="${u.id}"${u.id === currentVal ? ' selected' : ''}>${u.name} (${u.department || 'Artist'})</option>`).join('');
            }
        } catch (e) {
            console.error('Error populating history user dropdown:', e);
        }
    },

    setHistoryPeriod: function(periodKey) {
        this._historyPeriod = periodKey;
        
        // Update preset button active classes
        document.querySelectorAll('#history-preset-pills .hist-preset-btn').forEach(btn => {
            if (btn.dataset.period === periodKey) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        // Toggle custom date range container
        const customEl = document.getElementById('history-custom-range');
        if (customEl) {
            if (periodKey === 'custom') {
                customEl.style.display = 'inline-flex';
                customEl.classList.remove('hidden');
            } else {
                customEl.style.display = 'none';
                customEl.classList.add('hidden');
            }
        }

        const userSelect = document.getElementById('history-user-select');
        if (userSelect && userSelect.value) {
            this.loadEmployeeHistory(userSelect.value);
        }
    },

    applyCustomHistoryDates: function() {
        const from = document.getElementById('history-custom-from')?.value;
        const to = document.getElementById('history-custom-to')?.value;
        if (from && to) {
            this._historyCustomFrom = from;
            this._historyCustomTo = to;
            const userSelect = document.getElementById('history-user-select');
            if (userSelect && userSelect.value) {
                this.loadEmployeeHistory(userSelect.value);
            }
        }
    },

    _getHistoryDateRange: function() {
        const period = this._historyPeriod || 'this_month';
        const now = new Date();
        const istNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
        let fromDate, toDate, label;

        if (period === 'this_month' || period === 'monthly') {
            fromDate = `${istNow.getFullYear()}-${String(istNow.getMonth()+1).padStart(2,'0')}-01`;
            toDate = `${istNow.getFullYear()}-${String(istNow.getMonth()+1).padStart(2,'0')}-${String(istNow.getDate()).padStart(2,'0')}`;
            label = istNow.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
        } else if (period === 'last_month') {
            const prevMonth = new Date(istNow.getFullYear(), istNow.getMonth() - 1, 1);
            const prevMonthEnd = new Date(istNow.getFullYear(), istNow.getMonth(), 0);
            fromDate = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth()+1).padStart(2,'0')}-01`;
            toDate = `${prevMonthEnd.getFullYear()}-${String(prevMonthEnd.getMonth()+1).padStart(2,'0')}-${String(prevMonthEnd.getDate()).padStart(2,'0')}`;
            label = prevMonth.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
        } else if (period === 'last_30_days') {
            const d30 = new Date(istNow.getTime() - 30 * 24 * 60 * 60 * 1000);
            fromDate = `${d30.getFullYear()}-${String(d30.getMonth()+1).padStart(2,'0')}-${String(d30.getDate()).padStart(2,'0')}`;
            toDate = `${istNow.getFullYear()}-${String(istNow.getMonth()+1).padStart(2,'0')}-${String(istNow.getDate()).padStart(2,'0')}`;
            label = 'Last 30 Days';
        } else if (period === 'last_90_days') {
            const d90 = new Date(istNow.getTime() - 90 * 24 * 60 * 60 * 1000);
            fromDate = `${d90.getFullYear()}-${String(d90.getMonth()+1).padStart(2,'0')}-${String(d90.getDate()).padStart(2,'0')}`;
            toDate = `${istNow.getFullYear()}-${String(istNow.getMonth()+1).padStart(2,'0')}-${String(istNow.getDate()).padStart(2,'0')}`;
            label = 'Last 90 Days';
        } else if (period === 'custom') {
            fromDate = this._historyCustomFrom || document.getElementById('history-custom-from')?.value || `${istNow.getFullYear()}-${String(istNow.getMonth()+1).padStart(2,'0')}-01`;
            toDate = this._historyCustomTo || document.getElementById('history-custom-to')?.value || `${istNow.getFullYear()}-${String(istNow.getMonth()+1).padStart(2,'0')}-${String(istNow.getDate()).padStart(2,'0')}`;
            label = `${fromDate} → ${toDate}`;
        } else if (period === 'yearly') {
            fromDate = `${istNow.getFullYear()}-01-01`;
            toDate = `${istNow.getFullYear()}-${String(istNow.getMonth()+1).padStart(2,'0')}-${String(istNow.getDate()).padStart(2,'0')}`;
            label = `${istNow.getFullYear()} Year to Date`;
        } else {
            fromDate = '2020-01-01';
            toDate = '2099-12-31';
            label = 'All Time';
        }

        return { fromDate, toDate, label };
    },

    loadEmployeeHistory: async function(userId) {
        if (!userId) {
            document.getElementById('history-placeholder')?.classList.remove('hidden');
            document.getElementById('history-content')?.classList.add('hidden');
            return;
        }

        document.getElementById('history-placeholder')?.classList.add('hidden');
        document.getElementById('history-content')?.classList.remove('hidden');

        this._historyUserId = userId;

        try {
            let data = null;
            try {
                const res = await fetch(`/api/users/${encodeURIComponent(userId)}/history`);
                if (res.ok) {
                    data = await res.json();
                }
            } catch (e) {}

            if (!data) {
                // Fallback to local Store
                const att = (typeof Store !== 'undefined' && Store.getAttendance) ? Store.getAttendance().filter(a => a.userId === userId) : [];
                const lvs = (typeof Store !== 'undefined' && Store.getUserLeaves) ? Store.getUserLeaves(userId) : [];
                data = { attendance: att, leaves: lvs };
            }

            this._historyData = data;

            // Compute date range filter based on selected period
            const { fromDate, toDate, label } = this._getHistoryDateRange();

            // Sync date inputs if present
            const customFromInput = document.getElementById('history-custom-from');
            const customToInput = document.getElementById('history-custom-to');
            if (customFromInput && !customFromInput.value) customFromInput.value = fromDate;
            if (customToInput && !customToInput.value) customToInput.value = toDate;

            // Filter data by period
            const attendance = data.attendance.filter(a => a.date >= fromDate && a.date <= toDate);
            const leaves = data.leaves.filter(l => l.startDate >= fromDate || l.endDate >= fromDate);

            // Compute stats
            const daysPresent = attendance.filter(a => a.checkInTime).length;
            const lateLogins = attendance.filter(a => a.isLateLogin).length;
            const earlyLogouts = attendance.filter(a => a.isEarlyLogout && a.checkOutTime).length;
            const wfhLeaves = leaves.filter(l => this._isWfh(l.type) && l.status === 'Approved');
            const nonWfhLeaves = leaves.filter(l => !this._isWfh(l.type) && l.status === 'Approved');
            const autoApplied = leaves.filter(l => l.isAutoApplied);

            // WFH days
            let wfhDays = 0;
            wfhLeaves.forEach(l => wfhDays += this._calcDays(l));

            // Total leave days
            let totalLeaveDays = 0;
            nonWfhLeaves.forEach(l => totalLeaveDays += this._calcDays(l));

            // Calculate working days in period for attendance %
            const settings = JSON.parse(localStorage.getItem('studioSettings') || '{}');
            const workDaysPerWeek = settings.workDays || 6;
            const holidays = (typeof Store !== 'undefined' && Store.getHolidays) ? Store.getHolidays().filter(h => h.date >= fromDate && h.date <= toDate && h.type !== 'Optional') : [];

            let workingDays = 0;
            const d = new Date(fromDate + 'T00:00:00');
            const endD = new Date(toDate + 'T00:00:00');
            while (d <= endD) {
                const dow = d.getDay();
                const dStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
                const isHoliday = holidays.some(h => h.date === dStr);
                if (!isHoliday) {
                    if (workDaysPerWeek === 5 && dow !== 0 && dow !== 6) workingDays++;
                    else if (workDaysPerWeek === 6 && dow !== 0) workingDays++;
                    else if (workDaysPerWeek === 7) workingDays++;
                }
                d.setDate(d.getDate() + 1);
            }

            const attendancePct = workingDays > 0 ? Math.round((daysPresent / workingDays) * 100) : 0;

            // Update stat cards
            const attEl = document.getElementById('hist-stat-attendance');
            const attBadge = document.getElementById('hist-stat-present-badge');
            const presEl = document.getElementById('hist-stat-present');
            const lvsWfhEl = document.getElementById('hist-stat-leaves-wfh');
            const punctEl = document.getElementById('hist-stat-punctuality');
            const earlyBadge = document.getElementById('hist-stat-early-badge');

            if (attEl) attEl.textContent = attendancePct + '%';
            if (attBadge) attBadge.textContent = `▲ ${daysPresent} Days Present (${label})`;
            if (presEl) presEl.textContent = daysPresent;
            if (lvsWfhEl) lvsWfhEl.textContent = `${totalLeaveDays}L / ${wfhDays} WFH`;
            if (punctEl) punctEl.textContent = `${lateLogins} Late`;
            if (earlyBadge) earlyBadge.textContent = `${earlyLogouts} Early Logouts`;

            // Render Charts
            this._renderHistoryCharts(daysPresent, totalLeaveDays, wfhDays, lateLogins, workingDays, attendance);

            // Render current view
            const currentView = document.querySelector('.history-detail-tab.active')?.dataset?.view || 'attendance';
            this.switchHistoryView(currentView);

        } catch (err) {
            console.error('Error loading employee history:', err);
            const content = document.getElementById('history-content');
            if (content) content.innerHTML = '<p style="color:var(--danger); text-align:center; padding:40px;">Failed to load employee history.</p>';
        }
    },

    _renderHistoryCharts: function(present, leaves, wfh, late, total, attendance) {
        // 1. Monthly Attendance Trend (Top-Left Smooth Curved Spline Area Chart)
        const trendCtx = document.getElementById('historyTrendChart');
        if (trendCtx) {
            if (this._historyTrendChart) this._historyTrendChart.destroy();

            const monthLabels = [];
            const presentData = [];
            const onTimeData = [];
            const now = new Date();

            for (let m = 5; m >= 0; m--) {
                const d = new Date(now.getFullYear(), now.getMonth() - m, 1);
                const mStr = d.toLocaleString('default', { month: 'short' });
                monthLabels.push(mStr);
                const mStart = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;
                const mEnd = new Date(d.getFullYear(), d.getMonth()+1, 0);
                const mEndStr = `${mEnd.getFullYear()}-${String(mEnd.getMonth()+1).padStart(2,'0')}-${String(mEnd.getDate()).padStart(2,'0')}`;

                const allAtt = (this._historyData?.attendance || attendance);
                const mRecords = allAtt.filter(a => a.date >= mStart && a.date <= mEndStr);
                const mPresent = mRecords.filter(a => a.checkInTime).length;
                const mLate = mRecords.filter(a => a.isLateLogin).length;
                presentData.push(mPresent);
                onTimeData.push(Math.max(0, mPresent - mLate));
            }

            const ctx2d = trendCtx.getContext('2d');
            const gradient = ctx2d.createLinearGradient(0, 0, 0, 240);
            gradient.addColorStop(0, 'rgba(59, 130, 246, 0.28)');
            gradient.addColorStop(1, 'rgba(59, 130, 246, 0.0)');

            this._historyTrendChart = new Chart(trendCtx, {
                type: 'line',
                data: {
                    labels: monthLabels,
                    datasets: [
                        {
                            label: 'Days Worked',
                            data: presentData,
                            borderColor: '#3b82f6',
                            borderWidth: 2.5,
                            backgroundColor: gradient,
                            fill: true,
                            tension: 0.42,
                            pointRadius: 3,
                            pointHoverRadius: 6,
                            pointHoverBackgroundColor: '#3b82f6',
                            pointHoverBorderColor: '#ffffff',
                            pointHoverBorderWidth: 2
                        },
                        {
                            label: 'On-Time Shifts',
                            data: onTimeData,
                            borderColor: '#f59e0b',
                            borderWidth: 2,
                            borderDash: [4, 4],
                            backgroundColor: 'transparent',
                            fill: false,
                            tension: 0.42,
                            pointRadius: 3,
                            pointHoverRadius: 5,
                            pointHoverBackgroundColor: '#f59e0b'
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    plugins: {
                        legend: {
                            display: true,
                            position: 'bottom',
                            labels: { color: '#94a3b8', usePointStyle: true, boxWidth: 6, font: { size: 11 } }
                        },
                        tooltip: {
                            backgroundColor: '#0a0c10',
                            titleColor: '#e2e8f0',
                            bodyColor: '#38bdf8',
                            borderColor: 'rgba(255,255,255,0.1)',
                            borderWidth: 1,
                            padding: 10
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            grid: { color: 'rgba(255,255,255,0.04)' },
                            ticks: { color: '#64748b', font: { size: 11 }, stepSize: 5 }
                        },
                        x: {
                            grid: { display: false },
                            ticks: { color: '#64748b', font: { size: 11 } }
                        }
                    }
                }
            });
        }

        // Robust time parser for ISO strings, SQL timestamps, and 12h/24h strings
        const _parseTimeToDecimal = (timeStr) => {
            if (!timeStr || timeStr === '--:--' || timeStr === '-') return null;
            const strVal = String(timeStr).trim();

            // Match full date/timestamp: "2026-08-06 05:34:33" or "2026-08-06T05:34:33Z"
            const match = strVal.match(/(\d{4}-\d{2}-\d{2})[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?/);
            if (match) {
                let h = parseInt(match[2], 10);
                let m = parseInt(match[3], 10);
                // If stored in UTC (<= 16), add 5h 30m for IST
                if (h <= 16) {
                    const totalMins = h * 60 + m + 330;
                    h = Math.floor(totalMins / 60) % 24;
                    m = totalMins % 60;
                }
                return Math.round((h + m / 60) * 100) / 100;
            }

            // Match standard 12-hour or 24-hour time string like "09:30 AM", "14:15", "9:15"
            const timeMatch = strVal.replace(/\s*\(.*?\)\s*/g, '').trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?$/i);
            if (timeMatch) {
                let h = parseInt(timeMatch[1], 10);
                const m = parseInt(timeMatch[2], 10);
                const ampm = timeMatch[3]?.toLowerCase();
                if (ampm === 'pm' && h < 12) h += 12;
                if (ampm === 'am' && h === 12) h = 0;
                return Math.round((h + m / 60) * 100) / 100;
            }

            return null;
        };

        const _formatDecimalToTime = (val) => {
            if (val === null || val === undefined || isNaN(val)) return '--:--';
            const totalMin = Math.round(val * 60);
            let h = Math.floor(totalMin / 60);
            const m = totalMin % 60;
            const ampm = h >= 12 ? 'PM' : 'AM';
            const h12 = h > 12 ? h - 12 : (h === 0 ? 12 : h);
            return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
        };

        // Filter and sort attendance chronologically by date
        const sortedLogs = [...attendance]
            .filter(a => a.date)
            .sort((a, b) => a.date.localeCompare(b.date));

        const dateLabels = [];
        const loginData = [];
        const logoutData = [];
        const workHoursData = [];
        const targetHoursData = [];

        sortedLogs.forEach(r => {
            const dObj = new Date(r.date + 'T00:00:00');
            const dateLabel = isNaN(dObj.getTime()) ? r.date : dObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            dateLabels.push(dateLabel);

            const inDec = _parseTimeToDecimal(r.checkInTime);
            const outDec = _parseTimeToDecimal(r.checkOutTime);
            loginData.push(inDec);
            logoutData.push(outDec);

            // Compute work hours
            let hrs = 0;
            if (r.hoursWorked) {
                hrs = parseFloat(r.hoursWorked);
            } else if (inDec !== null && outDec !== null && outDec > inDec) {
                hrs = Math.round((outDec - inDec) * 10) / 10;
            }
            workHoursData.push(hrs);
            targetHoursData.push(8.0);
        });

        // 2. Daily Work Hours Chart (Bar Chart with Benchmark Line)
        const workHoursCtx = document.getElementById('historyWorkHoursChart');
        if (workHoursCtx) {
            if (this._historyWorkHoursChart) this._historyWorkHoursChart.destroy();

            this._historyWorkHoursChart = new Chart(workHoursCtx, {
                type: 'bar',
                data: {
                    labels: dateLabels.length > 0 ? dateLabels : ['No Data'],
                    datasets: [
                        {
                            type: 'line',
                            label: 'Target Benchmark (8.0h)',
                            data: targetHoursData.length > 0 ? targetHoursData : [8.0],
                            borderColor: '#f59e0b',
                            borderWidth: 2,
                            borderDash: [5, 5],
                            pointRadius: 0,
                            fill: false
                        },
                        {
                            type: 'bar',
                            label: 'Hours Worked',
                            data: workHoursData.length > 0 ? workHoursData : [0],
                            backgroundColor: workHoursData.map(h => h >= 8.0 ? '#10b981' : (h > 0 ? '#38bdf8' : '#334155')),
                            borderRadius: 4,
                            barPercentage: 0.65
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    plugins: {
                        legend: {
                            display: true,
                            position: 'bottom',
                            labels: { color: '#94a3b8', usePointStyle: true, boxWidth: 6, font: { size: 11 } }
                        },
                        tooltip: {
                            backgroundColor: '#0a0c10',
                            titleColor: '#e2e8f0',
                            bodyColor: '#38bdf8',
                            borderColor: 'rgba(255,255,255,0.1)',
                            borderWidth: 1,
                            padding: 10,
                            callbacks: {
                                label: (context) => ` ${context.dataset.label}: ${context.raw}h`
                            }
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            max: 16,
                            grid: { color: 'rgba(255,255,255,0.04)' },
                            ticks: {
                                color: '#64748b',
                                font: { size: 11 },
                                callback: val => `${val}h`
                            }
                        },
                        x: {
                            grid: { display: false },
                            ticks: {
                                color: '#64748b',
                                font: { size: 11 },
                                autoSkip: true,
                                maxTicksLimit: 15,
                                maxRotation: 0,
                                minRotation: 0
                            }
                        }
                    }
                }
            });
        }

        // 3. Login & Logout Timing Timeline (Date on X-axis, Time on Y-axis)
        const timingCtx = document.getElementById('historyTimingChart');
        if (timingCtx) {
            if (this._historyTimingChart) this._historyTimingChart.destroy();

            this._historyTimingChart = new Chart(timingCtx, {
                type: 'line',
                data: {
                    labels: dateLabels.length > 0 ? dateLabels : ['No Data'],
                    datasets: [
                        {
                            label: '🟢 Login (Check-In)',
                            data: loginData.length > 0 ? loginData : [null],
                            borderColor: '#10b981',
                            backgroundColor: 'rgba(16, 185, 129, 0.14)',
                            borderWidth: 2.5,
                            tension: 0.3,
                            pointRadius: dateLabels.length > 45 ? 2.5 : 4.5,
                            pointHoverRadius: 7,
                            pointBackgroundColor: '#10b981',
                            pointBorderColor: '#ffffff',
                            pointBorderWidth: 2,
                            spanGaps: true
                        },
                        {
                            label: '🔵 Logout (Check-Out)',
                            data: logoutData.length > 0 ? logoutData : [null],
                            borderColor: '#38bdf8',
                            backgroundColor: 'rgba(56, 189, 248, 0.14)',
                            borderWidth: 2.5,
                            tension: 0.3,
                            pointRadius: dateLabels.length > 45 ? 2.5 : 4.5,
                            pointHoverRadius: 7,
                            pointBackgroundColor: '#38bdf8',
                            pointBorderColor: '#ffffff',
                            pointBorderWidth: 2,
                            spanGaps: true
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    plugins: {
                        legend: {
                            display: true,
                            position: 'bottom',
                            labels: { color: '#94a3b8', usePointStyle: true, boxWidth: 6, font: { size: 11.5 } }
                        },
                        tooltip: {
                            backgroundColor: '#0a0c10',
                            titleColor: '#ffffff',
                            bodyColor: '#38bdf8',
                            borderColor: 'rgba(255,255,255,0.12)',
                            borderWidth: 1,
                            padding: 12,
                            callbacks: {
                                title: context => {
                                    const idx = context[0].dataIndex;
                                    const r = sortedLogs[idx];
                                    if (!r) return '';
                                    const dayName = new Date(r.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
                                    return `📅 ${dayName}`;
                                },
                                label: context => {
                                    const val = context.raw;
                                    if (val === null || val === undefined) return ` ${context.dataset.label}: No Punch`;
                                    const formatted = _formatDecimalToTime(val);
                                    return ` ${context.dataset.label}: ${formatted}`;
                                },
                                afterBody: context => {
                                    const idx = context[0].dataIndex;
                                    const inD = loginData[idx];
                                    const outD = logoutData[idx];
                                    if (inD !== null && outD !== null && outD > inD) {
                                        const dur = Math.round((outD - inD) * 10) / 10;
                                        return [`⏱️ Shift Duration: ${dur} hrs`];
                                    }
                                    return [];
                                }
                            }
                        }
                    },
                    scales: {
                        y: {
                            min: 5,
                            max: 25,
                            grid: { color: 'rgba(255,255,255,0.04)' },
                            ticks: {
                                color: '#64748b',
                                font: { size: 11 },
                                stepSize: 2,
                                callback: function(val) {
                                    return _formatDecimalToTime(val);
                                }
                            }
                        },
                        x: {
                            grid: { color: 'rgba(255,255,255,0.02)' },
                            ticks: {
                                color: '#64748b',
                                font: { size: 11 },
                                autoSkip: true,
                                maxTicksLimit: 16,
                                maxRotation: 0,
                                minRotation: 0
                            }
                        }
                    }
                }
            });
        }
    },

    switchHistoryView: function(view) {
        // Update tab buttons
        document.querySelectorAll('.history-detail-tab').forEach(btn => {
            btn.classList.remove('active', 'btn-primary');
            btn.classList.add('btn-neutral');
        });
        const activeBtn = document.querySelector(`.history-detail-tab[data-view="${view}"]`);
        if (activeBtn) { activeBtn.classList.add('active', 'btn-primary'); activeBtn.classList.remove('btn-neutral'); }

        // Hide all views
        ['attendance', 'leaves', 'wfh', 'late', 'early', 'auto'].forEach(v => {
            const el = document.getElementById(`history-view-${v}`);
            if (el) el.classList.add('hidden');
        });
        const viewEl = document.getElementById(`history-view-${view}`);
        if (viewEl) viewEl.classList.remove('hidden');

        if (!this._historyData) return;

        const data = this._historyData;
        const { fromDate, toDate } = this._getHistoryDateRange();

        const attendance = data.attendance.filter(a => a.date >= fromDate && a.date <= toDate);
        const leaves = data.leaves.filter(l => l.startDate >= fromDate || l.endDate >= fromDate);

        const _getDayName = (dateStr) => new Date(dateStr).toLocaleDateString('en-US', { weekday: 'short' });

        const _parseTimeMinutes = (timeStr) => {
            if (!timeStr || timeStr === '--:--') return null;
            const match = timeStr.match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i);
            if (!match) return null;
            let h = parseInt(match[1], 10);
            const m = parseInt(match[2], 10);
            const ampm = match[3]?.toLowerCase();
            if (ampm === 'pm' && h < 12) h += 12;
            if (ampm === 'am' && h === 12) h = 0;
            return h * 60 + m;
        };

        if (view === 'attendance') {
            const tbody = document.getElementById('history-attendance-tbody');
            if (tbody) tbody.innerHTML = '';
            const countEl = document.getElementById('history-records-count');
            if (countEl) countEl.textContent = `${attendance.length} records logged`;
            if (attendance.length === 0) {
                if (tbody) tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:30px;">No attendance records found.</td></tr>';
                return;
            }
            attendance.forEach(r => {
                const isWfh = this._isWfhAttendanceStatus(r.status);
                let statusBadge = '<span class="status-pill pill-approved">Completed</span>';
                if (r.status === 'working' || r.status === 'wfh_working') statusBadge = '<span class="status-pill pill-late">Working</span>';
                else if (r.status === 'half_day') statusBadge = '<span class="status-pill pill-purple">Half Day</span>';

                let hoursStr = '--';
                let pct = 0;
                if (r.hoursWorked) {
                    hoursStr = r.hoursWorked + 'h';
                    pct = Math.min(100, (parseFloat(r.hoursWorked) / 8) * 100);
                } else if (r.checkInTime && r.checkOutTime) {
                    const inM = _parseTimeMinutes(r.checkInTime);
                    const outM = _parseTimeMinutes(r.checkOutTime);
                    if (inM !== null && outM !== null && outM > inM) {
                        const hrs = (outM - inM) / 60;
                        hoursStr = hrs.toFixed(1) + 'h';
                        pct = Math.min(100, (hrs / 8) * 100);
                    }
                }

                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td style="padding:14px 16px; color:#ffffff; font-weight:600;">${r.date}</td>
                    <td style="padding:14px 16px; color:#94a3b8;">${_getDayName(r.date)}</td>
                    <td style="padding:14px 16px; color:#cbd5e1;"><ion-icon name="time-outline" style="vertical-align:middle; color:#64748b; margin-right:4px;"></ion-icon>${r.checkInTime || '--:--'}</td>
                    <td style="padding:14px 16px; color:#cbd5e1;">${r.checkOutTime || '--:--'}</td>
                    <td style="padding:14px 16px;">
                        <div style="display:flex; align-items:center; gap:8px;">
                            <strong style="color:#ffffff; font-size:13.5px;">${hoursStr}</strong>
                            ${hoursStr !== '--' ? `<div style="width:45px; height:4px; background:rgba(255,255,255,0.08); border-radius:2px; overflow:hidden;"><div style="width:${pct}%; height:100%; background:#38bdf8; border-radius:2px;"></div></div>` : ''}
                        </div>
                    </td>
                    <td style="padding:14px 16px;">
                        <span style="background:${isWfh ? 'rgba(6,182,212,0.12)' : 'rgba(59,130,246,0.12)'}; color:${isWfh ? '#06b6d4' : '#38bdf8'}; border:1px solid ${isWfh ? 'rgba(6,182,212,0.25)' : 'rgba(59,130,246,0.25)'}; padding:3px 8px; border-radius:6px; font-size:11.5px; font-weight:600;">
                            ${isWfh ? '🏠 WFH' : '🏢 In-Studio'}
                        </span>
                    </td>
                    <td style="padding:14px 16px; text-align:right;">${statusBadge}</td>
                `;
                if (tbody) tbody.appendChild(tr);
            });
        }
        else if (view === 'leaves') {
            const tbody = document.getElementById('history-leaves-tbody');
            if (tbody) tbody.innerHTML = '';
            const leaveOnly = leaves.filter(l => !this._isWfh(l.type));
            const countEl = document.getElementById('history-records-count');
            if (countEl) countEl.textContent = `${leaveOnly.length} leave requests logged`;
            if (leaveOnly.length === 0) {
                if (tbody) tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:30px;">No leave records found.</td></tr>';
                return;
            }
            leaveOnly.forEach(l => {
                const days = this._calcDays(l);
                let statusBadge = '<span class="status-pill pill-approved">Approved</span>';
                if (l.status === 'Pending') statusBadge = '<span class="status-pill pill-late">Pending</span>';
                else if (l.status === 'Rejected') statusBadge = '<span class="status-pill pill-rejected">Rejected</span>';

                let source = '<span style="color:#64748b; font-size:12px;">Manual</span>';
                if (l.isAutoApplied) source = '<span class="status-pill pill-late" style="font-size:11px;">🤖 Auto</span>';
                else if (l.isHistorical) source = '<span class="status-pill" style="background:rgba(255,255,255,0.05); color:#94a3b8; font-size:11px;">Migrated</span>';

                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td style="padding:14px 16px; color:#ffffff; font-weight:600;">${l.type}${l.isHalfDay ? ' <small style="color:#f59e0b;">(Half)</small>' : ''}</td>
                    <td style="padding:14px 16px;"><span class="status-pill pill-purple">Leave</span></td>
                    <td style="padding:14px 16px; color:#cbd5e1;">${l.startDate}${l.startDate !== l.endDate ? ' → ' + l.endDate : ''}</td>
                    <td style="padding:14px 16px; color:#ffffff; font-weight:600;">${days}</td>
                    <td style="padding:14px 16px; color:#94a3b8; max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${(l.reason||'').replace(/"/g, '&quot;')}">${l.reason || '-'}</td>
                    <td style="padding:14px 16px;">${source}</td>
                    <td style="padding:14px 16px; text-align:right;">${statusBadge}</td>
                `;
                if (tbody) tbody.appendChild(tr);
            });
        }
        else if (view === 'wfh') {
            const tbody = document.getElementById('history-wfh-tbody');
            if (tbody) tbody.innerHTML = '';
            const wfhOnly = leaves.filter(l => this._isWfh(l.type));
            const countEl = document.getElementById('history-records-count');
            if (countEl) countEl.textContent = `${wfhOnly.length} WFH days logged`;
            if (wfhOnly.length === 0) {
                if (tbody) tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:30px;">No WFH records found.</td></tr>';
                return;
            }
            wfhOnly.forEach(l => {
                const days = this._calcDays(l);
                let statusBadge = '<span class="status-pill pill-approved">Approved</span>';
                if (l.status === 'Pending') statusBadge = '<span class="status-pill pill-late">Pending</span>';
                else if (l.status === 'Rejected') statusBadge = '<span class="status-pill pill-rejected">Rejected</span>';

                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td style="padding:14px 16px; color:#ffffff; font-weight:600;">${l.startDate}${l.startDate !== l.endDate ? ' → ' + l.endDate : ''}</td>
                    <td style="padding:14px 16px; color:#ffffff; font-weight:600;">${days}</td>
                    <td style="padding:14px 16px; color:#94a3b8; max-width:250px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${l.reason || '-'}</td>
                    <td style="padding:14px 16px; text-align:right;">${statusBadge}</td>
                `;
                if (tbody) tbody.appendChild(tr);
            });
        }
        else if (view === 'late') {
            const tbody = document.getElementById('history-late-tbody');
            if (tbody) tbody.innerHTML = '';
            const lateRecords = attendance.filter(a => a.isLateLogin);
            const countEl = document.getElementById('history-records-count');
            if (countEl) countEl.textContent = `${lateRecords.length} late logins logged`;
            if (lateRecords.length === 0) {
                if (tbody) tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:30px;">No late logins found. 🎉</td></tr>';
                return;
            }
            lateRecords.forEach(r => {
                const checkInMin = _parseTimeMinutes(r.checkInTime);
                const expectedMin = 11 * 60;
                const delayMin = checkInMin !== null ? Math.max(0, checkInMin - expectedMin) : 0;
                const delayStr = delayMin > 0 ? `${Math.floor(delayMin / 60)}h ${delayMin % 60}m` : '—';

                const isWfh = this._isWfhAttendanceStatus(r.status);
                const statusLabel = isWfh ? '🏠 WFH' : '🏢 In-Studio';

                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td style="padding:14px 16px; color:#ffffff; font-weight:600;">${r.date}</td>
                    <td style="padding:14px 16px; color:#94a3b8;">${_getDayName(r.date)}</td>
                    <td style="padding:14px 16px;"><strong style="color:#f59e0b;">${r.checkInTime}</strong></td>
                    <td style="padding:14px 16px;"><span class="status-pill pill-late">${delayStr}</span></td>
                    <td style="padding:14px 16px; text-align:right;"><span style="color:#94a3b8; font-size:12px;">${statusLabel}</span></td>
                `;
                if (tbody) tbody.appendChild(tr);
            });
        }
        else if (view === 'early') {
            const tbody = document.getElementById('history-early-tbody');
            if (tbody) tbody.innerHTML = '';
            const earlyRecords = attendance.filter(a => a.isEarlyLogout && a.checkOutTime);
            const countEl = document.getElementById('history-records-count');
            if (countEl) countEl.textContent = `${earlyRecords.length} early logouts logged`;
            if (earlyRecords.length === 0) {
                if (tbody) tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:30px;">No early logouts found. 🎉</td></tr>';
                return;
            }
            earlyRecords.forEach(r => {
                const hrs = parseFloat(r.hoursWorked || 0);
                const deficit = Math.max(0, 8 - hrs).toFixed(1);
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td style="padding:14px 16px; color:#ffffff; font-weight:600;">${r.date}</td>
                    <td style="padding:14px 16px; color:#94a3b8;">${_getDayName(r.date)}</td>
                    <td style="padding:14px 16px;"><strong style="color:#ef4444;">${r.checkOutTime}</strong></td>
                    <td style="padding:14px 16px; color:#ffffff; font-weight:600;">${hrs}h</td>
                    <td style="padding:14px 16px; text-align:right;"><span class="status-pill pill-rejected">-${deficit}h deficit</span></td>
                `;
                if (tbody) tbody.appendChild(tr);
            });
        }
        else if (view === 'auto') {
            const tbody = document.getElementById('history-auto-tbody');
            if (tbody) tbody.innerHTML = '';
            const autoRecords = leaves.filter(l => l.isAutoApplied);
            const countEl = document.getElementById('history-records-count');
            if (countEl) countEl.textContent = `${autoRecords.length} auto-applied records logged`;
            if (autoRecords.length === 0) {
                if (tbody) tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:30px;">No auto-applied leaves found.</td></tr>';
                return;
            }
            autoRecords.forEach(l => {
                let statusBadge = '<span class="status-pill pill-approved">Approved</span>';
                if (l.status === 'Pending') statusBadge = '<span class="status-pill pill-late">Pending</span>';
                else if (l.status === 'Rejected') statusBadge = '<span class="status-pill pill-rejected">${l.status}</span>';

                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td style="padding:14px 16px; color:#ffffff; font-weight:600;">${l.startDate}</td>
                    <td style="padding:14px 16px;"><span class="status-pill pill-late">${l.type}</span></td>
                    <td style="padding:14px 16px; color:#94a3b8;">${l.reason || '-'}</td>
                    <td style="padding:14px 16px; text-align:right;">${statusBadge}</td>
                `;
                if (tbody) tbody.appendChild(tr);
            });
        }
    },

    triggerAutoHalfDay: async function() {
        if (!confirm('This will check all users who have not logged in today and auto-apply a half-day leave for them.\n\nAre you sure?')) return;
        try {
            const res = await fetch('/api/cron/auto-halfday', { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                alert('Auto half-day check completed successfully.\n\n' + data.message);
                await Store.syncWithBackend();
                if (this._historyUserId) this.loadEmployeeHistory(this._historyUserId);
                this.renderDashboard();
            } else {
                alert('Failed: ' + (data.message || 'Unknown error'));
            }
        } catch (err) {
            console.error('Auto half-day trigger error:', err);
            alert('Error connecting to backend.');
        }
    },

    exportEmployeeHistory: function() {
        if (!this._historyData || !this._historyUserId) {
            alert('Please select an employee first.');
            return;
        }
        const data = this._historyData;
        const userId = this._historyUserId;
        const user = (this._cachedUsers || []).find(u => u.id === userId);
        const name = user ? user.name : userId;

        const { fromDate, toDate, label } = this._getHistoryDateRange();
        const filteredAtt = data.attendance.filter(r => r.date >= fromDate && r.date <= toDate);
        const filteredLeaves = data.leaves.filter(l => l.startDate >= fromDate || l.endDate >= fromDate);

        // Build CSV
        const headers = ['Date', 'Type', 'Check In', 'Check Out', 'Hours', 'Status', 'Late Login', 'Early Logout'];
        const rows = filteredAtt.map(r => [
            r.date,
            'Attendance',
            r.checkInTime || '',
            r.checkOutTime || '',
            r.hoursWorked || '',
            r.status || '',
            r.isLateLogin ? 'YES' : '',
            r.isEarlyLogout ? 'YES' : ''
        ]);

        // Add leaves
        filteredLeaves.forEach(l => {
            rows.push([
                l.startDate + (l.startDate !== l.endDate ? ' to ' + l.endDate : ''),
                l.type,
                '', '', '',
                l.status,
                l.isAutoApplied ? 'AUTO' : '',
                ''
            ]);
        });

        const csvContent = [headers.join(',')]
            .concat(rows.map(r => r.map(v => `"${v}"`).join(',')))
            .join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `employee_history_${name.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0,10)}.csv`;
        link.click();
        URL.revokeObjectURL(link.href);
    }
});

// ============================================
// Biometric Tab Functions
// ============================================

window.AdminUI.renderBiometricTab = async function() {
    // 1. Fetch hardware device status
    try {
        const res = await fetch('/api/biometric/device/status');
        const data = await res.json();
        if (data.success) {
            const statusPill = document.getElementById('bio-device-status-pill');
            if (statusPill) {
                if (data.connected) {
                    statusPill.className = 'device-live-badge';
                    statusPill.innerHTML = `<span class="pulse-dot-green"></span><span>AS608 Scanner Online (${data.ip || '192.168.1.145'})</span>`;
                } else {
                    statusPill.className = 'device-offline-badge';
                    statusPill.innerHTML = `<ion-icon name="alert-circle-outline"></ion-icon><span>Scanner Offline</span>`;
                }
            }
            const enrolledKpi = document.getElementById('bio-kpi-enrolled');
            if (enrolledKpi) enrolledKpi.innerHTML = `${data.usedSlots} <span style="font-size:14px; color:#64748b;">/ ${data.totalSlots} Slots</span>`;

            const storageKpi = document.getElementById('bio-kpi-storage');
            if (storageKpi) {
                const pct = Math.round((data.usedSlots / data.totalSlots) * 100);
                storageKpi.textContent = `● ${pct}% Sensor Memory Used`;
            }
        }
    } catch (err) {
        console.warn('Could not fetch biometric device status:', err);
    }

    // 2. Fetch mapped biometric users
    try {
        const res = await fetch('/api/biometric/users');
        const data = await res.json();
        const tbody = document.getElementById('biometric-users-tbody');
        const countEl = document.getElementById('bio-users-count');
        if (tbody) {
            tbody.innerHTML = '';

            if (!data.success || !data.users || data.users.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#64748b; padding:32px;"><ion-icon name="finger-print-outline" style="font-size:36px; opacity:0.3; display:block; margin:0 auto 8px;"></ion-icon>No fingerprints mapped yet.<br><small style="color:#475569;">Click "Enroll Fingerprint" to map an employee.</small></td></tr>';
                if (countEl) countEl.textContent = '0 slots allocated';
            } else {
                if (countEl) countEl.textContent = `${data.users.length} active scanner slot allocations`;
                data.users.forEach(u => {
                    const tr = document.createElement('tr');
                    const enrollDate = u.enrolled_at ? new Date(u.enrolled_at).toLocaleDateString('en-US', { day:'numeric', month:'short', year:'numeric' }) : '-';
                    const initials = (u.name || u.user_id || '??').split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
                    
                    tr.innerHTML = `
                        <td style="padding:12px 14px;">
                            <span class="badge-slot">#${String(u.fingerprint_id).padStart(2, '0')}</span>
                        </td>
                        <td style="padding:12px 14px;">
                            <div style="display:flex; align-items:center; gap:10px;">
                                <div style="width:28px; height:28px; border-radius:50%; background:linear-gradient(135deg, #38bdf8, #6366f1); color:#fff; font-size:11px; font-weight:700; display:flex; align-items:center; justify-content:center;">
                                    ${initials}
                                </div>
                                <div>
                                    <div style="font-weight:700; color:#ffffff; font-size:13px;">${u.name || '-'}</div>
                                    <div style="font-size:11px; color:#64748b;">${u.department || 'Studio Artist'}</div>
                                </div>
                            </div>
                        </td>
                        <td style="padding:12px 14px;">
                            <code style="font-size:11.5px; color:#94a3b8; background:#0f1218; padding:3px 7px; border-radius:5px; border:1px solid rgba(255,255,255,0.06);">${u.user_id}</code>
                        </td>
                        <td style="padding:12px 14px; color:#94a3b8; font-size:12.5px;">${enrollDate}</td>
                        <td style="padding:12px 14px; text-align:right;">
                            <div style="display:flex; align-items:center; justify-content:flex-end; gap:6px;">
                                <button class="btn-small" style="padding:5px 10px; font-size:11.5px; font-weight:600; color:#38bdf8; border:1px solid rgba(56,189,248,0.25); background:rgba(56,189,248,0.08); display:inline-flex; align-items:center; gap:4px; border-radius:6px; cursor:pointer;" title="Add another finger for ${u.name || u.user_id}" onclick="window.AdminUI.openBiometricEnrollModal('${u.user_id}')">
                                    <ion-icon name="finger-print-outline" style="font-size:13px;"></ion-icon>
                                    <ion-icon name="add-outline" style="font-size:13px; margin-left:-3px;"></ion-icon>
                                    <span>Add Finger</span>
                                </button>
                                <button class="btn-small btn-neutral" style="padding:5px 8px; color:#f87171; border-color:rgba(239,68,68,0.25); background:rgba(239,68,68,0.08); border-radius:6px; cursor:pointer;" title="Delete slot #${u.fingerprint_id}" onclick="window.AdminUI.deleteBiometricMapping(${u.fingerprint_id}, '${(u.name || '').replace(/'/g, "\\'")}')">
                                    <ion-icon name="trash-outline" style="font-size:14px; vertical-align:middle;"></ion-icon>
                                </button>
                            </div>
                        </td>
                    `;
                    tbody.appendChild(tr);
                });
            }
        }
    } catch (err) {
        console.error('Failed to load biometric users:', err);
    }

    // 3. Fetch recent biometric punch logs
    try {
        const res = await fetch('/api/biometric/logs');
        const data = await res.json();
        const tbody = document.getElementById('biometric-logs-tbody');
        const countEl = document.getElementById('bio-logs-count');
        const punchesKpi = document.getElementById('bio-kpi-punches');

        if (tbody) {
            tbody.innerHTML = '';

            if (!data.success || !data.logs || data.logs.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#64748b; padding:32px;">No biometric punches recorded today.</td></tr>';
                if (countEl) countEl.textContent = '0 hardware logs today';
                if (punchesKpi) punchesKpi.innerHTML = `0 <span style="font-size:14px; color:#64748b;">Punches</span>`;
            } else {
                if (countEl) countEl.textContent = `${data.logs.length} live hardware scanner transactions`;
                if (punchesKpi) punchesKpi.innerHTML = `${data.logs.length} <span style="font-size:14px; color:#64748b;">Punches</span>`;

                data.logs.forEach(log => {
                    const tr = document.createElement('tr');
                    const timeStr = log.created_at ? new Date(log.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }) : '-';
                    const initials = (log.name || log.user_id || '??').split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();

                    let actionHtml = `<span style="color:#10b981; font-weight:700; font-size:12px; display:inline-flex; align-items:center; gap:4px;"><ion-icon name="enter-outline"></ion-icon> Check-In</span>`;
                    if (log.action === 'check_out') {
                        actionHtml = `<span style="color:#38bdf8; font-weight:700; font-size:12px; display:inline-flex; align-items:center; gap:4px;"><ion-icon name="exit-outline"></ion-icon> Check-Out</span>`;
                    } else if (log.action === 'already_completed') {
                        actionHtml = `<span style="color:#fbbf24; font-weight:600; font-size:12px;">⊘ Repeated</span>`;
                    }

                    tr.innerHTML = `
                        <td style="padding:12px 14px; color:#cbd5e1; font-size:12.5px; white-space:nowrap;">
                            <ion-icon name="time-outline" style="vertical-align:middle; color:#64748b; margin-right:4px;"></ion-icon>${timeStr}
                        </td>
                        <td style="padding:12px 14px;">
                            <span class="badge-slot">#${String(log.fingerprint_id || 1).padStart(2, '0')}</span>
                        </td>
                        <td style="padding:12px 14px;">
                            <div style="display:flex; align-items:center; gap:8px;">
                                <div style="width:24px; height:24px; border-radius:50%; background:#1e293b; color:#94a3b8; font-size:10px; font-weight:700; display:flex; align-items:center; justify-content:center;">
                                    ${initials}
                                </div>
                                <span style="color:#ffffff; font-weight:600; font-size:13px;">${log.name || log.user_id || '-'}</span>
                            </div>
                        </td>
                        <td style="padding:12px 14px;">${actionHtml}</td>
                        <td style="padding:12px 14px; text-align:right;">
                            <span class="status-pill pill-approved">${log.status || 'Verified'}</span>
                        </td>
                    `;
                    tbody.appendChild(tr);
                });
            }
        }
    } catch (err) {
        console.error('Failed to load biometric logs:', err);
    }
};

window.AdminUI.openBiometricEnrollModal = function(preselectedUserId) {
    const modal = document.getElementById('biometric-enroll-modal');
    if (!modal) {
        console.error('biometric-enroll-modal element not found!');
        return;
    }

    // 1. Open modal immediately
    modal.style.display = 'flex';
    modal.classList.remove('hidden');

    // 2. Reset view states
    const setupView = document.getElementById('bio-modal-setup-view');
    const liveView = document.getElementById('bio-modal-live-view');
    if (setupView) setupView.style.display = 'block';
    if (liveView) liveView.style.display = 'none';

    // 3. Populate employee dropdown
    const select = document.getElementById('bio-enroll-user');
    if (select) {
        select.innerHTML = '<option value="">Select employee...</option>';
        const users = (window.AdminUI._cachedUsers && window.AdminUI._cachedUsers.length)
            ? window.AdminUI._cachedUsers
            : (typeof Store !== 'undefined' && Store.getUsers ? Store.getUsers() : []);
        
        users.forEach(u => {
            const opt = document.createElement('option');
            const uid = u.user_id || u.id;
            opt.value = uid;
            opt.textContent = `${u.name || uid} (${uid})`;
            if (preselectedUserId && uid === preselectedUserId) {
                opt.selected = true;
            }
            select.appendChild(opt);
        });

        if (preselectedUserId) {
            select.value = preselectedUserId;
        }
    }

    // 4. Auto-fetch next available slot in background
    fetch('/api/biometric/next-slot')
        .then(res => res.json())
        .then(data => {
            const slotInput = document.getElementById('bio-enroll-slot');
            if (slotInput && data.success && data.next_slot) {
                slotInput.value = data.next_slot;
            }
        })
        .catch(e => {
            const slotInput = document.getElementById('bio-enroll-slot');
            if (slotInput && !slotInput.value) slotInput.value = '1';
        });

    // 5. Check device status in background
    fetch('/api/biometric/device/status')
        .then(res => res.json())
        .then(statusData => {
            const pill = document.getElementById('bio-device-status-pill');
            if (pill) {
                if (statusData.online) {
                    pill.style.background = 'rgba(16,185,129,0.1)';
                    pill.style.color = '#10b981';
                    pill.innerHTML = '<span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#10b981;"></span> Biometric Device Online';
                } else {
                    pill.style.background = 'rgba(239,68,68,0.1)';
                    pill.style.color = '#ef4444';
                    pill.innerHTML = '<span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#ef4444;"></span> Device Offline (Connecting...)';
                }
            }
        })
        .catch(() => {});
};

window.AdminUI.closeBiometricModal = function() {
    const modal = document.getElementById('biometric-enroll-modal');
    if (modal) {
        modal.style.display = 'none';
        modal.classList.add('hidden');
    }
    if (window.AdminUI && typeof window.AdminUI.renderBiometricTab === 'function') {
        window.AdminUI.renderBiometricTab();
    }
};

window.AdminUI.startLiveWebEnroll = async function() {
    const slot = parseInt(document.getElementById('bio-enroll-slot').value);
    const userId = document.getElementById('bio-enroll-user').value;
    if (!slot || slot < 1) return alert('Enter a valid slot number.');
    if (!userId) return alert('Please select an employee.');

    // Switch to live scanning view
    document.getElementById('bio-modal-setup-view').style.display = 'none';
    document.getElementById('bio-modal-live-view').style.display = 'block';

    // Reset live scanning UI
    document.getElementById('bio-live-title').textContent = 'Connecting to Device...';
    document.getElementById('bio-live-desc').textContent = 'Sending enrollment command to the attendance monitor...';
    document.getElementById('bio-live-icon').style.color = 'var(--primary)';
    document.getElementById('bio-live-icon').setAttribute('name', 'finger-print-outline');
    document.getElementById('bio-live-ring').style.borderColor = 'var(--primary)';
    document.getElementById('bio-dot-1').style.background = 'var(--border)';
    document.getElementById('bio-dot-2').style.background = 'var(--border)';
    document.getElementById('bio-dot-3').style.background = 'var(--border)';
    document.getElementById('btn-bio-cancel').style.display = 'inline-block';
    document.getElementById('btn-bio-retry').style.display = 'none';
    document.getElementById('btn-bio-done').style.display = 'none';

    try {
        const res = await fetch('/api/biometric/enroll/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fingerprint_id: slot, user_id: userId })
        });
        const data = await res.json();
        if (!data.success) {
            alert(data.message || 'Failed to start enrollment session.');
            window.AdminUI.closeBiometricModal();
        }
    } catch (err) {
        alert('Network error: ' + err.message);
        window.AdminUI.closeBiometricModal();
    }
};

window.AdminUI.updateEnrollStepUI = function(stepData) {
    const liveView = document.getElementById('bio-modal-live-view');
    if (!liveView || liveView.style.display === 'none') return;

    const title = document.getElementById('bio-live-title');
    const desc = document.getElementById('bio-live-desc');
    const icon = document.getElementById('bio-live-icon');
    const ring = document.getElementById('bio-live-ring');
    const dot1 = document.getElementById('bio-dot-1');
    const dot2 = document.getElementById('bio-dot-2');
    const dot3 = document.getElementById('bio-dot-3');
    const btnCancel = document.getElementById('btn-bio-cancel');
    const btnRetry = document.getElementById('btn-bio-retry');
    const btnDone = document.getElementById('btn-bio-done');

    const step = stepData.step;

    if (step === 'place_finger' || step === 'waiting_for_device') {
        title.textContent = 'Place Finger on Scanner';
        desc.textContent = 'Have employee place their finger pad firmly on the sensor.';
        icon.style.color = '#f59e0b';
        ring.style.borderColor = '#f59e0b';
        dot1.style.background = '#f59e0b';
        dot2.style.background = 'var(--border)';
        dot3.style.background = 'var(--border)';
    } else if (step === 'scan1_ok') {
        title.textContent = '✓ Scan 1 OK — Remove Finger';
        desc.textContent = 'First scan captured! Lift finger off the sensor now.';
        icon.style.color = '#3b82f6';
        ring.style.borderColor = '#3b82f6';
        dot1.style.background = '#10b981';
        dot2.style.background = '#3b82f6';
        dot3.style.background = 'var(--border)';
    } else if (step === 'place_again') {
        title.textContent = 'Place Same Finger Again';
        desc.textContent = 'Place the exact same finger back on the sensor for confirmation.';
        icon.style.color = '#8b5cf6';
        ring.style.borderColor = '#8b5cf6';
        dot1.style.background = '#10b981';
        dot2.style.background = '#8b5cf6';
        dot3.style.background = 'var(--border)';
    } else if (step === 'success') {
        title.textContent = '🎉 Fingerprint Enrolled!';
        desc.textContent = `Successfully mapped Slot #${stepData.slot} to ${stepData.name || 'employee'}!`;
        icon.setAttribute('name', 'checkmark-circle-outline');
        icon.style.color = '#10b981';
        ring.style.borderColor = '#10b981';
        dot1.style.background = '#10b981';
        dot2.style.background = '#10b981';
        dot3.style.background = '#10b981';
        btnCancel.style.display = 'none';
        btnRetry.style.display = 'none';
        btnDone.style.display = 'inline-block';
        window.AdminUI.renderBiometricTab();
    } else if (step === 'fail' || step === 'timeout' || step === 'error') {
        title.textContent = '✗ Scan Failed';
        desc.textContent = stepData.error || stepData.message || 'Prints did not match. Please try again.';
        icon.setAttribute('name', 'alert-circle-outline');
        icon.style.color = '#ef4444';
        ring.style.borderColor = '#ef4444';
        btnCancel.style.display = 'inline-block';
        btnRetry.style.display = 'inline-block';
        btnDone.style.display = 'none';
    } else if (step === 'cancelled') {
        window.AdminUI.closeBiometricModal();
    }
};

window.AdminUI.cancelLiveWebEnroll = async function() {
    try {
        await fetch('/api/biometric/enroll/cancel', { method: 'POST' });
    } catch (e) {}
    window.AdminUI.closeBiometricModal();
};

window.AdminUI.deleteBiometricMapping = async function(fingerprintId, name) {
    if (!confirm(`Remove fingerprint mapping for ${name || 'Slot #' + fingerprintId}?`)) return;
    try {
        const res = await fetch(`/api/biometric/users/${fingerprintId}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
            window.AdminUI.renderBiometricTab();
        } else {
            alert(data.error || 'Failed to remove mapping.');
        }
    } catch (err) {
        alert('Network error: ' + err.message);
    }
};

// Force Vite cache invalidation
console.log("AdminUI loaded successfully");


