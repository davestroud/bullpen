"""
Bullpen service package.

Exposes the ASGI app via ``bullpen.service.app`` and utilities for
loading reliever data, scoring candidates, and generating explanations.
"""

from .service import app  # re-export for convenience

__all__ = ["app"]
