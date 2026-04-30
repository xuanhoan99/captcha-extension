const DEFAULTS = CaptchaDefaults;

let watcher = null;
let watchedImage = null;
let imageLoadHandler = null;
let watchInFlight = false;
let lastCaptchaKey = "";
let lastWatchRunAt = 0;
let watchTimer = 0;
let missingCaptchaRetries = 0;

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
    "fallbackSubmitSelector",
    "preClickSelector",
    "allowedHost",
    "enabled",
    "targetTabOnly",
    "autoFill",
    "autoSubmit",
    "submitDelayMs",
    "preClickTimeoutMs",
    "maxTemplates",
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
    if (message.type === "TRAIN_CAPTCHA_FROM_INPUT") {
      return await trainCaptchaFromInput();
    }
    if (message.type === "RUN_CAPTCHA_TEST") {
      return await runCaptchaTest();
    }
    return { ok: false, error: "Lệnh không hợp lệ" };
  } catch (error) {
    log("error", "Xử lý lệnh lỗi", { message: error.message });
    return { ok: false, error: error.message };
  }
}

async function trainCaptchaFromInput() {
  return withTrainLock(async () => {
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
    const latest = await getSettings();
    const templates = balanceTemplates([...latest.templates, ...newTemplates], latest.maxTemplates);
    await chrome.storage.local.set({ templates });
    log("info", "Train từ input thành công", {
      value,
      added: newTemplates.length,
      totalTemplates: templates.length
    });
    return { ok: true, value, templates };
  });
}

