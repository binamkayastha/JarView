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
const photoGrid = document.getElementById("photoGrid");
const refreshPhotosButton = document.getElementById("refreshPhotos");
const selectLibraryButton = document.getElementById("selectLibrary");
const libraryStatus = document.getElementById("libraryStatus");
let gestureRecognizer;
let runningMode = "IMAGE";
let enableWebcamButton;
let webcamRunning = false;
const videoHeight = "360px";
const videoWidth = "480px";
const DISPLAY_PHOTO_COUNT = 12;
const MAX_HANDS = 2;
const THUMB_TIP_INDEX = 4;
const INDEX_TIP_INDEX = 8;
const PINCH_DISTANCE_THRESHOLD_PX = 100;
let activeStream = null;

let currentPhotoSources = [];
let activeObjectUrls = [];

const shuffle = (array) => {
  const clone = [...array];
  for (let i = clone.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [clone[i], clone[j]] = [clone[j], clone[i]];
  }
  return clone;
};

const renderPhotoGrid = () => {
  if (!photoGrid) return;
  photoGrid.innerHTML = "";
  if (!currentPhotoSources.length) {
    photoGrid.innerHTML =
      "<p class='photo-placeholder'>No photos loaded yet. Select your Photos Library to begin.</p>";
    return;
  }
  const photosToShow = currentPhotoSources.slice(0, DISPLAY_PHOTO_COUNT);
  photosToShow.forEach((photo, idx) => {
    const figure = document.createElement("figure");
    figure.className = "photo-card";
    figure.innerHTML = `
      <img src="${photo.src}" alt="${photo.caption}" loading="lazy">
      <figcaption>${photo.caption} • #${idx + 1}</figcaption>
    `;
    photoGrid.appendChild(figure);
  });
};

const clearActiveObjectUrls = () => {
  activeObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  activeObjectUrls = [];
};

const setPhotoSources = (photos = [], { objectUrls = [] } = {}) => {
  clearActiveObjectUrls();
  if (objectUrls.length) {
    activeObjectUrls = objectUrls;
  }
  currentPhotoSources = Array.isArray(photos) ? [...photos] : [];
  renderPhotoGrid();
  if (refreshPhotosButton) {
    refreshPhotosButton.disabled = currentPhotoSources.length === 0;
  }
};

const refreshPhotoGrid = () => {
  if (!currentPhotoSources.length) {
    updateLibraryStatus("Load your Photos Library first to enable shuffling.");
    return;
  }
  currentPhotoSources = shuffle(currentPhotoSources);
  renderPhotoGrid();
};

const updateLibraryStatus = (message, { isError = false } = {}) => {
  if (!libraryStatus) return;
  libraryStatus.innerText = message;
  libraryStatus.classList.toggle("library-status--error", isError);
};

if (photoGrid) {
  renderPhotoGrid();
  refreshPhotosButton?.addEventListener("click", refreshPhotoGrid);
}

updateLibraryStatus(
  "Select your Photos Library folder (e.g., ~/Pictures) to load thumbnails."
);

const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".heic", ".heif"];
const MAX_DYNAMIC_PHOTOS = 60;
const MAX_DIRECTORY_SEARCH_DEPTH = 5;

const isImageFile = (filename = "") =>
  IMAGE_EXTENSIONS.some((ext) => filename.toLowerCase().endsWith(ext));

const tryResolveDerivatives = async (directoryHandle) => {
  if (!directoryHandle) return null;
  const lowerName = directoryHandle.name.toLowerCase();
  if (lowerName.includes("derivatives")) {
    return directoryHandle;
  }
  try {
    const direct = await directoryHandle.getDirectoryHandle("derivatives");
    return direct;
  } catch (error) {
    // continue searching
  }
  try {
    const resources = await directoryHandle.getDirectoryHandle("resources");
    return await resources.getDirectoryHandle("derivatives");
  } catch (error) {
    return null;
  }
};

