import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import useShortIntl from '@onepercentio/one-ui/hooks/useShortIntl';
import { Settings, X } from 'lucide-react';
import { usePlugins, type ConfigurablePlugin } from '../../context/PluginsContext';
import { TestIds } from '../../testids';
import Styles from './PluginSettings.module.css';

/** The settings of the header: the plugins with a configuration, each opening its own view */
export default function PluginSettings() {
    const { txt } = useShortIntl();
    const { configurable } = usePlugins();
    const [menuOpen, setMenuOpen] = useState(false);
    const [opened, setOpened] = useState<ConfigurablePlugin>();
    const rootRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!menuOpen) return;
        const close = (e: MouseEvent) => {
            if (!rootRef.current?.contains(e.target as Node)) setMenuOpen(false);
        };
        document.addEventListener('mousedown', close);
        return () => document.removeEventListener('mousedown', close);
    }, [menuOpen]);

    if (configurable.length === 0) return null;

    return (
        <div ref={rootRef} className={Styles.root}>
            <button
                type="button"
                className={Styles.button}
                data-testid={TestIds.pluginSettings.open}
                title={txt('pluginSettings.title')}
                aria-label={txt('pluginSettings.title')}
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen(open => !open)}
            >
                <Settings size={18} strokeWidth={1.75} />
            </button>
            {menuOpen && (
                <ul className={Styles.menu} data-testid={TestIds.pluginSettings.menu}>
                    {configurable.map(plugin => (
                        <li key={plugin.id}>
                            <button
                                type="button"
                                className={Styles.item}
                                data-testid={TestIds.pluginSettings.item}
                                title={plugin.description}
                                onClick={() => {
                                    setOpened(plugin);
                                    setMenuOpen(false);
                                }}
                            >
                                <span>{plugin.name ?? plugin.id}</span>
                                <Settings size={14} strokeWidth={1.75} />
                            </button>
                        </li>
                    ))}
                </ul>
            )}
            {opened &&
                createPortal(
                    <div className={Styles.view} data-testid={TestIds.pluginSettings.view}>
                        <div className={Styles.viewHeader}>
                            <div>
                                <h1 className="text-title">{opened.name ?? opened.id}</h1>
                                {opened.description && <p className="text-description">{opened.description}</p>}
                            </div>
                            <button
                                type="button"
                                className={Styles.button}
                                data-testid={TestIds.pluginSettings.close}
                                aria-label={txt('pluginSettings.close')}
                                onClick={() => setOpened(undefined)}
                            >
                                <X size={20} strokeWidth={1.75} />
                            </button>
                        </div>
                        <div className={Styles.viewContent}>
                            <opened.Settings storage={opened.env.storage} ai={opened.env.ai} />
                        </div>
                    </div>,
                    document.body,
                )}
        </div>
    );
}
