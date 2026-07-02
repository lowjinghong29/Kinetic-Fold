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

let themeLum = 255; // eased copy of the backdrop luminance

/* Piecewise gesture -> timeline map.
 * The footage's backdrop fades white -> black between ~1.6s and ~3.5s,
 * very early in the 10s timeline — so a small fold used to already hit black.
 * Remap: hold the white portrait for the first 45% of the fold, stretch the
 * white -> black fade across the 45-75% band, and finish the crumple in the
 * black zone on the last quarter. A full fist still lands on the paper ball. */
const FADE_START = 1.6, FADE_END = 3.5; // seconds in the footage
const HOLD_WHITE = 0.6, FADE_DONE = 0.85; // gesture progress breakpoints
function gestureToTime(p, dur) {
  const end = Math.max(dur - 0.05, 0);
  if (p <= HOLD_WHITE) return (p / HOLD_WHITE) * FADE_START;
  if (p <= FADE_DONE)
    return FADE_START + ((p - HOLD_WHITE) / (FADE_DONE - HOLD_WHITE)) * (FADE_END - FADE_START);
  return FADE_END + ((p - FADE_DONE) / (1 - FADE_DONE)) * (end - FADE_END);
}

function driveVideo() {
  if (ready && handPresent && !foldVideo.seeking) {
    smoothProgress += (targetProgress - smoothProgress) * 0.14;
    const t = gestureToTime(smoothProgress, foldVideo.duration);
    if (Math.abs(t - foldVideo.currentTime) > 0.02) {
      foldVideo.currentTime = t; // scrub the timeline in real time
    }
  }
  // The page theme tracks the frame that's on screen, hand or no hand,
  // eased so fast gestures never make the background snap.
  if (ready) {
    themeLum += (bgLumAt(foldVideo.currentTime) - themeLum) * 0.09; /* slower, longer glide */
    applyTheme(themeLum);
  }
  requestAnimationFrame(driveVideo);
}
requestAnimationFrame(driveVideo);

/* ---------------- Background sync: page follows the video backdrop ----------------
 * BG_LUM holds the measured luminance (0-255) of fold.mp4's studio backdrop,
 * one entry per frame at 24 fps (measured offline from the source footage;
 * every frame after the table is fully black). Driving the page background
 * from this table keeps it exactly in sync with the video as the backdrop
 * fades white → black between ~1.6s and ~3.5s.
 * ------------------------------------------------------------------------ */
const BG_FPS = 24;
const BG_LUM = [
  254, 253, 253, 253, 253, 253, 253, 253, 253, 253, 253, 253, 253, 254, 254,
  254, 254, 254, 254, 254, 253, 253, 253, 253, 253, 254, 254, 254, 254, 254,
  254, 254, 254, 254, 254, 254, 254, 254, 250, 248, 247, 242, 236, 236, 233,
  229, 219, 219, 212, 206, 192, 192, 183, 176, 162, 162, 154, 146, 128, 128,
  120, 101, 95, 95, 87, 71, 63, 62, 54, 42, 36, 36, 31, 22, 18, 18, 12, 6, 6,
  6, 2, 1, 1, 1, 0,
];

function bgLumAt(t) {
  const f = Math.max(t, 0) * BG_FPS;
  const i = Math.floor(f);
  const a = i < BG_LUM.length ? BG_LUM[i] : 0;
  const b = i + 1 < BG_LUM.length ? BG_LUM[i + 1] : 0;
  return a + (b - a) * (f - i);
}

const rootStyle = document.documentElement.style;
const lerp = (a, b, t) => a + (b - a) * t;
let appliedLum = -1;

