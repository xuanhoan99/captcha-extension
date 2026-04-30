importScripts("ai-vision.js");

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "GET_CURRENT_TAB_ID") {
    sendResponse({ tabId: sender.tab?.id ?? null });
    return false;
  }

  if (message?.type === "AI_RECOGNIZE_CAPTCHA") {
    handleAiRecognize(message)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});

async function handleAiRecognize(message) {
  const defaults = {
    aiEnabled: false,
    aiProvider: "gemini",
    aiModel: "",
    aiApiKey: ""
  };
  const settings = await chrome.storage.local.get(defaults);

  if (!settings.aiEnabled) {
    return { ok: false, error: "AI model đang tắt" };
  }

  const result = await AiVision.recognize(
    message.base64,
    message.mimeType || "image/png",
    settings
  );

  return { ok: true, text: result };
}
