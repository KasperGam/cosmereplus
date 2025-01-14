import * as fs from "fs";
import ConfluenceRenderer from "./ConfluenceRenderer";
import * as path from "path";
import { Config } from "./types/Config";
import { Page } from "./types/Page";
import { ConfluenceAPI } from "./api/ConfluenceAPI";
import signale from "signale";
import { Picture } from "./Picture";
import { marked } from "marked";
import { Attachment } from "./api/Attachment";
import { ConfluencePage } from "./types/ConfluencePage";
import { ConfluenceSpace } from "./types/ConfluenceSpace";
import { extractTitle } from "./utils/MarkdownUtils";

function mkdir(cachePath: string) {
    if (process.version.match(/^v\d\d\./)) {
        fs.mkdirSync(cachePath, { recursive: true });
    } else {
        if (fs.existsSync(path.dirname(cachePath))) {
            fs.mkdirSync(fs.existsSync(path.dirname(cachePath)) ? cachePath : path.dirname(cachePath));
        } else {
            mkdir(path.dirname(cachePath));
            fs.mkdirSync(cachePath);
        }
    }
}

function getCachePath(config: Config) {
    return path.isAbsolute(config.cachePath)
        ? config.cachePath
        : path.resolve(path.dirname(config.configPath!) + "/" + config.cachePath);
}

function removeDynamicIds(s: string): string {
    return s.replace(/ (ac:macro-)?id="[^"]+"/g, "");
}

