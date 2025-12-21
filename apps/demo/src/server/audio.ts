import { deepgram } from '@ai-sdk/deepgram';
import {
  createAISDKTranscription,
  createCartesiaTTS,
} from '@maelstrom/audio/server';
import { createServerFn } from '@tanstack/react-start';

// Create the transcription provider using Deepgram Nova-3
const transcriptionProvider = createAISDKTranscription({
  model: deepgram.transcription('nova-3'),
});

// Create the speech provider using Cartesia Sonic 3
const speechProvider = createCartesiaTTS({
  modelId: 'sonic-3',
  // Voice ID - see https://docs.cartesia.ai/build-with-cartesia/voices for options
  defaultVoiceId: '1242fb95-7ddd-44ac-8a05-9e8a22a6137d',
  defaultLanguage: 'en',
});

/**
 * Server function to transcribe audio to text.
 * Accepts base64-encoded audio data and returns the transcription.
 */
export const transcribeAudio = createServerFn({ method: 'POST' })
  .inputValidator((data: { audio: string; mimeType?: string }) => data)
  .handler(async ({ data }) => {
    console.log('[Maelstrom Audio] Transcribing audio...');

    try {
      // Decode base64 audio to Uint8Array
      const binaryString = atob(data.audio);
      const audioData = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        audioData[i] = binaryString.charCodeAt(i);
      }

      const result = await transcriptionProvider.transcribe(audioData);

      console.log('[Maelstrom Audio] Transcription:', result.text);

      return {
        text: result.text,
        language: result.language,
        durationInSeconds: result.durationInSeconds,
        confidence: result.confidence,
      };
    } catch (error) {
      console.error('[Maelstrom Audio] Transcription error:', error);
      throw error;
    }
  });

/**
 * Server function to generate speech from text.
 * Returns base64-encoded audio data.
 */
export const generateSpeech = createServerFn({ method: 'POST' })
  .inputValidator((data: { text: string; voice?: string }) => data)
  .handler(async ({ data }) => {
    console.log(
      '[Maelstrom Audio] Generating speech for:',
      data.text.slice(0, 50),
    );

    try {
      const result = await speechProvider.generateSpeech(data.text, {
        voice: data.voice,
      });

      // Encode audio data as base64 for transport
      let binaryString = '';
      for (let i = 0; i < result.audioData.length; i++) {
        binaryString += String.fromCharCode(result.audioData[i]);
      }
      const base64Audio = btoa(binaryString);

      console.log(
        '[Maelstrom Audio] Speech generated, size:',
        result.audioData.length,
      );

      return {
        audio: base64Audio,
        format: result.format,
        durationInSeconds: result.durationInSeconds,
      };
    } catch (error) {
      console.error('[Maelstrom Audio] Speech generation error:', error);
      throw error;
    }
  });
