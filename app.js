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
  DrawingUtils,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3";

const demosSection = document.getElementById("demos");
const selectLibraryButton = document.getElementById("selectLibrary");
const libraryStatus = document.getElementById("libraryStatus");
const timelineCanvas = document.getElementById("photoCanvas");
const timelineCtx = timelineCanvas?.getContext("2d");
const timelineSlider = document.getElementById("dateSlider");
const timelineLabel = document.getElementById("dateSliderLabel");
const timelineStatus = document.getElementById("canvasStatus");
const selectedDateHeading = document.getElementById("selectedDateHeading");
const selectedDateList = document.getElementById("datePhotoList");
const selectedDatePanel = document.querySelector(".selected-date-panel");
const orbitDial = document.getElementById("orbitDial");
const orbitDialValue = document.getElementById("orbitDialValue");
const glowDial = document.getElementById("glowDial");
const glowDialValue = document.getElementById("glowDialValue");
const cameraPermissionBadge = document.getElementById("cameraPermissionBadge");
const photosPermissionBadge = document.getElementById("photosPermissionBadge");
const cameraPermissionButton = document.getElementById(
  "cameraPermissionButton",
);
const cameraPermissionSuccess = document.getElementById(
  "cameraPermissionSuccess",
);
const photosPermissionSuccess = document.getElementById(
  "photosPermissionSuccess",
);
let gestureRecognizer;
let runningMode = "IMAGE";
let webcamRunning = false;
const videoHeight = "100%";
const videoWidth = "100%";
const MAX_HANDS = 2;
const THUMB_TIP_INDEX = 4;
const INDEX_TIP_INDEX = 8;
const PINCH_DISTANCE_THRESHOLD_PX = 100;
let activeStream = null;

let currentPhotoSources = [];
let activeObjectUrls = [];
let timelineBuckets = [];
let activeTimelineIndex = 0;
let timelineCanvasWidth = 0;
let timelineCanvasHeight = 360;
let timelineAnimationFrame = null;
const bucketThumbnailCache = new Map();
const dialSettings = {
  orbitHeight: orbitDial ? Number(orbitDial.value) : 60,
  glowStrength: glowDial ? Number(glowDial.value) : 70,
};
const STAR_COUNT = 85;
const starField = Array.from({ length: STAR_COUNT }, () => ({
  x: Math.random(),
  y: Math.random(),
  size: Math.random() * 1.4 + 0.3,
  alpha: Math.random() * 0.5 + 0.35,
}));

let cameraPermissionState = "pending";
let photosPermissionState = "pending";

const STATUS_LABELS = {
  pending: "Permission needed",
  granted: "Granted",
  error: "Action needed",
};
const CAMERA_PERMISSION_LABEL = "Give camera permission";
const PHOTOS_PERMISSION_LABEL = "Give Photos permission";

const setButtonLabel = (button, label) => {
  if (!button || !label) return;
  const labelSpan = button.querySelector(".mdc-button__label");
  if (labelSpan) {
    labelSpan.innerText = label;
  } else {
    button.innerText = label;
  }
};

const updateStatusBadge = (badge, state) => {
  if (!badge) return;
  const nextState = STATUS_LABELS[state] ? state : "pending";
  const icon = badge.querySelector(".status-badge__icon");
  const text = badge.querySelector(".status-badge__text");
  badge.dataset.state = nextState;
  if (icon) {
    icon.innerText =
      nextState === "granted"
        ? "\u2713"
        : nextState === "error"
          ? "!"
          : "\u2022";
  }
  if (text) {
    text.innerText = STATUS_LABELS[nextState];
  }
};

const togglePermissionSuccess = (element, isVisible) => {
  if (!element) return;
  element.classList.toggle("is-visible", isVisible);
  element.hidden = !isVisible;
};

const mapPermissionDescriptorState = (state) => {
  if (state === "granted") return "granted";
  if (state === "denied") return "error";
  return "pending";
};

const setCameraPermissionState = (state) => {
  cameraPermissionState = state;
  updateStatusBadge(cameraPermissionBadge, state);
  const granted = state === "granted";
  if (cameraPermissionButton) {
    if (granted) {
      if (cameraPermissionButton.isConnected) {
        cameraPermissionButton.remove();
      }
    } else {
      cameraPermissionButton.hidden = false;
      cameraPermissionButton.disabled = false;
      setButtonLabel(cameraPermissionButton, CAMERA_PERMISSION_LABEL);
    }
  }
  togglePermissionSuccess(cameraPermissionSuccess, granted);
  if (granted) {
    ensureWebcamFeed();
  }
};

