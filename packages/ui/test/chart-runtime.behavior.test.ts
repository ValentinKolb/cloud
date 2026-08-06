import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createComponent, createSignal } from "solid-js";
import { isServer, render } from "solid-js/web";
import { createDomTestHarness } from "./dom";

type ChartComponent = typeof import("../src/content/Chart").default;

const mapSeries = [
  {
    label: "Offices",
    data: [{ latitude: 52.52, longitude: 13.405, label: "Berlin" }],
  },
];

const nextTurn = async () => {
  await Promise.resolve();
};

const captureChartSvg = (dom: ReturnType<typeof createDomTestHarness>) => {
  const prototype = dom.window.Element.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "innerHTML");
  if (!descriptor?.set) throw new Error("happy-dom does not expose the Element.innerHTML setter");
  let value = "";

  Object.defineProperty(prototype, "innerHTML", {
    ...descriptor,
    set(this: Element, next: string) {
      if (this.classList.contains("k2b-chart__svg")) value = next;
      descriptor.set!.call(this, next);
    },
  });

  return {
    read: () => value,
    restore: () => Object.defineProperty(prototype, "innerHTML", descriptor),
  };
};

describe("Chart runtime behavior", () => {
  if (isServer) {
    test.skip("runs in the dedicated browser-conditions test process", () => {});
    return;
  }

  let dom: ReturnType<typeof createDomTestHarness>;
  let renderedSvg: ReturnType<typeof captureChartSvg>;
  let Chart: ChartComponent;

  beforeAll(async () => {
    dom = createDomTestHarness();
    renderedSvg = captureChartSvg(dom);
    Chart = (await import("../src/content/Chart")).default;
  });

  afterAll(() => {
    renderedSvg.restore();
    dom.cleanup();
  });

  test("synchronizes controlled map viewports and resets to the current prop", async () => {
    const [viewport, setViewport] = createSignal({ latitude: 10, longitude: 20, zoom: 1 });

    const dispose = render(
      () =>
        createComponent(Chart, {
          kind: "map",
          series: mapSeries,
          interactive: true,
          get viewport() {
            return viewport();
          },
        }),
      dom.root,
    );
    await nextTurn();

    const landTransform = () => renderedSvg.read().match(/class="stdlib-chart-map-land"[^>]* transform="([^"]+)"/)?.[1];
    const initialTransform = landTransform();

    setViewport({ latitude: 20, longitude: 40, zoom: 2 });
    await nextTurn();
    const controlledTransform = landTransform();
    expect(controlledTransform).toBeTruthy();
    expect(controlledTransform).not.toBe(initialTransform);

    dom.root.querySelector<HTMLButtonElement>('button[aria-label="Zoom in"]')?.click();
    await nextTurn();
    expect(landTransform()).not.toBe(controlledTransform);

    dom.root.querySelector<HTMLButtonElement>('button[aria-label="Reset map view"]')?.click();
    await nextTurn();
    expect(landTransform()).toBe(controlledTransform);

    dispose();
  });

  test("follows a growing timeline until local interaction and resumes after reset", async () => {
    const interval = (from: number, to: number) => ({ from, to, state: "ok" });
    const [rows, setRows] = createSignal([{ label: "Worker", intervals: [interval(0, 10)] }]);

    const dispose = render(
      () =>
        createComponent(Chart, {
          kind: "stateTimeline",
          get rows() {
            return rows();
          },
          interactive: true,
        }),
      dom.root,
    );
    await nextTurn();

    const regions = () => renderedSvg.read().match(/class="stdlib-chart-state-region/g)?.length ?? 0;
    const svg = () => renderedSvg.read();
    expect(regions()).toBe(1);

    setRows([{ label: "Worker", intervals: [interval(0, 10), interval(10, 20)] }]);
    await nextTurn();
    expect(regions()).toBe(2);

    dom.root.querySelector<HTMLButtonElement>('button[aria-label="Zoom in"]')?.click();
    await nextTurn();
    const locallyControlledSvg = svg();

    setRows([{ label: "Worker", intervals: [interval(0, 10), interval(10, 20), interval(20, 40)] }]);
    await nextTurn();
    expect(svg()).toBe(locallyControlledSvg);

    dom.root.querySelector<HTMLButtonElement>('button[aria-label="Reset timeline view"]')?.click();
    await nextTurn();
    expect(regions()).toBe(3);

    setRows([{ label: "Worker", intervals: [interval(0, 10), interval(10, 20), interval(20, 40), interval(40, 80)] }]);
    await nextTurn();
    expect(regions()).toBe(4);

    const tooltipTrigger = dom.document.createElement("button");
    tooltipTrigger.dataset.chartTooltip = "Worker completed";
    dom.root.querySelector(".k2b-chart")?.append(tooltipTrigger);
    tooltipTrigger.dispatchEvent(new dom.window.FocusEvent("focusin", { bubbles: true }) as unknown as FocusEvent);
    await nextTurn();
    const tooltip = dom.root.querySelector<HTMLElement>('[role="tooltip"]');
    if (!tooltip) throw new Error("timeline tooltip was not rendered");
    expect(tooltipTrigger.getAttribute("aria-describedby")).toBe(tooltip.id);
    expect(tooltip?.textContent).toBe("Worker completed");

    tooltipTrigger.dispatchEvent(new dom.window.FocusEvent("focusout", { bubbles: true }) as unknown as FocusEvent);
    await nextTurn();
    expect(tooltipTrigger.hasAttribute("aria-describedby")).toBe(false);

    dispose();
  });

  test("connects active keyboard inspection to a stable tooltip id", async () => {
    const dispose = render(
      () =>
        createComponent(Chart, {
          kind: "line",
          series: [
            {
              label: "Errors",
              data: [
                { x: 1, y: 2 },
                { x: 2, y: 3 },
              ],
            },
          ],
          interactive: true,
        }),
      dom.root,
    );
    await nextTurn();

    const chart = dom.root.querySelector<HTMLElement>('[aria-label="Interactive line chart"]');
    const tooltip = dom.root.querySelector<HTMLElement>('[role="tooltip"]');
    if (!tooltip) throw new Error("line chart tooltip was not rendered");
    expect(tooltip.id).toMatch(/^k2b-chart-tooltip-/);
    expect(chart?.hasAttribute("aria-describedby")).toBe(false);

    chart?.dispatchEvent(new dom.window.FocusEvent("focusin", { bubbles: true }) as unknown as FocusEvent);
    await nextTurn();
    expect(chart?.getAttribute("aria-describedby")).toBe(tooltip.id);
    expect(tooltip?.textContent).toContain("Errors: 3");

    chart?.dispatchEvent(new dom.window.FocusEvent("focusout", { bubbles: true }) as unknown as FocusEvent);
    await nextTurn();
    expect(chart?.hasAttribute("aria-describedby")).toBe(false);

    dispose();
  });
});
