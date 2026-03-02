/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { RunManager } from './components/run/RunManager';
import { Generator } from './components/generator/Generator';
import { DemoRunPicker } from './components/demo/DemoRunPicker';
import { ErrorBoundary } from './components/ErrorBoundary';
import { RunData } from '../shared/types/game';

export default function App() {
  const [runData, setRunData] = useState<RunData | null>(null);
  const isLoadingPreviewRoute =
    typeof window !== 'undefined' &&
    (window.location.pathname === '/loading-preview' || window.location.pathname === '/loading-preview/');

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-slate-950">
        {isLoadingPreviewRoute ? (
          <Generator onGenerated={() => undefined} forceLoadingPreview />
        ) : runData ? (
          <RunManager runData={runData} onReset={() => setRunData(null)} />
        ) : process.env.VITE_DEMO_MODE ? (
          <DemoRunPicker onGenerated={(data) => setRunData(data)} />
        ) : (
          <Generator onGenerated={(data) => setRunData(data)} />
        )}
      </div>
    </ErrorBoundary>
  );
}
