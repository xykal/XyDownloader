"""Sinkronkan katalog platform + logo dari backend (xydl/platforms.py, public/logos) ke aplikasi Android.

Menghasilkan:
  android/app/src/main/java/id/my/xyverse/xydownloader/Platforms.kt
  android/app/src/main/res/drawable-nodpi/logo_<id>.webp
Jalankan setiap kali menambah/mengubah platform:  python scripts/sync_android.py
"""
import os
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from xydl.platforms import PLATFORMS, REGIONS  # noqa: E402

KT = os.path.join(ROOT, 'android/app/src/main/java/id/my/xyverse/xydownloader/Platforms.kt')
RES = os.path.join(ROOT, 'android/app/src/main/res/drawable-nodpi')


def res_name(pid):
    return 'logo_' + ''.join(c if c.isalnum() else '_' for c in pid.lower())


def kstr(s):
    return '"' + str(s).replace('\\', '\\\\').replace('"', '\\"').replace('$', '\\$') + '"'


def main():
    os.makedirs(RES, exist_ok=True)
    for f in os.listdir(RES):
        if f.startswith('logo_'):
            os.remove(os.path.join(RES, f))
    for p in PLATFORMS:
        shutil.copyfile(os.path.join(ROOT, 'public', 'logos', f"{p['id']}.webp"),
                        os.path.join(RES, res_name(p['id']) + '.webp'))
    regions = ',\n        '.join(
        f'Region({kstr(rid)}, {kstr(r["name"])}, {kstr(r["flag"])})' for rid, r in REGIONS.items())
    items = ',\n        '.join(
        f'Platform({kstr(p["id"])}, {kstr(p["name"])}, {kstr(p["region"])}, '
        f'listOf({", ".join(kstr(d) for d in p["domains"])}), R.drawable.{res_name(p["id"])}, '
        f'{kstr(p["note"]) if p["note"] else "null"})'
        for p in PLATFORMS)
    code = f'''package id.my.xyverse.xydownloader

// AUTO-GENERATED oleh scripts/sync_android.py dari xydl/platforms.py — jangan diedit manual.

import androidx.annotation.DrawableRes

data class Region(val id: String, val name: String, val flag: String)

data class Platform(
    val id: String,
    val name: String,
    val region: String,
    val domains: List<String>,
    @DrawableRes val logo: Int,
    val note: String?,
)

object PlatformCatalog {{
    val regions = listOf(
        {regions},
    )

    val all = listOf(
        {items},
    )

    fun byRegion(regionId: String) = all.filter {{ it.region == regionId }}

    /** Deteksi platform dari URL (berdasarkan domain). */
    fun detect(url: String?): Platform? {{
        val host = Engine.hostOf(url ?: return null)
        if (host.isEmpty()) return null
        return all.firstOrNull {{ p -> p.domains.any {{ d -> host == d || host.endsWith(".$d") }} }}
    }}
}}
'''
    with open(KT, 'w', encoding='utf-8') as f:
        f.write(code)
    print(f'{len(PLATFORMS)} platform, {len(REGIONS)} region -> {os.path.relpath(KT, ROOT)}')


if __name__ == '__main__':
    main()
