let project = null;
let currentImage = null;
let bitmap = null;
let selectedBox = -1;
let mode = "idle";
let dragStart = null;
let dragBox = null;
let dragHandle = null;
let spaceDown = false;
let panToolEnabled = true;
let boxToolEnabled = true;

let baseScale = 1;
let zoom = 1;
let panX = 0;
let panY = 0;

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const statusText = document.getElementById("statusText");
const progress = document.getElementById("progress");
const canvasPanel = document.querySelector(".canvas-panel");

const api = async (url, options = {}) => {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
};

function setStatus(text) {
  statusText.textContent = text;
}

function toggleTool(tool) {
  if (tool === "pan") panToolEnabled = !panToolEnabled;
  if (tool === "box") boxToolEnabled = !boxToolEnabled;
  renderToolToggles();
  draw();
}

function renderToolToggles() {
  const pan = document.getElementById("panTool");
  const box = document.getElementById("boxTool");
  pan.classList.toggle("active", panToolEnabled);
  box.classList.toggle("active", boxToolEnabled);
  pan.setAttribute("aria-pressed", String(panToolEnabled));
  box.setAttribute("aria-pressed", String(boxToolEnabled));
}

function activeScale() {
  return baseScale * zoom;
}

function setCanvasSize() {
  const rect = canvasPanel.getBoundingClientRect();
  const nextWidth = Math.max(320, Math.floor(rect.width));
  const nextHeight = Math.max(320, Math.floor(rect.height));
  const changed = canvas.width !== nextWidth || canvas.height !== nextHeight;
  canvas.width = nextWidth;
  canvas.height = nextHeight;
  return changed;
}

async function createSessionProject() {
  const body = new FormData();
  body.append("name", "Solware session");
  project = await api("/api/projects", { method: "POST", body });
  currentImage = null;
  selectedBox = -1;
  resetView();
  renderProject();
  setStatus("Upload images to begin.");
}

document.getElementById("confidence").addEventListener("input", (event) => {
  document.getElementById("confValue").textContent = Number(event.target.value).toFixed(2);
});

document.getElementById("labelDisplay").addEventListener("change", draw);
document.getElementById("panTool").addEventListener("click", () => toggleTool("pan"));
document.getElementById("boxTool").addEventListener("click", () => toggleTool("box"));
document.getElementById("fitView").addEventListener("click", () => {
  resetView();
  draw();
});

document.getElementById("imageUpload").addEventListener("change", async (event) => {
  if (!project) await createSessionProject();
  const body = new FormData();
  for (const file of event.target.files) body.append("files", file);
  const result = await api(`/api/projects/${project.id}/images`, { method: "POST", body });
  project = result.project;
  renderProject();
  if (!currentImage && project.images.length) await selectImage(project.images[0].id);
  setStatus(`Added ${result.added} images.`);
  event.target.value = "";
});

document.getElementById("modelUpload").addEventListener("change", async (event) => {
  if (!project) await createSessionProject();
  const file = event.target.files[0];
  if (!file) return;
  const body = new FormData();
  body.append("file", file);
  const result = await api(`/api/projects/${project.id}/model`, { method: "POST", body });
  project = result.project;
  renderProject();
  setStatus(`Model loaded with ${result.labels.length} labels.`);
  event.target.value = "";
});

document.getElementById("runInference").addEventListener("click", async () => {
  if (!project) await createSessionProject();
  const body = new FormData();
  body.append("conf", document.getElementById("confidence").value);
  body.append("imgsz", document.getElementById("imgsz").value);
  body.append("device", document.getElementById("device").value);
  const job = await api(`/api/projects/${project.id}/infer`, { method: "POST", body });
  pollJob(job.id);
});

document.getElementById("saveLabels").addEventListener("click", async () => {
  const labels = [...document.querySelectorAll(".label-row input")].map((input) => input.value);
  project = await api(`/api/projects/${project.id}/labels`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ labels }),
  });
  syncCurrentImage();
  renderProject();
  draw();
});

