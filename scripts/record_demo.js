#!/usr/bin/env node
/**
 * record_demo.js — 把前端各頁錄成簡報用的短片
 *
 *   node scripts/record_demo.js
 *   → docs/demo/*.webm
 *
 * webm 瀏覽器原生支援，簡報直接播；不需要 ffmpeg。
 * 每段控制在 10–20 秒——簡報上的影片是證據，不是完整操作紀錄。
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const FE   = f => 'file://' + path.join(ROOT, 'frontend', f);
const OUT  = path.join(ROOT, 'docs', 'demo');
const TMP  = path.join(ROOT, '.rec_tmp');

const VIEW = { width: 390, height: 844 };

const SEGMENTS = [
  {
    name: '01_entry', page: 'host-app.html', secs: 11,
    desc: '從 MAX 平台點進麥麥',
    act: async p => {
      await p.waitForTimeout(2600);
      const hit = await p.evaluate(() => {
        const el = [...document.querySelectorAll('*')]
          .find(e => e.children.length === 0 && /^麥麥$/.test(e.innerText?.trim() || ''));
        if (!el) return false;
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return true;
      });
      await p.waitForTimeout(1600);
      if (hit) await p.evaluate(() => {
        const el = [...document.querySelectorAll('*')]
          .find(e => e.children.length === 0 && /^麥麥$/.test(e.innerText?.trim() || ''));
        el?.click();
      });
      await p.waitForTimeout(4200);
    },
  },
  {
    name: '02_intro', page: 'intro.html', secs: 20,
    desc: '入口動畫：兩個 logo 合成麥麥',
    act: async p => { await p.waitForTimeout(19000); },   // 九屏自動播，不要干預
  },
  {
    name: '03_consent', page: 'onboarding.html#/consent', secs: 18,
    desc: '隱私與授權界線：逐項開關 → 按下同意授權',
    act: async p => {
      await p.waitForTimeout(2600);
      for (let i = 0; i < 5; i++) {           // 慢慢捲過授權項目
        await p.mouse.wheel(0, 210);
        await p.waitForTimeout(1300);
      }
      await p.waitForTimeout(900);
      // 真的按下去——這一頁的重點是「界線劃完之後才往前走」，停在按鈕前面等於沒演
      await p.click('#btn-consent');
      await p.waitForTimeout(3400);           // 停一下讓畫面走到問卷第一題
    },
  },
  {
    name: '04_welcome', page: 'onboarding.html#/profile', secs: 44,
    desc: '六題問卷答到底 → 開始分析 → 麥麥整理出的投資樣貌',
    // 授權那段 03 已經完整演過，這裡不重複：用 seedConsent 先把授權狀態灌好，
    // 影片第一格就是問卷第 1 題。
    seed: 'consent',
    act: async p => {
      await p.waitForTimeout(2000);

      // 六題：把每一題的選項按完再按下一題。挑的答案對應簡報裡那個
      // 「追高、短打、看到波動會反覆刷價格」的使用者，最後落在陪跑語氣。
      const PLAN = [
        ['exploring'],                                       // 我有一些買賣經驗
        ['behaviorReview', 'steadyHabit'],                   // 檢視交易行為＋建立穩定習慣（最多兩項）
        ['short'],                                           // 幾天到一個月
        ['anxiousChecking'],                                 // 容易焦慮，反覆查看價格
        ['habitInsight', 'riskAlerts', 'newsToHoldings'],    // 最多三項
        ['guided'],                                          // 陪我慢慢看懂
      ];
      for (const picks of PLAN) {
        for (const v of picks) {
          await p.click(`#qopts .chip[data-v="${v}"]`);
          await p.waitForTimeout(620);
        }
        await p.waitForTimeout(700);
        await p.click('#btn-next');                          // 最後一題時這顆是「看麥麥的整理」
        await p.waitForTimeout(900);
      }
      await p.waitForTimeout(3200);                          // 停在摘要標籤上（這頁不長，不用捲）

      await p.click('#btn-finish');                          // 完成，開始分析
      await p.waitForTimeout(2600);                          // 分析中的等待畫面
      // 分析會自己往下走；萬一停在「查看我的投資樣貌」就按一下
      if (await p.isVisible('#btn-view-result')) {
        await p.click('#btn-view-result');
      }
      await p.waitForFunction(() => location.hash === '#/profile-result', null, { timeout: 25000 });
      await p.waitForTimeout(3000);
      await p.mouse.wheel(0, 320);                           // 把整理出來的樣貌捲一段
      await p.waitForTimeout(3400);
      // 不按「這很像我，進入 MaiMate」——進去之後就是第 10 頁那支影片的內容
    },
  },
  {
    name: '05_health', page: 'home.html', secs: 18,
    desc: '分析結果：原本的我 vs 最近的我、變化歸因、相似情境、麥麥幫你注意到',
    // home.html 沒有完成的 onboarding 狀態會被踢回 welcome.html——不會報錯，
    // 只是安靜地錄到入口頁。要先把整套走完的狀態灌進去。
    seed: 'completed',
    act: async p => {
      await p.waitForTimeout(3000);              // 先停在「今天，什麼和你有關？」
      // 用標題定位而不是固定捲動距離：卡片高度會隨資料變，寫死 px 會捲到半張卡中間
      for (const anchor of ['原本的我', '這個情況', '麥麥幫你注意到', '你的帳戶概況']) {
        const found = await p.evaluate(t => {
          const el = [...document.querySelectorAll('h2,h3,.card h2,.card h3,[class*=title]')]
            .find(e => (e.innerText || '').includes(t));
          if (!el) return false;
          el.scrollIntoView({ block: 'start', behavior: 'smooth' });
          return true;
        }, anchor);
        if (!found) console.log(`   ⚠ 05_health 找不到「${anchor}」，該段沒錄到`);
        await p.waitForTimeout(2600);
      }
    },
  },
];

/**
 * 有些段落要從流程中段開始錄（例如問卷第一題），前面的授權畫面已經是別段的內容，
 * 重錄一次只會讓影片開頭多出五秒沒人要看的東西。
 *
 * 作法是先開一個「不錄影」的 context，真的把同意授權按下去，
 * 把瀏覽器寫出來的狀態原封不動撈回來，再灌進要錄影的 context。
 * 不自己手寫 consent 物件——那個結構（consentVersion／grantedScopes／revokedAt）
 * 由 onboarding-core.js 決定，手寫的版本一改就會跟真實情況脫節，
 * 而且路由檢查不過只會安靜地把畫面踢回授權頁。
 */
