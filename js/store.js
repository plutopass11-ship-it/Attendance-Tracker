// store.js
const INITIAL_DATA_KEY = 'attendance_app_v2';

// No dummy data needed
const defaultLeaveTypes = [];
const defaultUsers = [];
const defaultHolidays = [];
const GLOBAL_QUOTA = 3;
const defaultLeaves = [];

function initDB() {
    if (!localStorage.getItem('v4_wfh_clear')) {
        localStorage.setItem('users', JSON.stringify(defaultUsers));
        localStorage.setItem('holidays', JSON.stringify(defaultHolidays));
        localStorage.setItem('attendance', JSON.stringify([]));
        localStorage.setItem('leaves', JSON.stringify(defaultLeaves));
        localStorage.setItem('leaveTypes', JSON.stringify(defaultLeaveTypes));
        localStorage.setItem('extraOff', JSON.stringify({}));
        localStorage.setItem('v4_wfh_clear', 'true');
    }
}

const Store = {
    // Read with fallbacks
    getUsers: () => JSON.parse(localStorage.getItem('users')) || defaultUsers,
    getHolidays: () => JSON.parse(localStorage.getItem('holidays')) || defaultHolidays,
    getAttendance: () => JSON.parse(localStorage.getItem('attendance')) || [],
    getLeaves: () => JSON.parse(localStorage.getItem('leaves')) || [],
    getLeaveTypes: () => JSON.parse(localStorage.getItem('leaveTypes')) || defaultLeaveTypes,
    
    // Auth
    getUserById: (id) => Store.getUsers().find(u => u.id === id),
    
    // Attendance
    autoCheckoutMissing: () => {
        const data = Store.getAttendance();
        const now = new Date();
        const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
        let modified = false;
        data.forEach(r => {
            if (!r.checkOutTime && r.date !== todayStr) {
                r.checkOutTime = "20:00 (Auto)";
                modified = true;
            }
        });
        if(modified) {
            localStorage.setItem('attendance', JSON.stringify(data));
        }
    },
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
    
    // Leaves
    addLeaveRequest: async (request) => {
        const data = Store.getLeaves();
        request.id = Date.now().toString();
        data.push(request);
        localStorage.setItem('leaves', JSON.stringify(data));
        
        // Sync to backend
        try {
            await fetch('/api/leaves', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(request)
            });
        } catch (err) { console.error('Leave sync error:', err); }
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
        const data = Store.getLeaves();
        const index = data.findIndex(l => l.id == leaveId);
        if(index > -1) {
            data[index].status = status;
            localStorage.setItem('leaves', JSON.stringify(data));
            
            // Sync to backend
            try {
                await fetch(`/api/leaves/${leaveId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ status })
                });
            } catch (err) { console.error('Leave status sync error:', err); }
        }
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
            
            console.log('Store synced with backend successfully');
        } catch (err) {
            console.error('Failed to sync store with backend:', err);
        }
    }
};

// Initialize DB on script load
initDB();
