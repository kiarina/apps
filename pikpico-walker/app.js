const COLS = 3;
const ROWS = 4;
const IDLE_COLUMN = 1;
const PIXEL_ART_LIMIT = 96;
const SAMPLE_URL = new URL("./sample.png", import.meta.url).href;

const TEXT = {
  ja: {
    play: "再生",
    pause: "停止",
    autoZoom: "自動",
    frame: "1コマ",
    layerCount: (count) => `${count} レイヤー`,
    pasted: (index) => `貼り付け ${index}`,
    show: (name) => `${name} を表示`,
    raise: (name) => `${name} を手前へ`,
    lower: (name) => `${name} を奥へ`,
    remove: (name) => `${name} を消す`,
    unreadable: (name) => `${name} を画像として読み込めませんでした`,
    notImage: (name) => `${name} は画像ではありません`,
  },
  en: {
    play: "Play",
    pause: "Pause",
    autoZoom: "Auto",
    frame: "frame",
    layerCount: (count) => `${count} layers`,
    pasted: (index) => `Pasted ${index}`,
    show: (name) => `Show ${name}`,
    raise: (name) => `Move ${name} forward`,
    lower: (name) => `Move ${name} back`,
    remove: (name) => `Remove ${name}`,
    unreadable: (name) => `Could not read ${name} as an image`,
    notImage: (name) => `${name} is not an image`,
  },
}[document.documentElement.lang === "en" ? "en" : "ja"];

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
  mini: document.querySelector("#mini"),
  placeholder: document.querySelector("#placeholder"),
  sampleButton: document.querySelector("#sample-button"),
  sheetInfo: document.querySelector("#sheet-info"),
  layerPanel: document.querySelector("#layer-panel"),
  layerList: document.querySelector("#layer-list"),
  clearLayers: document.querySelector("#clear-layers"),
  fileInput: document.querySelector("#file-input"),
  openButton: document.querySelector("#open-button"),
  addButton: document.querySelector("#add-button"),
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
const miniContext = elements.mini.getContext("2d");
const stripContexts = elements.stripCanvases.map((canvas) => ({
  canvas,
  context: canvas.getContext("2d"),
  direction: canvas.dataset.dir,
}));

// 配列の先頭が一番奥のレイヤー
let layers = [];
let selectedLayer = null;
let addOnOpen = false;
let pasteCount = 0;
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

function cellRect(image, dir, column) {
  const cellWidth = image.naturalWidth / COLS;
  const cellHeight = image.naturalHeight / ROWS;
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

  const base = cellRect(largestLayer().image, dir, column);
  const canvas = document.createElement("canvas");
  canvas.width = base.width;
  canvas.height = base.height;

  const context = canvas.getContext("2d");
  context.imageSmoothingEnabled = false;

  // 大きさの違うレイヤーは、一番大きいレイヤーの 1 コマに合わせて重ねる
  layers.filter((layer) => layer.visible).forEach((layer) => {
    const rect = cellRect(layer.image, dir, column);
    context.drawImage(layer.image, rect.x, rect.y, rect.width, rect.height, 0, 0, base.width, base.height);
  });

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
  const ratio = window.devicePixelRatio || 1;

  // ドット絵は物理ピクセルの整数倍でないとピクセルの大きさが揃わない
  return elements.pixelated.checked && scale * ratio > 1 ? Math.floor(scale * ratio) / ratio : scale;
}

function drawStage() {
  const { width, height } = resizeCanvas(elements.stage, stageContext);
  paintBackground(stageContext, width, height);

  if (layers.length === 0) {
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

    if (layers.length === 0) {
      return;
    }

    drawSprite(context, dir, column, width / 2, height / 2, fitScale(width, height, 16));
  });
}

function drawMini() {
  if (layers.length === 0) {
    return;
  }

  const { width, height } = resizeCanvas(elements.mini, miniContext);
  paintBackground(miniContext, width, height);
  // 小窓は枠いっぱいに見せたいので、ドット絵でも整数倍に丸めない
  const scale = Math.min(width / frameWidth, height / frameHeight);
  drawSprite(miniContext, direction, currentColumn(), width / 2, height / 2, scale);
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
  drawMini();
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
  elements.playButton.textContent = value ? TEXT.pause : TEXT.play;
}

function largestLayer() {
  return layers.reduce((largest, layer) =>
    layer.image.naturalWidth * layer.image.naturalHeight >
    largest.image.naturalWidth * largest.image.naturalHeight
      ? layer
      : largest,
  );
}

function showError(message) {
  elements.sheetInfo.classList.add("error");
  elements.sheetInfo.textContent = message;
}

function layerButton(label, ariaLabel, disabled, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "layer-button";
  button.textContent = label;
  button.disabled = disabled;
  button.setAttribute("aria-label", ariaLabel);
  button.addEventListener("click", onClick);
  return button;
}

function moveLayer(index, offset) {
  const [layer] = layers.splice(index, 1);
  layers.splice(index + offset, 0, layer);
  updateLayers();
}

