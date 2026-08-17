// socket-client.js — Live WebSocket connection for real-time attendance & device status
(function() {
    let socket = null;
    let reconnectAttempts = 0;
    const MAX_RECONNECT = 5;

    function connect() {
        // Auto-detect backend URL: if served via nginx, use same origin;
        // if running dev server directly on backend port, adjust as needed.
        const backendUrl = window.location.origin;

        try {
            socket = io(backendUrl, {
                transports: ['websocket', 'polling'],
                reconnection: true,
                reconnectionAttempts: MAX_RECONNECT,
                reconnectionDelay: 2000
            });
        } catch (err) {
            console.error('[Socket] Failed to initialize socket.io:', err);
            return;
        }

        socket.on('connect', () => {
            console.log('[Socket] Connected:', socket.id);
            reconnectAttempts = 0;
        });

        socket.on('disconnect', (reason) => {
            console.warn('[Socket] Disconnected:', reason);
        });

        socket.on('connect_error', (err) => {
            reconnectAttempts++;
            console.error(`[Socket] Connection error (attempt ${reconnectAttempts}/${MAX_RECONNECT}):`, err.message);
            if (reconnectAttempts >= MAX_RECONNECT) {
                console.warn('[Socket] Max reconnect attempts reached. Stopping retries.');
                socket.disconnect();
            }
        });

        // ─── Attendance Update ───
        // Fired whenever a new punch is processed (device or manual)
        socket.on('attendance:update', (data) => {
            console.log('[Socket] attendance:update', data);

            // 1. Refresh local store from backend
            if (typeof Store !== 'undefined' && Store.syncWithBackend) {
                Store.syncWithBackend().then(() => {
                    // 2. If user view is open and it's the current user, refresh UI
                    const currentUser = Auth ? Auth.getCurrentUser() : null;
                    if (currentUser && data.userId === currentUser.id) {
                        // Trigger attendance UI refresh if functions are globally exposed
                        if (typeof window.refreshAttendanceUI === 'function') {
                            window.refreshAttendanceUI();
                        }
                    }

                    // 3. If admin dashboard is open, refresh live feed
                    if (window.AdminUI && typeof window.AdminUI.renderDashboard === 'function') {
                        window.AdminUI.renderDashboard();
                    }
                });
            }
        });

        // ─── Biometric Device Status & Live Enrollment ───
        socket.on('biometric:status', (status) => {
            console.log('[Socket] biometric:status', status);
            window._biometricDeviceStatus = status;
            const biometricTab = document.getElementById('admin-tab-biometric');
            if (biometricTab && !biometricTab.classList.contains('hidden')) {
                if (window.AdminUI && typeof window.AdminUI.renderBiometricTab === 'function') {
                    window.AdminUI.renderBiometricTab();
                }
            }
        });

        socket.on('biometric:enroll-step', (stepData) => {
            console.log('[Socket] biometric:enroll-step', stepData);
            if (window.AdminUI && typeof window.AdminUI.updateEnrollStepUI === 'function') {
                window.AdminUI.updateEnrollStepUI(stepData);
            }
        });

        socket.on('biometric:users-updated', () => {
            console.log('[Socket] biometric:users-updated');
            const biometricTab = document.getElementById('admin-tab-biometric');
            if (biometricTab && !biometricTab.classList.contains('hidden')) {
                if (window.AdminUI && typeof window.AdminUI.renderBiometricTab === 'function') {
                    window.AdminUI.renderBiometricTab();
                }
            }
        });
    }

    // Expose a way to manually reconnect
    window.SocketClient = {
        connect,
        disconnect: () => { if (socket) socket.disconnect(); },
        isConnected: () => socket && socket.connected,
        getSocket: () => socket
    };

    // Auto-connect on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', connect);
    } else {
        connect();
    }
})();
