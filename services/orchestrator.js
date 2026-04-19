const { google } = require('googleapis');
const config = require('../config');
const gemini = require('../lib/gemini');
const mistral = require('../lib/mistral');
const drive = require('../lib/drive');
const pdf = require('../lib/pdf');
const slack = require('../lib/slack');
const logger = require('../utils/logger');

const credentialsPath = process.env.RENDER ? '/etc/secrets/google-credentials.json' : './google-credentials.json';
const auth = new google.auth.GoogleAuth({
  keyFile: credentialsPath,
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
});

// 🚥 THE TRAFFIC COP
let routeToGeminiNext = true; 

let aiConfig = { emailColumns: [], slackColumns: [] };

// 🧠 THE MEMORY
let cachedSchema = null;
let schemaCacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; 

function extractLatestNotes(text) {
    if (!text) return "";
    return text.split(/\n\s*\n/)[0].trim();
}

async function getVisibleHeaders(gsapi, spreadsheetId, sheetName) {
    const spreadsheet = await gsapi.spreadsheets.get({ spreadsheetId, includeGridData: true, ranges: [`${sheetName}!1:1`] });
    const sheet = spreadsheet.data.sheets.find(s => s.properties.title === sheetName);
    if (!sheet || sheet.properties.hidden) return null;
    
    const columnsMetadata = sheet.data[0].columnMetadata || [];
    const rowData = sheet.data[0].rowData[0].values || [];
    
    return rowData.map((cell, index) => {
        const isHidden = columnsMetadata[index] && (columnsMetadata[index].hiddenByFilter || columnsMetadata[index].pixelSize === 0);
        return isHidden ? null : (cell.formattedValue ? cell.formattedValue.trim() : null);
    });
}

function getColIndex(headers, colName) {
    const idx = headers.indexOf(colName);
    if (idx === -1) throw new Error(`CRITICAL: Cannot find column named "${colName}" in sheet.`);
    return idx;
}

function indexToLetter(index) {
    let letter = '';
    while (index >= 0) {
        letter = String.fromCharCode((index % 26) + 65) + letter;
        index = Math.floor(index / 26) - 1;
    }
    return letter;
}

function extractDriveId(url) {
    if (!url) return null;
    const match = url.match(/[-\w]{25,}/);
    return match ? match[0] : null;
}

async function getDynamicSchema(gsapi, spreadsheetId) {
    if (cachedSchema && (Date.now() - schemaCacheTime < CACHE_TTL)) return cachedSchema;

    let colMap = { 
        projectName: 'Project Name', 
        slackChannelId: 'Slack Channel ID', 
        slackDraft: 'Slack Draft (Raw Text)', 
        trigger: 'Trigger', 
        slackUrl: 'Slack Link', 
        emailUrl: 'Email Link', 
        currentStatus: 'Current Status',
        phase: 'Phase',
        assignee: 'Assignee',
        dueDate: 'Due Date',
        taskComments: 'Task and Status comments',
        currentIntegrations: 'Current Integrations',
        completedScope: 'Completed Scope'
    };

    try {
        const response = await gsapi.spreadsheets.values.get({ spreadsheetId, range: `System_Settings!A2:B20` });
        const rows = response.data.values;
        if (rows && rows.length > 0) {
            rows.forEach(row => {
                const key = row[0] ? row[0].trim() : '';
                const val = row[1] ? row[1].trim() : '';
                if (key && val) {
                    if (key === 'emailColumns' || key === 'slackColumns') {
                        aiConfig[key] = val.split(',').map(s => s.trim()).filter(s => s);
                    } else {
                        colMap[key] = val;
                    }
                }
            });
        }
        cachedSchema = colMap;
        schemaCacheTime = Date.now();
        logger.log(`Schema fetched & cached for 5 mins 🧠`, 'info', 'System');
        return colMap;
    } catch (error) {
        logger.log('Could not find System_Settings tab, using defaults.', 'warning', 'System');
        return colMap;
    }
}

