import { expect, test } from 'bun:test';
import { mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  compareMigration,
  migrationSnapshot,
  parsePiUsage,
  piEvidence,
} from './migration-evaluation';

test('a substituted dependency cannot become a preserved SDK result', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'migration-integrity-'));
  await writeFile(join(dir, 'package.json'), '{}');
  const before = await migrationSnapshot(dir);
  await symlink('/does-not-exist', join(dir, 'sdk'));
  await expect(migrationSnapshot(dir)).rejects.toThrow('Symlinks');
  expect(before['package.json']).toBeDefined();
});

test('partial usage and different providers cannot masquerade as a matched measured run', () => {
  const rows = [
    {
      type: 'message',
      message: {
        role: 'assistant',
        provider: 'one',
        model: 'small',
        usage: { input: 10, output: 5, cacheRead: 7, cacheWrite: 3 },
      },
    },
    {
      type: 'message',
      message: { role: 'assistant', provider: 'one', model: 'small' },
    },
  ];
  expect(
    parsePiUsage(rows.map((row) => JSON.stringify(row)).join('\n')),
  ).toBeNull();
  expect(piEvidence(JSON.stringify(rows[0])).model).toBe('one/small');
});

test('missing usage is unknown and unequal quality never produces savings', () => {
  expect(parsePiUsage('')).toBeNull();
  expect(() =>
    parsePiUsage(
      '{"type":"message_end","message":{"role":"assistant","usage":{"input":-1}}}',
    ),
  ).toThrow();
  expect(
    compareMigration(
      { model: 'same', activated: true, passed: true, usage: null },
      { model: 'same', activated: true, passed: false, usage: null },
    ),
  ).toEqual({ eligible: false, savings: null });
});

test('Pi activation requires a successful read of delivered expected guide content', () => {
  const usage = { input: 12, output: 4, cacheRead: 8, cacheWrite: 2 };
  const rows = [
    {
      type: 'message_end',
      message: {
        role: 'assistant',
        provider: 'local',
        model: 'same',
        usage,
        stopReason: 'stop',
        content: [{ type: 'text', text: 'Done.' }],
      },
    },
    {
      type: 'tool_execution_start',
      toolCallId: 'read-1',
      toolName: 'read',
      args: { path: '.agents/skills/maelstrom/SKILL.md' },
    },
    {
      type: 'tool_execution_end',
      toolCallId: 'read-1',
      isError: false,
      result: { isError: false },
    },
  ];
  const allowed = {
    cwd: '/consumer',
    prompt: 'Migrate orders.',
    guides: {
      '/consumer/.agents/skills/maelstrom/SKILL.md': {
        heading: '# Migration',
        content: 'Preserve the legacy order behavior.',
        kind: 'migration' as const,
      },
    },
  };
  const result = piEvidence(
    rows.map((row) => JSON.stringify(row)).join('\n'),
    allowed,
  );
  expect(result.activated).toBe(false);
  expect(result.usage).toEqual({
    uncachedInput: 12,
    output: 4,
    cacheRead: 8,
    cacheWrite: 2,
    source: 'reported-tokens-not-billing',
  });
  expect(
    piEvidence(rows.map((row) => JSON.stringify(row)).join('\n')).activated,
  ).toBe(false);
});

test('comparison requires equal successful quality, matched models, measured usage, and treatment activation', () => {
  const usage = {
    uncachedInput: 10,
    output: 5,
    cacheRead: 7,
    cacheWrite: 3,
    source: 'reported-tokens-not-billing' as const,
  };
  const baseline = {
    model: 'one/small',
    activated: false,
    passed: true,
    usage,
    traceBound: true,
    sessionId: 'baseline-session',
    sdkGuidesReceived: [],
    guideExposure: false,
    reviewApproved: true,
    reviewHash: 'reviewed-pair',
    submissionBound: true,
  };
  const treatment = {
    ...baseline,
    activated: true,
    sessionId: 'treatment-session',
    sdkGuidesReceived: [
      'node_modules/@maelstrom-co/react/skills/maelstrom-react-sdk/SKILL.md',
    ],
  };
  expect(compareMigration(baseline, treatment).eligible).toBe(true);
  expect(
    compareMigration({ ...baseline, submissionBound: false }, treatment)
      .eligible,
  ).toBe(false);
  expect(
    compareMigration(baseline, { ...treatment, submissionBound: false })
      .eligible,
  ).toBe(false);
  expect(
    compareMigration(baseline, { ...treatment, model: 'two/small' }).eligible,
  ).toBe(false);
  expect(
    compareMigration(baseline, { ...treatment, activated: false }).savings,
  ).toBeNull();
  expect(
    compareMigration(baseline, { ...treatment, usage: null }).savings,
  ).toBeNull();
  expect(
    compareMigration({ ...baseline, activated: true }, treatment).savings,
  ).toBeNull();
  expect(
    compareMigration(baseline, { ...treatment, sdkGuidesReceived: [] })
      .eligible,
  ).toBe(false);
  expect(
    compareMigration(baseline, { ...treatment, reviewApproved: false })
      .eligible,
  ).toBe(false);
  expect(
    compareMigration({ ...baseline, guideExposure: true }, treatment).eligible,
  ).toBe(false);
});

