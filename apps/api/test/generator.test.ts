import { describe, it, expect, vi } from 'vitest';
import { TestGenerator } from '../src/generator.js';
const pages = [{ path: '/', title: 'Welcome', headings: ['Home'], links: [] }];
function provider(tests: unknown, status = 'completed') {
  return vi
    .fn()
    .mockResolvedValue(
      new Response(
        JSON.stringify({
          status,
          output: [{ content: [{ type: 'output_text', text: JSON.stringify({ tests }) }] }],
        }),
        { status: 200 },
      ),
    );
}
describe('test generation', () => {
  it('labels generation without a key as deterministic', async () => {
    const out = await new TestGenerator().generate(pages);
    expect(out.source).toBe('deterministic');
    expect(out.tests[0].assertions).toHaveLength(2);
  });
  it('calls structured output with storage disabled and validates evidence', async () => {
    const request = provider([
      { title: 'Smoke', path: '/', assertions: [{ kind: 'title', expected: 'Welcome' }] },
    ]);
    const out = await new TestGenerator(
      { key: 'test-only', model: 'configured-model' },
      request,
    ).generate(pages);
    expect(out.source).toBe('ai');
    const args = request.mock.calls[0];
    expect(args[0]).toBe('https://api.openai.com/v1/responses');
    const body = JSON.parse(args[1].body);
    expect(body.store).toBe(false);
    expect(body.text.format.strict).toBe(true);
    expect(body.model).toBe('configured-model');
  });
  it('rejects instructions disguised as generated code', async () => {
    const request = provider([
      { title: 'Injected', path: '/', assertions: [{ kind: 'evaluate', expected: 'fetch(...)' }] },
    ]);
    await expect(
      new TestGenerator({ key: 'test-only', model: 'configured-model' }, request).generate(pages),
    ).rejects.toThrow();
  });
  it('rejects model hallucinations', async () => {
    const request = provider([
      { title: 'Fake', path: '/', assertions: [{ kind: 'heading', expected: 'Not observed' }] },
    ]);
    await expect(
      new TestGenerator({ key: 'test-only', model: 'configured-model' }, request).generate(pages),
    ).rejects.toThrow('evidence');
  });
  it('does not silently replace a failed AI request with success', async () => {
    const request = vi.fn().mockResolvedValue(new Response('not authorized', { status: 401 }));
    await expect(
      new TestGenerator({ key: 'test-only', model: 'configured-model' }, request).generate(pages),
    ).rejects.toThrow('provider');
  });
  it('rejects incomplete output', async () => {
    const request = provider([], 'incomplete');
    await expect(
      new TestGenerator({ key: 'test-only', model: 'configured-model' }, request).generate(pages),
    ).rejects.toThrow('incomplete');
  });
  it('requires an explicit model when AI is configured', async () => {
    await expect(new TestGenerator({ key: 'test-only' }).generate(pages)).rejects.toThrow(
      'OPENAI_MODEL',
    );
  });
});
