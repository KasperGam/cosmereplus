import { ConfluenceAPI } from "../src/ConfluenceAPI";

describe("ConfluenceAPI", () => {
  it("fails", () => {
    expect(new ConfluenceAPI("", "", "")).toBeFalsy();
  });
});