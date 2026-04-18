const { google } = require('googleapis');

async function getSheetsInstance(auth) {
  return google.sheets({ version: 'v4', auth });
}

async function getAllTabs(gsapi, spreadsheetId) {
  const spreadsheet = await gsapi.spreadsheets.get({ spreadsheetId });
  return spreadsheet.data.sheets.map(s => s.properties.title);
}

async function getTabData(gsapi, spreadsheetId, tpmName) {
  const response = await gsapi.spreadsheets.values.get({
    spreadsheetId,
    range: `${tpmName}!A2:AN`,
  });
  return response.data.values || [];
}

// Standardized name to match your index.js call
async function updateRow(gsapi, spreadsheetId, range, values) {
  return gsapi.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: 'USER_ENTERED',
    resource: { values: [values] }
  });
}

// Ensure updateRow is explicitly exported here
module.exports = { getSheetsInstance, getAllTabs, getTabData, updateRow };