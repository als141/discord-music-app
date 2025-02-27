import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null
    };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      errorInfo: null
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // We can log the error to an error reporting service here
    console.error('Uncaught error:', error, errorInfo);
    this.setState({
      error,
      errorInfo
    });
  }

  handleReset = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null
    });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
          <div className="max-w-md w-full bg-card rounded-lg shadow-lg p-6 text-center">
            <AlertCircle className="w-16 h-16 text-destructive mx-auto mb-4" aria-hidden="true" />
            <h1 className="text-2xl font-bold mb-4">エラーが発生しました</h1>
            <p className="text-muted-foreground mb-6">
              アプリケーションの実行中にエラーが発生しました。
              <br />
              再読み込みして問題が解決するかお試しください。
            </p>
            <div className="space-y-2">
              <Button
                onClick={() => window.location.reload()}
                className="w-full"
                variant="default"
              >
                <RefreshCw className="w-4 h-4 mr-2" aria-hidden="true" />
                ページを再読み込み
              </Button>
              <Button
                onClick={this.handleReset}
                className="w-full"
                variant="outline"
              >
                エラーをクリアして再試行
              </Button>
            </div>
            
            {process.env.NODE_ENV === 'development' && this.state.error && (
              <div className="mt-6 text-left">
                <details className="bg-muted p-4 rounded-md">
                  <summary className="font-medium cursor-pointer">エラー詳細 (開発者向け)</summary>
                  <div className="mt-2 overflow-x-auto">
                    <p className="text-destructive">{this.state.error.toString()}</p>
                    {this.state.errorInfo && (
                      <pre className="mt-2 text-xs bg-slate-950 text-slate-200 p-3 rounded overflow-auto">
                        {this.state.errorInfo.componentStack}
                      </pre>
                    )}
                  </div>
                </details>
              </div>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;