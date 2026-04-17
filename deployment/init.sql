-- =============================================
-- Attendance Tracker - Database Schema
-- =============================================

-- 1. Users Table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    password VARCHAR(255) NOT NULL,
    role VARCHAR(20) DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    phone VARCHAR(20) UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Attendance Records
CREATE TABLE IF NOT EXISTS attendance (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(50) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    check_in_time TIMESTAMP,
    check_out_time TIMESTAMP,
    status VARCHAR(30) DEFAULT 'working',
    UNIQUE(user_id, date)
);

-- 3. Leave Policies (types & quotas)
CREATE TABLE IF NOT EXISTS leave_policies (
    id SERIAL PRIMARY KEY,
    type VARCHAR(50) UNIQUE NOT NULL,
    label VARCHAR(100) NOT NULL,
    quota INTEGER NOT NULL DEFAULT 12,
    cycle VARCHAR(20) DEFAULT 'yearly'
);

-- 4. Leave Requests
CREATE TABLE IF NOT EXISTS leave_requests (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(50) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    reason TEXT,
    status VARCHAR(20) DEFAULT 'pending',
    reviewed_by VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 5. Holidays (public & optional)
CREATE TABLE IF NOT EXISTS holidays (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    date DATE NOT NULL UNIQUE,
    type VARCHAR(20) DEFAULT 'public' CHECK (type IN ('public', 'optional')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 6. Optional Holiday Claims
CREATE TABLE IF NOT EXISTS holiday_claims (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(50) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    holiday_id INTEGER NOT NULL REFERENCES holidays(id) ON DELETE CASCADE,
    claimed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, holiday_id)
);

-- =============================================
-- Seed Data: Default Users
-- =============================================
INSERT INTO users (user_id, name, password, role) VALUES
    ('admin1', 'Joel Admin', 'password', 'admin'),
    ('user1', 'Test User', 'password', 'user')
ON CONFLICT (user_id) DO NOTHING;

-- =============================================
-- Seed Data: Default Leave Policies
-- =============================================
INSERT INTO leave_policies (type, label, quota, cycle) VALUES
    ('casual', 'Casual Leave', 12, 'yearly'),
    ('sick', 'Sick Leave', 12, 'yearly'),
    ('earned', 'Earned Leave', 15, 'yearly'),
    ('wfh', 'Work From Home', 8, 'monthly')
ON CONFLICT (type) DO NOTHING;

-- =============================================
-- Seed Data: 2026 Public Holidays (India)
-- =============================================
INSERT INTO holidays (name, date, type) VALUES
    ('Republic Day', '2026-01-26', 'public'),
    ('Holi', '2026-03-17', 'public'),
    ('Good Friday', '2026-04-03', 'public'),
    ('Independence Day', '2026-08-15', 'public'),
    ('Gandhi Jayanti', '2026-10-02', 'public'),
    ('Diwali', '2026-10-20', 'public'),
    ('Christmas', '2026-12-25', 'public')
ON CONFLICT (date) DO NOTHING;

-- =============================================
-- Seed Data: 2026 Optional Holidays (India)
-- =============================================
INSERT INTO holidays (name, date, type) VALUES
    ('Maha Shivaratri', '2026-02-15', 'optional'),
    ('Ram Navami', '2026-04-06', 'optional'),
    ('Eid ul-Fitr', '2026-03-21', 'optional'),
    ('Raksha Bandhan', '2026-08-12', 'optional'),
    ('Janmashtami', '2026-08-22', 'optional'),
    ('Guru Nanak Jayanti', '2026-11-08', 'optional')
ON CONFLICT (date) DO NOTHING;