const binding = {
  cwd: '/consumer/treatment',
  prompt: 'Migrate orders.',
  guides: {
    '/consumer/treatment/guide/SKILL.md': {
      heading: '# Migration',
      content: 'Preserve the legacy order behavior.',
      kind: 'migration' as const,
    },
  },
};
function trace(
  cwd = binding.cwd,
  task = binding.prompt,
  id = 'session-12345678',
) {
  return [
    { type: 'session', version: 3, id, cwd },
    { type: 'agent_start' },
    {
      type: 'message_end',
      message: { role: 'user', content: [{ type: 'text', text: task }] },
    },
    {
      type: 'tool_execution_start',
      toolName: 'read',
      toolCallId: 'read-guide',
      args: { path: 'guide/SKILL.md' },
    },
    {
      type: 'tool_execution_end',
      toolCallId: 'read-guide',
      isError: false,
      result: {
        content: [
          {
            type: 'text',
            text: '# Migration\nPreserve the legacy order behavior.',
          },
        ],
      },
    },
    {
      type: 'message_end',
      message: {
        role: 'assistant',
        model: 'same',
        provider: 'local',
        stopReason: 'stop',
        content: [{ type: 'text', text: 'Done.' }],
        usage: { input: 12, output: 4, cacheRead: 8, cacheWrite: 2 },
      },
    },
    { type: 'agent_end' },
  ];
}
const lines = (rows: unknown[]) =>
  rows.map((row) => JSON.stringify(row)).join('\n');

test('a treatment entry-router catalog cannot qualify as an uncontaminated baseline', () => {
  const rows = trace().filter((row) => !row.type.startsWith('tool_'));
  rows.splice(2, 0, {
    type: 'message_end',
    message: {
      role: 'system',
      content: '<skills><name>maelstrom</name></skills>',
    },
  } as (typeof rows)[number]);
  const result = piEvidence(lines(rows), {
    ...binding,
    guides: {},
    exposureGuides: {
      '/consumer/treatment/.agents/skills/maelstrom/SKILL.md': {
        heading: '# Maelstrom task router',
        content: 'Choose exactly one task procedure for the requested outcome.',
        kind: 'workflow',
      },
    },
  });
  expect(result.guideExposure).toBe(true);
});

test('guide delivery after the completed answer cannot influence that submission', () => {
  const rows = trace();
  const lateReads = rows.splice(3, 2);
  rows.splice(rows.length - 1, 0, ...lateReads);
  const result = piEvidence(lines(rows), binding);
  expect(result.activated).toBe(false);
  expect(result.traceBound).toBe(false);
});

test('attribute-style catalogs expose every sealed treatment workflow, not only React guides', () => {
  for (const name of ['maelstrom', 'maelstrom-observability']) {
    const rows: unknown[] = trace().filter(
      (row) => !row.type.startsWith('tool_'),
    );
    rows.splice(2, 0, {
      type: 'message_end',
      message: {
        role: 'system',
        content: `<skill name="${name}">Workflow catalog entry</skill>`,
      },
    });
    const result = piEvidence(lines(rows), {
      ...binding,
      guides: {},
      exposureGuides: {
        [`/consumer/treatment/.agents/skills/${name}/SKILL.md`]: {
          heading: '# Workflow',
          content: 'Use the appropriate bounded workflow for this task.',
          kind: 'workflow',
        },
      },
    });
    expect(result.guideExposure).toBe(true);
  }
});

