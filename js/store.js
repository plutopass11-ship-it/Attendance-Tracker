// store.js - Client State & LocalStorage Management
const INITIAL_DATA_KEY = 'attendance_app_v2';

// 1. Rich Default Users
const defaultUsers = [
    { id: 'u_joel', name: 'Joel Robert', email: 'joel@flyingpluto.ai', role: 'admin', department: 'Management / Direction', active: true },
    { id: 'u_albert', name: 'Albert', email: 'albert@flyingpluto.ai', role: 'admin', department: 'Management / Production', active: true },
    { id: 'u_joyel', name: 'Joyel', email: 'joyel@flyingpluto.ai', role: 'admin', department: 'Management / Operations', active: true },
    { id: 'u_rahul', name: 'Rahul Sharma', email: 'rahul@flyingpluto.ai', role: 'employee', department: '3D Animation', active: true },
    { id: 'u_priya', name: 'Priya Nair', email: 'priya@flyingpluto.ai', role: 'employee', department: 'Compositing & VFX', active: true },
    { id: 'u_arun', name: 'Arun Kumar', email: 'arun@flyingpluto.ai', role: 'employee', department: 'FX & Simulation', active: true },
    { id: 'u_ananya', name: 'Ananya Rao', email: 'ananya@flyingpluto.ai', role: 'employee', department: 'Lighting & Lookdev', active: true },
    { id: 'u_deepak', name: 'Deepak V', email: 'deepak@flyingpluto.ai', role: 'employee', department: 'Rigging', active: true },
    { id: 'u_sneha', name: 'Sneha Menon', email: 'sneha@flyingpluto.ai', role: 'employee', department: 'Production Coordinator', active: true },
    { id: 'u_vikram', name: 'Vikram Singh', email: 'vikram@flyingpluto.ai', role: 'employee', department: 'Pipeline TD', active: true }
];

// 2. Rich Default Leave Policies
const defaultLeaveTypes = [
    { id: '1', name: 'Casual Leave', limit: 12, cycle: 'yearly' },
    { id: '2', name: 'Sick Leave', limit: 8, cycle: 'yearly' },
    { id: '3', name: 'Annual Leave', limit: 15, cycle: 'yearly' },
    { id: '4', name: 'Work From Home (WFH)', limit: 24, cycle: 'yearly' },
    { id: '5', name: 'Compensatory Off', limit: 5, cycle: 'yearly' }
];

const defaultHolidays = [
    { id: 1, date: '2026-01-01', name: "New Year's Day", type: 'Public' },
    { id: 2, date: '2026-01-26', name: 'Republic Day', type: 'Public' },
    { id: 3, date: '2026-08-15', name: 'Independence Day', type: 'Public' },
    { id: 4, date: '2026-10-02', name: 'Gandhi Jayanti', type: 'Public' },
    { id: 5, date: '2026-12-25', name: 'Christmas', type: 'Public' }
];

const GLOBAL_QUOTA = 3;
const isWfhAttendanceStatus = (status) => typeof status === 'string' && status.startsWith('wfh_');

// Helper to get today's local date string YYYY-MM-DD
function getLocalTodayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const todayStrVal = getLocalTodayStr();

const defaultLeaves = [
    { id: '101', userId: 'u_sneha', type: 'Sick Leave', startDate: todayStrVal, endDate: todayStrVal, reason: 'Viral fever and doctor consultation', status: 'Approved' },
    { id: '102', userId: 'u_rahul', type: 'Annual Leave', startDate: '2026-08-20', endDate: '2026-08-22', reason: 'Family vacation trip', status: 'Pending' },
    { id: '103', userId: 'u_arun', type: 'Casual Leave', startDate: '2026-08-10', endDate: '2026-08-10', reason: 'Personal appointment', status: 'Approved' }
];

