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

let watcher = null;
let watchedImage = null;
let imageLoadHandler = null;
let watchInFlight = false;
let lastCaptchaKey = "";
let lastWatchRunAt = 0;
let watchTimer = 0;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message).then(sendResponse);
  return true;
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  const watchKeys = [
    "autoWatch",
    "captchaSelector",
    "inputSelector",
    "submitSelector",
    "preClickSelector",
    "allowedHost",
    "captchaLength",
    "enabled",
    "autoFill",
    "autoSubmit",
    "submitDelayMs",
    "preClickTimeoutMs",
    "templates"
  ];
  if (watchKeys.some((key) => changes[key])) {
    setupWatcher();
  }
});

setupWatcher();

async function handleMessage(message) {
  try {
    log("info", "Nhận lệnh từ popup", { type: message.type });
    if (message.type === "TRAIN_CAPTCHA") {
      return await trainCaptcha(message.value);
    }
    if (message.type === "TRAIN_CAPTCHA_FROM_INPUT") {
      return await trainCaptchaFromInput();
    }
    if (message.type === "RUN_CAPTCHA_TEST") {
      return await runCaptchaTest();
    }
    if (message.type === "DEBUG_CAPTCHA_IMAGE") {
      return await debugCaptchaImage();
    }
    return { ok: false, error: "Lệnh không hợp lệ" };
  } catch (error) {
    log("error", "Xử lý lệnh lỗi", { message: error.message });
    return { ok: false, error: error.message };
  }
}

async function trainCaptcha(value) {
  const settings = await getSettings();
  assertEnabled(settings);
  log("info", "Bắt đầu train", {
    host: location.hostname,
    captchaSelector: settings.captchaSelector,
    preClickSelector: settings.preClickSelector,
    value,
    allowAlphanumeric: settings.allowAlphanumeric
  });
  assertAllowedHost(settings);
  await clickBeforeCaptcha(settings);
  const img = await findReadyImage(settings.captchaSelector);
  const newTemplates = await CaptchaOcr.train(img, value);
  const templates = [...settings.templates, ...newTemplates].slice(-180);
  await chrome.storage.local.set({ templates });
  log("info", "Train thành công", {
    added: newTemplates.length,
    totalTemplates: templates.length
  });
  return { ok: true, templates };
}

async function trainCaptchaFromInput() {
  const settings = await getSettings();
  assertEnabled(settings);
  assertAllowedHost(settings);
  const input = document.querySelector(settings.inputSelector);
  if (!input) throw new Error("Không tìm thấy input captcha");

  const value = String(input.value || "").trim();
  if (!/^\d{3}$/.test(value)) {
    throw new Error(`Giá trị input phải là đúng 3 chữ số, hiện tại: ${value || "(rỗng)"}`);
  }

  log("info", "Bắt đầu train từ input captcha hiện tại", {
    inputSelector: settings.inputSelector,
    captchaSelector: settings.captchaSelector,
    value
  });

  const img = await findReadyImage(settings.captchaSelector);
  const newTemplates = await CaptchaOcr.train(img, value);
  const templates = [...settings.templates, ...newTemplates].slice(-180);
  await chrome.storage.local.set({ templates });
  log("info", "Train từ input thành công", {
    value,
    added: newTemplates.length,
    totalTemplates: templates.length
  });
  return { ok: true, value, templates };
}

