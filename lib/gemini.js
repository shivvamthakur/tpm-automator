const { GoogleGenerativeAI } = require('@google/generative-ai');
const config = require('../config');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function generateAIDrafts(projectName, data) {
  // Use the 'latest' alias to avoid 404 versioning errors
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
  
  const prompt = `
    Project: ${projectName}
    Current Status: ${data.status}
    Raw Notes: ${data.notes}
    Instructions: ${data.template}
    
    TASK: Return two variations separated by exactly '|||'.
    1. Slack: Concise Markdown with emojis.
    2. Email: Production-ready HTML body. Use inline CSS for tables.
    Reference CSS Style: ${config.EMAIL_CSS_SKELETON}
  `;

  const result = await model.generateContent(prompt);
  const response = result.response.text();
  const splitDrafts = response.split('|||');

  return {
    slack: splitDrafts[0]?.trim() || "Slack draft failed.",
    email: splitDrafts[1]?.trim() || "Email draft failed."
  };
}

module.exports = { generateAIDrafts };