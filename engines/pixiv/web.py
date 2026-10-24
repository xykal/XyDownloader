"""Pixiv-only ugoira response construction for the legacy web/library API."""


def build_ugoira_entry(ctx, info, title, base_name, *, entry_meta, branded_name, short_side):
    """Ugoira pixiv: ZIP berisi frame + delay -> dikonversi ke MP4/GIF di browser (ffmpeg.wasm)."""
    entry = entry_meta(ctx, info, title)
    fmt = next((f for f in info.get('formats') or [] if f.get('url')), None)
    if fmt is None:
        return entry
    src = ctx.source(fmt, 'frames', branded_name(info, title, ctx.page_url, tag='ugoira', ext='zip'))
    frames = (info.get('xy_ugoira') or {}).get('frames') or []
    entry['ugoira'] = {'frames': frames}
    q = short_side(fmt)
    for ext, label, codec in (('mp4', 'MP4', 'H.264'), ('gif', 'GIF', None)):
        entry['video'].append({
            'id': f'ugoira-{ext}', 'label': label, 'quality': q, 'ext': ext, 'codec': codec, 'size': None,
            'no_audio': False, 'mode': 'ugoira', 'filename': branded_name(info, title, ctx.page_url, tag=ext, ext=ext), 'sources': [src],
        })
    return entry

