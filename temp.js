
const { google } = require('googleapis');
const keys = require('./google-credentials.json');

// Safety check: Did the keys load correctly?
if (!keys.client_email || !keys.private_key) {
  console.error('❌ Missing keys! Please check your google-credentials.json file.');
  process.exit(1);
}

const client = new google.auth.JWT(
  keys.client_email,
  null,
  keys.private_key,
  ['https://www.googleapis.com/auth/spreadsheets']
);

async function testConnection() {
  try {
    // Force the client to authorize FIRST. 
    // If your keys are bad, it will fail right here with a helpful error.
    await client.authorize();
    console.log('✅ Service account authorized successfully!');

    const gsapi = google.sheets({ version: 'v4', auth: client });
    
    const opt = {
      // REPLACE THIS with your actual Spreadsheet ID
      spreadsheetId: '10eU-PIpTrBUcQUeIC4dXsfJEAAUXF6Ehj2dTkOBbZvY', 
      // Ensure this matches the exact name of your tab (e.g., Sheet1 or MVP)
      range: 'Shivam!A1:G1' 
    };

    let data = await gsapi.spreadsheets.values.get(opt);
    console.log('✅ Connection Successful! Column Headers Found:');
    console.log(data.data.values[0]);

  } catch (error) {
    console.error('❌ Error connecting to Google Sheets:');
    console.error(error.message);
  }
}

testConnection();