const defaultAttendance = [
    { id: 1, userId: 'u_joel', date: todayStrVal, checkInTime: '09:15 AM', checkOutTime: null, status: 'working', isWfh: false },
    { id: 2, userId: 'u_rahul', date: todayStrVal, checkInTime: '09:30 AM', checkOutTime: null, status: 'working', isWfh: false },
    { id: 3, userId: 'u_priya', date: todayStrVal, checkInTime: '10:05 AM', checkOutTime: null, status: 'wfh_working', isWfh: true },
    { id: 4, userId: 'u_arun', date: todayStrVal, checkInTime: '11:25 AM', checkOutTime: null, status: 'working', isWfh: false },
    { id: 5, userId: 'u_ananya', date: todayStrVal, checkInTime: '09:00 AM', checkOutTime: '06:15 PM', status: 'completed', isWfh: false },
    { id: 6, userId: 'u_deepak', date: todayStrVal, checkInTime: '09:45 AM', checkOutTime: '03:30 PM', status: 'pending_early_clockout', isWfh: false }
];

function initDB() {
    const existingUsers = JSON.parse(localStorage.getItem('users') || '[]');
    if (!existingUsers || existingUsers.length === 0) {
        localStorage.setItem('users', JSON.stringify(defaultUsers));
        localStorage.setItem('holidays', JSON.stringify(defaultHolidays));
        localStorage.setItem('attendance', JSON.stringify(defaultAttendance));
        localStorage.setItem('leaves', JSON.stringify(defaultLeaves));
        localStorage.setItem('leaveTypes', JSON.stringify(defaultLeaveTypes));
        localStorage.setItem('extraOff', JSON.stringify({}));
    }
}

