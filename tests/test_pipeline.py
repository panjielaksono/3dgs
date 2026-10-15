import io
import json
import os
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException
from PIL import Image

_module_storage = tempfile.TemporaryDirectory(dir=Path(__file__).parent)
os.environ["STORAGE_DIR"] = _module_storage.name

from api.app import job_store, main
from worker import consumer


def image_bytes():
    output = io.BytesIO()
    Image.new("RGB", (4, 4), "red").save(output, "PNG")
    return output.getvalue()


def run_immediate(coroutine):
    # In-memory UploadFile operations do not yield to an event loop.
    try:
        coroutine.send(None)
    except StopIteration as result:
        return result.value
    raise RuntimeError("Unexpected asynchronous operation in test")


class ApiPipelineTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(dir=Path(__file__).parent)
        self.addCleanup(self.directory.cleanup)
        root = Path(self.directory.name)
        self.patches = [
            patch.object(main, "UPLOADS_DIR", str(root / "uploads")),
            patch.object(main, "OUTPUTS_DIR", str(root / "outputs")),
            patch.object(job_store, "JOBS_DIR", str(root / "jobs")),
        ]
        for item in self.patches:
            item.start()
            self.addCleanup(item.stop)
        (root / "uploads").mkdir()
        (root / "outputs").mkdir()
    def upload(self, name, content):
        class MemoryUpload:
            def __init__(self, data):
                self.stream = io.BytesIO(data)

            async def read(self, size):
                return self.stream.read(size)

            async def close(self):
                self.stream.close()

        return run_immediate(main.create_job(MemoryUpload(content)))

    def test_valid_upload_and_persisted_status(self):
        with patch.object(main, "publish_job") as publish:
            response = self.upload("photo.txt", image_bytes())
        job_id = response["id"]
        publish.assert_called_once()
        self.assertTrue(publish.call_args.args[1].endswith(f"{job_id}.png"))
        self.assertEqual(run_immediate(main.get_job_status(job_id))["status"], "queued")
        with self.assertRaises(HTTPException) as missing:
            run_immediate(main.get_file(job_id))
        self.assertEqual(missing.exception.status_code, 404)

    def test_rejects_invalid_and_oversized_uploads(self):
        with patch.object(main, "publish_job") as publish:
            with self.assertRaises(HTTPException) as invalid:
                self.upload("bad.png", b"not an image")
            with patch.object(main, "MAX_UPLOAD_BYTES", 8):
                with self.assertRaises(HTTPException) as oversized:
                    self.upload("photo.png", image_bytes())
        self.assertEqual(invalid.exception.status_code, 400)
        self.assertEqual(oversized.exception.status_code, 413)
        publish.assert_not_called()
        self.assertFalse(list((Path(self.directory.name) / "uploads").iterdir()))

    def test_queue_failure_and_invalid_job_id(self):
        with patch.object(main, "publish_job", side_effect=RuntimeError("offline")):
            with self.assertRaises(HTTPException) as response:
                self.upload("photo.png", image_bytes())
        self.assertEqual(response.exception.status_code, 503)
        with self.assertRaises(HTTPException) as invalid:
            run_immediate(main.get_job_status("not-a-uuid"))
        self.assertEqual(invalid.exception.status_code, 400)
        self.assertFalse(list((Path(self.directory.name) / "uploads").iterdir()))


class WorkerPipelineTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(dir=Path(__file__).parent)
        self.addCleanup(self.directory.cleanup)
        root = Path(self.directory.name)
        self.patches = [
            patch.object(consumer, "OUTPUTS_DIR", str(root / "outputs")),
            patch.object(consumer, "JOBS_DIR", str(root / "jobs")),
        ]
        for item in self.patches:
            item.start()
            self.addCleanup(item.stop)
        self.root = root
        self.job_id = str(uuid.uuid4())
        self.image_path = root / f"{self.job_id}.png"
        self.image_path.write_bytes(image_bytes())
        self.body = json.dumps({"job_id": self.job_id, "image_path": str(self.image_path)}).encode()

    def test_success_requires_nonempty_ply(self):
        class Channel:
            acknowledged = False
            def basic_ack(self, delivery_tag):
                self.acknowledged = True

        channel = Channel()
        method = type("Method", (), {"delivery_tag": 1})()

        def inference(command, check):
            nested = self.root / "outputs" / self.job_id / self.job_id
            nested.mkdir(parents=True)
            (nested / "gaussians.ply").write_bytes(b"ply\n")

        with patch.object(consumer.subprocess, "run", side_effect=inference):
            consumer.process_job(channel, method, None, self.body)
        self.assertTrue(channel.acknowledged)
        self.assertEqual(json.loads((self.root / "jobs" / f"{self.job_id}.json").read_text())["status"], "done")
        self.assertTrue((self.root / "outputs" / self.job_id / "gaussians.ply").exists())
        self.assertFalse(self.image_path.exists())

    def test_inference_failure_is_reported(self):
        class Channel:
            acknowledged = False
            def basic_ack(self, delivery_tag):
                self.acknowledged = True

        channel = Channel()
        method = type("Method", (), {"delivery_tag": 1})()
        with patch.object(consumer.subprocess, "run", side_effect=RuntimeError("GPU error")), \
             patch.object(consumer.traceback, "print_exc"):
            consumer.process_job(channel, method, None, self.body)
        self.assertTrue(channel.acknowledged)
        self.assertEqual(json.loads((self.root / "jobs" / f"{self.job_id}.json").read_text())["status"], "error")


if __name__ == "__main__":
    unittest.main()
