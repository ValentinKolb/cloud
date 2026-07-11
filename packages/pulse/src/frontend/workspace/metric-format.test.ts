import { describe, expect, test } from "bun:test";
import { compactMetricUnit, formatMetricValue, formatSignalValue, formatValue, gaugeMax } from "./metric-format";

describe("Pulse metric formatting", () => {
  test("formats raw numbers without noisy precision", () => {
    expect(formatValue(null)).toBe("n/a");
    expect(formatValue(Number.NaN)).toBe("n/a");
    expect(formatValue(0)).toBe("0");
    expect(formatValue(0.01234)).toBe("0.012");
    expect(formatValue(9.876)).toBe("9.88");
    expect(formatValue(99.99)).toBe("100");
    expect(formatValue(1_234_567)).toBe("1.23e+6");
  });

  test("formats common metric units for dashboards", () => {
    expect(formatMetricValue(100, "percent")).toBe("100%");
    expect(formatMetricValue(61.29, "percentage")).toBe("61.29%");
    expect(formatMetricValue(10, "count")).toBe("10");
    expect(formatMetricValue(1_536, "bytes")).toBe("1.5 KiB");
    expect(formatMetricValue(411_210, "seconds")).toBe("4d 18h");
    expect(formatMetricValue(1_500, "milliseconds")).toBe("1.5s");
  });

  test("compacts units for chart axes", () => {
    expect(compactMetricUnit("percent")).toBe("%");
    expect(compactMetricUnit("percentage")).toBe("%");
    expect(compactMetricUnit("bytes")).toBe("B");
    expect(compactMetricUnit("byte")).toBe("B");
    expect(compactMetricUnit("seconds")).toBe("s");
    expect(compactMetricUnit("sec")).toBe("s");
    expect(compactMetricUnit("ms")).toBe("ms");
    expect(compactMetricUnit("count")).toBeUndefined();
    expect(compactMetricUnit("counts")).toBeUndefined();
    expect(compactMetricUnit("custom")).toBe("custom");
  });

  test("formats signal values consistently", () => {
    expect(formatSignalValue(null)).toBe("null");
    expect(formatSignalValue(true)).toBe("true");
    expect(formatSignalValue("ready")).toBe("ready");
    expect(formatSignalValue({ ok: true })).toBe('{"ok":true}');
  });

  test("chooses gauge maxima from units and magnitude", () => {
    expect(gaugeMax("percent", 61)).toBe(100);
    expect(gaugeMax("count", 0.2)).toBe(1);
    expect(gaugeMax("bytes", 1536)).toBe(2000);
  });
});
