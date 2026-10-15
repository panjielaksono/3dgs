from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, UnidentifiedImageError
import uuid
import os
from .job_store import STORAGE_DIR, read_status, validate_job_id, write_status
from .queue import publish_job

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")],
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

UPLOADS_DIR = os.path.join(STORAGE_DIR, "uploads")
OUTPUTS_DIR = os.path.join(STORAGE_DIR, "outputs")
MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", str(10 * 1024 * 1024)))
IMAGE_FORMATS = {"JPEG": ".jpg", "PNG": ".png"}
Image.MAX_IMAGE_PIXELS = 20_000_000

os.makedirs(UPLOADS_DIR, exist_ok=True)
os.makedirs(OUTPUTS_DIR, exist_ok=True)

@app.post("/api/jobs")
async def create_job(file: UploadFile = File(...)):
    job_id = str(uuid.uuid4())
    temporary_path = os.path.join(UPLOADS_DIR, f"{job_id}.upload")
    try:
        size = 0
        with open(temporary_path, "wb") as output:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail="Image exceeds the upload limit")
                output.write(chunk)
        if not size:
            raise HTTPException(status_code=400, detail="Image is empty")
        try:
            with Image.open(temporary_path) as image:
                image_format = image.format
                image.verify()
        except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
            raise HTTPException(status_code=400, detail="Upload a valid JPEG or PNG image") from None
        if image_format not in IMAGE_FORMATS:
            raise HTTPException(status_code=400, detail="Upload a JPEG or PNG image")

        file_path = os.path.join(UPLOADS_DIR, f"{job_id}{IMAGE_FORMATS[image_format]}")
        os.replace(temporary_path, file_path)
        write_status(job_id, "queued")
        try:
            publish_job(job_id, file_path)
        except Exception:
            write_status(job_id, "error", "Could not queue the job. Please try again.")
            os.remove(file_path)
            raise HTTPException(status_code=503, detail="Job queue is unavailable") from None
        return {"id": job_id, "status": "queued"}
    finally:
        await file.close()
        if os.path.exists(temporary_path):
            os.remove(temporary_path)

@app.get("/api/jobs/{job_id}")
async def get_job_status(job_id: str):
    try:
        validate_job_id(job_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid job ID") from None
    status = read_status(job_id)
    if status is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return status

@app.get("/api/files/{job_id}")
async def get_file(job_id: str):
    try:
        validate_job_id(job_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid job ID") from None
    status = read_status(job_id)
    if not status or status["status"] != "done":
        raise HTTPException(status_code=404, detail="File not found")
    output_file = os.path.join(OUTPUTS_DIR, job_id, "gaussians.ply")
    if not os.path.isfile(output_file):
        raise HTTPException(status_code=404, detail="File not found")
    
    return FileResponse(output_file, media_type="application/octet-stream", filename=f"{job_id}.ply")
