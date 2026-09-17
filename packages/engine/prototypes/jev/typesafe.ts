import { z } from 'zod';

export interface Question {
  type: 'choice';
  instructions: string;
  criteria: Record<string, string>;
}

export interface Evaluation {
  state: unknown;
  questions: Record<string, Question>;
}

const probability = z.number().min(0).max(1);
const answerSchema = z.object({
  type: z.literal('choice'),
  choice: z.string(),
  confidence: probability,
  probabilities: z.record(z.string(), probability),
});
const responseSchema = z.object({
  model: z.string(),
  answers: z.record(z.string(), answerSchema),
  usage: z.object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
  }),
});

export type Answer = z.infer<typeof answerSchema>;
export type Reply = z.infer<typeof responseSchema>;
export type Judge = (evaluation: Evaluation) => Promise<Reply>;

export function choice(
  instructions: string,
  criteria: Record<string, string>,
): Question {
  return { type: 'choice', instructions, criteria };
}

export function validateReply(evaluation: Evaluation, raw: unknown): Reply {
  const reply = responseSchema.parse(raw);
  for (const [id, question] of Object.entries(evaluation.questions)) {
    const answer = reply.answers[id];
    const options = Object.keys(question.criteria);
    if (
      !answer ||
      !Object.hasOwn(question.criteria, answer.choice) ||
      Object.keys(answer.probabilities).length !== options.length ||
      options.some((key) => !Object.hasOwn(answer.probabilities, key)) ||
      Math.abs(
        Object.values(answer.probabilities).reduce((a, b) => a + b, 0) - 1,
      ) > 0.02
    ) {
      throw new Error(`Invalid or missing Choice answer: ${id}`);
    }
  }
  return reply;
}

export function liveJudge(model: string, signal?: AbortSignal): Judge {
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey)
    throw new Error('Set TYPESAFE_API_KEY to run live Jev evaluations.');
  return async (evaluation) => {
    const deadline = AbortSignal.timeout(30_000);
    const response = await fetch('https://api.typesafe.ai/v1/systemone', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...evaluation, model }),
      signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
    });
    // One attempt keeps measured latency and request counts unambiguous.
    if (!response.ok)
      throw new Error(`TypeSafe returned HTTP ${response.status}`);
    return validateReply(evaluation, await response.json());
  };
}

export function scriptedReply(
  evaluation: Evaluation,
  selections: Record<string, string>,
  confidence = 1,
): Reply {
  const answers = Object.fromEntries(
    Object.entries(evaluation.questions).map(([id, question]) => {
      const selected = selections[id];
      if (selected === undefined)
        throw new Error(`Fixture has no answer for ${id}`);
      const options = Object.keys(question.criteria);
      return [
        id,
        {
          type: 'choice' as const,
          choice: selected,
          confidence,
          probabilities: Object.fromEntries(
            options.map((option) => [option, option === selected ? 1 : 0]),
          ),
        },
      ];
    }),
  );
  return validateReply(evaluation, {
    model: 'scripted-not-jev',
    answers,
    usage: { input_tokens: 0, output_tokens: 0 },
  });
}
