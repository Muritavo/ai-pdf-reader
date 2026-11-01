import type { ComponentType, ReactNode } from 'react';

/** What a plugin shows when its action is done, on the same window as the answers of the AI */
export type PluginResult = {
    title: string;
    /** What the result is about, as the selected text */
    prompt: string;
    promptLabel: string;
    /** Markdown */
    answer: string;
    answerLabel: string;
    /** Shown instead of the answer, for a result that can be interacted with */
    view?: ReactNode;
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
    /** A function is called every time the menu opens, for a label that changes (as with a count) */
    label: string | (() => ReactNode);
    testId?: string;
    minWords?: number;
    maxWords?: number;
    /** Only offered when this is true for the selection. Called on every selection, so it must be quick */
    matches?: (selection: string) => boolean;
    onClick: (context: PluginActionContext) => Promise<void>;
};

/** What the plugin keeps, under its own prefix. Outside of the projects, as the plugins are the same for all of them */
export type PluginStorage = {
    get<T>(key: string): Promise<T | undefined>;
    /** Any value the browser can clone, as an ArrayBuffer of a PDF */
    set(key: string, value: unknown): Promise<void>;
    del(key: string): Promise<void>;
    /** The keys of the plugin, without its prefix */
    keys(): Promise<string[]>;
};

/** A message of a conversation with the AI. Text only */
export type PluginAIMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export type PluginAI = {
    /**
     * The whole answer of the AI to the conversation, on the endpoint chosen on the AI status.
     * `cache` keeps the prompt on the server, so the next ones starting the same way reuse it (false by default)
     */
    complete: (messages: PluginAIMessage[], options?: { onProgress?: (chunk: string) => void; cache?: boolean }) => Promise<string>;
};

/** What the app gives to each plugin to work with */
export type PluginEnv = { storage: PluginStorage; ai: PluginAI };

export type Plugin = {
    id: string;
    /** Shown on the settings of the header, when the plugin has a `Settings` view */
    name?: string;
    description?: string;
    /** Prepares what the plugin needs (as a list to match against). The options are only offered after it */
    setup?: (env: PluginEnv) => Promise<void>;
    /** The configuration of the plugin, opened from the settings of the header */
    Settings?: ComponentType<PluginEnv>;
    menuOptions: PluginMenuOption[];
};