const setPhotosPermissionState = (state) => {
  photosPermissionState = state;
  updateStatusBadge(photosPermissionBadge, state);
  const granted = state === "granted";
  if (selectLibraryButton) {
    selectLibraryButton.classList.toggle("hidden", granted);
    selectLibraryButton.disabled = granted;
    if (!granted) {
      setButtonLabel(selectLibraryButton, PHOTOS_PERMISSION_LABEL);
    }
  }
  togglePermissionSuccess(photosPermissionSuccess, granted);
};

setCameraPermissionState("pending");
setPhotosPermissionState("pending");

const MAX_DATE_PREVIEW_PHOTOS = 6;
const TIMELINE_AXIS_PADDING_X = 60;
const TIMELINE_AXIS_OFFSET_Y = 60;

const updateDialOutput = (element, value, suffix = "%") => {
  if (!element) return;
  const number = Number.isFinite(value) ? Math.round(value) : 0;
  element.innerText = `${number}${suffix}`;
};

const pruneBucketThumbnails = (validKeys = []) => {
  const allow = new Set(validKeys);
  bucketThumbnailCache.forEach((_, key) => {
    if (!allow.has(key)) {
      bucketThumbnailCache.delete(key);
    }
  });
};

const requestBucketThumbnail = (bucket) => {
  if (
    !bucket ||
    !bucket.photos?.length ||
    bucketThumbnailCache.has(bucket.key)
  ) {
    return;
  }
  const previewPhoto = bucket.photos.find((photo) => Boolean(photo?.src));
  if (!previewPhoto) {
    bucketThumbnailCache.set(bucket.key, { status: "empty" });
    return;
  }
  const image = new Image();
  image.decoding = "async";
  bucketThumbnailCache.set(bucket.key, { status: "loading" });
  image.onload = () => {
    bucketThumbnailCache.set(bucket.key, { status: "ready", image });
    scheduleTimelineRender();
  };
  image.onerror = () => {
    bucketThumbnailCache.set(bucket.key, { status: "error" });
  };
  image.src = previewPhoto.src;
};

const warmBucketThumbnails = (buckets = []) => {
  const keys = buckets.map((bucket) => bucket.key);
  pruneBucketThumbnails(keys);
  buckets.forEach((bucket) => requestBucketThumbnail(bucket));
};

const getSafeDate = (value) => {
  if (!value) {
    return null;
  }
  const candidate = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(candidate.getTime())) {
    return null;
  }
  return candidate;
};

const formatFullDate = (date) => {
  const safeDate = getSafeDate(date);
  if (!safeDate) {
    return "Undated";
  }
  return safeDate.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
};

const formatShortDate = (date) => {
  const safeDate = getSafeDate(date);
  if (!safeDate) {
    return "Undated";
  }
  return safeDate.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
};

const normalizePhotoMetadata = (photo) => {
  if (!photo) {
    return null;
  }
  const takenOn =
    getSafeDate(photo.takenOn) ||
    getSafeDate(photo.date) ||
    getSafeDate(photo.lastModified);
  const dateKey = takenOn
    ? takenOn.toISOString().split("T")[0]
    : photo.dateKey || "undated";
  return {
    ...photo,
    takenOn: takenOn || null,
    dateKey,
    dateLabel: takenOn ? formatFullDate(takenOn) : "Undated",
    dateShortLabel: takenOn ? formatShortDate(takenOn) : "Undated",
  };
};

const buildTimelineBuckets = (photos = []) => {
  const buckets = new Map();
  photos.forEach((photo) => {
    if (!photo) return;
    const normalized = normalizePhotoMetadata(photo);
    if (!normalized) return;
    const key = normalized.dateKey || "undated";
    if (!buckets.has(key)) {
      buckets.set(key, {
        key,
        date: normalized.takenOn,
        label: normalized.dateLabel,
        shortLabel: normalized.dateShortLabel,
        photos: [],
      });
    }
    buckets.get(key).photos.push(normalized);
  });
  const sorted = Array.from(buckets.values()).sort((a, b) => {
    if (!a.date && !b.date) {
      return a.label.localeCompare(b.label);
    }
    if (!a.date) return 1;
    if (!b.date) return -1;
    return a.date.getTime() - b.date.getTime();
  });
  return sorted;
};

const syncTimelineCanvasSize = () => {
  if (!timelineCanvas) {
    return;
  }
  const parentWidth =
    timelineCanvas.parentElement?.clientWidth || timelineCanvas.clientWidth;
  timelineCanvasWidth = parentWidth || 960;
  timelineCanvasHeight = 360;
  timelineCanvas.width = timelineCanvasWidth;
  timelineCanvas.height = timelineCanvasHeight;
};

const clearSelectedDatePanel = (message = "No photos selected yet.") => {
  if (selectedDateHeading) {
    selectedDateHeading.innerText = "Selected day";
  }
  if (selectedDateList) {
    selectedDateList.innerHTML = `<li class="date-photo-list__placeholder">${message}</li>`;
  }
  if (timelineLabel) {
    timelineLabel.innerText = "No date selected";
  }
};

