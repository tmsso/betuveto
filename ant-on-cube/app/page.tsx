'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CubeView } from '@/components/CubeView';
import { Direction, moveAnt, START_STATE, VertexId } from '@/lib/cube';
import styles from './page.module.css';

type Slot = {
  value: string;
  pinned: boolean;
};

type AntState = {
  current: VertexId;
  previous: VertexId;
};

const EMPTY_SLOTS: Slot[] = Array.from({ length: 5 }, () => ({ value: '', pinned: false }));

export default function Home() {
  const [antState, setAntState] = useState<AntState>({
    current: START_STATE.current,
    previous: START_STATE.previous
  });
  const [run, setRun] = useState('');
  const [slots, setSlots] = useState<Slot[]>(EMPTY_SLOTS);

  const applyDirection = useCallback((direction: Direction) => {
    setAntState((state) => {
      const { next, from } = moveAnt(state.current, state.previous, direction);
      return { current: next, previous: from };
    });
    setRun((value) => value + direction);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const key = event.key.toUpperCase();
      if (key === 'L' || key === 'R' || key === 'B') {
        event.preventDefault();
        applyDirection(key as Direction);
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [applyDirection]);

  const storeRun = useCallback(() => {
    if (!run) {
      return;
    }

    setSlots((previousSlots) => {
      const unpinnedIndices = previousSlots
        .map((slot, index) => ({ pinned: slot.pinned, index }))
        .filter((item) => !item.pinned)
        .map((item) => item.index);

      if (unpinnedIndices.length === 0) {
        return previousSlots;
      }

      const stack = [run, ...unpinnedIndices.map((index) => previousSlots[index].value)];
      const next = [...previousSlots];

      unpinnedIndices.forEach((slotIndex, idx) => {
        next[slotIndex] = {
          ...next[slotIndex],
          value: stack[idx] ?? ''
        };
      });

      return next;
    });
  }, [run]);

  const reset = () => {
    storeRun();
    setAntState({
      current: START_STATE.current,
      previous: START_STATE.previous
    });
    setRun('');
  };

  const togglePin = (index: number) => {
    setSlots((previousSlots) =>
      previousSlots.map((slot, idx) => (idx === index ? { ...slot, pinned: !slot.pinned } : slot))
    );
  };

  const activePins = useMemo(() => slots.filter((slot) => slot.pinned).length, [slots]);

  return (
    <main className={styles.main}>
      <h1>Ant on Cube</h1>
      <p>Use buttons or keyboard keys L, R, B to steer the ant at each corner.</p>

      <div className={styles.panel}>
        <CubeView current={antState.current} />

        <div className={styles.controls}>
          <button onClick={() => applyDirection('L')}>L — Left</button>
          <button onClick={() => applyDirection('R')}>R — Right</button>
          <button onClick={() => applyDirection('B')}>B — Back</button>
          <button className={styles.reset} onClick={reset}>Reset</button>
        </div>

        <p className={styles.runLabel}>Current run: <strong>{run || '(empty)'}</strong></p>

        <section className={styles.slotsSection}>
          <h2>Saved runs (5 slots, LIFO with pin exclusions)</h2>
          <p>If all 5 slots are pinned, current run is discarded on reset.</p>
          <ul>
            {slots.map((slot, index) => (
              <li key={index}>
                <span className={styles.slotValue}>{slot.value || '— empty —'}</span>
                <button onClick={() => togglePin(index)}>{slot.pinned ? '📌 Unpin' : '📍 Pin'}</button>
              </li>
            ))}
          </ul>
          <p>Pinned slots: {activePins}/5</p>
        </section>
      </div>
    </main>
  );
}
