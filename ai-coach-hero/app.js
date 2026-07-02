/* =========================================================
 * AI Coach — 手势驱动折纸视频
 * handCloseProgress: 0 = 手张开(人物头像) → 1 = 握拳/捏合(纸团)
 * video.currentTime 实时跟随手势，无手时冻结当前帧
 * ======================================================= */
import {
  HandLandmarker,
  FilesetResolver,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

const foldVideo = document.getElementById("foldVideo");
const camVideo = document.getElementById("camVideo");
const camCanvas = document.getElementById("camCanvas");
const camState = document.getElementById("camState");
const camPct = document.getElementById("camPct");
const meterFill = document.getElementById("camMeterFill");
const ctx = camCanvas.getContext("2d");

/* ---------------- 手部骨架连接 ---------------- */
const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],          // 拇指
  [0, 5], [5, 6], [6, 7], [7, 8],          // 食指
  [5, 9], [9, 10], [10, 11], [11, 12],     // 中指
  [9, 13], [13, 14], [14, 15], [15, 16],   // 无名指
  [13, 17], [17, 18], [18, 19], [19, 20],  // 小指
  [0, 17],                                 // 掌缘
];

/* ---------------- 手势 → 进度 ---------------- */
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0));
const clamp01 = (v) => Math.min(1, Math.max(0, v));

/**
 * 计算 handCloseProgress
 * 0 = 手完全张开；1 = 聚拢 / 握拳 / 捏合
 */
function handCloseProgress(lm) {
  const palm = dist(lm[0], lm[9]) || 1e-6; // 掌心尺度（腕→中指根）

  // 1) 卷曲度：四指指尖到手腕的平均距离（归一化）
  const tips = [8, 12, 16, 20];
  const avg = tips.reduce((s, i) => s + dist(lm[i], lm[0]), 0) / tips.length / palm;
  const OPEN = 1.9, CLOSED = 1.05; // 张开 ≈ 1.9+，握拳 ≈ 1.0
  const curl = clamp01((OPEN - avg) / (OPEN - CLOSED));

  // 2) 捏合度：拇指尖 ↔ 食指尖
  const pinchDist = dist(lm[4], lm[8]) / palm;
  const pinch = clamp01((0.9 - pinchDist) / 0.65);

  return Math.max(curl, pinch);
}

/* ---------------- 视频时间轴驱动 ---------------- */
let targetProgress = 0;   // 手势目标
let smoothProgress = 0;   // 平滑后的值
let handPresent = false;
let ready = false;

// 以 Blob 方式加载：保证时间轴完全可寻址
// （普通静态服务器若不支持 HTTP Range，seekable 会是 [0,0]，currentTime 永远回到 0）
(async () => {
  const blob = await (await fetch("fold.mp4")).blob();
  foldVideo.src = URL.createObjectURL(blob);
  foldVideo.addEventListener(
    "loadedmetadata",
    () => {
      foldVideo.currentTime = 0.001; // 初始：展开的人物头像（触发首帧解码）
      ready = true;
    },
    { once: true }
  );
})();

function driveVideo() {
  if (ready && handPresent && !foldVideo.seeking) {
    smoothProgress += (targetProgress - smoothProgress) * 0.22;
    const t = smoothProgress * Math.max(foldVideo.duration - 0.05, 0);
    if (Math.abs(t - foldVideo.currentTime) > 0.02) {
      foldVideo.currentTime = t; // 实时推动时间轴
    }
  }
  // 无手：保持当前帧，不做任何事（不自动播放）
  requestAnimationFrame(driveVideo);
}
requestAnimationFrame(driveVideo);

/* ---------------- 摄像头 + MediaPipe ---------------- */
let landmarker = null;

async function init() {
  try {
    camState.textContent = "加载模型…";
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
    );
    landmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numHands: 1,
    });

    camState.textContent = "请求摄像头…";
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: "user" },
      audio: false,
    });
    camVideo.srcObject = stream;
    await camVideo.play();
    camCanvas.width = camVideo.videoWidth;
    camCanvas.height = camVideo.videoHeight;

    requestAnimationFrame(track);
  } catch (err) {
    camState.textContent = "摄像头不可用";
    console.error(err);
  }
}

let lastVideoTime = -1;

