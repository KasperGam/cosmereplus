import { ConfluenceAPI } from "../../src/api/ConfluenceAPI";
import axios from "axios";
import { mocked } from "ts-jest/utils";
import { Agent } from "https";

jest.mock("axios");
const axiosMock = mocked(axios, true);

describe("ConfluenceAPI", () => {
    it("fetches current version of confluence page", async () => {
        axiosMock.get.mockResolvedValue({ data: "Test" });

        const confluenceAPI = new ConfluenceAPI("", "Bearer unbearable", false);
        await confluenceAPI.currentPage("2");
        expect(axiosMock.get).toHaveBeenCalledWith("/content/2?expand=body.storage,version", {
            headers: {
                Authorization: "Bearer unbearable",
                "Content-Type": "application/json",
            },
            httpsAgent: expect.any(Agent),
        });
    });
});
