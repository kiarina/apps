const COLS = 3;
const ROWS = 4;
const IDLE_COLUMN = 1;
const PIXEL_ART_LIMIT = 96;

const SEQUENCES = {
  pingpong: [0, 1, 2, 1],
  loop: [0, 1, 2],
  reverse: [2, 1, 0],
};

const KEY_DIRECTIONS = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  KeyW: "up",
  KeyS: "down",
  KeyA: "left",
  KeyD: "right",
};

const MOVE_VECTORS = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};

const BACKGROUNDS = {
  checker: null,
  paper: "#f3f0e8",
  dark: "#17201d",
  magenta: "#ff00ff",
};

const elements = {
  dropzone: document.querySelector("#dropzone"),
  stage: document.querySelector("#stage"),
  placeholder: document.querySelector("#placeholder"),
  sheetInfo: document.querySelector("#sheet-info"),
  fileInput: document.querySelector("#file-input"),
  openButton: document.querySelector("#open-button"),
  playButton: document.querySelector("#play-button"),
  fps: document.querySelector("#fps"),
  fpsOut: document.querySelector("#fps-out"),
  zoom: document.querySelector("#zoom"),
  zoomOut: document.querySelector("#zoom-out"),
  pattern: document.querySelector("#pattern"),
  rowOrder: document.querySelector("#row-order"),
  background: document.querySelector("#background"),
  walking: document.querySelector("#walking"),
  moving: document.querySelector("#moving"),
  pixelated: document.querySelector("#pixelated"),
  mirror: document.querySelector("#mirror"),
  grid: document.querySelector("#grid"),
  dpadButtons: Array.from(document.querySelectorAll(".dpad-btn")),
  stripCanvases: Array.from(document.querySelectorAll(".strip-canvas")),
};

const stageContext = elements.stage.getContext("2d");
const stripContexts = elements.stripCanvases.map((canvas) => ({
  canvas,
  context: canvas.getContext("2d"),
  direction: canvas.dataset.dir,
}));

let sheet = null;
let frameWidth = 0;
let frameHeight = 0;
let frameCache = new Map();
let direction = "down";
let playing = true;
let elapsed = 0;
let lastTimestamp = null;
let position = { x: 0, y: 0 };

function frameDuration() {
  return 1000 / Number(elements.fps.value);
}

function currentSequence() {
  return SEQUENCES[elements.pattern.value] ?? SEQUENCES.pingpong;
}

function currentColumn() {
  if (!elements.walking.checked) {
    return IDLE_COLUMN;
  }

  const sequence = currentSequence();
  const step = Math.floor(elapsed / frameDuration());
  return sequence[((step % sequence.length) + sequence.length) % sequence.length];
}

function rowForDirection(value) {
  const order = elements.rowOrder.value.split(",");
  const index = order.indexOf(value);
  return index === -1 ? 0 : index;
}

function resizeCanvas(canvas, context) {
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width * ratio));
  const height = Math.max(1, Math.round(rect.height * ratio));

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { width: rect.width, height: rect.height };
}

function paintBackground(context, width, height) {
  const fill = BACKGROUNDS[elements.background.value];

  if (fill) {
    context.fillStyle = fill;
    context.fillRect(0, 0, width, height);
    return;
  }

  const tile = 12;
  context.fillStyle = "#2a3531";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#222c28";

  for (let y = 0; y < height; y += tile) {
    for (let x = 0; x < width; x += tile) {
      if (((x / tile) + (y / tile)) % 2 === 0) {
        context.fillRect(x, y, tile, tile);
      }
    }
  }
}

function cellRect(dir, column) {
  const cellWidth = sheet.naturalWidth / COLS;
  const cellHeight = sheet.naturalHeight / ROWS;
  const row = rowForDirection(dir);
  const x = Math.round(column * cellWidth);
  const y = Math.round(row * cellHeight);

  return {
    x,
    y,
    width: Math.round((column + 1) * cellWidth) - x,
    height: Math.round((row + 1) * cellHeight) - y,
  };
}