const updateSelectedDatePanel = () => {
  if (!timelineBuckets.length) {
    clearSelectedDatePanel();
    return;
  }
  const bucket =
    timelineBuckets[activeTimelineIndex] ||
    timelineBuckets[timelineBuckets.length - 1];
  if (!bucket) {
    clearSelectedDatePanel();
    return;
  }
  const titleSuffix = bucket.photos.length === 1 ? "photo" : "photos";
  if (selectedDateHeading) {
    selectedDateHeading.innerText = `${bucket.label} • ${bucket.photos.length} ${titleSuffix}`;
  }
  if (timelineLabel) {
    timelineLabel.innerText = bucket.label;
  }
  if (!selectedDateList) {
    return;
  }
  selectedDateList.innerHTML = "";
  const previewPhotos = bucket.photos.slice(0, MAX_DATE_PREVIEW_PHOTOS);
  previewPhotos.forEach((photo) => {
    const listItem = document.createElement("li");
    listItem.className = "date-photo-card";
    listItem.innerHTML = `
      <img src="${photo.src}" alt="${photo.caption || "Photo"}" loading="lazy">
      <span>${photo.caption || photo.dateLabel || "Untitled photo"}</span>
    `;
    selectedDateList.appendChild(listItem);
  });
  if (!previewPhotos.length) {
    const placeholder = document.createElement("li");
    placeholder.className = "date-photo-list__placeholder";
    placeholder.innerText = "No visible thumbnails for this day.";
    selectedDateList.appendChild(placeholder);
  } else if (bucket.photos.length > previewPhotos.length) {
    const extra = bucket.photos.length - previewPhotos.length;
    const moreItem = document.createElement("li");
    moreItem.className = "date-photo-list__placeholder";
    moreItem.innerText = `+${extra} more ${extra === 1 ? "photo" : "photos"} from this day`;
    selectedDateList.appendChild(moreItem);
  }
};

