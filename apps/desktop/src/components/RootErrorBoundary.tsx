import { Component, type ErrorInfo, type ReactNode } from "react";

type RootErrorBoundaryProps = {
  children: ReactNode;
};

type RootErrorBoundaryState = {
  error: Error | null;
};

export class RootErrorBoundary extends Component<
  RootErrorBoundaryProps,
  RootErrorBoundaryState
> {
  public state: RootErrorBoundaryState = { error: null };

  public static getDerivedStateFromError(error: Error): RootErrorBoundaryState {
    return { error };
  }

  public componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("The desktop interface failed to start", error, info);
  }

  public render(): ReactNode {
    if (this.state.error === null) {
      return this.props.children;
    }

    return (
      <main className="startup-error" role="alert">
        <p className="eyebrow">Startup diagnostic</p>
        <h1>The interface could not start</h1>
        <p>
          yTRSLT hit a frontend error. Reload the window to try again; your
          clips and local settings were not changed.
        </p>
        <pre>{this.state.error.message}</pre>
        <button
          type="button"
          onClick={() => {
            window.location.reload();
          }}
        >
          Reload window
        </button>
      </main>
    );
  }
}