function layerRow(layer, index) {
  const row = document.createElement("li");
  row.className = "layer-item";
  row.classList.toggle("selected", layer === selectedLayer);
  row.addEventListener("click", (event) => {
    if (!event.target.closest("input, .layer-button")) {
      selectedLayer = layer;
      updateLayers();
    }
  });

  const visible = document.createElement("input");
  visible.type = "checkbox";
  visible.checked = layer.visible;
  visible.setAttribute("aria-label", TEXT.show(layer.name));
  visible.addEventListener("change", () => {
    layer.visible = visible.checked;
    frameCache = new Map();
  });

  const thumbnail = document.createElement("img");
  thumbnail.className = "layer-thumbnail";
  thumbnail.src = layer.image.src;
  thumbnail.alt = "";

  const name = document.createElement("button");
  name.type = "button";
  name.className = "layer-name";
  name.textContent = layer.name;
  name.setAttribute("aria-pressed", String(layer === selectedLayer));

  const size = document.createElement("span");
  size.className = "layer-size";
  size.textContent = `${layer.image.naturalWidth}×${layer.image.naturalHeight}`;

  row.append(
    visible,
    thumbnail,
    name,
    size,
    layerButton("▲", TEXT.raise(layer.name), index === layers.length - 1, () => moveLayer(index, 1)),
    layerButton("▼", TEXT.lower(layer.name), index === 0, () => moveLayer(index, -1)),
    layerButton("×", TEXT.remove(layer.name), false, () => {
      layers.splice(index, 1);

      if (layer === selectedLayer) {
        selectedLayer = layers[Math.min(index, layers.length - 1)] ?? null;
      }

      updateLayers();
    }),
  );
  return row;
}

function updateLayers() {
  const empty = layers.length === 0;

  frameCache = new Map();
  elements.placeholder.classList.toggle("hidden", !empty);
  elements.mini.classList.toggle("hidden", empty);
  elements.layerPanel.classList.toggle("hidden", empty);
  elements.sheetInfo.classList.remove("error");
  elements.sheetInfo.textContent = "";

  // 一覧は手前のレイヤーを上に並べる
  elements.layerList.replaceChildren(
    ...layers.map((layer, index) => layerRow(layer, index)).reverse(),
  );

  if (empty) {
    return;
  }

  const { image } = largestLayer();
  const label = layers.length === 1 ? layers[0].name : TEXT.layerCount(layers.length);
  frameWidth = image.naturalWidth / COLS;
  frameHeight = image.naturalHeight / ROWS;
  elements.sheetInfo.textContent =
    `${label} · ${image.naturalWidth}×${image.naturalHeight} → ${TEXT.frame} ${formatSize(frameWidth)}×${formatSize(frameHeight)}`;
}

function readImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = source;
  });
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function addLayers(entries) {
  const wasEmpty = layers.length === 0;
  let failed = null;

  for (const { source, name } of entries) {
    try {
      const image = await readImage(source);
      const existing = layers.find((layer) => layer.name === name);

      // まとめて入れた中の同じ名前のファイルは、描き直した版として位置を保って差し替える
      if (existing) {
        existing.image = image;
        selectedLayer = existing;
      } else {
        selectedLayer = { name, image, visible: true };
        layers.push(selectedLayer);
      }
    } catch {
      failed = name;
    }
  }

  updateLayers();

  if (wasEmpty && layers.length > 0) {
    elements.pixelated.checked = Math.max(frameWidth, frameHeight) <= PIXEL_ART_LIMIT;
    position = { x: 0, y: 0 };
    elapsed = 0;
    setPlaying(true);
  }

  if (failed !== null) {
    showError(TEXT.unreadable(failed));
  }
}

function formatSize(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

async function replaceSelectedLayer({ source, name }) {
  try {
    selectedLayer.image = await readImage(source);
    selectedLayer.name = name;
    selectedLayer.visible = true;
    updateLayers();
  } catch {
    showError(TEXT.unreadable(name));
  }
}

async function handleFiles(files, { pasted = false, add = false } = {}) {
  const images = files
    .filter((file) => file.type.startsWith("image/"))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const rejected = files.find((file) => !file.type.startsWith("image/"));

  if (images.length > 0) {
    const entries = [];

    for (const file of images) {
      pasteCount += pasted ? 1 : 0;
      entries.push({
        source: await readFile(file),
        name: pasted ? TEXT.pasted(pasteCount) : file.name,
      });
    }

    if (!add && entries.length === 1 && selectedLayer) {
      await replaceSelectedLayer(entries[0]);
    } else {
      await addLayers(entries);
    }
  }

  if (rejected) {
    showError(TEXT.notImage(rejected.name));
  }
}

function openFilePicker(add) {
  addOnOpen = add;
  elements.fileInput.click();
}

elements.openButton.addEventListener("click", () => openFilePicker(false));
elements.addButton.addEventListener("click", () => openFilePicker(true));
elements.placeholder.addEventListener("click", () => openFilePicker(false));
elements.sampleButton.addEventListener("click", (event) => {
  event.stopPropagation();
  addLayers([{ source: SAMPLE_URL, name: "sample.png" }]);
});
elements.fileInput.addEventListener("change", (event) => {
  handleFiles(Array.from(event.target.files), { add: addOnOpen });
  event.target.value = "";
});

elements.clearLayers.addEventListener("click", () => {
  layers = [];
  selectedLayer = null;
  updateLayers();
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
  handleFiles(Array.from(event.dataTransfer.files));
});

window.addEventListener("paste", (event) => {
  // 1 枚の画像が PNG と TIFF のように複数の形で入っていることがあるので、最初の 1 つだけ読む
  const item = Array.from(event.clipboardData?.items ?? []).find((entry) =>
    entry.type.startsWith("image/"),
  );

  if (item) {
    handleFiles([item.getAsFile()], { pasted: true });
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
  elements.zoomOut.textContent = value > 0 ? `×${value}` : TEXT.autoZoom;
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
