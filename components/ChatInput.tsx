import React, { useState, useEffect, useRef, useCallback } from 'react';
import { SendIcon, MicrophoneIcon } from './Icons';
import { GoogleGenAI, LiveSession, LiveServerMessage, Blob, Modality } from '@google/genai';

// --- START: Fix for Web Speech API types not being in default TypeScript lib ---
// By defining these interfaces, we can use the Web Speech API without compilation errors.
interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  onresult: ((ev: SpeechRecognitionEvent) => any) | null;
  onerror: ((ev: SpeechRecognitionErrorEvent) => any) | null;
  onend: (() => any) | null;
  start(): void;
  stop(): void;
}

interface SpeechRecognitionEvent extends Event {
  readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  readonly length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  readonly transcript: string;
}

interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
}

declare var SpeechRecognition: {
  prototype: SpeechRecognition;
  new(): SpeechRecognition;
};

declare var webkitSpeechRecognition: {
  prototype: SpeechRecognition;
  new(): SpeechRecognition;
};
// --- END: Fix for Web Speech API types ---

// --- START: Audio utility functions from Gemini documentation ---
function encode(bytes: Uint8Array) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function createBlob(data: Float32Array): Blob {
  const l = data.length;
  const int16 = new Int16Array(l);
  for (let i = 0; i < l; i++) {
    int16[i] = data[i] * 32768;
  }
  return {
    data: encode(new Uint8Array(int16.buffer)),
    mimeType: 'audio/pcm;rate=16000',
  };
}
// --- END: Audio utility functions ---

interface ChatInputProps {
  onSend: (message: string) => void;
  isLoading: boolean;
  onError: (message: string) => void;
}

