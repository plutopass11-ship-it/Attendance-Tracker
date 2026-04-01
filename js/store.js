// store.js
const INITIAL_DATA_KEY = 'attendance_app_v2';

// Sample default data
const defaultLeaveTypes = [
    { id: '1', name: 'Casual Leave', limit: 10, cycle: 'Yearly' },
    { id: '2', name: 'Sick Leave', limit: 5, cycle: 'Yearly' },
    { id: '3', name: 'Earned Leave', limit: 15, cycle: 'Yearly' },
    { id: '4', name: 'Work From Home', limit: 4, cycle: 'Monthly' }
];

const defaultUsers = [
    { id: 'user1', password: 'password', name: 'John Doe', role: 'user' },
    { id: 'admin1', password: 'password', name: 'Super Admin', role: 'admin' }
];

const defaultHolidays = [
    { date: '2026-01-01', name: 'New Year\'s Day', type: 'Public' },
    { date: '2026-01-26', name: 'Republic Day', type: 'Public' },
    { date: '2026-05-01', name: 'Labor Day', type: 'Public' },
    { date: '2026-08-15', name: 'Independence Day', type: 'Public' },
    { date: '2026-10-02', name: 'Gandhi Jayanti', type: 'Public' },
    { date: '2026-12-25', name: 'Christmas Day', type: 'Public' },
    { date: '2026-11-01', name: 'Diwali (Optional)', type: 'Optional' },
    { date: '2026-03-15', name: 'Holi (Optional)', type: 'Optional' },
    { date: '2026-09-05', name: 'Local Festival (Optional)', type: 'Optional' }
];

const GLOBAL_QUOTA = 3;

const defaultLeaves = [
    { id: '1', userId: 'user1', type: 'Casual Leave', startDate: '2026-04-10', endDate: '2026-04-12', reason: 'Family event', status: 'Approved' },
    { id: '2', userId: 'user1', type: 'Sick Leave', startDate: '2026-02-15', endDate: '2026-02-16', reason: 'Fever', status: 'Approved' }
];

function initDB() {
    if (!localStorage.getItem('v3_wfh')) {
        localStorage.setItem('users', JSON.stringify(defaultUsers));
        localStorage.setItem('holidays', JSON.stringify(defaultHolidays));
        localStorage.setItem('attendance', JSON.stringify([]));
        localStorage.setItem('leaves', JSON.stringify(defaultLeaves));
        localStorage.setItem('leaveTypes', JSON.stringify(defaultLeaveTypes));
        localStorage.setItem('v3_wfh', 'true');
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
    addAttendance: (record) => {
        const data = Store.getAttendance();
        data.push(record);
        localStorage.setItem('attendance', JSON.stringify(data));
    },
    updateAttendance: (updatedRecord) => {
        const data = Store.getAttendance();
        const index = data.findIndex(r => r.userId === updatedRecord.userId && r.date === updatedRecord.date);
        if (index > -1) {
            data[index] = updatedRecord;
            localStorage.setItem('attendance', JSON.stringify(data));
        }
    },
    getAttendanceToday: (userId, dateStr) => {
        return Store.getAttendance().find(r => r.userId === userId && r.date === dateStr);
    },
    
    // Leaves
    addLeaveRequest: (request) => {
        const data = Store.getLeaves();
        request.id = Date.now().toString();
        data.push(request);
        localStorage.setItem('leaves', JSON.stringify(data));
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
    updateLeaveStatus: (leaveId, status) => {
        const data = Store.getLeaves();
        const index = data.findIndex(l => l.id == leaveId);
        if(index > -1) {
            data[index].status = status;
            localStorage.setItem('leaves', JSON.stringify(data));
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
    addHoliday: (h) => {
        const data = Store.getHolidays();
        data.push(h);
        data.sort((a,b) => new Date(a.date) - new Date(b.date));
        localStorage.setItem('holidays', JSON.stringify(data));
    },
    deleteHoliday: (dateStr) => {
        const data = Store.getHolidays().filter(h => h.date !== dateStr);
        localStorage.setItem('holidays', JSON.stringify(data));
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

    // Dynamic Leave Types
    updateLeaveTypeLimit: (id, newLimit) => {
        const data = Store.getLeaveTypes();
        const type = data.find(t => t.id === id);
        if(type) type.limit = newLimit;
        localStorage.setItem('leaveTypes', JSON.stringify(data));
    }
};

// Initialize DB on script load
initDB();
