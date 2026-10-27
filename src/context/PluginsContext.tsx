import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Plugin, PluginMenuOption } from '../plugins/types';
import UniprotPlugin from '../plugins/Uniprot';
import ChemblPlugin from '../plugins/Chembl';

/** Imported for now. Later they can come from somewhere else, with the same shape */
const PLUGINS: Plugin[] = [UniprotPlugin, ChemblPlugin];

export type IPlugins = {
    /** The options of the plugins already set up, for the menu of the selection */
    menuOptions: PluginMenuOption[];
};

const PluginsContext = createContext<IPlugins>({ menuOptions: [] });

/** Above the projects, as what the plugins keep (as the UniProt list) is the same for all of them */
export function PluginsProvider({ children }: { children: ReactNode }) {
    const [ready, setReady] = useState<string[]>([]);

    useEffect(() => {
        let mounted = true;
        for (const plugin of PLUGINS) {
            // One failing to set up (as offline, the first time) leaves the others working
            Promise.resolve(plugin.setup?.())
                .then(() => mounted && setReady(current => [...current, plugin.id]))
                .catch(e => console.error(`Failed to set up the plugin ${plugin.id}`, e));
        }
        return () => {
            mounted = false;
        };
    }, []);

    const value = useMemo(
        () => ({ menuOptions: PLUGINS.filter(plugin => ready.includes(plugin.id)).flatMap(plugin => plugin.menuOptions) }),
        [ready],
    );

    return <PluginsContext.Provider value={value}>{children}</PluginsContext.Provider>;
}

export const usePlugins = () => useContext(PluginsContext);
