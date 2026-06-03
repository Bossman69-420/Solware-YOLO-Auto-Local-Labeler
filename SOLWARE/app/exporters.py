from __future__ import annotations

import json
import shutil
import zipfile
from pathlib import Path


def yolo_zip(project: dict, out_path: Path) -> Path:
    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as archive:
        labels = project["labels"]
        names = ", ".join([repr(label) for label in labels])
        archive.writestr("data.yaml", f"path: .\ntrain: images\nval: images\nnc: {len(labels)}\nnames: [{names}]\n")

        for image in project["images"]:
            source = Path(image["path"])
            archive.write(source, f"images/{source.name}")
            lines = []
            width = max(float(image["width"]), 1.0)
            height = max(float(image["height"]), 1.0)
            for box in image["boxes"]:
                x1 = max(0.0, min(width, float(box["x1"])))
                y1 = max(0.0, min(height, float(box["y1"])))
                x2 = max(0.0, min(width, float(box["x2"])))
                y2 = max(0.0, min(height, float(box["y2"])))
                cx = ((x1 + x2) / 2.0) / width
                cy = ((y1 + y2) / 2.0) / height
                bw = abs(x2 - x1) / width
                bh = abs(y2 - y1) / height
                lines.append(f"{int(box['class_id'])} {cx:.6f} {cy:.6f} {bw:.6f} {bh:.6f}")
            archive.writestr(f"labels/{source.stem}.txt", "\n".join(lines))
    return out_path


def coco_zip(project: dict, out_path: Path) -> Path:
    coco = {
        "images": [],
        "annotations": [],
        "categories": [{"id": index, "name": label, "supercategory": "object"} for index, label in enumerate(project["labels"])],
    }
    annotation_id = 1
    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as archive:
        for image_index, image in enumerate(project["images"], start=1):
            source = Path(image["path"])
            archive.write(source, source.name)
            coco["images"].append(
                {
                    "id": image_index,
                    "file_name": source.name,
                    "width": int(image["width"]),
                    "height": int(image["height"]),
                }
            )
            for box in image["boxes"]:
                x1 = float(box["x1"])
                y1 = float(box["y1"])
                width = abs(float(box["x2"]) - x1)
                height = abs(float(box["y2"]) - y1)
                coco["annotations"].append(
                    {
                        "id": annotation_id,
                        "image_id": image_index,
                        "category_id": int(box["class_id"]),
                        "bbox": [x1, y1, width, height],
                        "area": width * height,
                        "iscrowd": 0,
                    }
                )
                annotation_id += 1
        archive.writestr("_annotations.coco.json", json.dumps(coco, indent=2))
    return out_path


def clear_dir(path: Path) -> None:
    if path.exists():
        shutil.rmtree(path)
    path.mkdir(parents=True, exist_ok=True)