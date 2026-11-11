import Text from '@onepercentio/one-ui/components/Text';
import useShortIntl from '@onepercentio/one-ui/hooks/useShortIntl';
import { Globe, Laptop, Network, type LucideIcon } from 'lucide-react';
import type { AIProviderKind } from '../../../../utils/aiProviders';
import { TestIds } from '../../../../testids';
import Styles from '../../AIIntegrationWizard.module.scss';

const KINDS: { kind: AIProviderKind; Icon: LucideIcon }[] = [
    { kind: 'local', Icon: Laptop },
    { kind: 'network', Icon: Network },
    { kind: 'remote', Icon: Globe },
];

/** The first step: where the provider is */
export default function ProviderChoice({ onChoose }: { onChoose: (kind: AIProviderKind) => void }) {
    const { txt } = useShortIntl();
    return (
        <div className={Styles.step}>
            <Text type="description">{txt('aiWizard.intro')}</Text>
            <div className={Styles.tiles}>
                {KINDS.map(({ kind, Icon }) => (
                    <button
                        key={kind}
                        type="button"
                        className={Styles.tile}
                        data-testid={TestIds.aiWizard.provider}
                        data-kind={kind}
                        onClick={() => onChoose(kind)}
                    >
                        <Icon size={32} strokeWidth={1.5} aria-hidden />
                        <span className={Styles.tileName}>{txt(`aiWizard.kinds.${kind}`)}</span>
                        <span className={Styles.tileDescription}>{txt(`aiWizard.kindDescriptions.${kind}`)}</span>
                    </button>
                ))}
            </div>
        </div>
    );
}
