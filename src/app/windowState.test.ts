import { describe, expect, it } from "vitest";
import { parseBounds } from "./windowState";

describe("window bounds", () => {
  it("accepts valid saved bounds and ignores junk", () => {
    expect(parseBounds('{"x":10,"y":20,"width":1200,"height":800}')).toEqual({ x: 10, y: 20, width: 1200, height: 800 });
    expect(parseBounds(undefined)).toBeNull();
    expect(parseBounds("nope")).toBeNull();
    expect(parseBounds('{"x":1,"y":2,"width":100,"height":800}')).toBeNull();
    expect(parseBounds('{"x":"1","y":2,"width":1000,"height":800}')).toBeNull();
  });
});
