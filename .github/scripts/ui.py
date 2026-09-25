"""Helper smoke test: cari elemen di layar (uiautomator dump), scroll bila perlu, lalu tap.

    python3 ui.py "<regex text/content-desc>" [maks_scroll]
"""
import re
import subprocess
import sys
import time


def sh(*args):
    return subprocess.run(['adb', 'shell', *args], capture_output=True, text=True).stdout


def size():
    m = re.search(r'(\d+)x(\d+)', sh('wm', 'size'))
    return (int(m.group(1)), int(m.group(2))) if m else (1080, 2400)


def find(pattern):
    sh('uiautomator', 'dump', '/sdcard/ui.xml')
    xml = sh('cat', '/sdcard/ui.xml')
    w, h = size()
    for m in re.finditer(r'<node [^>]*>', xml):
        node = m.group(0)
        text = re.search(r' text="([^"]*)"', node)
        desc = re.search(r' content-desc="([^"]*)"', node)
        label = f"{text.group(1) if text else ''} {desc.group(1) if desc else ''}".strip()
        if not label or not re.search(pattern, label, re.I):
            continue
        b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', node)
        if not b:
            continue
        x1, y1, x2, y2 = map(int, b.groups())
        cx, cy = (x1 + x2) // 2, (y1 + y2) // 2
        # abaikan elemen yang tertutup bottom bar / di luar layar
        if y2 - y1 > 4 and 0 < cy < h * 0.86:
            return cx, cy, label
    return None


def main():
    pat = sys.argv[1]
    scrolls = int(sys.argv[2]) if len(sys.argv) > 2 else 4
    w, h = size()
    for attempt in range(scrolls + 1):
        for _ in range(2):
            hit = find(pat)
            if hit:
                x, y, label = hit
                sh('input', 'tap', str(x), str(y))
                print(f'tap "{label}" di {x},{y}')
                return
            time.sleep(1.5)
        if attempt < scrolls:
            sh('input', 'swipe', str(w // 2), str(int(h * 0.72)), str(w // 2), str(int(h * 0.38)), '350')
            time.sleep(1)
    print(f'elemen tidak ditemukan: {pat}')


if __name__ == '__main__':
    main()
