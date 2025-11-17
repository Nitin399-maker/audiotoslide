let ws = null;
let audioStream = null;
let audioContext = null;
let audioWorkletNode = null;
let isRecording = false;
let isConnected = false;
let slides = [];
let currentSlideIndex = 0;
let reconnectAttempts = 0;
const maxReconnectAttempts = 5;
let audioBuffer = [];
let bufferSize = 0;
const minBufferDuration = 100; // 100ms minimum
const maxBufferDuration = 5000; // 5 seconds max
let lastCommitTime = 0;
let autoCommitTimer = null;
let isProcessingResponse = false;
let pendingSlideGeneration = false;
const audioSettings = {
    sampleRate: 24000, // Required by OpenAI
    channelCount: 1,   // Mono
    bitDepth: 16       // PCM16
};
let elements = {};

async function initApp() {
    initializeElements();
    setupEventListeners();
    await requestMicrophonePermission();
    await setupAudioWorklet();
    connectWebSocket();
    if (typeof marked !== 'undefined') {
        marked.setOptions({breaks: true, gfm: true, sanitize: false });
    }
}

function initializeElements() {
    elements = {
        connectionStatus: document.getElementById('connectionStatus'),
        connectionText: document.getElementById('connectionText'),
        recordBtn: document.getElementById('recordBtn'),
        recordingStatus: document.getElementById('recordingStatus'),
        generateSlideBtn: document.getElementById('generateSlideBtn'),
        clearBtn: document.getElementById('clearBtn'),
        slideContent: document.getElementById('slideContent'),
        slideIndicator: document.getElementById('slideIndicator'),
        slideCounter: document.getElementById('slideCounter'),
        lastUpdated: document.getElementById('lastUpdated'),
        prevSlide: document.getElementById('prevSlide'),
        nextSlide: document.getElementById('nextSlide'),
        partialTranscript: document.getElementById('partialTranscript'),
        fullTranscript: document.getElementById('fullTranscript'),
        transcriptLoading: document.getElementById('transcriptLoading'),
        audioStatus: document.getElementById('audioStatus'),
        apiStatus: document.getElementById('apiStatus'),
        slideStatus: document.getElementById('slideStatus')
    };
}

function setupEventListeners() {
    elements.recordBtn.addEventListener('click', toggleRecording);
    elements.generateSlideBtn.addEventListener('click', generateSlide);
    elements.prevSlide.addEventListener('click', () => navigateSlide(-1));
    elements.nextSlide.addEventListener('click', () => navigateSlide(1));
    document.addEventListener('keydown', handleKeydown);
    window.addEventListener('beforeunload', cleanup);
}

function handleKeydown(e) {
    if (e.code === 'Space' && e.target === document.body) {
        e.preventDefault();
        toggleRecording();
    } else if (e.code === 'ArrowLeft') {
        navigateSlide(-1);
    } else if (e.code === 'ArrowRight') {
        navigateSlide(1);
    }
}

async function requestMicrophonePermission() {
        audioStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                sampleRate: audioSettings.sampleRate, channelCount: audioSettings.channelCount,
                echoCancellation: true, noiseSuppression: true,
                autoGainControl: true
            }
        });
        window.UIUtils.updateStatus('audio', 'connected', 'Audio: Connected', elements);
}

async function setupAudioWorklet() {
    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)({
            sampleRate: audioSettings.sampleRate
        });
        if (audioContext.audioWorklet) {
            const processorCode = `
            class AudioProcessor extends AudioWorkletProcessor {
                process(inputs, outputs, parameters) {
                    const input = inputs[0];
                    if (input && input[0]) {
                        this.port.postMessage({
                            type: 'audio',
                            data: input[0]
                        });
                    }
                    return true;
                }
            }
            registerProcessor('audio-processor', AudioProcessor);
            `;
            const blob = new Blob([processorCode], { type: 'application/javascript' });
            const workletUrl = URL.createObjectURL(blob);
            await audioContext.audioWorklet.addModule(workletUrl);
            console.log('AudioWorklet initialized successfully');
        } else {
            console.warn('AudioWorklet not supported, falling back to ScriptProcessor');
        }
    } catch (error) { console.error('Failed to setup AudioWorklet:', error);  }
}

