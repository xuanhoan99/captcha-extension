const CaptchaOcr = (() => {
  const WIDTH = 20;
  const HEIGHT = 28;

  async function imageToBinary(img) {
    const canvas = document.createElement("canvas");
    const naturalWidth = img.naturalWidth || img.width;
    const naturalHeight = img.naturalHeight || img.height;
    canvas.width = naturalWidth;
    canvas.height = naturalHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, naturalWidth, naturalHeight);
    const { data, width, height } = ctx.getImageData(0, 0, naturalWidth, naturalHeight);
    const gray = [];
    let sum = 0;

    for (let i = 0; i < data.length; i += 4) {
      const value = Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
      gray.push(value);
      sum += value;
    }

    const average = sum / gray.length;
    const threshold = Math.max(80, Math.min(210, average - 20));
    const pixels = gray.map((value) => (value < threshold ? 1 : 0));
    return { pixels, width, height };
  }

  function segmentDigits(binary, expected = 0) {
    const { pixels, width, height } = binary;
    const columns = Array.from({ length: width }, (_, x) => {
      let count = 0;
      for (let y = 0; y < height; y++) {
        count += pixels[y * width + x];
      }
      return count;
    });

    const runs = [];
    let start = -1;
    for (let x = 0; x < width; x++) {
      if (columns[x] > 0 && start === -1) start = x;
      if ((columns[x] === 0 || x === width - 1) && start !== -1) {
        const end = columns[x] === 0 ? x - 1 : x;
        if (end - start >= 1) runs.push({ start, end });
        start = -1;
      }
    }

    const merged = mergeCloseRuns(runs);
    const boxes = expected > 0
      ? (merged.length === expected ? merged : splitEvenly(binary, expected))
      : merged;
    return boxes.map((box) => cropToInk(binary, box));
  }

  function mergeCloseRuns(runs) {
    if (!runs.length) return runs;
    const merged = [runs[0]];
    for (const run of runs.slice(1)) {
      const previous = merged[merged.length - 1];
      if (run.start - previous.end <= 1) {
        previous.end = run.end;
      } else {
        merged.push({ ...run });
      }
    }
    return merged;
  }

  function splitEvenly(binary, expected) {
    const { pixels, width, height } = binary;
    let minX = width - 1;
    let maxX = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (pixels[y * width + x]) {
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
        }
      }
    }
    if (maxX <= minX) {
      minX = 0;
      maxX = width - 1;
    }
    const digitWidth = (maxX - minX + 1) / expected;
    return Array.from({ length: expected }, (_, index) => ({
      start: Math.round(minX + index * digitWidth),
      end: Math.round(minX + (index + 1) * digitWidth - 1)
    }));
  }

  function cropToInk(binary, range) {
    const { pixels, width, height } = binary;
    let minX = range.start;
    let maxX = range.end;
    let minY = height - 1;
    let maxY = 0;

    for (let y = 0; y < height; y++) {
      for (let x = range.start; x <= range.end; x++) {
        if (pixels[y * width + x]) {
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
      }
    }

    if (maxY < minY) {
      minY = 0;
      maxY = height - 1;
    }
    return { minX, maxX, minY, maxY };
  }

  function normalize(binary, box) {
    const output = [];
    const sourceWidth = Math.max(1, box.maxX - box.minX + 1);
    const sourceHeight = Math.max(1, box.maxY - box.minY + 1);

    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) {
        const sx = box.minX + Math.floor((x / WIDTH) * sourceWidth);
        const sy = box.minY + Math.floor((y / HEIGHT) * sourceHeight);
        output.push(binary.pixels[sy * binary.width + sx] ? 1 : 0);
      }
    }
    return output.join("");
  }

  async function train(img, value, expectedLength = value.length) {
    const binary = await imageToBinary(img);
    const boxes = segmentDigits(binary, expectedLength || value.length);
    if (boxes.length !== value.length) {
      throw new Error(`Số ký tự train (${value.length}) không khớp số vùng OCR (${boxes.length})`);
    }
    return boxes.map((box, index) => ({
      digit: value[index].toUpperCase(),
      pattern: normalize(binary, box),
      createdAt: Date.now()
    }));
  }

  async function recognize(img, templates, expectedLength = 0) {
    if (!templates?.length) {
      throw new Error("Chưa có mẫu OCR. Hãy train vài captcha trước.");
    }
    const binary = await imageToBinary(img);
    const boxes = segmentDigits(binary, expectedLength);
    if (!boxes.length) {
      throw new Error("Không tách được ký tự captcha");
    }
    return boxes.map((box) => match(normalize(binary, box), templates)).join("");
  }

  function match(pattern, templates) {
    let best = null;
    for (const template of templates) {
      const distance = hamming(pattern, template.pattern);
      if (!best || distance < best.distance) {
        best = { digit: template.digit, distance };
      }
    }
    return best.digit;
  }

  function hamming(a, b) {
    const length = Math.min(a.length, b.length);
    let distance = Math.abs(a.length - b.length);
    for (let i = 0; i < length; i++) {
      if (a[i] !== b[i]) distance++;
    }
    return distance;
  }

  return { train, recognize };
})();
