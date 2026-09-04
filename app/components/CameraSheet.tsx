'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * An in-app camera.
 *
 * `<input type="file" capture="environment">` is only a hint, and the HTML
 * spec lets user agents ignore it. Every desktop browser does, which is why
 * "Take photo" and "Upload photos" opened the same file picker. This uses
 * getUserMedia so the camera is a camera everywhere, and downscales before
 * handing the file back — full-resolution phone photos are wasteful for both
 * storage and vision tokens.
 */
export default function CameraSheet({ onCapture, onClose, onError }: {
  onCapture: (file: File) => void;
  onClose: () => void;
  onError: (message: string) => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const capturingRef = useRef(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function open() {
      if (!navigator.mediaDevices?.getUserMedia) { onError('This browser cannot open a camera. Upload a photo instead.'); onClose(); return; }
      if (!window.isSecureContext) { onError('The camera needs a secure (https) connection.'); onClose(); return; }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing, width: { ideal: 1600 }, height: { ideal: 1600 } },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((track) => track.stop()); return; }
        stop();
        streamRef.current = stream;
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
        if (cancelled) return;
        setReady(true);
        const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
        if (!cancelled) setHasMultipleCameras(devices.filter((device) => device.kind === 'videoinput').length > 1);
      } catch (error) {
        if (cancelled) return;
        const name = error instanceof DOMException ? error.name : '';
        if (name === 'NotAllowedError') onError('Camera access was blocked. Allow it in your browser settings, or upload a photo instead.');
        else if (name === 'NotFoundError') onError('No camera was found. Upload a photo instead.');
        else onError('Could not open the camera. Upload a photo instead.');
        onClose();
      }
    }
    void open();
    return () => { cancelled = true; stop(); };
  }, [facing, onClose, onError, stop]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key === 'Tab') {
        const buttons = Array.from(dialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
        const first = buttons[0]; const last = buttons.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); previous?.focus(); };
  }, [onClose]);

  function shoot() {
    const video = videoRef.current;
    if (!video || !video.videoWidth || capturingRef.current) return;
    const scale = Math.min(1, 1600 / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const context = canvas.getContext('2d');
    if (!context) { onError('Could not capture that frame. Try again.'); return; }
    if (facing === 'user') { context.translate(canvas.width, 0); context.scale(-1, 1); }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    capturingRef.current = true;
    canvas.toBlob((blob) => {
      capturingRef.current = false;
      if (!streamRef.current) return;
      if (!blob) { onError('Could not capture that frame. Try again.'); return; }
      onCapture(new File([blob], `meal-${Date.now()}.jpg`, { type: 'image/jpeg' }));
      onClose();
    }, 'image/jpeg', 0.85);
  }

  return (
    <div ref={dialogRef} className="camera-sheet" role="dialog" aria-modal="true" aria-label="Camera">
      <div className="camera-stage">
        <video ref={videoRef} playsInline muted className={facing === 'user' ? 'mirrored' : ''} />
        {!ready && <p className="camera-waiting">Opening the camera…</p>}
      </div>
      <div className="camera-controls">
        <button type="button" onClick={onClose}>Cancel</button>
        <button type="button" className="shutter" onClick={shoot} disabled={!ready} aria-label="Take photo" />
        {hasMultipleCameras
          ? <button type="button" onClick={() => { setReady(false); setFacing(facing === 'environment' ? 'user' : 'environment'); }}>Flip</button>
          : <span aria-hidden="true" />}
      </div>
    </div>
  );
}
