// Screenshot helper for local visual checks: node tools/shot.js <url> <out.png> [width] [height] [fullPage]
const { chromium } = require("playwright-core");
const fs = require("fs");
(async () => {
  const [url, out, w = 1280, h = 900, full = "1"] = process.argv.slice(2);
  const exe = ["/opt/pw-browsers/chromium", ...fs.readdirSync("/opt/pw-browsers").map((d) => `/opt/pw-browsers/${d}/chrome-linux/chrome`)].find((p) => fs.existsSync(p) && fs.statSync(p).isFile());
  const b = await chromium.launch({ executablePath: exe });
  const p = await b.newPage({ viewport: { width: +w, height: +h } });
  p.on("console", (m) => m.type() === "error" && console.log("console:", m.text()));
  p.on("pageerror", (e) => console.log("pageerror:", e.message));
  await p.goto(url, { waitUntil: "networkidle" });
  await p.waitForTimeout(400);
  await p.screenshot({ path: out, fullPage: full === "1" });
  await b.close();
})();
