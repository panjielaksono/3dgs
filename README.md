# 3dgs

A web-based 3D Gaussian Splats viewer and AI generator built with React, Vite, and [FaceLift](https://github.com/weijielyu/FaceLift).

## Architecture & Pipeline

This repository consists of a fully integrated pipeline to generate 3D Gaussian Splats from a single 2D image:
1. **Frontend (React/Vite)**: A glassmorphism game-like UI that handles image uploading and optimized `.ply` splat rendering. Uses automatic binary header detection to route Splat `.ply` files to a dedicated, lightweight WebGL viewer to prevent lag.
2. **Backend API (FastAPI)**: Serves as the entry point, taking image uploads and pushing processing jobs to a RabbitMQ message queue.
3. **GPU Worker (Docker + PyTorch)**: A background worker running inside an NVIDIA CUDA Docker container. It pulls jobs from RabbitMQ, runs the heavyweight **FaceLift** AI inference on the GPU to generate `.ply` files, and saves them to the shared storage.

## Hardware & Storage Requirements
* **OS**: Windows 11 / Linux (with NVIDIA Docker runtime).
* **GPU**: NVIDIA GPU with minimum **6GB VRAM** (RTX 4050 Laptop or better). Note: Generation process pushes GPU utilization to 100%.
* **RAM**: **20GB+ RAM** required (or 16GB RAM + massive Pagefile/Virtual Memory). 
* **Storage**:
  * FaceLift pre-trained models: ~4GB (stored in `./checkpoints`, mounted at `/app/FaceLift/checkpoints`). FaceLift downloads these from [Hugging Face](https://huggingface.co/wlyu/OpenFaceLift) on first use.
  * Generated Output: ~55MB per `.ply` file (stored in `./storage`)

## Environment Variables
Copy `.env.example` to `.env` and adjust as needed:
```bash
cp .env.example .env
```

## Running the Application

### 1. Start the Backend Pipeline (Docker)
Ensure Docker Desktop is running and you have `nvidia-container-toolkit` enabled.
```bash
docker compose up -d
```
This spins up:
- `rabbitmq` (Message Queue)
- `api` (FastAPI at port 8000)
- `worker` (CUDA Worker)

*Note: The first run will take a long time to build the PyTorch CUDA image (~10GB+).*

### 2. Start the Frontend (Node.js)
```bash
npm install
npm run dev
```
Open `http://localhost:5173` in your browser. Click **GENERATE**, upload a single face photo, and wait for your GPU to carve it into 3D!

Uploads are limited to 10 MB and must be valid JPEG or PNG images. Set `MAX_UPLOAD_BYTES` on the API service to change the limit. Job statuses are stored as JSON files in `./storage/jobs`, so a failed inference or API restart does not leave the browser waiting indefinitely. Check the worker logs for inference errors.

FaceLift's bundled research materials are subject to the license files in `worker/FaceLift`; review those terms before using the generator beyond research.
