const { google } = require('googleapis');
const config = require('../config');
const gemini = require('../lib/gemini');
const mistral = require('../lib/mistral');
const drive = require('../lib/drive');
const pdf = require('../lib/pdf');
const slack = require('../lib/slack');
const logger = require('../utils/logger');

// 🛑 THE FIX: Smart Pathing for Render Secrets vs Local Development
const credentialsPath = process.env.RENDER ? '/etc/secrets/google-credentials.json' : './google-credentials.json';

const auth = new google.auth.GoogleAuth({
  keyFile: credentialsPath,
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
});

let aiConfig = {
    emailColumns: ['Current Status', 'Task and Status comments', 'Template'],
    slackColumns: ['Current Status', 'Task and Status comments', 'Template']
};

function extractLatestNotes(text) {
    if (!text) return "";
    // Only grab the very first block of text before a double line break
    const sections = text.split(/\n\s*\n/);
    return sections[0].trim();
}

async function getVisibleHeaders(gsapi, spreadsheetId, sheetName) {
    const spreadsheet = await gsapi.spreadsheets.get({
        spreadsheetId,
        includeGridData: true,
        ranges: [`${sheetName}!1:1`]
    });
    const sheet = spreadsheet.data.sheets.find(s => s.properties.title === sheetName);
    if (!sheet || sheet.properties.hidden) return null;
    
    const columnsMetadata = sheet.data[0].columnMetadata || [];
    const rowData = sheet.data[0].rowData[0].values || [];
    
    return rowData.map((cell, index) => {
        const isHidden = columnsMetadata[index] && (columnsMetadata[index].hiddenByFilter || columnsMetadata[index].pixelSize === 0);
        return isHidden ? null : (cell.formattedValue ? cell.formattedValue.trim() : null);
    });
}

// Helper to reliably find a column index by its exact name, regardless of where the TPM moves it.
function getColIndex(headers, colName) {
    const idx = headers.indexOf(colName);
    if (idx === -1) throw new Error(`CRITICAL: Cannot find column named "${colName}" in sheet.`);
    return idx;
}

// Helper to convert a number index to a spreadsheet letter (e.g., 0 -> A, 26 -> AA)
function indexToLetter(index) {
    let letter = '';
    while (index >= 0) {
        letter = String.fromCharCode((index % 26) + 65) + letter;
        index = Math.floor(index / 26) - 1;
    }
    return letter;
}

