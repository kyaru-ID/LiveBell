import { describe, expect, it } from "vitest";
import { formatLiveDuration } from "./liveDuration";

const BASE = Date.parse("2026-10-21T20:00:00.000+08:00");
const minute = 60_000;

describe("formatLiveDuration", () => {
  it("不足一分钟显示「小于 1 分钟」", () => {
    expect(formatLiveDuration("2026-10-21T20:00:00.000+08:00", BASE + 30_000)).toBe(
      "小于 1 分钟",
    );
  });

  it("不足一小时显示分钟", () => {
    expect(formatLiveDuration("2026-10-21T20:00:00.000+08:00", BASE + 23 * minute)).toBe(
      "23 分钟",
    );
  });

  it("超过一小时显示小时和分钟", () => {
    expect(
      formatLiveDuration("2026-10-21T20:00:00.000+08:00", BASE + (60 + 23) * minute),
    ).toBe("1 小时 23 分");
  });

  it("整点小时不带分钟", () => {
    expect(formatLiveDuration("2026-10-21T20:00:00.000+08:00", BASE + 120 * minute)).toBe(
      "2 小时",
    );
  });

  it("超过一天只显示天和小时", () => {
    expect(
      formatLiveDuration(
        "2026-10-21T20:00:00.000+08:00",
        BASE + (24 * 60 + 3 * 60 + 20) * minute,
      ),
    ).toBe("1 天 3 小时");
  });

  it("整天的显示", () => {
    expect(formatLiveDuration("2026-10-21T20:00:00.000+08:00", BASE + 48 * 60 * minute)).toBe(
      "2 天",
    );
  });

  it("没有开始时间或时间非法时返回 null", () => {
    expect(formatLiveDuration(undefined)).toBeNull();
    expect(formatLiveDuration("")).toBeNull();
    expect(formatLiveDuration("not-a-time")).toBeNull();
  });

  it("时间在未来（时钟回拨）时按刚开始处理", () => {
    expect(formatLiveDuration("2026-10-21T20:00:00.000+08:00", BASE - minute)).toBe(
      "小于 1 分钟",
    );
  });
});
