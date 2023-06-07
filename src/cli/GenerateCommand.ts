import * as fs from "fs";
import * as path from "path";

export default function (configPath: string | null) {
    fs.writeFileSync(
        configPath || path.join("cosmere.json")!,
        `{
  "baseUrl": "<your base url including /rest/api>",
  "user": "<your username>",
  "pass": "<your password>",
  "spaceKey": "<optional space key>",
  "personalAccessToken": "<your personal access token (can be set instead of username/password)>",
  "cachePath": "build",
  "defaultParentPageId": "2345678 - Optional, will default all pages to this parent if the page does not set its own parent.",
  "prefix": "This document is automatically generated. Please don't edit it directly!",
  "addToc": true,
  "replaceSectionWithTOC": "Contents",
  "pages": [
    {
      "pageId": "1234567890 - if you provide this it means you link it to an existing page by id in confluence. Leave blank to create a new page or search for page by name to update instead.",
      "file": "README.md",
      "parentId": "1244505 - parent page id. Optional. If not provided will be top level page.",
      "parentPage": "Parent title - title of parent page, optional. Can be used where id of parent is unknown.",
      "title": "Title for the page - required. If not unique could cause issues."
    }
  ]
}
`,
    );
}
