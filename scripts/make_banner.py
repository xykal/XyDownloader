"""Buat gambar popup pembaruan XyDownloader (gambar dasar AI + teks yang tajam).

    python scripts/make_banner.py --title "XyDownloader 1.2" \
        --sub "Pratinjau sebelum download," --sub "foto slide & Live Photo, APK lebih ringan." \
        --out android/release-banner.webp

Gambar dasar: android/banner/base.webp (ilustrasi AI, gaya lembut & hangat — tanpa neon/cyber).
Setiap rilis cukup ganti --title/--sub (atau gambar dasarnya) lalu commit hasilnya sebagai
android/release-banner.webp; workflow Android otomatis melampirkannya ke GitHub Release sebagai
update-banner.webp, dan aplikasi menampilkannya di popup pembaruan.
"""
import argparse
import os

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONT_BOLD = ['/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf']
FONT_REG = ['/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf']


def font(paths, size):
    for p in paths:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def pill(draw, xy, text, fnt, fg, bg, pad=(18, 9), radius=None):
    x, y = xy
    l, t, r, b = draw.textbbox((0, 0), text, font=fnt)
    w, h = r - l + pad[0] * 2, b - t + pad[1] * 2
    draw.rounded_rectangle((x, y, x + w, y + h), radius=radius or h // 2, fill=bg)
    draw.text((x + pad[0] - l, y + pad[1] - t), text, font=fnt, fill=fg)
    return w, h


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--base', default=os.path.join(ROOT, 'android', 'banner', 'base.webp'))
    ap.add_argument('--label', default='PEMBARUAN')
    ap.add_argument('--title', required=True)
    ap.add_argument('--sub', action='append', default=[])
    ap.add_argument('--hint', default='Ketuk untuk lihat pembaruan  \u2192')
    ap.add_argument('--out', required=True)
    ap.add_argument('--quality', type=int, default=82)
    a = ap.parse_args()

    im = Image.open(a.base).convert('RGBA')
    W, H = im.size
    s = W / 928  # skala relatif terhadap ukuran desain
    layer = Image.new('RGBA', im.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    x0 = int(64 * s)
    pill(d, (x0, int(84 * s)), a.label, font(FONT_BOLD, int(20 * s)), (91, 56, 240, 255), (109, 74, 255, 34),
         pad=(int(16 * s), int(8 * s)))
    built = 'Built in XyVerse'
    bf = font(FONT_REG, int(20 * s))
    bw = d.textbbox((0, 0), built, font=bf)[2]
    d.text((W - x0 - bw, int(92 * s)), built, font=bf, fill=(120, 108, 99, 255))
    d.text((x0, int(134 * s)), a.title, font=font(FONT_BOLD, int(62 * s)), fill=(42, 36, 32, 255))
    y = int(226 * s)
    sf = font(FONT_REG, int(29 * s))
    for line in a.sub:
        d.text((x0, y), line, font=sf, fill=(107, 95, 87, 255))
        y += int(42 * s)

    # petunjuk "ketuk" di bawah, di atas meja
    hf = font(FONT_BOLD, int(24 * s))
    l, t, r, b = d.textbbox((0, 0), a.hint, font=hf)
    pw, ph = r - l + int(40 * s), b - t + int(24 * s)
    px, py = (W - pw) // 2, H - ph - int(44 * s)
    shadow = Image.new('RGBA', im.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle((px, py + int(6 * s), px + pw, py + ph + int(6 * s)), radius=ph // 2,
                                             fill=(60, 40, 20, 60))
    im = Image.alpha_composite(im, shadow.filter(ImageFilter.GaussianBlur(int(10 * s))))
    d.rounded_rectangle((px, py, px + pw, py + ph), radius=ph // 2, fill=(255, 251, 245, 238))
    d.text((px + int(20 * s) - l, py + int(12 * s) - t), a.hint, font=hf, fill=(42, 36, 32, 255))

    out = Image.alpha_composite(im, layer).convert('RGB')
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    out.save(a.out, 'WEBP', quality=a.quality, method=6)
    print(a.out, os.path.getsize(a.out), 'bytes', out.size)


if __name__ == '__main__':
    main()
