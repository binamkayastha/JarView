// Copyright 2023 The MediaPipe Authors.

// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at

//      http://www.apache.org/licenses/LICENSE-2.0

// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
import {
  GestureRecognizer,
  FilesetResolver,
  DrawingUtils
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3";

const demosSection = document.getElementById("demos");
let gestureRecognizer;
let runningMode = "IMAGE";
let enableWebcamButton;
let webcamRunning = false;
const videoHeight = "360px";
const videoWidth = "480px";
const MAX_HANDS = 2;
const THUMB_TIP_INDEX = 4;
const INDEX_TIP_INDEX = 8;
let activeStream = null;

const mirrorLandmarks = (landmarks) => {
  if (!landmarks) {
    return [];
  }
  return landmarks.map((landmark) => ({
    ...landmark,
    x: 1 - landmark.x
  }));
};

const computeThumbIndexMetrics = (landmarks) => {
  if (!landmarks || !landmarks[THUMB_TIP_INDEX] || !landmarks[INDEX_TIP_INDEX]) {
    return null;
  }

  const thumbTip = landmarks[THUMB_TIP_INDEX];
  const indexTip = landmarks[INDEX_TIP_INDEX];
  const start = {
    x: thumbTip.x * canvasElement.width,
    y: thumbTip.y * canvasElement.height
  };
  const end = {
    x: indexTip.x * canvasElement.width,
    y: indexTip.y * canvasElement.height
  };

  const distancePx = Math.hypot(end.x - start.x, end.y - start.y);
  const midPoint = {
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2
  };

  return {
    start,
    end,
    midPoint,
    distancePx
  };
};

const drawThumbIndexLine = (metrics) => {
  if (!metrics) {
    return;
  }

  canvasCtx.save();
  canvasCtx.strokeStyle = "#FFD60A";
  canvasCtx.lineWidth = 4;
  canvasCtx.beginPath();
  canvasCtx.moveTo(metrics.start.x, metrics.start.y);
  canvasCtx.lineTo(metrics.end.x, metrics.end.y);
  canvasCtx.stroke();
  canvasCtx.restore();
};

const drawThumbIndexLabel = (metrics) => {
  if (!metrics) {
    return;
  }

  const label = `Thumb-Index: ${metrics.distancePx.toFixed(1)} px`;
  const padding = 8;
  const backgroundHeight = 28;

  canvasCtx.save();
  canvasCtx.font = "20px sans-serif";
  canvasCtx.textBaseline = "middle";
  const textMetrics = canvasCtx.measureText(label);
  const backgroundWidth = textMetrics.width + padding * 2;
  const textY = Math.max(backgroundHeight, metrics.midPoint.y);
  const backgroundX = metrics.midPoint.x - backgroundWidth / 2;
  const backgroundY = textY - backgroundHeight / 2;

  canvasCtx.fillStyle = "rgba(0, 0, 0, 0.6)";
  canvasCtx.fillRect(backgroundX, backgroundY, backgroundWidth, backgroundHeight);

  canvasCtx.fillStyle = "#FFD60A";
  canvasCtx.fillText(label, metrics.midPoint.x - textMetrics.width / 2, textY);
  canvasCtx.restore();
};

const flipHandedness = (rawHandedness) => {
  if (rawHandedness === "Left") return "Right";
  if (rawHandedness === "Right") return "Left";
  return rawHandedness || "Unknown";
};

const buildGestureSummaries = (recognizerResults) => {
  if (!recognizerResults?.gestures?.length) {
    return [];
  }
  return recognizerResults.gestures
    .map((gestureCandidates, index) => {
      if (!gestureCandidates || gestureCandidates.length === 0) {
        return null;
      }
      const topGesture = gestureCandidates[0];
      const score = parseFloat(topGesture.score * 100).toFixed(2);
      const rawHandedness =
        recognizerResults.handednesses?.[index]?.[0]?.displayName;
      const handedness = flipHandedness(rawHandedness);
      return `Hand ${index + 1} (${handedness}): ${topGesture.categoryName} - ${score}%`;
    })
    .filter(Boolean);
};

// Before we can use HandLandmarker class we must wait for it to finish
// loading. Machine Learning models can be large and take a moment to
// get everything needed to run.
const createGestureRecognizer = async () => {
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
  );
  gestureRecognizer = await GestureRecognizer.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task",
      delegate: "GPU"
    },
    runningMode: runningMode,
    numHands: MAX_HANDS
  });
  demosSection.classList.remove("invisible");
};
const gestureRecognizerReady = createGestureRecognizer();

/********************************************************************
// Demo 1: Detect hand gestures in images
********************************************************************/

const imageContainers = document.getElementsByClassName("detectOnClick");

for (let i = 0; i < imageContainers.length; i++) {
  imageContainers[i].children[0].addEventListener("click", handleClick);
}