const resolveDerivativesHandle = async (rootHandle) => {
  if (!rootHandle) {
    throw new Error("No directory selected.");
  }
  const initial = await tryResolveDerivatives(rootHandle);
  if (initial) return initial;

  const walk = async (directoryHandle, depth = 0) => {
    if (depth > MAX_DIRECTORY_SEARCH_DEPTH) {
      return null;
    }
    for await (const entry of directoryHandle.values()) {
      if (entry.kind !== "directory") continue;
      const candidate = await tryResolveDerivatives(entry);
      if (candidate) {
        return candidate;
      }
      const nested = await walk(entry, depth + 1);
      if (nested) return nested;
    }
    return null;
  };

  const discovered = await walk(rootHandle);
  if (discovered) {
    return discovered;
  }
  throw new Error(
    "Could not locate a Photos Library resources/derivatives folder inside that selection."
  );
};

const collectPhotosFromHandle = async (
  dirHandle,
  limit = MAX_DYNAMIC_PHOTOS
) => {
  const photos = [];
  const objectUrls = [];

  const walkDirectory = async (directoryHandle) => {
    for await (const entry of directoryHandle.values()) {
      if (photos.length >= limit) break;
      if (entry.kind === "file" && isImageFile(entry.name)) {
        const file = await entry.getFile();
        const url = URL.createObjectURL(file);
        photos.push({
          src: url,
          caption: file.name
        });
        objectUrls.push(url);
      } else if (entry.kind === "directory") {
        await walkDirectory(entry);
      }
    }
  };

  await walkDirectory(dirHandle);
  return { photos, objectUrls };
};

const requestPhotosLibraryAccess = async () => {
  if (!window.showDirectoryPicker) {
    updateLibraryStatus(
      "Your browser does not support folder access. Try Chrome or Edge.",
      { isError: true }
    );
    return;
  }
  try {
    updateLibraryStatus(
      "Choose your Photos Library package to grant read-only access..."
    );
    const rootHandle = await window.showDirectoryPicker({ mode: "read" });
    const derivativesHandle = await resolveDerivativesHandle(rootHandle);
    updateLibraryStatus("Loading photos from library...");
    const { photos, objectUrls } = await collectPhotosFromHandle(
      derivativesHandle
    );
    if (!photos.length) {
      updateLibraryStatus(
        "No images were found in the selected folder. Please try another directory.",
        { isError: true }
      );
      return;
    }
    setPhotoSources(photos, { objectUrls });
    updateLibraryStatus(
      `Showing ${Math.min(
        photos.length,
        SAMPLE_PHOTO_COUNT
      )} of ${photos.length} photos (shuffle for more).`
    );
  } catch (error) {
    if (error?.name === "AbortError") {
      updateLibraryStatus("Folder selection was cancelled.");
      return;
    }
    console.error("Unable to access Photos Library:", error);
    updateLibraryStatus(
      "Unable to access that folder. Ensure it is your Photos Library and retry.",
      { isError: true }
    );
  }
};

selectLibraryButton?.addEventListener("click", requestPhotosLibraryAccess);
if (!window.showDirectoryPicker && selectLibraryButton) {
  selectLibraryButton.disabled = true;
  updateLibraryStatus(
    "Folder access requires a Chromium-based browser (Chrome, Edge, Arc, etc.).",
    { isError: true }
  );
}

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

const isThumbIndexPinched = (metrics) =>
  metrics?.distancePx <= PINCH_DISTANCE_THRESHOLD_PX;

