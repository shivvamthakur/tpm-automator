const puppeteer = require('puppeteer');

// 👇 THE OPTIMIZATION: Keep the engine running
let globalBrowser = null;

async function getBrowser() {
    if (!globalBrowser) {
        console.log("🚙 Booting Headless Chrome for the first time...");
        globalBrowser = await puppeteer.launch({
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null,
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
            headless: 'new'
        });
    }
    return globalBrowser;
}

async function convertHTMLToPDF(htmlContent) {
    const browser = await getBrowser();
    
    // Open a new TAB, not a whole new browser
    const page = await browser.newPage();
    
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true });
    
    // Close the TAB, leave the browser running for the next row!
    await page.close(); 
    
    return pdfBuffer;
}

module.exports = { convertHTMLToPDF };