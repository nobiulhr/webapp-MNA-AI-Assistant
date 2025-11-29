import React, { useState, useEffect, useRef, useCallback } from 'react';
import { SendIcon, MicrophoneIcon } from './Icons';
import { GoogleGenAI, LiveServerMessage, Blob, Modality } from '@google/genai';

// --- START: Fix for Web Speech API types not being in default TypeScript lib ---
interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((ev: SpeechRecognitionEvent) => any) | null;
  onerror: ((ev: SpeechRecognitionErrorEvent) => any) | null;
  onend: (() => any) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

interface SpeechRecognitionEvent extends Event {
  readonly results: SpeechRecognitionResultList;
  readonly resultIndex: number;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  readonly length: number;
  readonly isFinal: boolean;
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

// --- START: Audio utility functions ---
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
    // Clip the data to be within [-1, 1] to prevent overflow/distortion
    const s = Math.max(-1, Math.min(1, data[i]));
    // Convert to 16-bit PCM
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return {
    data: encode(new Uint8Array(int16.buffer)),
    mimeType: 'audio/pcm;rate=16000',
  };
}
// --- END: Audio utility functions ---

type ListeningState = 'idle' | 'requesting_permission' | 'initializing_audio' | 'connecting' | 'listening' | 'error';

interface ChatInputProps {
  onSend: (message: string) => void;
  isLoading: boolean;
  onError: (message: string) => void;
}

