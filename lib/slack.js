const { WebClient } = require('@slack/web-api');
const config = require('../config');

// Initialize with the single Workspace Bot Token
const client = new WebClient(config.SLACK_BOT_TOKEN);

/**
 * Sends a formatted message to a specific Slack channel using the Bot Token
 * @param {string} channelId - The ID of the channel (e.g., C12345XYZ) from Column AI
 * @param {string} markdownText - The AI-generated Slack draft from the sheet
 */
async function sendSlackUpdate(channelId, markdownText) {
  try {
    if (!channelId) throw new Error("Slack Channel Code is missing for this project.");

    // The chat.postMessage API uses the Bot Token to post to the specified channel
    const result = await client.chat.postMessage({
      channel: channelId,
      text: markdownText // Slack automatically renders standard Markdown
    });

    return result.ok;
  } catch (error) {
    console.error('❌ Slack Distribution Error:', error.message);
    throw error;
  }
}

module.exports = { sendSlackUpdate };