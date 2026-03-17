
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

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

function isServerlessRuntime() {
    return Boolean(process.env.VERCEL || process.env.AWS_EXECUTION_ENV || process.env.LAMBDA_TASK_ROOT);
}

function resolveChromiumBinPath() {
    const candidates = [
        process.env.CHROMIUM_BIN_PATH,
        path.join(process.cwd(), 'node_modules', '@sparticuz', 'chromium', 'bin'),
        '/var/task/node_modules/@sparticuz/chromium/bin',
        '/var/task/webapp/node_modules/@sparticuz/chromium/bin'
    ].filter((candidate): candidate is string => Boolean(candidate));

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }

    return undefined;
}

async function launchBrowser() {
    if (isServerlessRuntime()) {
        const [{ default: chromium }, puppeteerCore] = await Promise.all([
            import('@sparticuz/chromium'),
            import('puppeteer-core')
        ]);

        const chromiumBinPath = resolveChromiumBinPath();

        const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH
            || process.env.CHROME_PATH
            || await chromium.executablePath(chromiumBinPath);

        return puppeteerCore.launch({
            args: chromium.args,
            executablePath,
            headless: true
        });
    }

    const executablePath = resolveExecutablePath();
    const launchOptions = {
        headless: true as const,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        ...(executablePath ? { executablePath } : {})
    };

    try {
        return await puppeteer.launch(launchOptions);
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
            return await puppeteer.launch({
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
}

export async function generatePdfFromHtml(html: string) {
    const browser = await launchBrowser();
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
