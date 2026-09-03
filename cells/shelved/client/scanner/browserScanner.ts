import { BrowserMultiFormatReader } from '@zxing/browser';

type BarcodeHit = { rawValue: string; format?: string };
type Detector = { detect(source: HTMLVideoElement): Promise<BarcodeHit[]> };
type DetectorCtor = new (options?: { formats?: string[] }) => Detector;

declare global { interface Window { BarcodeDetector?: DetectorCtor } }

export class BrowserIsbnScanner {
  private stream?: MediaStream;
  private controls?: { stop(): void };
  private frame = 0;
  private stopped = false;

  static supported(): boolean {
    return !!navigator.mediaDevices?.getUserMedia;
  }

  async start(video: HTMLVideoElement, onCode: (isbn: string) => void): Promise<void> {
    if (!BrowserIsbnScanner.supported()) throw new Error('Camera access is not available in this browser.');
    this.stopped = false;
    video.setAttribute('playsinline', 'true');
    video.muted = true;
    const Detector = window.BarcodeDetector;
    if (!Detector) {
      const reader = new BrowserMultiFormatReader(undefined, { delayBetweenScanAttempts: 180, delayBetweenScanSuccess: 600 });
      const controls = await reader.decodeFromConstraints({ video: { facingMode: { ideal: 'environment' } }, audio: false }, video, (result) => {
        if (!result || this.stopped) return;
        const code = result.getText().replace(/[^0-9X]/gi, '');
        if (code.length === 13 || code.length === 10) { onCode(code); this.stop(); }
      });
      this.controls = controls;
      if (this.stopped) controls.stop();
      return;
    }
    this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    video.srcObject = this.stream;
    await video.play();
    const detector = new Detector({ formats: ['ean_13', 'ean_8'] });
    const tick = async (): Promise<void> => {
      if (this.stopped) return;
      try {
        const hits = await detector.detect(video);
        const code = hits.map((h) => h.rawValue.replace(/[^0-9X]/gi, '')).find((v) => v.length === 13 || v.length === 10);
        if (code) { onCode(code); this.stop(); return; }
      } catch { /* a transient frame decode is normal */ }
      this.frame = requestAnimationFrame(() => void tick());
    };
    await tick();
  }

  stop(): void {
    this.stopped = true;
    cancelAnimationFrame(this.frame);
    this.controls?.stop();
    this.controls = undefined;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = undefined;
  }
}