test('a completed trace cannot authorize a different source submission after review', () => {
  const sourceHash = 'a'.repeat(64);
  const submission = { attemptId: 'attempt-12345678', sourceHash };
  const rows: unknown[] = trace();
  rows.splice(
    rows.length - 2,
    0,
    {
      type: 'tool_execution_start',
      toolName: 'bash',
      toolCallId: 'source-receipt',
      args: { command: 'node migration-submission.mjs' },
    },
    {
      type: 'tool_execution_end',
      toolCallId: 'source-receipt',
      isError: false,
      result: {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              type: 'maelstrom_migration_submission',
              version: 1,
              ...submission,
            }),
          },
        ],
      },
    },
  );
  expect(
    piEvidence(lines(rows), { ...binding, submission }).submissionBound,
  ).toBe(true);
  const stale = piEvidence(lines(rows), {
    ...binding,
    submission: { ...submission, sourceHash: 'b'.repeat(64) },
  });
  expect(stale.submissionBound).toBe(false);
  expect(stale.traceBound).toBe(false);
  expect(
    piEvidence(lines(trace()), { ...binding, submission }).submissionBound,
  ).toBe(false);
  const laterTool = [
    ...rows.slice(0, -2),
    {
      type: 'tool_execution_start',
      toolName: 'read',
      toolCallId: 'after-receipt',
      args: { path: 'src/OrdersApp.tsx' },
    },
    ...rows.slice(-2),
  ];
  expect(
    piEvidence(lines(laterTool), { ...binding, submission }).traceBound,
  ).toBe(false);
  expect(
    piEvidence(lines(rows), {
      ...binding,
      submission: { ...submission, attemptId: 'another-attempt' },
    }).traceBound,
  ).toBe(false);
});

test('partial instructions contaminate the baseline without granting treatment receipts', () => {
  const guides = {
    '/consumer/treatment/guide/SKILL.md': {
      heading: '# Migration',
      content:
        '# Migration\nPreserve the legacy order behavior.\n\nKeep all application authorization and side effects application-owned.',
      kind: 'migration' as const,
    },
  };
  const incomplete = piEvidence(lines(trace()), { ...binding, guides });
  expect(incomplete.guideExposure).toBe(true);
  expect(incomplete.activated).toBe(false);
});

test('sealed treatment fingerprints reject contaminated baselines in both Pi startup formats', () => {
  const baselineBinding = {
    cwd: '/consumer/baseline',
    prompt: binding.prompt,
    guides: {},
    exposureGuides: {
      ...binding.guides,
      '/consumer/treatment/react/SKILL.md': {
        heading: '# Maelstrom React SDK',
        content: 'This guide is published inside its owning package.',
        kind: 'sdk' as const,
      },
    },
  };
  const baselineRows = trace(
    baselineBinding.cwd,
    binding.prompt,
    'baseline-12345678',
  ).filter((row) => !row.type.startsWith('tool_'));
  const evidence = (system: unknown) =>
    piEvidence(
      lines([
        ...baselineRows.slice(0, 2),
        { type: 'message_end', message: system },
        ...baselineRows.slice(2),
        { type: 'agent_settled' },
      ]),
      baselineBinding,
    );
  const treatment = {
    ...piEvidence(lines(trace()), binding),
    passed: true,
    reviewApproved: true,
    reviewHash: 'reviewed-pair',
    submissionBound: true,
    sdkGuidesReceived: [
      'node_modules/@maelstrom-co/react/skills/maelstrom-react-sdk/SKILL.md',
    ],
  };
  const sections = {
    preamble: 'Coding assistant.',
    skills: 'Ordinary tools.',
    cwd: baselineBinding.cwd,
  };
  for (const text of [
    '# Migration\nPreserve the legacy order behavior.',
    '# Maelstrom React SDK\nThis guide is published inside its owning package.',
    '<skill name="maelstrom-react-migration">Procedure</skill>',
    '<skill name="maelstrom-react-sdk">API guide</skill>',
  ]) {
    for (const system of [
      { role: 'system', content: text },
      { role: 'system', content: [{ type: 'text', text }] },
      { role: 'system', content: '', sections: { ...sections, skills: text } },
      { role: 'system', content: '', sections: { ...sections, docs: text } },
    ]) {
      const contaminated = evidence(system);
      expect(contaminated.traceBound).toBe(true);
      expect(contaminated.guideExposure).toBe(true);
      expect(contaminated.activated).toBe(false);
      expect(
        compareMigration(
          {
            ...contaminated,
            passed: true,
            reviewApproved: true,
            reviewHash: 'reviewed-pair',
            submissionBound: true,
          },
          treatment,
        ).eligible,
      ).toBe(false);
    }
  }
  for (const guide of Object.values(baselineBinding.exposureGuides)) {
    for (const system of [
      {
        role: 'system',
        content: '',
        sections: { ...sections, preamble: guide.heading, docs: guide.content },
      },
      {
        role: 'system',
        content: guide.heading,
        sections: { ...sections, docs: guide.content },
      },
      {
        role: 'system',
        content: guide.content,
        sections: { ...sections, preamble: guide.heading },
      },
    ]) {
      const contaminated = evidence(system);
      expect(contaminated.traceBound).toBe(true);
      expect(contaminated.guideExposure).toBe(true);
      expect(contaminated.activated).toBe(false);
      expect(contaminated.sdkGuidesReceived).toEqual([]);
      expect(
        compareMigration(
          {
            ...contaminated,
            passed: true,
            reviewApproved: true,
            reviewHash: 'reviewed-pair',
            submissionBound: true,
          },
          treatment,
        ).eligible,
      ).toBe(false);
    }
  }
  for (const system of [
    {
      role: 'system',
      content:
        'Use React and the @maelstrom-co/react SDK. # Maelstrom React SDK',
    },
    {
      role: 'system',
      content: '',
      sections: {
        ...sections,
        docs: 'Use React and the @maelstrom-co/react SDK.',
      },
    },
  ]) {
    const clean = evidence(system);
    expect(clean.traceBound).toBe(true);
    expect(clean.guideExposure).toBe(false);
    expect(
      compareMigration(
        {
          ...clean,
          passed: true,
          reviewApproved: true,
          reviewHash: 'reviewed-pair',
          submissionBound: true,
        },
        treatment,
      ).eligible,
    ).toBe(true);
  }
  const delivered = piEvidence(
    lines(trace(baselineBinding.cwd)),
    baselineBinding,
  );
  expect(delivered.guideExposure).toBe(true);
  expect(delivered.activated).toBe(false);
});

