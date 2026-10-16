import Button from '@onepercentio/one-ui/components/Button';
import LoaderDotsIndicator from '@onepercentio/one-ui/components/LoaderDotsIndicator';
import useAsyncControl from '@onepercentio/one-ui/hooks/useAsyncControl';
import useShortIntl from '@onepercentio/one-ui/hooks/useShortIntl';
import type { PropsWithChildren } from 'react';

export default function AsyncInteractionButton({
    action,
    children,
    className,
    variant,
    disabled,
    title,
}: PropsWithChildren<{
    action: () => Promise<unknown>;
    className?: string;
    disabled?: boolean;
    title?: string;
    variant?: React.ComponentProps<typeof Button>['variant'];
}>) {
    const { txt } = useShortIntl();
    const control = useAsyncControl({ action });

    return (
        <Button variant={variant} className={className} onClick={control.action} disabled={disabled || control.loading} title={title}>
            {control.error ? (
                txt('documentPreview.menu.tryAgain')
            ) : control.loading ? (
                <LoaderDotsIndicator dotsCount={5} lockSize />
            ) : (
                children
            )}
        </Button>
    );
}
