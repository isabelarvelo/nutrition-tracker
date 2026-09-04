'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

export type VoiceStatus = 'idle' | 'requesting' | 'recording' | 'transcribing';

const PREFERRED = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
const MAX_MS = 120_000;

function pickMimeType() {
  if (typeof MediaRecorder === 'undefined') return null;
  return PREFERRED.find((type) => MediaRecorder.isTypeSupported(type)) ?? null;
}

/** Records a temporary audio clip and adds its transcript to the meal draft. */
export function useVoiceNote(onTranscript: (text: string) => void, onError: (message: string) => void) {
  const [status, setStatus] = useState<VoiceStatus>('idle');
  const [level, setLevel] = useState(0);
  const [seconds, setSeconds] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const frameRef = useRef<number>(0);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const generationRef = useRef(0);
  const busyRef = useRef(false);
  const requestRef = useRef<AbortController | null>(null);

  const teardown = useCallback(() => {
    cancelAnimationFrame(frameRef.current);
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    if (tickRef.current) clearInterval(tickRef.current);
    stopTimerRef.current = null;
    tickRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void audioContextRef.current?.close().catch(() => {});
    audioContextRef.current = null;
    const recorder = recorderRef.current;
    if (recorder) {
      recorder.onstop = null;
      recorder.ondataavailable = null;
      recorder.onerror = null;
      if (recorder.state !== 'inactive') recorder.stop();
    }
    recorderRef.current = null;
    setLevel(0);
    setSeconds(0);
  }, []);

  useEffect(() => () => {
    generationRef.current++;
    busyRef.current = false;
    requestRef.current?.abort();
    teardown();
  }, [teardown]);

  const start = useCallback(async () => {
    if (busyRef.current) return;

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia || !pickMimeType()) {
      onError('This browser cannot record audio. Type the meal instead.');
      return;
    }
    // getUserMedia is only available over HTTPS or on localhost. Saying so is
    // more useful than a permission error the person cannot act on.
    if (!window.isSecureContext) {
      onError('Voice notes need a secure (https) connection.');
      return;
    }

    busyRef.current = true;
    const generation = ++generationRef.current;
    setStatus('requesting');
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (error) {
      if (generation !== generationRef.current) return;
      busyRef.current = false;
      setStatus('idle');
      const name = error instanceof DOMException ? error.name : '';
      if (name === 'NotAllowedError') onError('Microphone access was blocked. Allow it in your browser settings, then try again.');
      else if (name === 'NotFoundError') onError('No microphone was found.');
      else onError('Could not start recording. Type the meal instead.');
      return;
    }

    if (generation !== generationRef.current) { stream.getTracks().forEach(track => track.stop()); return; }
    streamRef.current = stream;
    const mimeType = pickMimeType()!;
    let recorder: MediaRecorder;
    try { recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 64_000 }); }
    catch { teardown(); busyRef.current = false; setStatus('idle'); onError('Could not start recording. Type the meal instead.'); return; }
    recorderRef.current = recorder;
    const chunks: Blob[] = [];

    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    recorder.onerror = () => { busyRef.current = false; teardown(); setStatus('idle'); onError('Recording stopped unexpectedly. Try again.'); };
    recorder.onstop = async () => {
      const blob = new Blob(chunks, { type: mimeType });
      teardown();
      if (generation !== generationRef.current) return;
      // Roughly a quarter second of Opus. Below this it is a stray tap, not speech.
      if (blob.size < 1200) { busyRef.current = false; setStatus('idle'); onError('That recording was too short to hear.'); return; }

      setStatus('transcribing');
      const controller = new AbortController();
      requestRef.current = controller;
      try {
        const form = new FormData();
        form.append('audio', blob, `voice-note.${mimeType.includes('mp4') ? 'm4a' : mimeType.includes('ogg') ? 'ogg' : 'webm'}`);
        const response = await fetch('/api/transcribe', { method: 'POST', body: form, signal: controller.signal });
        const data = await response.json() as { transcript?: string; error?: string };
        if (!response.ok || !data.transcript) throw new Error(data.error || 'Could not transcribe that recording.');
        if (generation === generationRef.current) onTranscript(data.transcript);
      } catch (error) {
        if (generation === generationRef.current) onError(error instanceof Error ? error.message : 'Could not transcribe that recording.');
      } finally {
        if (generation === generationRef.current) { busyRef.current = false; requestRef.current = null; setStatus('idle'); }
      }
    };

    // Live level, so a dead microphone is visible before the person finishes talking.
    try {
      const context = new AudioContext();
      audioContextRef.current = context;
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      context.createMediaStreamSource(stream).connect(analyser);
      const buffer = new Uint8Array(analyser.frequencyBinCount);
      const sample = () => {
        analyser.getByteTimeDomainData(buffer);
        let peak = 0;
        for (const value of buffer) peak = Math.max(peak, Math.abs(value - 128) / 128);
        setLevel(peak);
        frameRef.current = requestAnimationFrame(sample);
      };
      sample();
    } catch { /* the meter is a nicety; recording continues without it */ }

    try { recorder.start(250); }
    catch { teardown(); busyRef.current = false; setStatus('idle'); onError('Could not start recording. Type the meal instead.'); return; }
    setStatus('recording');
    tickRef.current = setInterval(() => setSeconds((value) => value + 1), 1000);
    stopTimerRef.current = setTimeout(() => { if (recorderRef.current?.state === 'recording') recorderRef.current.stop(); }, MAX_MS);
  }, [onError, onTranscript, teardown]);

  const stop = useCallback(() => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
  }, []);

  const cancel = useCallback(() => {
    generationRef.current++;
    busyRef.current = false;
    requestRef.current?.abort();
    requestRef.current = null;
    teardown();
    setStatus('idle');
  }, [teardown]);

  return { status, level, seconds, start, stop, cancel };
}