const ChatInput: React.FC<ChatInputProps> = ({ onSend, isLoading, onError }) => {
  const [inputValue, setInputValue] = useState('');
  const [listeningState, setListeningState] = useState<ListeningState>('idle');
  const [micPermission, setMicPermission] = useState<'prompt' | 'granted' | 'denied'>('prompt');
  const [shouldStartListening, setShouldStartListening] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);

  // Refs for audio processing and API session
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const currentTranscriptionRef = useRef('');
  const speechRecognitionRef = useRef<SpeechRecognition | null>(null);
  const connectionTimeoutRef = useRef<any>(null);
  const animationFrameRef = useRef<number | null>(null);
  const wakeWordRetryCountRef = useRef(0);
  
  const listeningStateRef = useRef(listeningState);
  useEffect(() => {
    listeningStateRef.current = listeningState;
  }, [listeningState]);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Use a ref for onSend to avoid stale closures in callbacks
  const onSendRef = useRef(onSend);
  useEffect(() => { onSendRef.current = onSend; }, [onSend]);
  const onErrorRef = useRef(onError);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);

  // Audio visualization loop
  const updateAudioLevel = useCallback(() => {
    if (listeningStateRef.current === 'listening' && analyserRef.current) {
        const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(dataArray);
        
        // Calculate average volume
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i];
        }
        const average = sum / dataArray.length;
        
        // Smooth scaling factor (0 to 1 range roughly)
        // normalized for visual effect
        setAudioLevel(Math.min(100, average * 2));
        
        animationFrameRef.current = requestAnimationFrame(updateAudioLevel);
    } else {
        setAudioLevel(0);
    }
  }, []);

  const stopWakeWordListener = useCallback(() => {
    if (speechRecognitionRef.current) {
      const recognition = speechRecognitionRef.current;
      speechRecognitionRef.current = null; // Important: set to null before stopping to prevent onend restart
      recognition.onresult = null;
      recognition.onend = null;
      recognition.onerror = null;
      try {
        // use abort() instead of stop() for immediate release of the mic
        recognition.abort(); 
      } catch (e) {
        // Ignore errors when stopping
      }
    }
  }, []);

  const stopListening = useCallback(async () => {
    if (connectionTimeoutRef.current) {
        clearTimeout(connectionTimeoutRef.current);
        connectionTimeoutRef.current = null;
    }
    if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
    }

    setListeningState('idle');
    setAudioLevel(0);
    currentTranscriptionRef.current = '';

    if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(track => track.stop());
        mediaStreamRef.current = null;
    }
    if (scriptProcessorRef.current) {
        scriptProcessorRef.current.disconnect();
        scriptProcessorRef.current = null;
    }
    if (analyserRef.current) {
        analyserRef.current.disconnect();
        analyserRef.current = null;
    }
    if (audioContextRef.current) {
        if (audioContextRef.current.state !== 'closed') {
            try {
                await audioContextRef.current.close();
            } catch(e) {
                console.warn("AudioContext already closed.", e);
            }
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
    }, 500);
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
    
    // Stop wake word listener and wait a bit for the OS to release the microphone
    stopWakeWordListener();
    await new Promise(resolve => setTimeout(resolve, 300));

    try {
        setListeningState('requesting_permission');
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaStreamRef.current = stream;
        setMicPermission('granted');

        setListeningState('initializing_audio');
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });
        
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        audioContextRef.current = new AudioContextClass({ sampleRate: 16000 });
        
        // Resume AudioContext if suspended (browser policy)
        if (audioContextRef.current.state === 'suspended') {
            await audioContextRef.current.resume();
        }

        currentTranscriptionRef.current = '';

        setListeningState('connecting');
        // Safety timeout in case connection hangs
        connectionTimeoutRef.current = setTimeout(() => {
            if (listeningStateRef.current === 'connecting' || listeningStateRef.current === 'initializing_audio') {
                console.error("Connection timed out");
                onErrorRef.current("Connection timed out. Please check your network.");
                stopListening();
            }
        }, 10000);

        sessionPromiseRef.current = ai.live.connect({
            model: 'gemini-2.5-flash-native-audio-preview-09-2025',
            callbacks: {
                onopen: () => {
                    if (connectionTimeoutRef.current) {
                        clearTimeout(connectionTimeoutRef.current);
                        connectionTimeoutRef.current = null;
                    }

                    setListeningState('listening');
                    if (!audioContextRef.current || !mediaStreamRef.current) return;

                    const source = audioContextRef.current.createMediaStreamSource(mediaStreamRef.current);
                    
                    // Add Analyser for visualization
                    analyserRef.current = audioContextRef.current.createAnalyser();
                    analyserRef.current.fftSize = 256;
                    
                    scriptProcessorRef.current = audioContextRef.current.createScriptProcessor(4096, 1, 1);
                    
                    scriptProcessorRef.current.onaudioprocess = (audioProcessingEvent) => {
                        const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
                        const pcmBlob = createBlob(inputData);
                        
                        // Check if sessionPromiseRef still exists (user might have stopped listening)
                        if (sessionPromiseRef.current) {
                            sessionPromiseRef.current.then((session) => {
                                session.sendRealtimeInput({ media: pcmBlob });
                            });
                        }
                    };
                    
                    // Connect graph: Source -> Analyser -> ScriptProcessor -> Destination
                    source.connect(analyserRef.current);
                    analyserRef.current.connect(scriptProcessorRef.current);
                    scriptProcessorRef.current.connect(audioContextRef.current.destination);

                    // Start visualization loop
                    updateAudioLevel();
                },
                onmessage: (message: LiveServerMessage) => {
                    if (message.serverContent?.inputTranscription) {
                        const { text } = message.serverContent.inputTranscription;
                        currentTranscriptionRef.current += text;
                        setInputValue(currentTranscriptionRef.current);
                    }

                    if (message.serverContent?.turnComplete) {
                        const fullTranscript = currentTranscriptionRef.current.trim();
                        
                        const sendRegex = /\b(send|done)\.?$/i;
                        const stopRecordingRegex = /\b(stop listening|stop recording)\.?$/i;
                        const clearInputRegex = /\b(clear input|remove)\.?$/i;

                        if (sendRegex.test(fullTranscript)) {
                            const taskText = fullTranscript.replace(sendRegex, '').trim();
                            if (taskText) onSendRef.current(taskText);
                            setInputValue('');
                            stopListening();
                        } else if (stopRecordingRegex.test(fullTranscript)) {
                            const taskText = fullTranscript.replace(stopRecordingRegex, '').trim();
                            setInputValue(taskText);
                            stopListening();
                        } else if (clearInputRegex.test(fullTranscript)) {
                            setInputValue('');
                            currentTranscriptionRef.current = '';
                        }
                    }
                },
                onerror: (e: ErrorEvent) => {
                    console.error("Live session error:", e);
                    const errorMsg = "A connection error occurred. Please try again.";
                    onErrorRef.current(errorMsg);
                    setListeningState('error');
                    stopListening();
                },
                onclose: () => {
                    if (listeningStateRef.current === 'listening' || listeningStateRef.current === 'connecting') {
                       stopListening();
                    }
                },
            },
            config: {
                inputAudioTranscription: {},
                responseModalities: [Modality.AUDIO],
                systemInstruction: "You are MNA. You MUST always speak and respond in clear, professional English. Do not use any other language, even if the user speaks to you in a different language.",
            },
        });

    } catch (err) {
        console.error("Failed to start listening:", err);
        setListeningState('error');
        if (err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')) {
            setMicPermission('denied');
        } else {
             onErrorRef.current("Could not access microphone or start audio. Please check permissions.");
        }
        await stopListening();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listeningState, stopWakeWordListener, stopListening, updateAudioLevel]);

  const startWakeWordListener = useCallback(() => {
    if (listeningState !== 'idle' || micPermission !== 'granted' || speechRecognitionRef.current) {
      return;
    }
    const SpeechRecognitionAPI = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    if (!SpeechRecognitionAPI) {
        return;
    }

    const recognition = new SpeechRecognitionAPI();
    recognition.continuous = true;
    recognition.interimResults = true; // Use interim results for faster detection
    recognition.lang = 'en-US'; // Strictly enforce English for wake word detection

    // Reset retry count on fresh start attempt
    // However, we don't reset inside onend, only when manually starting from scratch
    // or when we have a successful result.
    
    recognition.onresult = (event: SpeechRecognitionEvent) => {
        wakeWordRetryCountRef.current = 0; // Success! Reset retry count.

        let transcript = '';
        // Concatenate all results, including interim ones
        for (let i = event.resultIndex; i < event.results.length; ++i) {
            transcript += event.results[i][0].transcript;
        }
        const lower = transcript.toLowerCase();
        
        // Check for wake word
        if (/\b(hey|start)\b/i.test(lower)) {
            setShouldStartListening(true);
            recognition.abort(); // Immediately stop/release mic once detected
        }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      // Handle backoff for specific errors
      if (event.error === 'audio-capture' || event.error === 'network') {
          wakeWordRetryCountRef.current += 1;
          return; // Allow onend to handle the restart with backoff
      }

      if (
          event.error === 'no-speech' || 
          event.error === 'aborted' 
      ) {
        return;
      }

      console.error('Wake word recognition error:', event.error);
      
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        // Permission related, stop trying
      }
    };

    recognition.onend = () => {
      if (speechRecognitionRef.current === recognition) {
        // Calculate backoff delay
        // Base delay 300ms. If retry > 0, backoff exponentially: 300, 1000, 2000, 4000...
        let delay = 300;
        if (wakeWordRetryCountRef.current > 0) {
            delay = Math.min(500 * Math.pow(2, wakeWordRetryCountRef.current), 30000); // Cap at 30s
            // Only log if we are backing off significantly
            if (delay > 1000) {
                console.warn(`Wake word listener backing off for ${delay}ms (retry ${wakeWordRetryCountRef.current}) due to errors.`);
            }
        }

        setTimeout(() => {
             if (speechRecognitionRef.current === recognition) {
                 try {
                     recognition.start();
                 } catch (e) {
                     // If start fails immediately, we let the next onerror/onend cycle handle it
                     // or stop if it throws synchronously
                     console.error("Failed to restart wake word listener:", e);
                 }
             }
        }, delay);
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
            if (permissionStatus.state === 'granted') {
                setMicPermission('granted');
            }
            permissionStatus.onchange = () => {
                 if (permissionStatus.state === 'granted') {
                     setMicPermission('granted');
                 }
            };
        });
    }
  }, []);

  // Effect to manage the wake word listener based on state
  useEffect(() => {
    if (micPermission === 'granted' && listeningState === 'idle') {
      // When entering idle state with permission, reset retries
      wakeWordRetryCountRef.current = 0;
      startWakeWordListener();
    } else {
      stopWakeWordListener();
    }
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
        if (connectionTimeoutRef.current) clearTimeout(connectionTimeoutRef.current);
        if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
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
    if (listeningState === 'listening' || listeningState === 'connecting' || listeningState === 'initializing_audio' || listeningState === 'requesting_permission') {
      stopListening();
    } else {
      startListening();
    }
  };

  const getPlaceholderText = () => {
    if (micPermission === 'denied') {
      return "Microphone access denied.";
    }
    if (listeningState === 'requesting_permission') {
        return "Please allow microphone access...";
    }
    if (listeningState === 'connecting' || listeningState === 'initializing_audio') {
        return "Connecting to MNA's ears...";
    }
    if (listeningState === 'listening') {
      return "Listening... Say 'send' when done.";
    }
    if (listeningState === 'error') {
        return "Connection error. Click mic to retry.";
    }
    if (micPermission === 'granted') {
        return "Say 'Hey' or 'Start' to activate, or click the mic...";
    }
    return "Click the mic to start speaking...";
  };
  
  const isMicActive = listeningState === 'listening' || listeningState === 'connecting' || listeningState === 'initializing_audio' || listeningState === 'requesting_permission';

  const getStatusBadge = () => {
      switch (listeningState) {
          case 'requesting_permission':
              return <span className="absolute -top-8 left-0 text-xs font-semibold px-2 py-1 bg-yellow-500/20 text-yellow-300 rounded-full animate-pulse border border-yellow-500/30">Requesting Mic Access...</span>;
          case 'initializing_audio':
              return <span className="absolute -top-8 left-0 text-xs font-semibold px-2 py-1 bg-indigo-500/20 text-indigo-300 rounded-full animate-pulse border border-indigo-500/30">Initializing Audio...</span>;
          case 'connecting':
              return <span className="absolute -top-8 left-0 text-xs font-semibold px-2 py-1 bg-indigo-500/20 text-indigo-300 rounded-full animate-pulse border border-indigo-500/30">Connecting to AI...</span>;
          case 'listening':
               return <span className="absolute -top-8 left-0 text-xs font-semibold px-2 py-1 bg-red-500/20 text-red-300 rounded-full border border-red-500/30 flex items-center gap-1">
                   <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>
                   Listening
               </span>;
          case 'error':
               return <span className="absolute -top-8 left-0 text-xs font-semibold px-2 py-1 bg-red-900/40 text-red-300 rounded-full border border-red-500/30">Connection Failed</span>;
           case 'idle':
               if (micPermission === 'granted') {
                    return <span className="absolute -top-8 left-0 text-xs font-semibold px-2 py-1 bg-emerald-500/10 text-emerald-400 rounded-full border border-emerald-500/20">Wake Word Active: "Hey" or "Start"</span>;
               }
               return null;
          default:
              return null;
      }
  };

  return (
    <div className="bg-slate-800/80 backdrop-blur-sm p-4 border-t border-slate-700">
      <div className="max-w-4xl mx-auto">
        <div className="relative">
          {getStatusBadge()}
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
              className="relative p-2 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:opacity-50 disabled:cursor-not-allowed group"
              aria-label={isMicActive ? "Stop listening" : "Start listening"}
              title={micPermission === 'granted' && !isMicActive ? "Wake word active" : "Start listening"}
            >
              {/* Dynamic visualizer ring */}
              {listeningState === 'listening' && (
                  <div 
                    className="absolute inset-0 rounded-full bg-red-500 opacity-20 transition-transform duration-75"
                    style={{ transform: `scale(${1 + audioLevel / 40})` }}
                  ></div>
              )}
               {/* Static Wake Word ring */}
               {listeningState === 'idle' && micPermission === 'granted' && (
                  <div className="absolute inset-0 rounded-full border border-emerald-500/30 opacity-100"></div>
              )}

              <div className={`relative z-10 ${
                listeningState === 'listening'
                  ? 'text-red-400'
                  : isMicActive
                  ? 'text-indigo-400 animate-pulse'
                  : micPermission === 'granted'
                  ? 'text-emerald-400'
                  : 'text-slate-300 hover:text-white'
              }`}>
                <MicrophoneIcon className="w-6 h-6" />
              </div>
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