test('Pi startup sections are valid authority without a duplicate system body', () => {
  const sections = {
    preamble: 'Coding assistant.',
    tools: 'Read and edit tools.',
    rules: 'Preserve behavior.',
    docs: 'Public SDK documentation.',
    project_context: 'Order consumer.',
    skills: 'Migration procedure is available.',
    cwd: binding.cwd,
  };
  const withSystem = (system: unknown) =>
    lines([
      trace()[0],
      trace()[1],
      { type: 'message_end', message: system },
      ...trace().slice(2),
      { type: 'agent_settled' },
    ]);
  const result = piEvidence(
    withSystem({ role: 'system', content: '', sections }),
    binding,
  );
  expect(result.traceBound).toBe(true);
  expect(result.activated).toBe(true);
  expect(result.usage).not.toBeNull();
  for (const invalid of [
    undefined,
    null,
    [],
    {},
    { skills: '' },
    { ...sections, skills: '' },
    { ...sections, skills: 1 },
    { ...sections, extra: 'unknown' },
    { ...sections, preamble: 'x'.repeat(262_145) },
  ]) {
    expect(
      piEvidence(
        withSystem({ role: 'system', content: '', sections: invalid }),
        binding,
      ).traceBound,
    ).toBe(false);
  }
});

test('real Pi terminal settlement preserves binding but cannot hide post-completion activity', () => {
  const completed = [
    ...trace().slice(0, 5),
    {
      type: 'message_update',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Done.' }],
      },
    },
    trace()[5],
    { type: 'turn_end' },
    { type: 'agent_end' },
    { type: 'agent_settled' },
  ];
  expect(piEvidence(lines(completed), binding).traceBound).toBe(true);
  expect(piEvidence(lines(completed.slice(0, -1)), binding).traceBound).toBe(
    true,
  );
  for (const extra of [
    { type: 'message_update' },
    trace()[5],
    {
      type: 'tool_execution_start',
      toolName: 'read',
      toolCallId: 'late-read',
      args: { path: 'guide/SKILL.md' },
    },
    trace()[0],
    { type: 'agent_settled' },
  ]) {
    expect(piEvidence(lines([...completed, extra]), binding).traceBound).toBe(
      false,
    );
    expect(
      piEvidence(
        lines([...completed.slice(0, -1), extra, { type: 'agent_settled' }]),
        binding,
      ).traceBound,
    ).toBe(false);
  }
  expect(
    piEvidence(
      lines([
        ...completed.slice(0, -1),
        { type: 'agent_settled', extra: true },
      ]),
      binding,
    ).traceBound,
  ).toBe(false);
  expect(
    piEvidence(
      lines([
        ...completed.slice(0, -2),
        { type: 'agent_settled' },
        { type: 'agent_end' },
      ]),
      binding,
    ).traceBound,
  ).toBe(false);
});

