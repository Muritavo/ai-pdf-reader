import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import OneUIProvider from '@onepercentio/one-ui/context/OneUIProvider';
import BigFactory from '@onepercentio/one-ui/components/FileInput/View/BigFactory';
import App from './App';
import { ArticlesRepositoryProvider } from './context/ArticlesRepository';
import './index.css';

const UploadIcon = () => (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
        <path d="M12 16V4m0 0-4 4m4-4 4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <OneUIProvider
            config={{
                component: {
                    text: {
                        className: {
                            title: 'text-title',
                            subtitle: 'text-subtitle',
                            description: 'text-description',
                            caption: 'text-caption',
                        },
                        htmlTag: { title: 'h1', subtitle: 'h2', description: 'p', caption: 'p' },
                    },
                    button: {
                        className: {
                            primary: 'btn btn-primary',
                            outline: 'btn btn-outline',
                            transparent: 'btn btn-transparent',
                        },
                    },
                    fileInput: {
                        View: BigFactory(UploadIcon),
                        button: { variant: 'primary' },
                    },
                },
            }}
        >
            <ArticlesRepositoryProvider>
                <App />
            </ArticlesRepositoryProvider>
        </OneUIProvider>
    </StrictMode>,
);
