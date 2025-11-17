import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import dotenv from 'dotenv';
import open from 'open';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

app.use(cors());
app.use(express.static(path.join(__dirname, 'frontend')));
app.use(express.json());

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

const connections = new Map();
let slideCounter = 0;

wss.on('connection', (ws) => {
  const connectionId = Date.now().toString();
  console.log(`Client connected: ${connectionId}`);
  const connectionData = {
    ws,
    openaiWs: null,
    isConnected: true,
    transcriptBuffer: '',
    slideHistory: [],
    isProcessingResponse: false,
    lastSlideTime: Date.now()
  };
  
  connections.set(connectionId, connectionData);
  initializeOpenAIConnection(connectionId);

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      await handleClientMessage(connectionId, data);
    } catch (error) {
      console.error('Error handling client message:', error);
      sendErrorToClient(ws, 'Failed to process message');
    }
  });

  ws.on('close', () => {
    console.log(`Client disconnected: ${connectionId}`);
    cleanup(connectionId);
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    cleanup(connectionId);
  });
});

async function initializeOpenAIConnection(connectionId) {
  const connection = connections.get(connectionId);
  if (!connection) return;
  try {
    const WebSocket = (await import('ws')).default;
    const openaiWs = new WebSocket('wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01', {
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'OpenAI-Beta': 'realtime=v1'
      }
    });
    connection.openaiWs = openaiWs;
    openaiWs.on('open', () => {
      console.log(`OpenAI connection established for ${connectionId}`);
      configureOpenAISession(openaiWs);
      sendMessageToClient(connection.ws, 'ready', 'System ready for speech input');
    });

    openaiWs.on('message', (data) => {
      try {
        const response = JSON.parse(data.toString());
        handleOpenAIMessage(connectionId, response);
      } catch (error) {
        console.error('Error parsing OpenAI message:', error);
      }
    });

    openaiWs.on('close', () => {
      console.log(`OpenAI connection closed for ${connectionId}`);
      setTimeout(() => {
        if (connections.has(connectionId)) {
          initializeOpenAIConnection(connectionId);
        }
      }, 1000);
    });
    openaiWs.on('error', (error) => {
      console.error('OpenAI WebSocket error:', error);
    });
  } catch (error) {
    console.error('Failed to initialize OpenAI connection:', error);
  }
}

function configureOpenAISession(openaiWs) {
  const sessionConfig = {
    type: 'session.update',
    session: {
      modalities: ['text', 'audio'],
      instructions: `You are a real-time slide generator. Convert spoken content into presentation slides in Markdown format.

Rules:
1. Generate slides ONLY with substantial content (2-3+ sentences)
2. Each slide format:
   - Clear title (# for h1)
   - 2-5 bullet points (* for bullets)
   - Concise, scannable content
3. Detect topic changes for new slides
4. Use standard Markdown syntax
5. Return ONLY markdown, no explanations

Example:
# New Product Features
* Enhanced user interface
* Real-time collaboration
* Advanced analytics
* Mobile optimization`,
      voice: 'alloy',
      input_audio_format: 'pcm16',
      output_audio_format: 'pcm16',
      input_audio_transcription: { 
        model: 'whisper-1'
      },
      turn_detection: {
        type: 'server_vad',
        threshold: 0.5,
        prefix_padding_ms: 300,
        silence_duration_ms: 500
      },
      tools: [],
      tool_choice: 'none',
      temperature: 0.7
    }
  };
  
  openaiWs.send(JSON.stringify(sessionConfig));
}

function handleOpenAIMessage(connectionId, message) {
  const connection = connections.get(connectionId);
  if (!connection) return;
  console.log(`OpenAI message type: ${message.type}`);
  if (message.type.includes('transcription')) {
    console.log(`Transcription data:`, message);
  }

  switch (message.type) {
    case 'conversation.item.input_audio_transcription.completed':
      handleTranscription(connectionId, message);
      break;
      
    case 'conversation.item.input_audio_transcription.delta':
      handlePartialTranscription(connectionId, message);
      break;
      
    case 'input_audio_buffer.speech_started':
      console.log('Speech started detected');
      sendMessageToClient(connection.ws, 'speech_started');
      break;
      
    case 'input_audio_buffer.speech_stopped':
      console.log('Speech stopped detected');
      sendMessageToClient(connection.ws, 'speech_stopped');
      break;
      
    case 'response.created':
      connection.isProcessingResponse = true;
      sendMessageToClient(connection.ws, 'response_started');
      break;
      
    case 'response.done':
      connection.isProcessingResponse = false;
      sendMessageToClient(connection.ws, 'response_completed');
      break;
      
    case 'response.text.done':
      handleSlideGeneration(connectionId, message);
      break;
      
    case 'response.text.delta':
      if (message.delta) {
        connection.ws.send(JSON.stringify({
          type: 'slide_generation_progress',
          text: message.delta
        }));
      }
      break;
      
    case 'error':
      console.error('OpenAI error:', message.error);
      sendErrorToClient(connection.ws, message.error?.message || 'OpenAI API error');
      break;
      
    default:
      console.log(`Unhandled OpenAI message type: ${message.type}`);
  }
}

