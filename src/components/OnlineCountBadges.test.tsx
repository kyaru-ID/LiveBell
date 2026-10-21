import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import {
  MAX_VISIBLE_ONLINE_ROOMS,
  OnlineCountBadges,
  buildOnlineBadges,
  type OnlineCountEntry,
} from "./OnlineCountBadges";
import type {
  RoomSessionSnapshot,
  RoomSessionStatus,
} from "../types/roomSession";

function session(
  sessionId: string,
  roomId: number,
  anchorName?: string,
  status: RoomSessionStatus = "connected",
): RoomSessionSnapshot {
  return {
    sessionId,
    requestedRoomId: roomId,
    roomId,
    anchorName,
    status,
    message: "connected",
  };
}

function online(entries: [string, number][]): Map<string, OnlineCountEntry> {
  return new Map(
    entries.map(([sessionId, online]) => [sessionId, { roomId: 0, online }]),
  );
}

test("keeps the legacy single-room badge when only one room is connected", () => {
  const badges = buildOnlineBadges(
    [session("s1", 6, "四时小路")],
    online([["s1", 12000]]),
    new Map([["s1", 0]]),
  );

  render(<OnlineCountBadges badges={badges} />);

  expect(screen.getByLabelText("同接数").textContent).toBe("同接 12,000");
});

test("sums every room and lists each room with its source color", () => {
  const badges = buildOnlineBadges(
    [session("s1", 6, "四时小路"), session("s2", 7, "小松绿")],
    online([
      ["s1", 12000],
      ["s2", 8432],
    ]),
    new Map([
      ["s1", 1],
      ["s2", 2],
    ]),
  );

  render(<OnlineCountBadges badges={badges} />);

  const region = screen.getByLabelText("同接数");
  expect(region.textContent).toBe("同接 20,432四时小路 12,000小松绿 8,432");
  const dots = region.querySelectorAll(".danmaku-online-dot");
  expect(Array.from(dots).map((dot) => dot.getAttribute("data-source-color"))).toEqual([
    "1",
    "2",
  ]);
});

test("falls back to the room id when the anchor name is unknown", () => {
  const badges = buildOnlineBadges(
    [session("s1", 6), session("s2", 7, "   ")],
    online([
      ["s1", 10],
      ["s2", 20],
    ]),
    new Map(),
  );

  render(<OnlineCountBadges badges={badges} />);

  expect(screen.getByLabelText("同接数").textContent).toBe(
    "同接 30房间 6 10房间 7 20",
  );
});

test("folds rooms beyond the visible limit into +N", () => {
  const sessions = Array.from({ length: MAX_VISIBLE_ONLINE_ROOMS + 2 }, (_, index) =>
    session(`s${index}`, index + 1, `房间${index}`),
  );
  const badges = buildOnlineBadges(
    sessions,
    online(sessions.map((item, index) => [item.sessionId, (index + 1) * 100])),
    new Map(),
  );

  render(<OnlineCountBadges badges={badges} />);

  const region = screen.getByLabelText("同接数");
  expect(region.textContent).toContain("+2");
  expect(region.querySelectorAll(".danmaku-online-badge")).toHaveLength(
    MAX_VISIBLE_ONLINE_ROOMS + 2,
  );
});

test("ignores rooms that are not sending danmaku", () => {
  const badges = buildOnlineBadges(
    [
      session("s1", 6, "四时小路"),
      session("s2", 7, "小松绿", "disconnected"),
      session("s3", 8, "羽啾", "reconnecting"),
    ],
    online([
      ["s1", 100],
      ["s2", 200],
      ["s3", 300],
    ]),
    new Map(),
  );

  expect(badges.map((badge) => badge.sessionId)).toEqual(["s1", "s3"]);
});

test("keeps a placeholder for a connected room before the first count arrives", () => {
  const badges = buildOnlineBadges(
    [session("s1", 6, "四时小路")],
    new Map(),
    new Map(),
  );

  expect(badges).toHaveLength(1);
  expect(badges[0].online).toBeNull();

  render(<OnlineCountBadges badges={badges} />);

  expect(screen.getByLabelText("同接数").textContent).toBe("同接 --");
});

test("shows a placeholder total until every room has reported a count", () => {
  const badges = buildOnlineBadges(
    [session("s1", 6, "四时小路"), session("s2", 7, "小松绿")],
    online([["s1", 12000]]),
    new Map(),
  );

  render(<OnlineCountBadges badges={badges} />);

  expect(screen.getByLabelText("同接数").textContent).toBe(
    "同接 --四时小路 12,000小松绿 --",
  );
});
