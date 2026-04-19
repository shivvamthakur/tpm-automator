const puppeteer = require('puppeteer');

let globalBrowser = null;
let idleTimer = null;
const IDLE_TIMEOUT_MS = 60000; // 60 seconds

async function getBrowser() {
    // If a request comes in, cancel any pending shutdown
    if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
    }

    if (!globalBrowser) {
        console.log("🚙 Booting Headless Chrome (Low Memory Mode)...");
        globalBrowser = await puppeteer.launch({
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null,
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage', // Prevent shared memory crashes
                '--disable-gpu',
                '--no-zygote',
                '--single-process',        // Crucial for 512MB RAM limits
                '--memory-pressure-off'
            ],
            headless: 'new'
        });
    }
    return globalBrowser;
}

function scheduleBrowserShutdown() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(async () => {
        if (globalBrowser) {
            console.log("🛑 Closing Headless Chrome due to inactivity to free RAM...");
            await globalBrowser.close().catch(e => console.error("Browser close error:", e));
            globalBrowser = null;
        }
    }, IDLE_TIMEOUT_MS);
}

async function convertHTMLToPDF(htmlContent) {
    const browser = await getBrowser();
    let page;
    try {
        page = await browser.newPage();
        
        // We wrap setContent in its own try/catch to absolutely guarantee it never crashes the queue
        try {
            await page.setContent(htmlContent, { waitUntil: 'networkidle2', timeout: 15000 });
        } catch (timeoutErr) {
            console.log("⚠️ Puppeteer network wait timed out, forcing PDF generation anyway...");
        }
        
        return await page.pdf({ format: 'A4', printBackground: true });
    } finally {
        if (page) await page.close(); // Always close the tab
        scheduleBrowserShutdown();    // Start the 60s kill timer
    }
}

module.exports = { convertHTMLToPDF };