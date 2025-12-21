import { useCallback, useEffect, useRef, useState } from 'react';
import { generateSpeech, transcribeAudio } from '../server/audio';

export interface UseServerAudioOptions {
  /** Callback when transcription is ready */
  onTranscription?: (text: string) => void;
  /** Auto-process transcription as intent */
  autoProcessIntent?: boolean;
  /** Process intent function */
  processIntent?: (intent: string) => Promise<void>;
}

export interface UseServerAudioReturn {
  // Recording state
  isRecording: boolean;
  isTranscribing: boolean;
  isSpeaking: boolean;

  // Actions
  startRecording: () => void;
  stopRecording: () => void;
  toggleRecording: () => void;
  speak: (text: string, voice?: string) => Promise<void>;
  stopSpeaking: () => void;

  // Data
  transcript: string;
  error: Error | null;
}

/**
 * Hook for server-side audio processing.
 * Uses MediaRecorder for client-side recording and server functions for STT/TTS.
 */
export function useServerAudio(
  options?: UseServerAudioOptions,
): UseServerAudioReturn {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<Error | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current?.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
      if (audioSourceRef.current) {
        audioSourceRef.current.stop();
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, []);

  const startRecording = useCallback(async () => {
    try {
      setError(null);
      setTranscript('');
      audioChunksRef.current = [];

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus',
      });

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        // Stop all tracks
        for (const track of stream.getTracks()) {
          track.stop();
        }

        // Convert chunks to a single blob
        const audioBlob = new Blob(audioChunksRef.current, {
          type: 'audio/webm',
        });

        // Convert to base64 for transport
        const reader = new FileReader();
        reader.onloadend = async () => {
          const base64 = (reader.result as string).split(',')[1];

          setIsTranscribing(true);
          try {
            const result = await transcribeAudio({
              data: { audio: base64, mimeType: 'audio/webm' },
            });

            if (result.text) {
              setTranscript(result.text);
              options?.onTranscription?.(result.text);

              if (options?.autoProcessIntent && options?.processIntent) {
                await options.processIntent(result.text);
              }
            }
          } catch (err) {
            console.error('Transcription error:', err);
            setError(
              err instanceof Error ? err : new Error('Transcription failed'),
            );
          } finally {
            setIsTranscribing(false);
          }
        };
        reader.readAsDataURL(audioBlob);
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error('Recording error:', err);
      setError(
        err instanceof Error ? err : new Error('Failed to start recording'),
      );
    }
  }, [options]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  }, []);

  const toggleRecording = useCallback(() => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  }, [isRecording, startRecording, stopRecording]);

  const speak = useCallback(async (text: string, voice?: string) => {
    try {
      setError(null);
      setIsSpeaking(true);

      const result = await generateSpeech({
        data: { text, voice },
      });

      // Decode base64 audio
      const binaryString = atob(result.audio);
      const audioData = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        audioData[i] = binaryString.charCodeAt(i);
      }

      // Create AudioContext and play
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext();
      }

      const audioBuffer = await audioContextRef.current.decodeAudioData(
        audioData.buffer,
      );
      const source = audioContextRef.current.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContextRef.current.destination);

      source.onended = () => {
        setIsSpeaking(false);
        audioSourceRef.current = null;
      };

      audioSourceRef.current = source;
      source.start();
    } catch (err) {
      console.error('Speech error:', err);
      setError(
        err instanceof Error ? err : new Error('Speech generation failed'),
      );
      setIsSpeaking(false);
    }
  }, []);

  const stopSpeaking = useCallback(() => {
    if (audioSourceRef.current) {
      audioSourceRef.current.stop();
      audioSourceRef.current = null;
      setIsSpeaking(false);
    }
  }, []);

  return {
    isRecording,
    isTranscribing,
    isSpeaking,
    startRecording,
    stopRecording,
    toggleRecording,
    speak,
    stopSpeaking,
    transcript,
    error,
  };
}
