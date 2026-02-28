
import puppeteer from 'puppeteer';
import fs from 'node:fs';

function resolveExecutablePath(): string | undefined {
    const envPath = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH;
    if (envPath && fs.existsSync(envPath)) {
        return envPath;
    }

    const commonPaths = process.platform === 'darwin'
        ? [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Chromium.app/Contents/MacOS/Chromium'
        ]
        : [
            '/usr/bin/google-chrome',
            '/usr/bin/google-chrome-stable',
            '/usr/bin/chromium',
            '/usr/bin/chromium-browser'
        ];

    for (const path of commonPaths) {
        if (fs.existsSync(path)) {
            return path;
        }
    }

    return undefined;
}

export async function generatePdfFromHtml(html: string) {
    const executablePath = resolveExecutablePath();
    const launchOptions = {
        headless: true as const,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        ...(executablePath ? { executablePath } : {})
    };

    let browser;
    try {
        browser = await puppeteer.launch(launchOptions);
    } catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (!message.includes('configured executablePath')) {
            throw error;
        }

        const previousPuppeteerExecutablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
        const previousChromePath = process.env.CHROME_PATH;

        try {
            delete process.env.PUPPETEER_EXECUTABLE_PATH;
            delete process.env.CHROME_PATH;
            browser = await puppeteer.launch({
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });
        } finally {
            if (previousPuppeteerExecutablePath !== undefined) {
                process.env.PUPPETEER_EXECUTABLE_PATH = previousPuppeteerExecutablePath;
            }
            if (previousChromePath !== undefined) {
                process.env.CHROME_PATH = previousChromePath;
            }
        }
    }
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