// 1 コマを等倍のオフスクリーンへ切り出してから拡大する。
// シートを直接拡大すると、補間が隣のコマの端を拾って上下に線が出る。
function frameCanvas(dir, column) {
  const key = `${elements.rowOrder.value}:${dir}:${column}`;
  const cached = frameCache.get(key);

  if (cached) {
    return cached;
  }

  const rect = cellRect(dir, column);
  const canvas = document.createElement("canvas");
  canvas.width = rect.width;
  canvas.height = rect.height;

  const context = canvas.getContext("2d");
  context.imageSmoothingEnabled = false;
  context.drawImage(sheet, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
  frameCache.set(key, canvas);
  return canvas;
}

function drawSprite(context, dir, column, centerX, centerY, scale) {
  const frame = frameCanvas(dir, column);
  const drawWidth = Math.round(frame.width * scale);
  const drawHeight = Math.round(frame.height * scale);
  const drawX = Math.round(centerX - drawWidth / 2);
  const drawY = Math.round(centerY - drawHeight / 2);

  context.save();
  context.imageSmoothingEnabled = !elements.pixelated.checked;

  if (elements.mirror.checked) {
    context.translate(drawX + drawWidth, drawY);
    context.scale(-1, 1);
    context.drawImage(frame, 0, 0, drawWidth, drawHeight);
  } else {
    context.drawImage(frame, drawX, drawY, drawWidth, drawHeight);
  }

  context.restore();

  if (elements.grid.checked) {
    context.save();
    context.strokeStyle = "rgba(199, 243, 107, 0.85)";
    context.lineWidth = 1;
    context.strokeRect(drawX + 0.5, drawY + 0.5, drawWidth - 1, drawHeight - 1);
    context.restore();
  }
}

function fitScale(width, height, margin) {
  const scale = Math.min((width - margin) / frameWidth, (height - margin) / frameHeight);

  // ドット絵は整数倍でないとピクセルの大きさが揃わない
  return elements.pixelated.checked && scale > 1 ? Math.floor(scale) : scale;
}

function drawStage() {
  const { width, height } = resizeCanvas(elements.stage, stageContext);
  paintBackground(stageContext, width, height);

  if (!sheet) {
    return;
  }

  const zoomValue = Number(elements.zoom.value);
  const scale = zoomValue > 0 ? zoomValue : fitScale(width, height, 48);
  const drawWidth = frameWidth * scale;
  const drawHeight = frameHeight * scale;
  const rangeX = Math.max(0, (width - drawWidth) / 2);
  const rangeY = Math.max(0, (height - drawHeight) / 2);
  const offsetX = rangeX === 0 ? 0 : wrap(position.x, rangeX);
  const offsetY = rangeY === 0 ? 0 : wrap(position.y, rangeY);

  drawSprite(stageContext, direction, currentColumn(), width / 2 + offsetX, height / 2 + offsetY, scale);
}

function wrap(value, range) {
  const span = range * 2;
  return (((value + range) % span) + span) % span - range;
}

function drawStrip() {
  const column = currentColumn();

  stripContexts.forEach(({ canvas, context, direction: dir }) => {
    const { width, height } = resizeCanvas(canvas, context);
    context.clearRect(0, 0, width, height);

    if (!sheet) {
      return;
    }

    drawSprite(context, dir, column, width / 2, height / 2, fitScale(width, height, 16));
  });
}

function render(timestamp) {
  if (lastTimestamp === null) {
    lastTimestamp = timestamp;
  }

  const delta = timestamp - lastTimestamp;
  lastTimestamp = timestamp;

  if (playing) {
    elapsed += delta;

    if (elements.moving.checked && elements.walking.checked) {
      const [dx, dy] = MOVE_VECTORS[direction];
      const speed = Number(elements.fps.value) * 6;
      position.x += (dx * speed * delta) / 1000;
      position.y += (dy * speed * delta) / 1000;
    }
  }

  drawStage();
  drawStrip();
  requestAnimationFrame(render);
}

function setDirection(value) {
  direction = value;
  elements.dpadButtons.forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.dir === value));
  });
}

function setPlaying(value) {
  playing = value;
  elements.playButton.textContent = value ? "停止" : "再生";
}

function loadImage(source, label) {
  const image = new Image();

  image.onload = () => {
    sheet = image;
    frameWidth = image.naturalWidth / COLS;
    frameHeight = image.naturalHeight / ROWS;
    frameCache = new Map();
    elements.pixelated.checked = Math.max(frameWidth, frameHeight) <= PIXEL_ART_LIMIT;
    position = { x: 0, y: 0 };
    elapsed = 0;
    elements.placeholder.classList.add("hidden");
    elements.sheetInfo.classList.remove("error");
    elements.sheetInfo.textContent =
      `${label} · ${image.naturalWidth}×${image.naturalHeight} → 1コマ ${formatSize(frameWidth)}×${formatSize(frameHeight)}`;
    setPlaying(true);
  };

  image.onerror = () => {
    elements.sheetInfo.classList.add("error");
    elements.sheetInfo.textContent = `${label} を画像として読み込めませんでした`;
  };

  image.src = source;
}

function formatSize(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function handleFile(file) {
  if (!file) {
    return;
  }

  if (!file.type.startsWith("image/")) {
    elements.sheetInfo.classList.add("error");
    elements.sheetInfo.textContent = `${file.name} は画像ではありません`;
    return;
  }

  const reader = new FileReader();
  reader.onload = () => loadImage(reader.result, file.name);
  reader.readAsDataURL(file);
}

elements.openButton.addEventListener("click", () => elements.fileInput.click());
elements.placeholder.addEventListener("click", () => elements.fileInput.click());
elements.fileInput.addEventListener("change", (event) => {
  handleFile(event.target.files[0]);
  event.target.value = "";
});

elements.playButton.addEventListener("click", () => setPlaying(!playing));

["dragenter", "dragover"].forEach((type) => {
  elements.dropzone.addEventListener(type, (event) => {
    event.preventDefault();
    elements.dropzone.classList.add("dragover");
  });
});

["dragleave", "dragend"].forEach((type) => {
  elements.dropzone.addEventListener(type, () => {
    elements.dropzone.classList.remove("dragover");
  });
});

elements.dropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  elements.dropzone.classList.remove("dragover");
  handleFile(event.dataTransfer.files[0]);
});

window.addEventListener("paste", (event) => {
  const item = Array.from(event.clipboardData?.items ?? []).find((entry) =>
    entry.type.startsWith("image/"),
  );

  if (item) {
    handleFile(item.getAsFile());
  }
});

elements.dpadButtons.forEach((button) => {
  button.addEventListener("click", () => setDirection(button.dataset.dir));
});

elements.fps.addEventListener("input", () => {
  elements.fpsOut.textContent = elements.fps.value;
});

elements.zoom.addEventListener("input", () => {
  const value = Number(elements.zoom.value);
  elements.zoomOut.textContent = value > 0 ? `×${value}` : "自動";
});

window.addEventListener("keydown", (event) => {
  if (event.target.matches("input, select, textarea")) {
    return;
  }

  const next = KEY_DIRECTIONS[event.code];

  if (next) {
    event.preventDefault();
    setDirection(next);
    return;
  }

  if (event.code === "Space") {
    event.preventDefault();
    setPlaying(!playing);
  }
});

setDirection("down");
setPlaying(true);
requestAnimationFrame(render);
