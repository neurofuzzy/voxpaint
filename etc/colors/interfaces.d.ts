export type ColorPalette = {
    id: string;
    name: string;
    colors: Array<{ index: number; hex: string; hueGroup: string }>;
    backgroundColors: Array<{ index: number; hex: string; hueGroup: string }>;
    effectColors: string[];
    source: string;
};