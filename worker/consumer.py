import pika
import json
import os
import time
import subprocess

RABBITMQ_URL = os.getenv("RABBITMQ_URL", "amqp://user:password@localhost:5672/")
OUTPUTS_DIR = "/app/storage/outputs"

def process_job(ch, method, properties, body):
    data = json.loads(body)
    job_id = data['job_id']
    image_path = data['image_path']
    
    print(f"[*] Processing job {job_id} for image {image_path}")
    
    job_output_dir = os.path.join(OUTPUTS_DIR, job_id)
    os.makedirs(job_output_dir, exist_ok=True)
    
    output_ply = os.path.join(job_output_dir, "gaussians.ply")
    
    from PIL import Image
    job_input_dir = os.path.join(os.path.dirname(image_path), f"job_{job_id}")
    os.makedirs(job_input_dir, exist_ok=True)
    
    # Load image and convert to RGB to avoid 4-channel RGBA errors
    with Image.open(image_path) as img:
        img = img.convert("RGB")
        filename = os.path.basename(image_path)
        if filename.lower().endswith(".png"):
            filename = filename[:-4] + ".jpg"
        target_path = os.path.join(job_input_dir, filename)
        img.save(target_path, "JPEG")
    
    print("Running GPU processing...")
    cmd = [
        "python3", "FaceLift/inference.py",
        "--input_dir", job_input_dir,
        "--output_dir", job_output_dir
    ]
    try:
        subprocess.run(cmd, check=True)
        
        # FaceLift creates a nested folder with the image name. Let's move the files up.
        nested_dir = os.path.join(job_output_dir, filename.split('.')[0])
        if os.path.exists(nested_dir):
            for file_name in os.listdir(nested_dir):
                import shutil
                shutil.move(os.path.join(nested_dir, file_name), job_output_dir)
            os.rmdir(nested_dir)
            
        print(f"[*] Finished job {job_id}. Output saved to {output_ply}")
    except subprocess.CalledProcessError as e:
        print(f"[!] Inference failed for job {job_id}:", e)
        # Touch an error file or just ignore so frontend timeouts or returns error.
        
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
