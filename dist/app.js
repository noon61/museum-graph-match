import { detectArucoMarkers, rectifyFromMarkers } from "./aruco.js?v=3";

const GRAPHS = {
  deaths: {
    name: "死亡者総数",
    markerIds: [0, 1, 2, 3],
    answer: [.65238,.64762,.63333,.63810,.68571,.70000,.64286,.65238,.62381,.64762,.59524,.57143,.43810,.46667,.50000,.48571,.52857,.52857,.45714],
  },
  students: {
    name: "在籍児童数",
    markerIds: [10, 11, 12, 13],
    answer: [.50952,.50000,.47143,.44286,.41905,.37619,.35238,.33810,.32381,.31905,.30476,.27143,.24762,.25238,.29048,.14286,.10476,.10476,.10476],
  },
  prisoners: {
    name: "在監人員",
    markerIds: [20, 21, 22, 23],
    answer: [.42209,.50104,.56871,.61947,.59691,.56307,.48413,.44465,.39954,.36570,.37698,.36006,.27548,.30367,.39954,.57435,.69278,.77173,.87887],
  },
  cattle: {
    name: "牛頭数",
    markerIds: [30, 31, 32, 33],
    answer: [.42773,.36006,.30931,.28111,.28111,.39390,.46157,.48413,.60255,.67022,.69278,.71533,.76609,.73225,.68150,.71533,.56307,.52924,.65330],
  },
  squid: {
    name: "イカ漁獲量",
    markerIds: [40, 41, 42, 43],
    answer: [.86730,.89573,.85782,.85308,.90995,.92891,.90047,.85782,.84834,.85308,.77251,.68246,.67773,.71090,.70142,.65877,.63033,.50237,.39810],
  },
};

const $ = (selector) => document.querySelector(selector);
const chooser = $("#chooser");
const experience = $("#experience");
const intro = $("#intro");
const cameraPanel = $("#camera-panel");
const resultPanel = $("#result");
const video = $("#camera");
const workCanvas = $("#work-canvas");
const resultCanvas = $("#result-canvas");
let stream;
let graphKey;
let capturedImage;
let visitorLine = [];
let visitorPlot;
let answerVisible = false;

function graphFromUrl() {
  const key = new URLSearchParams(location.search).get("graph");
  return Object.hasOwn(GRAPHS, key) ? key : null;
}

function buildChooser() {
  $("#graph-list").innerHTML = Object.entries(GRAPHS)
    .map(([key, graph]) => `<a href="?graph=${key}">${graph.name}</a>`)
    .join("");
}

function initialize() {
  buildChooser();
  graphKey = graphFromUrl();
  chooser.hidden = Boolean(graphKey);
  experience.hidden = !graphKey;
  if (graphKey) {
    $("#graph-name").textContent = GRAPHS[graphKey].name;
    document.title = `${GRAPHS[graphKey].name}｜グラフを重ねてみよう`;
  }
}

async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    intro.hidden = true;
    resultPanel.hidden = true;
    cameraPanel.hidden = false;
  } catch (error) {
    alert("カメラを開けませんでした。ブラウザのカメラ許可を確認するか、「写真を選んで試す」を使ってください。");
  }
}

function stopCamera() {
  stream?.getTracks().forEach((track) => track.stop());
  stream = undefined;
}

