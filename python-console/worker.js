import { loadPyodide } from "https://cdn.jsdelivr.net/pyodide/v314.0.6/full/pyodide.mjs";

const PYODIDE_INDEX_URL = "https://cdn.jsdelivr.net/pyodide/v314.0.6/full/";

let pyodide;
let consoleProxy;
let awaitFuture;
let reprShorten;
let initialized = false;
let executing = false;

function post(type, detail = {}) {
  self.postMessage({ type, ...detail });
}

function readableError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/fetch|network|failed to load|importing a module/i.test(message)) {
    return "Python 実行環境をダウンロードできませんでした。ネットワーク接続を確認して再試行してください。";
  }
  return `Python 実行環境の起動に失敗しました: ${message}`;
}

async function initialize() {
  if (initialized) return;

  try {
    pyodide = await loadPyodide({ indexURL: PYODIDE_INDEX_URL });

    pyodide.globals.set("__write_stdout", (text) => {
      post("output", { stream: "stdout", text });
    });
    pyodide.globals.set("__write_stderr", (text) => {
      post("output", { stream: "stderr", text });
    });

    pyodide.runPython(`
from pyodide.console import PyodideConsole
from pyodide.ffi import to_js
import builtins
import platform

def __unsupported_stdin(_size=-1):
    raise RuntimeError(
        "input() is not supported in this Web Worker console. "
        "Assign a value directly instead."
    )

__kiarina_console = PyodideConsole(
    globals(),
    stdin_callback=__unsupported_stdin,
    stdout_callback=__write_stdout,
    stderr_callback=__write_stderr,
)

async def __await_console_future(future):
    result = await future
    if result is not None:
        builtins._ = result
    return to_js([result], depth=1)

__python_version = platform.python_version()
`);

    consoleProxy = pyodide.globals.get("__kiarina_console");
    awaitFuture = pyodide.globals.get("__await_console_future");
    reprShorten = pyodide.pyimport("pyodide.console").repr_shorten;
    const pythonVersion = pyodide.globals.get("__python_version");
    initialized = true;
    post("ready", {
      phase: "initialized",
      pythonVersion,
      pyodideVersion: pyodide.version,
    });
  } catch (error) {
    post("error", { fatal: true, message: readableError(error) });
  }
}

async function execute(source) {
  if (!initialized || executing) return;
  executing = true;

  let future;
  let wrapped;
  let continuation = false;
  try {
    future = consoleProxy.push(source);
    continuation = future.syntax_check === "incomplete";

    if (future.syntax_check === "complete") {
      wrapped = awaitFuture(future);
      const [value] = await wrapped;
      if (value !== undefined) {
        const rendered = reprShorten.callKwargs(value, {
          separator: "\n<long output truncated>\n",
        });
        post("output", { stream: "stdout", text: `${rendered}\n` });
      }
      if (value instanceof pyodide.ffi.PyProxy) {
        value.destroy();
      }
    } else if (future.syntax_check === "syntax-error") {
      post("output", {
        stream: "stderr",
        text: future.formatted_error || "SyntaxError\n",
      });
    }
  } catch (error) {
    const formatted = future?.formatted_error;
    post("output", {
      stream: "stderr",
      text: formatted || `${error instanceof Error ? error.message : String(error)}\n`,
    });
  } finally {
    wrapped?.destroy();
    future?.destroy();
    executing = false;
    post("prompt", { continuation });
    post("ready", { phase: "execution" });
  }
}

self.addEventListener("message", (event) => {
  const message = event.data;
  if (message?.type === "init") {
    void initialize();
  } else if (message?.type === "execute") {
    void execute(message.source ?? "");
  }
});