function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    try {
        ws = new WebSocket(wsUrl.replace('http', 'ws'));
        ws.onopen = handleWebSocketOpen;
        ws.onmessage = handleWebSocketMessage;
        ws.onclose = handleWebSocketClose;
        ws.onerror = handleWebSocketError;
    } catch (error) {
        console.error('Failed to connect WebSocket:', error);
        window.UIUtils.updateStatus('api', 'error', 'API: Connection failed', elements);
    }
}

function handleWebSocketOpen() {
    isConnected = true;
    reconnectAttempts = 0;
    updateConnectionStatus(true);
    window.UIUtils.updateStatus('api', 'connected', 'API: Connected', elements);
}

function handleWebSocketMessage(event) {
        const data = JSON.parse(event.data);
        handleServerMessage(data);
}

function handleWebSocketClose() {
    console.log('WebSocket disconnected');
    isConnected = false;
    updateConnectionStatus(false);
    window.UIUtils.updateStatus('api', 'disconnected', 'API: Disconnected', elements);
    if (isRecording) {  stopRecording();  }
}

function handleWebSocketError(error) {
    console.error('WebSocket error:', error);
    window.UIUtils.updateStatus('api', 'error', 'API: Connection error', elements);
}

function handleServerMessage(data) {
    console.log('Received message:', data.type, data);
    switch (data.type) {
        case 'ready':
            console.log('System ready');
            elements.recordBtn.disabled = false;
            elements.generateSlideBtn.disabled = false;
            elements.recordingStatus.textContent = 'Ready to record';
            break;
            
        case 'transcription':
            console.log('Handling transcription:', data);
            handleTranscription(data);
            break;
            
        case 'partial_transcription':
            console.log('Handling partial transcription:', data);
            handlePartialTranscription(data);
            break;
            
        case 'speech_started':
            console.log('Speech started');
            showSpeechIndicator(true);
            break;
            
        case 'speech_stopped':
            console.log('Speech stopped');
            showSpeechIndicator(false);
            break;
            
        case 'slide':
            handleNewSlide(data);
            break;
            
        case 'slide_generation_progress':
            window.UIUtils.showNotification('Generating slide...', 'info');
            break;
            
        case 'response_started':
            isProcessingResponse = true;
            break;
            
        case 'response_completed':
            isProcessingResponse = false;
            if (pendingSlideGeneration) {
                pendingSlideGeneration = false;
                setTimeout(generateSlide, 500);
            }
            break;
            
        case 'error':
            console.error('Server error:', data.message);
            if (data.message.includes('active response in progress')) {
                isProcessingResponse = true;
                pendingSlideGeneration = true;
            } else { window.UIUtils.showError(data.message);  }
            break;
        default:
            console.log('Unknown message type:', data.type);
    }
}

function handleTranscription(data) {
    console.log('Processing transcription:', data.text);
    elements.partialTranscript.textContent = '';
    elements.transcriptLoading.classList.add('d-none');
    if (data.text && data.text.trim()) {
        const transcriptElement = document.createElement('div');
        transcriptElement.className = 'mb-2 p-2 bg-light border-start border-primary border-3';
        transcriptElement.innerHTML = `
            <div class="d-flex justify-content-between align-items-start">
                <span class="text-primary fw-bold small">[${new Date().toLocaleTimeString()}]</span>
                <span class="badge bg-success">Final</span>
            </div>
            <div class="mt-1">${window.TextUtils.escapeHtml(data.text)}</div>
        `;
        elements.fullTranscript.appendChild(transcriptElement);
        elements.fullTranscript.scrollTop = elements.fullTranscript.scrollHeight;
        console.log('Added transcription to UI');
    }
}

function handlePartialTranscription(data) {
    console.log('Processing partial transcription:', data.text);
    if (data.text && data.text.trim()) {
        elements.partialTranscript.innerHTML = `
            <div class="text-muted fst-italic p-2 bg-warning bg-opacity-10 rounded">
                <span class="badge bg-warning text-dark me-2">Live</span>
                ${window.TextUtils.escapeHtml(data.text)}
            </div>
        `;
        elements.transcriptLoading.classList.remove('d-none');
        console.log('Updated partial transcription in UI');
    }
}

