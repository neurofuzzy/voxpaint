import { ColorPalette } from "./interfaces";

export const CRT: ColorPalette = {
    id: 'crt',
    name: 'CRT',
    colors: [
        { index: 0, hex: '#116611', hueGroup: 'Terminal Greens' },
        { index: 1, hex: '#228822', hueGroup: 'Terminal Greens' },
        { index: 2, hex: '#44bb44', hueGroup: 'Terminal Greens' },
        { index: 3, hex: '#66ff66', hueGroup: 'Terminal Greens' },
        { index: 4, hex: '#2222bb', hueGroup: 'Phosphor Blues' },
        { index: 5, hex: '#3333cc', hueGroup: 'Phosphor Blues' },
        { index: 6, hex: '#5555dd', hueGroup: 'Phosphor Blues' },
        { index: 7, hex: '#7777ff', hueGroup: 'Phosphor Blues' },
        { index: 8, hex: '#991199', hueGroup: 'Glowing Magentas' },
        { index: 9, hex: '#cc22cc', hueGroup: 'Glowing Magentas' },
        { index: 10, hex: '#dd44dd', hueGroup: 'Glowing Magentas' },
        { index: 11, hex: '#ff66ff', hueGroup: 'Glowing Magentas' },
        { index: 12, hex: '#664400', hueGroup: 'Warm Ambers' },
        { index: 13, hex: '#996600', hueGroup: 'Warm Ambers' },
        { index: 14, hex: '#cc8800', hueGroup: 'Warm Ambers' },
        { index: 15, hex: '#ffbb33', hueGroup: 'Warm Ambers' },
        { index: 16, hex: '#881111', hueGroup: 'CRT Reds' },
        { index: 17, hex: '#bb2222', hueGroup: 'CRT Reds' },
        { index: 18, hex: '#dd4444', hueGroup: 'CRT Reds' },
        { index: 19, hex: '#ff6666', hueGroup: 'CRT Reds' },
        { index: 20, hex: '#555555', hueGroup: 'Scan Line Whites' },
        { index: 21, hex: '#888888', hueGroup: 'Scan Line Whites' },
        { index: 22, hex: '#bbbbbb', hueGroup: 'Scan Line Whites' },
        { index: 23, hex: '#eeeeee', hueGroup: 'Scan Line Whites' }
    ],
    backgroundColors: [
        { index: 0, hex: '#1a1a66', hueGroup: 'Phosphor Blacks' },
        { index: 1, hex: '#252577', hueGroup: 'Phosphor Blacks' },
        { index: 2, hex: '#303088', hueGroup: 'Phosphor Blacks' },
        { index: 3, hex: '#3d3d99', hueGroup: 'Phosphor Blacks' },
        { index: 4, hex: '#1f1f1a', hueGroup: 'Screen Grays' },
        { index: 5, hex: '#2a2a25', hueGroup: 'Screen Grays' },
        { index: 6, hex: '#353530', hueGroup: 'Screen Grays' },
        { index: 7, hex: '#42423d', hueGroup: 'Screen Grays' }
    ],
    effectColors: [
        '#ffe878',  // amber glow
        '#98ff98',  // terminal green
        '#ff98ff',  // magenta flash
        '#b8b8ff'   // phosphor blue
    ],
    source: 'gemini',
};
