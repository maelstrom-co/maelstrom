import type { LiveExchangeRequest } from '@maelstrom-co/realtime-protocol/openai-live';
import { browserCalendarContext } from './calendar-context';

const BACKEND_ROUTING = `You route requests to the Maelstrom Engine; the Engine plans the UI.
For a direct request to show, hide, replace, create, or configure a view, call update_ui directly with the complete natural-language intent. Combine the requested layout changes and Actions in one call when they belong to the same request. The Engine can create a view and execute its Actions in that same request.
Preserve the user's requested title, content, parameters, and constraints. Do not shorten away details or split one compound request into separate discovery, creation, and editing steps.
The Engine already receives the current Chart snapshot, registered Vessels, and available Actions. Do not call get_ui_state or get_capabilities as routine prerequisites to update_ui. Use them for explicit questions about the UI or available choices, or when missing information prevents you from expressing the user's intent. Do not invent missing choices.
Keep relative date expressions such as today, yesterday, and tomorrow unchanged in update_ui. The Engine receives fresh browser-local calendar context with every request and resolves those expressions. Do not turn a relative expression into a literal title, and do not use the connection-start date to resolve later requests. Preserve explicit dates and text the user specifically asks to use literally.
Only confirm completion after the update_ui result confirms success. Do not repeat a mutation to verify it.`;

const BACKEND_COMPLETION = `After update_ui confirms success, finish the delegation immediately with one short factual sentence describing the confirmed changes. Prefer 20 words or fewer.
Do not repeat the original request, explain your workflow, offer follow-up help, or call more tools just to reconfirm a successful result.
If the result includes partial completion, refusal, failure, or an unknown outcome, preserve those distinctions and any necessary qualification even if the reply must be longer. Never infer success or retry a mutation from an unconfirmed result.
This concise completion format applies only to UI changes, not to answers to read-only questions.`;

export function configureDemoLiveOffer(
  offer: LiveExchangeRequest,
  calendar = browserCalendarContext(),
): LiveExchangeRequest {
  const context = `Browser calendar snapshot at connection start (not a continuously refreshed clock): ${JSON.stringify(calendar)}`;
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
            BACKEND_COMPLETION,
            context,
          ]
            .filter(Boolean)
            .join('\n\n'),
        },
      },
    },
  };
}
