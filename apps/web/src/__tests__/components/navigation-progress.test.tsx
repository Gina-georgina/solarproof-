import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import React from "react";

// Mock next/navigation so we can drive pathname/searchParams changes manually.
const mockNavigationState = {
  pathname: "/",
  searchParams: new URLSearchParams(),
};

vi.mock("next/navigation", () => {
  return {
    usePathname: () => mockNavigationState.pathname,
    useSearchParams: () => mockNavigationState.searchParams,
  };
});

// Helper to control matchMedia (for prefers-reduced-motion).
let reducedMotion = false;
let matchMediaListeners: Array<(e: MediaQueryListEvent) => void> = [];

function setupMatchMedia() {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => {
      const matches =
        query.includes("prefers-reduced-motion") && reducedMotion;
      return {
        matches,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(
          (_event: string, cb: (e: MediaQueryListEvent) => void) => {
            matchMediaListeners.push(cb);
          },
        ),
        removeEventListener: vi.fn(
          (_event: string, cb: (e: MediaQueryListEvent) => void) => {
            matchMediaListeners = matchMediaListeners.filter((l) => l !== cb);
          },
        ),
        dispatchEvent: vi.fn(),
      };
    }),
  });
}

// Import after mocks are registered.
import { NavigationProgress } from "@/components/navigation-progress";

function setPathname(pathname: string, search = "") {
  mockNavigationState.pathname = pathname;
  mockNavigationState.searchParams = new URLSearchParams(search);
}

describe("NavigationProgress", () => {
  beforeEach(() => {
    reducedMotion = false;
    matchMediaListeners = [];
    setPathname("/");
    setupMatchMedia();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("renders without an active progress bar on initial mount", () => {
    render(<NavigationProgress />);
    const bar = screen.queryByTestId("navigation-progress-bar");
    // Either not rendered or not in the active/visible state.
    if (bar) {
      expect(bar).toHaveAttribute("data-state", "idle");
    } else {
      expect(bar).toBeNull();
    }
  });

  it("shows the progress bar when the pathname changes", async () => {
    const { rerender } = render(<NavigationProgress />);

    // Simulate a route transition by changing the mocked pathname.
    act(() => {
      setPathname("/dashboard");
    });
    rerender(<NavigationProgress />);

    const bar = await screen.findByTestId("navigation-progress-bar");
    expect(bar).toBeInTheDocument();
    expect(bar).toHaveAttribute("data-state", "loading");
  });

  it("shows the progress bar when only the search params change", async () => {
    const { rerender } = render(<NavigationProgress />);

    act(() => {
      setPathname("/", "?page=2");
    });
    rerender(<NavigationProgress />);

    const bar = await screen.findByTestId("navigation-progress-bar");
    expect(bar).toBeInTheDocument();
    expect(bar).toHaveAttribute("data-state", "loading");
  });

  it("completes and hides the progress bar once the route settles", async () => {
    const { rerender } = render(<NavigationProgress />);

    act(() => {
      setPathname("/dashboard");
    });
    rerender(<NavigationProgress />);

    const bar = await screen.findByTestId("navigation-progress-bar");
    expect(bar).toHaveAttribute("data-state", "loading");

    // Advance timers so the settle/complete animation runs.
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    await waitFor(() => {
      const settled = screen.queryByTestId("navigation-progress-bar");
      // After settling, the bar should either be removed or marked complete/idle.
      if (settled) {
        expect(["complete", "idle"]).toContain(
          settled.getAttribute("data-state"),
        );
      } else {
        expect(settled).toBeNull();
      }
    });
  });

  it("does not show the progress bar for non-navigation state changes", async () => {
    const { rerender } = render(<NavigationProgress />);

    // Re-render without changing pathname or search params (e.g. a client-side
    // state update). No navigation occurred, so no bar should appear.
    rerender(<NavigationProgress />);

    act(() => {
      vi.advanceTimersByTime(500);
    });

    const bar = screen.queryByTestId("navigation-progress-bar");
    if (bar) {
      expect(bar).toHaveAttribute("data-state", "idle");
    } else {
      expect(bar).toBeNull();
    }
  });

  it("respects prefers-reduced-motion by rendering a static indicator without transition", async () => {
    reducedMotion = true;
    setupMatchMedia();

    const { rerender } = render(<NavigationProgress />);

    act(() => {
      setPathname("/dashboard");
    });
    rerender(<NavigationProgress />);

    const bar = await screen.findByTestId("navigation-progress-bar");
    expect(bar).toBeInTheDocument();
    // Reduced motion: no animated transition should be applied.
    expect(bar).toHaveAttribute("data-reduced-motion", "true");
    const style = bar.getAttribute("style") ?? "";
    expect(style).not.toMatch(/transition/i);
  });

  it("uses the brand accent color for the progress bar", async () => {
    const { rerender } = render(<NavigationProgress />);

    act(() => {
      setPathname("/dashboard");
    });
    rerender(<NavigationProgress />);

    const bar = await screen.findByTestId("navigation-progress-bar");
    expect(bar).toBeInTheDocument();
    // The bar should reference the brand accent color via class or style.
    const className = bar.getAttribute("class") ?? "";
    const style = bar.getAttribute("style") ?? "";
    expect(`${className} ${style}`).toMatch(/accent|brand/i);
  });
});