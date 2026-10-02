import pika
import json
import os

RABBITMQ_URL = os.getenv("RABBITMQ_URL", "amqp://user:password@localhost:5672/")

def publish_job(job_id: str, image_path: str):
    parameters = pika.URLParameters(RABBITMQ_URL)
    connection = pika.BlockingConnection(parameters)
    channel = connection.channel()
    
    channel.queue_declare(queue='facelift_jobs', durable=True)
    
    message = json.dumps({
        "job_id": job_id,
        "image_path": image_path
    })
    
    channel.basic_publish(
        exchange='',
        routing_key='facelift_jobs',
        body=message,
        properties=pika.BasicProperties(
            delivery_mode=2,  # make message persistent
        ))
    connection.close()
