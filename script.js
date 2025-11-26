import { bootstrapAlert } from "https://cdn.jsdelivr.net/npm/bootstrap-alert@1";
import { DEFAULT_PROMPT, REVEAL_THEMES, escapeHtml, markdownToHtml, update,
  createPresentationHTML, downloadPresentationHTML
} from "./utils.js";
const $ = id => document.getElementById(id);
const $apiKey = $("api-key");
const $modelSelect = $("model-select");
const $themeSelect = $("theme-select");
const $systemPrompt = $("system-prompt");
const $initialTitle = $("initial-title");
const $initialContent = $("initial-content");
const $recordBtn = $("record-btn");
const $prevSlideBtn = $("prev-slide-btn");
const $nextSlideBtn = $("next-slide-btn");
const $openPresentationBtn = $("open-presentation-btn");
const $downloadHtmlBtn = $("download-html-btn");
const $statusIndicator = $("status-indicator");
const $connectionStatus = $("connection-status");
const $slideCount = $("slide-count");
const $currentSlideNum = $("current-slide-num");
const $slidePreview = $("slide-preview");
const $configModal = $("config-modal");
const $configOverlay = $("config-overlay");
let isRecording = false;
let peerConnection = null;
let dataChannel = null;
let mediaStream = null;
let presentationWindow = null;
let slides = [];
let currentSlideIndex = -1;
let responses = {};
const val = el => el.value || el.getAttribute("value");
const logEvent = (direction, eventType, data) => {
  console.log(`[${new Date().toISOString()}] [${direction}] ${eventType}`);
  console.log(JSON.stringify(data, null, 2));
};
const saveConfig = () => localStorage.setItem('liveSlidesConfig', JSON.stringify({
  apiKey: $apiKey.value,
  model: $modelSelect.value,
  theme: $themeSelect.value,
  systemPrompt: $systemPrompt.value,
  initialTitle: $initialTitle.value,
  initialContent: $initialContent.value
}));
const loadConfig = () => {
  const config = JSON.parse(localStorage.getItem('liveSlidesConfig') || '{}');
  $apiKey.value = config.apiKey || '';
  $modelSelect.value = config.model || $modelSelect.getAttribute("value");
  $themeSelect.value = config.theme || $themeSelect.getAttribute("value");
  $systemPrompt.value = config.systemPrompt || $systemPrompt.getAttribute("value");
  $initialTitle.value = config.initialTitle || $initialTitle.getAttribute("value");
  $initialContent.value = config.initialContent || $initialContent.getAttribute("value");
};
const updateControlsState = () => {
  const hasKey = !!$apiKey.value.trim();
  $recordBtn.disabled = !hasKey;
  $openPresentationBtn.disabled = !hasKey;
  $downloadHtmlBtn.disabled = !slides.length;
};
const updateStatus = (status, text) => {
  const colors = { disconnected: 'var(--bs-danger)', connecting: 'var(--bs-warning)', connected: 'var(--bs-success)' };
  $statusIndicator.style.background = colors[status];
  $connectionStatus.textContent = text;
};
const updateSlideCount = () => {
  $slideCount.textContent = slides.length;
  $currentSlideNum.textContent = currentSlideIndex >= 0 ? currentSlideIndex + 1 : "-";
};
const updateSlidePreview = () => {
  if (currentSlideIndex < 0) {
    $slidePreview.innerHTML = '<p class="text-muted text-center">No slides yet.</p>';
    return;
  }
  const slide = slides[currentSlideIndex];
  $slidePreview.innerHTML = `
    <h4 class="text-primary">${escapeHtml(slide.title)}</h4>
    <hr>
    <div style="font-size: 0.95rem;">${markdownToHtml(slide.content)}</div>
  `;
};
const syncPresentationSlide = () => {
  if (presentationWindow && !presentationWindow.closed) {
    try { presentationWindow.goToSlide(currentSlideIndex); }
    catch (e) { console.error("Sync error:", e); }
  }
};
const updatePresentationWindow = () => {
  if (!presentationWindow || presentationWindow.closed) return;
  const slide = slides[slides.length - 1];
  try { presentationWindow.addSlide(escapeHtml(slide.title), markdownToHtml(slide.content)); }
  catch (e) { console.error("Update error:", e); }
};
const navigateSlide = direction => {
  const newIndex = currentSlideIndex + direction;
  if (newIndex >= 0 && newIndex < slides.length) {
    currentSlideIndex = newIndex;
    updateSlideCount();
    updateSlidePreview();
    syncPresentationSlide();
    $prevSlideBtn.disabled = currentSlideIndex === 0;
    $nextSlideBtn.disabled = currentSlideIndex === slides.length - 1;
  }
};
const handleAIResponse = responseText => {
  if (!responseText?.trim()) return;
  let jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.error("No JSON found in response:", responseText);
    bootstrapAlert({ title: "Invalid Response", body: "AI did not return valid JSON.", color: "warning" });
    return;
  }
  try {
    const slideData = JSON.parse(jsonMatch[0]);
    if (!slideData.title || !slideData.content) throw new Error("Invalid JSON structure");
    slides.push({ title: slideData.title, content: slideData.content, timestamp: new Date().toISOString() });
    currentSlideIndex = slides.length - 1;
    updateSlideCount();
    updateSlidePreview();
    updatePresentationWindow();
    updateControlsState();
    $prevSlideBtn.disabled = slides.length <= 1;
    $nextSlideBtn.disabled = true;
    bootstrapAlert({ title: "Slide Created", body: `"${slideData.title}"`, color: "success", timeout: 2000 });
  } catch (e) {
    console.error("Invalid JSON:", jsonMatch[0], e);
    bootstrapAlert({ title: "Invalid Response", body: "Malformed JSON returned by AI.", color: "warning" });
  }
};
const setupDataChannel = () => {
  window.send = text => {
    if (dataChannel && dataChannel.readyState === "open") {
      const event = {type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text }] } };
      logEvent("OUT", "conversation.item.create", event);
      dataChannel.send(JSON.stringify(event));
      const responseEvent = {type: "response.create", response: { modalities: ["text"] } };
      logEvent("OUT", "response.create", responseEvent);
      dataChannel.send(JSON.stringify(responseEvent));
    } else {
      console.warn("Data channel not open");
    }
  };
  dataChannel.onopen = () => {
    const sessionEvent = {
      type: "session.update",
      session: {
        modalities: ["text"],    // FORCE TEXT ONLY
        instructions: val($systemPrompt),          // disable audio output
        turn_detection: { type: "server_vad", threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 1000 }
      }
    };
    logEvent("OUT", "session.update", sessionEvent);
    dataChannel.send(JSON.stringify(sessionEvent));
  };
  dataChannel.onmessage = event => {
    const msg = JSON.parse(event.data);
    logEvent("IN", msg.type, msg);
    const r = responses;
    /** CREATE / DONE **/
    if (msg.type === "response.created") {
      r[msg.response.id] = { output: [] };
    }
    /** OUTPUT ITEM ADDED **/
    else if (msg.type === "response.output_item.added") {
      if (!r[msg.response_id]) r[msg.response_id] = { output: [] };
      r[msg.response_id].output[msg.output_index] = {
        type: msg.item.type,
        role: msg.item.role,
        content: []  // IMPORTANT FIX
      };
    }
    /** CONTENT PART ADDED **/
    else if (msg.type === "response.content_part.added") {
      const output = r[msg.response_id].output[msg.output_index];
      output.content[msg.content_index] = {
        type: msg.part.type,
        text: ""     // IMPORTANT FIX (initialize)
      };
    }
    /** TEXT STREAMING DELTA **/
    else if (msg.type === "response.text.delta") {
      const output = r[msg.response_id].output[msg.output_index];
      const part = output.content[msg.content_index];
      part.text += msg.delta; // IMPORTANT FIX
    }
    /** TEXT STREAM COMPLETE **/
    else if (msg.type === "response.text.done") {
      const output = r[msg.response_id].output[msg.output_index];
      const part = output.content[msg.content_index];
      const fullText = part.text;
      logEvent("IN", "response.text.full", { response_id: msg.response_id, text: fullText });
      handleAIResponse(fullText);
    }
    else if (msg.type === "error") {
      console.error("API Error:", msg.error);
      bootstrapAlert({ title: "Error", body: msg.error?.message || "Unknown error", color: "danger" });
    }
  };
  dataChannel.onclose = () => isRecording && stopRecording();
  dataChannel.onerror = () => bootstrapAlert({ title: "Error", body: "Data channel error", color: "danger" });
};
async function startRecording() {
  try {
    updateStatus("connecting", "Connecting...");
    responses = {};
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    peerConnection = new RTCPeerConnection();
    mediaStream.getAudioTracks().forEach(track => peerConnection.addTrack(track, mediaStream));
    dataChannel = peerConnection.createDataChannel("oai-events");
    setupDataChannel();
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    const response = await fetch(`https://api.openai.com/v1/realtime?model=${$modelSelect.value}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${$apiKey.value.trim()}`, "Content-Type": "application/sdp" },
      body: offer.sdp
    });
    if (!response.ok) throw new Error(`API Error: ${response.status}`);
    await peerConnection.setRemoteDescription({ type: "answer", sdp: await response.text() });
    isRecording = true;
    $recordBtn.classList.add("btn-danger", "recording");
    $recordBtn.classList.remove("btn-outline-danger");
    $recordBtn.querySelector("span").textContent = "Stop Recording";
    $recordBtn.querySelector("i").className = "bi bi-stop-circle me-2";
    updateStatus("connected", "Connected");
    if (!presentationWindow || presentationWindow.closed) openPresentationWindow();
  } catch (error) {
    bootstrapAlert({ title: "Failed", body: error.message, color: "danger" });
    cleanup();
    updateStatus("disconnected", "Failed");
  }
}
function stopRecording() {
  isRecording = false;
  dataChannel?.close();
  peerConnection?.close();
  mediaStream?.getTracks().forEach(t => t.stop());
  $recordBtn.classList.remove("btn-danger", "recording");
  $recordBtn.classList.add("btn-outline-danger");
  $recordBtn.querySelector("span").textContent = "Start Recording";
  $recordBtn.querySelector("i").className = "bi bi-record-circle me-2";
  updateStatus("disconnected", "Disconnected");
  updateControlsState();
}
function openPresentationWindow() {
  if (presentationWindow && !presentationWindow.closed) return presentationWindow.focus();
  const themeFile = REVEAL_THEMES[val($themeSelect)];
  const html = createPresentationHTML(slides, val($initialTitle), val($initialContent), themeFile);
  presentationWindow = window.open("", "LiveSlidesPresentation",
    `width=800,height=600,left=${(screen.width - 800) / 2},top=${(screen.height - 600) / 2},scrollbars=no,resizable=yes`
  );
  if (!presentationWindow) return bootstrapAlert({ title: "Popup Blocked", body: "Allow popups for this site.", color: "warning" });
  presentationWindow.document.write(html);
  presentationWindow.document.close();
  presentationWindow.onload = syncPresentationSlide;
}
const downloadSlides = () => {
  downloadPresentationHTML(slides, val($initialTitle), val($initialContent), REVEAL_THEMES[val($themeSelect)]);
  bootstrapAlert({ title: "Downloaded", body: "Presentation downloaded successfully!", color: "success" });
};
const cleanup = stopRecording;
// Modal Controls
$("config-btn").onclick = () => { $configModal.classList.add("show"); $configOverlay.classList.add("show"); };
$("close-config-btn").onclick = $configOverlay.onclick = () => { $configModal.classList.remove("show"); $configOverlay.classList.remove("show"); };
$("save-config-btn").onclick = () => {
  saveConfig();
  bootstrapAlert({ title: "Saved", body: "Configuration saved successfully.", color: "success" });
  $configModal.classList.remove("show");
  $configOverlay.classList.remove("show");
  updateControlsState();
};
// Event Listeners
$apiKey.oninput = () => { saveConfig(); updateControlsState(); };
$modelSelect.onchange = $themeSelect.onchangeninput = $initialTitle.oninput = $initialContent.oninput = saveConfig;
$recordBtn.onclick = () => isRecording ? stopRecording() : startRecording();
$prevSlideBtn.onclick = () => navigateSlide(-1);
$nextSlideBtn.onclick = () => navigateSlide(1);
$openPresentationBtn.onclick = openPresentationWindow;
$downloadHtmlBtn.onclick = downloadSlides;
window.onbeforeunload = () => { cleanup(); presentationWindow?.close(); };
// Initialize
loadConfig();
updateControlsState();