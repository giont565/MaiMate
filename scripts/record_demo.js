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
    name: '04_welcome', page: 'welcome.html', secs: 40,
    desc: '開始認識彼此 → 六題問卷全部答完 → 麥麥的整理',
    act: async p => {
      await p.waitForTimeout(2600);
      await p.mouse.wheel(0, 260); await p.waitForTimeout(1200);   // 先讓「授權→對答→開始」露臉
      await p.mouse.wheel(0, -260); await p.waitForTimeout(700);

      await p.click('#btn-cta');                                    // 開始和麥麥認識彼此
      await p.waitForTimeout(1800);
      await p.click('#btn-consent');                                // 授權（03 已完整演過，這裡快速通過）
      await p.waitForTimeout(1800);

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
      await p.waitForTimeout(4200);                          // 停在摘要標籤上（這頁不長，不用捲）
      // 不按「完成，開始分析」——後面 05 健檢頁本來就是那一段
    },
  },
  {
    name: '05_health', page: 'home.html', secs: 16,
    desc: '投資健檢：健康分與四張行為卡',
    act: async p => {
      await p.waitForTimeout(3200);
      for (let i = 0; i < 5; i++) {
        await p.mouse.wheel(0, 230);
        await p.waitForTimeout(1500);
      }
    },
  },
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.rmSync(TMP, { recursive: true, force: true });
  const browser = await chromium.launch();

  // 只想重錄其中幾段時：node scripts/record_demo.js 03 04
  const only = process.argv.slice(2);
  const todo = only.length ? SEGMENTS.filter(s => only.some(o => s.name.includes(o))) : SEGMENTS;

  for (const seg of todo) {
    const ctx = await browser.newContext({
      viewport: VIEW, deviceScaleFactor: 2,
      recordVideo: { dir: path.join(TMP, seg.name), size: VIEW },
    });
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
