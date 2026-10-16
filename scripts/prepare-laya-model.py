"""Export the pinned official Laya checkpoint for local browser inference.

Requires: python -m pip install "laya[onnx]==0.3.20" onnx onnxscript huggingface_hub hf_xet
Run: python scripts/prepare-laya-model.py
"""

from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
MODEL_REPO = "convaiinnovations/laya"
MODEL_REVISION = "55cf4c4ebb4ebe31b2550e8bdf3bd21b99753851"
OUTPUT = ROOT / "public" / "models" / "laya"
EXPORTER = ROOT / "vendor" / "laya-ts" / "scripts" / "export_onnx.py"


def main() -> None:
    try:
        import laya  # noqa: F401 - exporter requires the Python reference runtime
        import onnx  # noqa: F401 - torch's ONNX exporter requires this package
        import onnxscript  # noqa: F401 - the dynamic head exporter requires this package
        from huggingface_hub import snapshot_download
    except ImportError as error:
        raise SystemExit(
            'Install export dependencies first: python -m pip install "laya[onnx]==0.3.20" onnx onnxscript huggingface_hub hf_xet'
        ) from error

    if not EXPORTER.is_file():
        raise SystemExit(f"Missing pinned Laya exporter: {EXPORTER}")

    model_dir = snapshot_download(
        MODEL_REPO,
        revision=MODEL_REVISION,
        allow_patterns=[
            "rl_agent_config.json", "model.safetensors", "config.json",
            "tokenizer.json", "tokenizer/*", "encoder/*",
        ],
    )
    subprocess.run(
        [sys.executable, str(EXPORTER), "--model-dir", model_dir, "--out-dir", str(OUTPUT)],
        cwd=ROOT,
        check=True,
    )
    required = ("encoder.onnx", "head.onnx", "tokenizer.json", "rl_agent_config.json")
    missing = [name for name in required if not (OUTPUT / name).is_file()]
    if missing:
        raise SystemExit(f"Incomplete Laya export: {', '.join(missing)}")
    (OUTPUT / "provenance.json").write_text(
        json.dumps({"repo": MODEL_REPO, "revision": MODEL_REVISION,
                    "runtimeSource": "NandhaKishorM/laya@4ac226d5ee88ed6df8db288a05c766d7a34ee682"}, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Browser model ready at {OUTPUT}")


if __name__ == "__main__":
    main()