function showSpeechIndicator(isActive) {
    if (isActive) {
        elements.transcriptLoading.classList.remove('d-none');
        elements.transcriptLoading.innerHTML = `
            <div class="text-center mt-3">
                <div class="spinner-border spinner-border-sm text-success" role="status"></div>
                <span class="ms-2 text-success">Listening...</span>
            </div>
        `;
    } else {
        elements.transcriptLoading.classList.add('d-none');
    }
}

function handleNewSlide(data) {
    const slide = data.slide;
    slides.push(slide);
    elements.slideCounter.textContent = `${slides.length} slide${slides.length !== 1 ? 's' : ''}`;
    elements.lastUpdated.textContent = `Last updated: ${new Date().toLocaleTimeString()}`;
    currentSlideIndex = slides.length - 1;
    displayCurrentSlide();
    updateSlideNavigation();
    window.UIUtils.showNotification('New slide generated!');
    console.log(`New slide #${slide.id} generated`);
}

function toggleRecording() {
    if (isRecording) { stopRecording(); } 
    else {  startRecording(); }
}

async function startRecording() {
    try {
        if (audioContext.state === 'suspended') { await audioContext.resume(); }
        audioBuffer = [];
        bufferSize = 0;
        lastCommitTime = Date.now();
        const source = audioContext.createMediaStreamSource(audioStream);
        audioWorkletNode = new AudioWorkletNode(audioContext, 'audio-processor');
        audioWorkletNode.port.onmessage = (event) => {
            if (event.data.type === 'audio' && isRecording) {
                processAudioData(event.data.data);
            }
        };
        source.connect(audioWorkletNode);
        console.log('Using AudioWorklet for audio processing');
        window.audioSource = source;
        isRecording = true;
        startAutoCommitTimer();
        updateRecordingUI(true);
        console.log('Recording started');
        elements.partialTranscript.textContent = '';
        elements.transcriptLoading.classList.add('d-none');
    } catch (error) {
        console.error('Failed to start recording:', error);
        window.UIUtils.showError('Failed to start recording: ' + error.message);
    }
}

function processAudioData(float32Array) {
    audioBuffer.push(new Float32Array(float32Array));
    bufferSize += float32Array.length;
    const bufferDuration = (bufferSize / audioSettings.sampleRate) * 1000;
    const now = Date.now();
    if (bufferDuration >= minBufferDuration && 
        (bufferDuration >= maxBufferDuration || now - lastCommitTime >= maxBufferDuration)) {
        commitAudioBuffer();
    }
}

function startAutoCommitTimer() {
    autoCommitTimer = setInterval(() => {
        if (isRecording && bufferSize > 0) {
            const bufferDuration = (bufferSize / audioSettings.sampleRate) * 1000;
            if (bufferDuration >= minBufferDuration) {  commitAudioBuffer();  }
        }
    }, 2000);
}

function commitAudioBuffer() {
    if (audioBuffer.length === 0) return;
    try {
        const totalLength = audioBuffer.reduce((sum, chunk) => sum + chunk.length, 0);
        const combinedBuffer = new Float32Array(totalLength);
        let offset = 0;
        for (const chunk of audioBuffer) {
            combinedBuffer.set(chunk, offset);
            offset += chunk.length;
        }
        sendAudioData(combinedBuffer);
        audioBuffer = [];
        bufferSize = 0;
        lastCommitTime = Date.now();
        console.log(`Committed ${totalLength} audio samples (${(totalLength / audioSettings.sampleRate * 1000).toFixed(1)}ms)`);
    } catch (error) {
        console.error('Error committing audio buffer:', error);
    }
}