async function handleClick(event) {
  if (!gestureRecognizer) {
    alert("Please wait for gestureRecognizer to load");
    return;
  }

  if (runningMode === "VIDEO") {
    runningMode = "IMAGE";
    await gestureRecognizer.setOptions({
      runningMode: "IMAGE",
      numHands: MAX_HANDS
    });
  }
  // Remove all previous landmarks
  const allCanvas = event.target.parentNode.getElementsByClassName("canvas");
  for (var i = allCanvas.length - 1; i >= 0; i--) {
    const n = allCanvas[i];
    n.parentNode.removeChild(n);
  }

  const results = gestureRecognizer.recognize(event.target);

  // View results in the console to see their format
  console.log(results);
  const summaries = buildGestureSummaries(results);
  if (summaries.length > 0) {
    const p = event.target.parentNode.childNodes[3];
    p.setAttribute("class", "info");
    p.innerText = summaries.join("\n");
    p.style =
      "left: 0px;" +
      "top: " +
      event.target.height +
      "px; " +
      "width: " +
      (event.target.width - 10) +
      "px;";

    const canvas = document.createElement("canvas");
    canvas.setAttribute("class", "canvas");
    canvas.setAttribute("width", event.target.naturalWidth + "px");
    canvas.setAttribute("height", event.target.naturalHeight + "px");
    canvas.style =
      "left: 0px;" +
      "top: 0px;" +
      "width: " +
      event.target.width +
      "px;" +
      "height: " +
      event.target.height +
      "px;";

    event.target.parentNode.appendChild(canvas);
    const canvasCtx = canvas.getContext("2d");
    const drawingUtils = new DrawingUtils(canvasCtx);
    for (const landmarks of results.landmarks) {
      drawingUtils.drawConnectors(
        landmarks,
        GestureRecognizer.HAND_CONNECTIONS,
        {
          color: "#00FF00",
          lineWidth: 5
        }
      );
      drawingUtils.drawLandmarks(landmarks, {
        color: "#FF0000",
        lineWidth: 1
      });
    }
  }
}

/********************************************************************
// Demo 2: Continuously grab image from webcam stream and detect it.
********************************************************************/

const video = document.getElementById("webcam");
const canvasElement = document.getElementById("output_canvas");
const canvasCtx = canvasElement.getContext("2d");
const gestureOutput = document.getElementById("gesture_output");
const permissionNotice = document.getElementById("permissionNotice");
const permissionMessage = document.getElementById("permissionMessage");
const requestPermissionButton = document.getElementById(
  "requestPermissionButton"
);
const PERMISSION_REQUIRED_MESSAGE =
  "Camera permission is required for hand gesture recognition. Please allow access so predictions can start.";
const PERMISSION_BLOCKED_MESSAGE =
  "Camera permission is blocked. Allow camera access in your browser settings and click Re-request Camera.";

if (requestPermissionButton) {
  requestPermissionButton.addEventListener("click", () => {
    if (!webcamRunning) {
      requestCameraAccess({ fromPermissionButton: true });
    }
  });
}

function showPermissionNotice(
  message = PERMISSION_REQUIRED_MESSAGE,
  { showButton = true } = {}
) {
  if (permissionMessage && message) {
    permissionMessage.innerText = message;
  }
  if (permissionNotice) {
    permissionNotice.classList.remove("hidden");
  }
  if (showButton && requestPermissionButton) {
    requestPermissionButton.classList.remove("hidden");
  }
}

function hidePermissionNotice() {
  if (permissionNotice) {
    permissionNotice.classList.add("hidden");
  }
}

async function initCameraPermissionStatus() {
  if (!navigator.permissions || !navigator.permissions.query) {
    return;
  }
  try {
    const status = await navigator.permissions.query({ name: "camera" });
    const updateNotice = () => {
      if (status.state === "granted") {
        hidePermissionNotice();
      } else if (status.state === "denied") {
        showPermissionNotice(PERMISSION_BLOCKED_MESSAGE);
      } else {
        showPermissionNotice(PERMISSION_REQUIRED_MESSAGE);
      }
    };
    updateNotice();
    status.addEventListener("change", updateNotice);
  } catch (error) {
    console.warn("Unable to query camera permission status:", error);
  }
}

// Check if webcam access is supported.
function hasGetUserMedia() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

// If webcam supported, add event listener to button for when user
// wants to activate it.
if (hasGetUserMedia()) {
  enableWebcamButton = document.getElementById("webcamButton");
  enableWebcamButton.addEventListener("click", enableCam);
  initCameraPermissionStatus();
  gestureRecognizerReady.then(() => {
    if (!webcamRunning) {
      enableCam();
    }
  });
} else {
  console.warn("getUserMedia() is not supported by your browser");
  showPermissionNotice(
    "This browser does not support camera access required for gesture recognition."
  );
  if (requestPermissionButton) {
    requestPermissionButton.classList.add("hidden");
  }
}