function applyTheme(lum) {
  if (Math.abs(lum - appliedLum) < 0.35) return; // skip no-op style recalcs
  appliedLum = lum;

  const v = Math.round(lum);
  // Ink flips over a narrow band (bg 118 → 96) so contrast never lingers low.
  const d = clamp01((118 - lum) / 22);
  const ink = Math.round(lerp(17, 244, d));
  const mut = Math.round(lerp(96, 166, d));

  rootStyle.setProperty("--paper", `rgb(${v}, ${v}, ${v})`);
  rootStyle.setProperty("--paper-rgb", `${v}, ${v}, ${v}`);
  rootStyle.setProperty("--ink", `rgb(${ink}, ${ink}, ${ink})`);
  rootStyle.setProperty("--ink-rgb", `${ink}, ${ink}, ${ink}`);
  rootStyle.setProperty("--muted", `rgb(${mut}, ${mut}, ${mut})`);
  rootStyle.setProperty(
    "--hairline",
    d > 0.5 ? "rgba(255, 255, 255, 0.18)" : "rgba(17, 17, 17, 0.12)"
  );
}

/* ---------------- Camera + MediaPipe ---------------- */
let landmarker = null;

async function init() {
  try {
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

    const stream = await openCamera();
    camVideo.srcObject = stream;
    await camVideo.play();
    camCanvas.width = camVideo.videoWidth;
    camCanvas.height = camVideo.videoHeight;

    requestAnimationFrame(track);
  } catch (err) {
    console.error(err);
  }
}

/* Open the default camera; if it is locked by another app (common with
   vendor "privacy view" layers or virtual cameras), fall back to trying
   every other video input until one opens. */
async function openCamera() {
  const base = { width: 640, height: 480 };
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: { ...base, facingMode: "user" },
      audio: false,
    });
  } catch (err) {
    if (err.name !== "NotReadableError" && err.name !== "AbortError") throw err;
    const inputs = (await navigator.mediaDevices.enumerateDevices()).filter(
      (d) => d.kind === "videoinput"
    );
    for (const d of inputs) {
      try {
        return await navigator.mediaDevices.getUserMedia({
          video: { ...base, deviceId: { exact: d.deviceId } },
          audio: false,
        });
      } catch {
        /* try the next device */
      }
    }
    throw err; // nothing opened — surface the original error
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
    } else {
      handPresent = false;
    }
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
const resizeHandle = document.getElementById("camResizeHandle");

let dragX = 0, dragY = 0; // current translate offsets

win.addEventListener("pointerdown", (e) => {
  if (e.target.closest(".cam__resize")) return; // resize corner must not start a drag
  e.preventDefault();
  win.setPointerCapture(e.pointerId);

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
    win.removeEventListener("pointermove", onMove);
    win.removeEventListener("pointerup", onUp);
  };
  win.addEventListener("pointermove", onMove);
  win.addEventListener("pointerup", onUp);
});

/* ---------------- Camera window: resize ---------------- */
resizeHandle.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  resizeHandle.setPointerCapture(e.pointerId);
  const startW = win.getBoundingClientRect().width;
  const startX = e.clientX;

  const onMove = (ev) => {
    const w = Math.min(Math.max(startW + (ev.clientX - startX), 240), 520);
    win.style.width = w + "px"; // height follows via aspect-ratio
  };
  const onUp = () => {
    resizeHandle.removeEventListener("pointermove", onMove);
    resizeHandle.removeEventListener("pointerup", onUp);
  };
  resizeHandle.addEventListener("pointermove", onMove);
  resizeHandle.addEventListener("pointerup", onUp);
});

/* ---------------- Showcase marquee ---------------- */
// Each track holds two identical halves so the -50% keyframe loops seamlessly.
function buildMarquee(trackId, row) {
  const track = document.getElementById(trackId);
  const shots = document
    .getElementById("shotTemplates")
    .content.querySelectorAll(`.shot[data-row="${row}"]`);
  for (let half = 0; half < 2; half++) {
    for (let rep = 0; rep < 2; rep++) {
      for (const shot of shots) {
        const node = shot.cloneNode(true);
        if (half === 1) node.setAttribute("aria-hidden", "true"); // duplicate half
        track.appendChild(node);
      }
    }
  }
}
buildMarquee("marqueeA", "a");
buildMarquee("marqueeB", "b");

/* ---------------- Scroll reveals ---------------- */
const revealObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-in");
        revealObserver.unobserve(entry.target);
      }
    }
  },
  { threshold: 0.15, rootMargin: "0px 0px -8% 0px" }
);
document.querySelectorAll("[data-reveal]").forEach((el) => revealObserver.observe(el));
