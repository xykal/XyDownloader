"""Technical SEO assertions, not indexing/ranking guarantees."""
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / 'web/public'
HTML = (PUBLIC / 'index.html').read_text()
BASE = 'https://dlaja.xyverse.my.id/'


class Tags(HTMLParser):
    def __init__(self):
        super().__init__()
        self.meta, self.links = {}, {}

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'meta':
            self.meta[attrs.get('name') or attrs.get('property')] = attrs.get('content')
        elif tag == 'link':
            self.links[attrs.get('rel')] = attrs.get('href')


def test_canonical_and_share_metadata():
    tags = Tags()
    tags.feed(HTML)
    assert tags.links['canonical'] == BASE
    assert tags.meta['og:url'] == BASE
    assert tags.meta['og:locale'] == 'id_ID'
    assert tags.meta['og:image'] == BASE + 'og-cover.jpg'
    assert tags.meta['og:image:width'] == '1200'
    assert tags.meta['og:image:height'] == '630'
    assert tags.meta['twitter:card'] == 'summary_large_image'
    assert 'index' in tags.meta['robots'] and 'noindex' not in tags.meta['robots']
    assert len(tags.meta['description']) >= 100
    assert (PUBLIC / 'og-cover.jpg').stat().st_size > 20000


def test_schema_matches_stable_release_and_has_no_fabricated_ratings():
    match = re.search(r'<script id="app-schema" type="application/ld\+json">(.*?)</script>', HTML, re.S)
    graph = json.loads(match.group(1))['@graph']
    app = next(e for e in graph if e['@type'] == 'SoftwareApplication')
    manifest = json.loads((PUBLIC / 'releases.json').read_text())
    assert app['softwareVersion'] == manifest['version'].removeprefix('v')
    assert app['operatingSystem'] == 'Android'
    assert 'aggregateRating' not in app and 'review' not in app
    assert app['offers']['price'] == '0'
    for image in app['screenshot']:
        assert (PUBLIC / image.removeprefix(BASE)).is_file()


def test_sitemap_and_robots_advertise_canonical_only():
    xml = ET.parse(PUBLIC / 'sitemap.xml')
    ns = {'s': 'http://www.sitemaps.org/schemas/sitemap/0.9'}
    assert [e.text for e in xml.findall('.//s:loc', ns)] == [BASE]
    robots = (PUBLIC / 'robots.txt').read_text()
    assert 'Disallow: /\n' not in robots
    assert BASE + 'sitemap.xml' in robots


def test_screenshots_are_attributed_not_fictional_phone_ui():
    provenance = json.loads((PUBLIC / 'screenshots/provenance.json').read_text())
    assert provenance['source'].endswith('/39934086497')
    assert 'not v1.3.5' in provenance['build_type']
    assert 'class="fake-input"' not in HTML
    assert 'class="phone"' not in HTML
    assert 'bukan screenshot v1.3.5' in HTML
