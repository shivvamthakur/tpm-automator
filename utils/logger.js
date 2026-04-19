/**
 * TPM Orchestrator Logger Utility
 * Centralizes console logging and real-time UI updates via Socket.io
 */

let ioInstance = null;

module.exports = {
    /**
     * Initializes the logger with the Socket.io server instance
     * @param {Object} io - The socket.io instance from index.js
     */
    init: (io) => {
        ioInstance = io;
    },

    /**
     * Logs a message to the terminal and emits a stateful event to the Admin UI
     * @param {string} message - Text to display
     * @param {string} status - 'info' | 'loading' | 'success' | 'error' | 'warning'
     * @param {string} projectName - Name of the project being processed
     * @param {string} stepId - Unique identifier to target specific UI lines (prevents duplicate lines)
     * @param {Object} meta - Optional metadata to pass to the UI (e.g. links, row IDs)
     */
    log: (message, status = 'info', projectName = 'System', stepId = null, meta = null) => {
        const time = new Date().toLocaleTimeString();
        
        // Define terminal icons
        let icon = '<svg class="w-3.5 h-3.5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>';
        if (status === 'loading') icon = '<div class="spinner mt-0.5"></div>';
        if (status === 'success') icon = '<svg class="w-3.5 h-3.5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>';
        if (status === 'error')   icon = '<svg class="w-3.5 h-3.5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>';
        if (status === 'warning') icon = '<svg class="w-3.5 h-3.5 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>';

        // Log to the server terminal
        console.log(`[${time}] [${projectName}] ${icon} ${message}`);

        // Emit to the connected Admin UI via WebSocket
        if (ioInstance) {
            ioInstance.emit('server-log', { 
                message, 
                status, 
                projectName, 
                time, 
                icon,
                // Generate a random ID if none provided to ensure every log is trackable
                stepId: stepId || `log-${Math.random().toString(36).substr(2, 9)}`,
                meta
            });
        }
    }
};