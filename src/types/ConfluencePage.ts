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
    metadata?: {
        properties?: {
            editor?: {
                value?: string;
            }
        }
    }
    ancestors?: { 
        id: string;
        title?: string;
    }[];
    space: ConfluenceSpace;
};