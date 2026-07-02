/* =========================================================
 * AI Coach — gesture-driven fold video
 * handCloseProgress: 0 = open hand (portrait) → 1 = fist/pinch (paper ball)
 * video.currentTime tracks the gesture in real time;
 * with no hand detected the current frame is frozen.
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

/* ---------------- Hand skeleton topology ---------------- */
const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],          // thumb
  [0, 5], [5, 6], [6, 7], [7, 8],          // index
  [5, 9], [9, 10], [10, 11], [11, 12],     // middle
  [9, 13], [13, 14], [14, 15], [15, 16],   // ring
  [13, 17], [17, 18], [18, 19], [19, 20],  // pinky
  [0, 17],                                 // palm edge
];

/* ---------------- Gesture → progress ---------------- */
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0));
const clamp01 = (v) => Math.min(1, Math.max(0, v));

/**
 * Compute handCloseProgress.
 * 0 = fully open hand; 1 = closed / fist / pinch.
 */
function handCloseProgress(lm) {
  const palm = dist(lm[0], lm[9]) || 1e-6; // palm scale (wrist → middle MCP)

  // 1) Curl: average fingertip-to-wrist distance, normalized by palm scale
  const tips = [8, 12, 16, 20];
  const avg = tips.reduce((s, i) => s + dist(lm[i], lm[0]), 0) / tips.length / palm;
  const OPEN = 1.9, CLOSED = 1.05; // open ≈ 1.9+, fist ≈ 1.0
  const curl = clamp01((OPEN - avg) / (OPEN - CLOSED));

  // 2) Pinch: thumb tip ↔ index tip
  const pinchDist = dist(lm[4], lm[8]) / palm;
  const pinch = clamp01((0.9 - pinchDist) / 0.65);

  return Math.max(curl, pinch);
}

/* ---------------- Video timeline driver ---------------- */
let targetProgress = 0;   // raw gesture target
let smoothProgress = 0;   // smoothed value
let handPresent = false;
let ready = false;

// Load as a Blob so the timeline is fully seekable.
// (Static servers without HTTP Range support report seekable as [0,0],
// which silently snaps every currentTime write back to 0.)
(async () => {
  const blob = await (await fetch("fold.mp4")).blob();
  foldVideo.src = URL.createObjectURL(blob);
  foldVideo.addEventListener(
    "loadedmetadata",
    () => {
      foldVideo.currentTime = 0.001; // start on the unfolded portrait (decodes first frame)
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
      foldVideo.currentTime = t; // scrub the timeline in real time
    }
  }
  // No hand: hold the current frame — never autoplay.
  requestAnimationFrame(driveVideo);
}
requestAnimationFrame(driveVideo);

/* ---------------- Camera + MediaPipe ---------------- */
let landmarker = null;

async function init() {
  try {
    camState.textContent = "Loading model…";
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

    camState.textContent = "Requesting camera…";
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
    camState.textContent = "Camera unavailable";
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
      // Metric 3D world landmarks are robust to hand orientation;
      // fall back to screen-space landmarks if unavailable.
      const wlm = result.worldLandmarks?.[0] ?? lm;
      handPresent = true;
      targetProgress = handCloseProgress(wlm);
      drawSkeleton(lm);
      camState.textContent =
        targetProgress > 0.6 ? "Closed · Crumple" : targetProgress < 0.35 ? "Open · Unfold" : "Transitioning";
      camPct.textContent = Math.round(targetProgress * 100) + "%";
    } else {
      handPresent = false;
      camState.textContent = "No hand detected";
      camPct.textContent = "--";
    }
    meterFill.style.width = (handPresent ? smoothProgress * 100 : 0) + "%";
  }
  requestAnimationFrame(track);
}

const FINGERTIPS = new Set([4, 8, 12, 16, 20]);

function drawSkeleton(lm) {
  const w = camCanvas.width, h = camCanvas.height;

  // Bones: thin white lines with a soft glow
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

  // Joints: small white dots; fingertips: green accent rings
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

/* ---------------- Camera window: drag ---------------- */
// The window lives in normal flow (its footer slot stays reserved),
// so dragging moves it with a transform instead of repositioning.
const win = document.getElementById("camWindow");
const dragHandle = document.getElementById("camDragHandle");
const resizeHandle = document.getElementById("camResizeHandle");
const camToggle = document.getElementById("camToggle");

// Collapse / expand
camToggle.addEventListener("click", () => {
  win.classList.toggle("is-collapsed");
});

let dragX = 0, dragY = 0; // current translate offsets

dragHandle.addEventListener("pointerdown", (e) => {
  if (e.target.closest(".cam__min")) return; // the button must not start a drag
  e.preventDefault();
  dragHandle.setPointerCapture(e.pointerId);

  const rect = win.getBoundingClientRect(); // includes the current transform
  const startX = e.clientX, startY = e.clientY;
  const baseX = dragX, baseY = dragY;

  // Keep the window inside the viewport (8px margin)
  const minDX = baseX + 8 - rect.left;
  const maxDX = baseX + innerWidth - rect.width - 8 - rect.left;
  const minDY = baseY + 8 - rect.top;
  const maxDY = baseY + innerHeight - rect.height - 8 - rect.top;

  const onMove = (ev) => {
    dragX = Math.min(Math.max(baseX + ev.clientX - startX, minDX), maxDX);
    dragY = Math.min(Math.max(baseY + ev.clientY - startY, minDY), maxDY);
    win.style.transform = `translate(${dragX}px, ${dragY}px)`;
  };
  const onUp = () => {
    dragHandle.removeEventListener("pointermove", onMove);
    dragHandle.removeEventListener("pointerup", onUp);
  };
  dragHandle.addEventListener("pointermove", onMove);
  dragHandle.addEventListener("pointerup", onUp);
});

/* ---------------- Camera window: resize ---------------- */
resizeHandle.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  resizeHandle.setPointerCapture(e.pointerId);
  const startW = win.getBoundingClientRect().width;
  const startX = e.clientX;

  const onMove = (ev) => {
    const w = Math.min(Math.max(startW + (ev.clientX - startX), 200), 480);
    win.style.width = w + "px"; // height follows via aspect-ratio
  };
  const onUp = () => {
    resizeHandle.removeEventListener("pointermove", onMove);
    resizeHandle.removeEventListener("pointerup", onUp);
  };
  resizeHandle.addEventListener("pointermove", onMove);
  resizeHandle.addEventListener("pointerup", onUp);
});
