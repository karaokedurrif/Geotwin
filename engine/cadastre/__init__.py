"""Módulo de ingesta catastral (INSPIRE WFS)."""

from .multi_parcel import fetch_and_merge_parcels, split_large_parcel

__all__ = ["fetch_and_merge_parcels", "split_large_parcel"]
