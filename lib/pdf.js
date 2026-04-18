const puppeteer = require('puppeteer');

async function convertHTMLToPDF(htmlContent) {
  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();
  
  await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
  
  const pdfBuffer = await page.pdf({
    format: 'A4',
    printBackground: true,
    margin: { top: '20px', right: '20px', bottom: '20px', left: '20px' }
  });

  await browser.close();
  return pdfBuffer;
}

module.exports = { convertHTMLToPDF };