import Text from '@onepercentio/one-ui/components/Text';
import Styles from './Steps.module.css';

export default function UnderConstruction() {
    return (
        <section className={`${Styles.step} ${Styles.placeholder}`}>
            <Text type="subtitle">Em construção</Text>
            <Text type="description">Esta etapa ainda está sendo desenvolvida.</Text>
        </section>
    );
}