function isRemoteUpdateRequired(newContent: string, confluencePage: any): boolean {
    const local = removeDynamicIds(newContent).trim().replace(/&#39;/g, "'");
    const remote = removeDynamicIds(confluencePage.body.storage.value).trim();
    return local !== remote;
}

function extractAttachmentsFromPage(pageData: Page, newContent: string): Picture[] {
    return (newContent.match(/<ri:attachment ri:filename="(.+?)" *\/>/g) || [])
        .map((attachment: string) => attachment.replace(/.*"(.+)".*/, "$1"))
        .filter((attachment: string) => !attachment.startsWith("http"))
        .filter((attachment: string) => {
            if (!fs.existsSync(path.resolve(path.dirname(pageData.file), attachment))) {
                signale.error(`Attachment "${attachment}" not found.`);
                return false;
            }
            return true;
        })
        .map((attachment) => {
            const originalAbsolutePath = path.resolve(path.dirname(pageData.file), attachment);
            return {
                originalPath: attachment,
                originalAbsolutePath,
                originalSize: fs.statSync(originalAbsolutePath).size,
                remoteFileName: attachment.replace(/(\.\.|\/)/g, "_"),
            };
        });
}

function convertToWikiFormat(pageData: Page, config: Config) {
    let fileData = fs.readFileSync(pageData.file, { encoding: "utf8" }).replace(/\|[ ]*\|/g, "|&nbsp;|");
    if (!pageData.title) {
        [pageData.title, fileData] = extractTitle(fileData);
    }
    const renderer = config.customRenderer
        ? new config.customRenderer({}, config, pageData)
        : new ConfluenceRenderer({}, config, pageData);

    return marked(fileData, {
        renderer,
        xhtml: true,
    });
}

function mapLocalToRemoteAttachments(attachment: Picture, remoteAttachments: Attachment[]) {
    const remoteAttachment = remoteAttachments.find(
        (remoteAttachment) =>
            remoteAttachment.title === attachment.remoteFileName &&
            remoteAttachment.extensions.fileSize === attachment.originalSize,
    );
    if (remoteAttachment) {
        attachment.remoteAttachmentId = remoteAttachment.id;
    }
    return attachment;
}

async function deleteOutOfDateAttachments(
    attachments: Picture[],
    remoteAttachments: Attachment[],
    confluenceAPI: ConfluenceAPI,
) {
    const upToDateAttachmentIds = attachments.map((attachment) => attachment.remoteAttachmentId);
    const outOfDateAttachments = remoteAttachments.filter(
        (remoteAttachment) => !upToDateAttachmentIds.includes(remoteAttachment.id),
    );
    for (const outOfDateAttachment of outOfDateAttachments) {
        await confluenceAPI.deleteAttachment(outOfDateAttachment);
    }
}

async function updateAttachments(
    mdWikiData: string,
    pageData: Page,
    cachePath: string,
    confluenceAPI: ConfluenceAPI,
    force: boolean,
) {
    const id = pageData.pageId;
    if(!id) { 
        return mdWikiData;
    }
    const remoteAttachments = (await confluenceAPI.getAttachments(id)).results;
    let attachments = extractAttachmentsFromPage(pageData, mdWikiData).map((attachment) =>
        mapLocalToRemoteAttachments(attachment, remoteAttachments),
    );
    if (!attachments) {
        return mdWikiData;
    }

    await deleteOutOfDateAttachments(attachments, remoteAttachments, confluenceAPI);
    for (const attachment of attachments.filter((attachment) => force || !attachment.remoteAttachmentId)) {
        const temporaryAttachmentPath = path.join(cachePath, attachment.remoteFileName);
        fs.copyFileSync(attachment.originalAbsolutePath, temporaryAttachmentPath);

        signale.await(`Uploading attachment "${attachment.remoteFileName}" for "${pageData.title}" ...`);
        try {
            await confluenceAPI.uploadAttachment(temporaryAttachmentPath, id);
        } finally {
            fs.unlinkSync(temporaryAttachmentPath);
        }
    }

    mdWikiData = mdWikiData.replace(/<ri:attachment ri:filename=".+?"/g, (s: string) => s.replace(/(\.\.|\/)/g, "_"));
    return mdWikiData;
}

function increaseVersionNumber(versionNumber: string) {
    return (parseInt(versionNumber, 10) + 1).toString();
}

async function sendPageToConfluence(
    confluencePage: ConfluencePage,
    pageData: Page,
    mdWikiData: string | void | any,
    confluenceAPI: ConfluenceAPI,
    config: Config,
) {
    if(!pageData.title) {
        signale.error(`Error- unable to set title for page at ${pageData.file}.`);
        return;
    }
    confluencePage.title = pageData.title;
    confluencePage.body = {
        storage: {
            value: mdWikiData,
            representation: "storage",
        },
    };

    if(pageData.parentId) {
        confluencePage.ancestors = [
            { id: pageData.parentId },
        ];
    } else if (pageData.parentPage) {
        const existingParentPage = (await confluenceAPI.pageWithName(pageData.parentPage, config.spaceKey)).data;
        if(existingParentPage?.results && existingParentPage.results.length > 0) {
            const parentId = existingParentPage.results[0].id;
            confluencePage.ancestors = [
                { id: parentId },
            ];
        }
    } else {
        if(config.defaultParentPageId) {
            confluencePage.ancestors = [
                { id: config.defaultParentPageId }
            ]
        }
    }

    if(confluencePage.version) {
        confluencePage.version = { number: increaseVersionNumber(confluencePage.version?.number ?? `1`) };
    }

    const editor = confluencePage.metadata?.properties?.editor ?? {};
    confluencePage.metadata = {
        properties: {
            editor: {
                ...editor,
                value: `v2`,
            }
        }
    }

    if(pageData.pageId) {
        signale.await(`Update page "${pageData.title}" ...`);
        await confluenceAPI.updateConfluencePage(pageData.pageId, confluencePage);
    } else {
        signale.await(`Creating page "${pageData.title}" ...`);
        const data = await confluenceAPI.createConfluencePage(confluencePage);
        if(!data) {
            throw new Error(`Creating page failed: ${pageData.title}`);
        }
        return data;
    }
}

function addPrefix(config: Config, mdWikiData: string) {
    return config.prefix
        ? `<ac:structured-macro ac:name="info" ac:schema-version="1"><ac:rich-text-body>
<p>${config.prefix}</p>
</ac:rich-text-body></ac:structured-macro>

${mdWikiData}`
        : mdWikiData;
}

function shouldAddToc(config: Config, pageData: Page): boolean {
    return (pageData.addTOC === undefined)
        ? (config.addTOC === undefined) ? false : config.addTOC
        : pageData.addTOC;
}

function addTOC(config: Config, page: Page, mdWikiData: string) {
    if (!shouldAddToc(config, page)) {
        return mdWikiData;
    }

    const TOC = `<ac:structured-macro ac:name="toc" ac:schema-version="1"></ac:structured-macro>`
    const sectionToReplace = config.replaceSectionWithTOC;

    if(sectionToReplace) {
        signale.info(`Replacing section ${sectionToReplace} with TOC macro`);
        const regex = new RegExp(`(<h[1-6]).*?> *${sectionToReplace} *((.|\\n|\\r)*?)\\1`, `m`);
        return mdWikiData.replace(regex, (match) => {
            const tag = `${match.slice(0, `<h1`.length)}`;
            return `${tag}>${sectionToReplace}${tag.replace(`<`, `</`)}>\n${TOC}\n${tag}`;
        });
    } else {
        signale.info(`Adding TOC macro to page`);
        return `${TOC}\n\n${mdWikiData}`
    }
}

function newBlankPage(space: ConfluenceSpace): ConfluencePage {
    return {
        title: ``,
        type: `page`,
        version: {
            number: `1`
        },
        body: {
            storage: {
                value: ``,
                representation: `storage`,
            }
        },
        space,
        metadata: {
            properties: {
                editor: {
                    value: `v2`
                }
            }
        }
    }
}

async function sendPageUpdate(pageData: Page, config: Config, mdWikiData: string, cachePath: string, confluenceAPI: ConfluenceAPI, force: boolean) {
    if(!pageData.pageId) {
        return;
    }

    mdWikiData = await updateAttachments(mdWikiData, pageData, cachePath, confluenceAPI, force);
    signale.await(`Fetch current page for "${pageData.title}" ...`);
    const pagePathFromConfig = pageData.file.replace(path.dirname(config.configPath) + "/", "");

    const confluencePage = (await confluenceAPI.currentPage(pageData.pageId)).data;
    if (!force && !isRemoteUpdateRequired(mdWikiData, confluencePage)) {
        signale.success(`No change in remote version for "${pagePathFromConfig}" detected, no update necessary`);
        return;
    }
    const tempFile = `${cachePath}/${pageData.pageId}`;

    fs.writeFileSync(tempFile, mdWikiData, "utf-8");
    await sendPageToConfluence(confluencePage, pageData, mdWikiData, confluenceAPI, config);
}

export async function updatePage(confluenceAPI: ConfluenceAPI, pageData: Page, config: Config, space: ConfluenceSpace | null, force: boolean) {
    const pagePathFromConfig = pageData.file.replace(path.dirname(config.configPath) + "/", "");
    signale.start(`Starting to render "${pagePathFromConfig}"`);
    let mdWikiData = convertToWikiFormat(pageData, config);
    mdWikiData = addTOC(config, pageData, mdWikiData);
    mdWikiData = addPrefix(config, mdWikiData);

    const cachePath = getCachePath(config);
    if (!fs.existsSync(cachePath)) {
        mkdir(cachePath);
    }
    const tempFile = `${cachePath}/${pageData.pageId}`;

    let needsContentUpdate = true;
    if (fs.existsSync(tempFile)) {
        const fileContent = fs.readFileSync(tempFile, "utf-8");

        if (fileContent === mdWikiData) {
            needsContentUpdate = false;
        }
    }

    if (!force && !needsContentUpdate) {
        signale.success(`Local cache for "${pagePathFromConfig}" is up to date, no update necessary`);
        return;
    }

    const existingID = pageData.pageId;
    if(existingID) {
        await sendPageUpdate(pageData, config, mdWikiData, cachePath, confluenceAPI, force);
    } else {
        // Try to find page
        if(!pageData.title) {
            signale.error(`Unable to set page title for file at ${pageData.file}.`);
            return;
        }
        try {
            const findPageResponse = (await confluenceAPI.pageWithName(pageData.title, config.spaceKey));
            const data = findPageResponse.data;

            let foundPage = false;
            let foundResults = data.results && data.results.length > 0;

            if(foundResults) {
                if(pageData.parentId || pageData.parentPage) {
                    const filteredResults = data.results.filter((result: ConfluencePage) => 
                        result.ancestors?.find((ancestor) => {
                            if(pageData.parentId) {
                                return ancestor.id === pageData.parentId;
                            } else {
                                return ancestor.title === pageData.parentPage;
                            }
                        }
                        ) !== undefined
                    );
                    foundPage = filteredResults.length > 0;
                    pageData.pageId = filteredResults[0].id;
                } else {
                    foundPage = true;
                    pageData.pageId = data.results[0].id;
                }
            }

            if(foundPage) {
                await sendPageUpdate(pageData, config, mdWikiData, cachePath, confluenceAPI, force);
            } else {
                // Not found, creating page
                signale.await(`Could not find page ${pageData.title} on Confluence. Creating new page...`);
                if (!space) {
                    signale.error(`No space specified in config. Aborting creating new page...`);
                    return;
                } else {
                    const newConfluencePage = newBlankPage(space);
                    const postedPageData = await sendPageToConfluence(newConfluencePage, pageData, mdWikiData, confluenceAPI, config);
                    if(postedPageData && postedPageData.id) {
                        pageData.pageId = postedPageData.id;
                        await sendPageUpdate(pageData, config, mdWikiData, cachePath, confluenceAPI, force);
                    }
                }
            }
        } catch(e: any) {
            signale.await(`Could not find page ${pageData.title} on Confluence. Creating new page...`);
            if (!space) {
                signale.error(`No space specified in config. Aborting creating new page...`);
                return;
            } else {
                const newConfluencePage = newBlankPage(space);
                const postedPageData = await sendPageToConfluence(newConfluencePage, pageData, mdWikiData, confluenceAPI, config);
                if(postedPageData && postedPageData.id) {
                    pageData.pageId = postedPageData.id;
                    await sendPageUpdate(pageData, config, mdWikiData, cachePath, confluenceAPI, force);
                }
            }
        }
    }

    if(!pageData.pageId) {
        signale.error(`There was an error uploading or syncing new page to confluence: ${pageData.title}`);
        return;
    }

    const confluencePage = (await confluenceAPI.currentPage(pageData.pageId)).data;

    const confluenceUrl = config.baseUrl.replace("rest/api", "").replace(/\/$/, "");
    signale.success(
        `"${confluencePage.title}" saved in confluence (${confluenceUrl}/pages/viewpage.action?pageId=${pageData.pageId}).`,
    );
}
