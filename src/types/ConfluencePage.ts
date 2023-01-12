import { ConfluenceSpace } from "./ConfluenceSpace";

export type ConfluencePage = {
    title: string;
    type: "page";
    body: {
        storage: {
            value: string;
            representation: "storage";
        };
    };
    version?: {
        number: string;
    };
    ancestors?: { 
        id: string;
    }[];
    space: ConfluenceSpace;
};