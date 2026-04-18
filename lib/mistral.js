const { Mistral } = require('@mistralai/mistralai');
const config = require('../config');

const client = new Mistral({ apiKey: process.env.MISTRAL_API_KEY });

function sanitizeOutput(str) {
    if (!str) return "";
    return str.replace(/[\u0000-\u0019]+/g, "").trim();
}

async function generateAIDrafts(projectName, context) {
  try {
    const today = new Date().toLocaleDateString('en-GB', { 
        day: '2-digit', month: 'short', year: 'numeric' 
    });

    const response = await client.chat.complete({
      model: 'mistral-large-latest',
      messages: [
        { 
          role: 'system', 
          content: `You are a Senior Executive TPM Assistant. Output ONLY a valid JSON object.
          
          JSON Structure:
          {
            "email": "HTML string",
            "slack": "Markdown string"
          }

          =========================================
          SLACK FORMATTING (STRICT BLUEPRINT)
          =========================================
          *${projectName} | Weekly Project Status Update | Week Ending: ${today}*
          *Overall Status:* <STATUS> <STATUS_EMOJI>

          *Progress*
          • <PROGRESS_ITEM_1>
          • <PROGRESS_ITEM_2>

          *WIP*
          • <WIP_ITEM_1>
          • <WIP_ITEM_2>

          *Next Steps*
          • <NEXT_STEP_1>
          • <NEXT_STEP_2>

          RULES FOR SLACK:
          1. EMOJI MAPPING (CRITICAL): Use actual Unicode emojis. Do NOT use text shortcodes like :red_circle:.
             - If "On Track" use 🟢
             - If "At Risk" use 🟠
             - If "Delayed" use 🔴
             - If "On Hold" use ⏸️
        2. LEADERSHIP TONE & DETAIL: Expand raw, shorthand fragments into readable, professional sentences. Clearly articulate technical progress and exact blockers for an executive audience. Do not make the update overly lengthy; balance comprehensive detail with executive brevity.
3. CONCISE BULLETS: Avoid long, dense paragraphs. Break complex updates down into sharp, easily digestible bullet points.
4. BULLET CHARACTER: ALWAYS use the "•" character for all bulleted lists. Do not use asterisks, dashes, or other symbols.
5. VERTICAL SPACING (CRITICAL): You MUST use exactly one blank line (\\n\\n) between every major section header and its content to ensure proper "breathing room" and readability. 
6. ADAPTIVE STRUCTURE: You may introduce additional contextual headings or sub-pointers if the provided raw data necessitates it for optimal clarity.
7. NEXT STEPS: Always place the "Next Steps" section at the very end of the update. Keep these action items brief, direct, and actionable.

          =========================================
          EMAIL FORMATTING
          =========================================
          - Highly detailed, professional HTML body.
          - Apply this CSS to all tables: ${config.EMAIL_CSS_SKELETON}` 
        },
        { 
          role: 'user', 
          content: `Project Context (Latest Updates Only): ${JSON.stringify(context)}` 
        }
      ],
      response_format: { type: 'json_object' } 
    });

    let content = response.choices[0].message.content;
    content = content.replace(/```json/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(sanitizeOutput(content));

    return { email: parsed.email, slack: parsed.slack };
  } catch (error) {
    throw error;
  }
}

module.exports = { generateAIDrafts };