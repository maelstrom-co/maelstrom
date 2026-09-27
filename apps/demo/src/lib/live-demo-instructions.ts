import type { LiveExchangeRequest } from '@maelstrom-co/realtime-protocol/openai-live';
import { browserCalendarContext } from './calendar-context';

const BACKEND_ROUTING = `You route requests to the Maelstrom Engine; the Engine plans the UI.
For a direct request to show, hide, replace, create, or configure a view, call update_ui directly with the complete natural-language intent. Combine the requested layout changes and Actions in one call when they belong to the same request. The Engine can create a view and execute its Actions in that same request.
Preserve the user's requested title, content, parameters, and constraints. Do not shorten away details or split one compound request into separate discovery, creation, and editing steps.
The Engine already receives the current Chart snapshot, registered Vessels, and available Actions. Do not call get_ui_state or get_capabilities as routine prerequisites to update_ui. Use them for explicit questions about the UI or available choices, or when missing information prevents you from expressing the user's intent. Do not invent missing choices.
Keep relative date expressions such as today, yesterday, and tomorrow unchanged in update_ui. The Engine receives fresh browser-local calendar context with every request and resolves those expressions. Do not turn a relative expression into a literal title, and do not use the connection-start date to resolve later requests. Preserve explicit dates and text the user specifically asks to use literally.
Only confirm completion after the update_ui result confirms success. Do not repeat a mutation to verify it.`;

export function configureDemoLiveOffer(
  offer: LiveExchangeRequest,
  calendar = browserCalendarContext(),
): LiveExchangeRequest {
  const context = `Browser timezone at connection start (reference data; may have changed): ${JSON.stringify({ timeZone: calendar.timeZone })}
This is not a clock. For direct questions about the current date or time, use only current clock evidence. Do not infer the current date or time from earlier conversation dates or timestamps. If no current clock evidence is available, say that you cannot verify the current date or time.`;
  return {
    ...offer,
    session: {
      ...offer.session,
      instructions: [
        offer.session.instructions,
        context,
        'When delegating UI requests, preserve every requested change and content value. Forward relative date expressions unchanged so the Engine can resolve them using its fresh request-time browser calendar context.',
      ]
        .filter(Boolean)
        .join('\n\n'),
      delegation: {
        ...offer.session.delegation,
        responses: {
          ...offer.session.delegation.responses,
          instructions: [
            offer.session.delegation.responses.instructions,
            BACKEND_ROUTING,
            context,
          ]
            .filter(Boolean)
            .join('\n\n'),
        },
      },
    },
  };
}
