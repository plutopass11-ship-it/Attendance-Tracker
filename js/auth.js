// auth.js
const Auth = {
    login: async (userId, password) => {
        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId, password })
            });
            const data = await res.json();
            if (data.success) {
                localStorage.setItem('currentUser', JSON.stringify(data.user));
                return true;
            }
        } catch (err) {
            console.error('Login error', err);
        }
        return false;
    },
    logout: () => {
        localStorage.removeItem('currentUser');
    },
    getCurrentUser: () => {
        const userStr = localStorage.getItem('currentUser');
        return userStr ? JSON.parse(userStr) : null;
    },
    isAuthenticated: () => {
        return !!Auth.getCurrentUser();
    }
};
