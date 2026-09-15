import logging
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import api_router
from app.core.config import settings
from app.core.ssl import get_ssl_context_files

logger = logging.getLogger("linkai")

app = FastAPI(
    title=settings.PROJECT_NAME,
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
    docs_url="/docs",
    redoc_url="/redoc",
)

# CORS Middleware
if settings.CORS_ORIGINS:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.CORS_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

# Include API v1 router
app.include_router(api_router, prefix=settings.API_V1_STR)


@app.get("/", tags=["Root"])
def root():
    return {
        "message": f"Welcome to {settings.PROJECT_NAME}",
        "docs": "/docs",
        "api_v1": settings.API_V1_STR,
        "https": settings.HTTPS_ENABLED,
    }


if __name__ == "__main__":
    ssl_keyfile, ssl_certfile = get_ssl_context_files()

    if ssl_keyfile and ssl_certfile:
        protocol = "https"
        logger.info(f"Starting with HTTPS (cert: {ssl_certfile})")
    else:
        protocol = "http"
        logger.info("Starting with HTTP (HTTPS disabled)")

    print(f"  Server:  {protocol}://{settings.HOST}:{settings.PORT}")
    print(f"  Docs:    {protocol}://localhost:{settings.PORT}/docs")

    uvicorn.run(
        "main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=settings.DEBUG,
        ssl_keyfile=ssl_keyfile,
        ssl_certfile=ssl_certfile,
    )