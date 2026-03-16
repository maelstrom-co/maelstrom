import type { CSSProperties } from 'react';

import type { VesselLoadingSkeletonProps } from './types.js';

export function VesselLoadingSkeleton({
  vesselId,
  vesselName,
}: VesselLoadingSkeletonProps) {
  const skeletonStyle: CSSProperties = {
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(128, 128, 128, 0.1)',
    borderRadius: '8px',
    border: '1px solid rgba(128, 128, 128, 0.2)',
    gap: '8px',
  };

  const spinnerStyle: CSSProperties = {
    width: '24px',
    height: '24px',
    opacity: 0.5,
  };

  const textStyle: CSSProperties = {
    fontSize: '12px',
    color: 'rgba(128, 128, 128, 0.7)',
  };

  return (
    <div style={skeletonStyle} data-vessel-loading={vesselId}>
      <svg
        style={spinnerStyle}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        role="img"
        aria-label="Loading"
      >
        <title>Loading</title>
        <circle cx="12" cy="12" r="10" opacity="0.25" />
        <path d="M12 2a10 10 0 0 1 10 10" opacity="0.75">
          <animateTransform
            attributeName="transform"
            type="rotate"
            from="0 12 12"
            to="360 12 12"
            dur="1s"
            repeatCount="indefinite"
          />
        </path>
      </svg>
      <span style={textStyle}>Loading {vesselName || vesselId}...</span>
    </div>
  );
}

export interface VesselLoadErrorProps {
  vesselId: string;
  error: Error;
  retry?: () => void;
}

export function VesselLoadError({
  vesselId,
  error,
  retry,
}: VesselLoadErrorProps) {
  const errorStyle: CSSProperties = {
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: '8px',
    border: '1px solid rgba(239, 68, 68, 0.3)',
    gap: '8px',
    padding: '16px',
  };

  const iconStyle: CSSProperties = {
    fontSize: '24px',
  };

  const messageStyle: CSSProperties = {
    fontSize: '12px',
    color: 'rgba(239, 68, 68, 0.9)',
    textAlign: 'center',
  };

  const buttonStyle: CSSProperties = {
    fontSize: '11px',
    padding: '4px 12px',
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    border: '1px solid rgba(239, 68, 68, 0.4)',
    borderRadius: '4px',
    cursor: 'pointer',
    color: 'inherit',
  };

  return (
    <div style={errorStyle} data-vessel-error={vesselId}>
      <div style={iconStyle}>&#9888;</div>
      <span style={messageStyle}>
        Failed to load {vesselId}
        <br />
        <small>{error.message}</small>
      </span>
      {retry && (
        <button style={buttonStyle} onClick={retry} type="button">
          Retry
        </button>
      )}
    </div>
  );
}
