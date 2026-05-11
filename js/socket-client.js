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

        // ─── Device Status ───
        // Fired when ZKTeco connection status changes
        socket.on('device:status', (status) => {
            console.log('[Socket] device:status', status);
            window._zktecoDeviceStatus = status;

            // Update admin ZKTeco tab if it's currently visible
            const zktecoTab = document.getElementById('admin-tab-zkteco');
            if (zktecoTab && !zktecoTab.classList.contains('hidden')) {
                if (window.AdminUI && typeof window.AdminUI.renderZktecoStatus === 'function') {
                    window.AdminUI.renderZktecoStatus();
                }
            }

            // Update device status indicator in sidebar if it exists
            const indicator = document.getElementById('zkteco-status-indicator');
            if (indicator) {
                if (status.connected) {
                    indicator.innerHTML = '<span style="color:#10b981;font-size:10px;">●</span> Connected';
                } else {
                    indicator.innerHTML = '<span style="color:#ef4444;font-size:10px;">●</span> Disconnected';
                }
            }
        });

        // ─── Sync Progress ───
        socket.on('sync:progress', (data) => {
            console.log('[Socket] sync:progress', data);
            const progressEl = document.getElementById('zkteco-sync-progress');
            if (progressEl) {
                progressEl.textContent = data.message || '';
                progressEl.style.display = data.message ? 'block' : 'none';
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