const renderTimelineCanvas = () => {
  if (!timelineCanvas || !timelineCtx) {
    return;
  }
  syncTimelineCanvasSize();
  const now =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  timelineCtx.clearRect(0, 0, timelineCanvasWidth, timelineCanvasHeight);
  const skyGradient = timelineCtx.createLinearGradient(
    0,
    0,
    timelineCanvasWidth,
    timelineCanvasHeight,
  );
  skyGradient.addColorStop(0, "#041428");
  skyGradient.addColorStop(0.5, "#062038");
  skyGradient.addColorStop(1, "#010b16");
  timelineCtx.fillStyle = skyGradient;
  timelineCtx.fillRect(0, 0, timelineCanvasWidth, timelineCanvasHeight);

  starField.forEach((star, index) => {
    const twinkle =
      star.alpha * (0.7 + Math.sin(now / 1000 + index * 0.37) * 0.25);
    timelineCtx.beginPath();
    timelineCtx.fillStyle = `rgba(255,255,255,${twinkle})`;
    timelineCtx.arc(
      star.x * timelineCanvasWidth,
      star.y * (timelineCanvasHeight - 100) + 20,
      star.size,
      0,
      Math.PI * 2,
    );
    timelineCtx.fill();
  });

  if (!timelineBuckets.length) {
    return;
  }
  const orbitMultiplier = 0.55 + (dialSettings.orbitHeight / 100) * 1.25;
  const glowMultiplier = 0.45 + (dialSettings.glowStrength / 100) * 2.1;
  const axisY = timelineCanvasHeight - TIMELINE_AXIS_OFFSET_Y;
  const axisStart = TIMELINE_AXIS_PADDING_X;
  const axisEnd = timelineCanvasWidth - TIMELINE_AXIS_PADDING_X;
  const axisGradient = timelineCtx.createLinearGradient(
    axisStart,
    axisY,
    axisEnd,
    axisY,
  );
  axisGradient.addColorStop(0, "rgba(0, 245, 212, 0.1)");
  axisGradient.addColorStop(0.5, "rgba(255, 214, 10, 0.5)");
  axisGradient.addColorStop(1, "rgba(0, 123, 255, 0.35)");
  timelineCtx.strokeStyle = axisGradient;
  timelineCtx.lineWidth = 3;
  timelineCtx.shadowColor = "rgba(255, 214, 10, 0.25)";
  timelineCtx.shadowBlur = 18 * glowMultiplier;
  timelineCtx.beginPath();
  timelineCtx.moveTo(axisStart, axisY);
  timelineCtx.lineTo(axisEnd, axisY);
  timelineCtx.stroke();
  timelineCtx.shadowBlur = 0;

  const divisor = Math.max(timelineBuckets.length - 1, 1);
  const gap = (axisEnd - axisStart) / divisor;

  timelineBuckets.forEach((bucket, index) => {
    const centerX = axisStart + gap * index;
    const isActive = index === activeTimelineIndex;
    const radius = Math.min(46, 16 + Math.sqrt(bucket.photos.length || 1) * 6);
    const lift = Math.min(bucket.photos.length * 3 * orbitMultiplier, 130);
    const centerY = axisY - 40 - lift;
    const glowStrength = (isActive ? 14 : 8) * glowMultiplier;
    const passiveGlowAlpha = Math.min(0.25 + glowMultiplier * 0.08, 0.9);

    timelineCtx.save();
    timelineCtx.lineWidth = isActive ? 4 : 2;
    timelineCtx.shadowColor = isActive
      ? "rgba(255, 214, 10, 0.65)"
      : `rgba(128, 208, 199, ${passiveGlowAlpha})`;
    timelineCtx.shadowBlur = glowStrength;
    const bubbleGradient = timelineCtx.createRadialGradient(
      centerX,
      centerY,
      Math.max(radius - 10, 8),
      centerX,
      centerY,
      radius + 10,
    );
    if (isActive) {
      bubbleGradient.addColorStop(0, "#fff4c3");
      bubbleGradient.addColorStop(0.6, "#ffd60a");
      bubbleGradient.addColorStop(1, "rgba(255, 214, 10, 0.3)");
    } else if (bucket.date) {
      bubbleGradient.addColorStop(0, "#9df0ff");
      bubbleGradient.addColorStop(0.6, "#46c7f2");
      bubbleGradient.addColorStop(1, "rgba(70, 199, 242, 0.15)");
    } else {
      bubbleGradient.addColorStop(0, "#e0e0e0");
      bubbleGradient.addColorStop(1, "rgba(122, 134, 154, 0.2)");
    }
    timelineCtx.strokeStyle = isActive
      ? "rgba(255, 214, 10, 0.9)"
      : "rgba(255, 255, 255, 0.35)";
    timelineCtx.fillStyle = bubbleGradient;
    timelineCtx.beginPath();
    timelineCtx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    timelineCtx.fill();
    timelineCtx.stroke();
    timelineCtx.restore();

    const thumbnailEntry = bucketThumbnailCache.get(bucket.key);
    if (thumbnailEntry?.status === "ready" && thumbnailEntry.image) {
      const insetRadius = Math.max(radius - 8, 12);
      const thumbSize = insetRadius * 2;
      timelineCtx.save();
      timelineCtx.beginPath();
      timelineCtx.arc(centerX, centerY, insetRadius, 0, Math.PI * 2);
      timelineCtx.closePath();
      timelineCtx.clip();
      timelineCtx.drawImage(
        thumbnailEntry.image,
        centerX - insetRadius,
        centerY - insetRadius,
        thumbSize,
        thumbSize,
      );
      timelineCtx.restore();
    } else if (thumbnailEntry?.status === "loading") {
      timelineCtx.save();
      timelineCtx.strokeStyle = "rgba(255,255,255,0.8)";
      timelineCtx.lineWidth = 2;
      timelineCtx.setLineDash([4, 4]);
      timelineCtx.beginPath();
      timelineCtx.arc(centerX, centerY, radius - 6, 0, Math.PI * 2);
      timelineCtx.stroke();
      timelineCtx.restore();
    }

    if (isActive) {
      timelineCtx.save();
      timelineCtx.globalAlpha = 0.6;
      timelineCtx.strokeStyle = "rgba(255, 214, 10, 0.6)";
      timelineCtx.lineWidth = 6;
      timelineCtx.setLineDash([8, 6]);
      timelineCtx.shadowColor = "rgba(255, 214, 10, 0.5)";
      timelineCtx.shadowBlur = 20 * glowMultiplier;
      timelineCtx.beginPath();
      timelineCtx.arc(centerX, centerY, radius + 10, 0, Math.PI * 2);
      timelineCtx.stroke();
      timelineCtx.restore();
    }

    timelineCtx.save();
    timelineCtx.fillStyle = "rgba(255, 255, 255, 0.9)";
    timelineCtx.font = isActive
      ? "600 14px 'Inter', sans-serif"
      : "12px sans-serif";
    timelineCtx.textAlign = "center";
    timelineCtx.textBaseline = "middle";
    timelineCtx.fillText(bucket.shortLabel, centerX, axisY + 20);
    timelineCtx.fillStyle = "rgba(255, 255, 255, 0.75)";
    timelineCtx.font = "11px sans-serif";
    timelineCtx.fillText(
      `${bucket.photos.length} ${bucket.photos.length === 1 ? "photo" : "photos"}`,
      centerX,
      axisY + 36,
    );
    timelineCtx.restore();

    timelineCtx.save();
    timelineCtx.strokeStyle = "rgba(255, 255, 255, 0.08)";
    timelineCtx.lineWidth = 1.5;
    timelineCtx.setLineDash([4, 6]);
    timelineCtx.beginPath();
    timelineCtx.moveTo(centerX, axisY);
    timelineCtx.lineTo(centerX, centerY + radius);
    timelineCtx.stroke();
    timelineCtx.restore();
  });
};

