#!/usr/bin/env bash
# 部署到指定環境。用法：./scripts/deploy.sh <private|official> [--frontend-only|--backend-only]
#
# 為什麼要有這支：2026-08-01 決賽前發現比賽環境跑的前端在 git 全部歷史裡查無對應版本
# ——有人直接把自己電腦的檔案 sync 上去。沒紀錄、沒跑過 CI、重現不了。
# 這支的規則只有一條：**雲端只從 main 部署**。其餘（API_BASE 該指哪、KB 該用哪個、
# 哪個 bucket 配哪個 distribution）全部由腳本決定，不靠人記。
set -euo pipefail
export LC_ALL="${LC_ALL:-en_US.UTF-8}" LANG="${LANG:-en_US.UTF-8}"
cd "$(dirname "$0")/.."

ENV="${1:-}"
MODE="${2:-all}"

case "${ENV}" in
  private)
    PROFILE=""; REGION="us-east-1"; KB="PDEGDAUUH9"
    API="https://hwgog76s3a.execute-api.us-east-1.amazonaws.com"
    BUCKET="maimate-frontendbucket-tdpftef0y2d6"; DIST="ECJ9UVQF1D5O3"
    SITE="https://d1ttogc25b56n5.cloudfront.net"; LABEL="私人／錄影環境"
    # 護欄：這個帳號有一個 READY 的 Guardrail（MaiMateRedLine, 6v38f3jue77y），
    # 但目前刻意設 off——決賽日不改已驗過的行為。要開就把下一行換成該 id。
    GUARDRAIL="off"; GUARDRAIL_VER="1"
    ;;
  official)
    PROFILE="hackathon"; REGION="us-west-2"; KB="ZGBLEOY7CR"
    API="https://10n5xyf7i4.execute-api.us-west-2.amazonaws.com"
    BUCKET="maimate-frontendbucket-c6ydvtulu9fc"; DIST="E2OC6B03DVGXWI"
    SITE="https://d1z0776b4u2tmf.cloudfront.net"; LABEL="比賽環境（上台用）"
    # 比賽帳號沒有建 Guardrail（list-guardrails 回空），off 是唯一正確值
    GUARDRAIL="off"; GUARDRAIL_VER="1"
    ;;
  *) echo "用法：./scripts/deploy.sh <private|official> [--frontend-only|--backend-only]"; exit 2 ;;
esac

# 模式白名單。原本只比對 `!= "--frontend-only"`，於是任何拼錯（--frontendonly、
# -frontend-only、--front-end-only）都會靜默落回「連後端一起部署」——而後端部署會讓
# CloudFormation 把 MAX_API_KEY／MAX_API_SECRET 收斂掉。全檔唯一「打錯一個字母就
# 不可逆」的路徑，必須先擋。
case "${MODE}" in
  all|--frontend-only|--backend-only) ;;
  *)
    echo "✘ 未知模式 '${MODE}'。只接受 --frontend-only 或 --backend-only（不帶＝前後端都部署）。"
    echo "  之所以要擋：拼錯的話後端段會照跑，CloudFormation 會清掉 MAX_API_KEY／MAX_API_SECRET。"
    exit 2 ;;
esac

echo "▶ 目標：${LABEL}（${REGION}）"

# ── 閘門：只從 main 部署 ────────────────────────────────────────────
git fetch -q origin
BRANCH=$(git branch --show-current)
if [ "${BRANCH}" != "main" ]; then
  echo "✘ 目前在分支 '${BRANCH}'。雲端只從 main 部署，請先開 PR 合進 main。"; exit 1
fi
if [ -n "$(git rev-list origin/main..HEAD)" ] || [ -n "$(git rev-list HEAD..origin/main)" ]; then
  echo "✘ 本機 main 與 origin/main 不同步。先 git pull（或把你的 commit 開成 PR）。"; exit 1
fi