function stopRecording() {
    if (isRecording) {
        isRecording = false;
        if (autoCommitTimer) {
            clearInterval(autoCommitTimer);
            autoCommitTimer = null;
        }
        if (bufferSize > 0) { commitAudioBuffer(); }
        if (window.audioSource) { window.audioSource.disconnect(); }
        if (window.audioProcessor) { window.audioProcessor.disconnect(); }
        if (audioWorkletNode) { audioWorkletNode.disconnect();  }
        setTimeout(() => {
            if (ws && isConnected) {
                ws.send(JSON.stringify({ type: 'audio_end' }));
            }
        }, 100);
        updateRecordingUI(false);
        console.log('Recording stopped');
    }
}

function sendAudioData(float32Array) {
    if (!ws || !isConnected || float32Array.length === 0) return;
    try {
        const pcm16Array = window.AudioUtils.float32ToPCM16(float32Array);
        const base64Audio = window.AudioUtils.pcm16ToBase64(pcm16Array);
        ws.send(JSON.stringify({ type: 'audio', audio: base64Audio }));
    } catch (error) {
        console.error('Error sending audio data:', error);
    }
}

function generateSlide() {
    if (!ws || !isConnected) {
        window.UIUtils.showError('Not connected to server');
        return;
    }
    if (isProcessingResponse) {
        pendingSlideGeneration = true;
        window.UIUtils.showNotification('Processing previous request, will generate slide when ready...');
        return;
    }
    ws.send(JSON.stringify({ type: 'generate_slide' }));
    window.UIUtils.showNotification('Generating slide...');
}

function navigateSlide(direction) {
    const newIndex = currentSlideIndex + direction;
    if (newIndex >= 0 && newIndex < slides.length) {
        currentSlideIndex = newIndex;
        displayCurrentSlide();
        updateSlideNavigation();
    }
}

function displayCurrentSlide() {
    if (slides.length === 0) {
        elements.slideContent.innerHTML = `
            <div class="text-center text-muted">
                <i class="fas fa-presentation fa-3x mb-3"></i>
                <h3>Start Speaking</h3>
                <p>Your slides will appear here as you speak</p>
            </div>
        `;
        elements.slideIndicator.textContent = 'Slide 0 of 0';
        return;
    }
    const slide = slides[currentSlideIndex];
    if (slide && slide.content) {
        const htmlContent = marked ? marked.parse(slide.content) : window.TextUtils.simpleMarkdownParse(slide.content);
        elements.slideContent.innerHTML = htmlContent;
    }
    elements.slideIndicator.textContent = `Slide ${currentSlideIndex + 1} of ${slides.length}`;
}

function updateSlideNavigation() {
    elements.prevSlide.disabled = currentSlideIndex <= 0;
    elements.nextSlide.disabled = currentSlideIndex >= slides.length - 1;
}

function updateRecordingUI(recording) {
    if (recording) {
        elements.recordBtn.classList.add('recording');
        elements.recordBtn.innerHTML = '<i class="fas fa-stop"></i>';
        elements.recordingStatus.textContent = 'Recording... (Click to stop)';
        elements.connectionStatus.className = 'badge bg-danger status-recording me-2';
        elements.connectionStatus.textContent = '●';
    } else {
        elements.recordBtn.classList.remove('recording');
        elements.recordBtn.innerHTML = '<i class="fas fa-microphone"></i>';
        elements.recordingStatus.textContent = 'Click to start recording';
        elements.connectionStatus.className = `badge ${isConnected ? 'bg-success' : 'bg-secondary'} me-2`;
        elements.connectionStatus.textContent = '●';
    }
}

function updateConnectionStatus(connected) {
    if (connected) {
        elements.connectionStatus.className = 'badge bg-success me-2';
        elements.connectionText.textContent = 'Connected';
    } else {
        elements.connectionStatus.className = 'badge bg-secondary me-2';
        elements.connectionText.textContent = 'Disconnected';
    }
}

function cleanup() {
    if (isRecording) { stopRecording(); }
    if (autoCommitTimer) { clearInterval(autoCommitTimer); }
     if (audioStream) { audioStream.getTracks().forEach(track => track.stop()); }
    if (audioContext) {  audioContext.close(); }
    if (ws) { ws.close(); }
}

document.addEventListener('DOMContentLoaded', initApp);