function sourceToCanvas(source, sourceWidth, sourceHeight) {
  const canvas = document.createElement("canvas");
  const scale = Math.min(1, 1100 / sourceWidth);
  canvas.width = Math.round(sourceWidth * scale);
  canvas.height = Math.round(sourceHeight * scale);
  canvas.getContext("2d", { willReadFrequently: true }).drawImage(source, 0, 0, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function captureVideoFrame() {
  return sourceToCanvas(video, video.videoWidth, video.videoHeight);
}

function identifyGraph(markers) {
  let best = null;
  for (const [key, graph] of Object.entries(GRAPHS)) {
    const count = graph.markerIds.filter(id => markers.some(marker => marker.id === id)).length;
    if (!best || count > best.count) best = { key, count };
  }
  return best?.count >= 3 ? best.key : null;
}

function orderGraphMarkers(markers, graph) {
  const ordered = graph.markerIds.map(id => markers.find(marker => marker.id === id) || null);
  const known = ordered.filter(Boolean);
  if (known.length === 4) return ordered;
  const typicalSide = median(known.map(marker => marker.side));
  const candidates = markers.filter(marker => marker.id === null && marker.side > typicalSide * .65 && marker.side < typicalSide * 1.5);
  const missingIndex = ordered.findIndex(marker => !marker);
  const rank = [
    marker => marker.center.x + marker.center.y,
    marker => -marker.center.x + marker.center.y,
    marker => -marker.center.x - marker.center.y,
    marker => marker.center.x - marker.center.y,
  ][missingIndex];
  candidates.sort((a, b) => {
    const guessed = Number(b.guessedId === graph.markerIds[missingIndex]) - Number(a.guessedId === graph.markerIds[missingIndex]);
    return guessed || rank(a) - rank(b);
  });
  if (candidates[0]) ordered[missingIndex] = candidates[0];
  if (!ordered[missingIndex] && known.length === 3) {
    const combinations = [[1,3,2],[0,2,3],[1,3,0],[0,2,1]];
    const [first, second, subtract] = combinations[missingIndex];
    ordered[missingIndex] = {
      center: {
        x: ordered[first].center.x + ordered[second].center.x - ordered[subtract].center.x,
        y: ordered[first].center.y + ordered[second].center.y - ordered[subtract].center.y,
      },
    };
  }
  return ordered.every(Boolean) ? ordered : null;
}

function prepareMarkedPhoto(sourceCanvas) {
  const markers = detectArucoMarkers(sourceCanvas);
  workCanvas.dataset.markerIds = markers.map(marker => marker.id ?? `?${marker.guessedId}:${marker.distance}`).join(",");
  window.__markerDebug = markers.map(({ id, guessedId, distance, center }) => ({ id, guessedId, distance, center }));
  const detectedGraph = identifyGraph(markers);
  if (!detectedGraph) {
    alert(`4隅の認識マーカーを読み取れませんでした（${markers.length}/4個）。紙全体と4つの黒いマーカーが写るように、明るい場所でもう一度撮影してください。`);
    return false;
  }
  graphKey = detectedGraph;
  const graph = GRAPHS[graphKey];
  const ordered = orderGraphMarkers(markers, graph);
  if (!ordered) {
    alert("4隅のマーカーの位置を確定できませんでした。紙全体が写るようにもう一度撮影してください。");
    return false;
  }
  if (!rectifyFromMarkers(sourceCanvas, ordered, workCanvas)) {
    alert("紙の傾きを補正できませんでした。正面に近い角度でもう一度撮影してください。");
    return false;
  }
  $("#graph-name").textContent = graph.name;
  document.title = `${graph.name}｜グラフを重ねてみよう`;
  return true;
}

function lineMaterialPixel(r, g, b) {
  // Keep support for the red prototype, but primarily detect natural wood.
  // Wood is usually warmer than the white paper and the neutral black grid:
  // red >= green > blue, with enough brightness and colour difference.
  const redMaterial = r > 125 && r > g * 1.35 && r > b * 1.25 && r - Math.min(g, b) > 45;
  const brightness = (r + g + b) / 3;
  const woodMaterial =
    brightness > 32 && brightness < 235 &&
    r >= g * .96 && g >= b * .94 &&
    r - b > 10 && g - b > 2;
  return redMaterial || woodMaterial;
}

function neutralDarkPixel(r, g, b) {
  const spread = Math.max(r, g, b) - Math.min(r, g, b);
  return (r + g + b) / 3 < 185 && spread < 32;
}

function clusterNumbers(numbers, maximumGap = 3) {
  const groups = [];
  numbers.forEach((number) => {
    const group = groups.at(-1);
    if (!group || number - group.at(-1) > maximumGap) groups.push([number]);
    else group.push(number);
  });
  return groups;
}

function median(numbers) {
  const sorted = [...numbers].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function longestHorizontalRun(image, width, y) {
  let best = null;
  let start = null;
  let lastMatch = null;
  for (let x = Math.round(width * .08); x < Math.round(width * .94); x += 1) {
    let match = false;
    for (let dy = -1; dy <= 1; dy += 1) {
      const index = ((y + dy) * width + x) * 4;
      if (neutralDarkPixel(image[index], image[index + 1], image[index + 2])) match = true;
    }
    if (match) {
      if (start === null) start = x;
      lastMatch = x;
    } else if (start !== null && x - lastMatch > 4) {
      if (!best || lastMatch - start > best.right - best.left) best = { left: start, right: lastMatch };
      start = null;
      lastMatch = null;
    }
  }
  if (start !== null && (!best || lastMatch - start > best.right - best.left)) best = { left: start, right: lastMatch };
  return best;
}

function detectPlot(canvas) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const { width, height } = canvas;
  const image = context.getImageData(0, 0, width, height).data;
  const candidateRows = [];

  for (let y = Math.round(height * .16); y < Math.round(height * .84); y += 1) {
    const run = longestHorizontalRun(image, width, y);
    if (run && run.right - run.left > width * .28) candidateRows.push(y);
  }

  const rowCenters = clusterNumbers(candidateRows, 4).map((group) => Math.round((group[0] + group.at(-1)) / 2));
  let bestSequence = [];
  for (let start = 0; start < rowCenters.length; start += 1) {
    for (let end = start + 4; end < rowCenters.length; end += 1) {
      const sequence = rowCenters.slice(start, end + 1);
      const gaps = sequence.slice(1).map((value, index) => value - sequence[index]);
      const typicalGap = median(gaps);
      const regular = gaps.every((gap) => Math.abs(gap - typicalGap) <= Math.max(5, typicalGap * .24));
      if (regular && sequence.length > bestSequence.length) bestSequence = sequence;
    }
  }

  if (bestSequence.length < 5) {
    return { left: width * .20, right: width * .80, top: height * .30, bottom: height * .76 };
  }

  const runs = bestSequence.map((y) => longestHorizontalRun(image, width, y)).filter(Boolean);
  return {
    left: median(runs.map((run) => run.left)),
    right: median(runs.map((run) => run.right)),
    top: bestSequence[0],
    bottom: bestSequence.at(-1),
  };
}

function extractLine(canvas, samples) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const { width, height } = canvas;
  const image = context.getImageData(0, 0, width, height).data;
  const plot = detectPlot(canvas);
  const values = [];
  let detected = 0;

  const [xStart, xEnd] = GRAPHS[graphKey].xRange || [.03, .97];
  for (let sample = 0; sample < samples; sample += 1) {
    const xRatio = xStart + (xEnd - xStart) * sample / (samples - 1);
    const centerX = Math.round(plot.left + (plot.right - plot.left) * xRatio);
    const band = Math.max(4, Math.round(width * .008));
    const ys = [];
    for (let x = centerX - band; x <= centerX + band; x += 2) {
      for (let y = Math.round(plot.top); y <= Math.round(plot.bottom); y += 2) {
        const index = (y * width + x) * 4;
        if (lineMaterialPixel(image[index], image[index + 1], image[index + 2])) ys.push(y);
      }
    }
    if (ys.length) {
      ys.sort((a, b) => a - b);
      const y = ys[Math.floor(ys.length / 2)];
      values.push((y - plot.top) / (plot.bottom - plot.top));
      detected += 1;
    } else values.push(null);
  }

  if (detected / samples < .45) return null;
  for (let i = 0; i < values.length; i += 1) {
    if (values[i] !== null) continue;
    let before = i - 1, after = i + 1;
    while (before >= 0 && values[before] === null) before -= 1;
    while (after < values.length && values[after] === null) after += 1;
    if (before >= 0 && after < values.length) {
      const ratio = (i - before) / (after - before);
      values[i] = values[before] + (values[after] - values[before]) * ratio;
    } else values[i] = before >= 0 ? values[before] : values[after];
  }
  return { values, plot };
}

function scoreLine(visitor, answer) {
  const distance = visitor.reduce((sum, value, index) => sum + Math.abs(value - answer[index]), 0) / answer.length;
  const visitorDelta = visitor.slice(1).map((value, index) => value - visitor[index]);
  const answerDelta = answer.slice(1).map((value, index) => value - answer[index]);
  const shapeDistance = visitorDelta.reduce((sum, value, index) => sum + Math.abs(value - answerDelta[index]), 0) / answerDelta.length;
  const positionScore = Math.max(0, 1 - distance / .35);
  const shapeScore = Math.max(0, 1 - shapeDistance / .28);
  return {
    total: Math.round((positionScore * .5 + shapeScore * .5) * 100),
    direction: Math.round(shapeScore * 100),
    position: Math.round(positionScore * 100),
  };
}

function drawPolyline(context, values, plot, color, width, dashed = false) {
  const [xStart, xEnd] = GRAPHS[graphKey].xRange || [.03, .97];
  context.save();
  context.strokeStyle = color;
  context.lineWidth = width;
  context.lineJoin = "round";
  context.lineCap = "round";
  if (dashed) context.setLineDash([18, 12]);
  context.beginPath();
  values.forEach((value, index) => {
    const xRatio = xStart + (xEnd - xStart) * index / (values.length - 1);
    const x = plot.left + (plot.right - plot.left) * xRatio;
    const y = plot.top + value * (plot.bottom - plot.top);
    if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
  });
  context.stroke();
  context.restore();
}

function renderResult(scores) {
  resultCanvas.width = capturedImage.width;
  resultCanvas.height = capturedImage.height;
  const context = resultCanvas.getContext("2d");
  context.drawImage(capturedImage, 0, 0);
  drawPolyline(context, visitorLine, visitorPlot, "#ed4b2f", Math.max(7, resultCanvas.width * .009));
  if (answerVisible) drawPolyline(context, GRAPHS[graphKey].answer, visitorPlot, "#12a36d", Math.max(7, resultCanvas.width * .009), true);
  $("#score").textContent = scores.total;
  $("#direction-score").textContent = `${scores.direction}%`;
  $("#position-score").textContent = `${scores.position}%`;
  const messages = scores.total >= 90
    ? ["ほぼ正解！", "変化の形をしっかり捉えています。"]
    : scores.total >= 70
      ? ["かなり近い！", "正解を重ねて、違うところを見てみましょう。"]
      : scores.total >= 45
        ? ["おしい！", "山や谷がどこにあるか、正解と比べてみましょう。"]
        : ["意外な動きかも？", "正解を表示して、時代の変化を確かめてみましょう。"];
  $("#result-title").textContent = messages[0];
  $("#result-message").textContent = messages[1];
}

function analyzeCanvas(canvas) {
  const answer = GRAPHS[graphKey].answer;
  const detection = extractLine(canvas, answer.length);
  if (!detection) {
    alert("木の折れ線を十分に読み取れませんでした。木と背景の色が分かるように、軸全体を明るい場所で撮影してください。");
    return;
  }
  capturedImage = document.createElement("canvas");
  capturedImage.width = canvas.width;
  capturedImage.height = canvas.height;
  capturedImage.getContext("2d").drawImage(canvas, 0, 0);
  visitorLine = detection.values;
  visitorPlot = detection.plot;
  resultPanel.dataset.detectedGraph = graphKey;
  resultPanel.dataset.visitorLine = visitorLine.map(value => value.toFixed(5)).join(",");
  window.__graphMatchDebug = { graphKey, visitorLine: [...visitorLine], visitorPlot: { ...visitorPlot } };
  answerVisible = true;
  const scores = scoreLine(visitorLine, answer);
  stopCamera();
  cameraPanel.hidden = true;
  intro.hidden = true;
  resultPanel.hidden = false;
  $("#toggle-answer").textContent = "正解を隠す";
  renderResult(scores);
  resultPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function loadPhoto(file) {
  if (!file) return;
  const image = new Image();
  image.onload = () => {
    const sourceCanvas = sourceToCanvas(image, image.width, image.height);
    if (prepareMarkedPhoto(sourceCanvas)) analyzeCanvas(workCanvas);
    URL.revokeObjectURL(image.src);
  };
  image.src = URL.createObjectURL(file);
}

$("#start-camera").addEventListener("click", startCamera);
$("#capture").addEventListener("click", () => {
  const sourceCanvas = captureVideoFrame();
  if (prepareMarkedPhoto(sourceCanvas)) analyzeCanvas(workCanvas);
});
$("#photo-input").addEventListener("change", (event) => loadPhoto(event.target.files[0]));
$("#retry").addEventListener("click", () => {
  resultPanel.hidden = true;
  intro.hidden = false;
  window.scrollTo({ top: 0, behavior: "smooth" });
});
$("#toggle-answer").addEventListener("click", () => {
  answerVisible = !answerVisible;
  $("#toggle-answer").textContent = answerVisible ? "正解を隠す" : "正解を表示";
  renderResult(scoreLine(visitorLine, GRAPHS[graphKey].answer));
});
$("#change-graph").addEventListener("click", () => { location.href = location.pathname; });
window.addEventListener("pagehide", stopCamera);

initialize();
