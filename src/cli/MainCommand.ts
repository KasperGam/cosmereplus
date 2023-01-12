import { Config } from "../types/Config";
import { ConfluenceAPI } from "../api/ConfluenceAPI";
import { updatePage } from "../UpdatePage";
import { FileConfigLoader } from "../FileConfigLoader";
import signale from "signale";

export default async function (configPath: string | null, force: boolean = false, insecure: boolean = false) {
    const config: Config = await FileConfigLoader.load(configPath);
    const confluenceAPI = new ConfluenceAPI(config.baseUrl, config.authorizationToken, insecure);

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
        await updatePage(confluenceAPI, pageData, config, space, force);
    }
}