// Enable the live webcam view and start detection.
function enableCam() {
  if (!gestureRecognizer) {
    alert("Please wait for gestureRecognizer to load");
    return;
  }

  if (webcamRunning === true) {
    stopWebcamStream();
    return;
  }

  requestCameraAccess();
}

function stopWebcamStream() {
  if (activeStream) {
    activeStream.getTracks().forEach((track) => track.stop());
  }
  video.srcObject = null;
  activeStream = null;
  webcamRunning = false;
  if (enableWebcamButton) {
    enableWebcamButton.innerText = "ENABLE PREDICTIONS";
  }
  if (gestureOutput) {
    gestureOutput.style.display = "none";
  }
}

function requestCameraAccess(options = {}) {
  const { fromPermissionButton = false } = options;

  if (!gestureRecognizer) {
    alert("Please wait for gestureRecognizer to load");
    return;
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showPermissionNotice(
      "Camera access is unavailable in this browser. Please switch to a supported browser to continue."
    );
    return;
  }

  if (fromPermissionButton && requestPermissionButton) {
    requestPermissionButton.disabled = true;
    requestPermissionButton.innerText = "REQUESTING...";
  }

  if (enableWebcamButton) {
    enableWebcamButton.disabled = true;
  }

  const constraints = {
    video: true
  };

  navigator.mediaDevices
    .getUserMedia(constraints)
    .then((stream) => {
      activeStream = stream;
      video.srcObject = stream;
      video.removeEventListener("loadeddata", predictWebcam);
      video.addEventListener("loadeddata", predictWebcam);
      webcamRunning = true;
      if (enableWebcamButton) {
        enableWebcamButton.innerText = "DISABLE PREDICTIONS";
      }
      if (requestPermissionButton) {
        requestPermissionButton.innerText = "RE-REQUEST CAMERA";
      }
      hidePermissionNotice();
    })
    .catch((error) => {
      activeStream = null;
      webcamRunning = false;
      if (enableWebcamButton) {
        enableWebcamButton.innerText = "ENABLE PREDICTIONS";
      }
      if (requestPermissionButton) {
        requestPermissionButton.innerText = "RE-REQUEST CAMERA";
      }
      const blocked =
        error.name === "NotAllowedError" ||
        error.name === "SecurityError" ||
        error.name === "PermissionDeniedError";
      const message = blocked
        ? PERMISSION_BLOCKED_MESSAGE
        : "Unable to access the camera. Make sure no other app is using it and try again.";
      showPermissionNotice(message, { showButton: blocked });
      console.error("Error accessing camera:", error);
    })
    .finally(() => {
      if (enableWebcamButton) {
        enableWebcamButton.disabled = false;
      }
      if (fromPermissionButton && requestPermissionButton) {
        requestPermissionButton.disabled = false;
      }
    });
}

let lastVideoTime = -1;
let results = undefined;
async function predictWebcam() {
  const webcamElement = document.getElementById("webcam");
  // Now let's start detecting the stream.
  if (runningMode === "IMAGE") {
    runningMode = "VIDEO";
    await gestureRecognizer.setOptions({
      runningMode: "VIDEO",
      numHands: MAX_HANDS
    });
  }
  let nowInMs = Date.now();
  if (video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    results = gestureRecognizer.recognizeForVideo(video, nowInMs);
  }

  canvasCtx.save();
  canvasCtx.setTransform(1, 0, 0, 1, 0, 0);
  canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
  const thumbIndexMetrics = [];
  canvasElement.style.height = videoHeight;
  webcamElement.style.height = videoHeight;
  canvasElement.style.width = videoWidth;
  webcamElement.style.width = videoWidth;

  if (results.landmarks) {
    const drawingUtils = new DrawingUtils(canvasCtx);
    for (const landmarks of results.landmarks) {
      const mirroredLandmarks = mirrorLandmarks(landmarks);
      drawingUtils.drawConnectors(
        mirroredLandmarks,
        GestureRecognizer.HAND_CONNECTIONS,
        {
          color: "#00FF00",
          lineWidth: 5
        }
      );
      drawingUtils.drawLandmarks(mirroredLandmarks, {
        color: "#FF0000",
        lineWidth: 2
      });
      const metrics = computeThumbIndexMetrics(mirroredLandmarks);
      if (metrics) {
        drawThumbIndexLine(metrics);
        thumbIndexMetrics.push(metrics);
      }
    }
  }
  canvasCtx.restore();
  thumbIndexMetrics.forEach((metrics) => {
    drawThumbIndexLabel(metrics);
  });
  const summaries = buildGestureSummaries(results);
  if (summaries.length > 0) {
    gestureOutput.style.display = "block";
    gestureOutput.style.width = videoWidth;
    gestureOutput.innerText = summaries.join("\n\n");
  } else {
    gestureOutput.style.display = "none";
  }
  // Call this function again to keep predicting when the browser is ready.
  if (webcamRunning === true) {
    window.requestAnimationFrame(predictWebcam);
  }
}
