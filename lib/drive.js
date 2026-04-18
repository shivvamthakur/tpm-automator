const { google } = require('googleapis');
const { Readable } = require('stream'); // Import stream
const config = require('../config');

async function uploadPDFToDrive(auth, fileName, pdfBuffer) {
  const drive = google.drive({ version: 'v3', auth });
  
  // Convert the Buffer to a Readable Stream to fix the .pipe error
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
      body: bufferStream // Pass the stream instead of the raw Buffer
    },
    fields: 'id, webViewLink',
    supportsAllDrives: true
  });

  return response.data.webViewLink;
}

module.exports = { uploadPDFToDrive };