test('only one completed session for the prepared cwd and exact task can authorize comparison', () => {
  const good = piEvidence(lines(trace()), binding);
  expect(good.traceBound).toBe(true);
  expect(good.activated).toBe(true);
  expect(piEvidence(lines(trace('/unrelated')), binding).traceBound).toBe(
    false,
  );
  expect(
    piEvidence(lines(trace(binding.cwd, 'Another request')), binding)
      .traceBound,
  ).toBe(false);
  expect(piEvidence(lines([...trace(), ...trace()]), binding).traceBound).toBe(
    false,
  );
  expect(piEvidence(lines(trace().slice(0, -1)), binding).traceBound).toBe(
    false,
  );
  expect(piEvidence(lines(trace().slice(1)), binding).traceBound).toBe(false);
  const emptyReceipt = trace();
  emptyReceipt[4].result!.content = [];
  expect(piEvidence(lines(emptyReceipt), binding).traceBound).toBe(true);
  expect(piEvidence(lines(emptyReceipt), binding).activated).toBe(false);
  const aborted = trace();
  aborted[5].message!.stopReason = 'aborted';
  expect(piEvidence(lines(aborted), binding).traceBound).toBe(false);
  const baselineBinding = {
    cwd: '/consumer/baseline',
    prompt: binding.prompt,
    guides: {},
  };
  const baseline = {
    ...piEvidence(
      lines(
        trace(baselineBinding.cwd, binding.prompt, 'baseline-12345678').filter(
          (row) => !row.type.startsWith('tool_'),
        ),
      ),
      baselineBinding,
    ),
    passed: true,
    reviewApproved: true,
    reviewHash: 'reviewed-pair',
    submissionBound: true,
  };
  const treatment = {
    ...good,
    passed: true,
    reviewApproved: true,
    reviewHash: 'reviewed-pair',
    submissionBound: true,
    sdkGuidesReceived: [
      'node_modules/@maelstrom-co/react/skills/maelstrom-react-sdk/SKILL.md',
    ],
  };
  expect(compareMigration(baseline, treatment).savings).toEqual({
    uncachedInputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    billing: null,
  });
  expect(
    compareMigration(baseline, { ...treatment, sessionId: baseline.sessionId })
      .eligible,
  ).toBe(false);
  expect(
    compareMigration(baseline, { ...treatment, traceBound: false }).eligible,
  ).toBe(false);
  const smaller = trace();
  smaller[5].message!.usage = {
    input: 9,
    output: 3,
    cacheRead: 5,
    cacheWrite: 4,
  };
  expect(
    compareMigration(baseline, {
      ...piEvidence(lines(smaller), binding),
      passed: true,
      reviewApproved: true,
      reviewHash: 'reviewed-pair',
      submissionBound: true,
      sdkGuidesReceived: [
        'node_modules/@maelstrom-co/react/skills/maelstrom-react-sdk/SKILL.md',
      ],
    }).savings,
  ).toEqual({
    uncachedInputTokens: 3,
    outputTokens: 1,
    cacheReadTokens: 3,
    cacheWriteTokens: -2,
    billing: null,
  });
});

test('recorded Pi sessions need headers, a complete final response, and no mixed streaming messages', () => {
  const recorded = [
    trace()[0],
    {
      type: 'message',
      id: 'entry-user',
      parentId: null,
      message: trace()[2].message,
    },
    {
      type: 'message',
      id: 'entry-final',
      parentId: 'entry-user',
      message: trace()[5].message,
    },
  ];
  expect(piEvidence(lines(recorded), binding).traceBound).toBe(true);
  expect(piEvidence(lines(recorded.slice(1)), binding).traceBound).toBe(false);
  expect(piEvidence(lines([...recorded, trace()[5]]), binding).traceBound).toBe(
    false,
  );
});

test('SDK guide receipt records delivered installed documentation rather than a path claim', () => {
  const sdkPath =
    '/consumer/treatment/node_modules/@maelstrom-co/react/skills/maelstrom-react-sdk/SKILL.md';
  const sdkBinding = {
    ...binding,
    guides: {
      ...binding.guides,
      [sdkPath]: {
        heading: '# Maelstrom React SDK',
        content: 'This guide belongs to the installed public React package.',
        kind: 'sdk' as const,
      },
    },
  };
  const rows = trace();
  rows.splice(
    5,
    0,
    {
      type: 'tool_execution_start',
      toolCallId: 'sdk-read',
      toolName: 'read',
      args: { path: sdkPath },
    },
    {
      type: 'tool_execution_end',
      toolCallId: 'sdk-read',
      isError: false,
      result: {
        content: [
          {
            type: 'text',
            text: '# Maelstrom React SDK\nThis guide belongs to the installed public React package.',
          },
        ],
      },
    },
  );
  expect(piEvidence(lines(rows), sdkBinding).sdkGuidesReceived).toEqual([
    'node_modules/@maelstrom-co/react/skills/maelstrom-react-sdk/SKILL.md',
  ]);
});
