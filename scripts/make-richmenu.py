# 家族用リッチメニューの画像を作る（仕様書 §10.6）。
# 使い方：uv run --with pillow python scripts/make-richmenu.py
# 2500×843 を横に4つに分け、「ようす」「おやすみ」「じかん」「つかいかた」を置く。
from PIL import Image, ImageDraw, ImageFont

W, H = 2500, 843
FONT = '/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc'
FONT_SUB = '/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc'
TILES = [
    ('ようす', '今日のお返事', '#F6E7C8'),
    ('おやすみ', '見守りを休む', '#DCEBDD'),
    ('じかん', '送る時刻', '#DDE6F3'),
    ('つかいかた', '使い方の案内', '#EFE1EC'),
]

img = Image.new('RGB', (W, H), '#FFFFFF')
d = ImageDraw.Draw(img)
big = ImageFont.truetype(FONT, 104)
sub = ImageFont.truetype(FONT_SUB, 64)
tw = W // len(TILES)
for i, (label, note, color) in enumerate(TILES):
    x0 = i * tw
    d.rounded_rectangle([x0 + 18, 18, x0 + tw - 18, H - 18], radius=48, fill=color)
    cx = x0 + tw // 2
    d.text((cx, H // 2 - 40), label, font=big, fill='#333333', anchor='mm')
    d.text((cx, H // 2 + 110), note, font=sub, fill='#555555', anchor='mm')
img.save('assets/richmenu-family.png', optimize=True)
print('saved', img.size)
