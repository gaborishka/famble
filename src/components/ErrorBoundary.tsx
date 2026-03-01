import React from 'react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  declare props: Readonly<ErrorBoundaryProps>;
  declare setState: (
    state:
      | Partial<ErrorBoundaryState>
      | ((prevState: ErrorBoundaryState, props: Readonly<ErrorBoundaryProps>) => Partial<ErrorBoundaryState> | null),
    callback?: () => void
  ) => void;
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('UI runtime error:', error);
    console.error('Component stack:', info.componentStack);
  }

  private handleReload = () => {
    this.setState({ hasError: false });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen w-full bg-slate-950 text-white flex items-center justify-center px-4">
          <div className="max-w-md w-full rounded-xl border border-slate-700 bg-slate-900/90 p-6 text-center">
            <h2 className="text-xl font-bold mb-2">Something went wrong</h2>
            <p className="text-slate-300 text-sm mb-4">
              The game hit an unexpected UI error. Reload to continue.
            </p>
            <button
              onClick={this.handleReload}
              className="px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-400 text-slate-950 font-semibold"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
