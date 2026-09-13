/** Preferred side to float a tour callout relative to its highlighted target. `InterfaceTour`
 * falls back to an on-screen position when the preferred side would overflow the viewport. */
export type TourPlacement = 'top' | 'bottom' | 'left' | 'right'

export type TourStep = {
  /** The `data-tour="…"` value of the element this step spotlights. */
  target: string
  title: string
  body: string
  placement: TourPlacement
}

/**
 * The ordered spotlight interface tour. Each step names a `data-tour` anchor placed on a real UI
 * element (see the `data-tour` attributes across components/) — `InterfaceTour` reads the live
 * bounding rect at runtime, so this stays layout-agnostic. Keep the order reading left-to-right,
 * top-to-bottom around the app so the highlight travels naturally.
 */
export const TOUR_STEPS: TourStep[] = [
  {
    target: 'modes',
    title: 'Three modes',
    body: 'Switch between Model (build voxels), Animate (bring slices to life), and Texture (paint surface detail). Every panel adapts to the mode you pick.',
    placement: 'bottom',
  },
  {
    target: 'editor2d',
    title: '2D editor',
    body: 'The left side is your drawing surface — paint one slice of the model at a time on the construction plane, pixel by pixel.',
    placement: 'right',
  },
  {
    target: 'viewport3d',
    title: '3D preview',
    body: 'The right side shows your model in 3D. Orbit with the left mouse button, pan with the right, and click a voxel face to move the construction plane there.',
    placement: 'left',
  },
  {
    target: 'tools',
    title: 'Tools & shapes',
    body: 'Paint, erase, fill, select, and more live here — plus the voxel-shape picker (cube, chamfer, wedge). Each tool also has a single-key shortcut.',
    placement: 'right',
  },
  {
    target: 'settings',
    title: 'View settings',
    body: 'This gear opens per-mode settings — ambient occlusion, glass, noise, and emissive animation — to dial in how the preview and export look.',
    placement: 'left',
  },
  {
    target: 'undo',
    title: 'Undo & redo',
    body: 'Step backward and forward through your edits. Model, Animate, and Texture each keep their own independent history.',
    placement: 'top',
  },
  {
    target: 'help',
    title: 'Need a hand?',
    body: 'Open this Help button any time for the full list of keyboard shortcuts — or to replay this tour. Press ? to open it instantly.',
    placement: 'bottom',
  },
]
