# Use CUDA 12.4 to match FaceLift PyTorch dependencies
FROM nvidia/cuda:12.4.1-cudnn-devel-ubuntu22.04

WORKDIR /app

RUN apt-get update && apt-get install -y python3 python3-pip python3-dev build-essential git ffmpeg && rm -rf /var/lib/apt/lists/*

RUN pip3 install torch==2.4.0 torchvision==0.19.0 --index-url https://download.pytorch.org/whl/cu124

COPY requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt

# Explicitly set CUDA architectures to 8.9 (RTX 40-series) to speed up build
ENV TORCH_CUDA_ARCH_LIST="8.9"
RUN pip3 install git+https://github.com/graphdeco-inria/diff-gaussian-rasterization

RUN git clone https://github.com/weijielyu/FaceLift.git

RUN pip3 install onnxruntime-gpu

COPY consumer.py .

CMD ["python3", "-u", "consumer.py"]
