import { Config } from "../types/Config";
import { ObjectConfigLoader } from "../ObjectConfigLoader";
import { ConfluenceAPI } from "../api/ConfluenceAPI";
import { updatePage } from "../UpdatePage";
import { ObjectConfig } from "../types/ObjectConfig";
import signale from "signale";

const DEFAULTS = {
    insecure: false,
    force: false,
    fileRoot: process.cwd(),
};

export default async function (configOptions: ObjectConfig) {
    const config: Config = await ObjectConfigLoader.load(Object.assign({}, DEFAULTS, configOptions));
    const confluenceAPI = new ConfluenceAPI(config.baseUrl, config.authorizationToken, configOptions.insecure);

    let space = null;
    if(config.spaceKey) {
        try {
            const spaceResponse = (await confluenceAPI.getConfluenceSpace(config.spaceKey)).data;
            space = spaceResponse;
        } catch (e: any) {
            signale.await(`Could not find space in confluence with key ${config.spaceKey}. Aborting...`);
            return;
        }
    }

    for (const pageData of config.pages) {
        await updatePage(confluenceAPI, pageData, config, space, configOptions.force);
    }
}
