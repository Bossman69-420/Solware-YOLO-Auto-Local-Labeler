from __future__ import annotations

import shutil
import threading
import uuid
from pathlib import Path
from typing import Any

from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image

from .exporters import clear_dir, coco_zip, yolo_zip
from .inference import load_model, model_labels, predict_image, torch_cuda_available


ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / "runtime"
STATIC = ROOT / "app" / "static"
SUPPORTED_IMAGES = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
MAX_IMAGES = 1000

app = FastAPI(title="Solware")
app.mount("/static", StaticFiles(directory=STATIC), name="static")

projects: dict[str, dict[str, Any]] = {}
jobs: dict[str, dict[str, Any]] = {}
lock = threading.Lock()


@app.on_event("startup")
def startup() -> None:
    RUNTIME.mkdir(exist_ok=True)


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC / "index.html")


@app.get("/api/device")
def device() -> dict[str, Any]:
    return {"cuda": torch_cuda_available()}


@app.post("/api/projects")
def create_project(name: str = Form("Untitled project")) -> dict[str, Any]:
    project_id = uuid.uuid4().hex
    folder = RUNTIME / project_id
    clear_dir(folder)
    project = {
        "id": project_id,
        "name": name.strip() or "Untitled project",
        "folder": str(folder),
        "images": [],
        "labels": [],
        "model_path": None,
    }
    with lock:
        projects[project_id] = project
    return public_project(project)


@app.get("/api/projects/{project_id}")
def get_project(project_id: str) -> dict[str, Any]:
    return public_project(require_project(project_id))


@app.post("/api/projects/{project_id}/images")
async def upload_images(project_id: str, files: list[UploadFile] = File(...)) -> dict[str, Any]:
    project = require_project(project_id)
    if len(project["images"]) + len(files) > MAX_IMAGES:
        raise HTTPException(400, f"Solware supports up to {MAX_IMAGES} images per session project.")
    image_dir = Path(project["folder"]) / "images"
    image_dir.mkdir(parents=True, exist_ok=True)

    added = 0
    for upload in files:
        suffix = Path(upload.filename or "").suffix.lower()
        if suffix not in SUPPORTED_IMAGES:
            continue
        image_id = uuid.uuid4().hex
        safe_name = f"{image_id}{suffix}"
        path = image_dir / safe_name
        with path.open("wb") as target:
            shutil.copyfileobj(upload.file, target)
        with Image.open(path) as img:
            width, height = img.size
        project["images"].append(
            {
                "id": image_id,
                "original_name": upload.filename,
                "path": str(path),
                "url": f"/api/projects/{project_id}/images/{image_id}/file",
                "width": width,
                "height": height,
                "boxes": [],
                "status": "empty",
            }
        )
        added += 1
    return {"added": added, "project": public_project(project)}


@app.get("/api/projects/{project_id}/images/{image_id}/file")
def image_file(project_id: str, image_id: str) -> FileResponse:
    image = require_image(require_project(project_id), image_id)
    return FileResponse(image["path"])


@app.post("/api/projects/{project_id}/model")
async def upload_model(project_id: str, file: UploadFile = File(...)) -> dict[str, Any]:
    project = require_project(project_id)
    if Path(file.filename or "").suffix.lower() != ".pt":
        raise HTTPException(400, "V1 supports YOLO .pt models only.")
    model_dir = Path(project["folder"]) / "model"
    model_dir.mkdir(parents=True, exist_ok=True)
    model_path = model_dir / (file.filename or "model.pt")
    with model_path.open("wb") as target:
        shutil.copyfileobj(file.file, target)
    try:
        model = load_model(model_path)
        labels = model_labels(model)
    except Exception as exc:
        raise HTTPException(400, str(exc)) from exc
    project["model_path"] = str(model_path)
    project["labels"] = labels
    return {"labels": labels, "project": public_project(project)}


@app.post("/api/projects/{project_id}/labels")
def save_labels(project_id: str, payload: dict[str, list[str]]) -> dict[str, Any]:
    project = require_project(project_id)
    labels = [str(label).strip() for label in payload.get("labels", []) if str(label).strip()]
    if not labels:
        raise HTTPException(400, "At least one label is required.")
    project["labels"] = labels
    for image in project["images"]:
        for box in image["boxes"]:
            class_id = int(box["class_id"])
            box["label"] = labels[class_id] if class_id < len(labels) else f"class_{class_id}"
    return public_project(project)


