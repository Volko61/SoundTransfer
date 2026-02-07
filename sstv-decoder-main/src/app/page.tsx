'use client';

import { useState } from 'react';
import SSTVDecoder from "@/components/SSTVDecoder";

export type SSTVMode = 'ROBOT36' | 'ROBOT72' | 'SCOTTIE_S1' | 'SCOTTIE_S2' | 'PD120' | 'PD160' | 'PD180';

export default function Home() {
  const [selectedMode, setSelectedMode] = useState<SSTVMode>('ROBOT36');

  // Get mode display info
  const getModeInfo = () => {
    switch (selectedMode) {
      case 'ROBOT36':
        return { name: 'Robot36 Mode', resolution: '320×240 px' };
      case 'ROBOT72':
        return { name: 'Robot72 Mode', resolution: '320×240 px' };
      case 'SCOTTIE_S1':
        return { name: 'Scottie S1 Mode', resolution: '320×256 px' };
      case 'SCOTTIE_S2':
        return { name: 'Scottie S2 Mode', resolution: '320×256 px' };
      case 'PD120':
        return { name: 'PD120 Mode', resolution: '640×496 px' };
      case 'PD160':
        return { name: 'PD160 Mode', resolution: '512×400 px' };
      case 'PD180':
        return { name: 'PD180 Mode', resolution: '640×496 px' };
      default:
        return { name: 'Robot36 Mode', resolution: '320×240 px' };
    }
  };

  const modeInfo = getModeInfo();
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    "name": "SSTV Decoder",
    "description": "Free web-based SSTV (Slow Scan Television) decoder supporting Robot36 mode. Decode amateur radio SSTV signals in real-time from your microphone.",
    "url": "https://sstv-decoder.vercel.app",
    "applicationCategory": "MultimediaApplication",
    "operatingSystem": "Any (Web Browser)",
    "browserRequirements": "Requires JavaScript, Web Audio API",
    "offers": {
      "@type": "Offer",
      "price": "0",
      "priceCurrency": "USD"
    },
    "creator": {
      "@type": "Person",
      "name": "smolgroot",
      "url": "https://github.com/smolgroot"
    },
    "sourceOrganization": {
      "@type": "Organization",
      "name": "smolgroot",
      "url": "https://github.com/smolgroot"
    },
    "screenshot": "https://sstv-decoder.vercel.app/og-image.png",
    "featureList": [
      "Real-time SSTV decoding",
      "Robot36 mode support",
      "Microphone input",
      "Progressive image rendering",
      "Spectrum analyzer",
      "Signal strength meter",
      "Image export (PNG)",
      "Works on desktop and mobile"
    ],
    "keywords": "SSTV, Slow Scan Television, Robot36, Amateur Radio, Ham Radio, ISS, Signal Decoder"
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <main className="min-h-screen p-4 sm:p-6 lg:p-8">
      <div className="max-w-6xl mx-auto">
        <div className="mb-6 sm:mb-8">
          <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold mb-2 text-[#c9d1d9]">
            SSTV Decoder
          </h1>
          <p className="text-sm sm:text-base text-[#8b949e] mb-3">
            Real-time Slow Scan Television signal decoder from microphone
          </p>
          <div className="flex flex-wrap gap-2">
            <a
              href="https://github.com/smolgroot/sstv-decoder"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md bg-[#238636]/10 text-[#2ea043] border border-[#238636]/30 hover:bg-[#238636]/20 hover:border-[#238636]/50 transition-colors"
            >
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 16 16">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
              </svg>
              Source Code
            </a>
            <span className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md bg-[#238636]/10 text-[#2ea043] border border-[#238636]/30">
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 16 16">
                <path d="M2.75 3.75a.75.75 0 000 1.5h10.5a.75.75 0 000-1.5H2.75zM2 7.75A.75.75 0 012.75 7h10.5a.75.75 0 010 1.5H2.75A.75.75 0 012 7.75zm0 4a.75.75 0 01.75-.75h10.5a.75.75 0 010 1.5H2.75a.75.75 0 01-.75-.75z"/>
              </svg>
              {modeInfo.name}
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md bg-[#238636]/10 text-[#2ea043] border border-[#238636]/30">
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 16 16">
                <path d="M0 2.5A1.5 1.5 0 011.5 1h13A1.5 1.5 0 0116 2.5v11a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 010 13.5v-11zM1.5 2a.5.5 0 00-.5.5v11a.5.5 0 00.5.5h13a.5.5 0 00.5-.5v-11a.5.5 0 00-.5-.5h-13z"/>
                <path d="M3 5.5a.5.5 0 01.5-.5h9a.5.5 0 010 1h-9a.5.5 0 01-.5-.5zm0 3a.5.5 0 01.5-.5h9a.5.5 0 010 1h-9a.5.5 0 01-.5-.5zm.5 2.5a.5.5 0 000 1h9a.5.5 0 000-1h-9z"/>
              </svg>
              {modeInfo.resolution}
            </span>
          </div>
        </div>
        <SSTVDecoder selectedMode={selectedMode} onModeChange={setSelectedMode} />
      </div>
    </main>
    </>
  );
}
