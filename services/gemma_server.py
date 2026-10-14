"""Loopback-only EmbeddingGemma 2 service. Accepts text or images, never file paths."""
from __future__ import annotations

import argparse
import base64
import hashlib
import io
import os
from pathlib import Path
import threading
import time

os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

import torch
from fastapi import FastAPI, HTTPException, Request
from PIL import Image, ImageOps
from pydantic import BaseModel, Field
import uvicorn

Image.MAX_IMAGE_PIXELS = 32_000_000

OUTPUT_DIM = 768
MAX_EDGE = 1024
PROMPT_NAMES = {"query": "SearchQuery", "document": "Document"}


class EmbedRequest(BaseModel):
    model: str
    text: str | None = Field(default=None, max_length=8000)
    image: str | None = Field(default=None, max_length=12_000_000)
    role: str | None = Field(default=None, max_length=32)


def model_revision(path: Path) -> str:
    digest = hashlib.sha256()
    for file in sorted(path.rglob("*")):
        relative = file.relative_to(path)
        if any(part.startswith(".") for part in relative.parts):
            continue
        if file.is_file() and file.suffix in {".json", ".jinja", ".model", ".safetensors"}:
            digest.update(file.relative_to(path).as_posix().encode())
            with file.open("rb") as stream:
                for block in iter(lambda: stream.read(8 * 1024 * 1024), b""):
                    digest.update(block)
    return digest.hexdigest()


def runtime_dtype(device: str) -> torch.dtype:
    if device == "cuda" and not torch.cuda.is_available():
        raise RuntimeError(
            "CUDA 不可用。请运行 scripts/start-model.ps1 -Device cuda，使用独立 CUDA 环境；"
            f"当前 PyTorch={torch.__version__}，CUDA 构建={torch.version.cuda}。"
        )
    # float16 overflows this model and returns NaN. Use bfloat16 only when the GPU supports it.
    if device == "cuda" and torch.cuda.is_bf16_supported():
        return torch.bfloat16
    if device == "cuda":
        print("当前 GPU 不支持 bfloat16，改用 float32。不会使用 float16。", flush=True)
    return torch.float32


def inference_revision(weights_revision: str, device: str, dtype: torch.dtype) -> str:
    settings = f"{weights_revision}|gemma2|dim{OUTPUT_DIM}|audio-off|prompts-v1|{device}|{dtype}|edge{MAX_EDGE}"
    return hashlib.sha256(settings.encode()).hexdigest()


def prompt_name(role: str | None) -> str:
    try:
        return PROMPT_NAMES[role or "query"]
    except KeyError as error:
        raise ValueError("文本角色必须是 query 或 document") from error


def prepare_image(raw: bytes) -> Image.Image:
    try:
        with Image.open(io.BytesIO(raw)) as source:
            image = ImageOps.exif_transpose(source).convert("RGB")
            image.thumbnail((MAX_EDGE, MAX_EDGE))
            image.load()
            return image
    except Exception as error:
        raise HTTPException(400, "Invalid image") from error


def finalize_vector(vector: torch.Tensor) -> torch.Tensor:
    vector = vector.detach().float().cpu().reshape(-1)
    if vector.numel() != OUTPUT_DIM or not torch.isfinite(vector).all():
        raise RuntimeError("Invalid model embedding")
    norm = float(vector.norm())
    if norm < 1e-6:
        raise RuntimeError("Invalid model embedding")
    return vector / norm


def create_app(model_dir: Path, device: str = "cpu", threads: int = 6) -> FastAPI:
    if not (model_dir / "model.safetensors").is_file():
        raise RuntimeError("模型目录缺少 model.safetensors")
    dtype = runtime_dtype(device)
    torch.set_num_threads(max(1, threads))
    revision = inference_revision(model_revision(model_dir), device, dtype)
    print(
        f"Loading EmbeddingGemma 2 on {device}; dtype={dtype}; audio encoder off; revision {revision[:16]}",
        flush=True,
    )
    from sentence_transformers import SentenceTransformer

    model = SentenceTransformer(
        str(model_dir),
        device=device,
        local_files_only=True,
        model_kwargs={"torch_dtype": dtype},
        config_kwargs={"audio_config": None},
    )
    model.eval()
    lock = threading.Lock()
    app = FastAPI(title="SortNest EmbeddingGemma 2", docs_url=None, redoc_url=None)

    @app.middleware("http")
    async def local_only(request: Request, call_next):
        from starlette.responses import JSONResponse
        if request.headers.get("origin") or request.headers.get("host", "").split(":")[0] not in {"localhost", "127.0.0.1"}:
            return JSONResponse({"detail": "Local desktop client only"}, status_code=403)
        if int(request.headers.get("content-length", "0")) > 14_000_000:
            return JSONResponse({"detail": "Request too large"}, status_code=413)
        return await call_next(request)

    @app.get("/health")
    def health():
        return {
            "ready": True,
            "model": model_dir.name,
            "revision": revision,
            "device": device,
            "dtype": str(dtype),
            "gpu": torch.cuda.get_device_name(0) if device == "cuda" else None,
            "dimension": OUTPUT_DIM,
            "modalities": ["text", "image"],
            "protocol": "sortnest-gemma-v1",
        }

    def embed_values(values: object) -> dict:
        vector = finalize_vector(torch.as_tensor(values))
        return {"embedding": vector.tolist(), "dimension": OUTPUT_DIM, "revision": revision}

    @app.post("/embed")
    def embed(request: EmbedRequest):
        if request.model != model_dir.name:
            raise HTTPException(400, "Model name does not match loaded model")
        if bool(request.text) == bool(request.image):
            raise HTTPException(400, "Provide exactly one of text or image")
        if request.image:
            try:
                raw = base64.b64decode(request.image, validate=True)
            except Exception as error:
                raise HTTPException(400, "Invalid image") from error
            image = prepare_image(raw)
            payload = {"text": "<|image|>", "image": [image]}
            encode_kwargs = {}
        else:
            if not request.text or not request.text.strip():
                raise HTTPException(400, "Text cannot be blank")
            try:
                selected = prompt_name(request.role)
            except ValueError as error:
                raise HTTPException(400, str(error)) from error
            payload = request.text
            encode_kwargs = {"prompt_name": selected}
        if not lock.acquire(blocking=False):
            raise HTTPException(429, "Model busy; use one concurrent request")
        started = time.perf_counter()
        try:
            with torch.inference_mode():
                values = model.encode(
                    payload,
                    normalize_embeddings=True,
                    convert_to_numpy=True,
                    show_progress_bar=False,
                    **encode_kwargs,
                )
            body = embed_values(values)
            body["elapsed_ms"] = round((time.perf_counter() - started) * 1000)
            return body
        except torch.cuda.OutOfMemoryError as error:
            torch.cuda.empty_cache()
            raise HTTPException(503, "显存不足。请关闭占用显存的应用，或改用 --device cpu。") from error
        finally:
            lock.release()

    return app


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-dir", type=Path, default=Path(__file__).resolve().parents[1] / "EmbeddingGemma-2")
    parser.add_argument("--device", choices=["cpu", "cuda"], default="cpu")
    parser.add_argument("--threads", type=int, default=6)
    parser.add_argument("--port", type=int, default=8787)
    args = parser.parse_args()
    app = create_app(args.model_dir.resolve(), args.device, args.threads)
    uvicorn.run(app, host="127.0.0.1", port=args.port, access_log=False)
