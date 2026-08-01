/**
 * Data model for the ownership diagram: who deploys each runtime role, what
 * secret it holds, how long it lives, and which paths run between them.
 *
 * Positions are authored, not computed. A voice topology has four or five nodes
 * and one path that must visibly avoid a band (provider audio bypassing your
 * server), which no auto-layout will get right on its own.
 */

/** `yours` is deployed by the reader; `theirs` is operated by the provider. */
export type OwnershipTone = 'yours' | 'theirs';

/** A deployment zone drawn as a labelled background band. */
export interface OwnershipBand {
  id: string;
  /** Band caption — who operates everything inside it. */
  label: string;
  tone: OwnershipTone;
  /** Left edge and width in stage coordinates. */
  x: number;
  width: number;
}

export interface OwnershipNode {
  id: string;
  label: string;
  tone: OwnershipTone;
  /** One line on what this role does. */
  detail?: string;
  /** The credential that lives here, and nowhere else. */
  holds?: string;
  /** How long the role exists — per request, per session, per page. */
  lifetime?: string;
  /** Center and full extents in stage coordinates. */
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Colour, not geometry.
 *
 * - `grant`: a credential handed to a less-trusted party.
 * - `media`: audio, transcripts, and session data.
 * - `intent`: the ordinary Maelstrom request, unchanged by voice.
 * - `context`: structure a party may read but never act on. Distinct from
 *   `intent` because the difference between reading state and deciding state is
 *   the whole argument wherever this kind appears.
 * - `blocked`: a path that does not exist. Drawn struck through and without an
 *   arrowhead, because some diagrams argue for an absence and prose alone makes
 *   a reader take that on trust.
 */
export type OwnershipEdgeKind =
  | 'grant'
  | 'media'
  | 'intent'
  | 'context'
  | 'blocked';

export interface OwnershipEdge {
  id: string;
  from: string;
  to: string;
  kind: OwnershipEdgeKind;
  /** Omit on a short link between neighbours, where no label would fit. */
  label?: string;
  /** `both` draws arrowheads at each end. */
  direction?: 'forward' | 'both';
  /**
   * Control-point height, in stage coordinates. Setting it bends the edge clear
   * of the cards between its endpoints, instead of cutting through them.
   *
   * Above both endpoints it arcs over the stage, leaving each node's top edge;
   * below them it arcs under, leaving each bottom edge. Two paths between the
   * same pair of cards need opposite sides, or they draw on top of each other.
   *
   * Push it further than the clearance you want: the apex of a quadratic sits
   * halfway between the chord and the control point, so it never reaches this
   * value. Values outside the stage are allowed for the same reason.
   */
  arc?: number;
  /**
   * Nudge for the label away from the path midpoint. Short runs between two
   * cards rarely leave room for a label on the line itself.
   */
  labelDx?: number;
  labelDy?: number;
}

export interface OwnershipModel {
  /** Stage width and height. All coordinates above are in this space. */
  stage: { w: number; h: number };
  /** Sentence describing the whole picture, for `aria-label`. */
  summary: string;
  bands: OwnershipBand[];
  nodes: OwnershipNode[];
  edges: OwnershipEdge[];
}
