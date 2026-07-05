"""
Abstract storage backend with S3/MinIO and local filesystem implementations.

Provider is selected via STORAGE_PROVIDER env var (local | s3 | minio).
MinIO uses the same boto3 S3 SDK with a custom endpoint URL.
"""

import os
import uuid
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Optional

from app.config import settings
from app.utils.logging import get_logger

logger = get_logger(__name__)


class StorageBackend(ABC):
    """Abstract interface for file storage."""

    @abstractmethod
    async def upload(self, file_bytes: bytes, key: str, content_type: str = "application/octet-stream") -> str:
        """Upload a file and return the storage URL."""
        ...

    @abstractmethod
    async def download(self, key: str) -> bytes:
        """Download a file by key."""
        ...

    @abstractmethod
    async def delete(self, key: str) -> None:
        """Delete a file by key."""
        ...

    @abstractmethod
    async def get_url(self, key: str) -> str:
        """Get a public/presigned URL for a file."""
        ...

    @abstractmethod
    async def list_files(self, prefix: str = "") -> list[str]:
        """List file keys matching a prefix."""
        ...

    @staticmethod
    def generate_key(filename: str, prefix: str = "proposals") -> str:
        """Generate a unique storage key for a file."""
        ext = Path(filename).suffix
        unique_id = uuid.uuid4().hex[:12]
        safe_name = Path(filename).stem[:50]  # Truncate long names
        return f"{prefix}/{unique_id}_{safe_name}{ext}"


class LocalStorageBackend(StorageBackend):
    """Stores files on the local filesystem."""

    def __init__(self, base_dir: Optional[str] = None):
        self.base_dir = Path(base_dir or settings.STORAGE_LOCAL_DIR).resolve()
        self.base_dir.mkdir(parents=True, exist_ok=True)
        logger.info("local_storage_initialized", path=str(self.base_dir))

    async def upload(self, file_bytes: bytes, key: str, content_type: str = "application/octet-stream") -> str:
        file_path = self.base_dir / key
        file_path.parent.mkdir(parents=True, exist_ok=True)
        file_path.write_bytes(file_bytes)
        logger.info("file_uploaded_local", key=key, size=len(file_bytes))
        return file_path.as_uri()

    async def download(self, key: str) -> bytes:
        file_path = self.base_dir / key
        if not file_path.exists():
            raise FileNotFoundError(f"File not found: {key}")
        return file_path.read_bytes()

    async def delete(self, key: str) -> None:
        file_path = self.base_dir / key
        if file_path.exists():
            file_path.unlink()
            logger.info("file_deleted_local", key=key)

    async def get_url(self, key: str) -> str:
        # as_uri() yields a well-formed file:// URL with forward slashes on
        # every platform (interpolating a Windows path embeds backslashes).
        return (self.base_dir / key).as_uri()

    async def list_files(self, prefix: str = "") -> list[str]:
        target = self.base_dir / prefix if prefix else self.base_dir
        if not target.exists():
            return []
        results = []
        for path in target.rglob("*"):
            if path.is_file():
                results.append(str(path.relative_to(self.base_dir)))
        return results


class S3StorageBackend(StorageBackend):
    """
    Stores files in S3-compatible storage (AWS S3 or MinIO).

    MinIO is configured by setting S3_ENDPOINT_URL to the MinIO server address.
    """

    def __init__(
        self,
        bucket_name: Optional[str] = None,
        access_key: Optional[str] = None,
        secret_key: Optional[str] = None,
        endpoint_url: Optional[str] = None,
        region: Optional[str] = None,
    ):
        import boto3
        from botocore.config import Config as BotoConfig

        self.bucket_name = bucket_name or settings.S3_BUCKET_NAME
        self.endpoint_url = endpoint_url or settings.S3_ENDPOINT_URL
        self.region = region or settings.S3_REGION

        boto_config = BotoConfig(
            region_name=self.region,
            signature_version="s3v4",
            retries={"max_attempts": 3, "mode": "standard"},
        )

        client_kwargs = {
            "service_name": "s3",
            "aws_access_key_id": access_key or settings.S3_ACCESS_KEY,
            "aws_secret_access_key": secret_key or settings.S3_SECRET_KEY,
            "config": boto_config,
        }

        if self.endpoint_url:
            client_kwargs["endpoint_url"] = self.endpoint_url

        self._client = boto3.client(**client_kwargs)

        # Auto-create bucket if it doesn't exist
        self._ensure_bucket()

        provider = "minio" if self.endpoint_url else "s3"
        logger.info("s3_storage_initialized", provider=provider, bucket=self.bucket_name)

    def _ensure_bucket(self) -> None:
        """Create the bucket if it doesn't exist."""
        try:
            self._client.head_bucket(Bucket=self.bucket_name)
        except Exception:
            try:
                if self.endpoint_url:
                    # MinIO doesn't need LocationConstraint
                    self._client.create_bucket(Bucket=self.bucket_name)
                else:
                    self._client.create_bucket(
                        Bucket=self.bucket_name,
                        CreateBucketConfiguration={"LocationConstraint": self.region},
                    )
                logger.info("bucket_created", bucket=self.bucket_name)
            except Exception as e:
                logger.warning("bucket_creation_failed", error=str(e))

    async def upload(self, file_bytes: bytes, key: str, content_type: str = "application/octet-stream") -> str:
        self._client.put_object(
            Bucket=self.bucket_name,
            Key=key,
            Body=file_bytes,
            ContentType=content_type,
        )
        url = await self.get_url(key)
        logger.info("file_uploaded_s3", key=key, size=len(file_bytes))
        return url

    async def download(self, key: str) -> bytes:
        response = self._client.get_object(Bucket=self.bucket_name, Key=key)
        return response["Body"].read()

    async def delete(self, key: str) -> None:
        self._client.delete_object(Bucket=self.bucket_name, Key=key)
        logger.info("file_deleted_s3", key=key)

    async def get_url(self, key: str) -> str:
        """Generate a presigned URL (valid for 1 hour)."""
        url = self._client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self.bucket_name, "Key": key},
            ExpiresIn=3600,
        )
        return url

    async def list_files(self, prefix: str = "") -> list[str]:
        response = self._client.list_objects_v2(
            Bucket=self.bucket_name,
            Prefix=prefix,
        )
        return [obj["Key"] for obj in response.get("Contents", [])]


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------

_storage_instance: Optional[StorageBackend] = None


def get_storage_backend() -> StorageBackend:
    """Get the configured storage backend (singleton)."""
    global _storage_instance
    if _storage_instance is not None:
        return _storage_instance

    provider = settings.STORAGE_PROVIDER.lower()

    if provider in ("s3", "minio"):
        _storage_instance = S3StorageBackend()
    elif provider == "local":
        _storage_instance = LocalStorageBackend()
    else:
        raise ValueError(f"Unknown storage provider: {provider}. Use 'local', 's3', or 'minio'.")

    return _storage_instance


def reset_storage_backend() -> None:
    """Reset the singleton (used in tests)."""
    global _storage_instance
    _storage_instance = None
