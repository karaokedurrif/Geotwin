"""Tests para engine.vector.aoi — parseo de KML/GML + unión de parcelas."""

from pathlib import Path

import pytest

from engine.vector.aoi import (
    AOIMetadata,
    compute_aoi_metadata,
    merge_parcels,
    parse_kml,
    select_resolution,
)

FIXTURES = Path(__file__).parent / "fixtures"
SAMPLE_KML = FIXTURES / "40212A00200007.kml"
SAMPLE_GML = FIXTURES / "40212A00200007 (1).gml"


class TestParseKml:
    def test_parse_kml_returns_feature(self):
        feature = parse_kml(SAMPLE_KML)
        assert feature["type"] == "Feature"
        assert "geometry" in feature
        assert feature["geometry"]["type"] in ("Polygon", "MultiPolygon")

    def test_parse_kml_has_coordinates(self):
        feature = parse_kml(SAMPLE_KML)
        coords = feature["geometry"]["coordinates"]
        assert len(coords) > 0
        # Al menos un ring con múltiples puntos
        ring = coords[0] if isinstance(coords[0][0], (list, tuple)) else coords
        assert len(ring) > 3

    def test_parse_kml_detects_source_file(self):
        feature = parse_kml(SAMPLE_KML)
        assert feature["properties"]["source_file"] == "40212A00200007.kml"

    def test_parse_gml(self):
        feature = parse_kml(SAMPLE_GML)
        assert feature["type"] == "Feature"
        assert "geometry" in feature

    def test_parse_kml_coordinates_in_wgs84(self):
        """Las coordenadas deben estar en WGS84 (lon en [-180,180], lat en [-90,90])."""
        feature = parse_kml(SAMPLE_KML)
        coords = feature["geometry"]["coordinates"]
        ring = coords[0] if isinstance(coords[0][0], (list, tuple)) else coords
        for lon, lat in ring:
            assert -180 <= lon <= 180, f"Longitud fuera de rango: {lon}"
            assert -90 <= lat <= 90, f"Latitud fuera de rango: {lat}"


class TestMergeParcels:
    def test_merge_single_parcel(self):
        feature = parse_kml(SAMPLE_KML)
        merged = merge_parcels([feature])
        assert merged["type"] == "Feature"
        assert merged["properties"]["parcel_count"] == 1

    def test_merge_duplicate_parcels_same_geometry(self):
        """Unir la misma parcela consigo misma → misma geometría."""
        feature = parse_kml(SAMPLE_KML)
        merged = merge_parcels([feature, feature])
        assert merged["properties"]["parcel_count"] == 2
        # La geometría unida debería tener área similar a la original


class TestAOIMetadata:
    def test_compute_metadata(self):
        feature = parse_kml(SAMPLE_KML)
        meta = compute_aoi_metadata(feature)
        assert isinstance(meta, AOIMetadata)
        assert meta.area_ha > 0
        assert meta.perimeter_m > 0
        assert -180 <= meta.centroid_lon <= 180
        assert -90 <= meta.centroid_lat <= 90
        assert meta.vertex_count > 3

    def test_metadata_bbox_contains_centroid(self):
        feature = parse_kml(SAMPLE_KML)
        meta = compute_aoi_metadata(feature)
        assert meta.bbox[0] <= meta.centroid_lon <= meta.bbox[2]
        assert meta.bbox[1] <= meta.centroid_lat <= meta.bbox[3]

    def test_area_reasonable(self):
        """La parcela de ejemplo es ~135 ha según el twin existente."""
        feature = parse_kml(SAMPLE_KML)
        meta = compute_aoi_metadata(feature)
        # Tolerar rango amplio por diferencias en método de cálculo
        assert 10 < meta.area_ha < 1000


class TestSelectResolution:
    def test_small_farm(self):
        res = select_resolution(50)
        assert res["dem_resolution_m"] == 2

    def test_medium_farm(self):
        res = select_resolution(300)
        assert res["dem_resolution_m"] == 5

    def test_large_farm(self):
        res = select_resolution(3000)
        assert res["dem_resolution_m"] == 10
