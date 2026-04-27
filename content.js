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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message).then(sendResponse);
  return true;
});

async function handleMessage(message) {
  try {
    log("info", "Nhận lệnh từ popup", { type: message.type });
    if (message.type === "TRAIN_CAPTCHA") {
      return await trainCaptcha(message.value);
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

async function trainCaptcha(value) {
  const settings = await getSettings();
  log("info", "Bắt đầu train", {
    host: location.hostname,
    captchaSelector: settings.captchaSelector,
    value,
    allowAlphanumeric: settings.allowAlphanumeric
  });
  assertAllowedHost(settings);
  const img = await findReadyImage(settings.captchaSelector);
  const expectedLength = normalizeCaptchaLength(settings.captchaLength) || value.length;
  const newTemplates = await CaptchaOcr.train(img, value, expectedLength);
  const templates = [...settings.templates, ...newTemplates].slice(-120);
  await chrome.storage.local.set({ templates });
  log("info", "Train thành công", {
    added: newTemplates.length,
    totalTemplates: templates.length
  });
  return { ok: true, templates };
}

async function runCaptchaTest() {
  const settings = await getSettings();
  log("info", "Bắt đầu OCR", {
    host: location.hostname,
    captchaSelector: settings.captchaSelector,
    inputSelector: settings.inputSelector,
    submitSelector: settings.submitSelector,
    captchaLength: normalizeCaptchaLength(settings.captchaLength) || "auto",
    allowAlphanumeric: settings.allowAlphanumeric,
    autoFill: settings.autoFill,
    autoSubmit: settings.autoSubmit,
    templates: settings.templates.length
  });
  assertAllowedHost(settings);
  const img = await findReadyImage(settings.captchaSelector);
  const text = await CaptchaOcr.recognize(img, settings.templates, normalizeCaptchaLength(settings.captchaLength));
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
    submit(settings.submitSelector);
    log("info", "Đã submit form");
  }

  return { ok: true, text };
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

async function findReadyImage(selector) {
  const img = document.querySelector(selector);
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