document.getElementById("saveBoxes").addEventListener("click", saveCurrentBoxes);
document.getElementById("saveAllBoxes").addEventListener("click", async () => {
  await saveAllBoxes();
  setStatus("Saved all images.");
});
document.getElementById("deleteBox").addEventListener("click", deleteSelectedBox);

document.getElementById("boxClass").addEventListener("change", (event) => {
  if (!currentImage || selectedBox < 0) return;
  const classId = Number(event.target.value);
  currentImage.boxes[selectedBox].class_id = classId;
  currentImage.boxes[selectedBox].label = project.labels[classId] || `class_${classId}`;
  draw();
});

document.getElementById("exportYolo").addEventListener("click", () => exportProject("yolo"));
document.getElementById("exportCoco").addEventListener("click", () => exportProject("coco"));

async function pollJob(jobId) {
  setStatus("Inference running...");
  const timer = setInterval(async () => {
    const job = await api(`/api/jobs/${jobId}`);
    progress.max = job.total || 1;
    progress.value = job.done || 0;
    setStatus(`Inference ${job.status}: ${job.done}/${job.total}`);
    project = await api(`/api/projects/${project.id}`);
    syncCurrentImage();
    renderProject(false);
    draw();
    if (job.status === "complete" || job.status === "error") {
      clearInterval(timer);
      if (job.status === "error") setStatus(`Inference error: ${job.error}`);
    }
  }, 900);
}

function renderProject(redraw = true) {
  renderImages();
  renderLabels();
  renderClassSelect();
  if (redraw) draw();
}

function renderImages() {
  const list = document.getElementById("imageList");
  list.innerHTML = "";
  if (!project) return;
  for (const image of project.images) {
    const item = document.createElement("div");
    item.className = `image-item ${currentImage && currentImage.id === image.id ? "active" : ""}`;
    item.innerHTML = `<span>${escapeHtml(image.original_name || image.id)}</span><small>${image.status} / ${image.boxes.length}</small>`;
    item.addEventListener("click", () => selectImage(image.id));
    list.appendChild(item);
  }
}

function renderLabels() {
  const labels = document.getElementById("labels");
  labels.innerHTML = "";
  if (!project) return;
  project.labels.forEach((label, index) => {
    const row = document.createElement("div");
    row.className = "label-row";
    row.innerHTML = `<input value="${escapeHtml(label)}" /><small>${index}</small>`;
    labels.appendChild(row);
  });
}

function renderClassSelect() {
  const select = document.getElementById("boxClass");
  select.innerHTML = "";
  if (!project) return;
  project.labels.forEach((label, index) => {
    const option = document.createElement("option");
    option.value = index;
    option.textContent = `${index}: ${label}`;
    select.appendChild(option);
  });
  if (currentImage && selectedBox >= 0) {
    select.value = currentImage.boxes[selectedBox].class_id;
  }
}

async function selectImage(imageId) {
  currentImage = project.images.find((image) => image.id === imageId);
  selectedBox = -1;
  bitmap = await loadImage(currentImage.url);
  resetView();
  renderImages();
  draw();
}

function syncCurrentImage() {
  if (!currentImage || !project) return;
  currentImage = project.images.find((image) => image.id === currentImage.id) || currentImage;
  selectedBox = Math.min(selectedBox, currentImage.boxes.length - 1);
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = `${url}?t=${Date.now()}`;
  });
}

async function saveCurrentBoxes() {
  if (!project || !currentImage) return;
  const saved = await api(`/api/projects/${project.id}/images/${currentImage.id}/boxes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ boxes: currentImage.boxes }),
  });
  const index = project.images.findIndex((image) => image.id === saved.id);
  project.images[index] = saved;
  currentImage = saved;
  renderProject();
  setStatus("Saved current image.");
}

async function saveAllBoxes() {
  if (!project) return;
  for (const image of project.images) {
    const saved = await api(`/api/projects/${project.id}/images/${image.id}/boxes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ boxes: image.boxes }),
    });
    const index = project.images.findIndex((item) => item.id === saved.id);
    if (index >= 0) project.images[index] = saved;
    if (currentImage && currentImage.id === saved.id) currentImage = saved;
  }
  renderProject();
}

