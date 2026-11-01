import { usePreloadedCount } from '../library';

/** The action of the menu, with how many references were preloaded to be searched */
export default function MenuLabel() {
    const count = usePreloadedCount();
    return (
        <>
            Consultar literatura<sup>{count}</sup>
        </>
    );
}
