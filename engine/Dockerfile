# HELIOS engine — Cloud Run image.
# Build context: helios/ (so the engine can read web/data/assumptions/calibrated/*.json)
#   docker build -f engine/Dockerfile -t helios-engine .
# Cloud Build and the multi-container Cloud Run deployment are configured at repo root.
FROM python:3.11-slim

WORKDIR /app
COPY engine/requirements.txt engine/requirements.txt
RUN pip install --no-cache-dir -r engine/requirements.txt

COPY engine/helios_engine engine/helios_engine
COPY engine/api engine/api
COPY engine/data/registry.json engine/data/registry.json
COPY engine/data/catalog engine/data/catalog
COPY web/data/assumptions web/data/assumptions
COPY web/data/lta_frequencies.json web/data/lta_frequencies.json

WORKDIR /app/engine
ENV PORT=8081 PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
RUN useradd --system --uid 10001 --create-home helios \
    && mkdir -p data/raw data/processed \
    && chown helios:helios data/raw data/processed
USER helios
EXPOSE 8081
CMD exec uvicorn api.main:app --host 0.0.0.0 --port ${PORT}
