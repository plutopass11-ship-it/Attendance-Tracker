// auth.js
const Auth = {
    login: async function(email, password, host) {
        try {
            // Trim host to remove trailing slash
            host = host.replace(/\/$/, '');
            
            const loginRes = await fetch(`/api/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            
            if (!loginRes.ok) return null; // Invalid credentials
            
            const authData = await loginRes.json();
            const token = authData.access_token;
            
            // 2. Fetch User Details & Role
            const meRes = await fetch(`/api/auth/authenticated`, {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            if (!meRes.ok) return null;
            
            const personData = await meRes.json();
            console.log("Kitsu Profile Dump:", personData);
            
            // Extract the actual Person object from the Kitsu wrapper
            const person = personData.user || (Array.isArray(personData) ? personData[0] : personData);
            
            // 3. Map Role
            // Only 'admin' and 'studio manager' roles get superadmin privileges
            const adminRoles = ['admin', 'studio manager'];
            const role = adminRoles.includes(person.role?.toLowerCase()) ? 'admin' : 'user';
            
            const user = {
                id: person.id, // Kitsu UUID
                name: `${person.first_name} ${person.last_name}`,
                email: person.email,
                role: role,
                token: token,
                host: host
            };
            
            localStorage.setItem('currentUser', JSON.stringify(user));
            
            // Keep host remembered
            localStorage.setItem('kitsu_host', host);
            return user;
            
        } catch (error) {
            console.error('Kitsu Login Error:', error);
            return null; // Network or CORS error
        }
    },
    
    logout: function() {
        localStorage.removeItem('currentUser');
        window.location.reload();
    },
    
    getCurrentUser: function() {
        const userStr = localStorage.getItem('currentUser');
        return userStr ? JSON.parse(userStr) : null;
    },
    isAuthenticated: () => {
        return !!Auth.getCurrentUser();
    }
};
