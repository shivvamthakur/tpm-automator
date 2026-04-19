require('dotenv').config();
const express = require('express');
const http = require('http'); 
const { Server } = require('socket.io'); 
const path = require('path');
const logger = require('./utils/logger');
const { runAutomationTask, getVisibleHeadersForUi, saveAiConfigToSheet, updateSheetTrigger, getKanbanData, updateKanbanCell, getTpms } = require('./services/orchestrator');

const app = express();
const server = http.createServer(app);
const io = new Server(server); 

logger.init(io);

// 10MB limit to handle massive Google Sheets payloads
app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

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
        logger.log('Cooling down for 5s to respect Google API limits...', 'loading', 'Queue', cooldownId);
        await sleep(5000); 
        logger.log('Cooldown complete. Queue ready.', 'success', 'Queue', cooldownId);
        
    } catch (e) {
        console.error('CRITICAL QUEUE ERROR:', e);
        logger.log(`Queue Execution Failed: ${e.message}`, 'error', 'Queue');
    } finally {
        isProcessing = false;
        processQueue(); 
    }
}

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

app.post('/api/config', async (req, res) => {
    try {
        await saveAiConfigToSheet(req.body);
        logger.log('AI Context updated & saved to Sheets.', 'success', 'System');
        res.status(200).send('Saved');
    } catch (error) {
        console.error(error);
        res.status(500).send('Failed to save config');
    }
});

app.post('/api/action', async (req, res) => {
    try {
        const { sheetName, rowIndex, triggerValue, customPrompt, target } = req.body;
        
        // 1. Instantly update the actual Google Sheet so the state "travels back"
        await updateSheetTrigger(sheetName, rowIndex, triggerValue);
        
        // 2. Push it directly to our processing queue
        const targetName = `${sheetName} Row ${rowIndex}`;
        let logMsg = `Manual UI Action Triggered for [${targetName}] -> ${triggerValue}`;
        if (customPrompt) logMsg += ` (Targeting: ${target.toUpperCase()} - Custom Rules Applied)`;
        logger.log(logMsg, 'info', 'System');
        
        requestQueue.push({ sheetName, rowIndex, triggerValue, customPrompt, target });
        processQueue();
        
        res.status(200).send('Action queued');
    } catch (error) {
        console.error(error);
        res.status(500).send(error.message);
    }
});

app.get('/api/tpms', async (req, res) => {
    try {
        const tpms = await getTpms();
        res.json(tpms);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/kanban', async (req, res) => {
    try {
        const data = await getKanbanData(req.query.sheet);
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/kanban/update', async (req, res) => {
    try {
        const { sheetName, row, colKey, newValue } = req.body;
        await updateKanbanCell(sheetName, row, colKey, newValue);
        res.status(200).send('Updated');
    } catch (error) {
        res.status(500).send(error.message);
    }
});

app.post('/webhook', async (req, res) => {
    res.status(200).send('Queued');
    
    // 👇 THE FIX: Grab the sheet and row immediately so we know WHO is knocking
    const targetName = req.body.sheetName ? `${req.body.sheetName} Row ${req.body.rowIndex}` : 'Unknown Task';
    
    logger.log(`Webhook received for [${targetName}]. Position in queue: ${requestQueue.length + 1}`, 'info', 'System');
    requestQueue.push(req.body);
    processQueue();
});

const PORT = process.env.PORT || 3005;
server.listen(PORT, () => {
    console.log(`\n🚀 TPM Master Orchestrator Online on port ${PORT}`);
});