# Kinetic Fold

A minimal, full-screen hero page for designer **AI Coach** — where a paper-crumple portrait video is scrubbed in real time by your hand.

Open your hand and the crumpled paper ball unfolds into a portrait. Close it into a fist (or pinch) and the portrait crumples back up. No buttons, no scrollbar — the video timeline **is** your hand.

**[Live demo →](https://lowjinghong29.github.io/Kinetic-Fold/ai-coach-hero/)** *(needs a webcam; allow camera access)*

![Preview](preview.png)

## How it works

- **Hand tracking** — [MediaPipe Tasks Vision](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker) `HandLandmarker` runs on the webcam feed and returns 21 3D landmarks per frame
- **Gesture → progress** — `handCloseProgress` (0 = open, 1 = fist/pinch) is computed from metric *world landmarks*: average fingertip-to-wrist distance normalized by palm size, combined with thumb–index pinch distance. World coordinates keep it robust to hand orientation
- **Progress → timeline** — the smoothed progress is mapped straight onto `video.currentTime`, so the fold animation tracks your hand with no playback of its own. No hand detected = the frame freezes
- **Seekable anywhere** — the video is fetched as a Blob (object URLs are always fully seekable, even on static servers without HTTP Range support) and re-encoded all-intra (`-g 1`) so every frame is a keyframe and scrubbing never stutters
- **Background removal** — the white-studio footage sits on a white page with `mix-blend-mode: multiply`, so only the paper head remains visible
- **Camera PiP** — a draggable, resizable device-style window with viewfinder brackets, live skeleton overlay, and a gesture HUD showing the open↔closed meter

## Run locally

Camera access requires a secure context (HTTPS or localhost):

```bash
cd ai-coach-hero
python -m http.server 8931
# open http://localhost:8931
```

## Stack

Vanilla HTML/CSS/JS · MediaPipe Tasks Vision (CDN) · no build step

## Structure

```
ai-coach-hero/
├── index.html   # hero layout + camera PiP markup
├── style.css    # white minimal theme, device-style PiP
├── app.js       # hand tracking, gesture math, timeline driver
└── fold.mp4     # paper-crumple video (cropped, all-intra)
```
