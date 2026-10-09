"""Configuration regressions; real inference is checked separately with public images."""
import unittest
from unittest.mock import patch
from types import SimpleNamespace

import torch
from wemm_server import inference_revision, runtime_config


class RuntimeTests(unittest.TestCase):
    def test_cpu_remains_compatible_and_rejects_cuda_quantization(self):
        self.assertEqual(runtime_config("cpu", "auto"), ("none", torch.float32))
        self.assertEqual(inference_revision("weights", "cpu", "none", torch.float32), "weights")
        with self.assertRaisesRegex(RuntimeError, "需要 CUDA"):
            runtime_config("cpu", "4bit")

    @patch("torch.cuda.is_available", return_value=False)
    def test_cpu_wheel_explains_how_to_start_cuda(self, _available):
        with self.assertRaisesRegex(RuntimeError, "start-model.ps1"):
            runtime_config("cuda", "auto")

    @patch("torch.cuda.is_bf16_supported", return_value=True)
    @patch("torch.cuda.get_device_properties", return_value=SimpleNamespace(total_memory=4 * 1024**3))
    @patch("torch.cuda.is_available", return_value=True)
    def test_four_gb_card_defaults_to_quantized_and_separates_indexes(self, *_mocks):
        self.assertEqual(runtime_config("cuda", "auto"), ("4bit", torch.bfloat16))
        revisions = {inference_revision("weights", *args) for args in [
            ("cpu", "none", torch.float32), ("cuda", "4bit", torch.bfloat16),
            ("cuda", "none", torch.bfloat16), ("cuda", "4bit", torch.float16),
        ]}
        self.assertEqual(len(revisions), 4)


if __name__ == "__main__":
    unittest.main()