function resetView() {
  setCanvasSize();
  if (!currentImage) {
    zoom = 1;
    baseScale = 1;
    panX = 0;
    panY = 0;
    return;
  }
  fitCurrentImage();
}

function fitCurrentImage() {
  const size = currentImageSize();
  const padding = Math.min(48, Math.max(18, Math.min(canvas.width, canvas.height) * 0.05));
  const availableWidth = Math.max(1, canvas.width - padding * 2);
  const availableHeight = Math.max(1, canvas.height - padding * 2);
  zoom = 1;
  baseScale = Math.min(availableWidth / size.width, availableHeight / size.height, 1);
  centerImage();
}

function centerImage() {
  const size = currentImageSize();
  const s = activeScale();
  panX = (canvas.width - size.width * s) / 2;
  panY = (canvas.height - size.height * s) / 2;
}

function currentImageSize() {
  return {
    width: Math.max(Number(currentImage?.width) || bitmap?.naturalWidth || 1, 1),
    height: Math.max(Number(currentImage?.height) || bitmap?.naturalHeight || 1, 1),
  };
}

function draw() {
  const resized = setCanvasSize();
  if (resized && currentImage && !dragStart && mode === "idle") centerImage();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#08080a";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!bitmap || !currentImage) {
    ctx.fillStyle = "#8d8d95";
    ctx.fillText("Upload images to begin.", 32, 32);
    return;
  }

  const s = activeScale();
  const size = currentImageSize();
  ctx.imageSmoothingEnabled = zoom < 1.01;
  ctx.drawImage(bitmap, panX, panY, size.width * s, size.height * s);
  ctx.imageSmoothingEnabled = true;
  currentImage.boxes.forEach((box, index) => drawBox(box, index === selectedBox));
}

function drawBox(box, selected) {
  const rect = imageRectToScreen(box);
  ctx.strokeStyle = selected ? "#ffffff" : "#29d391";
  ctx.lineWidth = selected ? 3 : 2;
  ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);

  if (selected) drawHandles(rect);

  const display = document.getElementById("labelDisplay").value;
  if (display === "none") return;

  const text = display === "full" ? `${box.label} ${(box.confidence ?? 1).toFixed(2)}` : box.label;
  ctx.font = "12px Inter, sans-serif";
  ctx.textBaseline = "top";
  if (display === "full") {
    const width = Math.max(48, ctx.measureText(text).width + 10);
    ctx.fillStyle = selected ? "#ffffff" : "#29d391";
    ctx.fillRect(rect.x, Math.max(0, rect.y - 20), width, 18);
    ctx.fillStyle = "#050505";
    ctx.fillText(text, rect.x + 5, Math.max(2, rect.y - 17));
  } else {
    ctx.fillStyle = selected ? "#ffffff" : "#29d391";
    ctx.fillText(text, rect.x + 4, rect.y + 4);
  }
}

function drawHandles(rect) {
  ctx.fillStyle = "#ffffff";
  for (const handle of handlePoints(rect)) {
    ctx.fillRect(handle.x - 4, handle.y - 4, 8, 8);
  }
}

