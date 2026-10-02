from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
import uuid
import os
import shutil
from .queue import publish_job

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

STORAGE_DIR = "/app/storage"
UPLOADS_DIR = os.path.join(STORAGE_DIR, "uploads")
OUTPUTS_DIR = os.path.join(STORAGE_DIR, "outputs")

os.makedirs(UPLOADS_DIR, exist_ok=True)
os.makedirs(OUTPUTS_DIR, exist_ok=True)

# In-memory track. Use Redis/DB in prod.
job_statuses = {}

@app.post("/api/jobs")
async def create_job(file: UploadFile = File(...)):
    job_id = str(uuid.uuid4())
    
    file_ext = file.filename.split('.')[-1]
    file_path = os.path.join(UPLOADS_DIR, f"{job_id}.{file_ext}")
    
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    job_statuses[job_id] = "queued"
    publish_job(job_id, file_path)
    
    return {"id": job_id, "status": "queued"}

@app.get("/api/jobs/{job_id}")
async def get_job_status(job_id: str):
    output_file = os.path.join(OUTPUTS_DIR, job_id, "gaussians.ply")
    if os.path.exists(output_file):
        return {"id": job_id, "status": "done"}
    
    status = job_statuses.get(job_id, "unknown")
    return {"id": job_id, "status": status}

@app.get("/api/files/{job_id}")
async def get_file(job_id: str):
    output_file = os.path.join(OUTPUTS_DIR, job_id, "gaussians.ply")
    if not os.path.exists(output_file):
        raise HTTPException(status_code=404, detail="File not found")
    
    return FileResponse(output_file, media_type="application/octet-stream", filename=f"{job_id}.ply")
