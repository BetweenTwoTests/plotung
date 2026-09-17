// plotung: typed reconciliation in, layout out, and a viewer for the result.
// Synthetic data lives in 'plotung/simulate' and is deliberately not exported here.
export type { UpperNodeInput, LowerNodeInput, EventKind, ReconciliationInput, CompileOptions, CompileWarning, Layout, Scene } from './types.ts';
export { Event, LEAF, DUP, TRANS, SPEC, SPECLOSS, LOSS, EVENT_NAME, LANE, PAD, GAP, HB, STUBLEN, finishUpper, LowerForest } from './model.ts';
export type { EventCode, UpperTree, UpperTreeBare } from './model.ts';
export { parseNewick, toNewick } from './newick.ts';
export { compileUpper, compileLower, createScene, ReconciliationError } from './compile.ts';
export { layout, laneX, pipeEdges } from './layout.ts';
export { createViewer, LIGHT_THEME, DARK_THEME, LIGHT_FAMILY_COLORS, DARK_FAMILY_COLORS } from './viewer.ts';
export type { Viewer, ViewerOptions, ViewerDisplayOptions, Theme, ZoomMode, Camera, Hit, HitInfo, LowerHitInfo, UpperHitInfo, FrameStats } from './viewer.ts';
