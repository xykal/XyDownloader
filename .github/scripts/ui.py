"""Helper smoke test: cari elemen di layar (uiautomator dump) lalu tap.  python3 ui.py <regex text/desc>"""
import re
import subprocess
import sys
import time


def dump():
    subprocess.run(['adb', 'shell', 'uiautomator', 'dump', '/sdcard/ui.xml'], capture_output=True)
    return subprocess.run(['adb', 'shell', 'cat', '/sdcard/ui.xml'], capture_output=True, text=True).stdout


def find(pattern):
    xml = dump()
    for m in re.finditer(r'<node [^>]*>', xml):
        node = m.group(0)
        text = re.search(r' text="([^"]*)"', node)
        desc = re.search(r' content-desc="([^"]*)"', node)
        label = f"{text.group(1) if text else ''} {desc.group(1) if desc else ''}"
        if re.search(pattern, label, re.I):
            b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', node)
            if b:
                x1, y1, x2, y2 = map(int, b.groups())
                return (x1 + x2) // 2, (y1 + y2) // 2, label.strip()
    return None


if __name__ == '__main__':
    pat = sys.argv[1]
    for attempt in range(6):
        hit = find(pat)
        if hit:
            x, y, label = hit
            subprocess.run(['adb', 'shell', 'input', 'tap', str(x), str(y)])
            print(f'tap "{label}" di {x},{y}')
            sys.exit(0)
        time.sleep(2)
    print(f'elemen tidak ditemukan: {pat}')
    sys.exit(0)
