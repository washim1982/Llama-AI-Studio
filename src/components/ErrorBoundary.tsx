import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error in boundary:', error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: undefined });
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: '30px',
          background: 'var(--panel)',
          borderRadius: '8px',
          border: '1px solid var(--danger)',
          margin: '20px',
          color: 'var(--text-main)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--danger)', marginBottom: '12px' }}>
            <AlertTriangle size={24} />
            <h3 style={{ margin: 0 }}>{this.props.fallbackTitle || 'Component Error'}</h3>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: '16px' }}>
            {this.state.error?.message || 'An unexpected rendering error occurred.'}
          </p>
          <button className="btn btn-secondary" onClick={this.handleReset}>
            <RefreshCw size={14} /> Reload Component
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
