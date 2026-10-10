import { expect, test } from 'bun:test';

test('source-condition production consumers cannot collect content or attach observers', () => {
  const probe = `import {DiagnosticCapture,VoiceDiagnostics,createDevtools} from './src/index.ts';
 const capture=new DiagnosticCapture();capture.start('fixture','session','provider');capture.record('content',{text:'sensitive fixture'});capture.setOutcome('sensitive note');
 const voice=new VoiceDiagnostics();voice.record({at:1,kind:'engine_started'});
 const tools=createDevtools();
 console.log(JSON.stringify({active:capture.getSnapshot().active,count:capture.getSnapshot().count,exported:capture.export('sensitive note'),voice:voice.getSnapshot().length,enabled:tools.options.enabled}));`;
  const result = Bun.spawnSync(
    [process.execPath, '--conditions=@maelstrom-co/source', '--eval', probe],
    {
      cwd: `${import.meta.dir}/..`,
      env: { ...process.env, NODE_ENV: 'production' },
    },
  );
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout.toString())).toEqual({
    active: false,
    count: 0,
    exported: '',
    voice: 0,
    enabled: false,
  });
});

test('the explicit production entrypoint retains redacted evidence and releases its client', () => {
  const probe = `import {Orchestrator} from '@maelstrom-co/client';
 import {createDevtools,VoiceDiagnostics} from '@maelstrom-co/devtools/production';
 const connector={capabilities:{voice:false,streaming:false,stateful:false},connect:async()=>{},disconnect:async()=>{},subscribe:()=>()=>{},process:async()=>{throw Error('unexpected request')},addAssistantMessage:async()=>{},getHistory:async()=>[]};
 const client=new Orchestrator(connector);
 const tools=createDevtools({maxActivityEvents:2});const detach=tools.attach(client);
 tools.startCapture();client.diagnostics.emit('fixture.completed',{ok:true},()=>({text:'explicit content',apiKey:'private-key'}),'request');
 tools.capture.setOutcome('review this result');tools.stopCapture();
 const exported=tools.exportCapture();tools.importCapture(exported);
 const voice=new VoiceDiagnostics();voice.record({at:1,kind:'engine_started'});
 const result={enabled:tools.options.enabled,observed:client.diagnostics.observed,activity:tools.getSnapshot().activity.length,content:exported.includes('explicit content'),secret:exported.includes('private-key'),note:JSON.parse(exported).capture.outcome,imported:tools.getSnapshot().imported!==null,voice:voice.getSnapshot().length};
 detach();tools.dispose();await client.dispose();
 console.log(JSON.stringify({...result,observedAfterDetach:client.diagnostics.observed}));`;
  const result = Bun.spawnSync(
    [process.execPath, '--conditions=@maelstrom-co/source', '--eval', probe],
    {
      cwd: `${import.meta.dir}/..`,
      env: { ...process.env, NODE_ENV: 'production' },
    },
  );
  expect(result.exitCode, result.stderr.toString()).toBe(0);
  expect(JSON.parse(result.stdout.toString())).toEqual({
    enabled: true,
    observed: true,
    activity: 2,
    content: true,
    secret: false,
    note: 'review this result',
    imported: true,
    voice: 1,
    observedAfterDetach: false,
  });
});