canvas.addEventListener("mousedown", (event) => {
  if (!currentImage) return;
  event.preventDefault();
  const screen = screenPoint(event);
  const point = screenToImage(screen);

  if (event.button === 1 || spaceDown) {
    startPan(screen);
    return;
  }

  if (event.button === 2) {
    startBox(point);
    renderClassSelect();
    draw();
    return;
  }

  if (event.button !== 0) return;

  if (!boxToolEnabled) {
    if (panToolEnabled) startPan(screen);
    return;
  }

  if (selectedBox >= 0) {
    const selectedHandle = handleHit(screen, imageRectToScreen(currentImage.boxes[selectedBox]));
    if (selectedHandle) {
      dragHandle = selectedHandle;
      dragStart = point;
      dragBox = { ...currentImage.boxes[selectedBox] };
      mode = "resize";
      draw();
      return;
    }
  }

  selectedBox = hitTest(point);
  if (selectedBox >= 0) {
    const box = currentImage.boxes[selectedBox];
    dragHandle = handleHit(screen, imageRectToScreen(box));
    dragStart = point;
    dragBox = { ...box };
    mode = dragHandle ? "resize" : "move";
    document.getElementById("boxClass").value = box.class_id;
  } else if (panToolEnabled) {
    selectedBox = -1;
    startPan(screen);
  } else {
    startBox(point);
  }
  renderClassSelect();
  draw();
});

canvas.addEventListener("contextmenu", (event) => event.preventDefault());

function startPan(screen) {
  mode = "pan";
  dragStart = screen;
  dragBox = { panX, panY };
  canvas.classList.add("panning");
}

function startBox(point) {
  const clamped = {
    x: clamp(point.x, 0, currentImage.width),
    y: clamp(point.y, 0, currentImage.height),
  };
  mode = "draw";
  dragStart = clamped;
  currentImage.boxes.push({ x1: clamped.x, y1: clamped.y, x2: clamped.x, y2: clamped.y, class_id: 0, label: project.labels[0] || "class_0", confidence: 1 });
  selectedBox = currentImage.boxes.length - 1;
}

canvas.addEventListener("mousemove", (event) => {
  if (!currentImage) return;
  const screen = screenPoint(event);
  const point = screenToImage(screen);

  if (!dragStart) {
    canvas.classList.toggle("panning", spaceDown || (panToolEnabled && !boxToolEnabled));
    return;
  }

  if (mode === "pan") {
    panX = dragBox.panX + screen.x - dragStart.x;
    panY = dragBox.panY + screen.y - dragStart.y;
    draw();
    return;
  }

  if (selectedBox < 0) return;
  const box = currentImage.boxes[selectedBox];

  if (mode === "draw") {
    box.x2 = clamp(point.x, 0, currentImage.width);
    box.y2 = clamp(point.y, 0, currentImage.height);
  }

  if (mode === "move") {
    const dx = point.x - dragStart.x;
    const dy = point.y - dragStart.y;
    const w = dragBox.x2 - dragBox.x1;
    const h = dragBox.y2 - dragBox.y1;
    box.x1 = clamp(dragBox.x1 + dx, 0, currentImage.width - w);
    box.y1 = clamp(dragBox.y1 + dy, 0, currentImage.height - h);
    box.x2 = box.x1 + w;
    box.y2 = box.y1 + h;
  }

  if (mode === "resize") {
    resizeBox(box, dragBox, point, dragHandle);
  }

  draw();
});

canvas.addEventListener("mouseup", finishPointerAction);
canvas.addEventListener("mouseleave", finishPointerAction);

canvas.addEventListener("wheel", (event) => {
  if (!currentImage) return;
  event.preventDefault();
  const screen = screenPoint(event);
  const before = screenToImage(screen);
  const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
  zoom = clamp(zoom * factor, 0.2, 12);
  const s = activeScale();
  panX = screen.x - before.x * s;
  panY = screen.y - before.y * s;
  draw();
}, { passive: false });

document.addEventListener("keydown", (event) => {
  if (event.code === "Space") {
    spaceDown = true;
    canvas.classList.add("panning");
    event.preventDefault();
  }
  if (event.key === "Delete" || event.key === "Backspace") {
    deleteSelectedBox();
  }
});

document.addEventListener("keyup", (event) => {
  if (event.code === "Space") {
    spaceDown = false;
    canvas.classList.remove("panning");
  }
});

