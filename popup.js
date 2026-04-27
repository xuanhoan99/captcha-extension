const DEFAULTS = {
  allowedHost: "localhost",
  captchaSelector: "img.captcha",
  inputSelector: "input[name='captcha']",
  submitSelector: "form",
  captchaLength: 3,
  autoFill: true,
  autoSubmit: false,
  allowAlphanumeric: false,
  templates: []
};

const fields = {
  allowedHost: document.querySelector("#allowedHost"),
  captchaSelector: document.querySelector("#captchaSelector"),
  inputSelector: document.querySelector("#inputSelector"),
  submitSelector: document.querySelector("#submitSelector"),
  captchaLength: document.querySelector("#captchaLength"),
  autoFill: document.querySelector("#autoFill"),
  autoSubmit: document.querySelector("#autoSubmit"),
  allowAlphanumeric: document.querySelector("#allowAlphanumeric")
};

const statusEl = document.querySelector("#status");
const templatesEl = document.querySelector("#templates");
const logEl = document.querySelector("#log");

init();

async function init() {
  const settings = await chrome.storage.local.get(DEFAULTS);
  for (const [key, input] of Object.entries(fields)) {
    if (input.type === "checkbox") {
      input.checked = Boolean(settings[key]);
    } else if (input.type === "number") {
      input.value = Number.isFinite(Number(settings[key])) ? String(settings[key]) : "";
    } else {
      input.value = settings[key] || "";
    }
    input.addEventListener("change", saveSettings);
  }
  renderTemplateCount(settings.templates);

  document.querySelector("#train").addEventListener("click", train);
  document.querySelector("#run").addEventListener("click", runOnce);
  document.querySelector("#clear").addEventListener("click", clearTemplates);
  document.querySelector("#clearLog").addEventListener("click", clearLog);
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "CAPTCHA_TEST_LOG") {
      appendLog(message.level, message.message, message.details);
    }
  });
  appendLog("info", "Popup ready");
}

async function saveSettings() {
  const next = {};
  for (const [key, input] of Object.entries(fields)) {
    if (input.type === "checkbox") {
      next[key] = input.checked;
    } else if (input.type === "number") {
      next[key] = Math.max(0, Number.parseInt(input.value, 10) || 0);
    } else {
      next[key] = input.value.trim();
    }
  }
  await chrome.storage.local.set(next);
  setStatus("Saved");
}

async function train() {
  await saveSettings();
  const settings = await chrome.storage.local.get(DEFAULTS);
  const rawValue = document.querySelector("#trainingValue").value.trim();
  const value = settings.allowAlphanumeric ? rawValue.toUpperCase() : rawValue;
  const validPattern = settings.allowAlphanumeric ? /^[0-9A-Z]+$/ : /^\d+$/;

  if (!validPattern.test(value)) {
    setStatus(settings.allowAlphanumeric ? "Chỉ chữ/số" : "Chỉ nhập số");
    appendLog("warn", "Train bị hủy vì mã mẫu không đúng kiểu ký tự", {
      value: rawValue,
      allowAlphanumeric: settings.allowAlphanumeric
    });
    return;
  }
  appendLog("info", "Bắt đầu train captcha", {
    value,
    allowAlphanumeric: settings.allowAlphanumeric
  });
  const response = await sendToActiveTab({ type: "TRAIN_CAPTCHA", value });
  if (response?.ok) {
    renderTemplateCount(response.templates);
    setStatus("Trained");
    appendLog("info", "Train thành công", { totalTemplates: response.templates.length });
  } else {
    setStatus(response?.error || "Train lỗi");
    appendLog("error", "Train lỗi", response);
  }
}

async function runOnce() {
  await saveSettings();
  appendLog("info", "Bắt đầu chạy OCR");
  const response = await sendToActiveTab({ type: "RUN_CAPTCHA_TEST" });
  if (response?.ok) {
    setStatus(response.text || "Done");
    appendLog("info", "Chạy OCR xong", response);
  } else {
    setStatus(response?.error || "Lỗi");
    appendLog("error", "Chạy OCR lỗi", response);
  }
}

async function clearTemplates() {
  await chrome.storage.local.set({ templates: [] });
  renderTemplateCount([]);
  setStatus("Cleared");
  appendLog("info", "Đã xóa toàn bộ mẫu OCR");
}

async function sendToActiveTab(message) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    return { ok: false, error: "Không có tab" };
  }
  return chrome.tabs.sendMessage(tab.id, message);
}

function renderTemplateCount(templates = []) {
  templatesEl.textContent = `${templates.length} mẫu đã lưu`;
}

function setStatus(text) {
  statusEl.textContent = text;
  window.setTimeout(() => {
    statusEl.textContent = "Ready";
  }, 1800);
}

function appendLog(level, message, details = null) {
  const time = new Date().toLocaleTimeString();
  const suffix = details ? ` ${JSON.stringify(details)}` : "";
  logEl.textContent += `[${time}] ${level.toUpperCase()} ${message}${suffix}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

function clearLog() {
  logEl.textContent = "";
  appendLog("info", "Log cleared");
}