const scheduleTimelineRender = () => {
  if (!timelineCanvas || !timelineCtx) {
    return;
  }
  if (timelineAnimationFrame) {
    cancelAnimationFrame(timelineAnimationFrame);
  }
  timelineAnimationFrame = window.requestAnimationFrame(() => {
    renderTimelineCanvas();
  });
};

const updateCanvasWorld = (photos = []) => {
  timelineBuckets = buildTimelineBuckets(photos);
  warmBucketThumbnails(timelineBuckets);
  if (!timelineBuckets.length) {
    pruneBucketThumbnails([]);
    if (timelineStatus) {
      timelineStatus.innerText =
        "No photos yet. Load a Photos Library to populate the canvas world.";
    }
    if (timelineSlider) {
      timelineSlider.disabled = true;
      timelineSlider.value = 0;
      timelineSlider.min = 0;
      timelineSlider.max = 0;
    }
    clearSelectedDatePanel();
    scheduleTimelineRender();
    return;
  }
  if (timelineStatus) {
    timelineStatus.innerText = `Organized ${photos.length} photo${
      photos.length === 1 ? "" : "s"
    } into ${timelineBuckets.length} date group${
      timelineBuckets.length === 1 ? "" : "s"
    }.`;
  }
  activeTimelineIndex = Math.min(
    activeTimelineIndex,
    timelineBuckets.length - 1,
  );
  if (timelineSlider) {
    timelineSlider.disabled = timelineBuckets.length <= 1;
    timelineSlider.min = 0;
    timelineSlider.max = timelineBuckets.length - 1;
    timelineSlider.value = activeTimelineIndex;
  }
  updateSelectedDatePanel();
  scheduleTimelineRender();
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
  const normalizedPhotos = Array.isArray(photos)
    ? photos.map((photo) => normalizePhotoMetadata(photo)).filter(Boolean)
    : [];
  currentPhotoSources = normalizedPhotos;
  if (normalizedPhotos.length > 0) {
    setPhotosPermissionState("granted");
  } else if (photosPermissionState !== "error") {
    setPhotosPermissionState("pending");
  }
  updateCanvasWorld(currentPhotoSources);
};

const updateLibraryStatus = (message, { isError = false } = {}) => {
  if (!libraryStatus) return;
  libraryStatus.innerText = message;
  libraryStatus.classList.toggle("library-status--error", isError);
};

syncTimelineCanvasSize();
updateCanvasWorld(currentPhotoSources);

updateLibraryStatus(
  "Link your ~/Photos/Photos Library to populate the JarView canvas.",
);

timelineSlider?.addEventListener("input", (event) => {
  const nextIndex = Number(event.target.value);
  activeTimelineIndex = Number.isNaN(nextIndex) ? 0 : nextIndex;
  updateSelectedDatePanel();
  scheduleTimelineRender();
});

const handleDialInput = (field, outputElement) => (event) => {
  const nextValue = Number(event.target.value);
  if (!Number.isFinite(nextValue)) {
    return;
  }
  dialSettings[field] = nextValue;
  updateDialOutput(outputElement, nextValue);
  scheduleTimelineRender();
};

updateDialOutput(orbitDialValue, dialSettings.orbitHeight);
updateDialOutput(glowDialValue, dialSettings.glowStrength);
orbitDial?.addEventListener(
  "input",
  handleDialInput("orbitHeight", orbitDialValue),
);
glowDial?.addEventListener(
  "input",
  handleDialInput("glowStrength", glowDialValue),
);

window.addEventListener("resize", () => {
  syncTimelineCanvasSize();
  scheduleTimelineRender();
});

const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".heic", ".heif"];
const MAX_DYNAMIC_PHOTOS = 60;
const MAX_DIRECTORY_SEARCH_DEPTH = 5;
const MAX_PREVIEW_DIMENSION = 720;
const PREVIEW_EXPORT_TYPE = "image/jpeg";
const PREVIEW_EXPORT_QUALITY = 0.82;

const canvasToBlob = (
  canvas,
  { type = PREVIEW_EXPORT_TYPE, quality = PREVIEW_EXPORT_QUALITY } = {},
) => {
  if (!canvas) {
    return Promise.reject(
      new Error("Canvas not available for thumbnail rendering."),
    );
  }
  if (typeof canvas.convertToBlob === "function") {
    return canvas.convertToBlob({ type, quality });
  }
  if (typeof canvas.toBlob !== "function") {
    return Promise.reject(new Error("Canvas blob export is unsupported."));
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("Failed to convert canvas to blob."));
        }
      },
      type,
      quality,
    );
  });
};

