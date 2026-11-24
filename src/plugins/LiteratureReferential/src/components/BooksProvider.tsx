import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import type { PluginEnv } from '../../../types';
import BookDialog, { type BookDialogHandle } from './BookDialog';

type IBooks = {
    /** Opens the book on a page of the PDF, or moves to it when the book is already open */
    open: (bookId: string, atPage: number) => void;
};

const BooksContext = createContext<IBooks>({ open: () => {} });

/** At the root, so the book outlives the window it was opened from (as the result of the literature) */
export default function BooksProvider({ storage, children }: PluginEnv & { children: ReactNode }) {
    const [bookId, setBookId] = useState<string>();
    const [open, setOpen] = useState(false);
    const dialogRef = useRef<BookDialogHandle>(null);

    const value = useMemo<IBooks>(
        () => ({
            open: (id, atPage) => {
                setBookId(id);
                setOpen(true);
                dialogRef.current?.goToPage(atPage);
            },
        }),
        [],
    );

    return (
        <BooksContext.Provider value={value}>
            {children}
            <BookDialog ref={dialogRef} storage={storage} bookId={bookId} open={open} onClose={() => setOpen(false)} />
        </BooksContext.Provider>
    );
}

export const useBooksProvider = () => useContext(BooksContext);
