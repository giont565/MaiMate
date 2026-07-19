"""Pixel Companion — MaiMate 像素機器人吉祥物
產出：
  maimate_pixel_unit.png  主視覺（1600x2000 specimen plate）
  maimate_bot.png         透明底 sprite（UI 用，576x624）
  maimate_bot_small.png   透明底 sprite 128px 寬
"""
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

HERE = Path(__file__).parent
FONTS = Path("/root/.claude/skills/canvas-design/canvas-fonts")
UNIFONT = "/usr/share/fonts/opentype/unifont/unifont.otf"

# ---- palette（五個聲音）----
BG = (13, 21, 48)        # 0D1530 void
NAVY = (22, 34, 77)      # 16224D
GOLD = (232, 161, 58)    # E8A13A
GOLD_L = (245, 193, 105) # F5C169
GOLD_D = (193, 127, 29)  # C17F1D
ICE = (234, 240, 251)    # EAF0FB
WHITE = (255, 255, 255)
GREEN = (31, 157, 102)   # 1F9D66
RED = (214, 69, 80)      # D64550
LATTICE = (19, 27, 58)
MUTED = (143, 160, 201)  # 8FA0C9

GW, GH = 24, 26  # sprite grid


def blank():
    return [[None] * GW for _ in range(GH)]


def fill(g, r0, r1, c0, c1, color):
    for r in range(r0, r1 + 1):
        for c in range(c0, c1 + 1):
            g[r][c] = color


def px(g, r, c, color):
    g[r][c] = color


def sprite(eyes="open", candles=("g", "r", "g")):
    g = blank()
    # 天線：金幣＋桿
    fill(g, 0, 1, 10, 13, GOLD)
    px(g, 0, 10, GOLD_L); px(g, 0, 11, GOLD_L)
    px(g, 1, 13, GOLD_D)
    fill(g, 2, 3, 11, 12, GOLD_D)
    # 頭（圓角矩形 rows4-13, cols3-20, r=2）
    fill(g, 4, 4, 5, 18, GOLD)
    fill(g, 5, 5, 4, 19, GOLD)
    fill(g, 6, 11, 3, 20, GOLD)
    fill(g, 12, 12, 4, 19, GOLD)
    fill(g, 13, 13, 5, 18, GOLD)
    # 打光與陰影
    fill(g, 4, 4, 5, 18, GOLD_L)
    px(g, 5, 4, GOLD_L)
    for r in range(6, 10):
        px(g, r, 3, GOLD_L)
    for r in range(6, 12):
        px(g, r, 20, GOLD_D)
    px(g, 12, 19, GOLD_D)
    fill(g, 13, 13, 5, 18, GOLD_D)
    # 側邊螺栓耳
    fill(g, 8, 9, 2, 2, GOLD_D)
    fill(g, 8, 9, 21, 21, GOLD_D)
    # 臉部螢幕（rows6-11, cols5-18, r=1）
    fill(g, 6, 6, 6, 17, NAVY)
    fill(g, 7, 10, 5, 18, NAVY)
    fill(g, 11, 11, 6, 17, NAVY)
    # 眼睛
    if eyes == "open":
        fill(g, 8, 9, 8, 9, WHITE)
        fill(g, 8, 9, 14, 15, WHITE)
    elif eyes == "blink":
        fill(g, 9, 9, 8, 9, WHITE)
        fill(g, 9, 9, 14, 15, WHITE)
    elif eyes == "happy":  # ^ ^
        px(g, 8, 8, WHITE)
        px(g, 9, 7, WHITE); px(g, 9, 9, WHITE)
        px(g, 8, 15, WHITE)
        px(g, 9, 14, WHITE); px(g, 9, 16, WHITE)
    # 嘴
    fill(g, 10, 10, 11, 12, ICE)
    # 身體（rows14-22, cols5-18, 底部圓角）
    fill(g, 14, 20, 5, 18, GOLD)
    fill(g, 21, 21, 6, 17, GOLD)
    fill(g, 22, 22, 7, 16, GOLD)
    for r in range(14, 20):
        px(g, r, 5, GOLD_L)
        px(g, r, 18, GOLD_D)
    px(g, 21, 17, GOLD_D)
    fill(g, 22, 22, 7, 16, GOLD_D)
    # 胸口面板（rows15-20, cols7-16, r=1）
    fill(g, 15, 15, 8, 15, ICE)
    fill(g, 16, 19, 7, 16, ICE)
    fill(g, 20, 20, 8, 15, ICE)
    # K 線（收在面板內，基準 row19）
    cmap = {"g": GREEN, "r": RED}
    heights = {0: (18, 19), 1: (17, 19), 2: (16, 19)}
    cols = (9, 11, 13)
    for i, kind in enumerate(candles):
        r0, r1 = heights[i]
        fill(g, r0, r1, cols[i], cols[i], cmap[kind])
        px(g, r0 - 1, cols[i], NAVY)  # 燭芯
    # 手臂
    fill(g, 15, 17, 3, 4, GOLD)
    px(g, 18, 4, GOLD)
    fill(g, 15, 17, 19, 20, GOLD_D)
    px(g, 18, 19, GOLD_D)
    # 腳
    fill(g, 23, 24, 7, 10, NAVY)
    fill(g, 23, 24, 13, 16, NAVY)
    px(g, 24, 7, None); px(g, 24, 16, None)
    return g


