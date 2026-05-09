import { Component, type ReactNode, type ErrorInfo } from 'react';

interface Props {
  fallback?: ReactNode;
  children?: ReactNode;
}

interface State {
  err: Error | null;
}

/**
 * Catches render-time exceptions in a tab so a single broken renderer
 * doesn't blank the whole window. Without this the Tauri webview shows
 * the body's black bg with no React tree underneath.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { err: null };

  static getDerivedStateFromError(err: Error): State {
    return { err };
  }

  componentDidCatch(err: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', err, info.componentStack);
  }

  render() {
    if (this.state.err) {
      return (
        this.props.fallback ?? (
          <div style={{ padding: 24, color: '#f0f0f0' }}>
            <h2 style={{ marginTop: 0 }}>Something broke</h2>
            <pre
              style={{
                whiteSpace: 'pre-wrap',
                fontSize: 12,
                color: '#ff8888',
                background: '#1a1a1a',
                padding: 12,
                borderRadius: 6,
              }}
            >
              {String(this.state.err.stack || this.state.err.message)}
            </pre>
            <button
              type="button"
              style={{ marginTop: 12 }}
              onClick={() => this.setState({ err: null })}
            >
              Try again
            </button>
          </div>
        )
      );
    }
    return this.props.children;
  }
}