const ANSWERS = [
  ['exploring'],                                       // 我有一些買賣經驗
  ['behaviorReview', 'steadyHabit'],                   // 檢視交易行為＋建立穩定習慣（最多兩項）
  ['short'],                                           // 幾天到一個月
  ['anxiousChecking'],                                 // 容易焦慮，反覆查看價格
  ['habitInsight', 'riskAlerts', 'newsToHoldings'],    // 最多三項
  ['guided'],                                          // 陪我慢慢看懂
];

/** 走到指定進度，回傳當下的 mm_onboarding
 *  @param {'consent'|'completed'} upTo */
async function grabState(browser, upTo) {
  const ctx = await browser.newContext({ viewport: VIEW });
  const p = await ctx.newPage();
  await p.goto(FE('onboarding.html#/consent'), { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#btn-consent');
  await p.click('#btn-consent');
  await p.waitForTimeout(1200);                    // 等它寫進 localStorage 並換頁

  if (upTo === 'completed') {
    for (const picks of ANSWERS) {
      for (const v of picks) await p.click(`#qopts .chip[data-v="${v}"]`);
      await p.click('#btn-next');
      await p.waitForTimeout(200);
    }
    await p.click('#btn-finish');                  // 完成，開始分析
    // 等分析跑完真的走到結果頁；跑不完就讓後面的斷言去抓，不要靜靜地帶著半套狀態往下走
    await p.waitForFunction(() => location.hash === '#/profile-result', null, { timeout: 25000 });
    await p.waitForTimeout(800);
  }

  const state = await p.evaluate(() => localStorage.getItem('mm_onboarding'));
  await ctx.close();
  if (!state) throw new Error('沒撈到 mm_onboarding');
  return state;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.rmSync(TMP, { recursive: true, force: true });
  const browser = await chromium.launch();

  // 只想重錄其中幾段時：node scripts/record_demo.js 03 04
  const only = process.argv.slice(2);
  const todo = only.length ? SEGMENTS.filter(s => only.some(o => s.name.includes(o))) : SEGMENTS;

  const seeds = {};
  for (const kind of ['consent', 'completed']) {
    if (todo.some(s => s.seed === kind)) seeds[kind] = await grabState(browser, kind);
  }

  for (const seg of todo) {
    const ctx = await browser.newContext({
      viewport: VIEW, deviceScaleFactor: 2,
      recordVideo: { dir: path.join(TMP, seg.name), size: VIEW },
    });
    // 在任何頁面腳本跑之前寫進去，否則 onboarding.js 的路由檢查會先跑一輪、
    // 判定沒授權，把畫面 replace 回 #/consent
    if (seg.seed) {
      await ctx.addInitScript(s => localStorage.setItem('mm_onboarding', s), seeds[seg.seed]);
    }
    const p = await ctx.newPage();
    try {
      await p.goto(FE(seg.page), { waitUntil: 'domcontentloaded' });
      await seg.act(p);
    } catch (e) {
      console.log(`   ⚠ ${seg.name} 錄製中出錯：${e.message.slice(0, 60)}`);
    }
    await p.close();
    await ctx.close();                       // 關掉 context 影片才會寫檔

    const dir = path.join(TMP, seg.name);
    const file = fs.readdirSync(dir).find(f => f.endsWith('.webm'));
    if (file) {
      const dest = path.join(OUT, seg.name + '.webm');
      fs.renameSync(path.join(dir, file), dest);
      const kb = Math.round(fs.statSync(dest).size / 1024);
      console.log(`✓ ${seg.name}.webm  ${kb} KB  — ${seg.desc}`);
    } else {
      console.log(`✗ ${seg.name} 沒產出影片`);
    }
  }

  await browser.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\n全部輸出到 docs/demo/`);
})();
