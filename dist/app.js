import { detectArucoMarkers, rectifyFromMarkers } from "./aruco.js?v=4";

const GRAPHS = {
  deaths: {
    name: "死亡者総数",
    markerIds: [0, 1, 2, 3],
    answer: [.67031,.65127,.64175,.62748,.66079,.71791,.64651,.65127,.62748,.64175,.58464,.51800,.42757,.50848,.48468,.53228,.51324,.47992,.47992],
  },
  students: {
    name: "在籍児童数",
    markerIds: [10, 11, 12, 13],
    answer: [.50848,.49896,.47041,.44185,.42281,.37997,.35617,.33713,.32285,.32285,.30382,.27050,.24670,.25622,.28478,.14199,.10391,.10867,.10867],
  },
  prisoners: {
    name: "在監人員",
    markerIds: [20, 21, 22, 23],
    answer: [.37045,.42281,.49420,.56084,.55132,.51324,.43709,.40377,.35141,.36093,.34189,.27526,.33237,.47041,.61796,.69411,.78930,.77503,.77503],
  },
  cattle: {
    name: "牛頭数",
    markerIds: [30, 31, 32, 33],
    answer: [.39425,.39425,.30858,.28954,.26574,.37997,.43709,.49420,.59416,.62272,.65127,.69411,.60844,.66079,.52752,.48944,.62748,.77503,.80358],
  },
  squid: {
    name: "イカ漁獲量",
    markerIds: [40, 41, 42, 43],
    answer: [.86070,.90354,.83214,.86546,.92258,.91306,.87022,.83214,.85118,.78455,.67983,.66555,.70363,.68935,.65603,.59416,.44661,.38949,.38949],
  },
};

const $ = (selector) => document.querySelector(selector);
const missingGraph = $("#missing-graph");
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

function initialize() {
  if (new URLSearchParams(location.search).get("diagnostic") === "1") {
    document.body.classList.add("diagnostic-mode");
  }
  graphKey = graphFromUrl();
  missingGraph.hidden = Boolean(graphKey);
  experience.hidden = !graphKey;
  if (graphKey) {
    $("#graph-name").textContent = GRAPHS[graphKey].name;
    document.title = `${GRAPHS[graphKey].name}｜触れる折れ線グラフ`;
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
    alert("カメラを開けませんでした。ブラウザのカメラ許可を確認して、もう一度お試しください。");
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
    alert(`4隅の認識マーカーを読み取れませんでした（${markers.length}/4個）。紙全体と4つの黒いマーカーが写るように、光の反射を避けてもう一度撮影してください。`);
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
  document.title = `${graph.name}｜触れる折れ線グラフ`;
  return true;
}

function lineMaterialPixel(r, g, b) {
  // Keep support for the red prototype, but primarily detect natural wood.
  // Wood is usually warmer than the white paper and the neutral black grid:
  // red >= green > blue, with enough brightness and colour difference.
  const redMaterial = r > 125 && r > g * 1.35 && r > b * 1.25 && r - Math.min(g, b) > 45;
  const brightness = (r + g + b) / 3;
  const maximum = Math.max(r, g, b);
  const minimum = Math.min(r, g, b);
  const saturation = maximum ? (maximum - minimum) / maximum : 0;
  const woodMaterial =
    // Strong illumination can give the entire white sheet a warm colour cast.
    // Relative colour saturation separates the wooden surface from that paper,
    // while the wider brightness range keeps slightly overexposed wood visible.
    brightness > 85 && brightness < 250 &&
    r >= g * .95 && g >= b * .94 &&
    saturation > .16 && r - b > 24 && g - b > 7;
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
    return calibratedPlot(canvas);
  }

  const runs = bestSequence.map((y) => longestHorizontalRun(image, width, y)).filter(Boolean);
  return {
    // A wooden piece can cover and split one gridline. The outermost endpoints
    // from all horizontal gridlines preserve the real left/right border.
    left: Math.min(...runs.map((run) => run.left)),
    right: Math.max(...runs.map((run) => run.right)),
    top: bestSequence[0],
    bottom: bestSequence.at(-1),
  };
}

// 4隅のマーカーでA3用紙を正面から見た形に補正したあとは、
// 印刷データから求めた一定の座標を使う。写真ごとの線検出に頼ると、
// 木の棒や影で右端の枠線が隠れた際に数年分が切れてしまうため。
function calibratedPlot(canvas) {
  return {
    left: canvas.width * .169,
    right: canvas.width * .886,
    top: canvas.height * .278,
    bottom: canvas.height * .823,
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
    } else {
      values.push(null);
    }
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
  if (answerVisible) drawPolyline(context, GRAPHS[graphKey].answer, visitorPlot, "#28446e", Math.max(7, resultCanvas.width * .009), true);
  $("#score").textContent = scores.total;
  $("#direction-score").textContent = `${scores.direction}%`;
  $("#position-score").textContent = `${scores.position}%`;
  const messages = scores.total === 100
    ? ["正解！", "すべて正しい場所に置けました。"]
    : scores.total >= 90
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
    alert("木の折れ線を十分に読み取れませんでした。強い反射を避け、木と背景の色が分かる角度で撮影してください。");
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
window.addEventListener("pagehide", stopCamera);

initialize();
