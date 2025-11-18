import { bootstrapAlert } from "https://cdn.jsdelivr.net/npm/bootstrap-alert@1";
import { OUTPUT_STYLES, REVEAL_THEMES, MIN_CHARS_FOR_SLIDE, SILENCE_THRESHOLD, removeDuplicateSentences, escapeHtml,
  saveConfig, loadConfig, createPresentationHTML
} from "./utils.js";

const $apiKey = document.getElementById("api-key");
const $modelSelect = document.getElementById("model-select");
const $styleSelect = document.getElementById("style-select");
const $themeSelect = document.getElementById("theme-select");
const $recordBtn = document.getElementById("record-btn");
const $prevSlideBtn = document.getElementById("prev-slide-btn");
const $nextSlideBtn = document.getElementById("next-slide-btn");
const $openPresentationBtn = document.getElementById("open-presentation-btn");
const $statusIndicator = document.getElementById("status-indicator");
const $connectionStatus = document.getElementById("connection-status");
const $slideCount = document.getElementById("slide-count");
const $currentSlideNum = document.getElementById("current-slide-num");
const $slidePreview = document.getElementById("slide-preview");
const $transcriptBox = document.getElementById("transcript-box");
const $bufferStatus = document.getElementById("buffer-status");
const $configBtn = document.getElementById("config-btn");
const $configModal = document.getElementById("config-modal");
const $configOverlay = document.getElementById("config-overlay");
const $closeConfigBtn = document.getElementById("close-config-btn");
const $saveConfigBtn = document.getElementById("save-config-btn");

let isRecording = false;
let peerConnection = null;
let dataChannel = null;
let mediaStream = null;
let presentationWindow = null;
let slides = [];
let currentSlideIndex = -1;
let currentSegmentBuffer = "";
let transcriptSegments = [];
let processedTexts = new Set();
let silenceCheckInterval = null;
let lastSpeechTime = 0;

$configBtn.onclick = () => {
  $configModal.classList.add("show");
  $configOverlay.classList.add("show");
};

$closeConfigBtn.onclick = $configOverlay.onclick = () => {
  $configModal.classList.remove("show");
  $configOverlay.classList.remove("show");
};

$saveConfigBtn.onclick = () => {
  saveConfig($apiKey, $modelSelect, $styleSelect, $themeSelect);
  bootstrapAlert({ title: "Saved", body: "Configuration saved successfully.", color: "success" });
  $configModal.classList.remove("show");
  $configOverlay.classList.remove("show");
  updateControlsState();
};

$apiKey.oninput = () => {
  saveConfig($apiKey, $modelSelect, $styleSelect, $themeSelect);
  updateControlsState();
};

$modelSelect.onchange = $styleSelect.onchange = () => saveConfig($apiKey, $modelSelect, $styleSelect, $themeSelect);

$themeSelect.onchange = () => {
  saveConfig($apiKey, $modelSelect, $styleSelect, $themeSelect);
  if (presentationWindow && !presentationWindow.closed) updatePresentationTheme();
};

const updateControlsState = () => {
  const hasKey = !!$apiKey.value.trim();
  $recordBtn.disabled = !hasKey;
  $openPresentationBtn.disabled = !hasKey;
};

loadConfig($apiKey, $modelSelect, $styleSelect, $themeSelect);
updateControlsState();

$recordBtn.onclick = () => isRecording ? stopRecording() : startRecording();
$prevSlideBtn.onclick = () => navigateSlide(-1);
$nextSlideBtn.onclick = () => navigateSlide(1);
$openPresentationBtn.onclick = openPresentationWindow;

async function startRecording() {
  try {
    updateStatus("connecting", "Connecting...");
    currentSegmentBuffer = "";
    transcriptSegments = [];
    processedTexts.clear();
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    peerConnection = new RTCPeerConnection();
    mediaStream.getAudioTracks().forEach(track => peerConnection.addTrack(track, mediaStream));
    dataChannel = peerConnection.createDataChannel("oai-events");
    setupDataChannel();

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    const response = await fetch(`https://api.openai.com/v1/realtime?model=${$modelSelect.value}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${$apiKey.value.trim()}`,
        "Content-Type": "application/sdp",
      },
      body: offer.sdp,
    });
    if (!response.ok) throw new Error(`API Error: ${response.status}`);
    await peerConnection.setRemoteDescription({ type: "answer", sdp: await response.text() });
    
    isRecording = true;
    $recordBtn.classList.add("btn-danger", "recording");
    $recordBtn.classList.remove("btn-outline-danger");
    $recordBtn.querySelector("span").textContent = "Stop Recording";
    $recordBtn.querySelector("i").className = "bi bi-stop-circle me-2";
    updateStatus("connected", "Connected");
    lastSpeechTime = Date.now();
    silenceCheckInterval = setInterval(checkSilence, 1000);
    if (!presentationWindow || presentationWindow.closed) openPresentationWindow();
  } catch (error) {
    bootstrapAlert({ title: "Failed", body: error.message, color: "danger" });
    cleanup();
    updateStatus("disconnected", "Failed");
  }
}

