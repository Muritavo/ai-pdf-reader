// Global variant declarations consumed by @onepercentio/one-ui typings
declare global {
    interface OnepercentUtility {
        UIElements: {
            TextVariants: 'title' | 'subtitle' | 'description' | 'caption';
            TextColors: 'primary' | 'muted';
            ButtonVariants: 'primary' | 'outline' | 'transparent';
            SpacingVariants: 'small' | 'large';
        };
    }
}

declare module '*.module.css' {
    const classes: Record<string, string>;
    export default classes;
}

export {};