def render(g, scale, bg=None):
    img = Image.new("RGBA", (GW * scale, GH * scale), (0, 0, 0, 0) if bg is None else bg + (255,))
    d = ImageDraw.Draw(img)
    for r in range(GH):
        for c in range(GW):
            col = g[r][c]
            if col is not None:
                d.rectangle([c * scale, r * scale, (c + 1) * scale - 1, (r + 1) * scale - 1], fill=col + (255,))
    return img


def f(name, size):
    return ImageFont.truetype(str(FONTS / name), size)


def text_ls(d, xy, s, font, fill, ls=0, anchor=None):
    """letter-spaced text（手工排字距）"""
    x, y = xy
    if anchor == "m":  # 置中：先量總寬
        w = sum(d.textlength(ch, font=font) + ls for ch in s) - ls
        x -= w / 2
    for ch in s:
        d.text((x, y), ch, font=font, fill=fill)
        x += d.textlength(ch, font=font) + ls


# ================= 主視覺 =================
W, H = 1600, 2000
img = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(img)

# 淡格點 lattice（工程紙感）
for y in range(80, H - 60, 40):
    for x in range(80, W - 60, 40):
        d.rectangle([x, y, x + 1, y + 1], fill=LATTICE)

mono_s = f("IBMPlexMono-Regular.ttf", 26)
mono_xs = f("IBMPlexMono-Regular.ttf", 21)
mono_b = f("IBMPlexMono-Bold.ttf", 30)
uni = ImageFont.truetype(UNIFONT, 96)
uni_s = ImageFont.truetype(UNIFONT, 40)

# 抬頭：檔案編目
text_ls(d, (100, 96), "PIXEL COMPANION — FIELD PLATE", mono_s, MUTED, ls=6)
text_ls(d, (100, 140), "SPECIES: TRADING ROBOT · GRID 24 x 26 · FIVE VOICES", mono_xs, (90, 104, 143), ls=3)
w = d.textlength("MAIMATE", font=mono_b)
text_ls(d, (W - 100 - w - 6 * 6, 96), "MAIMATE", mono_b, GOLD, ls=6)

# 主 sprite（scale 36 → 864x936）
S = 36
bot = render(sprite(), S)
bx, by = (W - bot.width) // 2, 300
img.paste(bot, (bx, by), bot)

# specimen 角標
tick = 28
for (cx, cy, dx, dy) in [(bx - 40, by - 40, 1, 1), (bx + bot.width + 40, by - 40, -1, 1),
                          (bx - 40, by + bot.height + 40, 1, -1), (bx + bot.width + 40, by + bot.height + 40, -1, -1)]:
    d.line([cx, cy, cx + dx * tick, cy], fill=MUTED, width=2)
    d.line([cx, cy, cx, cy + dy * tick], fill=MUTED, width=2)

# 名牌：麥麥（16px 點陣 → 6 倍無插值放大，真像素字）
tiny = Image.new("RGBA", (80, 20), (0, 0, 0, 0))
td = ImageDraw.Draw(tiny)
uni16 = ImageFont.truetype(UNIFONT, 16)
td.text((40, 10), "麥 麥", font=uni16, fill=ICE, anchor="mm")
bbox = tiny.getbbox()
tiny = tiny.crop(bbox)
name_img = tiny.resize((tiny.width * 6, tiny.height * 6), Image.NEAREST)
img.paste(name_img, (W // 2 - name_img.width // 2, by + bot.height + 96 - name_img.height // 2), name_img)
text_ls(d, (W // 2, by + bot.height + 168), "UNIT 001 — MAIMATE", mono_s, GOLD, ls=8, anchor="m")

# 三個變體（觀察紀錄列）
variants = [
    ("NO.001  IDLE", sprite("open", ("g", "r", "g"))),
    ("NO.002  BLINK", sprite("blink", ("g", "r", "g"))),
    ("NO.003  BULLISH", sprite("happy", ("g", "g", "g"))),
]
vs = 10
vw = GW * vs
total = vw * 3 + 160 * 2
x0 = (W - total) // 2
vy = 1560
for i, (label, g) in enumerate(variants):
    vimg = render(g, vs)
    vx = x0 + i * (vw + 160)
    img.paste(vimg, (vx, vy), vimg)
    dd = ImageDraw.Draw(img)
    text_ls(dd, (vx + vw // 2, vy + GH * vs + 24), label, mono_xs, MUTED, ls=2, anchor="m")

# 頁腳
text_ls(d, (W // 2, H - 92), "THE MARKET MOVES — THE COMPANION STAYS", mono_xs, (90, 104, 143), ls=5, anchor="m")

img.save(HERE / "maimate_pixel_unit.png")

# ================= UI sprites =================
render(sprite(), 24).save(HERE / "maimate_bot.png")
small = render(sprite(), 24).resize((128, int(128 * GH / GW)), Image.NEAREST)
small.save(HERE / "maimate_bot_small.png")
print("done:", [p.name for p in HERE.glob("maimate_*.png")])
