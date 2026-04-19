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

async function getDynamicSchema(gsapi, spreadsheetId) {
    if (cachedSchema && (Date.now() - schemaCacheTime < CACHE_TTL)) return cachedSchema;

    let colMap = { projectName: 'Project Name', slackChannelId: 'Slack Channel ID', slackDraft: 'Slack Draft (Raw Text)', trigger: 'Trigger',slackUrl: 'Slack Link', // 👈 NEW
        emailUrl: 'Email Link', };

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
    const { sheetName, rowIndex, triggerValue } = task;
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
            range: `${sheetName}!A${rowIndex}:ZZ${rowIndex}`, 
        });
        const rowData = response.data.values ? response.data.values[0] : null;
        if (!rowData) throw new Error("Row is empty.");
        
        const projIdx = headers.indexOf(colMap.projectName);
        
        // 👇 THE FIX: Overwrite the temporary name with the REAL Project Name!
        if (projIdx !== -1 && rowData[projIdx]) {
            projectName = rowData[projIdx];
        }
        
        const dateSuffix = new Date().toLocaleDateString('en-GB').replace(/\//g, '-');
        
        // Now it switches perfectly to the real project name for the rest of the logs
        logger.log(`Data locked for ${projectName}.`, 'success', projectName, `${sid}-data`);

        if (triggerValue.toLowerCase() === 'new') {
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

            let drafts;
            try {
                if (routeToGeminiNext) {
                    logger.log(`[Router] Sending traffic to Gemini...`, 'loading', projectName, `${sid}-gemini-run`);
                    try {
                        drafts = await gemini.generateAIDrafts(projectName, context);
                        logger.log(`Drafts generated by Gemini.`, 'success', projectName, `${sid}-gemini-run`);
                    } catch (err) {
                        logger.log(`Gemini limit hit. Bouncing to Mistral...`, 'warning', projectName, `${sid}-gemini-run`);
                        logger.log(`[Failover] Routing to Mistral...`, 'loading', projectName, `${sid}-mistral-fail`);
                        drafts = await mistral.generateAIDrafts(projectName, context);
                        logger.log(`Drafts generated by Mistral (Failover).`, 'success', projectName, `${sid}-mistral-fail`);
                    }
                } else {
                    logger.log(`[Router] Sending traffic to Mistral...`, 'loading', projectName, `${sid}-mistral-run`);
                    try {
                        drafts = await mistral.generateAIDrafts(projectName, context);
                        logger.log(`Drafts generated by Mistral.`, 'success', projectName, `${sid}-mistral-run`);
                    } catch (err) {
                        logger.log(`Mistral limit hit. Bouncing to Gemini...`, 'warning', projectName, `${sid}-mistral-run`);
                        logger.log(`[Failover] Routing to Gemini...`, 'loading', projectName, `${sid}-gemini-fail`);
                        drafts = await gemini.generateAIDrafts(projectName, context);
                        logger.log(`Drafts generated by Gemini (Failover).`, 'success', projectName, `${sid}-gemini-fail`);
                    }
                }
                routeToGeminiNext = !routeToGeminiNext;
            } catch (criticalErr) {
                throw new Error("CRITICAL: Both AI services failed on this row.");
            }

            logger.log(`Firing up PDF and Slack tasks concurrently... 🏎️💨`, 'loading', projectName, `${sid}-docs-main`);
            const html = `<html>${config.EMAIL_CSS_SKELETON}<body>${drafts.email}</body></html>`;
            const emailFileName = `emailWSR-${projectName}-${dateSuffix}.pdf`;
            const slackFileName = `slackWSR-${projectName}-${dateSuffix}`;

            const emailTask = pdf.convertHTMLToPDF(html).then(pdfBuf => drive.uploadPDFToDrive(authClient, emailFileName, pdfBuf));
            const slackTask = drive.createSlackDoc(authClient, slackFileName, drafts.slack);

            const [emailLink, slackLink] = await Promise.all([emailTask, slackTask]);
            logger.log(`Both documents published perfectly.`, 'success', projectName, `${sid}-docs-main`);

            logger.log(`Updating Sheet...`, 'loading', projectName, `${sid}-wb`);
            
            // 1. Find the exact column letter for every single piece of data
            const draftCol = indexToLetter(getColIndex(headers, colMap.slackDraft));
            const slackUrlCol = indexToLetter(getColIndex(headers, colMap.slackUrl));
            const emailUrlCol = indexToLetter(getColIndex(headers, colMap.emailUrl));
            const triggerCol = indexToLetter(getColIndex(headers, colMap.trigger));
            
            // 2. Use batchUpdate to snipe exact cells. Column order no longer matters!
            await gsapi.spreadsheets.values.batchUpdate({
                spreadsheetId: config.SPREADSHEET_ID,
                resource: {
                    valueInputOption: 'RAW',
                    data: [
                        { range: `${sheetName}!${draftCol}${rowIndex}`, values: [[ String(drafts.slack) ]] },
                        { range: `${sheetName}!${slackUrlCol}${rowIndex}`, values: [[ String(slackLink) ]] },
                        { range: `${sheetName}!${emailUrlCol}${rowIndex}`, values: [[ String(emailLink) ]] },
                        { range: `${sheetName}!${triggerCol}${rowIndex}`, values: [[ 'under review' ]] }
                    ]
                }
            });
            logger.log(`✅ Generation Complete.`, 'success', projectName, `${sid}-wb`);
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

module.exports = { runAutomationTask, getVisibleHeadersForUi, saveAiConfigToSheet };