import { type Vessel, VesselSchema } from '@maelstrom-co/protocol';

const DEFINITIONS: readonly unknown[] = [
  {
    id: 'player',
    name: 'Music Player',
    description:
      'Music player for browsing what is currently playing, the upcoming queue, and lyrics for the current track. Supports playing a track, queueing tracks, and pausing playback from any view.',
    defaultVariant: 'nowPlaying',
    variants: {
      nowPlaying: {
        props: {},
        minSize: {
          width: 4,
          height: 4,
        },
        actions: [
          {
            name: 'showQueue',
            idempotent: true,
            description: 'Switch to the upcoming queue view',
            transitionsTo: 'queue',
          },
          {
            name: 'showLyrics',
            idempotent: true,
            description: 'Switch to the lyrics view for the current track',
            transitionsTo: 'lyrics',
          },
          {
            name: 'play',
            description: 'Play a track',
            parameters: [
              {
                name: 'track',
                type: 'string',
                description: 'Song title, optionally with the artist',
              },
            ],
          },
          {
            name: 'addToQueue',
            description: 'Add a track to the end of the queue',
            parameters: [
              {
                name: 'track',
                type: 'string',
                description: 'Song title, optionally with the artist',
              },
            ],
          },
          {
            name: 'pause',
            idempotent: true,
            description: 'Pause playback',
          },
        ],
      },
      queue: {
        props: {},
        minSize: {
          width: 6,
          height: 3,
        },
        actions: [
          {
            name: 'showNowPlaying',
            idempotent: true,
            description: 'Switch back to the now-playing view',
            transitionsTo: 'nowPlaying',
          },
          {
            name: 'showLyrics',
            idempotent: true,
            description: 'Switch to the lyrics view for the current track',
            transitionsTo: 'lyrics',
          },
          {
            name: 'play',
            description: 'Play a track',
            parameters: [
              {
                name: 'track',
                type: 'string',
                description: 'Song title, optionally with the artist',
              },
            ],
          },
          {
            name: 'addToQueue',
            description: 'Add a track to the end of the queue',
            parameters: [
              {
                name: 'track',
                type: 'string',
                description: 'Song title, optionally with the artist',
              },
            ],
          },
          {
            name: 'pause',
            idempotent: true,
            description: 'Pause playback',
          },
        ],
      },
      lyrics: {
        props: {},
        minSize: {
          width: 4,
          height: 4,
        },
        actions: [
          {
            name: 'showNowPlaying',
            idempotent: true,
            description: 'Switch back to the now-playing view',
            transitionsTo: 'nowPlaying',
          },
          {
            name: 'showQueue',
            idempotent: true,
            description: 'Switch to the upcoming queue view',
            transitionsTo: 'queue',
          },
          {
            name: 'play',
            description: 'Play a track',
            parameters: [
              {
                name: 'track',
                type: 'string',
                description: 'Song title, optionally with the artist',
              },
            ],
          },
          {
            name: 'addToQueue',
            description: 'Add a track to the end of the queue',
            parameters: [
              {
                name: 'track',
                type: 'string',
                description: 'Song title, optionally with the artist',
              },
            ],
          },
          {
            name: 'pause',
            idempotent: true,
            description: 'Pause playback',
          },
        ],
      },
    },
  },
  {
    id: 'watchlist',
    name: 'Stock Watchlist',
    description:
      'Stock watchlist showing tracked symbols, an interactive price chart, and related news. Supports adding and removing symbols and adjusting the chart time range.',
    defaultVariant: 'list',
    variants: {
      list: {
        props: {},
        minSize: {
          width: 3,
          height: 3,
        },
        actions: [
          {
            name: 'showChart',
            idempotent: true,
            description: 'Show the price chart for a symbol',
            parameters: [
              {
                name: 'symbol',
                type: 'string',
                description: 'Ticker symbol such as AAPL',
              },
            ],
            transitionsTo: 'chart',
          },
          {
            name: 'showNews',
            idempotent: true,
            description: 'Show related news for a symbol',
            parameters: [
              {
                name: 'symbol',
                type: 'string',
                description: 'Ticker symbol such as AAPL',
              },
            ],
            transitionsTo: 'news',
          },
          {
            name: 'addSymbol',
            description: 'Add a symbol to the watchlist',
            parameters: [
              {
                name: 'symbol',
                type: 'string',
                description: 'Ticker symbol such as AAPL',
              },
            ],
          },
          {
            name: 'removeSymbol',
            description: 'Remove a symbol from the watchlist',
            parameters: [
              {
                name: 'symbol',
                type: 'string',
                description: 'Ticker symbol such as AAPL',
              },
            ],
          },
        ],
      },
      chart: {
        props: {},
        minSize: {
          width: 6,
          height: 4,
        },
        actions: [
          {
            name: 'showChart',
            idempotent: true,
            description: 'Show the price chart for a symbol',
            parameters: [
              {
                name: 'symbol',
                type: 'string',
                description: 'Ticker symbol such as AAPL',
              },
            ],
          },
          {
            name: 'showNews',
            idempotent: true,
            description: 'Show related news for a symbol',
            parameters: [
              {
                name: 'symbol',
                type: 'string',
                description: 'Ticker symbol such as AAPL',
              },
            ],
            transitionsTo: 'news',
          },
          {
            name: 'setRange',
            idempotent: true,
            description: 'Set the chart time range',
            parameters: [
              {
                name: 'range',
                type: 'string',
                description: 'Time range to display',
                enum: ['1D', '1W', '1M', '1Y'],
              },
            ],
          },
          {
            name: 'addSymbol',
            description: 'Add a symbol to the watchlist',
            parameters: [
              {
                name: 'symbol',
                type: 'string',
                description: 'Ticker symbol such as AAPL',
              },
            ],
          },
          {
            name: 'removeSymbol',
            description: 'Remove a symbol from the watchlist',
            parameters: [
              {
                name: 'symbol',
                type: 'string',
                description: 'Ticker symbol such as AAPL',
              },
            ],
          },
          {
            name: 'backToList',
            idempotent: true,
            description: 'Return to the watchlist',
            transitionsTo: 'list',
          },
        ],
      },
      news: {
        props: {},
        minSize: {
          width: 4,
          height: 4,
        },
        actions: [
          {
            name: 'showChart',
            idempotent: true,
            description: 'Show the price chart for a symbol',
            parameters: [
              {
                name: 'symbol',
                type: 'string',
                description: 'Ticker symbol such as AAPL',
              },
            ],
            transitionsTo: 'chart',
          },
          {
            name: 'showNews',
            idempotent: true,
            description: 'Show related news for a symbol',
            parameters: [
              {
                name: 'symbol',
                type: 'string',
                description: 'Ticker symbol such as AAPL',
              },
            ],
          },
          {
            name: 'addSymbol',
            description: 'Add a symbol to the watchlist',
            parameters: [
              {
                name: 'symbol',
                type: 'string',
                description: 'Ticker symbol such as AAPL',
              },
            ],
          },
          {
            name: 'removeSymbol',
            description: 'Remove a symbol from the watchlist',
            parameters: [
              {
                name: 'symbol',
                type: 'string',
                description: 'Ticker symbol such as AAPL',
              },
            ],
          },
          {
            name: 'backToList',
            idempotent: true,
            description: 'Return to the watchlist',
            transitionsTo: 'list',
          },
        ],
      },
    },
  },
  {
    id: 'contacts',
    name: 'Contacts',
    description:
      'Contact list with a detail view and a call-history view for each contact. Supports adding contacts, adding notes, and logging calls.',
    defaultVariant: 'list',
    variants: {
      list: {
        props: {},
        minSize: {
          width: 3,
          height: 3,
        },
        actions: [
          {
            name: 'openContact',
            idempotent: true,
            description: 'Open a contact to view their details',
            parameters: [
              {
                name: 'name',
                type: 'string',
                description: "Contact's full name",
              },
            ],
            transitionsTo: 'detail',
          },
          {
            name: 'showHistory',
            idempotent: true,
            description: "Show a contact's call history",
            parameters: [
              {
                name: 'name',
                type: 'string',
                description: "Contact's full name",
              },
            ],
            transitionsTo: 'history',
          },
          {
            name: 'addContact',
            description: 'Add a new contact',
            parameters: [
              {
                name: 'name',
                type: 'string',
                description: "Contact's full name",
              },
              {
                name: 'company',
                type: 'string',
                description: "Contact's company",
              },
            ],
          },
          {
            name: 'addNote',
            description: 'Add a note to a contact',
            parameters: [
              {
                name: 'name',
                type: 'string',
                description: "Contact's full name",
              },
              {
                name: 'text',
                type: 'string',
                description: 'Note text',
              },
            ],
          },
          {
            name: 'logCall',
            description: 'Log a call with a contact',
            parameters: [
              {
                name: 'name',
                type: 'string',
                description: "Contact's full name",
              },
              {
                name: 'summary',
                type: 'string',
                description: 'Summary of the call',
              },
            ],
          },
        ],
      },
      detail: {
        props: {},
        minSize: {
          width: 4,
          height: 4,
        },
        actions: [
          {
            name: 'openContact',
            idempotent: true,
            description: 'Open a contact to view their details',
            parameters: [
              {
                name: 'name',
                type: 'string',
                description: "Contact's full name",
              },
            ],
          },
          {
            name: 'showHistory',
            idempotent: true,
            description: "Show a contact's call history",
            parameters: [
              {
                name: 'name',
                type: 'string',
                description: "Contact's full name",
              },
            ],
            transitionsTo: 'history',
          },
          {
            name: 'addContact',
            description: 'Add a new contact',
            parameters: [
              {
                name: 'name',
                type: 'string',
                description: "Contact's full name",
              },
              {
                name: 'company',
                type: 'string',
                description: "Contact's company",
              },
            ],
          },
          {
            name: 'addNote',
            description: 'Add a note to a contact',
            parameters: [
              {
                name: 'name',
                type: 'string',
                description: "Contact's full name",
              },
              {
                name: 'text',
                type: 'string',
                description: 'Note text',
              },
            ],
          },
          {
            name: 'logCall',
            description: 'Log a call with a contact',
            parameters: [
              {
                name: 'name',
                type: 'string',
                description: "Contact's full name",
              },
              {
                name: 'summary',
                type: 'string',
                description: 'Summary of the call',
              },
            ],
          },
          {
            name: 'backToList',
            idempotent: true,
            description: 'Return to the contact list',
            transitionsTo: 'list',
          },
        ],
      },
      history: {
        props: {},
        minSize: {
          width: 4,
          height: 4,
        },
        actions: [
          {
            name: 'openContact',
            idempotent: true,
            description: 'Open a contact to view their details',
            parameters: [
              {
                name: 'name',
                type: 'string',
                description: "Contact's full name",
              },
            ],
            transitionsTo: 'detail',
          },
          {
            name: 'showHistory',
            idempotent: true,
            description: "Show a contact's call history",
            parameters: [
              {
                name: 'name',
                type: 'string',
                description: "Contact's full name",
              },
            ],
          },
          {
            name: 'addContact',
            description: 'Add a new contact',
            parameters: [
              {
                name: 'name',
                type: 'string',
                description: "Contact's full name",
              },
              {
                name: 'company',
                type: 'string',
                description: "Contact's company",
              },
            ],
          },
          {
            name: 'addNote',
            description: 'Add a note to a contact',
            parameters: [
              {
                name: 'name',
                type: 'string',
                description: "Contact's full name",
              },
              {
                name: 'text',
                type: 'string',
                description: 'Note text',
              },
            ],
          },
          {
            name: 'logCall',
            description: 'Log a call with a contact',
            parameters: [
              {
                name: 'name',
                type: 'string',
                description: "Contact's full name",
              },
              {
                name: 'summary',
                type: 'string',
                description: 'Summary of the call',
              },
            ],
          },
          {
            name: 'backToList',
            idempotent: true,
            description: 'Return to the contact list',
            transitionsTo: 'list',
          },
        ],
      },
    },
  },
];

/** A second, non-demo vessel set for evals, parsed and branded. */
export const workspaceVessels: readonly Vessel[] = DEFINITIONS.map(
  (definition) => VesselSchema.parse(definition),
);
