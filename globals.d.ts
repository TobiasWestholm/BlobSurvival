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