const decodeImageSource = async (file) => {
  if (!file) {
    throw new Error("No file supplied for decoding.");
  }
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    return {
      image: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      cleanup: () => bitmap.close && bitmap.close(),
    };
  }
  if (typeof Image === "undefined") {
    throw new Error("Browser cannot decode images in this environment.");
  }
  return new Promise((resolve, reject) => {
    const tempUrl = URL.createObjectURL(file);
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      const width = image.naturalWidth || image.width;
      const height = image.naturalHeight || image.height;
      URL.revokeObjectURL(tempUrl);
      resolve({
        image,
        width,
        height,
        cleanup: () => {
          image.src = "";
        },
      });
    };
    image.onerror = (error) => {
      URL.revokeObjectURL(tempUrl);
      reject(error || new Error("Unable to decode image."));
    };
    image.src = tempUrl;
  });
};

const createPreviewUrlFromFile = async (file) => {
  if (!file) {
    return { src: null, urls: [] };
  }
  if (
    typeof document === "undefined" &&
    typeof OffscreenCanvas === "undefined"
  ) {
    const fallbackUrl = URL.createObjectURL(file);
    return { src: fallbackUrl, urls: [fallbackUrl] };
  }
  try {
    const decoded = await decodeImageSource(file);
    const maxSide = Math.max(decoded.width || 0, decoded.height || 0);
    if (!maxSide || maxSide <= MAX_PREVIEW_DIMENSION) {
      const passthroughUrl = URL.createObjectURL(file);
      decoded.cleanup?.();
      return { src: passthroughUrl, urls: [passthroughUrl] };
    }
    const scale = MAX_PREVIEW_DIMENSION / maxSide;
    const width =
      Math.round((decoded.width || 0) * scale) || MAX_PREVIEW_DIMENSION;
    const height =
      Math.round((decoded.height || 0) * scale) || MAX_PREVIEW_DIMENSION;
    let canvas = null;
    if (typeof OffscreenCanvas !== "undefined") {
      canvas = new OffscreenCanvas(width, height);
    } else if (typeof document !== "undefined") {
      canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
    }
    if (!canvas) {
      decoded.cleanup?.();
      const fallbackUrl = URL.createObjectURL(file);
      return { src: fallbackUrl, urls: [fallbackUrl] };
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      decoded.cleanup?.();
      const fallbackUrl = URL.createObjectURL(file);
      return { src: fallbackUrl, urls: [fallbackUrl] };
    }
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(decoded.image, 0, 0, width, height);
    decoded.cleanup?.();
    const blob = await canvasToBlob(canvas);
    const previewUrl = URL.createObjectURL(blob);
    if (!(canvas instanceof OffscreenCanvas)) {
      canvas.width = 0;
      canvas.height = 0;
    }
    return { src: previewUrl, urls: [previewUrl] };
  } catch (error) {
    console.warn("Falling back to original resolution for preview", error);
    const fallbackUrl = URL.createObjectURL(file);
    return { src: fallbackUrl, urls: [fallbackUrl] };
  }
};

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
    "Could not locate a Photos Library resources/derivatives folder inside that selection.",
  );
};

