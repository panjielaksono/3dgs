# 3dgs

A beautiful web-based 3D Gaussian Splats viewer and end-to-end AI Generator built with React, Vite, and [FaceLift](https://github.com/mkkellogg/GaussianSplats3D).

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
  * FaceLift Pre-trained Models: ~4GB (stored in `/checkpoints`)
  * Generated Output: ~55MB per `.ply` file (stored in `/storage`)

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
