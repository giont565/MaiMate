/* 簡報影片驗證。判定依據只有三個，全部來自 DOM 實況：
   ① 還是 img.media[data-video] → 影片沒被換上去（poster 卡住就是長這樣）
   ② video.readyState < 2       → 沒有可播的資料
   ③ video.error                → 解碼／來源錯誤
   ⚠ 不要用 requestfailed 當失敗：file:// 播放時瀏覽器會發 range request，
     緩衝夠了就中止剩下的，那是正常行為。之前這條讓九支好的影片全被誤報成失敗。 */
const { chromium } = require("playwright");
const DECK = process.env.DECK || "/Users/hao/Documents/MaiMate/docs/PITCH_DECK.html";
(async()=>{
  const b=await chromium.launch();
  const p=await b.newPage({viewport:{width:1920,height:1080}});
  const consoleErr=[];
  p.on("console",m=>{ if(m.type()==="warning"||m.type()==="error") consoleErr.push(m.text().slice(0,120)); });
  await p.goto("file://"+DECK,{waitUntil:"networkidle"});
  await p.waitForTimeout(8000);
  const r=await p.evaluate(()=>({
    slides:document.querySelectorAll(".slide").length,
    stuck:[...document.querySelectorAll("img.media[data-video]")].map(e=>e.dataset.video),
    videos:[...document.querySelectorAll("video.media")].map(v=>({
      src:v.getAttribute("src"), ready:v.readyState,
      dur:isFinite(v.duration)?Math.round(v.duration*10)/10:null,
      err:v.error?v.error.code:null })),
  }));
  const broken=r.videos.filter(v=>v.ready<2||v.err!==null||!v.dur);
  console.log(`頁數 ${r.slides}　影片插槽 ${r.videos.length+r.stuck.length} 個`);
  r.videos.forEach(v=>console.log(`  ${v.ready>=2&&!v.err?"✅":"❌"} ${v.src}  readyState=${v.ready} 長度=${v.dur}s`));
  r.stuck.forEach(s=>console.log(`  ❌ ${s}  ← 仍是靜態截圖，影片沒被換上去`));
  if(consoleErr.length) console.log("主控台訊息:",consoleErr.slice(0,4));
  const ok = r.stuck.length===0 && broken.length===0;
  console.log(ok ? `\n✅ 全部 ${r.videos.length} 支都載得到、都有可播資料`
                 : `\n❌ 卡住 ${r.stuck.length} 支、資料不足 ${broken.length} 支`);
  await b.close(); process.exit(ok?0:1);
})();