async function runAutomationTask(task) {
    const { sheetName, rowIndex, triggerValue } = task;
    let authClient, gsapi, projectName = 'System';
    const sid = `task-${Date.now()}`;

    try {
        logger.log(`Connecting to Workspace...`, 'loading', 'System', `${sid}-auth`);
        authClient = await auth.getClient();
        gsapi = google.sheets({ version: 'v4', auth: authClient });
        logger.log(`Connected to Google APIs.`, 'success', 'System', `${sid}-auth`);

        logger.log(`Fetching project data...`, 'loading', sheetName, `${sid}-data`);
        const headers = await getVisibleHeaders(gsapi, config.SPREADSHEET_ID, sheetName);
        if (!headers) throw new Error("Sheet is hidden.");

        // Grab a massive chunk of the row to ensure we capture all columns safely
        const response = await gsapi.spreadsheets.values.get({
            spreadsheetId: config.SPREADSHEET_ID,
            range: `${sheetName}!A${rowIndex}:ZZ${rowIndex}`, 
        });
        const rowData = response.data.values ? response.data.values[0] : null;
        if (!rowData) throw new Error("Row is empty.");
        
        // Find the Project Name cleanly
        const projIdx = headers.indexOf('Project Name');
        projectName = projIdx !== -1 ? rowData[projIdx] : 'Unknown Project';
        const dateSuffix = new Date().toLocaleDateString('en-GB').replace(/\//g, '-');
        
        logger.log(`Data locked for ${projectName}.`, 'success', projectName, `${sid}-data`);

        if (triggerValue.toLowerCase() === 'new') {
            logger.log(`Compiling AI Context...`, 'loading', projectName, `${sid}-ctx`);
            
            const buildCtx = (cols) => {
                const ctx = {};
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
            logger.log(`Context ready.`, 'success', projectName, `${sid}-ctx`);

            logger.log(`AI Synthesis (Gemini 2.5 Flash)...`, 'loading', projectName, `${sid}-ai`);
            let drafts;
            try {
                drafts = await gemini.generateAIDrafts(projectName, context);
                logger.log(`Drafts generated by Gemini.`, 'success', projectName, `${sid}-ai`);
            } catch (err) {
                // Warning state triggered, delay to let the user read it, then failover
                logger.log(`Gemini Limit hit. Failing over to Mistral...`, 'warning', projectName, `${sid}-ai`);
                await new Promise(r => setTimeout(r, 1500)); 
                drafts = await mistral.generateAIDrafts(projectName, context);
                logger.log(`Drafts generated by Mistral (Failover).`, 'success', projectName, `${sid}-ai`);
            }

            logger.log(`Generating Documents...`, 'loading', projectName, `${sid}-docs`);
            const html = `<html>${config.EMAIL_CSS_SKELETON}<body>${drafts.email}</body></html>`;
            const pdfBuf = await pdf.convertHTMLToPDF(html);
            const emailLink = await drive.uploadPDFToDrive(authClient, `emailWSR-${projectName}-${dateSuffix}.pdf`, pdfBuf);
            const slackLink = await drive.createSlackDoc(authClient, `slackWSR-${projectName}-${dateSuffix}`, drafts.slack);
            logger.log(`Documents published to Drive.`, 'success', projectName, `${sid}-docs`);

            logger.log(`Updating Sheet...`, 'loading', projectName, `${sid}-wb`);
            
            // Calculate EXACTLY where the write-back columns are so we don't break the sheet
            const slackDraftColLetter = indexToLetter(getColIndex(headers, 'Slack Draft (Raw Text)'));
            const triggerColLetter = indexToLetter(getColIndex(headers, 'Trigger'));
            
            await gsapi.spreadsheets.values.update({
                spreadsheetId: config.SPREADSHEET_ID,
                range: `${sheetName}!${slackDraftColLetter}${rowIndex}:${triggerColLetter}${rowIndex}`,
                valueInputOption: 'RAW',
                resource: { values: [[ String(drafts.slack), String(slackLink), String(emailLink), 'under review' ]] }
            });
            logger.log(`✅ Generation Complete.`, 'success', projectName, `${sid}-wb`);
        }
        else if (triggerValue.toLowerCase() === 'approved') {
            logger.log(`Distributing to Slack...`, 'loading', projectName, `${sid}-slack`);
            
            // Look up Slack details dynamically by header name
            const slackChannelId = rowData[getColIndex(headers, 'Slack Channel ID')]; 
            const slackMessage = rowData[getColIndex(headers, 'Slack Draft (Raw Text)')];

            if (!slackChannelId || !slackMessage) throw new Error("Missing Slack ID or Draft Text in Sheet.");

            const isSuccess = await slack.sendSlackUpdate(slackChannelId, slackMessage);
            if (isSuccess) {
                const triggerColLetter = indexToLetter(getColIndex(headers, 'Trigger'));
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
    
    // Find the first sheet that isn't hidden
    const firstSheet = meta.data.sheets.find(s => !s.properties.hidden);
    const headers = await getVisibleHeaders(gsapi, config.SPREADSHEET_ID, firstSheet.properties.title);
    
    return { headers: headers.filter(h => h !== null), activeConfig: aiConfig };
}

function updateAiConfig(newConfig) {
    if (newConfig.emailColumns) aiConfig.emailColumns = newConfig.emailColumns;
    if (newConfig.slackColumns) aiConfig.slackColumns = newConfig.slackColumns;
}

module.exports = { runAutomationTask, getVisibleHeadersForUi, updateAiConfig };