async function runCaptchaTest(options = {}) {
  const settings = await getSettings();
  assertEnabled(settings);
  log("info", "Bắt đầu OCR", {
    host: location.hostname,
    captchaSelector: settings.captchaSelector,
    inputSelector: settings.inputSelector,
    submitSelector: settings.submitSelector,
    preClickSelector: settings.preClickSelector,
    captchaLength: normalizeCaptchaLength(settings.captchaLength) || "auto",
    allowAlphanumeric: settings.allowAlphanumeric,
    autoFill: settings.autoFill,
    autoSubmit: settings.autoSubmit,
    submitDelayMs: normalizeDelay(settings.submitDelayMs),
    templates: settings.templates.length
  });
  assertAllowedHost(settings);
  if (!options.skipPreClick) {
    const clicked = await clickBeforeCaptcha(settings);
    if (!clicked) {
      throw new Error("Element cần click chưa sẵn sàng");
    }
  }
  const img = await findReadyImage(settings.captchaSelector);
  const text = await CaptchaOcr.recognize(img, settings.templates);
  log("info", "OCR nhận diện xong", { text });

  if (settings.autoFill) {
    const input = document.querySelector(settings.inputSelector);
    if (!input) throw new Error("Không tìm thấy input captcha");
    setNativeValue(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    log("info", "Đã điền input captcha", { text });
  }

  if (settings.autoSubmit) {
    const delayMs = normalizeDelay(settings.submitDelayMs);
    if (delayMs > 0) {
      log("info", "Đợi trước khi submit", { delayMs });
      await sleep(delayMs);
    }
    submit(settings.submitSelector);
    log("info", "Đã submit form");
  }

  return { ok: true, text };
}

async function debugCaptchaImage() {
  const settings = await getSettings();
  assertEnabled(settings);
  log("info", "Bắt đầu debug ảnh OCR", {
    captchaSelector: settings.captchaSelector,
    preClickSelector: settings.preClickSelector
  });
  assertAllowedHost(settings);

  let img = document.querySelector(settings.captchaSelector);
  if (!img && settings.preClickSelector) {
    const clicked = await clickBeforeCaptcha(settings);
    if (!clicked) {
      throw new Error("Element cần click chưa sẵn sàng");
    }
  }

  img = await findReadyImage(settings.captchaSelector);
  const debug = await CaptchaOcr.debug(img);
  log("info", "Debug ảnh OCR xong", {
    width: debug.width,
    height: debug.height,
    inkRatio: debug.inkRatio,
    segments: debug.segmentDataUrls.length
  });
  return { ok: true, debug };
}

async function getSettings() {
  return chrome.storage.local.get(DEFAULTS);
}

function assertAllowedHost(settings) {
  const allowedHost = (settings.allowedHost || "").trim();
  if (!allowedHost) {
    throw new Error("Chưa cấu hình domain test");
  }
  if (!location.hostname.includes(allowedHost)) {
    throw new Error(`Tab hiện tại không thuộc domain test: ${allowedHost}`);
  }
}

function assertEnabled(settings) {
  if (!settings.enabled) {
    throw new Error("Extension đang tắt");
  }
}

async function findReadyImage(selector) {
  const img = await waitForElement(selector, 6000);
  if (!img) throw new Error("Không tìm thấy ảnh captcha");
  if (img.complete && img.naturalWidth > 0) {
    log("info", "Ảnh captcha đã sẵn sàng", {
      width: img.naturalWidth,
      height: img.naturalHeight,
      src: safeImageSource(img)
    });
    return img;
  }

  await new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("Ảnh captcha chưa load xong")), 4000);
    img.addEventListener("load", () => {
      window.clearTimeout(timeout);
      resolve();
    }, { once: true });
  });
  log("info", "Ảnh captcha load xong", {
    width: img.naturalWidth,
    height: img.naturalHeight,
    src: safeImageSource(img)
  });
  return img;
}

async function waitForElement(selector, timeoutMs) {
  const existing = document.querySelector(selector);
  if (existing) return existing;

  log("info", "Đang chờ element xuất hiện", { selector, timeoutMs });
  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => done(null), timeoutMs);
    const observer = new MutationObserver(() => {
      const element = document.querySelector(selector);
      if (element) {
        done(element);
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src", "alt", "class"]
    });

    function done(element) {
      window.clearTimeout(timeout);
      observer.disconnect();
      resolve(element);
    }
  });
}

function setNativeValue(element, value) {
  const prototype = Object.getPrototypeOf(element);
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
  if (descriptor?.set) {
    descriptor.set.call(element, value);
  } else {
    element.value = value;
  }
}

function submit(selector) {
  const target = document.querySelector(selector);
  if (!target) throw new Error("Không tìm thấy form/nút submit");

  if (target instanceof HTMLFormElement) {
    target.requestSubmit();
    return;
  }

  target.click();
}

function normalizeCaptchaLength(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

async function setupWatcher() {
  stopWatcher();
  const settings = await getSettings();
  if (!settings.enabled) {
    log("info", "Extension đang tắt, auto watch không chạy");
    return;
  }
  if (!settings.autoWatch) {
    log("info", "Auto watch đang tắt");
    return;
  }

  try {
    assertAllowedHost(settings);
  } catch (error) {
    log("warn", "Auto watch không chạy vì sai domain", { message: error.message });
    return;
  }

  watcher = new MutationObserver(() => {
    bindWatchedImage(settings.captchaSelector);
    scheduleWatchRun("dom-change");
  });
  watcher.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["src", "style", "class", "alt"]
  });

  bindWatchedImage(settings.captchaSelector);
  scheduleWatchRun("watch-start", { force: true });
  log("info", "Auto watch đã bật", { captchaSelector: settings.captchaSelector });
}

function stopWatcher() {
  if (watcher) {
    watcher.disconnect();
    watcher = null;
  }
  if (watchedImage && imageLoadHandler) {
    watchedImage.removeEventListener("load", imageLoadHandler);
  }
  if (watchTimer) {
    window.clearTimeout(watchTimer);
    watchTimer = 0;
  }
  watchedImage = null;
  imageLoadHandler = null;
  watchInFlight = false;
}

function bindWatchedImage(selector) {
  const img = document.querySelector(selector);
  if (!img || img === watchedImage) return;

  if (watchedImage && imageLoadHandler) {
    watchedImage.removeEventListener("load", imageLoadHandler);
  }

  watchedImage = img;
  imageLoadHandler = () => scheduleWatchRun("image-load", { force: true });
  watchedImage.addEventListener("load", imageLoadHandler);
  log("info", "Đã bind ảnh captcha để theo dõi", { src: safeImageSource(img) });
}

