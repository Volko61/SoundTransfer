'use client';

import { useState } from 'react';
import Fab from '@mui/material/Fab';
import SettingsIcon from '@mui/icons-material/Settings';

export type SSTVMode = 'ROBOT36' | 'ROBOT72' | 'SCOTTIE_S1' | 'SCOTTIE_S2' | 'PD120' | 'PD160' | 'PD180';

interface SettingsPanelProps {
  currentMode: SSTVMode;
  onModeChange: (mode: SSTVMode) => void;
  disabled?: boolean;
}

export default function SettingsPanel({ currentMode, onModeChange, disabled = false }: SettingsPanelProps) {
  const [isOpen, setIsOpen] = useState(false);

  const modes: { id: SSTVMode; name: string; description: string }[] = [
    {
      id: 'ROBOT36',
      name: 'Robot 36',
      description: '320×240 • Fast mode (150ms/line) • Interlaced YUV',
    },
    {
      id: 'ROBOT72',
      name: 'Robot 72',
      description: '320×240 • Better color (300ms/line) • Sequential YUV',
    },
    {
      id: 'SCOTTIE_S1',
      name: 'Scottie S1',
      description: '320×256 • HF classic (428ms/line) • RGB sequential',
    },
    {
      id: 'SCOTTIE_S2',
      name: 'Scottie S2',
      description: '320×256 • Faster HF (278ms/line) • RGB sequential',
    },
    {
      id: 'PD120',
      name: 'PD 120',
      description: '640×496 • High resolution (508ms/line) • Dual-luminance',
    },
    {
      id: 'PD160',
      name: 'PD 160',
      description: '512×400 • Balanced mode (804ms/line) • Dual-luminance',
    },
    {
      id: 'PD180',
      name: 'PD 180',
      description: '640×496 • Highest quality (752ms/line) • Dual-luminance',
    },
  ];

  return (
    <>
      {/* MUI Floating Action Button - bottom right */}
      <Fab
        color="primary"
        aria-label="settings"
        onClick={() => setIsOpen(true)}
        disabled={disabled}
        sx={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          zIndex: 40,
          backgroundColor: '#238636',
          '&:hover': {
            backgroundColor: '#2ea043',
          },
          '&.Mui-disabled': {
            backgroundColor: '#161b22',
            opacity: 0.5,
          },
        }}
      >
        <SettingsIcon />
      </Fab>

      {/* Modal overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
          onClick={() => setIsOpen(false)}
        >
          {/* Modal content */}
          <div
            className="bg-[#161b22] border border-[#30363d] rounded-lg max-w-lg w-full shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between p-4 sm:p-6 border-b border-[#30363d]">
              <h2 className="text-xl sm:text-2xl font-semibold text-[#c9d1d9]">Settings</h2>
              <button
                onClick={() => setIsOpen(false)}
                className="text-[#8b949e] hover:text-[#c9d1d9] transition-colors"
                aria-label="Close"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-6 w-6"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Body - scrollable */}
            <div className="p-4 sm:p-6 space-y-4 max-h-[60vh] overflow-y-auto">
              <div>
                <h3 className="text-sm font-semibold text-[#8b949e] uppercase tracking-wide mb-3">
                  SSTV Mode
                </h3>
                <div className="space-y-2">
                  {modes.map((mode) => (
                    <button
                      key={mode.id}
                      onClick={() => {
                        onModeChange(mode.id);
                        setIsOpen(false);
                      }}
                      className={`w-full text-left p-4 rounded-lg border-2 transition-all ${
                        currentMode === mode.id
                          ? 'border-[#238636] bg-[#238636]/10'
                          : 'border-[#30363d] bg-[#0d1117] hover:border-[#8b949e]'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="font-semibold text-[#c9d1d9] mb-1">{mode.name}</div>
                          <div className="text-sm text-[#8b949e]">{mode.description}</div>
                        </div>
                        {currentMode === mode.id && (
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            className="h-5 w-5 text-[#238636] flex-shrink-0 mt-0.5"
                            viewBox="0 0 20 20"
                            fill="currentColor"
                          >
                            <path
                              fillRule="evenodd"
                              d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                              clipRule="evenodd"
                            />
                          </svg>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Info box */}
              <div className="bg-[#0d1117] border border-[#30363d] rounded-lg p-4">
                <div className="flex gap-3">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-5 w-5 text-[#58a6ff] flex-shrink-0 mt-0.5"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <path
                      fillRule="evenodd"
                      d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                      clipRule="evenodd"
                    />
                  </svg>
                  <div className="text-sm text-[#8b949e]">
                    <p>
                      <strong className="text-[#c9d1d9]">Note:</strong> Changing modes will reset the
                      current decoding session. Make sure to save your image before switching.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 sm:p-6 border-t border-[#30363d] flex justify-end">
              <button
                onClick={() => setIsOpen(false)}
                className="bg-[#238636] hover:bg-[#2ea043] text-white font-semibold px-4 py-2 rounded-md transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
