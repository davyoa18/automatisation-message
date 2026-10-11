// Rend des images d'une animation Lottie (lottie-web, rendu SVG) dans Chromium.
// usage : node render.js anim.json out_dir frames(ex "0,10,20" ou "0-59" ou "all") [taille] [fond]
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

(async () => {
  const [file, outDir, framesArg, sizeArg, bgArg] = process.argv.slice(2);
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const size = parseInt(sizeArg || '560', 10);
  const bg = bgArg || '#B31F00';
  let frames = [];
  if (framesArg === 'all') { for (let f = data.ip; f < data.op; f++) frames.push(f); }
  else for (const part of framesArg.split(',')) {
    if (part.includes('-')) { const [a, b] = part.split('-').map(Number); for (let f = a; f <= b; f++) frames.push(f); }
    else frames.push(Number(part));
  }
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  const lottieSrc = fs.readFileSync(path.join(__dirname, 'node_modules/lottie-web/build/player/lottie.min.js'), 'utf8');
  const transparent = bg === 'transparent';
  await page.setContent(`<html><body style="margin:0;background:${transparent ? 'transparent' : bg}"><div id="c" style="width:${size}px;height:${size}px"></div></body></html>`);
  await page.addScriptTag({ content: lottieSrc });
  await page.evaluate((d) => new Promise((res) => {
    window.anim = lottie.loadAnimation({ container: document.getElementById('c'), renderer: 'svg', loop: false, autoplay: false, animationData: d });
    window.anim.addEventListener('DOMLoaded', () => res());
  }), data);
  // laisse le temps aux images base64 de se decoder
  await page.waitForTimeout(400);
  for (const f of frames) {
    await page.evaluate((fr) => window.anim.goToAndStop(fr, true), f);
    await page.waitForTimeout(15);
    await page.screenshot({ path: path.join(outDir, 'f' + String(f).padStart(4, '0') + '.png'), omitBackground: transparent });
  }
  await browser.close();
})();
