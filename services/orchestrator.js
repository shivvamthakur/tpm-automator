const { google } = require('googleapis');
const config = require('../config');
const gemini = require('../lib/gemini');
const mistral = require('../lib/mistral');
const drive = require('../lib/drive');
const pdf = require('../lib/pdf');
const slack = require('../lib/slack');
const logger = require('../utils/logger');

// 🛑 Smart Pathing for Render Secrets
const credentialsPath = process.env.RENDER ? '/etc/secrets/google-credentials.json' : './google-credentials.json';

const auth = new google.auth.GoogleAuth({
  keyFile: credentialsPath,
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
});

function extractLatestNotes(text) {
    if (!text) return "";
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

// 🛑 THE NEW BRAINS: Fetches schema from the hidden System_Settings tab
async function getDynamicSchema(gsapi, spreadsheetId) {
    let colMap = {
        projectName: 'Project Name',
        slackChannelId: 'Slack Channel ID',
        slackDraft: 'Slack Draft (Raw Text)',
        trigger: 'Trigger'
    };

    try {
        const response = await gsapi.spreadsheets.values.get({
            spreadsheetId,
            range: `System_Settings!A2:B20`,
        });
        
        const rows = response.data.values;
        if (rows && rows.length > 0) {
            rows.forEach(row => {
                if (row[0] && row[1]) colMap[row[0].trim()] = row[1].trim();
            });
        }
        return colMap;
    } catch (error) {
        logger.log('Could not find System_Settings tab, using default columns.', 'warning', 'System');
        return colMap;
    }
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

        logger.log(`Loading Schema Map...`, 'loading', 'System', `${sid}-schema`);
        const colMap = await getDynamicSchema(gsapi, config.SPREADSHEET_ID);

        logger.log(`Fetching project data...`, 'loading', sheetName, `${sid}-data`);
        const headers = await getVisibleHeaders(gsapi, config.SPREADSHEET_ID, sheetName);
        if (!headers) throw new Error("Sheet is hidden.");

        const response = await gsapi.spreadsheets.values.get({
            spreadsheetId: config.SPREADSHEET_ID,
            range: `${sheetName}!A${rowIndex}:ZZ${rowIndex}`, 
        });
        const rowData = response.data.values ? response.data.values[0] : null;
        if (!rowData) throw new Error("Row is empty.");
        
        const projIdx = headers.indexOf(colMap.projectName);
        projectName = projIdx !== -1 ? rowData[projIdx] : 'Unknown Project';
        const dateSuffix = new Date().toLocaleDateString('en-GB').replace(/\//g, '-');
        
        logger.log(`Data locked for ${projectName}.`, 'success', projectName, `${sid}-data`);

        if (triggerValue.toLowerCase() === 'new') {
            logger.log(`Compiling AI Context...`, 'loading', projectName, `${sid}-ctx`);
            
            // Send a lean context to the AI to avoid the 4MB payload crash
            const context = {
                progress: rowData[getColIndex(headers, 'Progress')] || '',
                wip: rowData[getColIndex(headers, 'WIP')] || '',
                notes: extractLatestNotes(rowData[getColIndex(headers, 'Task and Status comments')]) || ''
            };
            logger.log(`Context ready.`, 'success', projectName, `${sid}-ctx`);

            logger.log(`AI Synthesis (Gemini 2.5)...`, 'loading', projectName, `${sid}-ai`);
            let drafts;
            try {
                drafts = await gemini.generateAIDrafts(projectName, context);
                logger.log(`Drafts generated by Gemini.`, 'success', projectName, `${sid}-ai`);
            } catch (err) {
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
            
            const slackDraftColLetter = indexToLetter(getColIndex(headers, colMap.slackDraft));
            const triggerColLetter = indexToLetter(getColIndex(headers, colMap.trigger));
            
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

module.exports = { runAutomationTask };