const Store = {
    // Read with fallbacks
    getUsers: () => {
        const u = JSON.parse(localStorage.getItem('users') || '[]');
        return u && u.length > 0 ? u : defaultUsers;
    },
    getHolidays: () => {
        const h = JSON.parse(localStorage.getItem('holidays') || '[]');
        return h && h.length > 0 ? h : defaultHolidays;
    },
    getAttendance: () => {
        const a = JSON.parse(localStorage.getItem('attendance') || '[]');
        return a && a.length > 0 ? a : defaultAttendance;
    },
    getLeaves: () => {
        const l = JSON.parse(localStorage.getItem('leaves') || '[]');
        return l && l.length > 0 ? l : defaultLeaves;
    },
    getLeaveTypes: () => {
        const lt = JSON.parse(localStorage.getItem('leaveTypes') || '[]');
        return lt && lt.length > 0 ? lt : defaultLeaveTypes;
    },
    
    // Auth
    getUserById: (id) => Store.getUsers().find(u => u.id === id),
    
    // Attendance

    addAttendance: async (record) => {
        const data = Store.getAttendance();
        data.push(record);
        localStorage.setItem('attendance', JSON.stringify(data));
        
        // Sync to backend
        try {
            await fetch('/api/attendance', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: record.userId,
                    date: record.date,
                    time: record.checkInTime,
                    status: record.status,
                    isCheckOut: false
                })
            });
        } catch (err) { console.error('Attendance sync error:', err); }
    },
    updateAttendance: async (updatedRecord) => {
        const data = Store.getAttendance();
        const index = data.findIndex(r => r.userId === updatedRecord.userId && r.date === updatedRecord.date);
        if (index > -1) {
            data[index] = updatedRecord;
            localStorage.setItem('attendance', JSON.stringify(data));
            
            // Sync to backend
            try {
                await fetch('/api/attendance', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        userId: updatedRecord.userId,
                        date: updatedRecord.date,
                        time: updatedRecord.checkOutTime,
                        isCheckOut: true
                    })
                });
            } catch (err) { console.error('Attendance sync error:', err); }
        }
    },
    getAttendanceToday: (userId, dateStr) => {
        return Store.getAttendance().find(r => r.userId === userId && r.date === dateStr);
    },
    
    // Leaves Helper
    calculateLeaveDays: (l) => {
        if (!l) return 0;
        const lType = (l.type || '').toLowerCase();
        if (l.isHalfDay || lType.includes('(half day)') || lType.includes('half-day') || lType.includes('half day')) return 0.5;
        if (!l.startDate || !l.endDate) return 1;
        const diff = Math.round(Math.abs(new Date(l.endDate) - new Date(l.startDate)) / (1000 * 60 * 60 * 24)) + 1;
        return isNaN(diff) ? 1 : diff;
    },

    getUserLeaveBalances: (userId, excludeLeaveId = null) => {
        const leaveTypes = Store.getLeaveTypes();
        const allLeaves = Store.getUserLeaves(userId).filter(l => {
            const st = (l.status || '').toLowerCase();
            return st !== 'rejected';
        });
        const extra = Store.getExtraOff(userId) || { leaves: 0, wfh: 0 };
        const now = new Date();
        const currYear = now.getFullYear();
        const currMonthStr = `${currYear}-${String(now.getMonth() + 1).padStart(2, '0')}`;

        return leaveTypes.map(t => {
            const tName = t.name;
            const isWfh = tName.toLowerCase().includes('wfh') || tName.toLowerCase().includes('work from home');
            const isMonthly = (t.cycle || '').toLowerCase() === 'monthly';

            const matchingLeaves = allLeaves.filter(l => {
                if (excludeLeaveId && (l.id == excludeLeaveId || String(l.id) === String(excludeLeaveId))) return false;
                const lType = (l.type || '').toLowerCase();
                if (isWfh) {
                    return lType.includes('wfh') || lType.includes('work from home');
                }
                return lType.startsWith(tName.toLowerCase()) || lType === tName.toLowerCase();
            });

            let usedApproved = 0;
            let usedPending = 0;

            matchingLeaves.forEach(l => {
                const sDate = l.startDate;
                const eDate = l.endDate;
                if (isMonthly) {
                    if (!sDate.startsWith(currMonthStr) && !eDate.startsWith(currMonthStr)) return;
                } else {
                    if (new Date(sDate).getFullYear() !== currYear) return;
                }

                const days = Store.calculateLeaveDays(l);
                const st = (l.status || '').toLowerCase();
                if (st === 'approved') usedApproved += days;
                else if (st === 'pending') usedPending += days;
            });

            const totalUsed = usedApproved + usedPending;
            const extraAllowance = isWfh ? (extra.wfh || 0) : 0;
            const quota = parseInt(t.limit || t.quota, 10) || 0;
            const totalQuota = quota + extraAllowance;
            const remaining = Math.max(0, totalQuota - totalUsed);

            return {
                name: tName,
                quota: totalQuota,
                cycle: t.cycle || 'Yearly',
                usedApproved,
                usedPending,
                totalUsed,
                used: totalUsed,
                remaining
            };
        });
    },

    // Leaves
    addLeaveRequest: async (request) => {
        try {
            const res = await fetch('/api/leaves', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(request)
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                return { success: false, ...data };
            }

            const storedData = Store.getLeaves();
            request.id = data.leave ? String(data.leave.id) : Date.now().toString();
            if (data.leave && data.leave.startDate) request.startDate = data.leave.startDate;
            if (data.leave && data.leave.endDate) request.endDate = data.leave.endDate;
            storedData.unshift(request);
            localStorage.setItem('leaves', JSON.stringify(storedData));
            return { success: true, leave: request };
        } catch (err) {
            console.error('Leave sync error:', err);
            return { success: false, message: err.message };
        }
    },
    getUserLeaves: (userId) => {
        return Store.getLeaves().filter(l => l.userId === userId).sort((a, b) => b.id - a.id);
    },
    
    // Admin specific
    getAllUsers: () => Store.getUsers(),
    getAllAttendanceToday: (dateStr) => {
        return Store.getAttendance().filter(r => r.date === dateStr);
    },
    getAllLeaves: () => {
        return Store.getLeaves().sort((a, b) => b.id - a.id);
    },
    updateLeaveStatus: async (leaveId, status) => {
        try {
            const res = await fetch(`/api/leaves/${leaveId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status })
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                return { success: false, ...data };
            }

            const leaves = Store.getLeaves();
            const index = leaves.findIndex(l => l.id == leaveId || String(l.id) === String(leaveId));
            if (index > -1) {
                leaves[index].status = status;
                localStorage.setItem('leaves', JSON.stringify(leaves));
            }
            return { success: true };
        } catch (err) {
            console.error('Leave status sync error:', err);
            return { success: false, message: err.message };
        }
    },
    deleteLeave: async (leaveId) => {
        const data = Store.getLeaves().filter(l => l.id != leaveId && String(l.id) !== String(leaveId));
        localStorage.setItem('leaves', JSON.stringify(data));
        try {
            await fetch(`/api/leaves/${leaveId}`, { method: 'DELETE' });
        } catch (err) { console.error('Leave delete sync error:', err); }
    },
    editLeave: async (leaveId, updates) => {
        try {
            const res = await fetch(`/api/leaves/${leaveId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updates)
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                return { success: false, ...data };
            }

            const leaves = Store.getLeaves();
            const index = leaves.findIndex(l => l.id == leaveId || String(l.id) === String(leaveId));
            if (index > -1) {
                Object.assign(leaves[index], updates);
                localStorage.setItem('leaves', JSON.stringify(leaves));
            }
            return { success: true };
        } catch (err) {
            console.error('Leave edit sync error:', err);
            return { success: false, message: err.message };
        }
    },
    deleteAttendanceRecord: async (userId, date) => {
        const data = Store.getAttendance().filter(r => !(r.userId === userId && r.date === date));
        localStorage.setItem('attendance', JSON.stringify(data));
        try {
            await fetch(`/api/attendance/${encodeURIComponent(userId)}/${date}`, { method: 'DELETE' });
        } catch (err) { console.error('Attendance delete sync error:', err); }
    },
    approveEarlyClockout: async (userId, date, action) => {
        try {
            await fetch('/api/attendance/approve', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId, date, action })
            });
            // Also update local storage state temporarily
            const data = Store.getAttendance();
            const record = data.find(r => r.userId === userId && r.date === date);
            if (record) {
                if (action === 'approve') record.status = isWfhAttendanceStatus(record.status) ? 'wfh_completed' : 'completed';
                if (action === 'reject') {
                    record.status = isWfhAttendanceStatus(record.status) ? 'wfh_working' : 'working';
                    record.checkOutTime = null;
                }
                localStorage.setItem('attendance', JSON.stringify(data));
            }
        } catch (err) { console.error('Approval sync error:', err); }
    },
    addUser: (userObj) => {
        const data = Store.getUsers();
        data.push(userObj);
        localStorage.setItem('users', JSON.stringify(data));
    },
    deleteUser: (userId) => {
        const data = Store.getUsers().filter(u => u.id !== userId);
        localStorage.setItem('users', JSON.stringify(data));
    },
    
    // Holiday Admin & Optional
    addHoliday: async (h) => {
        const data = Store.getHolidays();
        data.push(h);
        data.sort((a,b) => new Date(a.date) - new Date(b.date));
        localStorage.setItem('holidays', JSON.stringify(data));
        try {
            await fetch('/api/holidays', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(h)
            });
        } catch (err) { console.error('Holiday sync error:', err); }
    },
    deleteHoliday: async function(date) {
        let holidays = this.getHolidays();
        holidays = holidays.filter(h => h.date !== date);
        localStorage.setItem('holidays', JSON.stringify(holidays));
        try {
            await fetch(`/api/holidays/${date}`, { method: 'DELETE' });
        } catch (err) { console.error('Holiday delete sync error:', err); }
    },
    updateHoliday: async function(oldDate, updatedHoliday) {
        let holidays = this.getHolidays();
        const index = holidays.findIndex(h => h.date === oldDate);
        if(index !== -1) {
            holidays[index] = updatedHoliday;
            localStorage.setItem('holidays', JSON.stringify(holidays));
        }
        try {
            await fetch('/api/holidays', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ oldDate, ...updatedHoliday })
            });
        } catch (err) { console.error('Holiday update sync error:', err); }
    },
    claimOptionalHoliday: (userId, holiday) => {
        // Automatically create an approved leave
        Store.addLeaveRequest({
            userId: userId,
            type: 'Optional Holiday',
            startDate: holiday.date,
            endDate: holiday.date,
            reason: holiday.name,
            status: 'Approved' // auto-approved!
        });
    },
    getRemainingQuota: (userId) => {
        const leaves = Store.getUserLeaves(userId);
        const claimed = leaves.filter(l => l.type === 'Optional Holiday').length;
        return Math.max(0, GLOBAL_QUOTA - claimed);
    },

    // Extra Off Admin Feature
    getExtraOff: (userId) => {
        const data = JSON.parse(localStorage.getItem('extraOff')) || {};
        return data[userId] || { leaves: 0, wfh: 0 };
    },
    updateExtraOff: (userId, leaves, wfh) => {
        const data = JSON.parse(localStorage.getItem('extraOff')) || {};
        data[userId] = { leaves: parseInt(leaves, 10), wfh: parseInt(wfh, 10) };
        localStorage.setItem('extraOff', JSON.stringify(data));
    },

    // Dynamic Leave Types
    updateLeaveType: async (id, name, limit, cycle) => {
        const data = Store.getLeaveTypes();
        const type = data.find(t => t.id === id || t.id == id);
        if(type) {
            type.name = name;
            type.limit = limit;
            type.cycle = cycle;
        }
        localStorage.setItem('leaveTypes', JSON.stringify(data));
        try {
            await fetch(`/api/policies/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, limit, cycle })
            });
        } catch (err) { console.error('Policy update sync error:', err); }
    },
    addLeaveType: async (typeObj) => {
        const data = Store.getLeaveTypes();
        data.push(typeObj);
        localStorage.setItem('leaveTypes', JSON.stringify(data));
        try {
            await fetch('/api/policies', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: typeObj.name, limit: typeObj.limit, cycle: typeObj.cycle })
            });
        } catch (err) { console.error('Policy add sync error:', err); }
    },
    deleteLeaveType: async (id) => {
        const data = Store.getLeaveTypes().filter(t => t.id !== id && t.id != id);
        localStorage.setItem('leaveTypes', JSON.stringify(data));
        try {
            await fetch(`/api/policies/${id}`, { method: 'DELETE' });
        } catch (err) { console.error('Policy delete sync error:', err); }
    },

    syncWithBackend: async () => {
        try {
            const res = await fetch('/api/sync/store');
            if (!res.ok) return;
            const data = await res.json();
            
            // Sync all major tables into localStorage to keep the app working
            if (data.users) localStorage.setItem('users', JSON.stringify(data.users));
            if (data.leaveTypes) localStorage.setItem('leaveTypes', JSON.stringify(data.leaveTypes));
            if (data.leaves) localStorage.setItem('leaves', JSON.stringify(data.leaves));
            if (data.attendance) localStorage.setItem('attendance', JSON.stringify(data.attendance));
            if (data.holidays) localStorage.setItem('holidays', JSON.stringify(data.holidays));
            
            // Sync studio settings
            try {
                const settingsRes = await fetch('/api/settings');
                if (settingsRes.ok) {
                    const settings = await settingsRes.json();
                    if (settings && Object.keys(settings).length > 0) {
                        localStorage.setItem('studioSettings', JSON.stringify(settings));
                    }
                }
            } catch(e) { /* settings endpoint may not exist yet */ }

            console.log('Store synced with backend successfully');
        } catch (err) {
            console.error('Failed to sync store with backend:', err);
        }
    }
};

// Initialize DB on script load
initDB();
