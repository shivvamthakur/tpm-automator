module.exports = {
  SPREADSHEET_ID: '10eU-PIpTrBUcQUeIC4dXsfJEAAUXF6Ehj2dTkOBbZvY',
  DRIVE_FOLDER_ID: '1gVpomIQKSKSZfC16VgCNy7kCTwIIE9cN', // Replace with your Folder ID
  SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN,
  EMAIL_CSS_SKELETON: `
    <style>
      body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
      .container { width: 100%; max-width: 600px; margin: 0 auto; border: 1px solid #eee; padding: 20px; }
      table { width: 100%; border-collapse: collapse; margin: 20px 0; }
      th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
      th { background-color: #f2f2f2; }
    </style>
  `
};