const collectPhotosFromHandle = async (
  dirHandle,
  limit = MAX_DYNAMIC_PHOTOS,
) => {
  const photos = [];
  const objectUrls = [];

  const walkDirectory = async (directoryHandle) => {
    for await (const entry of directoryHandle.values()) {
      if (photos.length >= limit) break;
      if (entry.kind === "file" && isImageFile(entry.name)) {
        const file = await entry.getFile();
        const { src, urls } = await createPreviewUrlFromFile(file);
        const takenOn = file.lastModified ? new Date(file.lastModified) : null;
        photos.push({
          src,
          caption: file.name,
          takenOn,
          lastModified: file.lastModified,
        });
        if (urls?.length) {
          objectUrls.push(...urls);
        }
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
      { isError: true },
    );
    setPhotosPermissionState("error");
    return;
  }
  try {
    updateLibraryStatus(
      "Choose your Photos Library package to grant read-only access...",
    );
    const rootHandle = await window.showDirectoryPicker({ mode: "read" });
    const derivativesHandle = await resolveDerivativesHandle(rootHandle);
    updateLibraryStatus("Loading photos from library...");
    const { photos, objectUrls } =
      await collectPhotosFromHandle(derivativesHandle);
    if (!photos.length) {
      updateLibraryStatus(
        "No images were found in the selected folder. Please try another directory.",
        { isError: true },
      );
      if (photosPermissionState !== "error") {
        setPhotosPermissionState("pending");
      }
      return;
    }
    setPhotoSources(photos, { objectUrls });
    updateLibraryStatus(`Retrieved ${photos.length} photos.`);
  } catch (error) {
    if (error?.name === "AbortError") {
      updateLibraryStatus("Folder selection was cancelled.");
      return;
    }
    console.error("Unable to access Photos Library:", error);
    updateLibraryStatus(
      "Unable to access that folder. Ensure it is your Photos Library and retry.",
      { isError: true },
    );
    setPhotosPermissionState("error");
  }
};

selectLibraryButton?.addEventListener("click", requestPhotosLibraryAccess);
if (!window.showDirectoryPicker && selectLibraryButton) {
  selectLibraryButton.disabled = true;
  updateLibraryStatus(
    "Folder access requires a Chromium-based browser (Chrome, Edge, Arc, etc.).",
    { isError: true },
  );
  setPhotosPermissionState("error");
}

cameraPermissionButton?.addEventListener("click", requestCameraPermissionOnly);

const mirrorLandmarks = (landmarks) => {
  if (!landmarks) {
    return [];
  }
  return landmarks.map((landmark) => ({
    ...landmark,
    x: 1 - landmark.x,
  }));
};

const computeThumbIndexMetrics = (landmarks) => {
  if (
    !landmarks ||
    !landmarks[THUMB_TIP_INDEX] ||
    !landmarks[INDEX_TIP_INDEX]
  ) {
    return null;
  }

  const thumbTip = landmarks[THUMB_TIP_INDEX];
  const indexTip = landmarks[INDEX_TIP_INDEX];
  const start = {
    x: thumbTip.x * canvasElement.width,
    y: thumbTip.y * canvasElement.height,
  };
  const end = {
    x: indexTip.x * canvasElement.width,
    y: indexTip.y * canvasElement.height,
  };

  const distancePx = Math.hypot(end.x - start.x, end.y - start.y);
  const midPoint = {
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2,
  };

  return {
    start,
    end,
    midPoint,
    distancePx,
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
    1,
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
  canvasCtx.fillRect(
    backgroundX,
    backgroundY,
    backgroundWidth,
    backgroundHeight,
  );

  canvasCtx.fillStyle = "#FFD60A";
  canvasCtx.fillText(label, metrics.midPoint.x - textMetrics.width / 2, textY);
  canvasCtx.restore();
};

const updateInteractivity = (metrics) => {
  if (!metrics) {
    return;
  }

  if (
    metrics.handedness === "Left" &&
    timelineSlider &&
    !timelineSlider.disabled
  ) {
    const sliderMax = Number(timelineSlider.max);
    if (Number.isFinite(sliderMax) && sliderMax >= 0) {
      const distancePercentage = Math.min(metrics.distancePx, 300) / 300;
      const nextIndex = Math.min(
        sliderMax,
        Math.max(0, Math.round(sliderMax * distancePercentage)),
      );
      if (nextIndex !== activeTimelineIndex) {
        activeTimelineIndex = nextIndex;
        if (timelineSlider.value !== String(nextIndex)) {
          timelineSlider.value = String(nextIndex);
        }
        updateSelectedDatePanel();
        scheduleTimelineRender();
      }
    }
  }

  if (metrics.handedness === "Right") {
    if (!selectedDatePanel) {
      return;
    }
    const distancePercentage = Math.min(metrics.distancePx, 300) / 300;
    const scrollableAmount = Math.max(
      0,
      selectedDatePanel.scrollHeight - selectedDatePanel.clientHeight,
    );
    const targetScrollTop = scrollableAmount * distancePercentage;
    if (Math.abs(selectedDatePanel.scrollTop - targetScrollTop) > 1) {
      selectedDatePanel.scrollTop = targetScrollTop;
    }
  }
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

const drawPinchedHandsDistanceLabel = (firstPinch, secondPinch, distancePx) => {
  if (!firstPinch || !secondPinch || typeof distancePx !== "number") {
    return;
  }
  const midPoint = {
    x: (firstPinch.midPoint.x + secondPinch.midPoint.x) / 2,
    y: (firstPinch.midPoint.y + secondPinch.midPoint.y) / 2,
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
  canvasCtx.fillRect(
    backgroundX,
    backgroundY,
    backgroundWidth,
    backgroundHeight,
  );
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
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm",
  );
  gestureRecognizer = await GestureRecognizer.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task",
      delegate: "GPU",
    },
    runningMode: runningMode,
    numHands: MAX_HANDS,
  });
  demosSection.classList.remove("invisible");
};
const gestureRecognizerReady = createGestureRecognizer();

