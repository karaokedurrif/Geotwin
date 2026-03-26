import os
from dotenv import load_dotenv

# Cargar .env ANTES de cualquier otro import
load_dotenv(override=True)  # override=True fuerza recarga

# NOTA: Ya no necesitamos Replicate - renderer Python usa solo PNOA (IGN público)
# Comentado el check de token de Replicate
# token = os.environ.get("REPLICATE_API_TOKEN", "")
# if not token:
#     print("❌ REPLICATE_API_TOKEN no encontrado en .env")
#     raise SystemExit(1)
# else:
#     print(f"✅ Token Replicate cargado: {token[:8]}...{token[-4:]}")

print("✅ Illustration service starting - Python renderer mode (no AI)")

# DESPUÉS de load_dotenv, importar el resto
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from routes import generate

app = FastAPI(title="GeoTwin Illustration Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "https://geotwin.es", "https://www.geotwin.es"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(generate.router)

# Servir archivos estáticos de ilustraciones generadas
app.mount("/generated", StaticFiles(directory="generated"), name="generated")


@app.get("/health")
def health():
    return {"status": "ok", "service": "illustration"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001, log_level="info")
