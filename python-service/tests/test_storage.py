"""
Tests for app.services.storage.storage_backend — local and S3 backends.
S3/MinIO backend uses mocked boto3.
"""

import os
import shutil
import tempfile
import pytest
from unittest.mock import MagicMock, patch, PropertyMock
from pathlib import Path

from app.services.storage.storage_backend import (
    LocalStorageBackend,
    S3StorageBackend,
    StorageBackend,
    get_storage_backend,
    reset_storage_backend,
)


# ============================================================================
# StorageBackend.generate_key
# ============================================================================


class TestGenerateKey:
    def test_generates_unique_keys(self):
        key1 = StorageBackend.generate_key("report.pdf")
        key2 = StorageBackend.generate_key("report.pdf")
        assert key1 != key2  # UUID-based, always unique

    def test_preserves_extension(self):
        key = StorageBackend.generate_key("myfile.docx")
        assert key.endswith(".docx")

    def test_uses_prefix(self):
        key = StorageBackend.generate_key("test.pdf", prefix="batch")
        assert key.startswith("batch/")

    def test_truncates_long_names(self):
        long_name = "a" * 200 + ".pdf"
        key = StorageBackend.generate_key(long_name)
        # Prefix + "/" + 12-char UUID + "_" + truncated name + ext
        parts = key.split("/")
        assert len(parts) == 2
        filename_part = parts[1]
        assert len(filename_part) < 100


# ============================================================================
# LocalStorageBackend
# ============================================================================


class TestLocalStorageBackend:
    @pytest.fixture(autouse=True)
    def setup_tmpdir(self, tmp_path):
        self.tmp_dir = tmp_path / "test_uploads"
        self.backend = LocalStorageBackend(base_dir=str(self.tmp_dir))

    @pytest.mark.asyncio
    async def test_upload_creates_file(self):
        url = await self.backend.upload(b"hello world", "test/file.txt", "text/plain")
        assert (self.tmp_dir / "test" / "file.txt").exists()
        assert "file.txt" in url

    @pytest.mark.asyncio
    async def test_download_returns_bytes(self):
        await self.backend.upload(b"content123", "dl/test.bin")
        data = await self.backend.download("dl/test.bin")
        assert data == b"content123"

    @pytest.mark.asyncio
    async def test_download_missing_raises(self):
        with pytest.raises(FileNotFoundError):
            await self.backend.download("nonexistent.txt")

    @pytest.mark.asyncio
    async def test_delete_removes_file(self):
        await self.backend.upload(b"to_delete", "del/file.txt")
        assert (self.tmp_dir / "del" / "file.txt").exists()
        await self.backend.delete("del/file.txt")
        assert not (self.tmp_dir / "del" / "file.txt").exists()

    @pytest.mark.asyncio
    async def test_delete_nonexistent_no_error(self):
        await self.backend.delete("nope.txt")  # Should not raise

    @pytest.mark.asyncio
    async def test_get_url(self):
        url = await self.backend.get_url("some/key.pdf")
        assert "some/key.pdf" in url

    @pytest.mark.asyncio
    async def test_list_files(self):
        await self.backend.upload(b"a", "dir/a.txt")
        await self.backend.upload(b"b", "dir/b.txt")
        await self.backend.upload(b"c", "other/c.txt")
        files = await self.backend.list_files("dir")
        assert len(files) == 2
        assert any("a.txt" in f for f in files)

    @pytest.mark.asyncio
    async def test_list_files_empty_prefix(self):
        await self.backend.upload(b"x", "x.txt")
        files = await self.backend.list_files()
        assert len(files) >= 1

    @pytest.mark.asyncio
    async def test_list_files_nonexistent_prefix(self):
        files = await self.backend.list_files("does_not_exist")
        assert files == []


# ============================================================================
# S3StorageBackend (mocked boto3)
# ============================================================================