function setupDataChannel() {
  dataChannel.onopen = () => {
    dataChannel.send(JSON.stringify({
      type: "session.update",
      session: {
        modalities: ["text", "audio"],
        instructions: "Transcribe speech accurately.",
        input_audio_transcription: { model: "whisper-1" },
        turn_detection: {
          type: "server_vad",
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 500,
        },
      },
    }));
  };

  dataChannel.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === "conversation.item.input_audio_transcription.completed" && msg.transcript) {
      addTranscript(msg.transcript);
    } else if (msg.type === "input_audio_buffer.speech_started") {
      lastSpeechTime = Date.now();
      $bufferStatus.textContent = "Listening...";
    } else if (msg.type === "error") {
      console.error("API Error:", msg.error);
      bootstrapAlert({ title: "Error", body: msg.error?.message || "Unknown error", color: "danger" });
    }
  };
  dataChannel.onclose = () => isRecording && stopRecording();
  dataChannel.onerror = () => bootstrapAlert({ title: "Error", body: "Data channel error", color: "danger" });
}

function addTranscript(text) {
  const cleaned = text.trim();
  if (!cleaned) return;
  const textHash = cleaned.toLowerCase();
  if (processedTexts.has(textHash)) {  return; }
  processedTexts.add(textHash);
  const timestamp = new Date().toLocaleTimeString();
  currentSegmentBuffer += cleaned + " ";
  transcriptSegments.push({ text: cleaned, timestamp });
  lastSpeechTime = Date.now();
  updateTranscriptDisplay();
  checkSlideGeneration();
}

function updateTranscriptDisplay() {
  $transcriptBox.innerHTML = transcriptSegments.map(seg => `
    <div class="mb-2">
      <span class="badge bg-secondary me-2">${seg.timestamp}</span>
      <span class="text-body">${escapeHtml(seg.text)}</span>
    </div>
  `).join('') || '<span class="text-muted">Waiting for speech...</span>';
  $transcriptBox.scrollTop = $transcriptBox.scrollHeight;
  $bufferStatus.textContent = `Buffer: ${currentSegmentBuffer.length} chars`;
}

function checkSlideGeneration() {
  if (currentSegmentBuffer.length < MIN_CHARS_FOR_SLIDE) return;
  const match = currentSegmentBuffer.match(/^(.*[.!?])\s+(.*)$/s);
  if (match) {
    const [, complete, remaining] = match;
    createSlide(complete);
    currentSegmentBuffer = remaining.trim();
  }
}

function checkSilence() {
  if (Date.now() - lastSpeechTime >= SILENCE_THRESHOLD && currentSegmentBuffer.trim()) {
    createSlide(currentSegmentBuffer.trim());
    currentSegmentBuffer = "";
  }
}

async function createSlide(content) {
  if (!content?.trim()) return;
  const cleanedContent = removeDuplicateSentences(content);
  if (!cleanedContent) return;
  $bufferStatus.textContent = "Generating slide...";
  
  const slideData = await generateSlide(cleanedContent);
  if (!slideData) return;
  slides.push({
    title: slideData.title,
    content: slideData.content,
    originalContent: cleanedContent,
    style: $styleSelect.value,
    timestamp: new Date().toISOString(),
  });
  currentSlideIndex = slides.length - 1;
  updateSlideCount();
  updateSlidePreview();
  updatePresentationWindow();
  
  $prevSlideBtn.disabled = slides.length <= 1;
  $nextSlideBtn.disabled = true;
  $bufferStatus.textContent = `Buffer: ${currentSegmentBuffer.length} chars`;
}

