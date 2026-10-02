from pydantic import BaseModel
from typing import Optional

class JobStatus(BaseModel):
    id: str
    status: str