const ChatInput: React.FC<ChatInputProps> = ({ onSend, isLoading, onError }) => {
  const [inputValue, setInputValue] = useState('');
  const [listeningState, setListeningState] = useState<'idle' | 'connecting' | 'listening' | 'error'>('idle');
  const [micPermission, setMicPermission] = useState<'prompt' | 'granted' | 'denied'>('prompt');
  const [shouldStartListening, setShouldStartListening] = useState(false);

  // Refs for audio processing and API session
  const sessionPromiseRef = useRef<Promise<LiveSession> | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const currentTranscriptionRef = useRef('');
  const speechRecognitionRef = useRef<SpeechRecognition | null>(null);
  
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Use a ref for onSend to avoid stale closures in callbacks
  const onSendRef = useRef(onSend);
  useEffect(() => { onSendRef.current = onSend; }, [onSend]);
  const onErrorRef = useRef(onError);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);

  const stopWakeWordListener = useCallback(() => {
    if (speechRecognitionRef.current) {
      const recognition = speechRecognitionRef.current;
      speechRecognitionRef.current = null; // Important: set to null before stopping to prevent onend restart
      recognition.onresult = null;
      recognition.onend = null;
      recognition.onerror = null;
      try {
        recognition.stop();
      } catch (e) {
        console.warn("Speech recognition may have already been stopped.", e);
      }
    }
  }, []);

  const stopListening = useCallback(async () => {
    setListeningState('idle');
    currentTranscriptionRef.current = '';

    if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(track => track.stop());
        mediaStreamRef.current = null;
    }
    if (scriptProcessorRef.current) {
        scriptProcessorRef.current.disconnect();
        scriptProcessorRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        try {
            await audioContextRef.current.close();
        } catch(e) {
            console.warn("AudioContext already closed.", e);
        }
        audioContextRef.current = null;
    }
    if (sessionPromiseRef.current) {
        try {
            const session = await sessionPromiseRef.current;
            session.close();
        } catch (e) {
            console.error("Error closing session:", e);
        }
        sessionPromiseRef.current = null;
    }
    // After stopping, start wake word listener if permission is granted
    // We wrap this in a timeout to ensure the state has updated before restarting
    setTimeout(() => {
        if (micPermission === 'granted') {
            startWakeWordListener();
        }
    }, 100);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [micPermission]);


  const startListening = useCallback(async () => {
    if (listeningState !== 'idle' && listeningState !== 'error') return;

    if (!process.env.API_KEY || process.env.API_KEY === 'undefined') {
        const errorMsg = "The API key is missing or invalid. Please ensure it's correctly configured in your environment to use voice features.";
        console.error("MNA AI Error:", errorMsg);
        onErrorRef.current(errorMsg);
        setListeningState('error');
        return;
    }
    
    stopWakeWordListener();

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaStreamRef.current = stream;
        setMicPermission('granted');
        setListeningState('connecting');

        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
        
        currentTranscriptionRef.current = '';

        sessionPromiseRef.current = ai.live.connect({
            model: 'gemini-2.5-flash-native-audio-preview-09-2025',
            callbacks: {
                onopen: () => {
                    setListeningState('listening');
                    if (!audioContextRef.current || !mediaStreamRef.current) return;

                    const source = audioContextRef.current.createMediaStreamSource(mediaStreamRef.current);
                    scriptProcessorRef.current = audioContextRef.current.createScriptProcessor(4096, 1, 1);
                    
                    scriptProcessorRef.current.onaudioprocess = (audioProcessingEvent) => {
                        const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
                        const pcmBlob = createBlob(inputData);
                        
                        sessionPromiseRef.current?.then((session) => {
                            session.sendRealtimeInput({ media: pcmBlob });
                        });
                    };
                    
                    source.connect(scriptProcessorRef.current);
                    scriptProcessorRef.current.connect(audioContextRef.current.destination);
                },
                onmessage: (message: LiveServerMessage) => {
                    if (message.serverContent?.inputTranscription) {
                        // The API sends transcription chunks. We accumulate them in a ref
                        // and update the input state to show the live transcript.
                        const { text } = message.serverContent.inputTranscription;
                        currentTranscriptionRef.current += text;
                        setInputValue(currentTranscriptionRef.current);
                    }

                    if (message.serverContent?.turnComplete) {
                        // When the user pauses, `turnComplete` is sent. We check the full
                        // accumulated transcript for commands. We do NOT reset the transcript
                        // here unless a command requires it, allowing for multi-utterance notes.
                        const fullTranscript = currentTranscriptionRef.current.trim();
                        
                        const sendRegex = /\b(send|done)\.?$/i;
                        const stopRecordingRegex = /\b(stop listening|stop recording)\.?$/i;
                        const clearInputRegex = /\b(clear input|remove)\.?$/i;

                        if (sendRegex.test(fullTranscript)) {
                            const taskText = fullTranscript.replace(sendRegex, '').trim();
                            if (taskText) onSendRef.current(taskText);
                            setInputValue('');
                            stopListening(); // stopListening handles resetting the ref
                        } else if (stopRecordingRegex.test(fullTranscript)) {
                            const taskText = fullTranscript.replace(stopRecordingRegex, '').trim();
                            setInputValue(taskText);
                            stopListening(); // stopListening handles resetting the ref
                        } else if (clearInputRegex.test(fullTranscript)) {
                            setInputValue('');
                            currentTranscriptionRef.current = ''; // Explicitly clear the ref
                        }
                        // If no command is found, we do nothing and let the transcription accumulate.
                    }
                },
                onerror: (e: ErrorEvent) => {
                    console.error("Live session error:", e);
                    const errorMsg = "A connection error occurred with the voice service. This could be due to a network issue, a misconfigured API key, or a temporary service problem. Please check your connection and configuration, then try again.";
                    onErrorRef.current(errorMsg);
                    setListeningState('error');
                    stopListening();
                },
                onclose: () => {
                    if (listeningState === 'listening' || listeningState === 'connecting') {
                       stopListening();
                    }
                },
            },
            config: {
                inputAudioTranscription: {},
                responseModalities: [Modality.AUDIO],
            },
        });

    } catch (err) {
        console.error("Failed to start listening:", err);
        setListeningState('error');
        if (err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')) {
            setMicPermission('denied');
        }
        await stopListening();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listeningState, stopWakeWordListener, stopListening]);

  const startWakeWordListener = useCallback(() => {
    if (listeningState !== 'idle' || micPermission !== 'granted' || speechRecognitionRef.current) {
      return;
    }
    const SpeechRecognitionAPI = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    if (!SpeechRecognitionAPI) {
        console.warn("Speech Recognition API not supported in this browser.");
        return;
    }

    console.log("Starting wake word listener...");
    const recognition = new SpeechRecognitionAPI();
    recognition.continuous = true;
    recognition.interimResults = false;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const last = event.results.length - 1;
      const transcript = event.results[last][0].transcript.trim().toLowerCase();
      const wakeWordRegex = /\b(hey|start)\b/i;
      
      if (wakeWordRegex.test(transcript)) {
        console.log(`Wake word detected: "${transcript}"`);
        setShouldStartListening(true);
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.error('Wake word recognition error:', event.error);
      if (event.error === 'not-allowed') {
        setMicPermission('denied');
      }
      stopWakeWordListener();
    };

    recognition.onend = () => {
      // Only restart if it wasn't intentionally stopped
      if (speechRecognitionRef.current === recognition) {
        console.log("Wake word listener ended, restarting.");
        try {
          recognition.start();
        } catch (e) {
          console.error("Could not restart wake word listener", e);
          stopWakeWordListener();
        }
      }
    };

    speechRecognitionRef.current = recognition;
    try {
      recognition.start();
    } catch (e) {
      console.error("Could not start wake word listener", e);
      speechRecognitionRef.current = null;
    }
  }, [listeningState, micPermission, stopWakeWordListener]);

  // Effect to check for initial microphone permissions
  useEffect(() => {
    if ('permissions' in navigator) {
        navigator.permissions.query({ name: 'microphone' as PermissionName }).then((permissionStatus) => {
            setMicPermission(permissionStatus.state);
            permissionStatus.onchange = () => setMicPermission(permissionStatus.state);
        });
    }
  }, []);

  // Effect to manage the wake word listener based on state
  useEffect(() => {
    if (micPermission === 'granted' && listeningState === 'idle') {
      startWakeWordListener();
    } else {
      stopWakeWordListener();
    }
    // Cleanup function to stop listener when dependencies change
    return () => {
        stopWakeWordListener();
    }
  }, [micPermission, listeningState, startWakeWordListener, stopWakeWordListener]);

  useEffect(() => {
    if (shouldStartListening) {
      startListening();
      setShouldStartListening(false);
    }
  }, [shouldStartListening, startListening]);
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
        stopListening();
        stopWakeWordListener();
    };
  }, [stopListening, stopWakeWordListener]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [inputValue]);

  const handleSend = () => {
    if (inputValue.trim() && !isLoading) {
      onSend(inputValue.trim());
      setInputValue('');
      if (listeningState !== 'idle') {
        stopListening();
      }
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  const handleMicClick = () => {
    if (listeningState === 'listening' || listeningState === 'connecting') {
      stopListening();
    } else {
      startListening();
    }
  };

  const getPlaceholderText = () => {
    if (micPermission === 'denied') {
      return "Microphone access denied.";
    }
    if (listeningState === 'connecting') {
        return "Connecting to MNA's ears...";
    }
    if (listeningState === 'listening') {
      return "Listening... Say 'send' when you're done.";
    }
    if (listeningState === 'error') {
        return "Connection error. Click mic to retry.";
    }
    if (micPermission === 'granted') {
        return "Say 'Hey' or 'Start' to activate, or click the mic...";
    }
    return "Click the mic to start speaking...";
  };
  
  const isMicActive = listeningState === 'listening' || listeningState === 'connecting';

  return (
    <div className="bg-slate-800/80 backdrop-blur-sm p-4 border-t border-slate-700">
      <div className="max-w-4xl mx-auto">
        <div className="relative">
          <textarea
            ref={textareaRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={getPlaceholderText()}
            className="w-full bg-slate-700 text-white placeholder-slate-400 rounded-lg p-4 pr-28 resize-none focus:ring-2 focus:ring-indigo-500 focus:outline-none transition-shadow"
            rows={1}
            disabled={isLoading || micPermission === 'denied'}
            style={{ minHeight: '56px' }}
          />
          <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
            <button
              onClick={handleMicClick}
              disabled={isLoading || micPermission === 'denied'}
              className={`p-2 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:opacity-50 disabled:cursor-not-allowed ${
                listeningState === 'listening'
                  ? 'text-red-500 animate-pulse bg-red-500/20'
                  : isMicActive
                  ? 'text-indigo-400 bg-indigo-500/10'
                  : 'text-slate-300 hover:text-white hover:bg-slate-700'
              }`}
              aria-label={isMicActive ? "Stop listening" : "Start listening"}
            >
              <MicrophoneIcon className="w-6 h-6" />
            </button>
            <button
              onClick={handleSend}
              disabled={isLoading || !inputValue.trim()}
              className="p-2 rounded-full transition-colors bg-indigo-600 text-white hover:bg-indigo-500 disabled:bg-slate-600 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-indigo-400"
              aria-label="Send message"
            >
              {isLoading ? (
                <div className="w-6 h-6 border-2 border-slate-400 border-t-white rounded-full animate-spin"></div>
              ) : (
                <SendIcon className="w-6 h-6" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChatInput;