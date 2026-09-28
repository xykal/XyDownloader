"""Semua python heredoc di .github/workflows WAJIB valid sintaksnya.

Pelajaran: satu kutip nyaris di belakang terminator `PY` bikin step notifikasi
rilis mati diam-diam selama beberapa rilis (continue-on-error menyamarkannya
jadi "success"). Tes ini menolak hal itu sebelum sempat merge.
"""
import ast
import glob
import os
import re

import pytest
import yaml

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORKFLOWS = sorted(glob.glob(os.path.join(ROOT, '.github', 'workflows', '*.yml')))


def _heredoc_pairs():
    out = []
    for wf in WORKFLOWS:
        with open(wf, encoding='utf-8') as fh:
            data = yaml.safe_load(fh)
        for jobname, job in (data.get('jobs') or {}).items():
            for step in job.get('steps', []):
                run = step.get('run') or ''
                for m in re.finditer(r"python3? - <<'(\w+)'\n(.*?)\n\1\b", run, re.S):
                    out.append((os.path.basename(wf), step.get('name', jobname), m.group(2)))
    return out


def test_ada_workflow():
    assert WORKFLOWS, 'workflow tidak ditemukan'


def test_ada_heredoc_python():
    assert len(_heredoc_pairs()) >= 3, 'heredoc python di workflow tiba-tiba hilang'


@pytest.mark.parametrize('wf,nama,src', _heredoc_pairs(), ids=lambda v: str(v)[:40])
def test_heredoc_python_valid(wf, nama, src):
    ast.parse(src)
