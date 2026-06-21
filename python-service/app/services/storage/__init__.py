"""Storage service package."""

from app.services.storage.storage_backend import get_storage_backend, StorageBackend

__all__ = ["get_storage_backend", "StorageBackend"]
