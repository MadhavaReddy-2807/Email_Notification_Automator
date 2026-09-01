import React, { useState } from 'react';
import './Maintenance.css';

const Maintenance = ({ onRetry, errorDetails }) => {
  const [isRetrying, setIsRetrying] = useState(false);

  const handleRetry = async () => {
    setIsRetrying(true);
    if (onRetry) {
      await onRetry();
    } else {
      window.location.reload();
    }
    setTimeout(() => setIsRetrying(false), 1200);
  };

  return (
    <div className="maintenance-container">
      <div className="maintenance-card">
        <div className="maintenance-icon-wrapper">
          <div className="maintenance-pulse-ring"></div>
          <svg className="maintenance-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path>
          </svg>
        </div>

        <div className="maintenance-badge">
          <span className="maintenance-dot"></span> System Maintenance & Updates
        </div>

        <h1 className="maintenance-title">We're Working On It!</h1>
        <p className="maintenance-subtitle">
          Our servers are currently undergoing maintenance or temporary updates. We're working hard to get everything back online smoothly.
        </p>

        <div className="maintenance-info-box">
          <div className="maintenance-info-item">
            <span className="info-label">Server Status</span>
            <span className="info-value status-offline">Temporarily Offline</span>
          </div>
          <div className="maintenance-info-item">
            <span className="info-label">Expected Return</span>
            <span className="info-value">Back Very Soon</span>
          </div>
        </div>

        {errorDetails && (
          <details className="maintenance-details">
            <summary>Technical Diagnostics</summary>
            <code>{typeof errorDetails === 'string' ? errorDetails : JSON.stringify(errorDetails, null, 2)}</code>
          </details>
        )}

        <button 
          className={`maintenance-btn ${isRetrying ? 'retrying' : ''}`}
          onClick={handleRetry}
          disabled={isRetrying}
        >
          {isRetrying ? (
            <>
              <svg className="spinner-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" strokeDasharray="30" strokeDashoffset="10"></circle>
              </svg>
              Checking Connection...
            </>
          ) : (
            <>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path>
              </svg>
              Check Again / Retry
            </>
          )}
        </button>
      </div>
    </div>
  );
};

export default Maintenance;
