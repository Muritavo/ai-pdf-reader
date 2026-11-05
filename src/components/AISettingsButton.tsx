import { useState } from 'react';
import { createPortal } from 'react-dom';
import { BrainCog, X } from 'lucide-react';
import { AI_MODELS, DEFAULT_AI_SETTINGS, type AISettings } from '../services/ai';
import Styles from './AISettingsButton.module.css';

export type AISettingsButtonProps = {
    /** The settings chosen before. Without them, the default model and no thinking */
    value?: AISettings;
    onAISetup: (configs: AISettings) => void;
    disabled?: boolean;
    /** Extra classes of the button, to look as the other buttons around it */
    className?: string;
    testId?: string;
};

/** Opens the choice of the model and of the thinking mode used for the requests of something */
export default function AISettingsButton({ value, onAISetup, disabled, className, testId = 'ai-settings' }: AISettingsButtonProps) {
    const [open, setOpen] = useState(false);
    const current = value ?? DEFAULT_AI_SETTINGS;
    const label = `Configurações da IA: ${current.name}${current.thinkingEnabled ? ' (thinking)' : ''}`;

    return (
        <>
            <button
                type="button"
                className={[Styles.button, className].filter(Boolean).join(' ')}
                title={label}
                aria-label={label}
                disabled={disabled}
                data-testid={testId}
                onClick={() => setOpen(true)}
            >
                <BrainCog size={18} />
            </button>
            {open && (
                <AISettingsModal
                    value={current}
                    onClose={() => setOpen(false)}
                    onSave={configs => {
                        setOpen(false);
                        onAISetup(configs);
                    }}
                    testId={testId}
                />
            )}
        </>
    );
}

function AISettingsModal({
    value,
    onClose,
    onSave,
    testId,
}: {
    value: AISettings;
    onClose: () => void;
    onSave: (configs: AISettings) => void;
    testId: string;
}) {
    const [draft, setDraft] = useState(value);
    // A model chosen before that is not on the list anymore is still shown, as it is the one in use
    const models = AI_MODELS.includes(draft.name) ? AI_MODELS : [...AI_MODELS, draft.name];

    return createPortal(
        <div className={Styles.overlay} onClick={onClose} onKeyDown={e => e.key === 'Escape' && onClose()}>
            <form
                className={Styles.modal}
                onClick={e => e.stopPropagation()}
                onSubmit={e => {
                    e.preventDefault();
                    onSave(draft);
                }}
                data-testid={`${testId}-modal`}
            >
                <div className={Styles.header}>
                    <strong>Configurações da IA</strong>
                    <button type="button" className={Styles.button} aria-label="Fechar" onClick={onClose}>
                        <X size={18} />
                    </button>
                </div>
                <div className={Styles.body}>
                    <label className={Styles.field}>
                        <span className="text-caption">Modelo</span>
                        <select
                            autoFocus
                            value={draft.name}
                            data-testid={`${testId}-model`}
                            onChange={e => setDraft({ ...draft, name: e.target.value })}
                        >
                            {models.map(model => (
                                <option key={model} value={model}>
                                    {model}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className={Styles.check}>
                        <input
                            type="checkbox"
                            checked={draft.thinkingEnabled}
                            data-testid={`${testId}-thinking`}
                            onChange={e => setDraft({ ...draft, thinkingEnabled: e.target.checked })}
                        />
                        Thinking
                    </label>
                </div>
                <div className={Styles.footer}>
                    <button type="button" className="btn btn-transparent" onClick={onClose}>
                        Cancelar
                    </button>
                    <button type="submit" className="btn btn-primary" data-testid={`${testId}-save`}>
                        Salvar
                    </button>
                </div>
            </form>
        </div>,
        document.body,
    );
}