window.addEventListener("resize", () => {
  if (!currentImage) {
    draw();
    return;
  }
  resetView();
  draw();
});

function finishPointerAction() {
  if (!currentImage || !dragStart) return;
  if (selectedBox >= 0) {
    const box = currentImage.boxes[selectedBox];
    const x1 = Math.min(box.x1, box.x2);
    const y1 = Math.min(box.y1, box.y2);
    const x2 = Math.max(box.x1, box.x2);
    const y2 = Math.max(box.y1, box.y2);
    Object.assign(box, { x1, y1, x2, y2 });
    if (Math.abs(x2 - x1) < 2 || Math.abs(y2 - y1) < 2) {
      currentImage.boxes.splice(selectedBox, 1);
      selectedBox = -1;
    }
  }
  mode = "idle";
  dragStart = null;
  dragBox = null;
  dragHandle = null;
  canvas.classList.remove("panning");
  draw();
}

function resizeBox(box, original, point, handle) {
  if (handle.includes("w")) box.x1 = clamp(point.x, 0, currentImage.width);
  if (handle.includes("e")) box.x2 = clamp(point.x, 0, currentImage.width);
  if (handle.includes("n")) box.y1 = clamp(point.y, 0, currentImage.height);
  if (handle.includes("s")) box.y2 = clamp(point.y, 0, currentImage.height);
  if (!handle.includes("w") && !handle.includes("e")) {
    box.x1 = original.x1;
    box.x2 = original.x2;
  }
  if (!handle.includes("n") && !handle.includes("s")) {
    box.y1 = original.y1;
    box.y2 = original.y2;
  }
}

function deleteSelectedBox() {
  if (!currentImage || selectedBox < 0) return;
  currentImage.boxes.splice(selectedBox, 1);
  selectedBox = -1;
  draw();
}

function screenPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function screenToImage(point) {
  const s = activeScale();
  return {
    x: (point.x - panX) / s,
    y: (point.y - panY) / s,
  };
}

function imageRectToScreen(box) {
  const s = activeScale();
  return {
    x: panX + box.x1 * s,
    y: panY + box.y1 * s,
    w: (box.x2 - box.x1) * s,
    h: (box.y2 - box.y1) * s,
  };
}

function hitTest(point) {
  for (let i = currentImage.boxes.length - 1; i >= 0; i--) {
    const box = currentImage.boxes[i];
    if (point.x >= box.x1 && point.x <= box.x2 && point.y >= box.y1 && point.y <= box.y2) return i;
  }
  return -1;
}

function handleHit(point, rect) {
  const handles = handlePoints(rect);
  for (const handle of handles) {
    if (Math.abs(point.x - handle.x) <= 8 && Math.abs(point.y - handle.y) <= 8) return handle.name;
  }
  return null;
}

function handlePoints(rect) {
  const left = rect.x;
  const centerX = rect.x + rect.w / 2;
  const right = rect.x + rect.w;
  const top = rect.y;
  const centerY = rect.y + rect.h / 2;
  const bottom = rect.y + rect.h;
  return [
    { name: "nw", x: left, y: top },
    { name: "n", x: centerX, y: top },
    { name: "ne", x: right, y: top },
    { name: "e", x: right, y: centerY },
    { name: "se", x: right, y: bottom },
    { name: "s", x: centerX, y: bottom },
    { name: "sw", x: left, y: bottom },
    { name: "w", x: left, y: centerY },
  ];
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

async function exportProject(format) {
  if (!project) return alert("Workspace is still starting.");
  await saveAllBoxes();
  window.location.href = `/api/projects/${project.id}/export/${format}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

api("/api/device").then((info) => {
  if (!info.cuda) document.querySelector('#device option[value="cuda"]').disabled = true;
});

renderToolToggles();
createSessionProject().catch((error) => setStatus(`Startup error: ${error.message}`));
