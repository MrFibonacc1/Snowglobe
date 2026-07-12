# Perception service — deployable image.
#
# Runs the FastAPI detect API (perception.server) with a local YOLO object
# detector baked in, so a deployed backend (and the mobile web-app that calls
# it) gets real bounding boxes without anything running on the user's device.
#
# Build from the REPO ROOT (it needs both perception/ and shared/):
#     docker build -f perception/Dockerfile -t snowglobe-perception .
#     docker run -p 8008:8008 --env-file perception/.env snowglobe-perception
#
# Most PaaS hosts (Render/Railway/Fly) inject $PORT; we honor it (default 8008).

FROM python:3.12-slim

# System libs OpenCV (headless) and torch need at runtime.
RUN apt-get update && apt-get install -y --no-install-recommends \
        libglib2.0-0 libgl1 libgomp1 \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    # Keep ultralytics' settings/cache inside the image, not $HOME.
    YOLO_CONFIG_DIR=/app/.ultralytics \
    PERCEPTION_PORT=8008

WORKDIR /app

# Install CPU-only torch first (the default CUDA wheels are ~2.5GB); the rest of
# the deps then resolve against it.
COPY perception/requirements.txt /app/perception/requirements.txt
RUN pip install --no-cache-dir \
        torch==2.13.0 torchvision==0.28.0 \
        --extra-index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir -r /app/perception/requirements.txt

# App code. shared/ must sit next to perception/ (emit.py reads
# ../shared/event_schema.json).
COPY shared/ /app/shared/
COPY perception/ /app/perception/

# Pre-download YOLO weights at build time so the first request isn't blocked on
# a GitHub fetch (and so it works in networks that can't reach github at runtime).
RUN python -c "from ultralytics import YOLO; YOLO('yolov8s.pt')" \
    && mv yolov8s.pt /app/yolov8s.pt 2>/dev/null || true

EXPOSE 8008

# Bind to $PORT if the host provides one, else PERCEPTION_PORT (8008).
CMD ["sh", "-c", "uvicorn perception.server:app --host 0.0.0.0 --port ${PORT:-${PERCEPTION_PORT:-8008}}"]