function scheduleWatchRun(reason, options = {}) {
  if (watchTimer) {
    window.clearTimeout(watchTimer);
  }
  watchTimer = window.setTimeout(() => {
    watchTimer = 0;
    runWatchedCaptcha(reason, options);
  }, options.force ? 120 : 350);
}

async function runWatchedCaptcha(reason, options = {}) {
  if (watchInFlight) {
    log("info", "Auto watch bỏ qua vì OCR đang chạy", { reason });
    return;
  }
  if (!options.force && Date.now() - lastWatchRunAt < 1200) {
    log("info", "Auto watch bỏ qua vì cooldown", { reason });
    return;
  }

  watchInFlight = true;
  try {
    const settings = await getSettings();
    if (!settings.enabled) {
      log("info", "Auto watch bỏ qua vì extension đang tắt", { reason });
      return;
    }
    if (!settings.autoWatch) return;
    assertAllowedHost(settings);

    const clicked = await clickBeforeCaptcha(settings, { skipWhenDisabled: true });
    if (!clicked) {
      log("info", "Auto watch bỏ qua vì nút click trước đang disabled", {
        selector: settings.preClickSelector
      });
      return;
    }
    const img = await findReadyImage(settings.captchaSelector);
    const captchaKey = getCaptchaKey(img);
    if (!options.force && captchaKey === lastCaptchaKey) {
      log("info", "Auto watch bỏ qua vì captcha chưa đổi", { reason, captchaKey });
      return;
    }

    lastWatchRunAt = Date.now();
    log("info", "Auto watch phát hiện captcha", { reason });
    await runCaptchaTest({ skipPreClick: true });
    lastCaptchaKey = captchaKey;
  } catch (error) {
    log("error", "Auto watch lỗi", { message: error.message, reason });
  } finally {
    watchInFlight = false;
  }
}

function normalizeDelay(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

async function clickBeforeCaptcha(settings, options = {}) {
  const selector = (settings.preClickSelector || "").trim();
  if (!selector) return true;

  const timeoutMs = normalizeDelay(settings.preClickTimeoutMs) || 10000;
  log("info", "Chuẩn bị click trước khi OCR", { selector, timeoutMs });
  const target = await waitForClickable(selector, timeoutMs, options);
  if (!target) return false;
  target.scrollIntoView({ block: "center", inline: "center" });
  if (typeof target.focus === "function") {
    target.focus({ preventScroll: true });
  }
  target.click();
  log("info", "Đã click trước khi OCR", { selector });
  return true;
}

async function waitForClickable(selector, timeoutMs, options = {}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    const target = document.querySelector(selector);
    if (!target) {
      await sleep(250);
      continue;
    }

    if (!isDisabled(target)) {
      return target;
    }

    if (options.skipWhenDisabled) {
      return null;
    }

    const remainingMs = Math.max(0, timeoutMs - (Date.now() - startedAt));
    log("info", "Element cần click đang disabled, tiếp tục chờ", {
      selector,
      remainingMs
    });
    await waitForEnabledOrTimeout(target, Math.min(1000, remainingMs));
  }

  throw new Error(`Element cần click chưa sẵn sàng: ${selector}`);
}

function waitForEnabledOrTimeout(target, timeoutMs) {
  if (timeoutMs <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = window.setTimeout(done, timeoutMs);
    const observer = new MutationObserver(() => {
      if (!isDisabled(target)) {
        done();
      }
    });

    observer.observe(target, {
      attributes: true,
      attributeFilter: ["disabled", "class", "aria-disabled"]
    });

    function done() {
      window.clearTimeout(timeout);
      observer.disconnect();
      resolve();
    }
  });
}

function isDisabled(element) {
  return Boolean(
    element.disabled ||
    element.getAttribute("aria-disabled") === "true" ||
    element.classList.contains("disabled")
  );
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function log(level, message, details = null) {
  const payload = {
    type: "CAPTCHA_TEST_LOG",
    level,
    message,
    details
  };
  console[level === "error" ? "error" : "log"]("[CaptchaTest]", message, details || "");
  chrome.runtime.sendMessage(payload).catch(() => {});
}

function safeImageSource(img) {
  const src = img.currentSrc || img.src || "";
  if (src.startsWith("data:")) return "data:image";
  return src.slice(0, 160);
}

function getCaptchaKey(img) {
  const fingerprint = fingerprintImage(img);
  return `${safeImageSource(img)}:${img.naturalWidth}x${img.naturalHeight}:${fingerprint}`;
}

function fingerprintImage(img) {
  try {
    const canvas = document.createElement("canvas");
    const width = 24;
    const height = 10;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, width, height);
    const { data } = ctx.getImageData(0, 0, width, height);
    let hash = 2166136261;

    for (let i = 0; i < data.length; i += 4) {
      const gray = Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
      hash ^= gray;
      hash = Math.imul(hash, 16777619);
    }

    return (hash >>> 0).toString(16);
  } catch (error) {
    return `${Date.now()}`;
  }
}
