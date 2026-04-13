# Attendance Tracker Dashboard

A modern, responsive, mobile-first web application designed to track employee attendance, manage leave requests, and configure optional/public holidays. Built entirely with Vanilla HTML, CSS, and JavaScript without frameworks, showcasing a premium glassmorphic UI.

## 🚀 Live Local Demo
To run the project locally, serve the directory using any static web server:
```bash
npx serve . -l 3000
```
Then open `http://localhost:3000`.

## 🏗️ Architecture & Tech Stack
- **Frontend Core**: Vanilla HTML5, CSS3, ES6 JavaScript.
- **Styling**: Custom CSS pipeline utilizing CSS Variables, Flexbox/Grid, and an advanced Glassmorphism design system. Fully responsive (mobile app view for users, desktop layout for Super Admins).
- **Icons**: [Ionicons 7](https://ionic.io/ionicons)
- **Backend / Mock Database**: Browser `LocalStorage` (`js/store.js`). The app operates as a complete Single Page Application (SPA) natively out of the browser without needing a live backend server.

## 👥 User Roles & Features

### 1. Normal User (`user1` / `password`)
The daily team member interface, heavily optimized for mobile usage.
- **Check-In/Out System (Home Tab)**: A satisfying, single large button to mark daily attendance. Real-time clock and dynamic status indicators (Working vs Completed).
- **Leave Requests**: Users can apply for Casual, Sick, or Earned leaves. Includes a localized history feed indicating pending/approved statuses.
- **Holiday Quotas (Optional Holidays)**:
  - Users have a fixed quota (default: 3) for choosing "Optional Holidays" from a pool determined by the Admin.
  - Users can click **Claim** to book a holiday, which auto-approves their leave.
  - **Constraints**: Users cannot claim holidays if their quota is 0, or if the holiday is less than 2 days away.

### 2. Super Admin (`admin1` / `password`)
The CRM and management dashboard for HR/Management. Expands to full-desktop width.
- **KPI Dashboard**: A top-level view showing "Present Today" vs total employees, and the number of unread Leave Requests.
- **Live Attendance Feed**: A dynamic table showing the exact check-in and check-out times of all users for the current day, along with whether they are on approved leave.
- **Leave Approvals Workflow**: A master queue of all pending leaves where Admins can Approve or Reject with one click.
- **User Management**: CRM table to add new users dynamically (automatically assigned default passwords) and remove users.
- **Holiday Management (Public vs Optional)**: 
  - Add or delete official company holidays.
  - Configurable toggle to decide if a holiday is a Mandatory "Public" holiday or an "Optional" unrestricted holiday for employees to claim.

## 📁 Project Structure
```text
/
├── index.html       # The main entry document housing both User and Admin views
├── css/
│   ├── style.css    # Core design system, variables, animations, and normal user UI
│   └── admin.css    # Desktop-scale grid layouts for the Admin panel
├── js/
│   ├── store.js     # The mock database layer (LocalStorage Wrapper)
│   ├── auth.js      # Session management and login logic
│   ├── app.js       # Normal User View Logic and SPA routing
│   └── admin.js     # Super Admin UI controllers and dashboard rendering
└── README.md        # Project documentation
```

## 🚢 Deployment (Synology NAS)

The production app is deployed on the Synology NAS at the following location:
**Path**: `/volume1/docker/Apps/Attendance-Tracker`

### How to update the Live Server:
1. **SSH** into the NAS:
   ```bash
   ssh [username]@[nas-ip]
   ```
2. **Navigate** to the project:
   ```bash
   cd /volume1/docker/Apps/Attendance-Tracker
   ```
3. **Pull** latest logic:
   ```bash
   git pull origin main
   ```
4. **Rebuild & Restart**:
   ```bash
   cd deployment
   sudo docker-compose up -d --build
   ```
