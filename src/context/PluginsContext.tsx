import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Plugin, PluginEnv, PluginMenuOption } from '../plugins/types';
import { createPluginEnv } from '../plugins/env';
import UniprotPlugin from '../plugins/Uniprot';
import ChemblPlugin from '../plugins/Chembl';
import LiteratureReferentialPlugin from '../plugins/LiteratureReferential';

/** Imported for now. Later they can come from somewhere else, with the same shape */
const PLUGINS: Plugin[] = [UniprotPlugin, ChemblPlugin, LiteratureReferentialPlugin];

const ENVS = new Map(PLUGINS.map(plugin => [plugin.id, createPluginEnv(plugin.id)]));

/** A plugin with a configuration, for the settings of the header */
export type ConfigurablePlugin = Plugin & { Settings: NonNullable<Plugin['Settings']>; env: PluginEnv };

export type IPlugins = {
    /** The options of the plugins already set up, for the menu of the selection */
    menuOptions: PluginMenuOption[];
    configurable: ConfigurablePlugin[];
};

const PluginsContext = createContext<IPlugins>({ menuOptions: [], configurable: [] });

/** Above the projects, as what the plugins keep (as the UniProt list) is the same for all of them */
export function PluginsProvider({ children }: { children: ReactNode }) {
    const [ready, setReady] = useState<string[]>([]);

    useEffect(() => {
        let mounted = true;
        for (const plugin of PLUGINS) {
            // One failing to set up (as offline, the first time) leaves the others working
            Promise.resolve(plugin.setup?.(ENVS.get(plugin.id)!))
                .then(() => mounted && setReady(current => [...current, plugin.id]))
                .catch(e => console.error(`Failed to set up the plugin ${plugin.id}`, e));
        }
        return () => {
            mounted = false;
        };
    }, []);

    const value = useMemo(
        () => ({
            menuOptions: PLUGINS.filter(plugin => ready.includes(plugin.id)).flatMap(plugin => plugin.menuOptions),
            // Offered even before the setup, as fixing what the setup needs may be done there
            configurable: PLUGINS.filter((plugin): plugin is Plugin & Pick<ConfigurablePlugin, 'Settings'> => !!plugin.Settings).map(
                plugin => ({ ...plugin, env: ENVS.get(plugin.id)! }),
            ),
        }),
        [ready],
    );

    return <PluginsContext.Provider value={value}>{children}</PluginsContext.Provider>;
}

export const usePlugins = () => useContext(PluginsContext);
