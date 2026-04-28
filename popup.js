const DEFAULTS = {
  allowedHost: "localhost",
  captchaSelector: "img.captcha",
  inputSelector: "input[name='captcha']",
  submitSelector: "form",
  preClickSelector: "",
  captchaLength: 3,
  enabled: true,
  autoFill: true,
  autoSubmit: false,
  allowAlphanumeric: false,
  autoWatch: false,
  submitDelayMs: 0,
  preClickTimeoutMs: 10000,
  templates: []
};
const OCR_TEMPLATE_VERSION = 7;

const fields = {
  allowedHost: document.querySelector("#allowedHost"),
  captchaSelector: document.querySelector("#captchaSelector"),
  inputSelector: document.querySelector("#inputSelector"),
  submitSelector: document.querySelector("#submitSelector"),
  preClickSelector: document.querySelector("#preClickSelector"),
  captchaLength: document.querySelector("#captchaLength"),
  enabled: document.querySelector("#enabled"),
  autoFill: document.querySelector("#autoFill"),
  autoSubmit: document.querySelector("#autoSubmit"),
  allowAlphanumeric: document.querySelector("#allowAlphanumeric"),
  autoWatch: document.querySelector("#autoWatch"),
  submitDelayMs: document.querySelector("#submitDelayMs"),
  preClickTimeoutMs: document.querySelector("#preClickTimeoutMs")
};

const statusEl = document.querySelector("#status");
const templatesEl = document.querySelector("#templates");
const logEl = document.querySelector("#log");
const debugInfoEl = document.querySelector("#debugInfo");
const debugMaskEl = document.querySelector("#debugMask");
const debugSegmentsEl = document.querySelector("#debugSegments");
const templateCountsEl = document.querySelector("#templateCounts");
const templateJsonEl = document.querySelector("#templateJson");

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
  document.querySelector("#trainFromInput").addEventListener("click", trainFromInput);
  document.querySelector("#run").addEventListener("click", runOnce);
  document.querySelector("#clear").addEventListener("click", clearTemplates);
  document.querySelector("#debug").addEventListener("click", debugOcr);
  document.querySelector("#openPanel").addEventListener("click", openPanel);
  document.querySelector("#exportTemplates").addEventListener("click", exportTemplates);
  document.querySelector("#importTemplates").addEventListener("click", importTemplates);
  document.querySelector("#clearLog").addEventListener("click", clearLog);
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "CAPTCHA_TEST_LOG") {
      appendLog(message.level, message.message, message.details);
    }
  });
  appendLog("info", "Popup ready");
}

function isPanelMode() {
  return new URLSearchParams(location.search).get("panel") === "1";
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

async function openPanel() {
  await saveSettings();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    await chrome.storage.local.set({ targetTabId: tab.id });
  }
  await chrome.tabs.create({ url: chrome.runtime.getURL("popup.html?panel=1") });
}

