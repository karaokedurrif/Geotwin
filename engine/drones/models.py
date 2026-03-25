"""
Drone domain models — Dataclasses for drones, missions, flight plans, and products.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class DroneType(str, Enum):
    DJI = "dji"
    PX4 = "px4"
    ARDUPILOT = "ardupilot"
    CUSTOM = "custom"


class DroneStatus(str, Enum):
    IDLE = "idle"
    FLYING = "flying"
    CHARGING = "charging"
    MAINTENANCE = "maintenance"
    OFFLINE = "offline"


class MissionType(str, Enum):
    NDVI_SURVEY = "ndvi_survey"
    THERMAL_SURVEY = "thermal_survey"
    INSPECTION = "inspection"
    PHOTOGRAMMETRY = "photogrammetry"
    CUSTOM = "custom"


class MissionStatus(str, Enum):
    PLANNED = "planned"
    UPLOADING = "uploading"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


class FlightPlanType(str, Enum):
    GRID = "grid"
    CROSSHATCH = "crosshatch"
    PERIMETER = "perimeter"
    WAYPOINT = "waypoint"
    ORBIT = "orbit"


class ProductType(str, Enum):
    ORTHOMOSAIC = "orthomosaic"
    NDVI = "ndvi"
    NDRE = "ndre"
    THERMAL_MAP = "thermal_map"
    DSM = "dsm"
    DTM = "dtm"
    POINTCLOUD = "pointcloud"
    MODEL_3D = "3d_model"


@dataclass
class DronePayload:
    type: str  # "rgb" | "multispectral" | "thermal" | "lidar"
    model: str = ""
    bands: list[str] = field(default_factory=list)


@dataclass
class Drone:
    id: str
    model: str
    type: DroneType = DroneType.DJI
    serial_number: str = ""
    payloads: list[DronePayload] = field(default_factory=list)
    status: DroneStatus = DroneStatus.IDLE


@dataclass
class FlightPlan:
    type: FlightPlanType = FlightPlanType.GRID
    altitude_agl: float = 80.0  # meters AGL
    overlap: float = 75.0  # front overlap %
    sidelap: float = 65.0  # side overlap %
    speed: float = 8.0  # m/s
    gsd: float = 2.5  # cm/px ground sample distance
    aoi_geojson: dict[str, Any] = field(default_factory=dict)
    estimated_duration_min: float = 0.0
    estimated_photos: int = 0
    waypoints: list[list[float]] = field(default_factory=list)  # [[lon, lat, altAGL], ...]


@dataclass
class DroneCapture:
    id: str
    mission_id: str
    timestamp: str
    lat: float
    lon: float
    alt_agl: float
    heading: float = 0.0
    pitch: float = 0.0
    roll: float = 0.0
    image_path: str = ""
    exif: dict[str, Any] = field(default_factory=dict)


@dataclass
class DroneProduct:
    id: str
    mission_id: str
    type: ProductType
    status: str = "processing"
    file_path: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class DroneMission:
    id: str
    twin_id: str
    drone_id: str
    type: MissionType = MissionType.PHOTOGRAMMETRY
    status: MissionStatus = MissionStatus.PLANNED
    planned_date: str = ""
    executed_date: str = ""
    flight_plan: FlightPlan = field(default_factory=FlightPlan)
    captures: list[DroneCapture] = field(default_factory=list)
    products: list[DroneProduct] = field(default_factory=list)
