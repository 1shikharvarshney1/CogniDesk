import os
import time
from contextlib import asynccontextmanager
from typing import List, Union

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from sentence_transformers import SentenceTransformer
import uvicorn

MODEL_NAME = os.getenv("MODEL_NAME", "all-MiniLM-L6-v2")
PORT = int(os.getenv("PORT", "8000"))
HOST = os.getenv("HOST", "0.0.0.0")

model_instance = None
model_dimension = 384
model_load_time_sec = 0.0

@asynccontextmanager
async def lifespan(app: FastAPI):
    global model_instance, model_dimension, model_load_time_sec
    print(f"[Embedding Service] Initializing SentenceTransformer model '{MODEL_NAME}'...")
    t0 = time.perf_counter()
    model_instance = SentenceTransformer(MODEL_NAME)
    model_load_time_sec = time.perf_counter() - t0
    # Determine embedding dimension
    test_vec = model_instance.encode(["test"], normalize_embeddings=True)
    model_dimension = int(test_vec.shape[1])
    print(
        f"[Embedding Service] Model '{MODEL_NAME}' loaded in {model_load_time_sec:.3f}s. "
        f"Output dimension: {model_dimension}"
    )
    yield
    print("[Embedding Service] Shutting down.")

app = FastAPI(
    title="CogniDesk Local Embedding Microservice",
    description="Serves local Sentence Transformers embeddings for vector and hybrid retrieval",
    version="1.0.0",
    lifespan=lifespan,
)

class EmbedRequest(BaseModel):
    texts: List[str] = Field(
        ...,
        description="List of strings to embed",
        example=["How do I reset my password?", "Billing cycles and invoices"],
    )

class EmbedResponse(BaseModel):
    embeddings: List[List[float]]
    model: str
    dimension: int

@app.get("/health")
def health_check():
    if model_instance is None:
        raise HTTPException(status_code=503, detail="Model not yet loaded")
    return {
        "status": "ok",
        "model": MODEL_NAME,
        "dimension": model_dimension,
        "load_time_seconds": round(model_load_time_sec, 3),
    }

@app.post("/embed", response_model=EmbedResponse)
def generate_embeddings(request: EmbedRequest):
    if model_instance is None:
        raise HTTPException(status_code=503, detail="Model is not ready")

    if not request.texts:
        return EmbedResponse(
            embeddings=[],
            model=MODEL_NAME,
            dimension=model_dimension,
        )

    # Clean and filter non-string inputs safely
    clean_texts = [str(t) if t is not None else "" for t in request.texts]

    # Generate L2-normalized embeddings
    vectors = model_instance.encode(clean_texts, normalize_embeddings=True)

    # Convert to pure Python float list for JSON serialization
    embeddings_list = [v.tolist() for v in vectors]

    return EmbedResponse(
        embeddings=embeddings_list,
        model=MODEL_NAME,
        dimension=model_dimension,
    )

if __name__ == "__main__":
    uvicorn.run("main:app", host=HOST, port=PORT, log_level="info")
