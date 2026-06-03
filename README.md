# Solware YOLO Auto Labeler

Solware YOLO Auto Labeler is a local web app for speeding up object-detection dataset labeling with YOLOv8 models.

Upload images, add a trained `.pt` model, let the model pre-label your dataset, correct the boxes in the browser, and export the result as YOLOv8 or COCO annotations.

It is designed for small, practical computer-vision workflows where you want fast local labeling without sending your images, model, or dataset to an online platform.

## What Is This?

Solware is a browser-based annotation tool that runs on your own machine. It gives you a simple workflow for turning raw images into a training-ready object-detection dataset:

1. Upload a folder of images.
2. Upload a YOLOv8 `.pt` model.
3. Run automatic pre-labeling.
4. Review and fix bounding boxes.
5. Export the final annotations.

The app is session-based and local-first. It uses FastAPI for the backend, Ultralytics YOLO for inference, and a lightweight HTML/CSS/JavaScript frontend for reviewing and editing boxes.

## Why I Built It

Labeling object-detection datasets by hand is slow, repetitive, and easy to burn out on. But once you already have a decent YOLO model, most new images do not need to start from zero.

I built Solware to make that loop faster:

- Use an existing YOLO model to create a first pass.
- Keep all files local instead of uploading private datasets.
- Quickly inspect predictions and fix only what is wrong.
- Export annotations in formats that are ready for training or dataset tools.

The goal is not to replace large annotation platforms. The goal is to have a focused local tool that gets out of the way when you just need to label, correct, and export.

## Features

- Local web interface for image annotation.
- YOLOv8 `.pt` model upload.
- Automatic bounding-box prediction.
- Confidence, image size, and CPU/GPU inference controls.
- Canvas tools for panning, zooming, drawing, editing, and deleting boxes.
- Editable label list.
- YOLOv8 export.
- COCO export.
- No account, cloud upload, or external dataset service required.

## Requirements

- Python 3.11 or 3.12
- A YOLOv8 object-detection `.pt` model
- Windows, macOS, or Linux

GPU inference is available when your local PyTorch/CUDA setup supports it. CPU mode works without CUDA.

## Install

```powershell
python -m pip install -r requirements.txt
```

## Run

On Windows, you can use:

```powershell
.\start-solware.bat
```

Or start the server manually:

```powershell
python -m uvicorn app.main:app --reload
```

Then open:

```text
http://localhost:8000
```

## How To Use

1. Click `Add images`.
2. Click `Add model` and choose a YOLOv8 `.pt` file, for example `best.pt`.
3. Choose confidence, image size, and CPU/GPU.
4. Click `Run labeling`.
5. Review each image and fix boxes.
6. Click `Save all`.
7. Export `YOLOv8` or `COCO`.

Exports automatically save current boxes before downloading.

## Annotation Controls

- Right mouse drag always draws a new box.
- Mouse wheel zooms.
- Hold `Space` or use middle mouse to pan.
- Use `Pan` and `Boxes` to control what left mouse drag does.
- `Fit` recenters the current image in the canvas.
- `Box text` controls whether labels are hidden, compact, or shown with confidence.

## Notes

- `Image size` is only used for model inference.
- Exported annotations keep the original full image resolution.
- V1 supports YOLOv8 object-detection `.pt` models.
- Projects are stored as local runtime/session data, not as permanent cloud projects.

## Tech Stack

- FastAPI
- Ultralytics YOLO
- Pillow
- Plain HTML, CSS, and JavaScript
