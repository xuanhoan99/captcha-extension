chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "GET_CURRENT_TAB_ID") return false;
  sendResponse({ tabId: sender.tab?.id ?? null });
  return false;
});
