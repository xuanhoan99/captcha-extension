const CaptchaDefaults = {
  allowedHost: "play.rustveil.io",
  captchaSelector: "img[alt='Captcha']",
  inputSelector: "input[maxlength='3'][inputmode='numeric']",
  submitSelector: "button.bg-amber-500",
  fallbackSubmitSelector: "button.bg-red-600",
  preClickSelector: "button.btn-primary",
  enabled: true,
  autoFill: true,
  autoSubmit: false,
  autoWatch: false,
  targetTabOnly: true,
  submitDelayMs: 1000,
  preClickTimeoutMs: 1000,
  maxTemplates: 600,
  templates: []
};
