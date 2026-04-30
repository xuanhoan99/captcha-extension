const AiVision = (() => {
  const PROVIDERS = {
    gemini: {
      name: "Gemini",
      buildUrl(apiKey, model) {
        const m = model || "gemini-2.0-flash";
        return `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey}`;
      },
      buildBody(base64, mimeType) {
        return {
          contents: [{
            parts: [
              {
                text: "This image contains a captcha with exactly 3 digits (0-9). "
                  + "Read the digits carefully and respond with ONLY the 3 digits, nothing else. "
                  + "Example response: 482"
              },
              {
                inline_data: {
                  mime_type: mimeType,
                  data: base64
                }
              }
            ]
          }],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 10
          }
        };
      },
      parseResponse(json) {
        const text = json?.candidates?.[0]?.content?.parts?.[0]?.text || "";
        return extractDigits(text);
      }
    },
    openai: {
      name: "OpenAI (GPT)",
      buildUrl(apiKey, model) {
        return "https://api.openai.com/v1/chat/completions";
      },
      buildBody(base64, mimeType, model) {
        return {
          model: model || "gpt-4o-mini",
          messages: [{
            role: "user",
            content: [
              {
                type: "text",
                text: "This image contains a captcha with exactly 3 digits (0-9). "
                  + "Read the digits carefully and respond with ONLY the 3 digits, nothing else. "
                  + "Example response: 482"
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:${mimeType};base64,${base64}`,
                  detail: "high"
                }
              }
            ]
          }],
          temperature: 0,
          max_tokens: 10
        };
      },
      buildHeaders(apiKey) {
        return {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        };
      },
      parseResponse(json) {
        const text = json?.choices?.[0]?.message?.content || "";
        return extractDigits(text);
      }
    }
  };

  function extractDigits(raw) {
    const cleaned = raw.replace(/[^0-9]/g, "");
    if (cleaned.length >= 3) {
      return cleaned.slice(0, 3);
    }
    return cleaned || null;
  }

  async function recognize(base64, mimeType, settings) {
    const provider = PROVIDERS[settings.aiProvider];
    if (!provider) {
      throw new Error(`AI provider không hợp lệ: ${settings.aiProvider}`);
    }

    const apiKey = (settings.aiApiKey || "").trim();
    if (!apiKey) {
      throw new Error("Chưa cấu hình API key cho AI model");
    }

    const model = (settings.aiModel || "").trim() || undefined;
    const url = provider.buildUrl(apiKey, model);
    const body = provider.buildBody(base64, mimeType, model);

    const headers = provider.buildHeaders
      ? provider.buildHeaders(apiKey)
      : { "Content-Type": "application/json" };

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(`AI API lỗi ${response.status}: ${errorText.slice(0, 200)}`);
    }

    const json = await response.json();
    const result = provider.parseResponse(json);

    if (!result || !/^\d{3}$/.test(result)) {
      throw new Error(`AI trả về kết quả không hợp lệ: "${result || "(rỗng)"}"`);
    }

    return result;
  }

  return { recognize, PROVIDERS };
})();