@app.post("/api/projects/{project_id}/infer")
def start_inference(
    project_id: str,
    background_tasks: BackgroundTasks,
    conf: float = Form(0.25),
    imgsz: int = Form(640),
    device: str = Form("cpu"),
) -> dict[str, Any]:
    project = require_project(project_id)
    if not project["model_path"]:
        raise HTTPException(400, "Upload a .pt model before running inference.")
    if not project["images"]:
        raise HTTPException(400, "Upload images before running inference.")
    if imgsz < 320 or imgsz > 1280:
        raise HTTPException(400, "Image size must be between 320 and 1280.")
    if device == "cuda" and not torch_cuda_available():
        raise HTTPException(400, "CUDA is not available. Use CPU.")

    job_id = uuid.uuid4().hex
    jobs[job_id] = {"id": job_id, "project_id": project_id, "done": 0, "total": len(project["images"]), "status": "queued", "error": None}
    background_tasks.add_task(run_inference_job, job_id, project_id, conf, imgsz, device)
    return jobs[job_id]


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str) -> dict[str, Any]:
    if job_id not in jobs:
        raise HTTPException(404, "Job not found.")
    return jobs[job_id]


@app.post("/api/projects/{project_id}/images/{image_id}/boxes")
def save_boxes(project_id: str, image_id: str, payload: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    project = require_project(project_id)
    image = require_image(project, image_id)
    image["boxes"] = normalize_boxes(payload.get("boxes", []), image, project["labels"])
    image["status"] = "reviewed"
    return image


@app.get("/api/projects/{project_id}/export/{format_name}")
def export_project(project_id: str, format_name: str) -> FileResponse:
    project = require_project(project_id)
    out_dir = Path(project["folder"]) / "exports"
    out_dir.mkdir(exist_ok=True)
    if format_name == "yolo":
        path = yolo_zip(project, out_dir / "solware-yolov8.zip")
    elif format_name == "coco":
        path = coco_zip(project, out_dir / "solware-coco.zip")
    else:
        raise HTTPException(404, "Export format must be yolo or coco.")
    return FileResponse(path, filename=path.name)


def run_inference_job(job_id: str, project_id: str, conf: float, imgsz: int, device: str) -> None:
    job = jobs[job_id]
    try:
        project = require_project(project_id)
        job["status"] = "running"
        model = load_model(Path(project["model_path"]))
        labels = model_labels(model)
        if labels:
            project["labels"] = labels
        for image in project["images"]:
            image["status"] = "processing"
            image["boxes"] = predict_image(model, Path(image["path"]), conf, imgsz, device)
            image["status"] = "predicted"
            job["done"] += 1
        job["status"] = "complete"
    except Exception as exc:
        job["status"] = "error"
        job["error"] = str(exc)


def require_project(project_id: str) -> dict[str, Any]:
    if project_id not in projects:
        raise HTTPException(404, "Project not found. Create a new session project.")
    return projects[project_id]


def require_image(project: dict[str, Any], image_id: str) -> dict[str, Any]:
    for image in project["images"]:
        if image["id"] == image_id:
            return image
    raise HTTPException(404, "Image not found.")


def normalize_boxes(boxes: list[dict[str, Any]], image: dict[str, Any], labels: list[str]) -> list[dict[str, Any]]:
    normalized = []
    width = float(image["width"])
    height = float(image["height"])
    for box in boxes:
        class_id = max(0, int(box.get("class_id", 0)))
        x1 = max(0.0, min(width, float(box.get("x1", 0))))
        y1 = max(0.0, min(height, float(box.get("y1", 0))))
        x2 = max(0.0, min(width, float(box.get("x2", 0))))
        y2 = max(0.0, min(height, float(box.get("y2", 0))))
        if abs(x2 - x1) < 2 or abs(y2 - y1) < 2:
            continue
        normalized.append(
            {
                "x1": min(x1, x2),
                "y1": min(y1, y2),
                "x2": max(x1, x2),
                "y2": max(y1, y2),
                "class_id": class_id,
                "label": labels[class_id] if class_id < len(labels) else f"class_{class_id}",
                "confidence": float(box.get("confidence", 1.0)),
            }
        )
    return normalized


def public_project(project: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": project["id"],
        "name": project["name"],
        "images": project["images"],
        "labels": project["labels"],
        "has_model": bool(project["model_path"]),
    }