async function handleClientMessage(connectionId, data) {
  const connection = connections.get(connectionId);
  if (!connection?.openaiWs) return;
  switch (data.type) {
    case 'audio':
      forwardAudioToOpenAI(connection.openaiWs, data.audio);
      break;
      
    case 'audio_end':
      commitAudioBuffer(connection.openaiWs);
      break;
      
    case 'generate_slide':
      if (connection.isProcessingResponse) {
        sendErrorToClient(connection.ws, 'Already processing a response. Please wait.');
        return;
      }
      
      if (connection.transcriptBuffer.trim()) {
        generateSlideFromTranscript(connectionId, connection.transcriptBuffer);
      } else {
        sendErrorToClient(connection.ws, 'No transcript available to generate slide.');
      }
      break;
  }
}

function forwardAudioToOpenAI(openaiWs, audio) {
  openaiWs.send(JSON.stringify({
    type: 'input_audio_buffer.append',
    audio: audio
  }));
}

function commitAudioBuffer(openaiWs) {
  openaiWs.send(JSON.stringify({
    type: 'input_audio_buffer.commit'
  }));
}

function sendMessageToClient(ws, type, data = null) {
  const payload = { type };
  if (data) {
    if (typeof data === 'string') {
      payload.message = data;
    } else {
      Object.assign(payload, data);
    }
  }
  ws.send(JSON.stringify(payload));
}

function sendErrorToClient(ws, message) {
  ws.send(JSON.stringify({ type: 'error', message }));
}

function handleTranscription(connectionId, message) {
  const connection = connections.get(connectionId);
  if (!connection) return;
  const transcript = message.transcript || '';
  console.log(`Received transcription: "${transcript}"`);
  if (transcript.trim()) {
    connection.transcriptBuffer += ' ' + transcript;
    connection.ws.send(JSON.stringify({
      type: 'transcription',
      text: transcript,
      fullTranscript: connection.transcriptBuffer.trim()
    }));
    console.log(`Sent transcription to client: "${transcript}"`);
    const now = Date.now();
    if (now - connection.lastSlideTime >= 10000 && 
        transcript.length > 20 && 
        !connection.isProcessingResponse) {
      console.log('Auto-generating slide from transcript');
      generateSlideFromTranscript(connectionId, connection.transcriptBuffer);
      connection.lastSlideTime = now;
    }
  }
}

function handlePartialTranscription(connectionId, message) {
  const connection = connections.get(connectionId);
  if (!connection) return;
  const partialText = message.delta || '';
  console.log(`Partial transcription: "${partialText}"`);
  if (partialText.trim()) {
    connection.ws.send(JSON.stringify({
      type: 'partial_transcription',
      text: partialText
    }));
  }
}

function generateSlideFromTranscript(connectionId, transcript) {
  const connection = connections.get(connectionId);
  if (!connection?.openaiWs || connection.isProcessingResponse) return;
  console.log(`Generating slide from transcript: "${transcript}"`);
  connection.openaiWs.send(JSON.stringify({
    type: 'conversation.item.create',
    item: {
      type: 'message',
      role: 'user',
      content: [{
        type: 'input_text',
        text: `Generate a presentation slide in English from this transcript: "${transcript}"`
      }]
    }
  }));

  connection.openaiWs.send(JSON.stringify({
    type: 'response.create',
    response: {
      modalities: ['text'],
      instructions: 'Generate a concise slide in English in Markdown format based on the transcript.'
    }
  }));

  connection.transcriptBuffer = '';
}

function handleSlideGeneration(connectionId, message) {
  const connection = connections.get(connectionId);
  if (!connection) return;
  const slideContent = message?.text || '';
  slideCounter++;
  console.log(`Generated slide #${slideCounter}: "${slideContent}"`);
  const slide = {
    id: slideCounter,
    content: slideContent,
    timestamp: new Date().toISOString()
  };
  connection.slideHistory.push(slide);
  connection.ws.send(JSON.stringify({
    type: 'slide',
    slide: slide,
    slideNumber: slideCounter,
    totalSlides: connection.slideHistory.length
  }));
}

function cleanup(connectionId) {
  const connection = connections.get(connectionId);
  if (connection) {
    if (connection.openaiWs) { connection.openaiWs.close();  }
    connections.delete(connectionId);
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, async () => {
  console.log(`Server running on http://localhost:${PORT}`);
  try {
    await open(`http://localhost:${PORT}`);
    console.log('Browser opened automatically');
  } catch (error) {
    console.log('Please open your browser manually and go to http://localhost:3000');
  }
});

process.on('SIGINT', () => {
  console.log('\nShutting down gracefully...');
  connections.forEach((connection, id) => cleanup(id));
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});