"""Configuration regressions. Real inference is checked separately against the local checkpoint."""
import io
import unittest
from unittest.mock import patch

import torch
from fastapi import HTTPException
from PIL import Image

from gemma_server import (
    OUTPUT_DIM,
    finalize_vector,
    inference_revision,
    prepare_image,
    prompt_name,
    runtime_dtype,
)


class RuntimeTests(unittest.TestCase):
    def test_cpu_stays_float32_and_cuda_without_bf16_does_not_use_float16(self):
        self.assertEqual(runtime_dtype("cpu"), torch.float32)
        cpu = inference_revision("weights", "cpu", torch.float32)
        self.assertEqual(len(cpu), 64)
        self.assertNotEqual(cpu, "weights")

    @patch("torch.cuda.is_available", return_value=False)
    def test_cpu_wheel_explains_how_to_start_cuda(self, _available):
        with self.assertRaisesRegex(RuntimeError, "start-model.ps1"):
            runtime_dtype("cuda")

    @patch("torch.cuda.is_bf16_supported", return_value=False)
    @patch("torch.cuda.is_available", return_value=True)
    def test_cuda_without_bf16_uses_float32(self, *_mocks):
        self.assertEqual(runtime_dtype("cuda"), torch.float32)

    @patch("torch.cuda.is_bf16_supported", return_value=True)
    @patch("torch.cuda.is_available", return_value=True)
    def test_cuda_bf16_is_distinct_from_float32(self, *_mocks):
        self.assertEqual(runtime_dtype("cuda"), torch.bfloat16)
        self.assertNotEqual(
            inference_revision("weights", "cuda", torch.bfloat16),
            inference_revision("weights", "cuda", torch.float32),
        )

    def test_prompt_names_match_retrieval_tasks(self):
        self.assertEqual(prompt_name(None), "SearchQuery")
        self.assertEqual(prompt_name("query"), "SearchQuery")
        self.assertEqual(prompt_name("document"), "Document")
        with self.assertRaisesRegex(ValueError, "query"):
            prompt_name("classification")

    def test_vector_must_be_finite_768(self):
        vector = finalize_vector(torch.ones(OUTPUT_DIM))
        self.assertEqual(tuple(vector.shape), (OUTPUT_DIM,))
        self.assertAlmostEqual(float(vector.norm()), 1.0, places=5)
        with self.assertRaisesRegex(RuntimeError, "Invalid"):
            finalize_vector(torch.ones(256))
        with self.assertRaisesRegex(RuntimeError, "Invalid"):
            finalize_vector(torch.tensor([float("nan")] * OUTPUT_DIM))

    def test_prepare_image_limits_the_long_edge(self):
        source = Image.new("RGB", (2000, 1000), (20, 40, 60))
        raw = io.BytesIO()
        source.save(raw, format="PNG")
        image = prepare_image(raw.getvalue())
        self.assertEqual(image.size, (1024, 512))
        with self.assertRaises(HTTPException):
            prepare_image(b"not an image")


if __name__ == "__main__":
    unittest.main()
