"""
FastAPI application entry point.
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.config import settings
from app.utils.logging import setup_logging, get_logger


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application startup and shutdown events."""
    setup_logging(settings.LOG_LEVEL)
    logger = get_logger(__name__)
    logger.info(
        "starting_python_service",
        port=settings.PORT,
        env=settings.ENV,
        llm_provider=settings.LLM_PROVIDER,
        llm_model=settings.LLM_MODEL,
        storage_provider=settings.STORAGE_PROVIDER,
    )

    # Preflight: validates config, PostgreSQL (with retries), schema init +
    # verification, MinIO, GROQ, OCR, and writable dirs. Prints a PASS/FAIL
    # report and raises on FAIL so the service refuses to start half-broken
    # instead of returning 500s later.
    from app.preflight import assert_preflight
    await assert_preflight()

    # Warm the storage backend singleton (bucket self-heal happens here).
    from app.services.storage.storage_backend import get_storage_backend
    get_storage_backend()
    logger.info("service_ready", storage_provider=settings.STORAGE_PROVIDER)

    yield

    # Shutdown
    try:
        from app.services.database.repository import get_repository
        repo = get_repository()
        await repo.close()
    except Exception:
        pass
    logger.info("shutting_down_python_service")


app = FastAPI(
    title="AgriEval AI Processing Service",
    description=(
        "AI-powered document processing and proposal evaluation microservice. "
        "Handles text extraction, OCR, chunking, summarization, multi-agent evaluation, "
        "persistent storage, and report comparison."
    ),
    version="2.0.0",
    lifespan=lifespan,
)

# CORS — allow Node.js backend and frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3001",
        "http://localhost:5173",
        "http://localhost:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routes
app.include_router(router)


# Root endpoint
@app.get("/")
async def root():
    return {
        "service": "AgriEval AI Processing Service",
        "version": "2.0.0",
        "docs": "/docs",
        "health": "/api/v1/health",
    }


if __name__ == "__main__":  # pragma: no cover
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=settings.PORT,
        reload=settings.ENV == "development",
        log_level=settings.LOG_LEVEL.lower(),
    )
