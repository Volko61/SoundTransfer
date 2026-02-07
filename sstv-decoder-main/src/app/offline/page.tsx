'use client';

export default function OfflinePage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-4 sm:p-6 lg:p-8">
      <div className="max-w-md w-full text-center">
        <div className="mb-6">
          <svg
            className="mx-auto h-16 w-16 text-[#8b949e]"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a4.978 4.978 0 01-1.414-2.83m-1.414 5.658a9 9 0 01-2.167-9.238m7.824 2.167a1 1 0 111.414 1.414m-1.414-1.414L3 3m8.293 8.293l1.414 1.414"
            />
          </svg>
        </div>

        <h1 className="text-3xl font-bold mb-4 text-[#c9d1d9]">
          You&apos;re Offline
        </h1>

        <p className="text-[#8b949e] mb-6">
          No internet connection detected. The SSTV Decoder works offline, but you need to be online at least once to load the app.
        </p>

        <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4 mb-6">
          <h2 className="text-sm font-semibold text-[#c9d1d9] mb-2">
            Once you&apos;re back online:
          </h2>
          <ul className="text-sm text-[#8b949e] text-left space-y-2">
            <li className="flex items-start">
              <svg className="h-5 w-5 text-[#238636] mr-2 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              The app will automatically sync
            </li>
            <li className="flex items-start">
              <svg className="h-5 w-5 text-[#238636] mr-2 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              All features will work normally
            </li>
            <li className="flex items-start">
              <svg className="h-5 w-5 text-[#238636] mr-2 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              Your work will be preserved
            </li>
          </ul>
        </div>

        <button
          onClick={() => window.location.reload()}
          className="w-full bg-[#238636] hover:bg-[#2ea043] text-white font-semibold px-6 py-3 rounded-md transition-colors"
        >
          Try Again
        </button>

        <p className="text-xs text-[#8b949e] mt-4">
          After loading once, this app works completely offline
        </p>
      </div>
    </main>
  );
}
