import json
import os
import uuid

STORAGE_DIR = os.getenv("STORAGE_DIR", "/app/storage")
JOBS_DIR = os.path.join(STORAGE_DIR, "jobs")


def validate_job_id(job_id: str) -> str:
    try:
        parsed = uuid.UUID(job_id)
    except (ValueError, TypeError) as exc:
        raise ValueError("Invalid job ID") from exc
    if str(parsed) != job_id:
        raise ValueError("Invalid job ID")
    return job_id


def status_path(job_id: str) -> str:
    return os.path.join(JOBS_DIR, f"{validate_job_id(job_id)}.json")


def write_status(job_id: str, status: str, error: str | None = None) -> None:
    os.makedirs(JOBS_DIR, exist_ok=True)
    path = status_path(job_id)
    temporary = f"{path}.{uuid.uuid4().hex}.tmp"
    payload = {"id": job_id, "status": status}
    if error:
        payload["error"] = error
    try:
        with open(temporary, "w", encoding="utf-8") as stream:
            json.dump(payload, stream)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.remove(temporary)


def read_status(job_id: str) -> dict | None:
    try:
        with open(status_path(job_id), encoding="utf-8") as stream:
            return json.load(stream)
    except FileNotFoundError:
        return None
