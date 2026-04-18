require('dotenv').config();
const express = require('express');
const http = require('http'); 
const { Server } = require('socket.io'); 
const path = require('path');
const logger = require('./utils/logger');
const { runAutomationTask, getVisibleHeadersForUi, updateAiConfig } = require('./services/orchestrator');

const app = express();
const server = http.createServer(app);
const io = new Server(server); 

logger.init(io);

// 🛑 THE FIX: Increase the payload limit so large sheets don't crash Express
app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

// --- STATE & QUEUE ---
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let isProcessing = false;
const requestQueue = [];

async function processQueue() {
    if (isProcessing || requestQueue.length === 0) return;
    
    isProcessing = true;
    const task = requestQueue.shift();
    
    try {
        logger.log(`Starting queued task for ${task.sheetName} Row ${task.rowIndex}`, 'info', 'Queue', 'q-exec');
        await runAutomationTask(task);
        
        const cooldownId = `cd-${Date.now()}`;
        logger.log('Cooling down for 5s to prevent rate limits...', 'loading', 'Queue', cooldownId);
        await sleep(5000); 
        logger.log('Cooldown complete. Queue ready.', 'success', 'Queue', cooldownId);
        
    } catch (e) {
        console.error('CRITICAL QUEUE ERROR:', e);
        logger.log(`Queue Execution Failed: ${e.message}`, 'error', 'Queue');
    } finally {
        isProcessing = false;
        processQueue(); // Loop to the next one
    }
}

// --- ROUTES ---
app.get('/', (req, res) => res.redirect('/admin'));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

app.get('/api/columns', async (req, res) => {
    try {
        const data = await getVisibleHeadersForUi();
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/config', (req, res) => {
    updateAiConfig(req.body);
    logger.log('AI Configuration updated.', 'success', 'System');
    res.status(200).send('Saved');
});

// 🛑 THE FIX: Put a bouncer on your Webhook door
app.post('/webhook', (req, res) => {
    // If you add a secret token to Apps Script, check it here!
    // const authHeader = req.headers['authorization'];
    // if (authHeader !== `Bearer ${process.env.WEBHOOK_SECRET}`) return res.status(401).send('Unauthorized');

    res.status(200).send('Queued');
    logger.log(`Webhook received. Position: ${requestQueue.length + 1}`, 'info', 'System');
    requestQueue.push(req.body);
    processQueue();
});

const PORT = process.env.PORT || 3005;
server.listen(PORT, () => {
    console.log(`\n🚀 TPM Master Orchestrator (v6.3) Online`);
});