async function generateSlide(content) {
  const apiKey = $apiKey.value.trim();
  const style = OUTPUT_STYLES[$styleSelect.value];
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-3.5-turbo",
        messages: [
          { role: "system", content: style.systemPrompt },
          { role: "user", content: content }
        ],
        response_format: { type: "json_object" }
      }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const result = JSON.parse(data.choices[0].message.content);
    return { title: result.title || "📌 Key Point", content: result.content || content };
  } catch (error) {
     throw new Error("Slide generation failed: " + error.message);
  }
}

function updateSlideCount() {
  $slideCount.textContent = slides.length;
  $currentSlideNum.textContent = currentSlideIndex >= 0 ? currentSlideIndex + 1 : "-";
}

function updateSlidePreview() {
  if (currentSlideIndex < 0) {
    $slidePreview.innerHTML = '<p class="text-muted text-center">No slides yet.</p>';
    return;
  }

  const slide = slides[currentSlideIndex];
  $slidePreview.innerHTML = `
    <h4 class="text-primary">${escapeHtml(slide.title)}</h4>
    <hr>
    <div style="white-space: pre-line; font-size: 0.95rem;">${escapeHtml(slide.content)}</div>
    <small class="text-muted d-block mt-2">Style: ${OUTPUT_STYLES[slide.style]?.name}</small>
  `;
}

function navigateSlide(direction) {
  const newIndex = currentSlideIndex + direction;
  if (newIndex >= 0 && newIndex < slides.length) {
    currentSlideIndex = newIndex;
    updateSlideCount();
    updateSlidePreview();
    syncPresentationSlide();
    $prevSlideBtn.disabled = currentSlideIndex === 0;
    $nextSlideBtn.disabled = currentSlideIndex === slides.length - 1;
  }
}

function openPresentationWindow() {
  if (presentationWindow && !presentationWindow.closed) return presentationWindow.focus();
  const themeFile = REVEAL_THEMES[$themeSelect.value]?.file || "league.css";
  const html = createPresentationHTML(slides, escapeHtml, themeFile);
  const [width, height] = [800, 600];
  presentationWindow = window.open(
    "", 
    "LiveSlidesPresentation", 
    `width=${width},height=${height},left=${(screen.width - width) / 2},top=${(screen.height - height) / 2},scrollbars=no,resizable=yes`
  );
  if (!presentationWindow) {
    return bootstrapAlert({ title: "Popup Blocked", body: "Allow popups for this site.", color: "warning" });
  }
  presentationWindow.document.write(html);
  presentationWindow.document.close();
  presentationWindow.onload = syncPresentationSlide;
}

function updatePresentationWindow() {
  if (!presentationWindow || presentationWindow.closed) return;
  const slide = slides[slides.length - 1];
  try {  presentationWindow.addSlide(escapeHtml(slide.title), escapeHtml(slide.content)); } 
  catch (e) { console.error("Update error:", e); }
}

function updatePresentationTheme() {
  if (!presentationWindow || presentationWindow.closed) return;
  const theme = REVEAL_THEMES[$themeSelect.value]?.file?.replace('.css', '') || 'league';
  try { presentationWindow.updateTheme(theme); } 
  catch (e) { console.error("Theme error:", e); }
}

function syncPresentationSlide() {
  if (presentationWindow && !presentationWindow.closed) {
    try { presentationWindow.goToSlide(currentSlideIndex); }
     catch (e) { console.error("Sync error:", e); }
  }
}

function stopRecording() {
  if (currentSegmentBuffer.trim()) {
    createSlide(currentSegmentBuffer.trim());
    currentSegmentBuffer = "";
  }

  isRecording = false;
  silenceCheckInterval && clearInterval(silenceCheckInterval);
  dataChannel?.close();
  peerConnection?.close();
  mediaStream?.getTracks().forEach(t => t.stop());
  
  $recordBtn.classList.remove("btn-danger", "recording");
  $recordBtn.classList.add("btn-outline-danger");
  $recordBtn.querySelector("span").textContent = "Start Recording";
  $recordBtn.querySelector("i").className = "bi bi-record-circle me-2";
  updateStatus("disconnected", "Disconnected");
  $bufferStatus.textContent = "Paused";
}

const cleanup = stopRecording;

function updateStatus(status, text) {
  $statusIndicator.className = `status-indicator status-${status}`;
  $connectionStatus.textContent = text;
}

window.onbeforeunload = () => {
  cleanup();
  presentationWindow?.close();
};