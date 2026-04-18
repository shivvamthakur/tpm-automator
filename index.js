require('dotenv').config();
const express = require('express');
const { google } = require('googleapis');

// Configuration and Modular Libraries
const config = require('./config');
const sheets = require('./lib/sheets');
const drive = require('./lib/drive');
const gemini = require('./lib/gemini');
const pdf = require('./lib/pdf');
const slack = require('./lib/slack');

// Initialize Express Server for Event-Driven Webhooks
const app = express();
app.use(express.json());

// Initialize Google Auth (Requires both Sheets and Drive scopes)
const auth = new google.auth.GoogleAuth({
  keyFile: './google-credentials.json',
  scopes: [
    'https://www.googleapis.com/auth/spreadsheets', 
    'https://www.googleapis.com/auth/drive.file'
  ],
});

/**
 * WEBHOOK ENDPOINT
 * Google Sheets (via Apps Script) posts to this endpoint whenever a cell is edited.
 */
app.post('/webhook', async (req, res) => {
  // 1. Instantly acknowledge the webhook so Google Sheets doesn't time out
  res.status(200).send('Event received');

  const { sheetName, rowIndex, triggerValue } = req.body;
  if (!sheetName || !rowIndex || !triggerValue) return;

  console.log(`\n🔔 Webhook Triggered! Sheet: ${sheetName}, Row: ${rowIndex}, Event: ${triggerValue}`);

  try {
    const authClient = await auth.getClient();
    const gsapi = await sheets.getSheetsInstance(authClient);

    // 2. Fetch ONLY the specific row that was edited for maximum efficiency
    const response = await gsapi.spreadsheets.values.get({
      spreadsheetId: config.SPREADSHEET_ID,
      range: `${sheetName}!A${rowIndex}:AN${rowIndex}`,
    });

    const rowData = response.data.values ? response.data.values[0] : null;
    if (!rowData) {
      console.log('⚠️ No data found for this row.');
      return;
    }

    const projectName = rowData[1] || 'Unknown-Project';

    // ====================================================================
    // GATE 1: AI GENERATION & ARCHIVAL
    // ====================================================================
    if (triggerValue.toLowerCase() === 'new') {
      console.log(`🚀 Processing NEW gate for [${projectName}]...`);

      const context = {
        status: rowData[12],      // Index 12: 'Current Status'
        notes: rowData[15],       // Index 15: 'Task and Status comments'
        template: rowData[33],    // Index 33: 'Template' instructions
      };

      // A. Intelligence Layer: Generate drafts
      console.log(`🤖 Synthesizing drafts with Gemini...`);
      const drafts = await gemini.generateAIDrafts(projectName, context);

      // B. PDF Conversion: Create immutable record
      console.log(`📄 Converting HTML to professional PDF...`);
      const fullHtmlContent = `<html>${config.EMAIL_CSS_SKELETON}<body>${drafts.email}</body></html>`;
      const pdfBuffer = await pdf.convertHTMLToPDF(fullHtmlContent);

      // C. Shared Drive Archival
      const date = new Date().toISOString().split('T')[0];
      const fileName = `WSR-${projectName}-${date}.pdf`;
      console.log(`📁 Archiving to Shared Drive...`);
      const driveLink = await drive.uploadPDFToDrive(authClient, fileName, pdfBuffer);

      // D. Write Back & State Management
      console.log(`✍️ Updating Google Sheet...`);
      // Update AJ (Slack), AK (Email HTML), AL (PDF Link)
      await sheets.updateRow(gsapi, config.SPREADSHEET_ID, `${sheetName}!AJ${rowIndex}:AL${rowIndex}`, 
        [drafts.slack, drafts.email, driveLink]);

      // Move trigger to 'under review' to await TPM approval
      await sheets.updateRow(gsapi, config.SPREADSHEET_ID, `${sheetName}!AM${rowIndex}`, ['under review']);

      console.log(`✅ Gate 1 Complete. PDF archived: ${driveLink}`);
    }

    // ====================================================================
    // GATE 2: SLACK DISTRIBUTION
    // ====================================================================
    else if (triggerValue.toLowerCase() === 'approved') {
      console.log(`📡 Distributing APPROVED update for [${projectName}]...`);

      const slackChannelCode = rowData[34]; // Index 34: Slack Channel Code (e.g., C12345XYZ)
      const slackDraft = rowData[35];       // Index 35: Slack Markdown Draft

      if (!slackChannelCode) {
        console.log(`⚠️ Missing Slack Channel Code for ${projectName}. Aborting distribution.`);
        return;
      }

      // Distribute to Slack via Bot Token
      const isSlackSuccess = await slack.sendSlackUpdate(slackChannelCode, slackDraft);

      if (isSlackSuccess) {
        console.log(`🚀 Slack update delivered to channel ${slackChannelCode}`);
        
        // Close the loop
        await sheets.updateRow(gsapi, config.SPREADSHEET_ID, `${sheetName}!AM${rowIndex}`, ['published']);
        console.log(`✅ Gate 2 Complete. Status set to 'published'.`);
      }
    }

  } catch (error) {
    console.error('❌ Webhook Execution Error:', error.message);
  }
});

// Start the Event Listener
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🎧 TPM Event Listener & Orchestrator running on port ${PORT}`);
  console.log(`📡 Waiting for Google Sheets webhooks...`);
});