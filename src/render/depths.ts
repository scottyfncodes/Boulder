/**
 * How far each part of the scene stands out of the wall, in metres.
 *
 * The renderer positions meshes at these depths and the 2D overlay projects its
 * markers at them. They must agree: the overlay draws reticles and pips on top
 * of the 3D scene with no depth buffer to keep it honest, so if the two sides
 * disagree the markers sit slightly off the things they are marking.
 *
 * On a flat wall that mistake is a small constant error. On a pitched wall the
 * depth offset rotates into a vertical one and grows with the angle, which is
 * how a 10px drift became a 25px drift at 32 degrees. Keeping one set of
 * numbers here is what stops the two sides drifting apart again.
 */

/** Holds are anchored on the wall surface; their geometry grows out of it. */
export const HOLD_Z = 0;
export const HAND_Z = 0.09;
export const FOOT_Z = 0.07;
/** Upper and lower limb segments. */
export const ARM_Z = 0.12;
export const LEG_Z = 0.1;
export const HIP_Z = 0.15;
export const TORSO_Z = 0.16;
export const HEAD_Z = 0.2;
