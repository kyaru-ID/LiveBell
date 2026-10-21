import { describe, expect, it } from "vitest";
import { bilibiliRoomUrl, roomIdFromInput } from "./roomId";

describe("roomIdFromInput", () => {
  it("accepts a plain room id", () => {
    expect(roomIdFromInput("22625025")).toBe("22625025");
    expect(roomIdFromInput("  22625025  ")).toBe("22625025");
  });

  it("extracts the room id from a live url", () => {
    expect(roomIdFromInput("https://live.bilibili.com/22625025")).toBe("22625025");
    expect(roomIdFromInput("live.bilibili.com/22625025?visit_id=abc")).toBe(
      "22625025",
    );
    expect(roomIdFromInput("https://live.bilibili.com/blanc/33989")).toBe("33989");
  });

  it("rejects inputs without a usable room id", () => {
    expect(roomIdFromInput("")).toBeNull();
    expect(roomIdFromInput("abc")).toBeNull();
    expect(roomIdFromInput("0")).toBeNull();
    expect(roomIdFromInput("-12")).toBeNull();
    expect(
      roomIdFromInput("https://live.bilibili.com/blackboard/activity-xxx.html?id=123"),
    ).toBeNull();
  });
});

describe("bilibiliRoomUrl", () => {
  it("builds the live room url", () => {
    expect(bilibiliRoomUrl(22625025)).toBe("https://live.bilibili.com/22625025");
    expect(bilibiliRoomUrl("22625025")).toBe("https://live.bilibili.com/22625025");
  });
});
