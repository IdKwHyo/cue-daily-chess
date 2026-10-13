const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { startServer } = require('../server.cjs');
const fs = require('node:fs');
(async () => {
 const server = await startServer({port:0});
 const browser = await chromium.launch({headless:true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? {executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH} : {}), args:['--no-sandbox','--disable-dev-shm-usage']});
 try {
  const page = await browser.newPage({viewport:{width:700,height:760}}), errors=[], requests=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(() => {
   const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
   window.desktop={scan:async()=>({name:'Mock display',dataUrl:image}),resizeOverlay:async height=>{window.overlayHeight=height},onScan:()=>{},platform:'linux',call:async(action,payload)=>{
    window.lastRequest={action,payload};
    if(action==='settings')return {hasKey:true,hasGroqKey:true,model:'fixture',canRemember:false};
    if(action==='configure')return {hasKey:true,model:'fixture'};
    if(action==='generate'){
     (window.requests ||= []).push(payload);
     return payload.action==='extract' ? {questions:[{text:'First question?',kind:'written'},{text:'Second question?',kind:'written'}],answer:''} : {answer:'## A clear response\nChecked reasoning.\n<img src=x onerror=alert(1)>',usage:10};
    }
   }};
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(()=>window.overlayHeight===84);
  assert.equal(await page.locator('#cuePopup').isVisible(),false);
  await page.click('#scan');
  await page.waitForFunction(()=>document.querySelector('#answerContent').textContent.includes('Checked reasoning'));
  assert.equal(await page.locator('#cuePopup').isVisible(),true);
  assert.equal(await page.evaluate(()=>window.overlayHeight),700);
  assert.equal(await page.locator('.queue-item').count(),1);
  assert.equal(await page.locator('#answerContent img').count(),0);
  assert.deepEqual(await page.evaluate(()=>window.requests.map(r=>r.action)),['answer']);
  assert.equal(await page.evaluate(()=>window.requests[0].images.length),1);
  await page.fill('#followup','Why?');await page.click('#sendFollowup');
  await page.waitForFunction(()=>document.querySelector('.followup-turn'));
  assert.equal(await page.evaluate(()=>window.requests.at(-1).action),'followup');
  await page.click('#dismissCue');assert.equal(await page.locator('#cuePopup').isVisible(),false);
  await page.click('[data-mode=daily]');await page.click('#scan');
  await page.waitForFunction(()=>window.requests.at(-1).mode==='daily' && !document.querySelector('#answer').disabled);
  assert.equal(await page.evaluate(()=>window.requests.at(-1).action),'answer');
  await page.click('#overlaySettings');await page.locator('#settingsDialog').waitFor({state:'visible'});
  assert.equal(await page.evaluate(()=>window.overlayHeight),760);
  await page.click('[data-close=settingsDialog]');
  for(const width of [700,420,320]){await page.setViewportSize({width,height:760});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`overflow at ${width}`)}
  await page.setViewportSize({width:700,height:760});
  await page.locator('#cuePopup').evaluate(e=>e.scrollTop=0);
  fs.mkdirSync(__dirname+'/../test-results',{recursive:true});
  await page.screenshot({path:__dirname+'/../test-results/desktop.png'});
  await page.setViewportSize({width:320,height:760});await page.screenshot({path:__dirname+'/../test-results/mobile.png'});
  await page.setViewportSize({width:700,height:760});
  await page.evaluate(fs.readFileSync(require.resolve('axe-core/axe.min.js'),'utf8'));
  const audit=await page.evaluate(()=>axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa']}}));
  assert.equal(audit.violations.length,0,JSON.stringify(audit.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))));
  assert.deepEqual(errors,[]);
  console.log('Passed: collapsed toolbar, Daily screenshot → natural answer popup, screenshot retention, safe rendering, follow-up, Daily capture, settings sizing, collapse, 700/420/320 widths, no uncaught errors, zero axe WCAG2A/AA violations. Native capture and provider calls mocked.');
 } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1});