const drawThumbIndexLine = (metrics, { highlight = false } = {}) => {
  if (!metrics) {
    return;
  }

  canvasCtx.save();
  canvasCtx.strokeStyle = highlight ? "#0A84FF" : "#FFD60A";
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

  const handednessLabel = metrics.handedness
    ? `${metrics.handedness} Thumb-Index`
    : "Thumb-Index";
  const pinchSuffix = metrics.isPinched ? " (pinched)" : "";
  const label = `${handednessLabel}: ${metrics.distancePx.toFixed(
    1
  )} px${pinchSuffix}`;
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

const drawPinchedHandsConnector = (firstPinch, secondPinch) => {
  if (!firstPinch || !secondPinch) {
    return;
  }
  canvasCtx.save();
  canvasCtx.strokeStyle = "#34C759";
  canvasCtx.lineWidth = 6;
  canvasCtx.setLineDash([12, 10]);
  canvasCtx.beginPath();
  canvasCtx.moveTo(firstPinch.midPoint.x, firstPinch.midPoint.y);
  canvasCtx.lineTo(secondPinch.midPoint.x, secondPinch.midPoint.y);
  canvasCtx.stroke();
  canvasCtx.restore();
};

const drawPinchedHandsDistanceLabel = (
  firstPinch,
  secondPinch,
  distancePx
) => {
  if (!firstPinch || !secondPinch || typeof distancePx !== "number") {
    return;
  }
  const midPoint = {
    x: (firstPinch.midPoint.x + secondPinch.midPoint.x) / 2,
    y: (firstPinch.midPoint.y + secondPinch.midPoint.y) / 2
  };
  const label = `Hands Gap: ${distancePx.toFixed(1)} px`;
  const padding = 10;
  const backgroundHeight = 32;

  canvasCtx.save();
  canvasCtx.font = "22px sans-serif";
  canvasCtx.textBaseline = "middle";
  const textMetrics = canvasCtx.measureText(label);
  const backgroundWidth = textMetrics.width + padding * 2;
  const backgroundX = midPoint.x - backgroundWidth / 2;
  const backgroundY = midPoint.y - backgroundHeight / 2;

  canvasCtx.fillStyle = "rgba(0, 0, 0, 0.7)";
  canvasCtx.fillRect(backgroundX, backgroundY, backgroundWidth, backgroundHeight);
  canvasCtx.fillStyle = "#34C759";
  canvasCtx.fillText(label, midPoint.x - textMetrics.width / 2, midPoint.y);
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
  const pinchedMetrics = [];
  let pinchedHandsDistance = null;
  canvasElement.style.height = videoHeight;
  webcamElement.style.height = videoHeight;
  canvasElement.style.width = videoWidth;
  webcamElement.style.width = videoWidth;

  if (results.landmarks) {
    const drawingUtils = new DrawingUtils(canvasCtx);
    results.landmarks.forEach((landmarks, index) => {
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
        const handedness =
          results.handednesses?.[index]?.[0]?.displayName || "Unknown";
        const metricDetails = {
          ...metrics,
          handedness: flipHandedness(handedness)
        };
        const pinched = isThumbIndexPinched(metricDetails);
        metricDetails.isPinched = pinched;
        drawThumbIndexLine(metricDetails, { highlight: pinched });
        if (pinched) {
          pinchedMetrics.push(metricDetails);
        }
        thumbIndexMetrics.push(metricDetails);
      }
    });
  }
  canvasCtx.restore();
  if (pinchedMetrics.length === 2) {
    const [firstPinch, secondPinch] = pinchedMetrics;
    drawPinchedHandsConnector(firstPinch, secondPinch);
    pinchedHandsDistance = Math.hypot(
      secondPinch.midPoint.x - firstPinch.midPoint.x,
      secondPinch.midPoint.y - firstPinch.midPoint.y
    );
    drawPinchedHandsDistanceLabel(firstPinch, secondPinch, pinchedHandsDistance);
  }
  thumbIndexMetrics.forEach((metrics) => {
    drawThumbIndexLabel(metrics);
  });
  const summaries = buildGestureSummaries(results);
  const infoLines = [...summaries];
  if (pinchedHandsDistance !== null) {
    infoLines.push(`Hands Gap: ${pinchedHandsDistance.toFixed(1)} px`);
  }
  if (infoLines.length > 0) {
    gestureOutput.style.display = "block";
    gestureOutput.style.width = videoWidth;
    gestureOutput.innerText = infoLines.join("\n\n");
  } else {
    gestureOutput.style.display = "none";
  }
  // Call this function again to keep predicting when the browser is ready.
  if (webcamRunning === true) {
    window.requestAnimationFrame(predictWebcam);
  }
}
