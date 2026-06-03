from __future__ import annotations

from pathlib import Path
from typing import Any


def torch_cuda_available() -> bool:
    try:
        import torch

        return bool(torch.cuda.is_available())
    except Exception:
        return False


def load_model(model_path: Path) -> Any:
    try:
        from ultralytics import YOLO
    except Exception as exc:
        raise RuntimeError("Ultralytics is not installed. Run: pip install -r requirements.txt") from exc
    return YOLO(str(model_path))


def model_labels(model: Any) -> list[str]:
    names = getattr(model, "names", None) or {}
    if isinstance(names, dict):
        return [str(names[index]) for index in sorted(names)]
    if isinstance(names, list):
        return [str(name) for name in names]
    return []


def predict_image(model: Any, image_path: Path, conf: float, imgsz: int, device: str) -> list[dict[str, Any]]:
    selected_device = "cuda:0" if device == "cuda" else "cpu"
    results = model.predict(
        source=str(image_path),
        conf=conf,
        imgsz=imgsz,
        device=selected_device,
        verbose=False,
    )
    if not results:
        return []

    result = results[0]
    if result.boxes is None:
        return []

    names = model_labels(model)
    boxes = []
    for box in result.boxes:
        xyxy = box.xyxy[0].tolist()
        class_id = int(box.cls[0].item())
        confidence = float(box.conf[0].item())
        boxes.append(
            {
                "x1": float(xyxy[0]),
                "y1": float(xyxy[1]),
                "x2": float(xyxy[2]),
                "y2": float(xyxy[3]),
                "class_id": class_id,
                "label": names[class_id] if class_id < len(names) else f"class_{class_id}",
                "confidence": confidence,
            }
        )
    return boxes