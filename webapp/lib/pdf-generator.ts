
import puppeteer from 'puppeteer';

export async function generatePdfFromHtml(html: string) {
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        executablePath: '/Users/diegorodriguez/.cache/puppeteer/chrome/mac_arm-143.0.7499.169/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
    });
    const page = await browser.newPage();

    // Set viewport to a standard A4 size
    await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 2 });

    // Set content and wait for network to be idle (for any images/fonts)
    await page.setContent(html, { waitUntil: 'networkidle0' });

    // Generate PDF
    const pdf = await page.pdf({
        format: 'Letter',
        printBackground: true,
        margin: {
            top: '0cm',
            right: '0cm',
            bottom: '0cm',
            left: '0cm'
        }
    });

    await browser.close();
    return pdf;
}
