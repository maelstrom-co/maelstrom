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
 */
export type OwnershipEdgeKind = 'grant' | 'media' | 'intent';

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
   * Apex height, in stage coordinates. Setting it arcs the edge out of both
   * nodes' top edges, so a path that bypasses a zone is drawn outside it rather
   * than through the cards in between. Negative values are allowed — the apex of
   * a quadratic never reaches its control point, so it must sit above the top of
   * every card the arc has to clear.
   */
  lift?: number;
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