function ensureWebcamFeed() {
  if (webcamRunning || cameraPermissionState !== "granted") {
    return;
  }
  if (!hasGetUserMedia()) {
    return;
  }
  gestureRecognizerReady
    .then(() => {
      if (!webcamRunning && cameraPermissionState === "granted") {
        enableCam();
      }
    })
    .catch((error) => {
      console.error("Unable to start webcam automatically:", error);
    });
}

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
      numHands: MAX_HANDS,
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
          lineWidth: 5,
        },
      );
      drawingUtils.drawLandmarks(landmarks, {
        color: "#FF0000",
        lineWidth: 1,
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
  "requestPermissionButton",
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
  { showButton = true } = {},
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
      setCameraPermissionState(mapPermissionDescriptorState(status.state));
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

// If webcam supported, initialize permission tracking.
if (hasGetUserMedia()) {
  initCameraPermissionStatus();
} else {
  console.warn("getUserMedia() is not supported by your browser");
  showPermissionNotice(
    "This browser does not support camera access required for gesture recognition.",
  );
  if (requestPermissionButton) {
    requestPermissionButton.classList.add("hidden");
  }
  setCameraPermissionState("error");
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
  if (gestureOutput) {
    gestureOutput.style.display = "none";
  }
}

async function requestCameraPermissionOnly() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setCameraPermissionState("error");
    console.warn("Camera permission request is unavailable in this browser.");
    return;
  }
  if (cameraPermissionButton) {
    cameraPermissionButton.disabled = true;
    setButtonLabel(cameraPermissionButton, "Requesting...");
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    stream.getTracks().forEach((track) => track.stop());
    setCameraPermissionState("granted");
  } catch (error) {
    console.error("Unable to complete camera permission request:", error);
    const blocked =
      error.name === "NotAllowedError" ||
      error.name === "SecurityError" ||
      error.name === "PermissionDeniedError";
    setCameraPermissionState(blocked ? "error" : "pending");
  } finally {
    if (cameraPermissionButton && cameraPermissionState !== "granted") {
      cameraPermissionButton.disabled = false;
      setButtonLabel(cameraPermissionButton, CAMERA_PERMISSION_LABEL);
    }
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
      "Camera access is unavailable in this browser. Please switch to a supported browser to continue.",
    );
    return;
  }

  if (fromPermissionButton && requestPermissionButton) {
    requestPermissionButton.disabled = true;
    requestPermissionButton.innerText = "REQUESTING...";
  }

  const constraints = {
    video: true,
  };

  navigator.mediaDevices
    .getUserMedia(constraints)
    .then((stream) => {
      activeStream = stream;
      video.srcObject = stream;
      video.removeEventListener("loadeddata", predictWebcam);
      video.addEventListener("loadeddata", predictWebcam);
      webcamRunning = true;
      setCameraPermissionState("granted");
      if (requestPermissionButton) {
        requestPermissionButton.innerText = "RE-REQUEST CAMERA";
      }
      hidePermissionNotice();
    })
    .catch((error) => {
      activeStream = null;
      webcamRunning = false;
      const blocked =
        error.name === "NotAllowedError" ||
        error.name === "SecurityError" ||
        error.name === "PermissionDeniedError";
      setCameraPermissionState(blocked ? "error" : "pending");
      if (requestPermissionButton) {
        requestPermissionButton.innerText = "RE-REQUEST CAMERA";
      }
      const message = blocked
        ? PERMISSION_BLOCKED_MESSAGE
        : "Unable to access the camera. Make sure no other app is using it and try again.";
      showPermissionNotice(message, { showButton: blocked });
      console.error("Error accessing camera:", error);
    })
    .finally(() => {
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
      numHands: MAX_HANDS,
    });
  }
  let nowInMs = Date.now();
  if (video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    results = gestureRecognizer.recognizeForVideo(video, nowInMs);
  }

  if (video.videoWidth && video.videoHeight) {
    if (
      canvasElement.width !== video.videoWidth ||
      canvasElement.height !== video.videoHeight
    ) {
      canvasElement.width = video.videoWidth;
      canvasElement.height = video.videoHeight;
    }
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
    // Process each hand
    results.landmarks.forEach((landmarks, index) => {
      const mirroredLandmarks = mirrorLandmarks(landmarks);
      drawingUtils.drawConnectors(
        mirroredLandmarks,
        GestureRecognizer.HAND_CONNECTIONS,
        {
          color: "#00FF00",
          lineWidth: 5,
        },
      );
      drawingUtils.drawLandmarks(mirroredLandmarks, {
        color: "#FF0000",
        lineWidth: 2,
      });
      const metrics = computeThumbIndexMetrics(mirroredLandmarks);
      if (metrics) {
        const handedness =
          results.handednesses?.[index]?.[0]?.displayName || "Unknown";
        const metricDetails = {
          ...metrics,
          handedness: flipHandedness(handedness),
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
      secondPinch.midPoint.y - firstPinch.midPoint.y,
    );
    drawPinchedHandsDistanceLabel(
      firstPinch,
      secondPinch,
      pinchedHandsDistance,
    );
  }
  thumbIndexMetrics.forEach((metrics) => {
    drawThumbIndexLabel(metrics);
    updateInteractivity(metrics);
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