class TestS3StorageBackend:
    @patch("app.services.storage.storage_backend.settings")
    @patch("boto3.client")
    def test_init_creates_bucket_minio(self, mock_boto_client, mock_settings):
        mock_settings.S3_BUCKET_NAME = "test-bucket"
        mock_settings.S3_ACCESS_KEY = "key"
        mock_settings.S3_SECRET_KEY = "secret"
        mock_settings.S3_ENDPOINT_URL = "http://minio:9000"
        mock_settings.S3_REGION = "us-east-1"

        mock_client = MagicMock()
        mock_client.head_bucket.side_effect = Exception("NoSuchBucket")
        mock_boto_client.return_value = mock_client

        backend = S3StorageBackend(
            bucket_name="test-bucket",
            access_key="key",
            secret_key="secret",
            endpoint_url="http://minio:9000",
        )

        mock_client.create_bucket.assert_called_once_with(Bucket="test-bucket")

    @patch("app.services.storage.storage_backend.settings")
    @patch("boto3.client")
    def test_init_existing_bucket(self, mock_boto_client, mock_settings):
        mock_settings.S3_BUCKET_NAME = "test-bucket"
        mock_settings.S3_ACCESS_KEY = "key"
        mock_settings.S3_SECRET_KEY = "secret"
        mock_settings.S3_ENDPOINT_URL = None
        mock_settings.S3_REGION = "us-east-1"

        mock_client = MagicMock()
        mock_client.head_bucket.return_value = {}  # Bucket exists
        mock_boto_client.return_value = mock_client

        backend = S3StorageBackend(
            bucket_name="test-bucket",
            access_key="key",
            secret_key="secret",
            endpoint_url=None,
        )

        mock_client.create_bucket.assert_not_called()

    @patch("app.services.storage.storage_backend.settings")
    @patch("boto3.client")
    @pytest.mark.asyncio
    async def test_upload(self, mock_boto_client, mock_settings):
        mock_settings.S3_BUCKET_NAME = "b"
        mock_settings.S3_ACCESS_KEY = "k"
        mock_settings.S3_SECRET_KEY = "s"
        mock_settings.S3_ENDPOINT_URL = "http://minio:9000"
        mock_settings.S3_REGION = "us-east-1"

        mock_client = MagicMock()
        mock_client.head_bucket.return_value = {}
        mock_client.generate_presigned_url.return_value = "http://minio:9000/b/key.pdf"
        mock_boto_client.return_value = mock_client

        backend = S3StorageBackend(
            bucket_name="b", access_key="k", secret_key="s",
            endpoint_url="http://minio:9000",
        )
        url = await backend.upload(b"data", "key.pdf", "application/pdf")

        mock_client.put_object.assert_called_once()
        assert "key.pdf" in url

    @patch("app.services.storage.storage_backend.settings")
    @patch("boto3.client")
    @pytest.mark.asyncio
    async def test_download(self, mock_boto_client, mock_settings):
        mock_settings.S3_BUCKET_NAME = "b"
        mock_settings.S3_ACCESS_KEY = "k"
        mock_settings.S3_SECRET_KEY = "s"
        mock_settings.S3_ENDPOINT_URL = "http://minio:9000"
        mock_settings.S3_REGION = "us-east-1"

        mock_client = MagicMock()
        mock_client.head_bucket.return_value = {}
        mock_body = MagicMock()
        mock_body.read.return_value = b"file_data"
        mock_client.get_object.return_value = {"Body": mock_body}
        mock_boto_client.return_value = mock_client

        backend = S3StorageBackend(
            bucket_name="b", access_key="k", secret_key="s",
            endpoint_url="http://minio:9000",
        )
        data = await backend.download("key.pdf")
        assert data == b"file_data"

    @patch("app.services.storage.storage_backend.settings")
    @patch("boto3.client")
    @pytest.mark.asyncio
    async def test_delete(self, mock_boto_client, mock_settings):
        mock_settings.S3_BUCKET_NAME = "b"
        mock_settings.S3_ACCESS_KEY = "k"
        mock_settings.S3_SECRET_KEY = "s"
        mock_settings.S3_ENDPOINT_URL = "http://minio:9000"
        mock_settings.S3_REGION = "us-east-1"

        mock_client = MagicMock()
        mock_client.head_bucket.return_value = {}
        mock_boto_client.return_value = mock_client

        backend = S3StorageBackend(
            bucket_name="b", access_key="k", secret_key="s",
            endpoint_url="http://minio:9000",
        )
        await backend.delete("key.pdf")
        mock_client.delete_object.assert_called_once()

    @patch("app.services.storage.storage_backend.settings")
    @patch("boto3.client")
    @pytest.mark.asyncio
    async def test_list_files(self, mock_boto_client, mock_settings):
        mock_settings.S3_BUCKET_NAME = "b"
        mock_settings.S3_ACCESS_KEY = "k"
        mock_settings.S3_SECRET_KEY = "s"
        mock_settings.S3_ENDPOINT_URL = "http://minio:9000"
        mock_settings.S3_REGION = "us-east-1"

        mock_client = MagicMock()
        mock_client.head_bucket.return_value = {}
        mock_client.list_objects_v2.return_value = {
            "Contents": [{"Key": "a.pdf"}, {"Key": "b.pdf"}]
        }
        mock_boto_client.return_value = mock_client

        backend = S3StorageBackend(
            bucket_name="b", access_key="k", secret_key="s",
            endpoint_url="http://minio:9000",
        )
        files = await backend.list_files("prefix")
        assert files == ["a.pdf", "b.pdf"]


# ============================================================================
# Factory
# ============================================================================


class TestGetStorageBackend:
    def setup_method(self):
        reset_storage_backend()

    def teardown_method(self):
        reset_storage_backend()

    @patch("app.services.storage.storage_backend.settings")
    def test_local_provider(self, mock_settings, tmp_path):
        mock_settings.STORAGE_PROVIDER = "local"
        mock_settings.STORAGE_LOCAL_DIR = str(tmp_path / "uploads")
        backend = get_storage_backend()
        assert isinstance(backend, LocalStorageBackend)

    @patch("app.services.storage.storage_backend.settings")
    def test_unknown_provider_raises(self, mock_settings):
        mock_settings.STORAGE_PROVIDER = "dropbox"
        with pytest.raises(ValueError, match="Unknown storage provider"):
            get_storage_backend()

    @patch("app.services.storage.storage_backend.settings")
    def test_singleton(self, mock_settings, tmp_path):
        mock_settings.STORAGE_PROVIDER = "local"
        mock_settings.STORAGE_LOCAL_DIR = str(tmp_path / "uploads")
        b1 = get_storage_backend()
        b2 = get_storage_backend()
        assert b1 is b2
