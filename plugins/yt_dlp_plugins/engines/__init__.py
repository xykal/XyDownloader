"""Repository import bridge only; engine implementations live in /engines.

Android packaging replaces this bridge with the real engine tree.
"""
from pathlib import Path

__path__ = [str(Path(__file__).resolve().parents[3] / "engines")]