# 未提交的改動：只放行「前端 API_BASE 覆寫」與自動生成的 sw-assets.js，其餘一律擋。
#
# 白名單改成執行期推導，不再手寫檔名——手寫那份漏掉了 home.html（#65 之後帶 API_BASE 的
# html 有 6 個，清單只列 5 個），於是使用者照 DEPLOY.md §3 用 glob 改完前端指向，
# 就會被自己的閘門擋下。DEPLOY.md 自己寫過「不要逐檔列名，前端每加一頁就會多一處」。
# 用字串拼 regex 而不是 bash 陣列：macOS 的 bash 3.2 在 set -u 下會把空陣列當未定義（#61）。
API_BASE_FILES=$(grep -l 'window\.API_BASE = ' frontend/*.html) || {
  echo "✘ frontend/*.html 裡找不到任何 window.API_BASE 宣告——前端結構變了，先確認再部署。"; exit 1; }
ALLOW_RE="^($(printf '%s\n' "${API_BASE_FILES}" | sed 's/\./\\./g' | tr '\n' '|')frontend/sw-assets\.js)\$"

# 狀態解析不要用 awk '{print $2}'：
#   · 改名 `R  old -> new` 會取到 old（白名單內的檔改名後靜默通過，而 sync 帶 --delete）
#   · 刪除 `D  path` 同樣被白名單濾掉，線上檔案會跟著被刪
#   · 帶空白的路徑會被切斷；非 ASCII 路徑會變成八進位跳脫（repo 內有大量 CJK 檔名）
# 改成取「第 4 個字元之後的整段」，並對 R／C／D 一律直接擋（附狀態標記，白名單比不到）。
DIRTY=$(git -c core.quotePath=false status --porcelain | awk '
    {
      xy = substr($0, 1, 2); p = substr($0, 4);
      if (xy ~ /[RC]/) { sub(/^.* -> /, "", p); print "[改名] " p; next }
      if (xy ~ /D/)    { print "[刪除] " p; next }
      print p;
    }' | grep -vE "${ALLOW_RE}" || true)
if [ -n "${DIRTY}" ]; then
  echo "✘ 有未提交的改動，不能部署（部署出去就查不到是什麼版本了）："
  echo "${DIRTY}" | sed 's/^/    /'
  echo "  → 先 commit 開 PR，或 git stash。"
  echo "  （前端 API_BASE 覆寫不必自己改——本腳本會自己改成 ${API} 再還原。）"; exit 1
fi

echo "✔ 版本閘門通過：main @ $(git rev-parse --short HEAD)"

# ── 後端 ──────────────────────────────────────────────────────────
if [ "${MODE}" != "--frontend-only" ]; then
  echo "▶ 後端部署（KB=${KB}、GUARDRAIL_ID=${GUARDRAIL}）"
  ( cd infra && sam build && sam deploy --stack-name maimate --region "${REGION}" ${PROFILE:+--profile ${PROFILE}} \
      --capabilities CAPABILITY_IAM CAPABILITY_AUTO_EXPAND --resolve-s3 \
      --no-confirm-changeset --no-fail-on-empty-changeset \
      --parameter-overrides "KnowledgeBaseId=${KB}" "GuardrailId=${GUARDRAIL}" "GuardrailVersion=${GUARDRAIL_VER}" )
  echo "🚨 提醒：CloudFormation 剛把 MAX_API_KEY／MAX_API_SECRET 清掉了。"
  echo "   去 Lambda 主控台用「Add environment variable」補回 ChatFunction 與 OrderFunction 兩支。"
  echo "   不要用 aws lambda update-function-configuration --environment（整組取代，會清掉 KB_ID）。"
  # 護欄狀態要說出口。loop.py 對 off/none/disabled 一律靜默停用、不 log 不報錯，
  # 四層防線少一層而畫面完全正常——不印出來就沒有任何人會發現。
  if [ "${GUARDRAIL}" = "off" ]; then
    echo "🚨 本次部署已把 GUARDRAIL_ID 設為 off（模型層護欄停用，只剩程式層）。"
    echo "   主控台手動設的 GUARDRAIL_ID 每次跑這支都會被改回 off——要開請改本腳本的環境對照表。"
  else
    echo "   本次部署已把 GUARDRAIL_ID 設為 ${GUARDRAIL}（版本 ${GUARDRAIL_VER}）。"
  fi
fi

# ── 前端 ──────────────────────────────────────────────────────────
if [ "${MODE}" != "--backend-only" ]; then
  echo "▶ 前端部署（API_BASE → ${API}）"

  # 還原改用「部署前的原檔備份」，不用 git checkout。
  # 舊寫法 `git checkout -- frontend/*.html` 是無差別還原成 HEAD：使用者刻意不 commit 的
  # 本機 API_BASE 覆寫會被無聲丟掉，而收尾訊息印的是改動前抓的 ORIG，與事實相反
  # （實測：本機指私人環境 → 還原後變成 main 的官方環境值，畫面卻說「已還原成 …hwgog76s3a」）。
  # 加 trap：全檔原本沒有任何 trap，s3 sync 或 invalidation 一失敗就死在還原之前，
  # 本機 frontend/ 留在被改寫的髒狀態，而錯誤訊息講的是 AWS，沒人會聯想到本機被改髒。
  BACKUP=""
  restore_frontend() {
    [ -n "${BACKUP}" ] && [ -d "${BACKUP}" ] || return 0
    cp "${BACKUP}"/*.html frontend/ || true
    npm run --silent build:sw >/dev/null 2>&1 || true
    rm -rf "${BACKUP}"; BACKUP=""
  }
  trap restore_frontend EXIT

  BACKUP=$(mktemp -d)
  cp frontend/*.html "${BACKUP}/"
  # 不管本機現在指哪，一律改成這個環境該指的，推完還原。避免「畫面正常但連錯後端」。
  perl -pi -e "s|window\.API_BASE = \"[^\"]*\"|window.API_BASE = \"${API}\"|" frontend/*.html
  npm run --silent build:sw >/dev/null
  # 不要排除 mocks/：5 個頁面用 <script src="mocks/…"> 直接載入它們，sw-assets.js 也把它們
  # 列進 precache（build_sw_manifest.js 走整個 frontend/，不會自己排除）。排除的結果是
  # mocks/home.js 從來沒被推上去，線上是別的版本，而 verify_live_ui.js 的 L2.1 會把它報成
  # 「內容不同」並建議去清 CloudFront 快取——對一個沒上傳過的檔，清幾次都沒用。
  aws s3 sync frontend/ "s3://${BUCKET}/" --region "${REGION}" ${PROFILE:+--profile ${PROFILE}} --delete
  aws cloudfront create-invalidation --distribution-id "${DIST}" --paths "/*" ${PROFILE:+--profile ${PROFILE}} \
    --query 'Invalidation.Id' --output text | sed 's/^/  快取清除 id: /'
  restore_frontend
  # 還原後重抓一次再印。印改動前抓的值＝在說一件沒發生的事。
  NOW=$(sed -n 's/.*window\.API_BASE = "\([^"]*\)".*/\1/p' frontend/index.html | head -1)
  echo "  （本機前端已還原：index.html 的 API_BASE = ${NOW:-（找不到宣告）}）"
fi

echo
echo "✅ 完成。驗證："
echo "   ${SITE}"
echo "   curl -s -o /dev/null -w '%{http_code}\\n' ${SITE}/intro.html   # 動畫要 200，不能是 403"
[ "${ENV}" = "official" ] && echo "   python3 scripts/verify_strategy_tool.py --env official"
[ "${ENV}" = "private" ]  && echo "   npm run verify:strategy"
exit 0
