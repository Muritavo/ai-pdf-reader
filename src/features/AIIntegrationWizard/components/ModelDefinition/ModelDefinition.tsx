import { useEffect, useState } from 'react';
import Button from '@onepercentio/one-ui/components/Button';
import Input from '@onepercentio/one-ui/components/Input';
import Text from '@onepercentio/one-ui/components/Text';
import Dots from '@onepercentio/one-ui/components/LoaderDotsIndicator';
import useShortIntl from '@onepercentio/one-ui/hooks/useShortIntl';
import { Plus, Sparkles, X } from 'lucide-react';
import { TestIds } from '../../../../testids';
import { checkModel, listModels } from '../../discovery';
import Styles from '../../AIIntegrationWizard.module.scss';

/**
 * The last step: the automatic model (null, the one loaded on the provider), or the models chosen by name.
 * Once a model is added, the automatic one is no longer offered
 */
export default function ModelDefinition({
    endpoint,
    apiKey,
    onDone,
}: {
    endpoint: string;
    apiKey?: string;
    onDone: (models: string[] | null) => void;
}) {
    const { txt } = useShortIntl();
    const [serverModels, setServerModels] = useState<string[]>();
    const [models, setModels] = useState<string[]>([]);
    const [typed, setTyped] = useState('');
    // The result of checking the typed name against the provider
    const [check, setCheck] = useState<{ model: string; state: 'checking' | 'valid' | 'invalid' }>();

    useEffect(() => {
        let current = true;
        listModels(endpoint, apiKey).then(found => {
            if (current) setServerModels(found);
        });
        return () => {
            current = false;
        };
    }, [endpoint, apiKey]);

    const add = (model: string) => {
        const name = model.trim();
        if (name && !models.includes(name)) setModels(prev => [...prev, name]);
    };
    const offered = (serverModels ?? []).filter(model => !models.includes(model));

    const verify = async () => {
        const model = typed.trim();
        setCheck({ model, state: 'checking' });
        const valid = await checkModel(endpoint, model, apiKey);
        // Only if the name was not changed meanwhile
        setCheck(prev => (prev?.model === model ? { model, state: valid ? 'valid' : 'invalid' } : prev));
    };

    return (
        <div className={Styles.step}>
            <Text type="description">{txt('aiWizard.modelsTitle')}</Text>
            {models.length === 0 && (
                <button type="button" className={Styles.option} data-testid={TestIds.aiWizard.modelAuto} onClick={() => onDone(null)}>
                    <span>
                        <strong>{txt('aiWizard.autoModel')}</strong>
                        <br />
                        <span className={Styles.muted}>{txt('aiWizard.autoModelDescription')}</span>
                    </span>
                    <Sparkles size={18} aria-hidden />
                </button>
            )}
            {!serverModels ? (
                <Text type="caption" className={Styles.muted} data-testid={TestIds.aiWizard.modelsLoading}>
                    {txt('aiWizard.modelsLoading')} <Dots dotsCount={3} lockSize />
                </Text>
            ) : (
                offered.length > 0 && (
                    <>
                        <Text type="caption">{txt('aiWizard.serverModels')}</Text>
                        <div className={Styles.chips}>
                            {offered.map(model => (
                                <button
                                    key={model}
                                    type="button"
                                    className={Styles.chip}
                                    data-testid={TestIds.aiWizard.serverModel}
                                    onClick={() => add(model)}
                                >
                                    <Plus size={12} aria-hidden />
                                    <span className={Styles.mono}>{model}</span>
                                </button>
                            ))}
                        </div>
                    </>
                )
            )}
            <form
                className={Styles.row}
                onSubmit={e => {
                    e.preventDefault();
                    add(typed);
                    setTyped('');
                    setCheck(undefined);
                }}
            >
                <Input
                    className={Styles.input}
                    placeholder={txt('aiWizard.customModel')}
                    value={typed}
                    onChange={e => {
                        setTyped(e.target.value);
                        setCheck(undefined);
                    }}
                    data-testid={TestIds.aiWizard.modelInput}
                />
                <Button
                    type="button"
                    variant="outline"
                    disabled={!typed.trim() || check?.state === 'checking'}
                    onClick={verify}
                    data-testid={TestIds.aiWizard.modelCheck}
                >
                    {check?.state === 'checking' ? <Dots dotsCount={3} lockSize /> : txt('aiWizard.checkModel')}
                </Button>
                <Button type="submit" variant="outline" disabled={!typed.trim()} data-testid={TestIds.aiWizard.modelAdd}>
                    {txt('aiWizard.addModel')}
                </Button>
            </form>
            {check && check.state !== 'checking' && (
                <Text
                    type="caption"
                    className={check.state === 'valid' ? Styles.success : Styles.error}
                    data-testid={TestIds.aiWizard.modelCheckResult}
                    data-result={check.state}
                >
                    {txt(check.state === 'valid' ? 'aiWizard.modelValid' : 'aiWizard.modelInvalid', { model: check.model })}
                </Text>
            )}
            {models.length > 0 && (
                <>
                    <ul className={Styles.list}>
                        {models.map(model => (
                            <li key={model} className={Styles.option} data-testid={TestIds.aiWizard.modelItem}>
                                <span className={Styles.mono}>{model}</span>
                                <button
                                    type="button"
                                    className={Styles.iconButton}
                                    aria-label={txt('aiWizard.removeModel', { model })}
                                    data-testid={TestIds.aiWizard.modelRemove}
                                    onClick={() => setModels(prev => prev.filter(m => m !== model))}
                                >
                                    <X size={14} />
                                </button>
                            </li>
                        ))}
                    </ul>
                    <Button variant="primary" data-testid={TestIds.aiWizard.finish} onClick={() => onDone(models)}>
                        {txt('aiWizard.finish')}
                    </Button>
                </>
            )}
        </div>
    );
}
