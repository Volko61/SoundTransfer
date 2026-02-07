'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useAudioProcessor, SSTVMode } from '@/hooks/useAudioProcessor';
import { DecoderState } from '@/lib/sstv/decoder';
import SettingsPanel from './SettingsPanel';

interface SSTVDecoderProps {
  selectedMode: SSTVMode;
  onModeChange: (mode: SSTVMode) => void;
}

export default function SSTVDecoder({ selectedMode, onModeChange }: SSTVDecoderProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const spectrumCanvasRef = useRef<HTMLCanvasElement>(null);
  const spectrogramCanvasRef = useRef<HTMLCanvasElement>(null);
  const waveformCanvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const waveformHistoryRef = useRef<Float32Array[]>([]);

  const {
    state,
    startRecording,
    stopRecording,
    resetDecoder,
    getImageData,
    getDimensions,
    getAnalyser,
  } = useAudioProcessor(selectedMode);

  const handleModeChange = (newMode: SSTVMode) => {
    // Stop recording if active
    if (state.isRecording) {
      stopRecording();
    }
    onModeChange(newMode);
  };

  // Draw spectrum visualization with frequency axis
  const drawSpectrum = useCallback((canvas: HTMLCanvasElement) => {
    const analyser = getAnalyser();
    if (!analyser) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(dataArray);

    const sampleRate = analyser.context.sampleRate;
    const nyquist = sampleRate / 2;

    // Reserve space for axis labels at the bottom
    const axisHeight = 25;
    const plotHeight = canvas.height - axisHeight;

    ctx.fillStyle = 'rgb(10, 10, 10)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw spectrum as a line
    ctx.strokeStyle = '#2ea043';
    ctx.lineWidth = 2;
    ctx.beginPath();

    const barWidth = canvas.width / bufferLength;
    for (let i = 0; i < bufferLength; i++) {
      const barHeight = (dataArray[i] / 255) * plotHeight;
      const x = i * barWidth;
      const y = plotHeight - barHeight;

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }

    ctx.stroke();

    // Draw frequency axis
    ctx.fillStyle = '#8b949e';
    ctx.strokeStyle = '#30363d';
    ctx.lineWidth = 1;
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';

    // Draw horizontal line for axis
    ctx.beginPath();
    ctx.moveTo(0, plotHeight);
    ctx.lineTo(canvas.width, plotHeight);
    ctx.stroke();

    // Calculate appropriate frequency step based on canvas width and nyquist frequency
    // Aim for labels every ~80-100 pixels to avoid overlap
    const pixelsPerLabel = 90;
    const numLabels = Math.floor(canvas.width / pixelsPerLabel);
    const freqStep = Math.ceil(nyquist / numLabels / 1000) * 1000; // Round to nearest 1000 Hz

    // Draw frequency labels
    for (let freq = 0; freq <= nyquist; freq += freqStep) {
      const binIndex = Math.floor((freq / nyquist) * bufferLength);
      const xPos = (binIndex / bufferLength) * canvas.width;

      // Draw tick mark
      ctx.beginPath();
      ctx.moveTo(xPos, plotHeight);
      ctx.lineTo(xPos, plotHeight + 5);
      ctx.stroke();

      // Draw label - use kHz for frequencies >= 1000 Hz
      let label;
      if (freq >= 1000) {
        label = `${(freq / 1000).toFixed(1)}k`;
      } else {
        label = `${freq}`;
      }
      ctx.fillText(label, xPos, plotHeight + 18);
    }

    // Draw "Hz" label at the end
    ctx.textAlign = 'right';
    ctx.fillText('Hz', canvas.width - 5, plotHeight + 18);

    return dataArray; // Return the data for spectrogram
  }, [getAnalyser]);

  // Draw spectrogram (waterfall display)
  const drawSpectrogram = useCallback((canvas: HTMLCanvasElement, frequencyData: Uint8Array) => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Scroll the existing image down by 1 pixel
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height - 1);
    ctx.putImageData(imageData, 0, 1);

    // Draw the new frequency data at the top
    const barWidth = canvas.width / frequencyData.length;

    for (let i = 0; i < frequencyData.length; i++) {
      const value = frequencyData[i];

      // Create a color gradient based on intensity
      let r, g, b;
      if (value < 85) {
        // Black to blue
        r = 0;
        g = 0;
        b = value * 3;
      } else if (value < 170) {
        // Blue to green
        r = 0;
        g = (value - 85) * 3;
        b = 255 - (value - 85) * 3;
      } else {
        // Green to yellow/red
        r = (value - 170) * 3;
        g = 255;
        b = 0;
      }

      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.fillRect(i * barWidth, 0, Math.ceil(barWidth), 1);
    }
  }, []);

  // Draw waveform timeline (like Audacity)
  const drawWaveform = useCallback((canvas: HTMLCanvasElement) => {
    const analyser = getAnalyser();
    if (!analyser) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Get time domain data
    const bufferLength = analyser.fftSize;
    const dataArray = new Float32Array(bufferLength);
    analyser.getFloatTimeDomainData(dataArray);

    // Store waveform data in history (keep last 300 frames for ~10 seconds at 30fps)
    const maxHistory = 300;
    waveformHistoryRef.current.push(dataArray.slice());
    if (waveformHistoryRef.current.length > maxHistory) {
      waveformHistoryRef.current.shift();
    }

    const history = waveformHistoryRef.current;
    if (history.length === 0) return;

    // Reserve space for time axis at the bottom
    const axisHeight = 25;
    const plotHeight = canvas.height - axisHeight;

    // Clear canvas
    ctx.fillStyle = 'rgb(10, 10, 10)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw center line (zero amplitude)
    ctx.strokeStyle = '#30363d';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, plotHeight / 2);
    ctx.lineTo(canvas.width, plotHeight / 2);
    ctx.stroke();

    // Calculate pixels per frame
    const pixelsPerFrame = canvas.width / maxHistory;

    // Draw waveform history - green color to match theme
    ctx.strokeStyle = '#2ea043';
    ctx.fillStyle = 'rgba(46, 160, 67, 0.3)';
    ctx.lineWidth = 1.5;

    for (let frameIdx = 0; frameIdx < history.length; frameIdx++) {
      const frame = history[frameIdx];
      const x = frameIdx * pixelsPerFrame;
      const samplesPerPixel = Math.max(1, Math.floor(frame.length / pixelsPerFrame));

      // Draw waveform for this frame
      ctx.beginPath();
      ctx.moveTo(x, plotHeight / 2);

      // Calculate min/max for each pixel column
      for (let px = 0; px < pixelsPerFrame; px++) {
        const sampleStart = Math.floor(px * samplesPerPixel);
        const sampleEnd = Math.min(sampleStart + samplesPerPixel, frame.length);

        let min = 1;
        let max = -1;

        for (let i = sampleStart; i < sampleEnd; i++) {
          const sample = frame[i];
          if (sample < min) min = sample;
          if (sample > max) max = sample;
        }

        const xPos = x + px;
        const yMin = plotHeight / 2 - (min * plotHeight / 2);
        const yMax = plotHeight / 2 - (max * plotHeight / 2);

        // Draw vertical line from min to max
        ctx.moveTo(xPos, yMin);
        ctx.lineTo(xPos, yMax);
      }

      ctx.stroke();
    }

    // Draw time axis
    ctx.fillStyle = '#8b949e';
    ctx.strokeStyle = '#30363d';
    ctx.lineWidth = 1;
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';

    // Draw horizontal line for axis
    ctx.beginPath();
    ctx.moveTo(0, plotHeight);
    ctx.lineTo(canvas.width, plotHeight);
    ctx.stroke();

    // Calculate time range (assuming ~30fps polling)
    const fps = 30;
    const totalSeconds = maxHistory / fps;
    const secondsVisible = (history.length / maxHistory) * totalSeconds;

    // Draw time labels every 2 seconds for 10s range
    const labelInterval = 2;
    const pixelsPerSecond = canvas.width / totalSeconds;
    for (let sec = 0; sec <= Math.ceil(secondsVisible); sec += labelInterval) {
      const xPos = (totalSeconds - secondsVisible + sec) * pixelsPerSecond;
      
      if (xPos >= 0 && xPos <= canvas.width) {
        // Draw tick mark
        ctx.beginPath();
        ctx.moveTo(xPos, plotHeight);
        ctx.lineTo(xPos, plotHeight + 5);
        ctx.stroke();

        // Draw label
        const timeLabel = `-${Math.floor(secondsVisible - sec)}s`;
        ctx.fillText(timeLabel, xPos, plotHeight + 18);
      }
    }

    // Draw "now" indicator
    ctx.fillStyle = '#2ea043';
    ctx.fillText('now', canvas.width - 20, plotHeight + 18);
  }, [getAnalyser]);

  // Update canvas with decoded image
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dimensions = getDimensions();

    // Create an offscreen canvas that matches SSTV dimensions
    const offscreenCanvas = document.createElement('canvas');
    offscreenCanvas.width = dimensions.width;
    offscreenCanvas.height = dimensions.height;
    const offscreenCtx = offscreenCanvas.getContext('2d');

    if (!offscreenCtx) return;

    // Disable image smoothing for crisp pixels
    ctx.imageSmoothingEnabled = false;
    offscreenCtx.imageSmoothingEnabled = false;

    // Clear both canvases initially
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    offscreenCtx.fillStyle = 'black';
    offscreenCtx.fillRect(0, 0, offscreenCanvas.width, offscreenCanvas.height);

    let lastRenderedLine = -1;

    const updateCanvas = () => {
      const imageData = getImageData();
      const currentLine = state.stats?.currentLine ?? 0;

      // Always update to see the progressive image (even when paused)
      if (imageData && offscreenCtx) {
        // Debug: Check if we have any non-black pixels
        if (state.isRecording && currentLine > lastRenderedLine && currentLine % 10 === 0) {
          let nonBlackPixels = 0;
          for (let i = 0; i < imageData.length; i += 4) {
            if (imageData[i] > 0 || imageData[i+1] > 0 || imageData[i+2] > 0) {
              nonBlackPixels++;
            }
          }
          console.log(`Line ${currentLine}: ${nonBlackPixels} non-black pixels in imageData`);
        }

        // Create ImageData from a copy of the decoder's buffer
        const imgData = new ImageData(
          new Uint8ClampedArray(imageData),
          dimensions.width,
          dimensions.height
        );

        // Put the complete image data on the offscreen canvas
        offscreenCtx.putImageData(imgData, 0, 0);

        // Draw to main canvas without clearing (preserve all previous lines)
        ctx.drawImage(offscreenCanvas, 0, 0, canvas.width, canvas.height);

        lastRenderedLine = currentLine;
      }

      // Draw spectrum, spectrogram, and waveform only when recording
      if (state.isRecording) {
        const spectrumCanvas = spectrumCanvasRef.current;
        const spectrogramCanvas = spectrogramCanvasRef.current;
        const waveformCanvas = waveformCanvasRef.current;

        if (spectrumCanvas) {
          const frequencyData = drawSpectrum(spectrumCanvas);

          // Update spectrogram with the frequency data
          if (spectrogramCanvas && frequencyData) {
            drawSpectrogram(spectrogramCanvas, frequencyData);
          }
        }

        // Update waveform timeline
        if (waveformCanvas) {
          drawWaveform(waveformCanvas);
        }
      }

      animationFrameRef.current = requestAnimationFrame(updateCanvas);
    };

    animationFrameRef.current = requestAnimationFrame(updateCanvas);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [state.isRecording, state.stats?.currentLine, getImageData, getDimensions, drawSpectrum, drawSpectrogram, drawWaveform, getAnalyser]);

  const handleStart = async () => {
    await startRecording();
  };

  const handleStop = () => {
    stopRecording();
  };

  const handleReset = () => {
    resetDecoder();
    // Clear waveform history
    waveformHistoryRef.current = [];
  };

  const handleSaveImage = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Create a download link
    canvas.toBlob((blob) => {
      if (!blob) return;

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      link.download = `sstv-decode-robot36-${timestamp}.png`;
      link.href = url;
      link.click();

      // Clean up
      URL.revokeObjectURL(url);
    }, 'image/png');
  };

  const getStateColor = () => {
    if (!state.stats) return 'text-gray-400';
    switch (state.stats.state) {
      case DecoderState.IDLE:
        return 'text-gray-400';
      case DecoderState.DECODING_IMAGE:
        return 'text-green-400';
      default:
        return 'text-gray-400';
    }
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Settings Panel - floating cog icon */}
      <SettingsPanel
        currentMode={selectedMode}
        onModeChange={handleModeChange}
        disabled={state.isRecording}
      />

      {/* Controls */}
      <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4 sm:p-6 space-y-4">
                {/* Action buttons - full width on mobile, flex on larger screens */}
        <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
          {!state.isRecording ? (
            <button
              onClick={handleStart}
              disabled={!state.isSupported}
              className="w-full sm:flex-1 bg-[#238636] hover:bg-[#2ea043] active:bg-[#2ea043] disabled:bg-[#21262d] disabled:text-[#8b949e] disabled:cursor-not-allowed text-white font-semibold px-6 py-3 rounded-md transition-colors text-base border border-transparent disabled:border-[#30363d] flex items-center justify-center gap-2"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
              </svg>
              Start Decoding
            </button>
          ) : (
            <button
              onClick={handleStop}
              className="w-full sm:flex-1 bg-[#da3633] hover:bg-[#f85149] active:bg-[#f85149] text-white font-semibold px-6 py-3 rounded-md transition-colors text-base flex items-center justify-center gap-2"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1H8z" clipRule="evenodd" />
              </svg>
              Stop
            </button>
          )}

          <button
            onClick={handleReset}
            className="w-full sm:flex-1 bg-[#21262d] hover:bg-[#30363d] active:bg-[#30363d] text-white font-semibold px-6 py-3 rounded-md transition-colors text-base border border-[#30363d] flex items-center justify-center gap-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
            </svg>
            Reset
          </button>

          <button
            onClick={handleSaveImage}
            className="w-full sm:flex-1 bg-[#21262d] hover:bg-[#30363d] active:bg-[#30363d] text-white font-semibold px-6 py-3 rounded-md transition-colors text-base border border-[#30363d] flex items-center justify-center gap-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
            Save Image
          </button>
        </div>

        {state.error && (
          <div className="bg-[#da3633]/10 border border-[#f85149]/30 rounded-md p-3 text-[#f85149] text-sm sm:text-base">
            {state.error}
          </div>
        )}

        {!state.isSupported && (
          <div className="bg-[#bb8009]/10 border border-[#bb8009]/30 rounded-md p-3 text-[#e3b341] text-sm sm:text-base">
            Web Audio API is not supported in this browser
          </div>
        )}

        {/* Stats */}
        {state.stats && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 text-sm">
            <div className="bg-[#0d1117] border border-[#30363d] rounded-lg p-3">
              <div className="text-[#8b949e] text-xs sm:text-sm mb-1">State</div>
              <div className={`font-mono font-semibold text-sm sm:text-base ${getStateColor()}`}>
                {state.stats.state}
              </div>
            </div>
            <div className="bg-[#0d1117] border border-[#30363d] rounded-lg p-3">
              <div className="text-[#8b949e] text-xs sm:text-sm mb-1">Mode</div>
              <div className="font-mono font-semibold text-sm sm:text-base truncate">{state.stats.mode}</div>
            </div>
            <div className="bg-[#0d1117] border border-[#30363d] rounded-lg p-3">
              <div className="text-[#8b949e] text-xs sm:text-sm mb-1">Line</div>
              <div className="font-mono font-semibold text-sm sm:text-base">
                {state.stats.currentLine} / {state.stats.totalLines}
              </div>
            </div>
            <div className="bg-[#0d1117] border border-[#30363d] rounded-lg p-3">
              <div className="text-[#8b949e] text-xs sm:text-sm mb-1">SNR</div>
              <div className={`font-mono font-semibold text-sm sm:text-base ${
                state.stats.snr === null ? 'text-[#8b949e]' :
                state.stats.snr < 10 ? 'text-[#da3633]' :
                state.stats.snr < 18 ? 'text-[#e3b341]' :
                'text-[#2ea043]'
              }`}>
                {state.stats.snr !== null ? `${state.stats.snr.toFixed(1)} dB` : '-- dB'}
              </div>
            </div>
          </div>
        )}

        {/* Progress bar */}
        {state.stats && state.stats.progress > 0 && (
          <div className="w-full bg-[#21262d] rounded-full h-2 overflow-hidden border border-[#30363d]">
            <div
              className="bg-[#238636] h-2 rounded-full transition-all duration-300"
              style={{ width: `${Math.min(100, state.stats.progress)}%` }}
            />
          </div>
        )}
      </div>

      {/* Canvas Display - prioritize decoded image on mobile */}
      <div className="space-y-4 lg:space-y-0 lg:grid lg:grid-cols-2 lg:gap-6">
        {/* Decoded Image - main focus */}
        <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-3 sm:p-4">
          <div className="flex items-center justify-between mb-2 sm:mb-3">
            <h2 className="text-lg sm:text-xl font-semibold">Decoded Image</h2>
            <span className="text-xs sm:text-sm text-[#8b949e] font-mono">
              {getDimensions().width}×{getDimensions().height}
            </span>
          </div>
          <canvas
            ref={canvasRef}
            width={getDimensions().width}
            height={getDimensions().height}
            className="w-full border border-[#30363d] rounded bg-[#0d1117] touch-manipulation"
          />
        </div>

        {/* Audio Analysis - spectrum and spectrogram */}
        <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-3 sm:p-4">
          <div className="flex items-center justify-between mb-2 sm:mb-3">
            <h2 className="text-lg sm:text-xl font-semibold">Audio Analysis</h2>

            {/* Signal Strength Indicator */}
            {state.stats && (
              <div className="flex items-center gap-2">
                <span className="text-xs sm:text-sm text-[#8b949e]">Signal</span>
                <div className="flex items-center gap-1">
                  {/* Signal strength bars */}
                  {[0, 1, 2, 3, 4].map((bar) => {
                    const threshold = bar * 20;
                    const isActive = state.stats!.signalStrength > threshold;
                    const barHeight = 8 + bar * 3;
                    let barColor = 'bg-[#21262d]';

                    if (isActive) {
                      if (state.stats!.signalStrength < 30) {
                        barColor = 'bg-[#da3633]';
                      } else if (state.stats!.signalStrength < 60) {
                        barColor = 'bg-[#e3b341]';
                      } else {
                        barColor = 'bg-[#2ea043]';
                      }
                    }

                    return (
                      <div
                        key={bar}
                        className={`w-1.5 sm:w-2 rounded-sm transition-colors ${barColor}`}
                        style={{ height: `${barHeight}px` }}
                      />
                    );
                  })}
                </div>
                <span className="text-xs sm:text-sm font-mono text-[#c9d1d9] min-w-[3ch]">
                  {state.stats.signalStrength}%
                </span>
              </div>
            )}
          </div>

          {/* Waveform Timeline */}
          <div className="space-y-2">
            <h3 className="text-sm sm:text-base font-medium text-[#8b949e]">Waveform</h3>
            <canvas
              ref={waveformCanvasRef}
              width={640}
              height={180}
              className="w-full border border-[#30363d] rounded bg-[#0d1117] touch-manipulation"
            />
          </div>

          {/* Real-time Spectrum */}
          <div className="space-y-2 mt-3 sm:mt-4">
            <h3 className="text-sm sm:text-base font-medium text-[#8b949e]">Spectrum</h3>
            <canvas
              ref={spectrumCanvasRef}
              width={640}
              height={200}
              className="w-full border border-[#30363d] rounded bg-[#0d1117] touch-manipulation"
            />
          </div>

          {/* Spectrogram (Waterfall) */}
          <div className="space-y-2 mt-3 sm:mt-4">
            <h3 className="text-sm sm:text-base font-medium text-[#8b949e]">Spectrogram</h3>
            <canvas
              ref={spectrogramCanvasRef}
              width={640}
              height={240}
              className="w-full border border-[#30363d] rounded bg-[#0d1117] touch-manipulation"
            />
          </div>
        </div>
      </div>

      {/* Info - collapsible on mobile */}
      <details className="bg-[#161b22] border border-[#30363d] rounded-lg">
        <summary className="cursor-pointer p-4 sm:p-6 font-semibold text-lg sm:text-xl hover:bg-[#21262d] rounded-lg transition-colors select-none">
          How to Use
        </summary>
        <div className="px-4 pb-4 sm:px-6 sm:pb-6">
          <ol className="list-decimal list-inside space-y-2 text-sm sm:text-base text-[#c9d1d9]">
            <li>Click &quot;Start Decoding&quot; to begin capturing audio from your microphone</li>
            <li>Play an SSTV signal (you can use a signal generator or recording)</li>
            <li>Watch as the image is decoded in real-time on the canvas</li>
            <li>Click &quot;Reset&quot; to clear the image and start over</li>
            <li>Click &quot;Stop&quot; when finished</li>
          </ol>
          <p className="mt-4 text-xs sm:text-sm text-[#8b949e]">
            Note: For best results, ensure your audio source is clear and at an appropriate volume level.
            The decoder will automatically detect sync pulses and begin decoding.
          </p>
        </div>
      </details>

      {/* Privacy Information */}
      <details className="bg-[#161b22] border border-[#30363d] rounded-lg">
        <summary className="cursor-pointer p-4 sm:p-6 font-semibold text-lg sm:text-xl hover:bg-[#21262d] rounded-lg transition-colors select-none">
          Privacy
        </summary>
        <div className="px-4 pb-4 sm:px-6 sm:pb-6 space-y-3 text-sm sm:text-base text-[#c9d1d9]">
          <p>
            This application runs entirely in your browser on your local device (client-side).
            No audio data or decoded images are ever transmitted to any server.
          </p>
          <p>
            The microphone permission is only used to capture and process the audio signal in real-time
            for SSTV decoding. All audio processing happens locally on your device using the Web Audio API.
          </p>
          <p className="text-xs sm:text-sm text-[#8b949e]">
            Your privacy is fully protected - we don&apos;t collect, store, or transmit any of your data.
          </p>
        </div>
      </details>
    </div>
  );
}