async function runCaptchaTest(options = {}) {
  const settings = await getSettings();
  assertEnabled(settings);
  log("info", "Bắt đầu OCR", {
    host: location.hostname,
    captchaSelector: settings.captchaSelector,
    inputSelector: settings.inputSelector,
    submitSelector: settings.submitSelector,
    fallbackSubmitSelector: settings.fallbackSubmitSelector,
    preClickSelector: settings.preClickSelector,
    autoFill: settings.autoFill,
    autoSubmit: settings.autoSubmit,
    submitDelayMs: normalizeDelay(settings.submitDelayMs),
    templates: settings.templates.length,
    aiEnabled: settings.aiEnabled,
    aiProvider: settings.aiProvider
  });
  assertAllowedHost(settings);
  if (!options.skipPreClick) {
    const clicked = await clickBeforeCaptcha(settings);
    if (!clicked) {
      throw new Error("Element cần click chưa sẵn sàng");
    }
  }
  const img = await findReadyImage(settings.captchaSelector);
  const ocrText = await CaptchaOcr.recognize(img, settings.templates);
  log("info", "OCR nhận diện xong", { ocrText });

  // AI verification: send image to AI model and compare results
  let finalText = ocrText;
  let aiSource = false;

  if (settings.aiEnabled) {
    try {
      const base64Data = imageToBase64(img);
      log("info", "Đang gửi ảnh captcha tới AI model", {
        provider: settings.aiProvider,
        model: settings.aiModel || "(mặc định)"
      });

      const aiResponse = await chrome.runtime.sendMessage({
        type: "AI_RECOGNIZE_CAPTCHA",
        base64: base64Data.base64,
        mimeType: base64Data.mimeType
      });

      if (aiResponse?.ok && aiResponse.text) {
        const aiText = aiResponse.text;
        log("info", "AI nhận diện xong", { aiText, ocrText });

        if (aiText === ocrText) {
          log("info", "✅ OCR và AI khớp nhau, dùng kết quả OCR", { text: ocrText });
          finalText = ocrText;
        } else {
          log("warn", "⚠️ OCR và AI khác nhau, dùng kết quả AI", {
            ocrText,
            aiText
          });
          finalText = aiText;
          aiSource = true;

          // Auto-train from AI result to improve OCR templates
          if (settings.aiAutoTrain) {
            try {
              const newTemplates = await CaptchaOcr.train(img, aiText);
              const latest = await getSettings();
              const templates = balanceTemplates(
                [...latest.templates, ...newTemplates],
                latest.maxTemplates
              );
              await chrome.storage.local.set({ templates });
              log("info", "🧠 Auto-train từ AI thành công", {
                aiText,
                added: newTemplates.length,
                totalTemplates: templates.length
              });
            } catch (trainError) {
              log("error", "Auto-train từ AI lỗi", {
                message: trainError.message
              });
            }
          }
        }
      } else {
        log("warn", "AI không trả kết quả, dùng OCR", {
          error: aiResponse?.error || "Không rõ"
        });
      }
    } catch (aiError) {
      log("error", "Gọi AI lỗi, dùng kết quả OCR", {
        message: aiError.message
      });
    }
  }

  const text = finalText;

  if (settings.autoFill) {
    const input = document.querySelector(settings.inputSelector);
    if (!input) throw new Error("Không tìm thấy input captcha");
    setNativeValue(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    log("info", "Đã điền input captcha", { text, source: aiSource ? "AI" : "OCR" });
  }

  if (settings.autoSubmit) {
    const delayMs = normalizeDelay(settings.submitDelayMs);
    if (delayMs > 0) {
      log("info", "Đợi trước khi submit", { delayMs });
      await sleep(delayMs);
    }
    submit(settings.submitSelector, settings.fallbackSubmitSelector);
    log("info", "Đã submit form");
  }

  return { ok: true, text, source: aiSource ? "AI" : "OCR" };
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

async function findReadyImage(selector, options = {}) {
  const timeoutMs = options.timeoutMs ?? 6000;
  const throwOnMissing = options.throwOnMissing ?? true;
  const img = await waitForElement(selector, timeoutMs);
  if (!img) {
    if (throwOnMissing) throw new Error("Không tìm thấy ảnh captcha");
    return null;
  }
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

function submit(selector, fallbackSelector = "") {
  const target = findSubmitTarget(selector) || findSubmitTarget(fallbackSelector);
  if (!target) throw new Error("Không tìm thấy form/nút submit");
  if (isDisabled(target)) throw new Error("Form/nút submit đang disabled");

  if (target instanceof HTMLFormElement) {
    target.requestSubmit();
    return;
  }

  target.click();
}

function findSubmitTarget(selector) {
  const normalized = (selector || "").trim();
  if (!normalized) return null;

  if (normalized.startsWith("text:")) {
    const text = normalized.slice(5).trim();
    return Array.from(document.querySelectorAll("button")).find((button) => {
      return button.textContent.trim() === text && !isDisabled(button);
    }) || null;
  }

  const target = document.querySelector(normalized);
  if (!target || isDisabled(target)) return null;
  return target;
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
  if (settings.targetTabOnly && !(await isCurrentTargetTab())) {
    log("info", "Auto watch không chạy vì tab này không phải target tab");
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
    if (settings.targetTabOnly && !(await isCurrentTargetTab())) {
      log("info", "Auto watch bỏ qua vì tab này không phải target tab", { reason });
      return;
    }
    assertAllowedHost(settings);

    const clicked = await clickBeforeCaptcha(settings, { skipWhenDisabled: true });
    if (!clicked) {
      log("info", "Auto watch bỏ qua vì nút click trước đang disabled", {
        selector: settings.preClickSelector
      });
      return;
    }
    const img = await findReadyImage(settings.captchaSelector, {
      timeoutMs: options.shortWait ? 1500 : 6000,
      throwOnMissing: false
    });
    if (!img) {
      missingCaptchaRetries++;
      log("info", "Auto watch chưa thấy ảnh captcha, sẽ thử lại", {
        reason,
        retry: missingCaptchaRetries,
        selector: settings.captchaSelector
      });
      if (missingCaptchaRetries <= 12) {
        scheduleWatchRun("captcha-missing-retry", { force: true, shortWait: true });
      }
      return;
    }
    missingCaptchaRetries = 0;
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

async function withTrainLock(callback) {
  const lockId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const acquired = await acquireTrainLock(lockId);
  if (!acquired) {
    throw new Error("Đang có tab khác train mẫu, thử lại sau vài giây");
  }

  try {
    return await callback();
  } finally {
    await releaseTrainLock(lockId);
  }
}

async function acquireTrainLock(lockId) {
  const expiresAt = Date.now() + 8000;
  for (let attempt = 0; attempt < 20; attempt++) {
    const { trainLock } = await chrome.storage.local.get({ trainLock: null });
    if (!trainLock || trainLock.expiresAt < Date.now()) {
      await chrome.storage.local.set({ trainLock: { id: lockId, expiresAt } });
      const check = await chrome.storage.local.get({ trainLock: null });
      if (check.trainLock?.id === lockId) return true;
    }
    await sleep(150);
  }
  return false;
}

async function releaseTrainLock(lockId) {
  const { trainLock } = await chrome.storage.local.get({ trainLock: null });
  if (trainLock?.id === lockId) {
    await chrome.storage.local.remove("trainLock");
  }
}

async function isCurrentTargetTab() {
  const { targetTabId } = await chrome.storage.local.get({ targetTabId: null });
  if (!targetTabId) return true;
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "GET_CURRENT_TAB_ID" }, (response) => {
      resolve(!chrome.runtime.lastError && response?.tabId === targetTabId);
    });
  });
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

function imageToBase64(img) {
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const dataUrl = canvas.toDataURL("image/png");
  const parts = dataUrl.split(",");
  const mimeMatch = parts[0].match(/:(.*?);/);
  return {
    base64: parts[1],
    mimeType: mimeMatch ? mimeMatch[1] : "image/png"
  };
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
