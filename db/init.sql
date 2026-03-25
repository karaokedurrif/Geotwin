-- ==============================================================================
-- GeoTwin Database Schema — PostGIS + TimescaleDB
-- ==============================================================================
-- Tables: twins, sensors, sensor_readings (hypertable), cattle_positions
-- Extensions: PostGIS (geometry), TimescaleDB (time-series)
-- ==============================================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- ==============================================================================
-- 1. Twins — Digital twin registry
-- ==============================================================================
CREATE TABLE IF NOT EXISTS twins (
    twin_id     TEXT PRIMARY KEY,
    name        TEXT,
    area_ha     DOUBLE PRECISION,
    centroid    GEOMETRY(Point, 4326),
    bbox        GEOMETRY(Polygon, 4326),
    recipe      JSONB,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_twins_centroid ON twins USING GIST (centroid);

-- ==============================================================================
-- 2. Sensors — IoT sensor nodes per twin
-- ==============================================================================
CREATE TABLE IF NOT EXISTS sensors (
    id          TEXT PRIMARY KEY,
    twin_id     TEXT NOT NULL REFERENCES twins(twin_id) ON DELETE CASCADE,
    type        TEXT NOT NULL CHECK (type IN ('TEMPERATURE','NH3','CO2','MOISTURE','WEIGHT','RAIN','WIND','HUMIDITY')),
    name        TEXT,
    location    GEOMETRY(Point, 4326) NOT NULL,
    unit        TEXT NOT NULL DEFAULT '°C',
    status      TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','warning','error','offline')),
    metadata    JSONB DEFAULT '{}',
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sensors_twin ON sensors(twin_id);
CREATE INDEX idx_sensors_location ON sensors USING GIST (location);

-- ==============================================================================
-- 3. Sensor Readings — TimescaleDB hypertable for time-series
-- ==============================================================================
CREATE TABLE IF NOT EXISTS sensor_readings (
    time        TIMESTAMPTZ NOT NULL,
    sensor_id   TEXT NOT NULL,
    value       DOUBLE PRECISION NOT NULL,
    quality     SMALLINT DEFAULT 100  -- 0-100 quality indicator
);

-- Convert to hypertable (partitioned by time, 1-day chunks)
SELECT create_hypertable('sensor_readings', 'time', if_not_exists => TRUE);

-- Indexes for efficient time-range + sensor queries
CREATE INDEX idx_readings_sensor_time ON sensor_readings (sensor_id, time DESC);

-- Continuous aggregate: hourly averages
CREATE MATERIALIZED VIEW IF NOT EXISTS sensor_readings_hourly
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', time) AS bucket,
    sensor_id,
    AVG(value)   AS avg_value,
    MIN(value)   AS min_value,
    MAX(value)   AS max_value,
    COUNT(*)     AS sample_count
FROM sensor_readings
GROUP BY bucket, sensor_id
WITH NO DATA;

-- Refresh policy: keeps hourly aggregates up to date
SELECT add_continuous_aggregate_policy('sensor_readings_hourly',
    start_offset    => INTERVAL '3 days',
    end_offset      => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 hour',
    if_not_exists   => TRUE
);

-- Retention policy: keep raw data for 90 days
SELECT add_retention_policy('sensor_readings', INTERVAL '90 days', if_not_exists => TRUE);

-- ==============================================================================
-- 4. Cattle Positions — GPS tracking time-series
-- ==============================================================================
CREATE TABLE IF NOT EXISTS cattle_positions (
    time        TIMESTAMPTZ NOT NULL,
    cattle_id   TEXT NOT NULL,
    twin_id     TEXT NOT NULL,
    location    GEOMETRY(Point, 4326) NOT NULL,
    weight      DOUBLE PRECISION,
    health      TEXT DEFAULT 'good' CHECK (health IN ('good','attention','alert'))
);

SELECT create_hypertable('cattle_positions', 'time', if_not_exists => TRUE);
CREATE INDEX idx_cattle_twin_time ON cattle_positions (twin_id, time DESC);

-- ==============================================================================
-- 5. Alerts — threshold-based alerts from sensor readings
-- ==============================================================================
CREATE TABLE IF NOT EXISTS alerts (
    id          SERIAL PRIMARY KEY,
    twin_id     TEXT NOT NULL,
    sensor_id   TEXT,
    severity    TEXT NOT NULL CHECK (severity IN ('info','warning','critical')),
    message     TEXT NOT NULL,
    value       DOUBLE PRECISION,
    threshold   DOUBLE PRECISION,
    acknowledged BOOLEAN DEFAULT FALSE,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_alerts_twin ON alerts(twin_id, created_at DESC);
