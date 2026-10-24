// Optional UI test: NODE_PATH=/path/to/playwright/node_modules node scripts/file-browser-browser-test.cjs
// Requires Chrome. Uses a temporary file root, isolated app state and an ephemeral port.
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const assert = require('node:assert/strict');
(async () => {
  const root = path.resolve(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(),'ana-files-ui-'));
  const files = path.join(temp,'강의 파일'); fs.mkdirSync(files); fs.mkdirSync(path.join(files,'캡처 이미지')); fs.writeFileSync(path.join(files,'안내.txt'),'ANA 파일 탐색기');
  fs.mkdirSync(path.join(root, '.ana/reports/files-browser'), { recursive: true });
  const probe = require('node:http').createServer();
  await new Promise(r => probe.listen(0, '127.0.0.1', r));
  const port = probe.address().port; await new Promise(r => probe.close(r));
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,PORT:String(port),ANA_DATA_DIR:path.join(temp,'data'),ANA_FILES_ROOT:files,ANA_SEED:'0',NOTIFY_AGENT:'0',TMUX_SESSION:'ana-files-qa-missing'},stdio:'ignore'});
  let browser;
  try {
    for(let i=0;i<100;i++){try {if((await fetch(origin + '/api/files')).ok)break;}catch{} await new Promise(r=>setTimeout(r,100));}
    browser = await chromium.launch({channel:'chrome',headless:true}); const page = await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true}); const errors=[]; page.on('pageerror',e=>errors.push(e.message));
    await page.goto(origin); await page.locator('.topnav [data-view="files"]').click(); await page.locator('#filesList').getByText('안내.txt',{exact:false}).waitFor();
    assert.equal(await page.locator('#filesUp').isDisabled(),true);
    await page.locator('#filesList').getByRole('button',{name:'📁 캡처 이미지'}).click(); await page.getByText('This folder is empty.',{exact:true}).waitFor();
    await page.locator('#filesInput').setInputFiles({name:'테스트 업로드.txt',mimeType:'text/plain',buffer:Buffer.from('업로드와 다운로드 검증')});
    await page.getByText('1 file uploaded',{exact:true}).waitFor();
    const pending = page.waitForEvent('download'); await page.locator('#filesList').getByText('Download',{exact:true}).click(); const download=await pending;
    assert.equal(fs.readFileSync(await download.path(),'utf8'),'업로드와 다운로드 검증');
    await page.locator('#filesInput').setInputFiles({name:'테스트 업로드.txt',mimeType:'text/plain',buffer:Buffer.from('overwrite')});
    await page.locator('#filesStatus').filter({hasText:'A file with this name already exists.'}).waitFor();
    assert.equal(fs.readFileSync(path.join(files,'캡처 이미지','테스트 업로드.txt'),'utf8'),'업로드와 다운로드 검증');
    await page.locator('#filesRefresh').click(); await page.getByText('1 item',{exact:true}).waitFor();
    await page.screenshot({path:path.join(root,'.ana/reports/files-browser/desktop.png')});
    await page.setViewportSize({width:390,height:844}); await page.waitForTimeout(700); if (await page.locator('#chatCloseBtn').isVisible()) await page.locator('#chatCloseBtn').click(); await page.waitForTimeout(500); await page.screenshot({path:path.join(root,'.ana/reports/files-browser/mobile.png')});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth > innerWidth),false);
    await page.locator('#filesUp').click(); await page.locator('#filesList').getByText('안내.txt',{exact:false}).waitFor(); assert.equal(await page.locator('#filesUp').isDisabled(),true);
    await page.reload(); await page.locator('#filesView.on').waitFor(); await page.locator('#filesList').getByText('안내.txt',{exact:false}).waitFor();
    assert.deepEqual(errors,[]); console.log('PASS: real browser navigation, upload, download byte equality, duplicate protection, mobile layout, persisted Files tab; no JS errors');
  } finally {if(browser)await browser.close();if (child.exitCode === null) { child.kill(); await new Promise(r=>child.once('exit',r)); }fs.rmSync(temp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