async function train() {
  await saveSettings();
  const rawValue = document.querySelector("#trainingValue").value.trim();
  const value = rawValue;

  if (!/^\d{3}$/.test(value)) {
    setStatus("Nhập 3 số");
    appendLog("warn", "Train bị hủy vì OCR tối ưu chỉ nhận đúng 3 chữ số", { value: rawValue });
    return;
  }
  appendLog("info", "Bắt đầu train captcha", {
    value,
    mode: "3-digit-only"
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

async function trainFromInput() {
  await saveSettings();
  appendLog("info", "Bắt đầu train từ input trên trang");
  const response = await sendToActiveTab({ type: "TRAIN_CAPTCHA_FROM_INPUT" });
  if (response?.ok) {
    renderTemplateCount(response.templates);
    setStatus("Trained");
    appendLog("info", "Train từ input thành công", {
      value: response.value,
      totalTemplates: response.templates.length
    });
  } else {
    setStatus(response?.error || "Train lỗi");
    appendLog("error", "Train từ input lỗi", response);
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

async function exportTemplates() {
  const { templates } = await chrome.storage.local.get({ templates: [] });
  const payload = {
    schema: "captcha-helper-templates",
    ocrVersion: OCR_TEMPLATE_VERSION,
    exportedAt: new Date().toISOString(),
    templates
  };
  const json = JSON.stringify(payload, null, 2);
  templateJsonEl.value = json;
  await navigator.clipboard.writeText(json).catch(() => {});
  setStatus("Exported");
  appendLog("info", "Đã export mẫu train", {
    totalTemplates: templates.length,
    ocrVersion: OCR_TEMPLATE_VERSION
  });
}

async function importTemplates() {
  const raw = templateJsonEl.value.trim();
  if (!raw) {
    setStatus("Thiếu JSON");
    appendLog("warn", "Import bị hủy vì textarea trống");
    return;
  }

  try {
    const parsed = JSON.parse(raw);
    const templates = Array.isArray(parsed) ? parsed : parsed.templates;
    if (!Array.isArray(templates)) {
      throw new Error("JSON không có mảng templates");
    }

    const validTemplates = templates.filter(isValidTemplate);
    if (!validTemplates.length) {
      throw new Error(`Không có mẫu hợp lệ cho OCR version ${OCR_TEMPLATE_VERSION}`);
    }

    await chrome.storage.local.set({ templates: validTemplates.slice(-180) });
    renderTemplateCount(validTemplates.slice(-180));
    setStatus("Imported");
    appendLog("info", "Import mẫu train thành công", {
      imported: validTemplates.length,
      kept: Math.min(validTemplates.length, 180),
      skipped: templates.length - validTemplates.length
    });
  } catch (error) {
    setStatus("Import lỗi");
    appendLog("error", "Import mẫu train lỗi", { message: error.message });
  }
}

async function debugOcr() {
  await saveSettings();
  appendLog("info", "Bắt đầu lấy preview OCR");
  const response = await sendToActiveTab({ type: "DEBUG_CAPTCHA_IMAGE" });
  if (!response?.ok) {
    setStatus(response?.error || "Debug lỗi");
    appendLog("error", "Debug OCR lỗi", response);
    return;
  }

  renderDebugPreview(response.debug);
  setStatus("Debug done");
  appendLog("info", "Debug OCR xong", {
    width: response.debug.width,
    height: response.debug.height,
    inkRatio: response.debug.inkRatio
  });
}

async function sendToActiveTab(message) {
  if (isPanelMode()) {
    const { targetTabId } = await chrome.storage.local.get({ targetTabId: null });
    if (targetTabId) {
      try {
        return await chrome.tabs.sendMessage(targetTabId, message);
      } catch (error) {
        return { ok: false, error: "Tab captcha cũ không còn nhận message. Mở popup từ tab captcha rồi bấm Open Panel lại." };
      }
    }
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    return { ok: false, error: "Không có tab" };
  }
  return chrome.tabs.sendMessage(tab.id, message);
}

function renderTemplateCount(templates = []) {
  const usableTemplates = templates.filter((template) => template.version === OCR_TEMPLATE_VERSION);
  const covered = [...new Set(usableTemplates.map((template) => template.digit))].sort().join("");
  templatesEl.textContent = `${usableTemplates.length} mẫu OCR mới / ${templates.length} tổng | đã có: ${covered || "chưa có"}`;
  renderDigitCounts(usableTemplates);
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

function renderDebugPreview(debug) {
  debugInfoEl.textContent = `${debug.width}x${debug.height} | ink ${debug.inkRatio}%`;
  debugMaskEl.src = debug.maskDataUrl;
  debugMaskEl.style.display = "block";
  debugSegmentsEl.textContent = "";

  for (const [index, dataUrl] of debug.segmentDataUrls.entries()) {
    const img = document.createElement("img");
    img.src = dataUrl;
    img.alt = `OCR segment ${index + 1}`;
    debugSegmentsEl.appendChild(img);
  }
}

function renderDigitCounts(templates) {
  const counts = Object.fromEntries(Array.from({ length: 10 }, (_, digit) => [String(digit), 0]));
  for (const template of templates) {
    if (counts[template.digit] !== undefined) {
      counts[template.digit]++;
    }
  }

  templateCountsEl.textContent = "";
  for (const digit of Object.keys(counts)) {
    const item = document.createElement("div");
    item.className = `digit-count${counts[digit] < 2 ? " low" : ""}`;
    item.innerHTML = `<span>${digit}</span><span>${counts[digit]}</span>`;
    templateCountsEl.appendChild(item);
  }
}

function isValidTemplate(template) {
  return Boolean(
    template &&
    template.version === OCR_TEMPLATE_VERSION &&
    /^\d$/.test(template.digit) &&
    typeof template.pattern === "string" &&
    template.pattern.length > 0 &&
    Array.isArray(template.vector) &&
    template.features
  );
}
