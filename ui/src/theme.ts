// Shared design system — ported from the Appkium Inspector (Android) renderer
// so the iOS build matches it 1:1. Keep these tokens in sync with
// desktop/src/renderer/utils/styles.ts in the Android repo.
import React from 'react';

export const colors = {
  primary: '#2563eb',
  danger: '#ef4444',
  success: '#22c55e',
  surface: '#0b1221',
  panel: '#0e1726',
  border: '#1f2937',
  cardBlue: '#eef3ff',
  cardGreen: '#eaffef',
  textMain: '#0f172a',
  textSub: '#475569',
};

export const selectionStyle = `
*::selection {
  background: #fbbf24;
  color: #0b1221;
}
*::-moz-selection {
  background: #fbbf24;
  color: #0b1221;
}
`;

export const pressableStyle = {
  transition: 'transform 120ms ease, box-shadow 120ms ease, opacity 120ms ease',
  boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
  outline: 'none',
} as const;

export const pressableHandlers = {
  onMouseDown: (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.transform = 'scale(0.98)';
    e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.24)';
  },
  onMouseUp: (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.transform = 'scale(1)';
    e.currentTarget.style.boxShadow = pressableStyle.boxShadow;
  },
  onMouseLeave: (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.transform = 'scale(1)';
    e.currentTarget.style.boxShadow = pressableStyle.boxShadow;
  },
  onBlur: (e: React.FocusEvent<HTMLButtonElement>) => {
    e.currentTarget.style.transform = 'scale(1)';
    e.currentTarget.style.boxShadow = pressableStyle.boxShadow;
  },
  onFocus: (e: React.FocusEvent<HTMLButtonElement>) => {
    e.currentTarget.style.boxShadow = '0 0 0 3px rgba(37,99,235,0.35)';
  },
};
