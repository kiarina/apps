const elements = {
  form: document.querySelector("#console-form"),
  input: document.querySelector("#console-input"),
  prompt: document.querySelector("#prompt"),
  transcript: document.querySelector("#transcript"),
  statusDot: document.querySelector("#status-dot"),
  statusText: document.querySelector("#status-text"),
  clearButton: document.querySelector("#clear-button"),
  restartButton: document.querySelector("#restart-button"),
  stopButton: document.querySelector("#stop-button"),
  runButton: document.querySelector(".run-button"),
};

let worker;
let ready = false;
let busy = false;
let continuation = false;
let history = [];
let historyIndex = 0;
let draft = "";

function setStatus(kind, message) {
  elements.statusDot.className = `status-dot ${kind}`;
  elements.statusText.textContent = message;
}

function updateControls() {
  elements.input.disabled = !ready || busy;
  elements.runButton.disabled = !ready || busy;
  elements.stopButton.disabled = !busy;
  elements.restartButton.disabled = busy;
}

function scrollToLatest() {
  elements.transcript.scrollTop = elements.transcript.scrollHeight;
}

function appendSystem(message, kind = "") {
  const row = document.createElement("div");
  row.className = `system-message ${kind}`.trim();

  const mark = document.createElement("span");
  mark.className = "system-mark";
  mark.setAttribute("aria-hidden", "true");
  mark.textContent = kind === "error" ? "!" : "◇";

  const text = document.createElement("span");
  text.textContent = message;
  row.append(mark, text);
  elements.transcript.append(row);
  scrollToLatest();
}

function appendInput(source, promptText) {
  const entry = document.createElement("pre");
  entry.className = "console-entry";

  const lines = source.split("\n");
  lines.forEach((line, index) => {
    if (index > 0) {
      entry.append("\n");
    }
    const prompt = document.createElement("span");
    prompt.className = "entry-prompt";
    prompt.textContent = index === 0 ? `${promptText} ` : "... ";
    entry.append(prompt, document.createTextNode(line));
  });

  elements.transcript.append(entry);
  scrollToLatest();
}

function appendOutput(text, stream = "stdout") {
  if (!text) return;

  const previous = elements.transcript.lastElementChild;
  if (previous?.classList.contains("output") && previous.dataset.stream === stream) {
    previous.textContent += text;
  } else {
    const output = document.createElement("pre");
    output.className = `output ${stream}`;
    output.dataset.stream = stream;
    output.textContent = text;
    elements.transcript.append(output);
  }
  scrollToLatest();
}

function resizeInput() {
  elements.input.style.height = "auto";
  elements.input.style.height = `${Math.min(elements.input.scrollHeight, 152)}px`;
}

function resetInput() {
  elements.input.value = "";
  elements.input.style.height = "auto";
  historyIndex = history.length;
  draft = "";
}

function focusInput() {
  if (ready && !busy) {
    elements.input.focus({ preventScroll: true });
  }
}

function handleWorkerMessage(event) {
  const message = event.data;

  switch (message.type) {
    case "ready":
      if (message.phase === "initialized") {
        ready = true;
        busy = false;
        continuation = false;
        elements.prompt.textContent = ">>>";
        setStatus("ready", `準備完了 · Python ${message.pythonVersion}`);
        appendSystem(`Python ${message.pythonVersion} / Pyodide ${message.pyodideVersion} の準備ができました。`, "success");
        updateControls();
        focusInput();
      }
      break;

    case "output":
      appendOutput(message.text, message.stream);
      break;

    case "prompt":
      busy = false;
      continuation = message.continuation;
      elements.prompt.textContent = continuation ? "..." : ">>>";
      setStatus("ready", "準備完了");
      updateControls();
      focusInput();
      break;

    case "error":
      ready = !message.fatal;
      busy = false;
      continuation = false;
      elements.prompt.textContent = ">>>";
      setStatus("error", message.fatal ? "起動に失敗" : "実行エラー");
      appendSystem(message.message, "error");
      if (message.fatal) {
        elements.restartButton.textContent = "再試行";
      }
      updateControls();
      if (ready) focusInput();
      break;
  }
}

function startWorker({ announce = false } = {}) {
  worker?.terminate();
  worker = new Worker("./worker.js", { type: "module" });
  worker.addEventListener("message", handleWorkerMessage);
  worker.addEventListener("error", () => {
    ready = false;
    busy = false;
    setStatus("error", "Worker エラー");
    appendSystem("実行環境を起動できませんでした。ネットワーク接続を確認して再試行してください。", "error");
    elements.restartButton.textContent = "再試行";
    updateControls();
  });

  ready = false;
  busy = false;
  continuation = false;
  elements.prompt.textContent = ">>>";
  elements.restartButton.textContent = "再起動";
  setStatus("busy", "Python を起動中…");
  updateControls();
  resetInput();
  if (announce) appendSystem("新しい Python セッションを起動しています…");
  worker.postMessage({ type: "init" });
}

function executeSource(source) {
  if (!ready || busy) return;

  appendInput(source, continuation ? "..." : ">>>");
  if (source) {
    history.push(source);
  }
  resetInput();

  busy = true;
  setStatus("busy", "実行中…");
  updateControls();
  worker.postMessage({ type: "execute", source });
}

elements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  executeSource(elements.input.value.replace(/\u00a0/g, " "));
});

elements.input.addEventListener("input", resizeInput);

elements.input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    elements.form.requestSubmit();
    return;
  }

  const beforeCursor = elements.input.value.slice(0, elements.input.selectionStart);
  const afterCursor = elements.input.value.slice(elements.input.selectionEnd);
  const cursorOnFirstLine = !beforeCursor.includes("\n");
  const cursorOnLastLine = !afterCursor.includes("\n");

  if (event.key === "ArrowUp" && !event.shiftKey && cursorOnFirstLine) {
    event.preventDefault();
    if (historyIndex === history.length) draft = elements.input.value;
    if (historyIndex > 0) historyIndex -= 1;
    elements.input.value = history[historyIndex] ?? draft;
    elements.input.setSelectionRange(elements.input.value.length, elements.input.value.length);
    resizeInput();
    return;
  }

  if (event.key === "ArrowDown" && !event.shiftKey && cursorOnLastLine) {
    event.preventDefault();
    if (historyIndex < history.length) historyIndex += 1;
    elements.input.value = historyIndex === history.length ? draft : history[historyIndex] ?? "";
    elements.input.setSelectionRange(elements.input.value.length, elements.input.value.length);
    resizeInput();
  }
});

elements.clearButton.addEventListener("click", () => {
  elements.transcript.replaceChildren();
  appendSystem("出力を消去しました。セッションは継続しています。");
  focusInput();
});

elements.restartButton.addEventListener("click", () => startWorker({ announce: true }));

elements.stopButton.addEventListener("click", () => {
  if (!busy) return;
  worker.terminate();
  appendSystem("実行を停止しました。現在の変数と import 状態はリセットされます。", "error");
  startWorker({ announce: true });
});

startWorker();