function track() {
  if (camVideo.readyState >= 2 && camVideo.currentTime !== lastVideoTime) {
    lastVideoTime = camVideo.currentTime;
    const result = landmarker.detectForVideo(camVideo, performance.now());

    ctx.clearRect(0, 0, camCanvas.width, camCanvas.height);

    if (result.landmarks?.length) {
      const lm = result.landmarks[0];
      // 世界坐标（米制 3D）对手掌朝向更鲁棒；不可用时退回屏幕坐标
      const wlm = result.worldLandmarks?.[0] ?? lm;
      handPresent = true;
      targetProgress = handCloseProgress(wlm);
      drawSkeleton(lm);
      camState.textContent =
        targetProgress > 0.6 ? "聚拢 · 揉皱" : targetProgress < 0.35 ? "张开 · 展开" : "过渡中";
      camPct.textContent = Math.round(targetProgress * 100) + "%";
    } else {
      handPresent = false;
      camState.textContent = "未检测到手";
      camPct.textContent = "--";
    }
    meterFill.style.width = (handPresent ? smoothProgress * 100 : 0) + "%";
  }
  requestAnimationFrame(track);
}

const FINGERTIPS = new Set([4, 8, 12, 16, 20]);

function drawSkeleton(lm) {
  const w = camCanvas.width, h = camCanvas.height;

  // 骨架连线：白色细线 + 轻微辉光
  ctx.save();
  ctx.shadowColor = "rgba(255,255,255,0.55)";
  ctx.shadowBlur = 6;
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.beginPath();
  for (const [a, b] of HAND_CONNECTIONS) {
    ctx.moveTo(lm[a].x * w, lm[a].y * h);
    ctx.lineTo(lm[b].x * w, lm[b].y * h);
  }
  ctx.stroke();
  ctx.restore();

  // 关节：白色小点；指尖：绿色强调点
  for (let i = 0; i < lm.length; i++) {
    const x = lm[i].x * w, y = lm[i].y * h;
    const tip = FINGERTIPS.has(i);
    ctx.beginPath();
    ctx.arc(x, y, tip ? 5 : 3, 0, Math.PI * 2);
    ctx.fillStyle = tip ? "#2fe07a" : "rgba(255,255,255,0.95)";
    ctx.fill();
    if (tip) {
      ctx.beginPath();
      ctx.arc(x, y, 8, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(47,224,122,0.35)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }
}

init();

/* ---------------- 悬浮窗：拖动 ---------------- */
const win = document.getElementById("camWindow");
const dragHandle = document.getElementById("camDragHandle");
const resizeHandle = document.getElementById("camResizeHandle");
const camToggle = document.getElementById("camToggle");

// 折叠 / 展开
camToggle.addEventListener("click", () => {
  win.classList.toggle("is-collapsed");
});

dragHandle.addEventListener("pointerdown", (e) => {
  if (e.target.closest(".cam__min")) return; // 按钮不触发拖动
  e.preventDefault();
  dragHandle.setPointerCapture(e.pointerId);
  const rect = win.getBoundingClientRect();
  // 默认由 CSS 右下角锚定；开始拖动时切换为像素定位
  win.style.left = rect.left + "px";
  win.style.top = rect.top + "px";
  win.style.right = "auto";
  win.style.bottom = "auto";
  const offX = e.clientX - rect.left;
  const offY = e.clientY - rect.top;

  const onMove = (ev) => {
    const x = Math.min(Math.max(ev.clientX - offX, 8), innerWidth - rect.width - 8);
    const y = Math.min(Math.max(ev.clientY - offY, 8), innerHeight - rect.height - 8);
    win.style.left = x + "px";
    win.style.top = y + "px";
  };
  const onUp = () => {
    dragHandle.removeEventListener("pointermove", onMove);
    dragHandle.removeEventListener("pointerup", onUp);
  };
  dragHandle.addEventListener("pointermove", onMove);
  dragHandle.addEventListener("pointerup", onUp);
});

/* ---------------- 悬浮窗：调整大小 ---------------- */
resizeHandle.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  resizeHandle.setPointerCapture(e.pointerId);
  const startW = win.getBoundingClientRect().width;
  const startX = e.clientX;

  const onMove = (ev) => {
    const w = Math.min(Math.max(startW + (ev.clientX - startX), 200), 560);
    win.style.width = w + "px"; // 高度由 aspect-ratio 自适应
  };
  const onUp = () => {
    resizeHandle.removeEventListener("pointermove", onMove);
    resizeHandle.removeEventListener("pointerup", onUp);
  };
  resizeHandle.addEventListener("pointermove", onMove);
  resizeHandle.addEventListener("pointerup", onUp);
});
