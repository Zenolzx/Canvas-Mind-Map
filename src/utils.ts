export function randomId(): string {
    const array = new Uint8Array(8);

    window.crypto.getRandomValues(array);

    return Array.from(array, (byte) =>
        byte.toString(16).padStart(2, '0')
    ).join('');
}

export function sanitizeHeading(rawHeading: string): string {
    return rawHeading.replace(/\[\[|\]\]/g, '').replace(/[[\](){}<>|#:]/g, ' ').replace(/\s+/g, ' ').trim();
}
