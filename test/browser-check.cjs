const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { startServer } = require('../server.cjs');
const fs = require('node:fs');
(async () => {
 const server = await startServer({port:0});
 const browser = await chromium.launch({headless:true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? {executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH} : {}), args:['--no-sandbox','--disable-dev-shm-usage']});
 try {
  const page = await browser.newPage({viewport:{width:700,height:760}}), errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(() => {
   const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
   window.requests=[]; window.scanCount=0;
   Object.defineProperty(navigator, 'clipboard', {value:{writeText:async text=>{window.copiedText=text}}});
   Object.defineProperty(navigator, 'mediaDevices', {value:{getUserMedia:async()=>({getTracks:()=>[{stop(){window.micStopped=true}}]})}});
   window.MediaRecorder=class {
    static isTypeSupported(){return true}
    constructor(_stream,options){this.mimeType=options.mimeType}
    start(){}
    stop(){this.ondataavailable({data:new Blob(['audio fixture'.repeat(100)])});this.onstop()}
   };
   window.desktop={scan:async()=>{window.scanCount++;return {name:'Mock display',dataUrl:image}},resizeOverlay:async height=>{window.overlayHeight=height},onScan:callback=>{window.scanEvent=callback},platform:'linux',call:async(action,payload)=>{
    if(action==='settings')return {hasKey:true,hasGroqKey:true,voiceProvider:'groq',model:'fixture',canRemember:false};
    if(action==='configure')return {hasKey:true,model:'fixture'};
    if(action==='generate'){
     window.requests.push(payload);
     if(window.failNext){window.failNext=false;throw new Error('Temporary provider failure. Please retry.');}
     return payload.action==='transcribe' ? {answer:window.transcript || 'Can we talk about my day?',usage:1} : {answer:`## A clear response\nChecked reasoning for: ${payload.question}\n<img src=x onerror=alert(1)>`,usage:10};
    }
   }};
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(()=>window.overlayHeight===84);
  assert.equal(await page.locator('#cuePopup').isVisible(),false);
  await page.click('#toggleCue');
  assert.equal(await page.locator('#followup').isEnabled(),true,'A new Daily chat must accept typing before any capture');
  await page.fill('#followup','Hey Cue, help me plan my afternoon.');
  await page.click('#sendFollowup');
  await page.waitForFunction(()=>!document.querySelector('#followup').disabled);
  assert.equal(await page.evaluate(()=>window.scanCount),0);
  assert.equal(await page.evaluate(()=>window.requests[0].question),'Hey Cue, help me plan my afternoon.');
  assert.deepEqual(await page.evaluate(()=>window.requests[0].images),[]);
  assert.match(await page.locator('#answerContent').textContent(),/plan my afternoon/);
  assert.equal(await page.locator('#answerContent img').count(),0);
  await page.fill('#followup','Make it less busy.'); await page.click('#sendFollowup');
  await page.waitForFunction(()=>!document.querySelector('#followup').disabled);
  assert.equal(await page.evaluate(()=>window.requests.at(-1).history[0].question),'Hey Cue, help me plan my afternoon.');
  assert.equal(await page.evaluate(()=>window.requests.at(-1).question),'Make it less busy.');
  await page.click('#copy');
  assert.match(await page.evaluate(()=>window.copiedText),/Make it less busy/);
  assert.doesNotMatch(await page.evaluate(()=>window.copiedText),/plan my afternoon/);
  await page.evaluate(()=>{window.desktop.platform='darwin';window.desktop.stopSpeaking=async()=>{};window.desktop.speak=async text=>{window.spokenText=text}});
  await page.click('#readAloud'); await page.waitForFunction(()=>window.spokenText);
  assert.match(await page.evaluate(()=>window.spokenText),/Make it less busy/);
  assert.doesNotMatch(await page.evaluate(()=>window.spokenText),/plan my afternoon/);
  await page.evaluate(()=>{window.desktop.platform='linux'});
  // Speech starts a normal conversation turn, in the visible composer.
  await page.click('#record'); await page.waitForFunction(()=>document.querySelector('#record').getAttribute('aria-pressed')==='true');
  await page.click('#record'); await page.waitForFunction(()=>document.querySelector('#followup').value.includes('my day'));
  assert.equal(await page.evaluate(()=>window.micStopped),true);
  assert.equal(await page.locator('#followup').isEnabled(),true);
  assert.equal(await page.locator('#question').inputValue(),'Hey Cue, help me plan my afternoon.');
  await page.click('#sendFollowup'); await page.waitForFunction(()=>!document.querySelector('#followup').disabled);
  assert.equal(await page.evaluate(()=>window.requests.at(-1).question),'Can we talk about my day?');
  assert.deepEqual(await page.evaluate(()=>window.requests.at(-1).images),[]);
  // Capture-only waits for a typed or dictated instruction.
  const beforeAttach=await page.evaluate(()=>window.requests.length);
  await page.click('#attachScreen'); await page.waitForFunction(()=>document.querySelector('#attachments img'));
  assert.equal(await page.evaluate(()=>window.requests.length),beforeAttach);
  assert.equal(await page.locator('#attachments').isVisible(),true);
  await page.evaluate(()=>{window.transcript='Explain the question on this screen.'});
  await page.click('#record'); await page.waitForFunction(()=>document.querySelector('#record').getAttribute('aria-pressed')==='true');
  await page.click('#record'); await page.waitForFunction(()=>document.querySelector('#followup').value==='Explain the question on this screen.');
  await page.click('#sendFollowup');
  await page.waitForFunction(()=>!document.querySelector('#followup').disabled);
  assert.equal(await page.evaluate(()=>window.requests.at(-1).images.length),1);
  assert.equal(await page.evaluate(()=>window.requests.at(-1).question),'Explain the question on this screen.');
  assert.ok(await page.evaluate(()=>window.requests.at(-1).history.some(turn=>turn.question==='Can we talk about my day?')));
  await page.fill('#followup','Why that answer?'); await page.click('#sendFollowup');
  await page.waitForFunction(()=>!document.querySelector('#followup').disabled);
  assert.equal(await page.evaluate(()=>window.requests.at(-1).images.length),1,'Screen context survives follow-ups');
  // The top scan can use the message already typed and still auto-answer.
  await page.fill('#followup','Summarize the highlighted section.'); await page.click('#scan');
  await page.waitForFunction(()=>!document.querySelector('#followup').disabled);
  assert.equal(await page.evaluate(()=>window.requests.at(-1).question),'Summarize the highlighted section.');
  assert.equal(await page.evaluate(()=>window.requests.at(-1).images.length),1);
  assert.match(await page.locator('#answerContent').textContent(),/plan my afternoon/,'Earlier chat survives a new screen capture');
  await page.click('#scan'); await page.waitForFunction(()=>!document.querySelector('#followup').disabled);
  assert.equal(await page.evaluate(()=>window.requests.at(-1).action),'answer');
  assert.equal(await page.evaluate(()=>window.requests.some(r=>r.action==='extract')),false);
  // A failed send keeps the user's draft available for retry.
  await page.evaluate(()=>{window.failNext=true}); await page.fill('#followup','Keep this message on failure.'); await page.click('#sendFollowup');
  await page.waitForFunction(()=>!document.querySelector('#followup').disabled);
  assert.equal(await page.locator('#followup').inputValue(),'Keep this message on failure.');
  await page.click('#sendFollowup'); await page.waitForFunction(()=>!document.querySelector('#followup').disabled);
  assert.equal(await page.locator('#followup').inputValue(),'');
  await page.click('#dismissCue'); assert.equal(await page.locator('#cuePopup').isVisible(),false);
  await page.click('#toggleCue');
  await page.click('#overlaySettings'); await page.locator('#settingsDialog').waitFor({state:'visible'});
  assert.equal(await page.evaluate(()=>window.overlayHeight),760);
  await page.uncheck('#autoAnswer'); await page.locator('#settingsForm button[type=submit]').click();
  const beforeManualScan=await page.evaluate(()=>window.requests.length);
  await page.click('#scan'); await page.waitForFunction(()=>!document.querySelector('#followup').disabled);
  assert.equal(await page.evaluate(()=>window.requests.length),beforeManualScan);
  await page.fill('#followup','Answer this one too.'); await page.click('#sendFollowup'); await page.waitForFunction(()=>!document.querySelector('#followup').disabled);
  for(const [width,height] of [[700,760],[420,760],[320,760],[700,700]]){
   await page.setViewportSize({width,height});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`overflow at ${width}`);
   assert.ok(await page.locator('#followup').evaluate(node=>{const box=node.getBoundingClientRect();return box.top>=0&&box.bottom<=innerHeight}),`composer clipped at ${width}`);
   assert.ok(await page.locator('#quitCue').evaluate(node=>node.getBoundingClientRect().right<=innerWidth),`toolbar clipped at ${width}`);
  }
  await page.setViewportSize({width:700,height:760});
  await page.locator('#cuePopup').evaluate(e=>e.scrollTop=0);
  fs.mkdirSync(__dirname+'/../test-results',{recursive:true});
  await page.screenshot({path:__dirname+'/../test-results/desktop.png'});
  await page.setViewportSize({width:320,height:760}); await page.screenshot({path:__dirname+'/../test-results/mobile.png'});
  await page.setViewportSize({width:700,height:760});
  await page.evaluate(fs.readFileSync(require.resolve('axe-core/axe.min.js'),'utf8'));
  const audit=await page.evaluate(()=>axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa']}}));
  assert.equal(audit.violations.length,0,JSON.stringify(audit.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))));
  await page.reload(); await page.waitForFunction(()=>window.overlayHeight===84); await page.click('#toggleCue');
  assert.match(await page.locator('#answerContent').textContent(),/plan my afternoon/);
  assert.equal(await page.locator('#followup').isEnabled(),true);
  assert.deepEqual(errors,[]);
  console.log('Passed: text-first Daily chat, contextual follow-ups, mic transcript → composer → send, capture-only → question, capture with a typed instruction, screenshot follow-ups, retry draft preservation, saved conversation, settings, collapse, responsive widths and zero axe violations. Native media/provider calls mocked.');
 } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1});
