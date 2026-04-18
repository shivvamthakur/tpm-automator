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
     */
    log: (message, status = 'info', projectName = 'System', stepId = null) => {
        const time = new Date().toLocaleTimeString();
        
        // Define terminal icons
        let icon = 'ℹ️';
        if (status === 'loading') icon = '⏳';
        if (status === 'success') icon = '✅';
        if (status === 'error')   icon = '❌';
        if (status === 'warning') icon = '⚠️';

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
                stepId: stepId || `log-${Math.random().toString(36).substr(2, 9)}`
            });
        }
    }
};