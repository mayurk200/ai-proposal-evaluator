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
    )
    yield
    logger.info("shutting_down_python_service")


app = FastAPI(
    title="AgriEval AI Processing Service",
    description=(
        "AI-powered document processing and proposal evaluation microservice. "
        "Handles text extraction, OCR, chunking, summarization, and multi-agent evaluation."
    ),
    version="1.0.0",
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
        "version": "1.0.0",
        "docs": "/docs",
        "health": "/api/v1/health",
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=settings.PORT,
        reload=settings.ENV == "development",
        log_level=settings.LOG_LEVEL.lower(),
    )
