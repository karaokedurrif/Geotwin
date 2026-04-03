FROM pytorch/pytorch:2.4.0-cuda12.4-cudnn9-runtime

# System deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    git wget && \
    rm -rf /var/lib/apt/lists/*

# ComfyUI
RUN git clone https://github.com/comfyanonymous/ComfyUI.git /app/comfyui
WORKDIR /app/comfyui
RUN pip install --no-cache-dir -r requirements.txt

# ControlNet aux custom nodes
RUN cd custom_nodes && \
    git clone https://github.com/Fannovel16/comfyui_controlnet_aux && \
    cd comfyui_controlnet_aux && pip install --no-cache-dir -r requirements.txt

# API wrapper
WORKDIR /app
COPY requirements.txt /app/
RUN pip install --no-cache-dir -r requirements.txt

COPY api.py comfyui_runner.py presets.py /app/
COPY workflows/ /app/workflows/

EXPOSE 8003 8188

HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=60s \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8003/health')" || exit 1

CMD ["python", "/app/api.py"]
