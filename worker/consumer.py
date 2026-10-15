import pika
import json
import os
import time
import subprocess
import shutil
import uuid
import traceback

RABBITMQ_URL = os.getenv("RABBITMQ_URL", "amqp://user:password@localhost:5672/")
OUTPUTS_DIR = "/app/storage/outputs"
JOBS_DIR = "/app/storage/jobs"


def write_status(job_id, status, error=None):
    os.makedirs(JOBS_DIR, exist_ok=True)
    path = os.path.join(JOBS_DIR, f"{job_id}.json")
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

def process_job(ch, method, properties, body):
    data = json.loads(body)
    job_id = data['job_id']
    image_path = data['image_path']
    uuid.UUID(job_id)
    job_output_dir = os.path.join(OUTPUTS_DIR, job_id)
    output_ply = os.path.join(job_output_dir, "gaussians.ply")
    job_input_dir = os.path.join(os.path.dirname(image_path), f"job_{job_id}")
    print(f"[*] Processing job {job_id} for image {image_path}")
    write_status(job_id, "running")
    try:
        from PIL import Image
        os.makedirs(job_output_dir, exist_ok=True)
        os.makedirs(job_input_dir, exist_ok=True)
        filename = f"{job_id}.jpg"
        target_path = os.path.join(job_input_dir, filename)
        with Image.open(image_path) as img:
            img.convert("RGB").save(target_path, "JPEG")

        subprocess.run([
            "python3", "FaceLift/inference.py",
            "--input_dir", job_input_dir,
            "--output_dir", job_output_dir,
        ], check=True)

        nested_dir = os.path.join(job_output_dir, job_id)
        nested_ply = os.path.join(nested_dir, "gaussians.ply")
        if not os.path.isfile(nested_ply) or os.path.getsize(nested_ply) == 0:
            raise RuntimeError("Inference completed without a valid gaussians.ply")
        for file_name in os.listdir(nested_dir):
            shutil.move(os.path.join(nested_dir, file_name), job_output_dir)
        shutil.rmtree(nested_dir)
        write_status(job_id, "done")
        print(f"[*] Finished job {job_id}. Output saved to {output_ply}")
    except Exception:
        traceback.print_exc()
        write_status(job_id, "error", "GPU processing failed. Check worker logs for details.")
    finally:
        shutil.rmtree(job_input_dir, ignore_errors=True)
        if os.path.exists(image_path):
            os.remove(image_path)
    ch.basic_ack(delivery_tag=method.delivery_tag)

def main():
    print("[*] Worker connecting to RabbitMQ...")
    parameters = pika.URLParameters(RABBITMQ_URL)
    parameters.heartbeat = 0
    
    while True:
        try:
            connection = pika.BlockingConnection(parameters)
            break
        except Exception:
            print("RabbitMQ not ready. Retrying in 5 seconds...")
            time.sleep(5)
            
    channel = connection.channel()
    channel.queue_declare(queue='facelift_jobs', durable=True)
    
    channel.basic_qos(prefetch_count=1)
    channel.basic_consume(queue='facelift_jobs', on_message_callback=process_job)
    
    print("[*] Worker is waiting for messages. To exit press CTRL+C")
    channel.start_consuming()

if __name__ == '__main__':
    main()
