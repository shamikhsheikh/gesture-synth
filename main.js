import { HandLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

// =======================================================
// DOM References
// =======================================================
const videoEl = document.getElementById("webcam");
const canvasEl = document.getElementById("overlay");
const ctx = canvasEl.getContext("2d");

const gestureGuideEl = document.getElementById("gestureGuide");
const guideToggleEl = document.getElementById("guideToggle");
const guideToggleTextEl = document.getElementById("guideToggleText");
const leftHandPanelEl = document.getElementById("leftHandPanel");
const rightHandPanelEl = document.getElementById("rightHandPanel");

const chordDisplayEl = document.getElementById("chordDisplay");
const volumeBarEls = Array.from(document.querySelectorAll(".vol-bar"));
const qualityDisplayEl = document.getElementById("qualityDisplay");
const distortionDisplayEl = document.getElementById("distortionDisplay");
const volumePercentDisplayEl = document.getElementById("volumePercentDisplay");

const startOverlayEl = document.getElementById("startOverlay");
const startPlayBtnEl = document.getElementById("startPlayBtn");

const keySelectEl = document.getElementById("keySelect");
const toneSelectEl = document.getElementById("toneSelect");

const helpButton = document.getElementById("helpButton");
const helpModal = document.getElementById("helpModal");
const closeHelp = document.getElementById("closeHelp");

// Additional Controls
const resetBtnEl = document.getElementById("resetBtn");
const cameraToggleBtnEl = document.getElementById("cameraToggleBtn");
const cameraToggleIconEl = document.getElementById("cameraToggleIcon");
const cameraToggleTextEl = document.getElementById("cameraToggleText");

const cameraErrorBannerEl = document.getElementById("cameraErrorBanner");
const cameraErrorTitleEl = document.getElementById("cameraErrorTitle");
const cameraErrorMessageEl = document.getElementById("cameraErrorMessage");
const retryCameraBtnEl = document.getElementById("retryCameraBtn");

// Status Badges
const camStatusTextEl = document.getElementById("camStatusText");
const camStatusBadgeEl = document.getElementById("camStatusBadge");
const audioStatusTextEl = document.getElementById("audioStatusText");
const audioStatusBadgeEl = document.getElementById("audioStatusBadge");
const trackingStatusTextEl = document.getElementById("trackingStatusText");

const leftHandDetectedBadgeEl = document.getElementById("leftHandDetectedBadge");
const rightHandDetectedBadgeEl = document.getElementById("rightHandDetectedBadge");
const leftModeBadgeEl = document.getElementById("leftModeBadge");
const tiltMajorCardEl = document.getElementById("tiltMajorCard");
const tiltMinorCardEl = document.getElementById("tiltMinorCard");

const voicingCardEls = [
  null,
  document.getElementById("voicingCard1"),
  document.getElementById("voicingCard2"),
  document.getElementById("voicingCard3"),
  document.getElementById("voicingCard4"),
];
const octaveBadgeEl = document.getElementById("octaveBadge");
const octaveCardEl = document.getElementById("octaveCard");

// Safe tracking placeholder
function trackClarityEvent(eventName) {
  if (typeof window.clarity === "function") {
    try {
      window.clarity("event", eventName);
    } catch {}
  }
}

// =======================================================
// Finger Landmark Calculations (Original Logic Preserved)
// =======================================================
const FINGERS = {
  index:  { pip: 6, tip: 8 },
  middle: { pip: 10, tip: 12 },
  ring:   { pip: 14, tip: 16 },
  pinky:  { pip: 18, tip: 20 },
};

function isFingerExtended(landmarks, name) {
  const { pip, tip } = FINGERS[name];
  return landmarks[tip].y < landmarks[pip].y;
}

function isThumbExtended(landmarks, handedness) {
  const thumbTip = landmarks[4];
  const thumbIp = landmarks[3];

  if (handedness === "Right") {
    return thumbTip.x > thumbIp.x;
  } else {
    return thumbTip.x < thumbIp.x;
  }
}

function getChordQuality(landmarks) {
  const wrist = landmarks[0];
  const middleMcp = landmarks[9]; // middle finger MCP joint
  return middleMcp.x > wrist.x ? "minor" : "major";
}

function classifyChord(landmarks, handedness) {
  const thumb = isThumbExtended(landmarks, handedness);
  const index = isFingerExtended(landmarks, "index");
  const middle = isFingerExtended(landmarks, "middle");
  const ring = isFingerExtended(landmarks, "ring");
  const pinky = isFingerExtended(landmarks, "pinky");

  const quality = getChordQuality(landmarks);

  if (index && pinky && !middle && !ring && !thumb) {
    return quality === "major" ? "VI" : "vi";
  }

  if (index && pinky && !middle && !ring && thumb) {
    return quality === "major" ? "VII" : "vii";
  }

  const count = [thumb, index, middle, ring, pinky].filter(Boolean).length;
  const ROMAN = { 1: "I", 2: "II", 3: "III", 4: "IV", 5: "V" };
  const base = ROMAN[count];
  if (!base) return null;

  return quality === "major" ? base : base.toLowerCase();
}

function getHandHorizontalTilt(landmarks, handedness) {
  if (!landmarks || typeof landmarks.length === "undefined" || landmarks.length < 18) {
    return 0;
  }

  try {
    const wrist = landmarks[0];     // Wrist Base
    const middleMcp = landmarks[9];  // Middle Knuckle (Left pillar)
    const ringMcp = landmarks[13];  // Ring Knuckle (Right pillar)

    if (!wrist || !middleMcp || !ringMcp) return 0;

    const minX = Math.min(middleMcp.x, ringMcp.x);
    const maxX = Math.max(middleMcp.x, ringMcp.x);

    let tiltFactor = 0;
    const MAX_TRAVEL = 0.12; 

    if (wrist.x < minX) {
      tiltFactor = (wrist.x - minX) / MAX_TRAVEL;
    } else if (wrist.x > maxX) {
      tiltFactor = (wrist.x - maxX) / MAX_TRAVEL;
    } else {
      tiltFactor = 0;
    }

    tiltFactor = Math.max(-1, Math.min(1, tiltFactor));

    if (handedness === "Right") {
      tiltFactor = -tiltFactor;
    }

    return tiltFactor;
  } catch (error) {
    console.error("Buffered tilt calculation failed:", error);
    return 0;
  }
}

// =======================================================
// Canvas Visualizer (Original Energy Waves Preserved)
// =======================================================
function drawEnergy(ctx, volume01, qualityIndex, tiltFactor, chordStr) {
  if (!ctx) return;
  if (qualityIndex === 0) return;
  const lineCount = qualityIndex; // 1 to 4 lines

  try {
    const centerY = ctx.canvas.height - 56;
    const canvasWidth = ctx.canvas.width;

    const maxThickness = 1 + (volume01 * 8);
    const chaosScale = (tiltFactor + 1) / 2;
    const shakinessAmp = chaosScale * 25;
    const shakinessFreq = 0.05 + (chaosScale * 0.15); 

    let baseColorRGB = "150, 150, 150";
    let isChordActive = false;
    let isMajor = false;

    if (chordStr && chordStr !== "--") {
      isChordActive = true;
      const upperStr = chordStr.toUpperCase();
      isMajor = (chordStr === upperStr);

      const SCALE_COLORS = {
        "I":   "232, 161, 61",
        "II":  "210, 50, 120",
        "III": "180, 40, 150",
        "IV":  "240, 210, 40",
        "V":   "245, 120, 30",
        "VI":  "230, 40, 40",
        "VII": "100, 200, 250"
      };
      baseColorRGB = SCALE_COLORS[upperStr] || "232, 161, 61";
    }

    const brightnessAlpha = isChordActive ? (isMajor ? 1 : 0.70) : 0.3;

    ctx.save();
    const time = performance.now() * 0.004;

    const colorChannels = baseColorRGB.split(",");
    const r = parseInt(colorChannels[0]);
    const g = parseInt(colorChannels[1]);
    const b = parseInt(colorChannels[2]);

    ctx.shadowBlur = 10 + (volume01 * 20);
    ctx.shadowColor = `rgba(${r}, ${g}, ${b}, ${0.5 * brightnessAlpha})`;

    for (let l = 0; l < lineCount; l++) {
      ctx.beginPath();
      const lineYOffset = centerY + (l - (lineCount - 1) / 2) * 12;

      for (let x = 0; x <= canvasWidth; x += 10) {
        const baseSine = Math.sin(x * 0.005 + time + l * 0.5) * 20;
        const jitter = (Math.random() - 0.5) * shakinessAmp * Math.sin(x * shakinessFreq + time);
        const y = lineYOffset + baseSine + jitter;

        if (x === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }

      ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${brightnessAlpha})`;
      ctx.lineWidth = Math.max(1, maxThickness - (l * 0.5));
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();
    }

    ctx.restore();
  } catch (error) {
    console.error("Wave animation failed:", error);
  }
}

// =======================================================
// Gesture Stabilizers
// =======================================================
const CHORD_HOLD_TIME_MS = 100;
const VIBE_NULL_WINDOW_MS = 50;

let stableChordState = null;
let candidateChordState = null;
let candidateChordSince = 0;
let lastChordSeenValidTime = 0;

function sameChordState(a, b) {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;

  return (
    a.chord === b.chord &&
    a.isMajorMode === b.isMajorMode &&
    a.qualityIndex === b.qualityIndex &&
    a.thumbDown === b.thumbDown
  );
}

function stabilizeChordState(rawState, now) {
  if (rawState !== null) {
    lastChordSeenValidTime = now;
  }

  let effectiveState = rawState;

  if (rawState === null && now - lastChordSeenValidTime < VIBE_NULL_WINDOW_MS) {
    effectiveState = candidateChordState;
  }

  if (!sameChordState(effectiveState, candidateChordState)) {
    candidateChordState = effectiveState;
    candidateChordSince = now;
  }

  if (now - candidateChordSince >= CHORD_HOLD_TIME_MS) {
    stableChordState = candidateChordState;
  }

  return stableChordState;
}

// =======================================================
// Right Hand Height & Voicings
// =======================================================
function getVolumeFromHeight(landmarks) {
  const wrist = landmarks[0];
  const TOP = 0.05;
  const BOTTOM = 0.95;

  const clamped = Math.max(TOP, Math.min(BOTTOM, wrist.y));
  const t = (clamped - TOP) / (BOTTOM - TOP);
  return 1 - t;
}

function updateVolumeMeter(volume01) {
  const litCount = Math.round(volume01 * volumeBarEls.length);
  volumeBarEls.forEach((bar) => {
    const index = Number(bar.dataset.index);
    bar.classList.toggle("lit", index < litCount);
  });
  if (volumePercentDisplayEl) {
    volumePercentDisplayEl.textContent = `${Math.round(volume01 * 100)}%`;
  }
}

function getRightHandQualityIndex(landmarks) {
  const index = isFingerExtended(landmarks, "index");
  const middle = isFingerExtended(landmarks, "middle");
  const ring = isFingerExtended(landmarks, "ring");
  const pinky = isFingerExtended(landmarks, "pinky");

  return [index, middle, ring, pinky].filter(Boolean).length;
}

// =======================================================
// Camera & Video Setup with Clean Error Management
// =======================================================
let isCameraRunning = false;
let currentStream = null;

function hideCameraError() {
  if (cameraErrorBannerEl) {
    cameraErrorBannerEl.classList.add("hidden");
  }
}

function showCameraError(title, message) {
  if (cameraErrorBannerEl) {
    cameraErrorBannerEl.classList.remove("hidden");
    if (cameraErrorTitleEl) cameraErrorTitleEl.textContent = title;
    if (cameraErrorMessageEl) cameraErrorMessageEl.textContent = message;
  }
  if (camStatusTextEl) camStatusTextEl.textContent = "Camera: Error";
  if (camStatusBadgeEl) {
    const dot = camStatusBadgeEl.querySelector(".status-dot");
    if (dot) dot.className = "status-dot w-2 h-2 rounded-full bg-red-500";
  }
}

async function setupCamera() {
  hideCameraError();
  if (camStatusTextEl) camStatusTextEl.textContent = "Camera: Requesting...";

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showCameraError("Camera API Unsupported", "Your browser or context does not support camera capture. Please use a modern browser over HTTPS.");
    throw new Error("getUserMedia not supported");
  }

  try {
    // If a stream is already active, stop it cleanly
    stopCamera();

    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 640 },
        height: { ideal: 480 },
        facingMode: "user"
      },
      audio: false,
    });

    currentStream = stream;
    videoEl.srcObject = stream;

    return new Promise((resolve) => {
      const onReady = () => {
        videoEl.play().catch(e => console.warn("Video play interrupted:", e));
        isCameraRunning = true;
        if (camStatusTextEl) camStatusTextEl.textContent = "Camera: Active";
        if (camStatusBadgeEl) {
          const dot = camStatusBadgeEl.querySelector(".status-dot");
          if (dot) dot.className = "status-dot w-2 h-2 rounded-full bg-emerald-400";
        }
        if (cameraToggleTextEl) cameraToggleTextEl.textContent = "Pause";
        if (cameraToggleIconEl) cameraToggleIconEl.textContent = "⏸️";
        resolve();
      };

      if (videoEl.readyState >= 1) {
        onReady();
      } else {
        videoEl.onloadedmetadata = () => onReady();
      }
    });
  } catch (err) {
    console.error("Camera access failed:", err);
    if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
      showCameraError(
        "Camera Permission Denied",
        "Camera access was blocked. Please click the camera icon in your browser's address bar, select 'Allow', then click 'Retry Camera'."
      );
    } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
      showCameraError(
        "Camera Not Found",
        "No webcam was detected. Please connect a camera and click 'Retry Camera'."
      );
    } else if (err.name === "NotReadableError" || err.name === "TrackStartError") {
      showCameraError(
        "Camera In Use",
        "Your webcam is in use by another application or tab. Please close other camera apps and retry."
      );
    } else {
      showCameraError("Camera Error", err.message || "Failed to initialize webcam.");
    }
    throw err;
  }
}

function stopCamera() {
  if (currentStream) {
    currentStream.getTracks().forEach((track) => {
      try { track.stop(); } catch {}
    });
    currentStream = null;
  }
  isCameraRunning = false;
  if (camStatusTextEl) camStatusTextEl.textContent = "Camera: Stopped";
  if (camStatusBadgeEl) {
    const dot = camStatusBadgeEl.querySelector(".status-dot");
    if (dot) dot.className = "status-dot w-2 h-2 rounded-full bg-neutral-500";
  }
  if (cameraToggleTextEl) cameraToggleTextEl.textContent = "Resume";
  if (cameraToggleIconEl) cameraToggleIconEl.textContent = "📷";
}

function toggleCamera() {
  if (isCameraRunning) {
    stopCamera();
  } else {
    setupCamera().catch(() => {});
  }
}

if (cameraToggleBtnEl) {
  cameraToggleBtnEl.addEventListener("click", toggleCamera);
}
if (retryCameraBtnEl) {
  retryCameraBtnEl.addEventListener("click", () => {
    setupCamera().catch(() => {});
  });
}

// Clean up camera stream when user closes the tab
window.addEventListener("beforeunload", () => {
  stopCamera();
});

// =======================================================
// MediaPipe Task Loading with GPU -> CPU Fallback
// =======================================================
async function setupHandLandmarker() {
  if (trackingStatusTextEl) trackingStatusTextEl.textContent = "⏳ Loading AI Vision...";

  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
  );
  
  let landmarker = null;
  try {
    landmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numHands: 2,
    });
  } catch (e) {
    console.warn("GPU delegate unavailable, attempting CPU delegate:", e);
    landmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
        delegate: "CPU",
      },
      runningMode: "VIDEO",
      numHands: 2,
    });
  }

  if (trackingStatusTextEl) trackingStatusTextEl.textContent = "✋ Show hands to camera";
  return landmarker;
}

// =======================================================
// Musical Guide & Scales (Original Music Theory Preserved)
// =======================================================
const GESTURE_GUIDE = [
  { degree: 1, numeral: "I", gesture: "1️⃣", label: "Tonic (Home)" },
  { degree: 2, numeral: "II", gesture: "2️⃣", label: "Supertonic" },
  { degree: 3, numeral: "III", gesture: "3️⃣", label: "Mediant" },
  { degree: 4, numeral: "IV", gesture: "4️⃣", label: "Subdominant" },
  { degree: 5, numeral: "V", gesture: "5️⃣", label: "Dominant" },
  { degree: 6, numeral: "VI", gesture: "🤘", label: "Submediant (Rock)" },
  { degree: 7, numeral: "VII", gesture: "🤟", label: "Leading Tone (ILY)" }
];

const MAJOR_SCALE = {
  A:  ["A","B","C#","D","E","F#","G#"],
  Bb: ["Bb","C","D","Eb","F","G","A"],
  B:  ["B","C#","D#","E","F#","G#","A#"],
  C:  ["C","D","E","F","G","A","B"],
  Db: ["Db","Eb","F","Gb","Ab","Bb","C"],
  D:  ["D","E","F#","G","A","B","C#"],
  Eb: ["Eb","F","G","Ab","Bb","C","D"],
  E:  ["E","F#","G#","A","B","C#","D#"],
  F:  ["F","G","A","Bb","C","D","E"],
  Gb: ["Gb","Ab","Bb","Cb","Db","Eb","F"],
  G:  ["G","A","B","C","D","E","F#"],
  Ab: ["Ab","Bb","C","Db","Eb","F","G"]
};

function updateGestureGuide() {
  if (!gestureGuideEl) return;

  const scale = MAJOR_SCALE[currentKeyName] || MAJOR_SCALE["A"];

  gestureGuideEl.innerHTML = GESTURE_GUIDE
    .map(({ degree, numeral, gesture, label }) => {
      const noteName = scale[degree - 1] || "";
      return `
        <div class="gesture-guide-row" data-degree="${numeral}">
          <div class="flex items-center gap-2">
            <span class="gesture-guide-gesture">${gesture}</span>
            <span class="text-neutral-300 font-medium">${numeral}</span>
            <span class="text-[10px] text-neutral-400 font-normal">(${label})</span>
          </div>
          <span class="gesture-guide-note">${noteName}</span>
        </div>
      `;
    })
    .join("");
}

function highlightActiveDegree(currentNumeral) {
  if (!gestureGuideEl) return;
  const upper = currentNumeral ? currentNumeral.toUpperCase() : null;
  const rows = gestureGuideEl.querySelectorAll(".gesture-guide-row");
  rows.forEach((row) => {
    if (upper && row.getAttribute("data-degree") === upper) {
      row.classList.add("active");
    } else {
      row.classList.remove("active");
    }
  });
}

// Semitone offset of each scale degree from tonic in major scale
const DEGREE_SEMITONES = { 1: 0, 2: 2, 3: 4, 4: 5, 5: 7, 6: 9, 7: -1 };

let currentTonicFreq = Number(keySelectEl.value);
let currentKeyName = keySelectEl.selectedOptions[0].dataset.note;

updateGestureGuide();

keySelectEl.addEventListener("change", () => {
  currentTonicFreq = Number(keySelectEl.value);
  currentKeyName = keySelectEl.selectedOptions[0].dataset.note;
  updateGestureGuide();
});

let currentWaveform = toneSelectEl.value;

toneSelectEl.addEventListener("change", () => {
  currentWaveform = toneSelectEl.value;
  synth.currentKey = null; // force sound refresh
});

function getDegreeFreq(degree) {
  const semitones = DEGREE_SEMITONES[degree];
  let tonic = currentTonicFreq;

  if (
    tonic === 369.99 || // Gb/F#
    tonic === 392.00 || // G
    tonic === 415.30    // Ab/G#
  ) {
    tonic /= 2;
  }

  return tonic * Math.pow(2, semitones / 12);
}

const NUMERAL_TO_DEGREE = {
  I: 1,
  II: 2,
  III: 3,
  IV: 4,
  V: 5,
  VI: 6,
  VII: 7
};

function getChordName(roman, isMajorMode) {
  if (!roman || roman === "--") return "";

  const degree = NUMERAL_TO_DEGREE[roman.toUpperCase()];
  if (!degree) return "";

  const root = MAJOR_SCALE[currentKeyName][degree - 1];
  return isMajorMode ? root : root + "m";
}

function getChordTones(numeralStr, isMajorMode) {
  if (!numeralStr || numeralStr === "--") return null;

  const degree = NUMERAL_TO_DEGREE[numeralStr.toUpperCase()];
  if (!degree) return null;

  const root = getDegreeFreq(degree); 
  const thirdSemitones = isMajorMode ? 4 : 3;
  const fifthSemitones = 7;

  const maj7Semitones = 11;
  const dom7Semitones = 10;
  const dim7Semitones = 9;

  const third = root * Math.pow(2, thirdSemitones / 12);
  const fifth = root * Math.pow(2, fifthSemitones / 12);
  
  const octaveRoot = root * 2;
  const octaveThird = third * 2;

  const maj7Tone = root * Math.pow(2, maj7Semitones / 12);
  const dom7Tone = root * Math.pow(2, dom7Semitones / 12);
  const dim7Tone = root * Math.pow(2, dim7Semitones / 12);
  const dim5Tone = root * Math.pow(2, 6 / 12);

  return { 
    root, third, fifth, octaveRoot, octaveThird, 
    maj7Tone, dom7Tone, dim7Tone, dim5Tone 
  };
}

function getSolidNotes(tones, rightHandCount, isMajorMode) {
  if (!tones) return [];
  
  const { 
    root, third, fifth, octaveRoot, octaveThird, 
    maj7Tone, dom7Tone, dim7Tone, dim5Tone 
  } = tones;

  if (isMajorMode) {
    switch (rightHandCount) {
      case 1:
        return [root, fifth, octaveRoot, octaveThird];
      case 2:
        return [third, fifth, octaveRoot, octaveThird];
      case 3:
        return [root, third, fifth, maj7Tone];
      case 4:
        return [root, third, fifth, dom7Tone];
      default: 
        return [root, fifth, octaveRoot, octaveThird];
    }
  } else {
    switch (rightHandCount) {
      case 1:
        return [root, fifth, octaveRoot, octaveThird];
      case 2:
        return [third, fifth, octaveRoot, octaveThird];
      case 3:
        return [root, third, fifth, dom7Tone]; 
      case 4:
        return [root, third, dim5Tone, dim7Tone];
      default: 
        return [root, fifth, octaveRoot, octaveThird];
    }
  }
}

// =======================================================
// Web Audio Synth Engine (Robust, Click-Free, Zero Leak)
// =======================================================
class SynthEngine {
  constructor() {
    this.ctx = null;
    this.filter = null;
    this.waveShaper = null;
    this.masterGain = null;
    this.oscillators = [];
    this.currentKey = null;
    this.idleTimer = null;
  }

  ensureContext() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") {
        this.ctx.resume();
      }
      return;
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      console.error("Web Audio API not supported in this browser.");
      return;
    }

    this.ctx = new AudioContextClass();

    this.ctx.onstatechange = () => {
      if (audioStatusTextEl) {
        audioStatusTextEl.textContent = this.ctx.state === "running" ? "Audio: Active" : "Audio: Suspended";
      }
      if (audioStatusBadgeEl) {
        const dot = audioStatusBadgeEl.querySelector(".status-dot");
        if (dot) {
          dot.className = this.ctx.state === "running"
            ? "status-dot w-2 h-2 rounded-full bg-emerald-400"
            : "status-dot w-2 h-2 rounded-full bg-neutral-500";
        }
      }
    };

    this.waveShaper = this.ctx.createWaveShaper();
    this.waveShaper.curve = null;
    this.waveShaper.oversample = "4x";

    this.filter = this.ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = 1200;
    this.filter.Q.value = 0.7;

    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0;

    // Signal chain: oscillators -> waveshaper -> filter -> masterGain -> destination
    this.waveShaper.connect(this.filter);
    this.filter.connect(this.masterGain);
    this.masterGain.connect(this.ctx.destination);

    if (audioStatusTextEl) audioStatusTextEl.textContent = "Audio: Ready";
    if (audioStatusBadgeEl) {
      const dot = audioStatusBadgeEl.querySelector(".status-dot");
      if (dot) dot.className = "status-dot w-2 h-2 rounded-full bg-emerald-400";
    }
  }

  setVolume(volume01) {
    if (!this.ctx || !this.masterGain) return;
    const clamped = Math.max(0, Math.min(1, Number.isFinite(volume01) ? volume01 : 0));
    const now = this.ctx.currentTime;
    try {
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, now);
      this.masterGain.gain.linearRampToValueAtTime(clamped, now + 0.04);
    } catch {
      this.masterGain.gain.value = clamped;
    }
  }

  updateVolume(volume01) {
    this.setVolume(volume01);
  }

  updateFilterSweep(tiltFactor) {
    if (!this.filter || !this.ctx) return;

    let targetFrequency = 1200;
    let targetQ = 0.7;

    if (tiltFactor < 0) {
      const intensity = Math.abs(tiltFactor); 
      targetFrequency = Math.max(100, 1200 - (intensity * 950));
      targetQ = 0.7 + (intensity * 1.5);
    } else if (tiltFactor > 0) {
      targetFrequency = Math.min(12000, 1200 + (tiltFactor * 3800));
      targetQ = 0.7 + (tiltFactor * 4.5);
    }

    const now = this.ctx.currentTime;
    try {
      this.filter.frequency.setTargetAtTime(targetFrequency, now, 0.04);
      this.filter.Q.setTargetAtTime(targetQ, now, 0.04);
    } catch {}
  }

  playNotes(freqs) {
    if (!this.ctx || freqs.length === 0) return;

    if (!hasPlayedFirstSound) {
      hasPlayedFirstSound = true;
      trackClarityEvent("first_sound");
    }

    const key = freqs.map((f) => f.toFixed(1)).join(",");
    if (key === this.currentKey) return;

    // Smoothly stop and disconnect previous oscillators to avoid audible pops and memory buildup
    const now = this.ctx.currentTime;
    const oldOscs = this.oscillators;
    this.oscillators = [];

    oldOscs.forEach((osc) => {
      try {
        osc.stop(now + 0.02);
        setTimeout(() => {
          try { osc.disconnect(); } catch {}
        }, 35);
      } catch {}
    });

    // Create fresh oscillators for new chord notes
    this.oscillators = freqs.map((freq) => {
      const osc = this.ctx.createOscillator();
      osc.type = currentWaveform;
      osc.frequency.value = freq;
      osc.connect(this.waveShaper);
      osc.start(now);
      return osc;
    });

    this.currentKey = key;
  }

  stop() {
    this.setVolume(0);
    const oldOscs = this.oscillators;
    this.oscillators = [];
    oldOscs.forEach((osc) => {
      try {
        osc.stop();
        osc.disconnect();
      } catch {}
    });
    this.currentKey = null;
  }
}

const synth = new SynthEngine();
let hasPlayedFirstSound = false;
let lastTrackedChord = null;

// =======================================================
// User Controls & Interaction
// =======================================================
function handleStartPlaying() {
  synth.ensureContext();
  startOverlayEl.style.display = "none";
  canvasEl.classList.remove("dimmed");
  
  if (!isCameraRunning) {
    setupCamera().catch(() => {});
  }
}

startOverlayEl.addEventListener("click", handleStartPlaying);
if (startPlayBtnEl) {
  startPlayBtnEl.addEventListener("click", (e) => {
    e.stopPropagation();
    handleStartPlaying();
  });
}

// Reset instrument button (essential for booth exhibitions)
function handleReset() {
  synth.stop();
  updateVolumeMeter(0);
  
  keySelectEl.value = "220.00";
  currentTonicFreq = 220.00;
  currentKeyName = "A";
  updateGestureGuide();

  toneSelectEl.value = "triangle";
  currentWaveform = "triangle";

  stableChordState = null;
  candidateChordState = null;
  candidateChordSince = 0;
  lastChordSeenValidTime = 0;
  lastTrackedChord = null;

  if (chordDisplayEl) chordDisplayEl.textContent = "--";
  if (qualityDisplayEl) qualityDisplayEl.textContent = "Hold left hand up to select chord";
  highlightActiveDegree(null);

  if (resetBtnEl) {
    const originalText = resetBtnEl.innerHTML;
    resetBtnEl.innerHTML = "<span>✅</span><span class='hidden sm:inline'>Reset</span>";
    setTimeout(() => {
      resetBtnEl.innerHTML = originalText;
    }, 800);
  }
}

if (resetBtnEl) {
  resetBtnEl.addEventListener("click", handleReset);
}

// Guide visibility toggle
let guidesVisible = true;
guideToggleEl.addEventListener("click", () => {
  guidesVisible = !guidesVisible;
  if (leftHandPanelEl) leftHandPanelEl.classList.toggle("panel-hidden", !guidesVisible);
  if (rightHandPanelEl) rightHandPanelEl.classList.toggle("panel-hidden", !guidesVisible);
  
  if (guideToggleTextEl) {
    guideToggleTextEl.textContent = guidesVisible ? "Guides" : "Guides (Off)";
  } else {
    guideToggleEl.textContent = guidesVisible ? "Close Guide" : "Open Guide";
  }

  if (guidesVisible) {
    trackClarityEvent("guide_opened");
  }
});

helpButton.addEventListener("click", () => {
  trackClarityEvent("help_opened");
  helpModal.classList.remove("hidden");
});

closeHelp.addEventListener("click", (e) => {
  e.stopPropagation();
  helpModal.classList.add("hidden");
});

helpModal.addEventListener("click", (e) => {
  if (e.target === helpModal) {
    helpModal.classList.add("hidden");
  }
});

// Compute cover rectangle for zero-stretch video feed
function computeCoverRect(srcW, srcH, dstW, dstH) {
  const srcRatio = srcW / srcH;
  const dstRatio = dstW / dstH;

  if (srcRatio > dstRatio) {
    const sHeight = srcH;
    const sWidth = srcH * dstRatio;
    return { sx: (srcW - sWidth) / 2, sy: 0, sWidth, sHeight };
  } else {
    const sWidth = srcW;
    const sHeight = srcW / dstRatio;
    return { sx: 0, sy: (srcH - sHeight) / 2, sWidth, sHeight };
  }
}

function drawFrame(results, canvasWidth, canvasHeight) {
  const srcW = videoEl.videoWidth;
  const srcH = videoEl.videoHeight;
  if (!srcW || !srcH) return;

  const { sx, sy, sWidth, sHeight } = computeCoverRect(srcW, srcH, canvasWidth, canvasHeight);

  ctx.save();
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  ctx.translate(canvasWidth, 0);
  ctx.scale(-1, 1);

  ctx.drawImage(videoEl, sx, sy, sWidth, sHeight, 0, 0, canvasWidth, canvasHeight);

  // Draw hand landmark skeleton points with clean modern styling
  if (results && results.landmarks) {
    results.landmarks.forEach((landmarks, handIndex) => {
      const handedness = results.handedness && results.handedness[handIndex] && results.handedness[handIndex][0]
        ? results.handedness[handIndex][0].categoryName
        : "Unknown";
      
      const isLeft = handedness === "Left";
      const dotColor = isLeft ? "rgba(245, 158, 11, 0.85)" : "rgba(56, 189, 248, 0.85)";

      ctx.fillStyle = dotColor;
      for (const point of landmarks) {
        const videoPx = point.x * srcW;
        const videoPy = point.y * srcH;
        const canvasX = ((videoPx - sx) / sWidth) * canvasWidth;
        const canvasY = ((videoPy - sy) / sHeight) * canvasHeight;

        ctx.beginPath();
        ctx.arc(canvasX, canvasY, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  ctx.restore();
}

function resizeCanvas() {
  canvasEl.width = window.innerWidth;
  canvasEl.height = window.innerHeight;
}

// =======================================================
// Main Application Lifecycle & Real-Time Tracking Loop
// =======================================================
async function main() {
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);

  // Initialize MediaPipe AI Model
  let handLandmarker = null;
  try {
    handLandmarker = await setupHandLandmarker();
  } catch (mlErr) {
    console.error("Failed to load hand landmarker:", mlErr);
    if (trackingStatusTextEl) trackingStatusTextEl.textContent = "AI Vision Model Error";
  }

  // Attempt initial camera start; if blocked, user can click "Start Playing" or "Retry Camera"
  try {
    await setupCamera();
  } catch (camErr) {
    console.warn("Initial camera setup deferred until user clicks Start:", camErr.message);
  }

  let lastVideoTime = -1;
  let cachedLeftLandmarks = null;
  let cachedRightLandmarks = null;

  function loop() {
    const timestampNow = performance.now();

    // 1. UPDATE MEDIAPIPE FRAME
    if (handLandmarker && isCameraRunning && videoEl.readyState >= 2 && videoEl.videoWidth > 0 && videoEl.currentTime !== lastVideoTime) {
      lastVideoTime = videoEl.currentTime;

      try {
        const results = handLandmarker.detectForVideo(videoEl, timestampNow);

        drawFrame(results, canvasEl.width, canvasEl.height);

        cachedLeftLandmarks = null;
        cachedRightLandmarks = null;

        if (results && results.landmarks) {
          results.landmarks.forEach((landmarks, i) => {
            const handedness = results.handedness[i][0].categoryName;
            if (handedness === "Left") {
              cachedLeftLandmarks = landmarks;
            }
            if (handedness === "Right") {
              cachedRightLandmarks = landmarks;
            }
          });
        }
      } catch (detectErr) {
        // Guard against transient frame detection interruptions
        console.warn("Frame detection glitch:", detectErr);
      }
    }

    // 2. RAW GESTURE STATES
    let currentChord = null;
    let isMajorMode = true;
    let qualityIndex = 0;
    let thumbDown = false;
    let rawChordState = null;

    let rawChord = null;
    let rawMode = true;
    let rawQualityIndex = 0;
    let rawThumbDown = false;

    // LEFT HAND = ROOT CHORD
    if (cachedLeftLandmarks) {
      const leftTilt = getHandHorizontalTilt(cachedLeftLandmarks, "Left");
      rawChord = classifyChord(cachedLeftLandmarks, "Left");
      rawMode = leftTilt >= 0;

      if (leftHandDetectedBadgeEl) {
        leftHandDetectedBadgeEl.textContent = `Active: ${rawChord || "Detecting..."}`;
        leftHandDetectedBadgeEl.className = "text-[10px] px-2 py-0.5 rounded font-mono bg-amber-500/20 text-amber-300 border border-amber-500/40";
      }
      if (leftModeBadgeEl) {
        leftModeBadgeEl.textContent = rawMode ? "Major Mode (☀️)" : "Minor Mode (🌙)";
      }
      if (tiltMajorCardEl && tiltMinorCardEl) {
        if (rawMode) {
          tiltMajorCardEl.className = "py-1 px-1 rounded border border-amber-500/70 bg-amber-500/30 text-amber-100 font-bold shadow-sm";
          tiltMinorCardEl.className = "py-1 px-1 rounded border border-neutral-800 bg-neutral-900 text-neutral-400 font-medium";
        } else {
          tiltMajorCardEl.className = "py-1 px-1 rounded border border-neutral-800 bg-neutral-900 text-neutral-400 font-medium";
          tiltMinorCardEl.className = "py-1 px-1 rounded border border-rose-500/70 bg-rose-500/30 text-rose-100 font-bold shadow-sm";
        }
      }
    } else {
      if (leftHandDetectedBadgeEl) {
        leftHandDetectedBadgeEl.textContent = "Not detected";
        leftHandDetectedBadgeEl.className = "text-[10px] px-2 py-0.5 rounded font-mono bg-neutral-900 text-neutral-400 border border-neutral-800";
      }
      if (tiltMajorCardEl && tiltMinorCardEl) {
        tiltMajorCardEl.className = "py-1 px-1 rounded border border-neutral-800 bg-neutral-900 text-neutral-400 font-medium";
        tiltMinorCardEl.className = "py-1 px-1 rounded border border-neutral-800 bg-neutral-900 text-neutral-400 font-medium";
      }
    }

    // RIGHT HAND = VOICING
    if (cachedRightLandmarks) {
      rawQualityIndex = getRightHandQualityIndex(cachedRightLandmarks);
      rawThumbDown = isThumbExtended(cachedRightLandmarks, "Right");

      if (rightHandDetectedBadgeEl) {
        rightHandDetectedBadgeEl.textContent = `Active (${rawQualityIndex} finger${rawQualityIndex === 1 ? "" : "s"})`;
        rightHandDetectedBadgeEl.className = "text-[10px] px-2 py-0.5 rounded font-mono bg-sky-500/20 text-sky-300 border border-sky-500/40";
      }

      for (let i = 1; i <= 4; i++) {
        const card = voicingCardEls[i];
        if (card) {
          card.classList.toggle("active", rawQualityIndex === i);
        }
      }

      if (octaveBadgeEl && octaveCardEl) {
        if (rawThumbDown) {
          octaveBadgeEl.textContent = "-1 Octave (Bass)";
          octaveBadgeEl.className = "text-[10px] px-1.5 py-0.5 rounded bg-sky-500/30 text-sky-200 border border-sky-500/50 font-mono font-bold";
          octaveCardEl.className = "mt-1.5 p-1.5 rounded-lg bg-sky-950/40 border border-sky-600/50 text-xs flex items-center justify-between";
        } else {
          octaveBadgeEl.textContent = "Normal";
          octaveBadgeEl.className = "text-[10px] px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400 font-mono";
          octaveCardEl.className = "mt-1.5 p-1.5 rounded-lg bg-neutral-900/60 border border-neutral-800 text-xs flex items-center justify-between";
        }
      }
    } else {
      if (rightHandDetectedBadgeEl) {
        rightHandDetectedBadgeEl.textContent = "Not detected";
        rightHandDetectedBadgeEl.className = "text-[10px] px-2 py-0.5 rounded font-mono bg-neutral-900 text-neutral-400 border border-neutral-800";
      }
      for (let i = 1; i <= 4; i++) {
        const card = voicingCardEls[i];
        if (card) card.classList.remove("active");
      }
      if (octaveBadgeEl && octaveCardEl) {
        octaveBadgeEl.textContent = "Normal";
        octaveBadgeEl.className = "text-[10px] px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400 font-mono";
        octaveCardEl.className = "mt-1.5 p-1.5 rounded-lg bg-neutral-900/60 border border-neutral-800 text-xs flex items-center justify-between";
      }
    }

    // Top Tracking Summary Badge
    if (trackingStatusTextEl) {
      if (cachedLeftLandmarks && cachedRightLandmarks) {
        trackingStatusTextEl.textContent = "✋ Both Hands Connected";
      } else if (cachedLeftLandmarks) {
        trackingStatusTextEl.textContent = "✋ Left Hand (Chord) Ready";
      } else if (cachedRightLandmarks) {
        trackingStatusTextEl.textContent = "✋ Right Hand (Sound) Ready";
      } else {
        trackingStatusTextEl.textContent = "✋ Show hands to camera";
      }
    }

    // Combine into ONE musical object
    if (rawChord) {
      rawChordState = {
        chord: rawChord,
        isMajorMode: rawMode,
        qualityIndex: rawQualityIndex,
        thumbDown: rawThumbDown
      };
    }

    // 3. STABILIZE HANDS
    const stableChordState = stabilizeChordState(rawChordState, timestampNow);

    if (stableChordState) {
      currentChord = stableChordState.chord;
      isMajorMode = stableChordState.isMajorMode;
      qualityIndex = stableChordState.qualityIndex;
      thumbDown = stableChordState.thumbDown;
    }

    // 4. UI UPDATE
    if (currentChord) {
      const chordName = getChordName(currentChord, isMajorMode);
      chordDisplayEl.textContent = `${chordName} (${currentChord})`;
      highlightActiveDegree(currentChord);
    } else {
      chordDisplayEl.textContent = "--";
      highlightActiveDegree(null);
    }

    const MAJOR_LABELS = {
      1: "Major Triad",
      2: "Major 1st Inversion",
      3: "Major 7th",
      4: "Dominant 7th"
    };

    const MINOR_LABELS = {
      1: "Minor Triad",
      2: "Minor 1st Inversion",
      3: "Minor 7th",
      4: "Diminished 7th"
    };

    const activeLabel = isMajorMode ? MAJOR_LABELS[qualityIndex] : MINOR_LABELS[qualityIndex];

    qualityDisplayEl.textContent = activeLabel
      ? `${activeLabel}${thumbDown ? " • (-8ve Bass)" : ""}`
      : (currentChord ? "Raise right hand to play" : "Hold up left hand to pick chord");

    // 5. AUDIO ENGINE
    if (cachedRightLandmarks) {
      const currentVolume = getVolumeFromHeight(cachedRightLandmarks);
      updateVolumeMeter(currentVolume);

      const horizontalTilt = getHandHorizontalTilt(cachedRightLandmarks, "Right");
      const tiltPercentage = Math.round(horizontalTilt * 100);

      const targetEl = distortionDisplayEl || document.getElementById("distortionDisplay");
      if (targetEl) {
        targetEl.textContent = `Filter: ${tiltPercentage > 0 ? "+" : ""}${tiltPercentage}%`;
      }

      synth.updateFilterSweep(horizontalTilt);

      if (currentChord && qualityIndex >= 1) {
        const chordTrackingKey = `${currentChord}-${isMajorMode ? "major" : "minor"}-${qualityIndex}-${thumbDown ? "low" : "normal"}`;

        if (chordTrackingKey !== lastTrackedChord) {
          lastTrackedChord = chordTrackingKey;
          trackClarityEvent("chord_changed");
        }

        const tones = getChordTones(currentChord, isMajorMode);
        let notes = getSolidNotes(tones, qualityIndex, isMajorMode);

        if (thumbDown) {
          notes = notes.map(freq => freq / 2);
        }

        synth.playNotes(notes);
        synth.setVolume(currentVolume);
      } else {
        synth.setVolume(0);
      }
    } else {
      synth.setVolume(0);
      updateVolumeMeter(0);
    }

    // 6. VISUAL ENERGY WAVES
    const volume = cachedRightLandmarks ? getVolumeFromHeight(cachedRightLandmarks) : 0;
    const tilt = cachedRightLandmarks ? getHandHorizontalTilt(cachedRightLandmarks, "Right") : 0;

    drawEnergy(ctx, volume, qualityIndex, tilt, currentChord);

    requestAnimationFrame(loop);
  }
  
  loop();
}

main().catch((err) => console.error("Gesture Synth initialization error:", err));
