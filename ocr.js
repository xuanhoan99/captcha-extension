const CaptchaOcr = (() => {
  const WIDTH = 20;
  const HEIGHT = 28;
  const OCR_VERSION = 7;
  const DIGIT_COUNT = 3;

  async function imageToBinary(img) {
    const canvas = document.createElement("canvas");
    const naturalWidth = img.naturalWidth || img.width;
    const naturalHeight = img.naturalHeight || img.height;
    canvas.width = naturalWidth;
    canvas.height = naturalHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, naturalWidth, naturalHeight);
    const { data, width, height } = ctx.getImageData(0, 0, naturalWidth, naturalHeight);
    const pixels = [];
    let sum = 0;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const value = Math.round(r * 0.299 + g * 0.587 + b * 0.114);
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const saturation = max === 0 ? 0 : (max - min) / max;
      pixels.push({ value, max, saturation });
      sum += value;
    }

    const average = sum / pixels.length;
    const lightScores = pixels.map(({ value, max, saturation }) => {
      return value * 0.7 + max * 0.5 + saturation * 90;
    });
    const lightThreshold = percentile(lightScores, average < 110 ? 0.88 : 0.84);
    const lightHigh = percentile(lightScores, 0.985);
    const lightMask = pixels.map(({ value, max, saturation }, index) => {
      const bright = lightScores[index] >= lightThreshold && max > 105;
      const colorful = saturation > 0.34 && max > 120 && value > average + 10;
      return bright || colorful ? 1 : 0;
    });
    const darkMask = pixels.map(({ value }) => (value < average - 28 ? 1 : 0));
    const rawMask = chooseMask(lightMask, darkMask, average);
    const components = filterComponents(rawMask, width, height);
    const cleaned = removeThinNoise(components, width, height);
    const scores = buildForegroundScores(pixels, lightScores, cleaned, lightThreshold, lightHigh, average);
    return { pixels: cleaned, scores, width, height };
  }

  function buildForegroundScores(pixels, lightScores, mask, low, high, average) {
    const range = Math.max(1, high - low);
    return pixels.map(({ value, max, saturation }, index) => {
      if (!mask[index]) return 0;
      const brightnessScore = Math.max(0, Math.min(1, (lightScores[index] - low) / range));
      const contrastScore = Math.max(0, Math.min(1, (value - average + 20) / 120));
      const colorScore = Math.max(0, Math.min(1, saturation * 1.4));
      const maxScore = Math.max(0, Math.min(1, (max - 95) / 130));
      return Math.max(brightnessScore, contrastScore * 0.75, colorScore * 0.55, maxScore * 0.65);
    });
  }

  function percentile(values, ratio) {
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.max(0, Math.min(sorted.length - 1, Math.floor(sorted.length * ratio)));
    return sorted[index];
  }

  function chooseMask(lightMask, darkMask, average) {
    const lightScore = scoreMask(lightMask);
    const darkScore = scoreMask(darkMask);
    if (average < 110 && lightScore.usable) return lightMask;
    if (average > 145 && darkScore.usable) return darkMask;
    if (lightScore.usable && !darkScore.usable) return lightMask;
    if (darkScore.usable && !lightScore.usable) return darkMask;
    return lightScore.score >= darkScore.score ? lightMask : darkMask;
  }

  function scoreMask(mask) {
    const ink = mask.reduce((total, value) => total + value, 0);
    const ratio = ink / mask.length;
    const usable = ratio > 0.015 && ratio < 0.42;
    return {
      usable,
      score: usable ? 1 - Math.abs(ratio - 0.12) : 0
    };
  }

  function removeThinNoise(mask, width, height) {
    const eroded = mask.map((value, index) => {
      if (!value) return 0;
      const x = index % width;
      const y = Math.floor(index / width);
      return countNeighbors(mask, width, height, x, y) >= 4 ? 1 : 0;
    });

    return eroded.map((value, index) => {
      if (value) return 1;
      const x = index % width;
      const y = Math.floor(index / width);
      return countNeighbors(eroded, width, height, x, y) >= 6 ? 1 : 0;
    });
  }

  function filterComponents(mask, width, height) {
    const visited = new Uint8Array(mask.length);
    const output = new Array(mask.length).fill(0);
    const minArea = Math.max(12, Math.floor(width * height * 0.0012));

    for (let index = 0; index < mask.length; index++) {
      if (!mask[index] || visited[index]) continue;

      const component = collectComponent(mask, visited, width, height, index);
      const boxWidth = component.maxX - component.minX + 1;
      const boxHeight = component.maxY - component.minY + 1;
      const density = component.area / (boxWidth * boxHeight);
      const tiny = component.area < minArea || boxWidth < 3 || boxHeight < 6;
      const lineLike = density < 0.16 && (boxWidth > width * 0.18 || boxHeight > height * 0.34);

      if (!tiny && !lineLike) {
        for (const pixelIndex of component.pixels) {
          output[pixelIndex] = 1;
        }
      }
    }

    return output;
  }

  function collectComponent(mask, visited, width, height, startIndex) {
    const stack = [startIndex];
    const pixels = [];
    let minX = width - 1;
    let maxX = 0;
    let minY = height - 1;
    let maxY = 0;
    visited[startIndex] = 1;

    while (stack.length) {
      const index = stack.pop();
      const x = index % width;
      const y = Math.floor(index / width);
      pixels.push(index);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const nextIndex = ny * width + nx;
          if (mask[nextIndex] && !visited[nextIndex]) {
            visited[nextIndex] = 1;
            stack.push(nextIndex);
          }
        }
      }
    }

    return {
      pixels,
      area: pixels.length,
      minX,
      maxX,
      minY,
      maxY
    };
  }

  function countNeighbors(mask, width, height, x, y) {
    let count = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
          count += mask[ny * width + nx];
        }
      }
    }
    return count;
  }

  function segmentDigits(binary, expected = DIGIT_COUNT) {
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
    const boxes = splitEvenly(binary, DIGIT_COUNT);
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
    const { width } = binary;
    const minX = Math.max(0, Math.floor(width * 0.07));
    const maxX = Math.min(width - 1, Math.ceil(width * 0.93));
    const digitWidth = (maxX - minX + 1) / expected;
    const gutter = Math.max(1, Math.floor(digitWidth * 0.08));
    return Array.from({ length: expected }, (_, index) => ({
      start: Math.max(0, Math.round(minX + index * digitWidth - gutter)),
      end: Math.min(width - 1, Math.round(minX + (index + 1) * digitWidth - 1 + gutter))
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

  function normalizeVector(binary, box) {
    const output = [];
    const sourceWidth = Math.max(1, box.maxX - box.minX + 1);
    const sourceHeight = Math.max(1, box.maxY - box.minY + 1);

    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) {
        const sx = box.minX + Math.floor((x / WIDTH) * sourceWidth);
        const sy = box.minY + Math.floor((y / HEIGHT) * sourceHeight);
        output.push(Math.round((binary.scores[sy * binary.width + sx] || 0) * 1000) / 1000);
      }
    }
    return output;
  }

  function extractFeatures(pattern, vector) {
    const bits = patternToBits(pattern);
    const quadrants = [
      regionDensity(bits, 0, 0, WIDTH / 2, HEIGHT / 2),
      regionDensity(bits, WIDTH / 2, 0, WIDTH, HEIGHT / 2),
      regionDensity(bits, 0, HEIGHT / 2, WIDTH / 2, HEIGHT),
      regionDensity(bits, WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT)
    ];
    const thirds = [
      regionDensity(bits, 0, 0, WIDTH, HEIGHT / 3),
      regionDensity(bits, 0, HEIGHT / 3, WIDTH, HEIGHT * 2 / 3),
      regionDensity(bits, 0, HEIGHT * 2 / 3, WIDTH, HEIGHT)
    ];
    const columns = Array.from({ length: 5 }, (_, index) => {
      return regionDensity(bits, index * WIDTH / 5, 0, (index + 1) * WIDTH / 5, HEIGHT);
    });
    const rows = Array.from({ length: 7 }, (_, index) => {
      return regionDensity(bits, 0, index * HEIGHT / 7, WIDTH, (index + 1) * HEIGHT / 7);
    });

    return {
      density: bits.reduce((total, value) => total + value, 0) / bits.length,
      holes: countHoles(bits),
      quadrants,
      thirds,
      columns,
      rows,
      vectorMass: vector.reduce((total, value) => total + value, 0) / vector.length
    };
  }

  function regionDensity(bits, left, top, right, bottom) {
    const minX = Math.max(0, Math.floor(left));
    const maxX = Math.min(WIDTH, Math.ceil(right));
    const minY = Math.max(0, Math.floor(top));
    const maxY = Math.min(HEIGHT, Math.ceil(bottom));
    let total = 0;
    let area = 0;

    for (let y = minY; y < maxY; y++) {
      for (let x = minX; x < maxX; x++) {
        total += bits[y * WIDTH + x];
        area++;
      }
    }
    return area ? total / area : 0;
  }

  function countHoles(bits) {
    const visited = new Uint8Array(bits.length);
    let holes = 0;

    for (let index = 0; index < bits.length; index++) {
      if (bits[index] || visited[index]) continue;
      const component = collectBackground(bits, visited, index);
      if (!component.touchesEdge && component.area >= 4) {
        holes++;
      }
    }

    return Math.min(2, holes);
  }

  function collectBackground(bits, visited, startIndex) {
    const stack = [startIndex];
    let area = 0;
    let touchesEdge = false;
    visited[startIndex] = 1;

    while (stack.length) {
      const index = stack.pop();
      const x = index % WIDTH;
      const y = Math.floor(index / WIDTH);
      area++;
      if (x === 0 || y === 0 || x === WIDTH - 1 || y === HEIGHT - 1) {
        touchesEdge = true;
      }

      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= WIDTH || ny < 0 || ny >= HEIGHT) continue;
        const nextIndex = ny * WIDTH + nx;
        if (!bits[nextIndex] && !visited[nextIndex]) {
          visited[nextIndex] = 1;
          stack.push(nextIndex);
        }
      }
    }

    return { area, touchesEdge };
  }

  function patternToBits(pattern) {
    return Array.from(pattern, (value) => value === "1" ? 1 : 0);
  }

  function shiftedBits(bits, dx, dy) {
    const output = new Array(bits.length).fill(0);
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) {
        const sourceX = x - dx;
        const sourceY = y - dy;
        if (sourceX >= 0 && sourceX < WIDTH && sourceY >= 0 && sourceY < HEIGHT) {
          output[y * WIDTH + x] = bits[sourceY * WIDTH + sourceX];
        }
      }
    }
    return output;
  }

  async function train(img, value) {
    if (!/^\d{3}$/.test(value)) {
      throw new Error("OCR tối ưu hiện chỉ train captcha đúng 3 chữ số.");
    }
    const binary = await imageToBinary(img);
    const boxes = segmentDigits(binary, DIGIT_COUNT);
    if (boxes.length !== value.length) {
      throw new Error(`Số ký tự train (${value.length}) không khớp số vùng OCR (${boxes.length})`);
    }
    return boxes.map((box, index) => {
      const pattern = normalize(binary, box);
      const vector = normalizeVector(binary, box);
      return {
        digit: value[index].toUpperCase(),
        pattern,
        vector,
        features: extractFeatures(pattern, vector),
        version: OCR_VERSION,
        createdAt: Date.now()
      };
    });
  }

  async function recognize(img, templates) {
    const usableTemplates = (templates || []).filter((template) => {
      return template.version === OCR_VERSION && /^\d$/.test(template.digit);
    });
    if (!usableTemplates.length) {
      throw new Error("Chưa có mẫu OCR. Hãy train vài captcha trước.");
    }
    const binary = await imageToBinary(img);
    const boxes = segmentDigits(binary, DIGIT_COUNT);
    if (boxes.length !== DIGIT_COUNT) {
      throw new Error("Không tách được ký tự captcha");
    }
    return boxes.map((box) => match({
      pattern: normalize(binary, box),
      vector: normalizeVector(binary, box)
    }, usableTemplates)).join("");
  }

  function match(sample, templates) {
    const target = patternToBits(sample.pattern);
    const targetVector = sample.vector || null;
    const targetFeatures = extractFeatures(sample.pattern, targetVector || []);
    let best = null;
    for (const template of templates) {
      const templateBits = patternToBits(template.pattern);
      const diceScore = bestShiftedDice(target, templateBits);
      const vectorScore = targetVector && template.vector
        ? bestShiftedCosine(targetVector, template.vector)
        : diceScore;
      const featureScore = template.features
        ? compareFeatures(targetFeatures, template.features)
        : diceScore;
      const score = vectorScore * 0.5 + diceScore * 0.25 + featureScore * 0.25;
      if (!best || score > best.score) {
        best = { digit: template.digit, score };
      }
    }
    return best.digit;
  }

  function bestShiftedDice(a, b) {
    let best = 0;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        best = Math.max(best, dice(a, shiftedBits(b, dx, dy)));
      }
    }
    return best;
  }

  function bestShiftedCosine(a, b) {
    let best = 0;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        best = Math.max(best, cosine(a, shiftedVector(b, dx, dy)));
      }
    }
    return best;
  }

  function shiftedVector(values, dx, dy) {
    const output = new Array(values.length).fill(0);
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) {
        const sourceX = x - dx;
        const sourceY = y - dy;
        if (sourceX >= 0 && sourceX < WIDTH && sourceY >= 0 && sourceY < HEIGHT) {
          output[y * WIDTH + x] = values[sourceY * WIDTH + sourceX];
        }
      }
    }
    return output;
  }

  function cosine(a, b) {
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    if (!normA || !normB) return 0;
    return dot / Math.sqrt(normA * normB);
  }

  function compareFeatures(a, b) {
    const values = [
      1 - Math.abs(a.density - b.density),
      1 - Math.abs(a.vectorMass - b.vectorMass),
      1 - Math.min(1, Math.abs(a.holes - b.holes) / 2),
      compareSeries(a.quadrants, b.quadrants),
      compareSeries(a.thirds, b.thirds),
      compareSeries(a.columns, b.columns),
      compareSeries(a.rows, b.rows)
    ];
    return values.reduce((total, value) => total + Math.max(0, value), 0) / values.length;
  }

  function compareSeries(a, b) {
    const length = Math.min(a.length, b.length);
    let diff = Math.abs(a.length - b.length) * 0.1;
    for (let i = 0; i < length; i++) {
      diff += Math.abs(a[i] - b[i]);
    }
    return 1 - Math.min(1, diff / Math.max(1, length));
  }

  function dice(a, b) {
    let intersection = 0;
    let total = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i]) total++;
      if (b[i]) total++;
      if (a[i] && b[i]) intersection += 2;
    }
    return total === 0 ? 0 : intersection / total;
  }

  return { train, recognize };
})();
