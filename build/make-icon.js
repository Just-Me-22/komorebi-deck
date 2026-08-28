/* Renders the Split mark at each size Windows asks for and packs them into an
   .ico. Run with `npx electron build/make-icon.js` after changing the artwork.
   The packaged icon cannot follow the accent, so it uses the default one. */
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

const COLOUR = "#6d8cff";
const SIZES = [16, 24, 32, 48, 64, 128, 256];
const OUT = path.join(__dirname, "icon.ico");

const page = (size) => `data:text/html;charset=utf-8,${encodeURIComponent(`
<style>html,body{margin:0;background:transparent}svg{display:block}</style>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}">
  <rect x="4" y="4" width="56" height="56" rx="13" fill="none"
        stroke="${COLOUR}" stroke-width="5"/>
  <rect x="15" y="15" width="15" height="34" rx="3" fill="${COLOUR}"/>
</svg>`)}`;

// Vista onwards accepts PNG payloads inside an .ico, which avoids writing a BMP
// encoder and keeps the alpha channel intact.
function pack(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + images.length * 16;
  const entries = images.map(({ size, png }) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size === 256 ? 0 : size, 0);
    e.writeUInt8(size === 256 ? 0 : size, 1);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += png.length;
    return e;
  });
  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  // One window, redrawn and cropped per size. Opening a 24px BrowserWindow per
  // size failed outright: Windows has a minimum window size and the loads below
  // it were rejected.
  const w = new BrowserWindow({
    show: false, width: 300, height: 300, frame: false, transparent: true,
    backgroundColor: "#00000000", useContentSize: true,
  });
  await w.loadURL(page(256));
  await new Promise((r) => setTimeout(r, 400));

  const images = [];
  for (const size of SIZES) {
    await w.webContents.executeJavaScript(
      `(() => { const s = document.querySelector("svg");
        s.setAttribute("width", ${size}); s.setAttribute("height", ${size}); return 0; })()`);
    await new Promise((r) => setTimeout(r, 90));
    const shot = await w.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
    images.push({ size, png: shot.toPNG() });
  }

  fs.writeFileSync(OUT, pack(images));
  console.log(`${OUT}  ${fs.statSync(OUT).size} bytes`);
  images.forEach((i) => console.log(`  ${String(i.size).padStart(3)}px  ${i.png.length} bytes`));
  app.quit();
});
