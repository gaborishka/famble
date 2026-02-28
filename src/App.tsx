/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { RunManager } from './components/run/RunManager';
import { Generator } from './components/generator/Generator';
import { RunData } from '../shared/types/game';

export default function App() {
  const [runData, setRunData] = useState<RunData | null>(null);

  return (
    <div className="min-h-screen bg-slate-950">
      {runData ? (
        <RunManager runData={runData} onReset={() => setRunData(null)} />
      ) : (
        <Generator onGenerated={(data) => setRunData(data)} />
      )}
    </div>
  );
}
