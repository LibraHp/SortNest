"""Check whether Ollama's top-level images field actually changes an embedding."""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import math
from pathlib import Path

import requests


def cosine(a: list[float], b: list[float]) -> float:
    if len(a) != len(b):
        raise ValueError("Embedding dimensions differ")
    return sum(x * y for x, y in zip(a, b)) / math.sqrt(
        sum(x * x for x in a) * sum(y * y for y in b)
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True, help="Complete /api/embed URL")
    parser.add_argument("--model", required=True)
    parser.add_argument("--images", nargs="+", type=Path, required=True)
    parser.add_argument("--prompt", default="Represent this image")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    def embed(image: Path | None = None) -> list[float]:
        body = {"model": args.model, "input": args.prompt}
        if image is not None:
            body["images"] = [base64.b64encode(image.read_bytes()).decode("ascii")]
        response = requests.post(args.url, json=body, timeout=180, allow_redirects=False)
        response.raise_for_status()
        vector = response.json()["embeddings"][0]
        if not vector or not all(math.isfinite(x) for x in vector):
            raise ValueError("Invalid embedding")
        return vector

    print("Requesting the text-only baseline...", flush=True)
    baseline = embed()
    vectors = []
    comparisons = []
    for path in args.images:
        print(f"Testing image: {path.name}", flush=True)
        vector = embed(path)
        vectors.append(vector)
        if len(vector) != len(baseline):
            raise ValueError("Embedding dimensions differ")
        comparisons.append({
            "image": path.name,
            "image_sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "dimensions": len(vector),
            "exactly_equal_to_text_only": vector == baseline,
            "max_absolute_difference": max(abs(x - y) for x, y in zip(vector, baseline)),
            "cosine_with_text_only": cosine(vector, baseline),
        })
    print("Repeating the text-only baseline...", flush=True)
    repeat = embed()
    report = {
        "model": args.model,
        "protocol": "input: string; images: [base64] at top level",
        "prompt": args.prompt,
        "baseline_dimensions": len(baseline),
        "baseline_repeat_exactly_equal": repeat == baseline,
        "images": comparisons,
        "all_images_and_text_exactly_equal": all(v == baseline for v in vectors),
    }
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
