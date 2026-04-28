const DEFAULTS = CaptchaDefaults;
const OCR_TEMPLATE_VERSION = 7;

const fields = {
  allowedHost: document.querySelector("#allowedHost"),
  captchaSelector: document.querySelector("#captchaSelector"),
  inputSelector: document.querySelector("#inputSelector"),
  submitSelector: document.querySelector("#submitSelector"),
  fallbackSubmitSelector: document.querySelector("#fallbackSubmitSelector"),
  preClickSelector: document.querySelector("#preClickSelector"),
  enabled: document.querySelector("#enabled"),
  autoFill: document.querySelector("#autoFill"),
  autoSubmit: document.querySelector("#autoSubmit"),
  autoWatch: document.querySelector("#autoWatch"),
  targetTabOnly: document.querySelector("#targetTabOnly"),
  submitDelayMs: document.querySelector("#submitDelayMs"),
  preClickTimeoutMs: document.querySelector("#preClickTimeoutMs"),
  maxTemplates: document.querySelector("#maxTemplates")
};

const statusEl = document.querySelector("#status");
const templatesEl = document.querySelector("#templates");
const logEl = document.querySelector("#log");
const templateCountsEl = document.querySelector("#templateCounts");
const templateJsonEl = document.querySelector("#templateJson");
const templateFileEl = document.querySelector("#templateFile");

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

  document.querySelector("#trainFromInput").addEventListener("click", trainFromInput);
  document.querySelector("#run").addEventListener("click", runOnce);
  document.querySelector("#clear").addEventListener("click", clearTemplates);
  document.querySelector("#openPanel").addEventListener("click", openPanel);
  document.querySelector("#exportTemplates").addEventListener("click", exportTemplates);
  document.querySelector("#chooseTemplateFile").addEventListener("click", chooseTemplateFile);
  document.querySelector("#importTemplates").addEventListener("click", importTemplates);
  templateFileEl.addEventListener("change", readTemplateFile);
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
  const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  const filename = `captcha-templates-v${OCR_TEMPLATE_VERSION}-${formatDateForFile(new Date())}.json`;
  await chrome.downloads.download({ url, filename, saveAs: true });
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
  setStatus("Exported");
  appendLog("info", "Đã export mẫu train", {
    totalTemplates: templates.length,
    ocrVersion: OCR_TEMPLATE_VERSION,
    filename
  });
}

function chooseTemplateFile() {
  templateFileEl.click();
}

async function readTemplateFile() {
  const [file] = templateFileEl.files || [];
  if (!file) return;

  try {
    templateJsonEl.value = await file.text();
    setStatus("File loaded");
    appendLog("info", "Đã đọc file JSON mẫu", {
      name: file.name,
      size: file.size
    });
  } catch (error) {
    setStatus("Đọc file lỗi");
    appendLog("error", "Đọc file JSON lỗi", { message: error.message });
  }
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

    const settings = await chrome.storage.local.get(DEFAULTS);
    const balanced = balanceTemplates(validTemplates, settings.maxTemplates);
    await chrome.storage.local.set({ templates: balanced });
    renderTemplateCount(balanced);
    setStatus("Imported");
    appendLog("info", "Import mẫu train thành công", {
      imported: validTemplates.length,
      kept: balanced.length,
      skipped: templates.length - validTemplates.length
    });
  } catch (error) {
    setStatus("Import lỗi");
    appendLog("error", "Import mẫu train lỗi", { message: error.message });
  }
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

function balanceTemplates(templates, maxTemplates = 400) {
  const maxPerDigit = Math.max(1, Math.floor((Number(maxTemplates) || 400) / 10));
  const buckets = Object.fromEntries(Array.from({ length: 10 }, (_, digit) => [String(digit), []]));

  for (const template of templates) {
    if (buckets[template.digit]) {
      buckets[template.digit].push(template);
    }
  }

  return Object.values(buckets).flatMap((bucket) => {
    return bucket
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .slice(0, maxPerDigit)
      .reverse();
  });
}

function formatDateForFile(date) {
  return date.toISOString().replace(/[:.]/g, "-");
}
