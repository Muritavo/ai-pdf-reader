/** What a plugin shows when its action is done, on the same window as the answers of the AI */
export type PluginResult = {
    title: string;
    /** What the result is about, as the selected text */
    prompt: string;
    promptLabel: string;
    /** Markdown */
    answer: string;
    answerLabel: string;
    /** The URL of an image drawn faded behind the result, as the structure of a molecule */
    background?: string;
};

/** What an action of the menu gets to work with */
export type PluginActionContext = {
    /** The selected text, without the punctuation around it */
    selection: string;
    showResult: (result: PluginResult) => void;
};

/**
 * An action of the menu of the selection, with the shape of the ones of the app.
 * A failure of `onClick` is left to the button, that offers to try again.
 */
export type PluginMenuOption = {
    id: string;
    label: string;
    testId?: string;
    minWords?: number;
    maxWords?: number;
    /** Only offered when this is true for the selection. Called on every selection, so it must be quick */
    matches?: (selection: string) => boolean;
    onClick: (context: PluginActionContext) => Promise<void>;
};

export type Plugin = {
    id: string;
    /** Prepares what the plugin needs (as a list to match against). The options are only offered after it */
    setup?: () => Promise<void>;
    menuOptions: PluginMenuOption[];
};
