const { google } = require('googleapis');
const { Readable } = require('stream');
const config = require('../config');

/**
 * Uploads a PDF Buffer to Google Drive
 */
async function uploadPDFToDrive(auth, fileName, pdfBuffer) {
  const drive = google.drive({ version: 'v3', auth });
  
  const bufferStream = new Readable();
  bufferStream.push(pdfBuffer);
  bufferStream.push(null);

  const response = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [config.DRIVE_FOLDER_ID],
      mimeType: 'application/pdf'
    },
    media: {
      mimeType: 'application/pdf',
      body: bufferStream 
    },
    fields: 'id, webViewLink',
    supportsAllDrives: true // Required if using Shared Drives
  });

  return response.data.webViewLink;
}

/**
 * NEW: Creates a Google Doc for Slack Review
 * This converts raw text into a high-fidelity Google Doc
 */
async function createSlackDoc(auth, fileName, slackContent) {
    const drive = google.drive({ version: 'v3', auth });
    
    // We pass the Slack mrkdwn text as a stream
    const textStream = new Readable();
    textStream.push(slackContent);
    textStream.push(null);

    const response = await drive.files.create({
        requestBody: {
            name: fileName,
            // Setting mimeType here converts the upload into a Google Doc
            mimeType: 'application/vnd.google-apps.document', 
            parents: [config.DRIVE_FOLDER_ID]
        },
        media: {
            mimeType: 'text/plain',
            body: textStream
        },
        fields: 'id, webViewLink',
        supportsAllDrives: true
    });

    // OPTIONAL: Set permissions to "Anyone with link can view" 
    // so you don't get 'Access Denied' when clicking from the Sheet.
    try {
        await drive.permissions.create({
            fileId: response.data.id,
            requestBody: {
                role: 'reader',
                type: 'anyone',
            },
            supportsAllDrives: true
        });
    } catch (permError) {
        console.warn('⚠️ Could not set public permissions on Slack Doc, check Shared Drive settings.');
    }

    return response.data.webViewLink;
}

module.exports = { 
    uploadPDFToDrive,
    createSlackDoc 
};