async function runAutomationTask(task) {
    const { sheetName, rowIndex, triggerValue, customPrompt, target } = task;
   // 👇 THE FIX: Give it a temporary context name until we fetch the real one
let authClient, gsapi, projectName = `${sheetName} R${rowIndex}`;
    const sid = `task-${Date.now()}`;

    try {
        authClient = await auth.getClient();
        gsapi = google.sheets({ version: 'v4', auth: authClient });

        const colMap = await getDynamicSchema(gsapi, config.SPREADSHEET_ID);
        const headers = await getVisibleHeaders(gsapi, config.SPREADSHEET_ID, sheetName);
        if (!headers) throw new Error("Sheet is hidden.");

        const response = await gsapi.spreadsheets.values.get({
            spreadsheetId: config.SPREADSHEET_ID,
            range: `${sheetName}!A${rowIndex}:BZ${rowIndex}`, // 📉 RAM OPTIMIZATION: BZ is 78 columns max
        });
        const rowData = response.data.values ? response.data.values[0] : null;
        if (!rowData) throw new Error("Row is empty.");
        
        const projIdx = headers.indexOf(colMap.projectName);
        projectName = projIdx !== -1 ? rowData[projIdx] : 'Unknown Project';
        const dateSuffix = new Date().toLocaleDateString('en-GB').replace(/\//g, '-');
        
        logger.log(`Data locked for ${projectName}.`, 'success', projectName, `${sid}-data`);

        if (triggerValue.toLowerCase() === 'new' || triggerValue.toLowerCase() === 'refine') {
            const buildCtx = (cols) => {
                const ctx = {};
                if (!cols || cols.length === 0) return ctx;
                cols.forEach(c => {
                    const i = headers.indexOf(c);
                    if (i !== -1 && rowData[i]) {
                        let val = rowData[i].trim();
                        if (c === 'Task and Status comments') val = extractLatestNotes(val);
                        if (val && val !== "-") ctx[c] = val; 
                    }
                });
                return ctx;
            };

            const context = { email: buildCtx(aiConfig.emailColumns), slack: buildCtx(aiConfig.slackColumns) };
            logger.log(`Context compiled dynamically.`, 'success', projectName, `${sid}-ctx`);

            let finalCustomPrompt = customPrompt;
            if (customPrompt && target) {
                 finalCustomPrompt = `[CRITICAL INSTRUCTION: APPLY THIS SPECIFIC CHANGE TO THE ${target.toUpperCase()} DRAFT ONLY] ${customPrompt}`;
            }

            let drafts;
            let successfulModel = '';
            try {
                if (routeToGeminiNext) {
                    logger.log(`[Router] Sending traffic to Gemini...`, 'loading', projectName, `${sid}-gemini-run`);
                    try {
                        drafts = await gemini.generateAIDrafts(projectName, context, finalCustomPrompt);
                        successfulModel = 'Gemini';
                        logger.log(`Drafts generated by Gemini.`, 'success', projectName, `${sid}-gemini-run`);
                    } catch (err) {
                        logger.log(`Gemini limit hit. Bouncing to Mistral...`, 'warning', projectName, `${sid}-gemini-run`);
                        logger.log(`[Failover] Routing to Mistral...`, 'loading', projectName, `${sid}-mistral-fail`);
                        drafts = await mistral.generateAIDrafts(projectName, context, finalCustomPrompt);
                        successfulModel = 'Mistral';
                        logger.log(`Drafts generated by Mistral (Failover).`, 'success', projectName, `${sid}-mistral-fail`);
                    }
                } else {
                    logger.log(`[Router] Sending traffic to Mistral...`, 'loading', projectName, `${sid}-mistral-run`);
                    try {
                        drafts = await mistral.generateAIDrafts(projectName, context, finalCustomPrompt);
                        successfulModel = 'Mistral';
                        logger.log(`Drafts generated by Mistral.`, 'success', projectName, `${sid}-mistral-run`);
                    } catch (err) {
                        logger.log(`Mistral limit hit. Bouncing to Gemini...`, 'warning', projectName, `${sid}-mistral-run`);
                        logger.log(`[Failover] Routing to Gemini...`, 'loading', projectName, `${sid}-gemini-fail`);
                        drafts = await gemini.generateAIDrafts(projectName, context, finalCustomPrompt);
                        successfulModel = 'Gemini';
                        logger.log(`Drafts generated by Gemini (Failover).`, 'success', projectName, `${sid}-gemini-fail`);
                    }
                }
                routeToGeminiNext = !routeToGeminiNext;
            } catch (criticalErr) {
                throw new Error("CRITICAL: Both AI services failed on this row.");
            }

            const oldSlackUrl = rowData[getColIndex(headers, colMap.slackUrl)] || '';
            const oldEmailUrl = rowData[getColIndex(headers, colMap.emailUrl)] || '';
            const oldSlackId = extractDriveId(oldSlackUrl);
            const oldEmailId = extractDriveId(oldEmailUrl);

            logger.log(`Firing up ${target ? target.toUpperCase() : 'PDF and Slack'} generation tasks... 🏎️💨`, 'loading', projectName, `${sid}-docs-main`);
            
            let emailLink = oldEmailUrl;
            let slackLink = oldSlackUrl;
            let updatedDocs = [];
            const taskPromises = [];

            if (triggerValue.toLowerCase() === 'new' || target === 'pdf') {
                const html = `<html>${config.EMAIL_CSS_SKELETON}<body>${drafts.email}</body></html>`;
                const emailFileName = `emailWSR-${projectName}-${dateSuffix}.pdf`;
                const p = pdf.convertHTMLToPDF(html).then(pdfBuf => drive.uploadPDFToDrive(authClient, emailFileName, pdfBuf, oldEmailId)).then(url => emailLink = url);
                taskPromises.push(p);
                updatedDocs.push('PDF');
            }

            if (triggerValue.toLowerCase() === 'new' || target === 'slack') {
                const slackFileName = `slackWSR-${projectName}-${dateSuffix}`;
                const p = drive.createSlackDoc(authClient, slackFileName, drafts.slack, oldSlackId).then(url => slackLink = url);
                taskPromises.push(p);
                updatedDocs.push('Slack');
            }

            await Promise.all(taskPromises);

            const actionVerb = triggerValue.toLowerCase() === 'refine' ? 'regenerated with custom rules' : 'generated & uploaded to Drive';
            logger.log(`${updatedDocs.join(' and ')} document(s) ${actionVerb}.`, 'success', projectName, `${sid}-docs-main`);

            logger.log(`Updating Sheet...`, 'loading', projectName, `${sid}-wb`);
            
            const updateData = [];
            
            if (triggerValue.toLowerCase() === 'new' || target === 'slack') {
                const draftCol = indexToLetter(getColIndex(headers, colMap.slackDraft));
                const slackUrlCol = indexToLetter(getColIndex(headers, colMap.slackUrl));
                updateData.push({ range: `${sheetName}!${draftCol}${rowIndex}`, values: [[ String(drafts.slack) ]] });
                updateData.push({ range: `${sheetName}!${slackUrlCol}${rowIndex}`, values: [[ String(slackLink) ]] });
            }
            
            if (triggerValue.toLowerCase() === 'new' || target === 'pdf') {
                const emailUrlCol = indexToLetter(getColIndex(headers, colMap.emailUrl));
                updateData.push({ range: `${sheetName}!${emailUrlCol}${rowIndex}`, values: [[ String(emailLink) ]] });
            }
            
            const triggerCol = indexToLetter(getColIndex(headers, colMap.trigger));
            updateData.push({ range: `${sheetName}!${triggerCol}${rowIndex}`, values: [[ 'under review' ]] });

            await gsapi.spreadsheets.values.batchUpdate({
                spreadsheetId: config.SPREADSHEET_ID,
                resource: {
                    valueInputOption: 'RAW',
                    data: updateData
                }
            });
            logger.log(`✅ Generation Complete.`, 'success', projectName, `${sid}-wb`, {
                sheetName,
                rowIndex,
                model: successfulModel,
                links: {
                    slack: slackLink,
                    pdf: emailLink
                }
            });
        }
        else if (triggerValue.toLowerCase() === 'approved') {
            const slackChannelId = rowData[getColIndex(headers, colMap.slackChannelId)]; 
            const slackMessage = rowData[getColIndex(headers, colMap.slackDraft)];
            if (!slackChannelId || !slackMessage) throw new Error("Missing Slack ID or Draft Text in Sheet.");

            const isSuccess = await slack.sendSlackUpdate(slackChannelId, slackMessage);
            if (isSuccess) {
                const triggerColLetter = indexToLetter(getColIndex(headers, colMap.trigger));
                await gsapi.spreadsheets.values.update({
                    spreadsheetId: config.SPREADSHEET_ID,
                    range: `${sheetName}!${triggerColLetter}${rowIndex}`,
                    valueInputOption: 'RAW',
                    resource: { values: [['published']] }
                });
                logger.log(`🚀 Distribution Complete.`, 'success', projectName, `${sid}-slack`);
            } else {
                throw new Error("Slack API Error.");
            }
        }
    } catch (e) {
        logger.log(`Error: ${e.message}`, 'error', projectName, sid);
    }
}

async function getVisibleHeadersForUi() {
    const authClient = await auth.getClient();
    const gsapi = google.sheets({ version: 'v4', auth: authClient });
    const meta = await gsapi.spreadsheets.get({ spreadsheetId: config.SPREADSHEET_ID });
    const firstSheet = meta.data.sheets.find(s => !s.properties.hidden);
    const headers = await getVisibleHeaders(gsapi, config.SPREADSHEET_ID, firstSheet.properties.title);
    
    cachedSchema = null; // Force refresh on UI load
    await getDynamicSchema(gsapi, config.SPREADSHEET_ID);
    return { headers: headers.filter(h => h !== null), activeConfig: aiConfig };
}

async function updateSheetTrigger(sheetName, rowIndex, triggerValue) {
    const authClient = await auth.getClient();
    const gsapi = google.sheets({ version: 'v4', auth: authClient });
    const colMap = await getDynamicSchema(gsapi, config.SPREADSHEET_ID);
    const headers = await getVisibleHeaders(gsapi, config.SPREADSHEET_ID, sheetName);
    
    const triggerCol = indexToLetter(getColIndex(headers, colMap.trigger));
    
    await gsapi.spreadsheets.values.update({
        spreadsheetId: config.SPREADSHEET_ID,
        range: `${sheetName}!${triggerCol}${rowIndex}`,
        valueInputOption: 'USER_ENTERED',
        resource: { values: [[ triggerValue ]] }
    });
}

async function saveAiConfigToSheet(newConfig) {
    if (newConfig.emailColumns) aiConfig.emailColumns = newConfig.emailColumns;
    if (newConfig.slackColumns) aiConfig.slackColumns = newConfig.slackColumns;
    const authClient = await auth.getClient();
    const gsapi = google.sheets({ version: 'v4', auth: authClient });

    await gsapi.spreadsheets.values.update({
        spreadsheetId: config.SPREADSHEET_ID,
        range: `System_Settings!A15:B16`,
        valueInputOption: 'RAW',
        resource: {
            values: [['emailColumns', aiConfig.emailColumns.join(', ')], ['slackColumns', aiConfig.slackColumns.join(', ')]]
        }
    });
}

async function getTpms() {
    const authClient = await auth.getClient();
    const gsapi = google.sheets({ version: 'v4', auth: authClient });
    const meta = await gsapi.spreadsheets.get({ spreadsheetId: config.SPREADSHEET_ID });
    // Return all visible tabs
    return meta.data.sheets.filter(s => !s.properties.hidden && s.properties.title !== 'System_Settings').map(s => s.properties.title);
}

async function getKanbanData(requestedSheetName = null) {
    const authClient = await auth.getClient();
    const gsapi = google.sheets({ version: 'v4', auth: authClient });
    
    let sheetName = requestedSheetName;
    if (!sheetName) {
        const meta = await gsapi.spreadsheets.get({ spreadsheetId: config.SPREADSHEET_ID });
        sheetName = meta.data.sheets.find(s => !s.properties.hidden).properties.title;
    }
    
    const headers = await getVisibleHeaders(gsapi, config.SPREADSHEET_ID, sheetName);
    const colMap = await getDynamicSchema(gsapi, config.SPREADSHEET_ID);

    const response = await gsapi.spreadsheets.values.get({
        spreadsheetId: config.SPREADSHEET_ID,
        range: `${sheetName}!A2:BZ` // 📉 RAM OPTIMIZATION: Prevent Node.js OOM on large sheets
    });
    
    const rows = response.data.values || [];
    const projCol = getColIndex(headers, colMap.projectName);
    const triggerCol = getColIndex(headers, colMap.trigger);
    const draftCol = getColIndex(headers, colMap.slackDraft);
    
    // Status might not exist in every user's sheet, so we use indexOf to prevent crashes
    const currentStatusCol = headers.indexOf(colMap.currentStatus);
    const phaseCol = headers.indexOf(colMap.phase);
    const assigneeCol = headers.indexOf(colMap.assignee);
    const dueDateCol = headers.indexOf(colMap.dueDate);
    const taskCommentsCol = headers.indexOf(colMap.taskComments);
    const currentIntegrationsCol = headers.indexOf(colMap.currentIntegrations);
    const completedScopeCol = headers.indexOf(colMap.completedScope);

    return rows.map((row, index) => {
        return {
            row: index + 2, // A2 starts at row 2
            sheetName,
            projectName: row[projCol] ? row[projCol].trim() : 'Untitled Project',
            status: row[triggerCol] ? row[triggerCol].trim().toLowerCase() : '',
            currentStatus: currentStatusCol !== -1 && row[currentStatusCol] ? row[currentStatusCol].trim() : 'Uncategorized',
            phase: phaseCol !== -1 && row[phaseCol] ? row[phaseCol].trim() : 'General',
            assignee: assigneeCol !== -1 && row[assigneeCol] ? row[assigneeCol].trim() : '',
            dueDate: dueDateCol !== -1 && row[dueDateCol] ? row[dueDateCol].trim() : '',
            taskComments: taskCommentsCol !== -1 && row[taskCommentsCol] ? row[taskCommentsCol].trim() : '',
            currentIntegrations: currentIntegrationsCol !== -1 && row[currentIntegrationsCol] ? row[currentIntegrationsCol].trim() : '',
            completedScope: completedScopeCol !== -1 && row[completedScopeCol] ? row[completedScopeCol].trim() : '',
            description: draftCol !== -1 && row[draftCol] ? row[draftCol].trim() : ''
        };
    }).filter(r => r.projectName !== 'Untitled Project');
}

async function updateKanbanCell(sheetName, rowIndex, colKey, newValue) {
    const authClient = await auth.getClient();
    const gsapi = google.sheets({ version: 'v4', auth: authClient });
    const headers = await getVisibleHeaders(gsapi, config.SPREADSHEET_ID, sheetName);
    const colMap = await getDynamicSchema(gsapi, config.SPREADSHEET_ID);

    const idx = headers.indexOf(colMap[colKey] || colKey);
    if (idx === -1) throw new Error(`Column "${colMap[colKey] || colKey}" not found in sheet.`);
    const colLetter = indexToLetter(idx);
    
    await gsapi.spreadsheets.values.update({
        spreadsheetId: config.SPREADSHEET_ID,
        range: `${sheetName}!${colLetter}${rowIndex}`,
        valueInputOption: 'USER_ENTERED',
        resource: { values: [[newValue]] }
    });
}

module.exports = { runAutomationTask, getVisibleHeadersForUi, saveAiConfigToSheet, updateSheetTrigger, getKanbanData, updateKanbanCell, getTpms };