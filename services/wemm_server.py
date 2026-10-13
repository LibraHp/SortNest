"""SortNest's optional loopback-only WeMM embedding service. No image paths accepted."""
from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
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
from transformers import AutoModel, AutoProcessor, BitsAndBytesConfig
import uvicorn

Image.MAX_IMAGE_PIXELS = 32_000_000

class EmbedRequest(BaseModel):
    model: str
    text: str | None = Field(default=None, max_length=8000)
    image: str | None = Field(default=None, max_length=8_000_000)


def model_revision(path: Path) -> str:
    digest = hashlib.sha256()
    # Pin weights, implementation, tokenizer and preprocessing together.
    for file in sorted(path.iterdir()):
        if file.is_file() and file.suffix in {".json", ".jinja", ".py", ".safetensors"}:
            digest.update(file.name.encode())
            with file.open("rb") as stream:
                for block in iter(lambda: stream.read(8 * 1024 * 1024), b""):
                    digest.update(block)
    return digest.hexdigest()


def runtime_config(device: str, quantization: str) -> tuple[str, torch.dtype]:
    if device == "cuda" and not torch.cuda.is_available():
        raise RuntimeError(
            "CUDA 不可用。请运行 scripts/start-model.ps1 -Device cuda，使用独立 CUDA 环境；"
            f"当前 PyTorch={torch.__version__}，CUDA 构建={torch.version.cuda}。"
        )
    if quantization == "auto":
        quantization = "4bit" if device == "cuda" and torch.cuda.get_device_properties(0).total_memory <= 6 * 1024**3 else "none"
    if quantization == "4bit" and device != "cuda":
        raise RuntimeError("4 位量化模式需要 CUDA；CPU 请使用 --quantization none")
    dtype = torch.float32 if device == "cpu" else (torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16)
    return quantization, dtype


def inference_revision(weights_revision: str, device: str, quantization: str, dtype: torch.dtype) -> str:
    if device == "cpu" and quantization == "none":
        return weights_revision  # Preserve the existing CPU index.
    settings = f"{weights_revision}|cuda-v1|{quantization}|{dtype}|nf4-double|pixels65536"
    return hashlib.sha256(settings.encode()).hexdigest()


def create_app(model_dir: Path, device: str = "cpu", threads: int = 6, quantization: str = "auto") -> FastAPI:
    if not (model_dir / "model.safetensors").is_file():
        raise RuntimeError("模型目录缺少 model.safetensors")
    quantization, dtype = runtime_config(device, quantization)
    torch.set_num_threads(max(1, threads))
    revision = inference_revision(model_revision(model_dir), device, quantization, dtype)
    print(f"Loading local WeMM on {device}; quantization={quantization}; revision {revision[:16]}", flush=True)
    processor = AutoProcessor.from_pretrained(str(model_dir), trust_remote_code=True, local_files_only=True)
    load_options = {}
    if quantization == "4bit":
        # The 248k-token vocabulary is large. Keep it and the unused generation
        # head in RAM, while attention, MLP and vision layers run on the GPU.
        load_options = {
            "quantization_config": BitsAndBytesConfig(
                load_in_4bit=True, bnb_4bit_quant_type="nf4",
                bnb_4bit_use_double_quant=True, bnb_4bit_compute_dtype=dtype,
                llm_int8_enable_fp32_cpu_offload=True,
            ),
            "device_map": {
                "model.visual": 0, "model.language_model": 0,
                "model.language_model.embed_tokens": "cpu", "lm_head": "cpu",
            },
        }
    model = AutoModel.from_pretrained(
        str(model_dir), trust_remote_code=True, local_files_only=True,
        dtype=dtype, attn_implementation="sdpa", **load_options,
    )
    if quantization == "none":
        model = model.to(device)
    model.eval()
    lock = threading.Lock()
    app = FastAPI(title="SortNest local WeMM", docs_url=None, redoc_url=None)

    @app.middleware("http")
    async def local_only(request: Request, call_next):
        from starlette.responses import JSONResponse
        if request.headers.get("origin") or request.headers.get("host", "").split(":")[0] not in {"localhost", "127.0.0.1"}:
            return JSONResponse({"detail": "Local desktop client only"}, status_code=403)
        if int(request.headers.get("content-length", "0")) > 9_000_000:
            return JSONResponse({"detail": "Request too large"}, status_code=413)
        return await call_next(request)

    @app.get("/health")
    def health():
        return {"ready": True, "model": model_dir.name, "revision": revision,
                "device": device, "quantization": quantization, "dtype": str(dtype),
                "gpu": torch.cuda.get_device_name(0) if device == "cuda" else None,
                "dimension": 2048, "protocol": "sortnest-wemm-v1"}

    @app.post("/embed")
    def embed(request: EmbedRequest):
        if request.model != model_dir.name:
            raise HTTPException(400, "Model name does not match loaded model")
        if bool(request.text) == bool(request.image):
            raise HTTPException(400, "Provide exactly one of text or image")
        content = []
        images = None
        if request.image:
            try:
                raw = base64.b64decode(request.image, validate=True)
                with Image.open(io.BytesIO(raw)) as source:
                    im = ImageOps.exif_transpose(source).convert("RGB")
                    im.thumbnail((256, 256))
                images = [im]
                content.append({"type": "image", "image": im})
            except Exception as error:
                raise HTTPException(400, "Invalid image") from error
        else:
            if not request.text.strip():
                raise HTTPException(400, "Text cannot be blank")
            content.append({"type": "text", "text": request.text})
        if not lock.acquire(blocking=False):
            raise HTTPException(429, "Model busy; use one concurrent request")
        started = time.perf_counter()
        try:
            messages = [{"role": "user", "content": content}]
            text = processor.apply_chat_template(messages, tokenize=False, add_generation_prompt=False)
            inputs = processor(
                text=[text],
                images=images,
                return_tensors="pt",
                min_pixels=65536,
                max_pixels=65536,
            ).to(device)
            if inputs["input_ids"].shape[-1] > 2048:
                raise HTTPException(400, "Input exceeds 2048 token limit")
            with torch.inference_mode():
                vector = model.embedding(**inputs, use_cache=False)[0].float().cpu()
            if vector.numel() != 2048 or not torch.isfinite(vector).all() or vector.norm() < 1e-10:
                raise RuntimeError("Invalid model embedding")
            vector = torch.nn.functional.normalize(vector, dim=0)
            return {"embedding": vector.tolist(), "dimension": len(vector), "revision": revision,
                    "elapsed_ms": round((time.perf_counter() - started) * 1000)}
        except torch.cuda.OutOfMemoryError as error:
            torch.cuda.empty_cache()
            raise HTTPException(503, "显存不足：请关闭占用显存的应用，并使用 --quantization 4bit；保持单请求推理。") from error
        finally:
            lock.release()

    return app


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-dir", type=Path, default=Path(__file__).resolve().parents[1] / "WeMM-Embedding-2B")
    parser.add_argument("--device", choices=["cpu", "cuda"], default="cpu")
    parser.add_argument("--quantization", choices=["auto", "none", "4bit"], default="auto",
                        help="auto: CUDA 显存不超过 6GB 时使用 4 位量化，否则不量化")
    parser.add_argument("--threads", type=int, default=6)
    parser.add_argument("--port", type=int, default=8787)
    args = parser.parse_args()
    app = create_app(args.model_dir.resolve(), args.device, args.threads, args.quantization)
    uvicorn.run(app, host="127.0.0.1", port=args.port, access_log=False)
