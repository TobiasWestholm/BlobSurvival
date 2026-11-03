interface Window {
    // biome-ignore lint/suspicious/noExplicitAny: Window index signature requires any for dynamic globals
    [key: string]: any;
}

interface HTMLElement {
    // biome-ignore lint/suspicious/noExplicitAny: Dynamic DOM property access in vanilla JS
    [key: string]: any;
}

interface Element {
    // biome-ignore lint/suspicious/noExplicitAny: Dynamic DOM property access in vanilla JS
    [key: string]: any;
}

interface EventTarget {
    // biome-ignore lint/suspicious/noExplicitAny: Dynamic event target access in vanilla JS
    [key: string]: any;
}

// Safari 16.4+ only: not in the DOM lib shipped with this TypeScript version.
// Used to move Web Audio off iOS's ambient session so the ring/silent switch
// stops muting the game.
interface Navigator {
    audioSession?: { type: string };
}
